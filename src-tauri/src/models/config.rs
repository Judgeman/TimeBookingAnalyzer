//! Projektkonfiguration – wird pro Projekt als JSON-Datei gespeichert.
//!
//! Felder mit `#[serde(default)]` dürfen in der Datei fehlen; so bleiben
//! ältere oder von Hand geschriebene Konfigurationen ladbar.

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

use crate::calculation::holidays::is_known_region;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProjectConfig {
    /// UUID v4. Leer beim Anlegen – wird von `save_project` vergeben.
    #[serde(default)]
    pub id: String,
    pub name: String,
    /// Wert der Element-Spalte, der zum Projekt gehört (z. B. "P100 Lager-App").
    #[serde(default)]
    pub element_filter: String,
    #[serde(default)]
    pub team: Vec<TeamMember>,
    /// Personen, die aufs Projekt buchen dürfen, ohne dass ihre Arbeitszeit
    /// ausgewertet wird (z. B. Geschäftsführung).
    #[serde(default)]
    pub guests: Vec<Guest>,
    #[serde(default)]
    pub working_hours: Vec<WorkingHoursPeriod>,
    #[serde(default)]
    pub holidays: HolidayConfig,
    #[serde(default)]
    pub export_format: ExportFormat,
    /// Umsatzsteuersatz in Prozent für die Brutto-Berechnung der Rechnung
    /// (Standard; einzelne Abrechnungsregeln können abweichen).
    #[serde(default = "default_vat_percent")]
    pub vat_percent: f64,
    /// Welche Buchungen billable sind und wie sie abgerechnet werden.
    /// Die erste passende Regel gilt.
    #[serde(default = "default_billing_rules")]
    pub billing_rules: Vec<BillingRule>,
    /// Ein Werktag gilt als „fehlende Buchung“, wenn weniger als dieser Anteil
    /// (in Prozent) der Soll-Stunden gebucht ist.
    #[serde(default = "default_missing_threshold")]
    pub missing_threshold_percent: f64,
    /// Geplante Abwesenheiten ohne Buchung (nur für die Prognose).
    #[serde(default)]
    pub planned_absences: Vec<PlannedAbsence>,
    /// Budget-Zeiträume (ganze Monate) mit Betrag.
    #[serde(default)]
    pub budgets: Vec<BudgetPeriod>,
}

fn default_vat_percent() -> f64 {
    19.0
}

fn default_missing_threshold() -> f64 {
    50.0
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TeamMember {
    /// Name wie in der Namensspalte des Exports.
    pub name: String,
    #[serde(default)]
    pub rates: Vec<RatePeriod>,
    /// Abweichende Arbeitszeit (h/Tag) für diese Person. Für Tage ohne
    /// passenden Zeitraum gilt die Arbeitszeit des Projekts.
    #[serde(default)]
    pub working_hours: Vec<WorkingHoursPeriod>,
    /// Einsatzzeiträume im Projekt; leer = immer im Projekt. Außerhalb zählt
    /// die Person nicht mit (Buchungen aufs Projekt werden trotzdem
    /// abgerechnet und als „außerhalb des Teams“ markiert).
    #[serde(default)]
    pub assignments: Vec<AssignmentPeriod>,
    /// Ohne Zeiterfassung (z. B. weil der Export nicht alle Buchungen der
    /// Person enthält): nur Buchungen aufs Projekt zählen – abgerechnet nach
    /// Regel wie „darf buchen“ und in der Prognose (Auslastung); kein Soll,
    /// kein Stundenkonto, keine Prüfung auf fehlende Buchungen.
    /// (`may_book_outside` = frühere Option, wird übernommen.)
    #[serde(default, alias = "may_book_outside")]
    pub untracked: bool,
    /// Urlaubsanspruch je Kalenderjahr (für den Resturlaub).
    #[serde(default)]
    pub vacation: Vec<VacationEntitlement>,
}

/// Urlaubsanspruch eines Jahres in Tagen, dazu der Übertrag aus dem Vorjahr.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VacationEntitlement {
    pub year: i32,
    pub days: f64,
    /// Resturlaub aus dem Vorjahr (Tage).
    #[serde(default)]
    pub carry_over: f64,
}

impl TeamMember {
    /// Ist die Person an diesem Tag im Projekt eingesetzt?
    pub fn is_assigned(&self, date: NaiveDate) -> bool {
        self.assignments.is_empty()
            || self
                .assignments
                .iter()
                .any(|a| a.from <= date && a.to.is_none_or(|to| date <= to))
    }
}

