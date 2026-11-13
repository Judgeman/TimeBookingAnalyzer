//! Abruf der Zeitbuchungen aus ProjectForge über die REST-API – statt eine
//! Export-Datei herunterzuladen und einzulesen.
//!
//! - Buchungen: `PUT /rs/timesheet/list?doNotStore=true` mit Filter `period`
//!   (Kalendertage, beide einschließlich) – alle Buchungen, die der Zugang
//!   lesen darf; Personen ordnet die Auswertung wie beim Export über den Namen zu.
//! - Kostenarten: `GET /rs/bookableTasks` liefert je Kostenstelle Kostenart
//!   (Nummer + Name) und Arbeitsanteil (`workFraction` = „Mult“ des Exports).
//! - Anmeldung: `Authorization: Bearer <userId>:<token>`; abgelehnt wird mit
//!   einer Weiterleitung (302) zur Login-Seite.
//!
//! Umgerechnet wird in dieselben Zeilen wie aus dem Export ([`TimeEntry`]):
//! Person = Anzeigename, Tag = Beginn in deutscher Zeit, Element = Task-Titel,
//! Kost2Art = Name der Kostenart, Mult = Arbeitsanteil, Ort = Ort.

pub mod client;

use std::collections::{BTreeMap, BTreeSet, HashMap};

use chrono::{DateTime, Datelike, Days, Months, NaiveDate, NaiveDateTime, NaiveTime, Utc, Weekday};
use serde::{Deserialize, Serialize};

use crate::models::entry::TimeEntry;

/// Antwort von `/rs/timesheet/list` (nur die benötigten Felder).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListResponse {
    #[serde(default)]
    pub result_set: Vec<Row>,
    pub total_size: Option<u64>,
    #[serde(default)]
    pub result_set_truncated: bool,
}

