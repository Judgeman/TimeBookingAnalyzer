//! Auswertung: Soll/Ist, billable Stunden/EUR und Rechnungsdaten je Person.
//!
//! Vorgehen: Für jede Person und jeden Kalendertag vom 1. Januar bis zum
//! Stichtag werden die Tageswerte berechnet (inkl. Wochenenden) und dann in
//! Jahr, Monat, ISO-Kalenderwoche und Monat×Woche aufsummiert. Abgeleitete
//! Größen (Soll netto, Plus) entstehen erst auf Periodenebene.

pub mod billing;
pub mod gearb;
pub mod holidays;
pub mod invoice;
pub mod soll;

use std::collections::{BTreeMap, HashMap, HashSet};
use std::ops::AddAssign;

use chrono::{Datelike, NaiveDate, Weekday};

use crate::models::config::{ProjectConfig, TeamMember};
use crate::models::entry::TimeEntry;
use crate::models::results::{
    AbsenceKind, FlaggedBooking, InvoiceSummary, PeriodBreakdown, PeriodData, PersonResult,
};
use gearb::Absence;
use holidays::Holiday;
use invoice::{InvoiceBuilder, InvoiceItem};

pub struct Evaluation {
    pub period_start: NaiveDate,
    pub persons: Vec<PersonResult>,
    pub team: PeriodBreakdown,
    pub invoice: InvoiceSummary,
    pub holidays: Vec<Holiday>,
    pub warnings: Vec<String>,
    pub flagged: Vec<FlaggedBooking>,
}

