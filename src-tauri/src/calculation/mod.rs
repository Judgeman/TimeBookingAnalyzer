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

use std::collections::{BTreeMap, HashSet};
use std::ops::AddAssign;

use chrono::{Datelike, NaiveDate};

use crate::models::config::ProjectConfig;
use crate::models::entry::TimeEntry;
use crate::models::results::{InvoiceSummary, PeriodBreakdown, PeriodData, PersonResult};
use gearb::Absence;
use holidays::Holiday;
use invoice::InvoiceBuilder;

pub struct Evaluation {
    pub period_start: NaiveDate,
    pub persons: Vec<PersonResult>,
    pub team: PeriodBreakdown,
    pub invoice: InvoiceSummary,
    pub holidays: Vec<Holiday>,
    pub warnings: Vec<String>,
}

pub fn evaluate(config: &ProjectConfig, entries: &[TimeEntry], cutoff: NaiveDate) -> Evaluation {
    let year = cutoff.year();
    let period_start = NaiveDate::from_ymd_opt(year, 1, 1).expect("1. Januar");
    let holiday_list = holidays::holidays(year, &config.holidays.region, &config.holidays.custom);
    let holiday_set: HashSet<NaiveDate> = holiday_list.iter().map(|h| h.date).collect();
    let special = &config.export_format.special_elements;
    let filter = config.element_filter.as_str();

    let mut warnings = Vec::new();
    if config.team.is_empty() {
        warnings.push("Im Projekt ist kein Team hinterlegt – keine Personen auszuwerten.".into());
    }
    if filter.is_empty() {
        warnings.push("Kein Element-Filter gesetzt – billable Stunden und EUR sind 0.".into());
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

    let missing_hpd: Vec<NaiveDate> = days
        .iter()
        .copied()
        .filter(|d| soll::is_workday(*d, &holiday_set))
        .filter(|d| soll::hours_per_day(*d, &config.working_hours).is_none())
        .collect();
    if let (Some(first), Some(last)) = (missing_hpd.first(), missing_hpd.last()) {
        warnings.push(format!(
            "Für {} Werktag(e) zwischen {} und {} ist keine Arbeitszeit (h/Tag) hinterlegt – Soll dort 0 h.",
            missing_hpd.len(),
            fmt_date(*first),
            fmt_date(*last)
        ));
    }

    let mut invoice = InvoiceBuilder::new(config.vat_percent, cutoff);
    let mut team = BreakdownAcc::default();
    let mut persons = Vec::with_capacity(config.team.len());

    for (index, member) in config.team.iter().enumerate() {
        let mut breakdown = BreakdownAcc::default();
        let mut missing_rate = Missing::default();
        let mut ignored_absences = 0usize;

        for &date in &days {
            let workday = soll::is_workday(date, &holiday_set);
            let hpd = soll::hours_per_day(date, &config.working_hours).unwrap_or(0.0);
            let mut day = Acc {
                soll_b: if workday { hpd } else { 0.0 },
                ..Acc::default()
            };

            for entry in by_person[index].get(&date).into_iter().flatten() {
                match gearb::absence(entry, special) {
                    Some(kind) if workday => {
                        let (days, hours) = soll::normalize_absence(entry.hours, hpd);
                        match kind {
                            Absence::Vacation => {
                                day.vac_days += days;
                                day.vac_h += hours;
                            }
                            Absence::Sick => {
                                day.sick_days += days;
                                day.sick_h += hours;
                            }
                        }
                    }
                    Some(_) => ignored_absences += 1,
                    None => {
                        let on_project = !filter.is_empty() && entry.element == filter;
                        let delivery = billing::is_delivery(&entry.kost2art);
                        day.gearb += gearb::worked_hours(entry);
                        if on_project && delivery {
                            day.bill_h += entry.hours;
                        } else if gearb::counts_as_work(entry.mult) {
                            day.nonbill_h += entry.hours;
                        }
                        if on_project && billing::is_billable(&entry.kost2art) {
                            let rate = billing::rate_for(member, date);
                            match rate {
                                Some(rate) => day.bill_eur += entry.hours * rate,
                                None => missing_rate.add(date, entry.hours),
                            }
                            invoice.add(
                                &month_key(date),
                                index,
                                &member.name,
                                rate,
                                entry.hours,
                                delivery,
                            );
                        }
                    }
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
        if ignored_absences > 0 {
            warnings.push(format!(
                "{}: {ignored_absences} Urlaubs-/Krank-Buchung(en) an arbeitsfreien Tagen (Wochenende/Feiertag) nicht berücksichtigt.",
                member.name
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
    }
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