/// Rolle „darf buchen“: Buchungen aufs Projekt werden nach den
/// Abrechnungsregeln (Kost2Art) mit dem eigenen Stundensatz abgerechnet; kein
/// Soll, kein Stundenkonto, keine Prüfung auf fehlende Buchungen.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Guest {
    /// Name wie in der Namensspalte des Exports.
    pub name: String,
    #[serde(default)]
    pub rates: Vec<RatePeriod>,
}

/// Geplante Abwesenheit (z. B. Urlaub), für die es noch keine Buchung gibt –
/// verringert die Arbeitszeit in der Prognose.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlannedAbsence {
    /// Teammitglied (Name wie im Team).
    pub person: String,
    pub from: NaiveDate,
    pub to: NaiveDate,
    #[serde(default)]
    pub kind: PlannedAbsenceKind,
    /// Jeweils nur halbe Tage.
    #[serde(default)]
    pub half_day: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlannedAbsenceKind {
    #[default]
    Vacation,
    /// Sonstige Abwesenheit (Schulung, Termin, …).
    Other,
}

/// Budget für einen Zeitraum ganzer Monate; Richtwert = Betrag ÷ Anzahl Monate.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BudgetPeriod {
    /// Erster Monat, z. B. "2026-01".
    pub from: String,
    /// Letzter Monat (einschließlich), z. B. "2026-12".
    pub to: String,
    /// Netto-Betrag in EUR.
    pub amount: f64,
}

impl BudgetPeriod {
    /// Erster und letzter Tag des Zeitraums; `None` bei ungültigen Monaten.
    pub fn range(&self) -> Option<(NaiveDate, NaiveDate)> {
        let from = month_start(&self.from)?;
        let to = month_start(&self.to)?;
        let last = to.checked_add_months(chrono::Months::new(1))?.pred_opt()?;
        (from <= to).then_some((from, last))
    }
}