/// Wertet alle Teammitglieder vom 1. Januar des Stichtag-Jahres bis zum
/// Stichtag aus. `export_date` (Stand des Exports) dient nur für Hinweise.
pub fn evaluate(
    config: &ProjectConfig,
    entries: &[TimeEntry],
    cutoff: NaiveDate,
    export_date: Option<NaiveDate>,
) -> Evaluation {
    let year = cutoff.year();
    let period_start = NaiveDate::from_ymd_opt(year, 1, 1).expect("1. Januar");
    let holiday_list = holidays::holidays(year, &config.holidays.region, &config.holidays.custom);
    let holiday_names: HashMap<NaiveDate, &str> = holiday_list
        .iter()
        .map(|h| (h.date, h.name.as_str()))
        .collect();
    let holiday_set: HashSet<NaiveDate> = holiday_names.keys().copied().collect();
    let is_workday = |date: NaiveDate| soll::is_workday(date, &holiday_set);
    let special = &config.export_format.special_elements;
    let filter = config.element_filter.as_str();

    let mut warnings = Vec::new();
    if config.team.is_empty() {
        warnings.push("Im Projekt ist kein Team hinterlegt – keine Personen auszuwerten.".into());
    }
    if filter.trim().is_empty()
        && config
            .billing_rules
            .iter()
            .all(|r| r.element.trim().is_empty())
    {
        warnings.push("Kein Element-Filter gesetzt – billable Stunden und EUR sind 0.".into());
    }
    if let Some(export_date) = export_date
        && cutoff > export_date
    {
        warnings.push(format!(
            "Der Stichtag {} liegt nach dem Stand des Exports ({}): Buchungen danach fehlen im Export, das Soll läuft aber bis zum Stichtag.",
            fmt_date(cutoff),
            fmt_date(export_date)
        ));
    }

    // Buchungen der Teammitglieder im Auswertungszeitraum, nach Person und Tag.
    let mut by_person: Vec<BTreeMap<NaiveDate, Vec<&TimeEntry>>> =
        vec![BTreeMap::new(); config.team.len()];
    let mut after_cutoff = 0usize;
    for entry in entries {
        let Some(index) = config.team_index(&entry.name) else {
            continue;
        };
        if entry.date > cutoff {
            after_cutoff += 1;
        } else if entry.date >= period_start {
            by_person[index].entry(entry.date).or_default().push(entry);
        }
    }
    if after_cutoff > 0 {
        warnings.push(format!(
            "{after_cutoff} Buchung(en) des Teams nach dem Stichtag {} nicht berücksichtigt.",
            fmt_date(cutoff)
        ));
    }

    let days: Vec<NaiveDate> = period_start
        .iter_days()
        .take_while(|d| *d <= cutoff)
        .collect();

    warnings.extend(missing_working_hours(config, &days, &is_workday));

    let mut invoice = InvoiceBuilder::new(config.vat_percent, cutoff);
    let mut team = BreakdownAcc::default();
    let mut persons = Vec::with_capacity(config.team.len());
    let mut flagged = Vec::new();

    for (index, member) in config.team.iter().enumerate() {
        let mut breakdown = BreakdownAcc::default();
        let mut missing_rate = Missing::default();

        for &date in &days {
            let workday = is_workday(date);
            let hpd = soll::hours_per_day_for(member, &config.working_hours, date);
            let mut day = Acc {
                soll_b: if workday { hpd.unwrap_or(0.0) } else { 0.0 },
                ..Acc::default()
            };
            let (mut raw_vacation, mut raw_sick) = (0.0, 0.0);

            for entry in by_person[index].get(&date).into_iter().flatten() {
                match gearb::absence(entry, special) {
                    Some(Absence::Vacation) => raw_vacation += entry.hours,
                    Some(Absence::Sick) => raw_sick += entry.hours,
                    None => {
                        day.gearb += gearb::worked_hours(entry);
                        let rule = billing::matching_rule(&config.billing_rules, entry, filter);
                        let in_bill_h = rule.is_some_and(|(_, r)| r.billable_hours);
                        if !in_bill_h && gearb::counts_as_work(entry.mult) {
                            day.nonbill_h += entry.hours;
                        }
                        let Some((rule_index, rule)) = rule else {
                            continue;
                        };
                        let billed = billing::billed_hours(entry, rule);
                        if rule.billable_hours {
                            day.bill_h += billed;
                        }
                        if rule.invoice {
                            let base_rate = billing::rate_for(member, date);
                            match base_rate {
                                Some(rate) => {
                                    day.bill_eur += billed * rate * rule.rate_percent / 100.0
                                }
                                None => missing_rate.add(date, billed),
                            }
                            invoice.add(InvoiceItem {
                                month: month_key(date),
                                person_index: index,
                                person: &member.name,
                                rule_index,
                                service: &rule.name,
                                base_rate,
                                rate_percent: rule.rate_percent,
                                vat_percent: rule.vat_percent.unwrap_or(config.vat_percent),
                                hours: billed,
                            });
                        }
                    }
                }
            }

            // Urlaub/Krank zählt an jedem Tag – auffällige Tage werden hervorgehoben.
            for (kind, raw) in [
                (AbsenceKind::Vacation, raw_vacation),
                (AbsenceKind::Sick, raw_sick),
            ] {
                if raw == 0.0 {
                    continue;
                }
                let (credited_days, credited_hours) =
                    soll::normalize_absence(raw, hpd.unwrap_or(0.0));
                match kind {
                    AbsenceKind::Vacation => {
                        day.vac_days += credited_days;
                        day.vac_h += credited_hours;
                    }
                    AbsenceKind::Sick => {
                        day.sick_days += credited_days;
                        day.sick_h += credited_hours;
                    }
                }
                let reasons =
                    absence_reasons(date, workday, &holiday_names, raw, credited_days, hpd);
                if !reasons.is_empty() {
                    flagged.push(FlaggedBooking {
                        person: member.name.clone(),
                        date,
                        kind,
                        hours: round2(raw),
                        credited_days,
                        credited_hours: round2(credited_hours),
                        reasons,
                    });
                }
            }

            breakdown.add_day(date, &day);
        }

        if let Some((first, last, hours)) = missing_rate.range() {
            warnings.push(format!(
                "{}: kein Stundensatz für {} billable Stunden zwischen {} und {} – nicht in EUR enthalten.",
                member.name,
                fmt_hours(hours),
                fmt_date(first),
                fmt_date(last)
            ));
        }

        team.add_all(&breakdown);
        persons.push(PersonResult {
            name: member.name.clone(),
            periods: breakdown.finish(),
        });
    }

    Evaluation {
        period_start,
        persons,
        team: team.finish(),
        invoice: invoice.finish(),
        holidays: holiday_list,
        warnings,
        flagged,
    }
}