impl ListResponse {
    /// Hat ProjectForge die Liste gekürzt (`maxRows`)?
    pub fn truncated(&self) -> bool {
        self.result_set_truncated
            || self
                .total_size
                .is_some_and(|total| total > self.result_set.len() as u64)
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    pub timesheet: Timesheet,
    pub duration_millis: Option<i64>,
    pub deleted: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Timesheet {
    pub id: Option<i64>,
    pub task: Option<Reference>,
    pub user: Option<Reference>,
    pub kost2: Option<Kost2Ref>,
    pub location: Option<String>,
    pub description: Option<String>,
    pub start_time: Option<DateTime<Utc>>,
    pub stop_time: Option<DateTime<Utc>>,
    pub deleted: Option<bool>,
}

/// Task bzw. Person: `title` (Task) bzw. `displayName`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reference {
    pub id: Option<i64>,
    pub title: Option<String>,
    pub display_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Kost2Ref {
    pub id: Option<i64>,
    /// z. B. „5.123.00.04: Delivery (billable) - Projekt“.
    pub display_name: Option<String>,
    /// Letzte Stelle der Kostenstelle = Nummer der Kostenart.
    pub endziffer: Option<i64>,
}

/// Eintrag von `/rs/bookableTasks`.
#[derive(Debug, Deserialize)]
pub struct BookableTask {
    #[serde(default)]
    pub kost2: Vec<BookableKost2>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookableKost2 {
    pub id: Option<i64>,
    pub work_fraction: Option<f64>,
    pub kost2_art: Option<Kost2Art>,
}

#[derive(Debug, Deserialize)]
pub struct Kost2Art {
    pub id: Option<i64>,
    pub name: Option<String>,
}

/// Kostenarten (Name, Arbeitsanteil) je Nummer und Arbeitsanteil je Kostenstelle.
#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
pub struct CostTypes {
    /// Nummer der Kostenart → (Name, Arbeitsanteil).
    pub kinds: BTreeMap<i64, (String, f64)>,
    /// Kostenstelle → Arbeitsanteil (genauer als die Kostenart).
    pub cost_units: BTreeMap<i64, f64>,
}

impl CostTypes {
    pub fn from_bookable(tasks: &[BookableTask]) -> Self {
        let mut types = Self::default();
        for kost2 in tasks.iter().flat_map(|t| &t.kost2) {
            let fraction = kost2.work_fraction.filter(|f| f.is_finite());
            if let (Some(id), Some(fraction)) = (kost2.id, fraction) {
                types.cost_units.insert(id, fraction);
            }
            if let Some(Kost2Art {
                id: Some(id),
                name: Some(name),
            }) = &kost2.kost2_art
            {
                types
                    .kinds
                    .entry(*id)
                    .or_insert_with(|| (name.trim().to_string(), fraction.unwrap_or(1.0)));
            }
        }
        types
    }

    /// Ergänzt um Kostenarten eines früheren Abrufs (z. B. eine Kostenart, auf
    /// die man inzwischen nicht mehr buchen darf).
    pub fn merge_missing(&mut self, older: &CostTypes) {
        for (id, kind) in &older.kinds {
            self.kinds.entry(*id).or_insert_with(|| kind.clone());
        }
        for (id, fraction) in &older.cost_units {
            self.cost_units.entry(*id).or_insert(*fraction);
        }
    }
}

/// Eine abgerufene Buchung, wie sie zwischengespeichert wird (mit der ID von
/// ProjectForge, um doppelt gelieferte Buchungen zu erkennen).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FetchedEntry {
    pub id: i64,
    pub name: String,
    pub date: NaiveDate,
    pub hours: f64,
    pub mult: f64,
    pub element: String,
    pub kost2art: String,
    pub location: String,
    /// Beginn/Ende in deutscher Zeit (für den Wochenkalender).
    #[serde(default)]
    pub start: Option<NaiveTime>,
    #[serde(default)]
    pub end: Option<NaiveTime>,
    #[serde(default)]
    pub description: String,
}

impl FetchedEntry {
    pub fn into_entry(self) -> TimeEntry {
        TimeEntry {
            name: self.name,
            date: self.date,
            hours: self.hours,
            mult: self.mult,
            element: self.element,
            kost2art: self.kost2art,
            location: self.location,
            billable: None,
            start: self.start,
            end: self.end,
            description: self.description,
        }
    }
}

/// Wandelt eine Zeile der Liste um; gelöschte oder unvollständige Buchungen
/// (ohne Beginn) werden übersprungen. Unbekannte Kostenarten landen in `unknown`
/// (Arbeitsanteil dann 1).
pub fn convert_row(
    row: &Row,
    types: &CostTypes,
    unknown: &mut BTreeSet<String>,
) -> Option<FetchedEntry> {
    let ts = &row.timesheet;
    if row.deleted == Some(true) || ts.deleted == Some(true) {
        return None;
    }
    let id = ts.id?;
    let start = ts.start_time?;
    let millis = row
        .duration_millis
        .or_else(|| ts.stop_time.map(|stop| (stop - start).num_milliseconds()))
        .unwrap_or(0);
    let name = ts
        .user
        .as_ref()
        .and_then(|u| u.display_name.clone())
        .map(|n| n.trim().to_string())
        .unwrap_or_else(|| {
            format!(
                "Person #{}",
                ts.user.as_ref().and_then(|u| u.id).unwrap_or(0)
            )
        });
    let element = ts
        .task
        .as_ref()
        .and_then(|t| {
            t.title
                .clone()
                .or_else(|| t.display_name.as_deref().map(strip_id_suffix))
        })
        .unwrap_or_default();

    let (kost2art, mult) = match &ts.kost2 {
        None => (String::new(), 1.0),
        Some(kost2) => {
            let kind = kost2.endziffer.and_then(|n| types.kinds.get(&n));
            let name = kind
                .map(|(name, _)| name.clone())
                .or_else(|| {
                    kost2
                        .display_name
                        .as_deref()
                        .and_then(kind_from_display_name)
                })
                .unwrap_or_default();
            let fraction = kost2
                .id
                .and_then(|id| types.cost_units.get(&id).copied())
                .or_else(|| kind.map(|(_, f)| *f));
            let fraction = fraction.unwrap_or_else(|| {
                unknown.insert(match (kost2.endziffer, name.is_empty()) {
                    (Some(n), false) => format!("{n:02} {name}"),
                    (Some(n), true) => format!("{n:02}"),
                    (None, _) => kost2.display_name.clone().unwrap_or_default(),
                });
                1.0
            });
            (name, fraction)
        }
    };

    let local_start = local_time(start.naive_utc());
    Some(FetchedEntry {
        id,
        name,
        date: local_start.date(),
        start: Some(local_start.time()),
        end: ts.stop_time.map(|stop| local_time(stop.naive_utc()).time()),
        description: ts
            .description
            .clone()
            .unwrap_or_default()
            .trim()
            .to_string(),
        hours: millis as f64 / 3_600_000.0,
        mult,
        element: element.trim().to_string(),
        kost2art,
        location: ts.location.clone().unwrap_or_default().trim().to_string(),
    })
}

/// „P100 Lager-App (#123)“ → „P100 Lager-App“.
fn strip_id_suffix(name: &str) -> String {
    match name.rfind(" (#") {
        Some(pos) if name.ends_with(')') => name[..pos].to_string(),
        _ => name.to_string(),
    }
}

/// Kostenart aus dem Anzeigenamen der Kostenstelle:
/// „5.123.00.04: Delivery (billable) - Projekt“ → „Delivery (billable)“.
fn kind_from_display_name(name: &str) -> Option<String> {
    let rest = name.split_once(": ")?.1;
    let kind = rest.split(" - ").next()?.trim();
    (!kind.is_empty()).then(|| kind.to_string())
}

/// Ortszeit in Deutschland: MEZ (UTC+1), Sommerzeit MESZ (UTC+2) vom letzten
/// Sonntag im März bis zum letzten Sonntag im Oktober, jeweils 01:00 UTC.
fn local_time(utc: NaiveDateTime) -> NaiveDateTime {
    let year = utc.year();
    let switch = |month| {
        last_sunday(year, month)
            .and_then(|d| d.and_hms_opt(1, 0, 0))
            .unwrap_or(utc)
    };
    let summer = utc >= switch(3) && utc < switch(10);
    utc + chrono::Duration::hours(if summer { 2 } else { 1 })
}

fn last_sunday(year: i32, month: u32) -> Option<NaiveDate> {
    let first_next = NaiveDate::from_ymd_opt(year, month, 1)?.checked_add_months(Months::new(1))?;
    let last = first_next.pred_opt()?;
    let back = last.weekday().num_days_from_sunday();
    last.checked_sub_days(Days::new(back.into()))
        .filter(|d| d.weekday() == Weekday::Sun)
}

/// Fasst gleiche Buchungen (gleiche ID, z. B. über Mitternacht in zwei
/// Monaten geliefert) zusammen.
pub fn dedupe(entries: impl IntoIterator<Item = FetchedEntry>) -> Vec<FetchedEntry> {
    let mut seen = HashMap::new();
    let mut out = Vec::new();
    for entry in entries {
        if seen.insert(entry.id, ()).is_none() {
            out.push(entry);
        }
    }
    out
}

/// Monatsschlüssel „2026-11“.
pub fn month_key(date: NaiveDate) -> String {
    date.format("%Y-%m").to_string()
}

/// Erster und letzter Tag eines Monats.
pub fn month_bounds(first: NaiveDate) -> (NaiveDate, NaiveDate) {
    let first = first.with_day(1).unwrap_or(first);
    let last = first
        .checked_add_months(Months::new(1))
        .and_then(|d| d.pred_opt())
        .unwrap_or(first);
    (first, last)
}

/// Ein Monat gilt als abgeschlossen (wird nicht erneut abgerufen), wenn er
/// mindestens [`FINAL_AFTER_DAYS`] Tage nach Monatsende abgerufen wurde –
/// ProjectForge sperrt den Vormonat einige Arbeitstage nach Monatsbeginn.
pub const FINAL_AFTER_DAYS: u64 = 10;

/// Welche Monate von `from` bis `today` (je erster Tag) abzurufen sind:
/// fehlende, noch nicht abgeschlossene oder bei `full` alle.
pub fn months_to_fetch(
    from: NaiveDate,
    today: NaiveDate,
    fetched: &BTreeMap<String, NaiveDateTime>,
    full: bool,
) -> Vec<NaiveDate> {
    let mut months = Vec::new();
    let mut month = from.with_day(1).unwrap_or(from);
    while month <= today && months.len() < 120 {
        let (_, last) = month_bounds(month);
        let done = fetched.get(&month_key(month)).is_some_and(|at| {
            last.checked_add_days(Days::new(FINAL_AFTER_DAYS))
                .is_some_and(|final_day| at.date() >= final_day)
        });
        if full || !done {
            months.push(month);
        }
        match month.checked_add_months(Months::new(1)) {
            Some(next) => month = next,
            None => break,
        }
    }
    months
}

/// Erster abzurufender Tag: 1. Januar des Vorjahres (Prognose-Faktoren,
/// Nachrechnung) bzw. Beginn eines früheren Budgets – höchstens 5 Jahre zurück.
pub fn fetch_start(
    today: NaiveDate,
    budget_starts: impl IntoIterator<Item = NaiveDate>,
) -> NaiveDate {
    let previous_year = NaiveDate::from_ymd_opt(today.year() - 1, 1, 1).unwrap_or(today);
    let limit = NaiveDate::from_ymd_opt(today.year() - 5, 1, 1).unwrap_or(previous_year);
    budget_starts
        .into_iter()
        .filter(|d| *d >= limit)
        .fold(previous_year, |min, d| min.min(d))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    fn utc(s: &str) -> DateTime<Utc> {
        s.parse().unwrap()
    }

    fn german_date(time: DateTime<Utc>) -> NaiveDate {
        local_time(time.naive_utc()).date()
    }

    #[test]
    fn german_date_follows_summer_time() {
        // Winter: UTC+1
        assert_eq!(german_date(utc("2026-11-13T22:59:00Z")), d(2026, 11, 13));
        assert_eq!(german_date(utc("2026-11-13T23:00:00Z")), d(2026, 11, 14));
        // Sommer: UTC+2
        assert_eq!(german_date(utc("2026-07-01T21:59:00Z")), d(2026, 7, 1));
        assert_eq!(german_date(utc("2026-07-01T22:00:00Z")), d(2026, 7, 2));
        // Umstellung 29.03.2026 01:00 UTC und 25.10.2026 01:00 UTC
        assert_eq!(last_sunday(2026, 3), Some(d(2026, 3, 29)));
        assert_eq!(last_sunday(2026, 10), Some(d(2026, 10, 25)));
        assert_eq!(german_date(utc("2026-03-28T22:30:00Z")), d(2026, 3, 28)); // 23:30 MEZ
        assert_eq!(german_date(utc("2026-03-29T22:30:00Z")), d(2026, 3, 30)); // 00:30 MESZ
        assert_eq!(german_date(utc("2026-10-24T22:30:00Z")), d(2026, 10, 25)); // 00:30 MESZ
        assert_eq!(german_date(utc("2026-10-25T22:30:00Z")), d(2026, 10, 25)); // 23:30 MEZ
    }

    fn row(json: &str) -> Row {
        serde_json::from_str(json).unwrap()
    }

    fn types() -> CostTypes {
        let tasks: Vec<BookableTask> = serde_json::from_str(
            r#"[{"id":1,"name":"P100 Lager-App","path":[],"kost2":[
                 {"id":501,"workFraction":1.0,"kost2Art":{"id":4,"name":"Delivery (billable)"}},
                 {"id":502,"workFraction":0.0,"kost2Art":{"id":5,"name":"Travel (billable)"}}]},
               {"id":2,"name":"(Vacation)","path":[],"kost2":[
                 {"id":601,"workFraction":0.0,"kost2Art":{"id":51,"name":"Vacation"},"absenceType":"VACATION"}]}]"#,
        )
        .unwrap();
        CostTypes::from_bookable(&tasks)
    }

    #[test]
    fn converts_rows_like_export_lines() {
        let types = types();
        assert_eq!(
            types.kinds.get(&4),
            Some(&("Delivery (billable)".into(), 1.0))
        );
        let mut unknown = BTreeSet::new();
        let delivery = row(
            r#"{"timesheet":{"id":7,"task":{"id":1,"displayName":"P100 Lager-App (#1)","title":"P100 Lager-App"},
                "user":{"id":42,"displayName":"Erika Mustermann"},
                "kost2":{"id":501,"displayName":"5.100.00.04: Delivery (billable) - Lager-App","endziffer":4},
                "location":"Home Office","description":" LAGER-12 ",
                "startTime":"2026-11-13T08:30:00.000Z","stopTime":"2026-11-13T10:00:00.000Z"},
              "id":7,"durationMillis":5400000}"#,
        );
        assert_eq!(
            convert_row(&delivery, &types, &mut unknown),
            Some(FetchedEntry {
                id: 7,
                name: "Erika Mustermann".into(),
                date: d(2026, 11, 13),
                hours: 1.5,
                mult: 1.0,
                element: "P100 Lager-App".into(),
                kost2art: "Delivery (billable)".into(),
                location: "Home Office".into(),
                start: NaiveTime::from_hms_opt(9, 30, 0), // MEZ
                end: NaiveTime::from_hms_opt(11, 0, 0),
                description: "LAGER-12".into(),
            })
        );
        // Urlaub: Element = Task-Titel, Arbeitsanteil 0; Dauer aus Beginn/Ende
        let vacation = row(
            r#"{"timesheet":{"id":8,"task":{"displayName":"(Vacation) (#2)"},
                "user":{"displayName":" Max Mustermann "},"location":"",
                "kost2":{"id":601,"displayName":"5.001.51.51: Vacation - (Vacation)","endziffer":51},
                "startTime":"2026-11-02T08:00:00.000Z","stopTime":"2026-11-02T16:00:00.000Z"}}"#,
        );
        let entry = convert_row(&vacation, &types, &mut unknown).unwrap();
        assert_eq!(
            (
                entry.name.as_str(),
                entry.element.as_str(),
                entry.kost2art.as_str(),
                entry.hours,
                entry.mult
            ),
            ("Max Mustermann", "(Vacation)", "Vacation", 8.0, 0.0)
        );
        assert!(unknown.is_empty());
        // unbekannte Kostenart: Name aus der Kostenstelle, Arbeitsanteil 1 + Hinweis
        let other = row(
            r#"{"timesheet":{"id":9,"task":{"title":"Z900 Intern"},"user":{"displayName":"Erika Mustermann"},
                "kost2":{"id":999,"displayName":"5.001.01.99: Wie im Tätigkeitsbericht - Intern","endziffer":99},
                "startTime":"2026-11-03T08:00:00.000Z"},"durationMillis":1800000}"#,
        );
        let entry = convert_row(&other, &types, &mut unknown).unwrap();
        assert_eq!(
            (entry.kost2art.as_str(), entry.mult, entry.hours),
            ("Wie im Tätigkeitsbericht", 1.0, 0.5)
        );
        assert_eq!(
            unknown,
            BTreeSet::from(["99 Wie im Tätigkeitsbericht".to_string()])
        );
        // gelöscht, ohne ID oder ohne Beginn → übersprungen
        for json in [
            r#"{"timesheet":{"id":10,"startTime":"2026-11-03T08:00:00Z","deleted":true}}"#,
            r#"{"timesheet":{"id":11,"startTime":"2026-11-03T08:00:00Z"},"deleted":true}"#,
            r#"{"timesheet":{"startTime":"2026-11-03T08:00:00Z"}}"#,
            r#"{"timesheet":{"id":12}}"#,
        ] {
            assert_eq!(
                convert_row(&row(json), &types, &mut unknown),
                None,
                "{json}"
            );
        }
        // ohne Kostenstelle und ohne Person
        let bare = convert_row(
            &row(r#"{"timesheet":{"id":13,"user":{"id":5},"startTime":"2026-11-03T08:00:00Z","stopTime":"2026-11-03T09:00:00Z"}}"#),
            &types,
            &mut unknown,
        )
        .unwrap();
        assert_eq!(
            (
                bare.name.as_str(),
                bare.kost2art.as_str(),
                bare.mult,
                bare.hours
            ),
            ("Person #5", "", 1.0, 1.0)
        );
    }

    #[test]
    fn helpers_for_names_and_truncation() {
        assert_eq!(strip_id_suffix("P100 Lager-App (#11)"), "P100 Lager-App");
        assert_eq!(strip_id_suffix("Ohne Nummer"), "Ohne Nummer");
        assert_eq!(
            kind_from_display_name("5.1.2.04: Delivery (billable) - A - B").as_deref(),
            Some("Delivery (billable)")
        );
        assert_eq!(kind_from_display_name("ohne Doppelpunkt"), None);
        let response: ListResponse =
            serde_json::from_str(r#"{"resultSet":[],"totalSize":3,"resultSetTruncated":false}"#)
                .unwrap();
        assert!(response.truncated());
        let response: ListResponse = serde_json::from_str(r#"{"resultSet":[]}"#).unwrap();
        assert!(!response.truncated());
        let a = |id| FetchedEntry {
            id,
            name: String::new(),
            date: d(2026, 1, 1),
            hours: 1.0,
            mult: 1.0,
            element: String::new(),
            kost2art: String::new(),
            location: String::new(),
            start: None,
            end: None,
            description: String::new(),
        };
        assert_eq!(dedupe([a(1), a(2), a(1)]).len(), 2);
        let mut types = CostTypes::default();
        types.merge_missing(&self::tests::types());
        assert_eq!(types.kinds.len(), 3);
        assert_eq!(types.cost_units.get(&502), Some(&0.0));
    }

    #[test]
    fn fetches_missing_and_open_months_only() {
        let at = |y, m, day| d(y, m, day).and_hms_opt(8, 0, 0).unwrap();
        let today = d(2026, 11, 13);
        let mut fetched = BTreeMap::new();
        fetched.insert("2026-09".to_string(), at(2026, 10, 11)); // 11 Tage nach Ende → fertig
        fetched.insert("2026-10".to_string(), at(2026, 11, 5)); // erst 5 Tage → erneut
        let months = months_to_fetch(d(2026, 8, 15), today, &fetched, false);
        assert_eq!(months, vec![d(2026, 8, 1), d(2026, 10, 1), d(2026, 11, 1)]);
        let all = months_to_fetch(d(2026, 8, 15), today, &fetched, true);
        assert_eq!(all.len(), 4);
        assert_eq!(
            month_bounds(d(2026, 2, 10)),
            (d(2026, 2, 1), d(2026, 2, 28))
        );
        assert_eq!(month_key(d(2026, 2, 10)), "2026-02");
        // Beginn: Vorjahr bzw. früheres Budget, höchstens 5 Jahre zurück
        assert_eq!(fetch_start(today, []), d(2025, 1, 1));
        assert_eq!(
            fetch_start(today, [d(2024, 7, 1), d(2026, 1, 1)]),
            d(2024, 7, 1)
        );
        assert_eq!(fetch_start(today, [d(2001, 1, 1)]), d(2025, 1, 1));
    }
}