/// "2026-03" → 01.03.2026 (genau vierstelliges Jahr und zweistelliger Monat).
pub fn month_start(month: &str) -> Option<NaiveDate> {
    let (year, month) = month.split_once('-')?;
    if year.len() != 4 || month.len() != 2 {
        return None;
    }
    NaiveDate::from_ymd_opt(year.parse().ok()?, month.parse().ok()?, 1)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AssignmentPeriod {
    pub from: NaiveDate,
    /// `None` = unbefristet.
    #[serde(default)]
    pub to: Option<NaiveDate>,
}

/// Abrechnungsregel: ordnet Buchungen anhand von Kost2Art (und Element) ein.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BillingRule {
    /// Bezeichnung der Leistung, z. B. "Delivery" oder "Reisezeit".
    pub name: String,
    /// Vergleichswert für die Kost2Art-Spalte (ohne Groß-/Kleinschreibung).
    pub kost2art: String,
    #[serde(default)]
    pub match_mode: MatchMode,
    /// Element, für das die Regel gilt; leer = Element-Filter des Projekts.
    #[serde(default)]
    pub element: String,
    /// Zählt in „Billable (h)“.
    #[serde(default = "yes")]
    pub billable_hours: bool,
    /// Wird in Rechnung gestellt (Billable €).
    #[serde(default = "yes")]
    pub invoice: bool,
    /// Abgerechnete Stunden = Stunden × Mult (sonst Stunden ohne Mult).
    #[serde(default)]
    pub apply_mult: bool,
    /// Anteil des Stundensatzes in Prozent (z. B. 50 für Reisezeit zum halben Satz).
    #[serde(default = "hundred")]
    pub rate_percent: f64,
    /// Abweichender USt.-Satz; `None` = Satz des Projekts.
    #[serde(default)]
    pub vat_percent: Option<f64>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MatchMode {
    #[default]
    Exact,
    Contains,
}

fn yes() -> bool {
    true
}

fn hundred() -> f64 {
    100.0
}

/// Standardregeln laut Spezifikation: Delivery zählt als billable Stunden und
/// wird abgerechnet; alle übrigen „(billable)“-Arten (z. B. Travel) werden nur
/// abgerechnet. Mult wird bei der Abrechnung nicht angewendet.
pub fn default_billing_rules() -> Vec<BillingRule> {
    vec![
        BillingRule {
            name: "Delivery".into(),
            kost2art: "Delivery (billable)".into(),
            match_mode: MatchMode::Exact,
            element: String::new(),
            billable_hours: true,
            invoice: true,
            apply_mult: false,
            rate_percent: 100.0,
            vat_percent: None,
        },
        BillingRule {
            name: "Sonstige billable (z. B. Travel)".into(),
            kost2art: "(billable)".into(),
            match_mode: MatchMode::Contains,
            element: String::new(),
            billable_hours: false,
            invoice: true,
            apply_mult: false,
            rate_percent: 100.0,
            vat_percent: None,
        },
    ]
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RatePeriod {
    pub from: NaiveDate,
    /// `None` = unbefristet.
    #[serde(default)]
    pub to: Option<NaiveDate>,
    /// Stundensatz in EUR.
    pub rate: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorkingHoursPeriod {
    pub from: NaiveDate,
    #[serde(default)]
    pub to: Option<NaiveDate>,
    pub hours_per_day: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HolidayConfig {
    /// Bundesland-Kürzel, z. B. "HE".
    #[serde(default = "default_region")]
    pub region: String,
    /// Zusätzliche freie Tage (z. B. Betriebsferien).
    #[serde(default)]
    pub custom: Vec<NaiveDate>,
}

impl Default for HolidayConfig {
    fn default() -> Self {
        Self {
            region: default_region(),
            custom: Vec::new(),
        }
    }
}

fn default_region() -> String {
    "HE".to_string()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExportFormat {
    #[serde(default = "default_sheet_name")]
    pub sheet_name: String,
    #[serde(default)]
    pub columns: ColumnMapping,
    #[serde(default)]
    pub special_elements: SpecialElements,
    /// Optionale Billable-Spalte: Ist sie gesetzt, entscheidet sie, ob eine
    /// Buchung aufs Projekt abgerechnet wird (Abweichungen zu den Regeln → Hinweis).
    #[serde(default)]
    pub billable: Option<BillableColumn>,
}

impl Default for ExportFormat {
    fn default() -> Self {
        Self {
            sheet_name: default_sheet_name(),
            columns: ColumnMapping::default(),
            special_elements: SpecialElements::default(),
            billable: None,
        }
    }
}

/// Billable-Spalte des Exports. Wahrheitswerte (WAHR/FALSCH bzw. TRUE/FALSE,
/// als Excel-Wahrheitswert oder Text) werden automatisch erkannt; eigene
/// Textwerte (z. B. „ja“/„nein“) sind optional. Ohne Groß-/Kleinschreibung.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BillableColumn {
    /// 0-basierter Spaltenindex (0 = Spalte A).
    pub column: usize,
    /// Eigener Textwert für „billable“ (leer = nur Wahrheitswerte).
    #[serde(default)]
    pub yes: String,
    /// Eigener Textwert für „nicht billable“ (leer = nur Wahrheitswerte).
    #[serde(default)]
    pub no: String,
}

impl BillableColumn {
    /// Bedeutung eines Zellwerts: `Some(true)` = billable, `Some(false)` =
    /// nicht billable, `None` = leer/unbekannt. Eigene Werte zuerst, dann
    /// Wahrheitswerte (WAHR/TRUE, FALSCH/FALSE); ohne Groß-/Kleinschreibung.
    pub fn meaning(&self, value: &str) -> Option<bool> {
        let value = normalized_billable(value);
        let (yes, no) = (
            normalized_billable(&self.yes),
            normalized_billable(&self.no),
        );
        match value.as_str() {
            "" => None,
            v if !yes.is_empty() && v == yes => Some(true),
            v if !no.is_empty() && v == no => Some(false),
            "wahr" => Some(true),
            "falsch" => Some(false),
            _ => None,
        }
    }

    /// Erwartete Werte für Hinweise, z. B. „WAHR/FALSCH oder „ja“/„nein““.
    pub fn expected(&self) -> String {
        let (yes, no) = (self.yes.trim(), self.no.trim());
        match (yes.is_empty(), no.is_empty()) {
            (true, true) => "WAHR oder FALSCH".to_string(),
            (false, true) => format!("WAHR, FALSCH oder „{yes}“"),
            (true, false) => format!("WAHR, FALSCH oder „{no}“"),
            (false, false) => format!("WAHR, FALSCH, „{yes}“ oder „{no}“"),
        }
    }
}

fn normalized_billable(value: &str) -> String {
    match value.trim().to_lowercase().as_str() {
        "true" => "wahr".to_string(),
        "false" => "falsch".to_string(),
        other => other.to_string(),
    }
}

fn default_sheet_name() -> String {
    "Details".to_string()
}

/// 0-basierte Spaltenindizes im Export (0 = Spalte A).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ColumnMapping {
    pub name: usize,
    pub date: usize,
    pub duration: usize,
    pub mult: usize,
    pub element: usize,
    pub kost2art: usize,
    pub location: usize,
}

impl Default for ColumnMapping {
    fn default() -> Self {
        Self {
            name: 0,
            date: 2,
            duration: 5,
            mult: 8,
            element: 9,
            kost2art: 11,
            location: 13,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SpecialElements {
    pub sick: String,
    pub vacation: String,
}

impl Default for SpecialElements {
    fn default() -> Self {
        Self {
            sick: "(Sick)".to_string(),
            vacation: "(Vacation)".to_string(),
        }
    }
}

impl ProjectConfig {
    /// Index des Teammitglieds mit diesem Namen (Groß-/Kleinschreibung und
    /// Leerzeichen am Rand werden ignoriert).
    pub fn team_index(&self, name: &str) -> Option<usize> {
        let name = name.trim();
        self.team
            .iter()
            .position(|m| m.name.trim().eq_ignore_ascii_case(name))
    }

    /// Index der Person mit der Rolle „darf buchen“ (wie `team_index`).
    pub fn guest_index(&self, name: &str) -> Option<usize> {
        let name = name.trim();
        self.guests
            .iter()
            .position(|g| g.name.trim().eq_ignore_ascii_case(name))
    }

    /// Prüft die Konfiguration auf offensichtliche Fehler.
    /// Gibt alle gefundenen Probleme auf einmal zurück.
    pub fn validate(&self) -> Result<(), String> {
        let mut errors = Vec::new();

        if self.name.trim().is_empty() {
            errors.push("Projektname darf nicht leer sein.".to_string());
        }
        if self.export_format.sheet_name.trim().is_empty() {
            errors.push("Tabellenblatt-Name darf nicht leer sein.".to_string());
        }
        if let Some(billable) = &self.export_format.billable {
            let (yes, no) = (
                normalized_billable(&billable.yes),
                normalized_billable(&billable.no),
            );
            if !yes.is_empty() && (yes == no || yes == "falsch") {
                errors.push(format!(
                    "Billable-Spalte: „{}“ kann nicht „billable“ bedeuten.",
                    billable.yes.trim()
                ));
            }
            if !no.is_empty() && no == "wahr" {
                errors.push(format!(
                    "Billable-Spalte: „{}“ kann nicht „nicht billable“ bedeuten.",
                    billable.no.trim()
                ));
            }
        }
        if !is_known_region(&self.holidays.region) {
            errors.push(format!(
                "Unbekannte Feiertags-Region „{}“ (erwartet z. B. „HE“).",
                self.holidays.region
            ));
        }
        if !(0.0..=100.0).contains(&self.missing_threshold_percent) {
            errors.push(format!(
                "Schwelle für fehlende Buchungen {} % liegt nicht zwischen 0 und 100.",
                self.missing_threshold_percent
            ));
        }
        if !(0.0..=100.0).contains(&self.vat_percent) {
            errors.push(format!(
                "Umsatzsteuersatz {} % liegt nicht zwischen 0 und 100.",
                self.vat_percent
            ));
        }

        for (i, member) in self.team.iter().enumerate() {
            if member.name.trim().is_empty() {
                errors.push("Teammitglied ohne Namen.".to_string());
            } else if self.team_index(&member.name) != Some(i) {
                errors.push(format!("{}: Person ist doppelt im Team.", member.name));
            }
            check_rates(&mut errors, &member.name, &member.rates);
            let label = format!("{}: Arbeitszeit", member.name);
            check_working_hours(&mut errors, &label, &member.working_hours);
            check_periods(
                &mut errors,
                &format!("{}: Einsatzzeitraum", member.name),
                member.assignments.iter().map(|a| (a.from, a.to)),
            );
            for (i, vacation) in member.vacation.iter().enumerate() {
                if member.vacation[..i].iter().any(|v| v.year == vacation.year) {
                    errors.push(format!(
                        "{}: Urlaubsanspruch {} ist doppelt.",
                        member.name, vacation.year
                    ));
                }
                if !(0.0..=366.0).contains(&vacation.days) || !vacation.carry_over.is_finite() {
                    errors.push(format!(
                        "{}: Urlaubsanspruch {} ist ungültig ({} Tage).",
                        member.name, vacation.year, vacation.days
                    ));
                }
            }
        }

        for (i, guest) in self.guests.iter().enumerate() {
            if guest.name.trim().is_empty() {
                errors.push("Person ohne Namen bei „darf buchen“.".to_string());
            } else if self.team_index(&guest.name).is_some() {
                errors.push(format!(
                    "{}: Person ist im Team und bei „darf buchen“ – nur eine Rolle möglich.",
                    guest.name
                ));
            } else if self.guest_index(&guest.name) != Some(i) {
                errors.push(format!(
                    "{}: Person ist doppelt bei „darf buchen“.",
                    guest.name
                ));
            }
            check_rates(&mut errors, &guest.name, &guest.rates);
        }

        check_working_hours(&mut errors, "Arbeitszeit (Projekt)", &self.working_hours);

        for absence in &self.planned_absences {
            if self.team_index(&absence.person).is_none() {
                errors.push(format!(
                    "Geplante Abwesenheit: „{}“ ist nicht im Team.",
                    absence.person
                ));
            }
        }
        for member in &self.team {
            check_periods(
                &mut errors,
                &format!("{}: geplante Abwesenheit", member.name),
                self.planned_absences
                    .iter()
                    .filter(|a| a.person.trim().eq_ignore_ascii_case(member.name.trim()))
                    .map(|a| (a.from, Some(a.to))),
            );
        }

        let mut budget_ranges = Vec::new();
        for budget in &self.budgets {
            match budget.range() {
                Some(range) => budget_ranges.push(range),
                None => errors.push(format!(
                    "Budget {} – {}: Monate ungültig (Format JJJJ-MM, Ende nicht vor Beginn).",
                    budget.from, budget.to
                )),
            }
            if budget.amount < 0.0 {
                errors.push(format!(
                    "Budget {} – {}: Betrag darf nicht negativ sein.",
                    budget.from, budget.to
                ));
            }
        }
        check_periods(
            &mut errors,
            "Budget",
            budget_ranges.into_iter().map(|(from, to)| (from, Some(to))),
        );

        for rule in &self.billing_rules {
            let label = format!("Abrechnungsregel „{}“", rule.name);
            if rule.name.trim().is_empty() {
                errors.push("Abrechnungsregel ohne Bezeichnung.".to_string());
            }
            if rule.kost2art.trim().is_empty() {
                errors.push(format!("{label}: Kost2Art darf nicht leer sein."));
            }
            if rule.rate_percent < 0.0 {
                errors.push(format!("{label}: Satz-Anteil darf nicht negativ sein."));
            }
            if let Some(vat) = rule.vat_percent
                && !(0.0..=100.0).contains(&vat)
            {
                errors.push(format!(
                    "{label}: USt. {vat} % liegt nicht zwischen 0 und 100."
                ));
            }
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join("\n"))
        }
    }
}

fn check_rates(errors: &mut Vec<String>, name: &str, rates: &[RatePeriod]) {
    let label = format!("{name}: Stundensatz");
    check_periods(errors, &label, rates.iter().map(|r| (r.from, r.to)));
    for rate in rates {
        if rate.rate < 0.0 {
            errors.push(format!("{label} darf nicht negativ sein."));
        }
    }
}

fn check_working_hours(errors: &mut Vec<String>, label: &str, periods: &[WorkingHoursPeriod]) {
    check_periods(errors, label, periods.iter().map(|p| (p.from, p.to)));
    for period in periods {
        if !(0.0..=24.0).contains(&period.hours_per_day) {
            errors.push(format!(
                "{label} ab {}: {} h/Tag liegt nicht zwischen 0 und 24.",
                period.from, period.hours_per_day
            ));
        }
    }
}

/// Zeiträume dürfen nicht rückwärts laufen und sich nicht überschneiden.
fn check_periods(
    errors: &mut Vec<String>,
    label: &str,
    periods: impl Iterator<Item = (NaiveDate, Option<NaiveDate>)>,
) {
    let mut sorted: Vec<(NaiveDate, Option<NaiveDate>)> = periods.collect();
    for &(from, to) in &sorted {
        if let Some(to) = to
            && to < from
        {
            errors.push(format!(
                "{label}: Zeitraum endet ({to}) vor dem Beginn ({from})."
            ));
        }
    }
    sorted.sort_by_key(|(from, _)| *from);
    for pair in sorted.windows(2) {
        let ((from_a, to_a), (from_b, _)) = (pair[0], pair[1]);
        if to_a.is_none_or(|to| to >= from_b) {
            errors.push(format!(
                "{label}: Zeiträume ab {from_a} und ab {from_b} überschneiden sich."
            ));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn billable_column_recognizes_booleans_and_optional_own_values() {
        assert_eq!(ExportFormat::default().billable, None);
        let format: ExportFormat =
            serde_json::from_str(r#"{ "billable": { "column": 14 } }"#).unwrap();
        let column = format.billable.clone().unwrap();
        assert_eq!(
            (column.column, column.yes.as_str(), column.no.as_str()),
            (14, "", "")
        );
        // Wahrheitswerte immer (Excel-Wahrheitswert wird als WAHR/FALSCH gelesen)
        for (value, meaning) in [
            ("WAHR", Some(true)),
            (" true ", Some(true)),
            ("falsch", Some(false)),
            ("FALSE", Some(false)),
            ("", None),
            ("ja", None),
        ] {
            assert_eq!(column.meaning(value), meaning, "{value}");
        }
        assert_eq!(column.expected(), "WAHR oder FALSCH");
        // eigene Textwerte (auch mit Umlauten und Zahlen) zusätzlich
        let own = BillableColumn {
            column: 3,
            yes: "Ja".into(),
            no: "NÖ".into(),
        };
        assert_eq!(
            (
                own.meaning("ja"),
                own.meaning("nö"),
                own.meaning("WAHR"),
                own.meaning("x")
            ),
            (Some(true), Some(false), Some(true), None)
        );
        assert_eq!(own.expected(), "WAHR, FALSCH, „Ja“ oder „NÖ“");
        let numbers = BillableColumn {
            column: 3,
            yes: "1".into(),
            no: String::new(),
        };
        assert_eq!(
            (numbers.meaning("1"), numbers.meaning("0")),
            (Some(true), None)
        );
        assert_eq!(numbers.expected(), "WAHR, FALSCH oder „1“");
        let only_no = BillableColumn {
            column: 3,
            yes: String::new(),
            no: "-".into(),
        };
        assert_eq!(only_no.expected(), "WAHR, FALSCH oder „-“");

        // Validierung: eigene Werte optional, aber widerspruchsfrei
        let mut config: ProjectConfig = serde_json::from_str(EXAMPLE).unwrap();
        config.export_format.billable = format.billable;
        config.validate().unwrap();
        for (yes, no, error) in [
            ("ja", "JA", "„ja“ kann nicht „billable“ bedeuten"),
            ("FALSE", "", "„FALSE“ kann nicht „billable“ bedeuten"),
            ("", "wahr", "„wahr“ kann nicht „nicht billable“ bedeuten"),
        ] {
            let column = config.export_format.billable.as_mut().unwrap();
            (column.yes, column.no) = (yes.into(), no.into());
            assert!(config.validate().unwrap_err().contains(error), "{yes}/{no}");
        }
    }

    #[test]
    fn without_time_tracking_takes_over_the_former_option() {
        let member = |json: &str| serde_json::from_str::<TeamMember>(json).unwrap();
        assert!(!member(r#"{ "name": "Lena Beispiel" }"#).untracked);
        assert!(member(r#"{ "name": "Lena Beispiel", "untracked": true }"#).untracked);
        // frühere Option „außerhalb des Einsatzzeitraums wie darf buchen“
        let former = member(r#"{ "name": "Lena Beispiel", "may_book_outside": true }"#);
        assert!(former.untracked);
        let saved = serde_json::to_value(&former).unwrap();
        assert_eq!(saved["untracked"], true);
        assert!(saved.get("may_book_outside").is_none());
    }

    const EXAMPLE: &str = r#"{
      "id": "6f1c2a8e-0000-4000-8000-000000000001",
      "name": "Musterkunde GmbH / Lager-App",
      "element_filter": "P100 Lager-App",
      "team": [
        { "name": "Erika Mustermann", "rates": [
            { "from": "2026-01-01", "to": "2026-06-30", "rate": 100 },
            { "from": "2026-07-01", "to": null, "rate": 105 } ] }
      ],
      "working_hours": [
        { "from": "2026-01-01", "to": "2026-06-30", "hours_per_day": 8.0 },
        { "from": "2026-07-01", "to": null, "hours_per_day": 7.5 }
      ],
      "holidays": { "region": "HE", "custom": [] },
      "export_format": {
        "sheet_name": "Details",
        "columns": { "name": 0, "date": 2, "duration": 5, "mult": 8,
                     "element": 9, "kost2art": 11, "location": 13 },
        "special_elements": { "sick": "(Sick)", "vacation": "(Vacation)" }
      }
    }"#;

    #[test]
    fn parses_example_from_spec() {
        let config: ProjectConfig = serde_json::from_str(EXAMPLE).unwrap();
        assert_eq!(config.name, "Musterkunde GmbH / Lager-App");
        assert_eq!(config.team[0].rates[1].to, None);
        assert_eq!(config.team[0].rates[1].rate, 105.0);
        assert_eq!(config.working_hours[0].hours_per_day, 8.0);
        assert_eq!(config.export_format.columns.kost2art, 11);
        assert!(config.validate().is_ok());
    }

    #[test]
    fn missing_sections_fall_back_to_defaults() {
        let config: ProjectConfig = serde_json::from_str(r#"{ "name": "Minimal" }"#).unwrap();
        assert_eq!(config.id, "");
        assert_eq!(config.export_format, ExportFormat::default());
        assert_eq!(config.holidays.region, "HE");
        assert_eq!(config.vat_percent, 19.0);
        assert_eq!(config.billing_rules, default_billing_rules());
        assert_eq!(config.missing_threshold_percent, 50.0);
    }

    #[test]
    fn billing_rule_fields_have_defaults() {
        let rule: BillingRule =
            serde_json::from_str(r#"{ "name": "Reisezeit", "kost2art": "Travel (billable)" }"#)
                .unwrap();
        assert_eq!(rule.match_mode, MatchMode::Exact);
        assert!(rule.billable_hours && rule.invoice && !rule.apply_mult);
        assert_eq!(rule.rate_percent, 100.0);
        assert_eq!(rule.vat_percent, None);
        let json = serde_json::to_string(&default_billing_rules()[1]).unwrap();
        assert!(json.contains(r#""match_mode":"contains""#), "{json}");
    }

    #[test]
    fn assignment_periods_limit_team_membership() {
        let d = |m, day| NaiveDate::from_ymd_opt(2026, m, day).unwrap();
        let mut member: TeamMember =
            serde_json::from_str(r#"{ "name": "Lena Beispiel" }"#).unwrap();
        assert!(member.assignments.is_empty());
        assert!(member.is_assigned(d(12, 31))); // leer = immer
        member.assignments = vec![
            AssignmentPeriod {
                from: d(1, 1),
                to: Some(d(2, 28)),
            },
            AssignmentPeriod {
                from: d(10, 1),
                to: None,
            },
        ];
        assert!(member.is_assigned(d(2, 28)));
        assert!(!member.is_assigned(d(3, 1)));
        assert!(member.is_assigned(d(10, 1)));

        let mut config: ProjectConfig = serde_json::from_str(EXAMPLE).unwrap();
        member.assignments.push(AssignmentPeriod {
            from: d(2, 1),
            to: Some(d(3, 31)),
        });
        config.team.push(member);
        let err = config.validate().unwrap_err();
        assert!(err.contains("Lena Beispiel: Einsatzzeitraum: Zeiträume ab 2026-01-01 und ab 2026-02-01 überschneiden sich"), "{err}");
    }

    #[test]
    fn guests_may_book_but_need_a_unique_role() {
        let mut config: ProjectConfig = serde_json::from_str(EXAMPLE).unwrap();
        assert!(config.guests.is_empty()); // fehlt in älteren Dateien
        let guest: Guest = serde_json::from_str(
            r#"{ "name": "Karl Beispiel", "rates": [{ "from": "2026-01-01", "rate": 120 }] }"#,
        )
        .unwrap();
        config.guests.push(guest.clone());
        assert!(config.validate().is_ok());
        assert_eq!(config.guest_index(" karl beispiel"), Some(0));
        assert_eq!(config.team_index("Karl Beispiel"), None);

        config.guests.push(guest);
        config.guests.push(Guest {
            name: "ERIKA Mustermann".into(),
            rates: vec![],
        });
        config.guests.push(Guest {
            name: " ".into(),
            rates: vec![RatePeriod {
                from: NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
                to: None,
                rate: -1.0,
            }],
        });
        let err = config.validate().unwrap_err();
        assert!(
            err.contains("Karl Beispiel: Person ist doppelt bei „darf buchen“"),
            "{err}"
        );
        assert!(
            err.contains("ERIKA Mustermann: Person ist im Team und bei „darf buchen“"),
            "{err}"
        );
        assert!(err.contains("Person ohne Namen bei „darf buchen“"), "{err}");
        assert!(err.contains("Stundensatz darf nicht negativ sein"), "{err}");
    }

    #[test]
    fn planned_absences_and_budgets_are_validated() {
        let mut config: ProjectConfig = serde_json::from_str(EXAMPLE).unwrap();
        assert!(config.planned_absences.is_empty() && config.budgets.is_empty());
        let d = |m, day| NaiveDate::from_ymd_opt(2026, m, day).unwrap();
        let absence: PlannedAbsence = serde_json::from_str(
            r#"{ "person": "erika mustermann", "from": "2026-11-23", "to": "2026-11-27" }"#,
        )
        .unwrap();
        assert_eq!(
            (absence.kind, absence.half_day),
            (PlannedAbsenceKind::Vacation, false)
        );
        config.planned_absences.push(absence);
        config.budgets.push(BudgetPeriod {
            from: "2026-01".into(),
            to: "2026-12".into(),
            amount: 360_000.0,
        });
        assert!(config.validate().is_ok());
        assert_eq!(config.budgets[0].range(), Some((d(1, 1), d(12, 31))));

        config.planned_absences.push(PlannedAbsence {
            person: "Erika Mustermann".into(),
            from: d(11, 27),
            to: d(11, 26),
            kind: PlannedAbsenceKind::Other,
            half_day: true,
        });
        config.planned_absences.push(PlannedAbsence {
            person: "Unbekannt".into(),
            from: d(12, 1),
            to: d(12, 1),
            kind: PlannedAbsenceKind::Other,
            half_day: false,
        });
        config.budgets.push(BudgetPeriod {
            from: "2026-12".into(),
            to: "2027-02".into(),
            amount: -1.0,
        });
        config.budgets.push(BudgetPeriod {
            from: "2026-13".into(),
            to: "2026-1".into(),
            amount: 0.0,
        });
        let err = config.validate().unwrap_err();
        assert!(err.contains("„Unbekannt“ ist nicht im Team"), "{err}");
        assert!(
            err.contains("Erika Mustermann: geplante Abwesenheit: Zeitraum endet"),
            "{err}"
        );
        assert!(err.contains("Erika Mustermann: geplante Abwesenheit: Zeiträume ab 2026-11-23 und ab 2026-11-27 überschneiden sich"), "{err}");
        assert!(
            err.contains("Budget 2026-12 – 2027-02: Betrag darf nicht negativ sein"),
            "{err}"
        );
        assert!(
            err.contains("Budget 2026-13 – 2026-1: Monate ungültig"),
            "{err}"
        );
        assert!(
            err.contains("Budget: Zeiträume ab 2026-01-01 und ab 2026-12-01 überschneiden sich"),
            "{err}"
        );
        assert_eq!(month_start("2026-02"), Some(d(2, 1)));
        assert_eq!(month_start("26-02"), None);
        let backwards = BudgetPeriod {
            from: "2026-05".into(),
            to: "2026-04".into(),
            amount: 1.0,
        };
        assert_eq!(backwards.range(), None);
    }

    #[test]
    fn vacation_entitlements_are_validated() {
        let mut config: ProjectConfig = serde_json::from_str(EXAMPLE).unwrap();
        assert!(config.team[0].vacation.is_empty());
        config.team[0].vacation = serde_json::from_str(
            r#"[{ "year": 2026, "days": 30, "carry_over": 2.5 }, { "year": 2027, "days": 28 }]"#,
        )
        .unwrap();
        assert_eq!(config.team[0].vacation[1].carry_over, 0.0);
        assert!(config.validate().is_ok());
        config.team[0].vacation.push(VacationEntitlement {
            year: 2026,
            days: -1.0,
            carry_over: 0.0,
        });
        let err = config.validate().unwrap_err();
        assert!(
            err.contains("Erika Mustermann: Urlaubsanspruch 2026 ist doppelt"),
            "{err}"
        );
        assert!(
            err.contains("Urlaubsanspruch 2026 ist ungültig (-1 Tage)"),
            "{err}"
        );
    }

    #[test]
    fn overlapping_periods_and_duplicates_are_rejected() {
        let mut config: ProjectConfig = serde_json::from_str(EXAMPLE).unwrap();
        config.working_hours[1].from = NaiveDate::from_ymd_opt(2026, 6, 1).unwrap();
        let mut copy = config.team[0].clone();
        copy.name = " erika mustermann".into();
        copy.working_hours = vec![WorkingHoursPeriod {
            from: NaiveDate::from_ymd_opt(2026, 9, 1).unwrap(),
            to: None,
            hours_per_day: 30.0,
        }];
        config.team.push(copy);
        config.billing_rules[0].kost2art = " ".into();
        config.billing_rules[1].vat_percent = Some(150.0);

        let err = config.validate().unwrap_err();
        assert!(err.contains("Arbeitszeit (Projekt): Zeiträume ab 2026-01-01 und ab 2026-06-01 überschneiden sich"), "{err}");
        assert!(err.contains("doppelt im Team"), "{err}");
        assert!(err.contains("30 h/Tag"), "{err}");
        assert!(err.contains("Kost2Art darf nicht leer sein"), "{err}");
        assert!(err.contains("USt. 150 %"), "{err}");
    }

    #[test]
    fn team_index_ignores_case_and_whitespace() {
        let config: ProjectConfig = serde_json::from_str(EXAMPLE).unwrap();
        assert_eq!(config.team_index(" erika MUSTERMANN "), Some(0));
        assert_eq!(config.team_index("Max Mustermann"), None);
    }

    #[test]
    fn roundtrip_keeps_dates_as_iso_strings() {
        let config: ProjectConfig = serde_json::from_str(EXAMPLE).unwrap();
        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains(r#""from":"2026-07-01","to":null"#));
        let back: ProjectConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(back, config);
    }

    #[test]
    fn validate_reports_all_problems() {
        let mut config: ProjectConfig = serde_json::from_str(EXAMPLE).unwrap();
        config.name = "  ".into();
        config.working_hours[0].to = NaiveDate::from_ymd_opt(2025, 12, 31);
        config.holidays.region = "XX".into();
        config.vat_percent = 120.0;
        let err = config.validate().unwrap_err();
        assert!(err.contains("Projektname"));
        assert!(err.contains("endet"));
        assert!(err.contains("Region"));
        assert!(err.contains("Umsatzsteuersatz"));
    }
}