/// Warum ein Urlaubs-/Krank-Tag hervorgehoben wird (leer = unauffällig).
fn absence_reasons(
    date: NaiveDate,
    workday: bool,
    holiday_names: &HashMap<NaiveDate, &str>,
    raw: f64,
    credited_days: f64,
    hpd: Option<f64>,
) -> Vec<String> {
    let mut reasons = Vec::new();
    if !workday {
        match date.weekday() {
            Weekday::Sat => reasons.push("Samstag".to_string()),
            Weekday::Sun => reasons.push("Sonntag".to_string()),
            _ => {}
        }
        if let Some(name) = holiday_names.get(&date) {
            reasons.push(format!("Feiertag ({name})"));
        }
    }
    if soll::is_unusual_absence(raw) {
        reasons.push(format!(
            "{} h gebucht → als {} Tag(e) angerechnet",
            fmt_hours(raw),
            fmt_hours(credited_days)
        ));
    }
    if hpd.is_none() {
        reasons.push("keine Arbeitszeit hinterlegt → 0 h angerechnet".to_string());
    }
    reasons
}

/// Hinweise zu Werktagen ohne hinterlegte Arbeitszeit – je Person, oder
/// einmal fürs Projekt, wenn alle Personen dieselben Tage betrifft.
fn missing_working_hours(
    config: &ProjectConfig,
    days: &[NaiveDate],
    is_workday: &dyn Fn(NaiveDate) -> bool,
) -> Vec<String> {
    let missing_for = |member: &TeamMember| -> Vec<NaiveDate> {
        days.iter()
            .copied()
            .filter(|d| is_workday(*d))
            .filter(|d| soll::hours_per_day_for(member, &config.working_hours, *d).is_none())
            .collect()
    };
    let describe = |dates: &[NaiveDate]| {
        format!(
            "für {} Werktag(e) zwischen {} und {} ist keine Arbeitszeit (h/Tag) hinterlegt – Soll dort 0 h.",
            dates.len(),
            fmt_date(dates[0]),
            fmt_date(dates[dates.len() - 1])
        )
    };

    let per_person: Vec<(&str, Vec<NaiveDate>)> = config
        .team
        .iter()
        .map(|m| (m.name.as_str(), missing_for(m)))
        .collect();
    let Some((_, first)) = per_person.first() else {
        return Vec::new();
    };
    if per_person.iter().all(|(_, dates)| dates == first) {
        return if first.is_empty() {
            Vec::new()
        } else {
            vec![format!("Alle Personen: {}", describe(first))]
        };
    }
    per_person
        .iter()
        .filter(|(_, dates)| !dates.is_empty())
        .map(|(name, dates)| format!("{name}: {}", describe(dates)))
        .collect()
}

/// Rohwerte eines Tages bzw. Zeitraums (ungerundet).
#[derive(Debug, Default, Clone, Copy)]
struct Acc {
    soll_b: f64,
    vac_days: f64,
    vac_h: f64,
    sick_days: f64,
    sick_h: f64,
    gearb: f64,
    bill_h: f64,
    bill_eur: f64,
    nonbill_h: f64,
}

impl AddAssign<&Acc> for Acc {
    fn add_assign(&mut self, o: &Acc) {
        self.soll_b += o.soll_b;
        self.vac_days += o.vac_days;
        self.vac_h += o.vac_h;
        self.sick_days += o.sick_days;
        self.sick_h += o.sick_h;
        self.gearb += o.gearb;
        self.bill_h += o.bill_h;
        self.bill_eur += o.bill_eur;
        self.nonbill_h += o.nonbill_h;
    }
}

impl Acc {
    fn finish(&self) -> PeriodData {
        let soll_n = self.soll_b - self.vac_h - self.sick_h;
        let plus = self.gearb - soll_n;
        PeriodData {
            soll_b: round2(self.soll_b),
            soll_n: round2(soll_n),
            vac_days: round2(self.vac_days),
            vac_h: round2(self.vac_h),
            sick_days: round2(self.sick_days),
            sick_h: round2(self.sick_h),
            gearb: round2(self.gearb),
            bill_h: round2(self.bill_h),
            bill_eur: round2(self.bill_eur),
            nonbill_h: round2(self.nonbill_h),
            plus: round2(plus),
            plus_krank: round2(plus - self.sick_h),
        }
    }
}

#[derive(Default)]
struct BreakdownAcc {
    ytd: Acc,
    months: BTreeMap<String, Acc>,
    weeks: BTreeMap<String, Acc>,
    month_weeks: BTreeMap<String, BTreeMap<String, Acc>>,
}

impl BreakdownAcc {
    fn add_day(&mut self, date: NaiveDate, day: &Acc) {
        let (month, week) = (month_key(date), week_key(date));
        self.ytd += day;
        *self.months.entry(month.clone()).or_default() += day;
        *self.weeks.entry(week.clone()).or_default() += day;
        *self
            .month_weeks
            .entry(month)
            .or_default()
            .entry(week)
            .or_default() += day;
    }

    fn add_all(&mut self, other: &BreakdownAcc) {
        self.ytd += &other.ytd;
        for (key, acc) in &other.months {
            *self.months.entry(key.clone()).or_default() += acc;
        }
        for (key, acc) in &other.weeks {
            *self.weeks.entry(key.clone()).or_default() += acc;
        }
        for (month, weeks) in &other.month_weeks {
            let target = self.month_weeks.entry(month.clone()).or_default();
            for (week, acc) in weeks {
                *target.entry(week.clone()).or_default() += acc;
            }
        }
    }

    fn finish(&self) -> PeriodBreakdown {
        let map = |m: &BTreeMap<String, Acc>| {
            m.iter()
                .map(|(k, v)| (k.clone(), v.finish()))
                .collect::<BTreeMap<_, _>>()
        };
        PeriodBreakdown {
            ytd: self.ytd.finish(),
            by_month: map(&self.months),
            by_week: map(&self.weeks),
            month_weeks: self
                .month_weeks
                .iter()
                .map(|(k, v)| (k.clone(), map(v)))
                .collect(),
        }
    }
}

#[derive(Default)]
struct Missing {
    first: Option<NaiveDate>,
    last: Option<NaiveDate>,
    hours: f64,
}

impl Missing {
    fn add(&mut self, date: NaiveDate, hours: f64) {
        self.first.get_or_insert(date);
        self.last = Some(date);
        self.hours += hours;
    }

    fn range(&self) -> Option<(NaiveDate, NaiveDate, f64)> {
        Some((self.first?, self.last?, self.hours))
    }
}

pub fn month_key(date: NaiveDate) -> String {
    format!("{:04}-{:02}", date.year(), date.month())
}

/// ISO-Kalenderwoche, z. B. "2026-W43" (Jahr = ISO-Wochenjahr).
pub fn week_key(date: NaiveDate) -> String {
    let week = date.iso_week();
    format!("{:04}-W{:02}", week.year(), week.week())
}

pub fn round2(value: f64) -> f64 {
    let rounded = (value * 100.0).round() / 100.0;
    // -0.0 vermeiden
    if rounded == 0.0 { 0.0 } else { rounded }
}

fn fmt_date(date: NaiveDate) -> String {
    date.format("%d.%m.%Y").to_string()
}

fn fmt_hours(hours: f64) -> String {
    format!("{hours:.2}").replace('.', ",")
}

#[cfg(test)]
mod tests;
