//! Auswertung: Soll/Ist, billable Stunden/EUR und Rechnungsdaten je Person.
//!
//! Vorgehen: Für jede Person und jeden Kalendertag vom 1. Januar bis zum
//! Stichtag werden die Tageswerte berechnet (inkl. Wochenenden) und dann in
//! Jahr, Monat, ISO-Kalenderwoche und Monat×Woche aufsummiert. Abgeleitete
//! Größen (Soll netto, Plus) entstehen erst auf Periodenebene.

pub mod billing;
pub mod forecast;
pub mod gearb;
pub mod holidays;
pub mod invoice;
pub mod location;
pub mod soll;
pub mod vacation;

use std::collections::{BTreeMap, HashMap, HashSet};
use std::ops::AddAssign;

use chrono::{Datelike, NaiveDate, Weekday};

use crate::models::config::{BillingRule, ProjectConfig, RatePeriod, TeamMember};
use crate::models::entry::TimeEntry;
use crate::models::results::{
    AbsenceKind, CurrentMissing, FlaggedBooking, GuestBooking, InvoiceSummary, MissingBooking,
    OutsideBooking, OutsideReason, PeriodBreakdown, PeriodData, PersonResult,
};
use gearb::Absence;
use holidays::Holiday;
use invoice::{InvoiceBuilder, InvoiceItem};
use location::{LocationAcc, location_key};

pub struct Evaluation {
    pub period_start: NaiveDate,
    pub persons: Vec<PersonResult>,
    pub team: PeriodBreakdown,
    pub invoice: InvoiceSummary,
    pub holidays: Vec<Holiday>,
    pub warnings: Vec<String>,
    pub flagged: Vec<FlaggedBooking>,
    pub missing: Vec<MissingBooking>,
    pub missing_checked_until: NaiveDate,
    pub outside: Vec<OutsideBooking>,
    pub guest_bookings: Vec<GuestBooking>,
    // Für die Prognose (`forecast::build`):
    cutoff: NaiveDate,
    export_date: Option<NaiveDate>,
    /// Letzter Tag des Referenzzeitraums der Faktoren (ab 1. Januar); `None` = keiner.
    reference_to: Option<NaiveDate>,
    /// Summen je Teammitglied im Referenzzeitraum.
    references: Vec<Acc>,
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
    let mut outside = Vec::new();
    let mut guest_entries: Vec<(usize, &TimeEntry)> = Vec::new();
    let mut guest_bookings: Vec<GuestBooking> = Vec::new();
    for entry in entries {
        let Some(index) = config.team_index(&entry.name) else {
            // Buchung aufs Projekt von jemandem außerhalb des Teams: mit der
            // Rolle „darf buchen“ normal abrechnen, sonst nicht abrechenbar
            // (kein Stundensatz), aber deutlich markieren.
            if (period_start..=cutoff).contains(&entry.date)
                && gearb::absence(entry, special).is_none()
                && is_project_booking(config, entry)
            {
                match config.guest_index(&entry.name) {
                    Some(guest) => guest_entries.push((guest, entry)),
                    None => outside.push(outside_booking(entry, OutsideReason::NotInTeam)),
                }
            }
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

    // Fehlende Buchungen nur bis zum Stand des Exports prüfen – danach kann
    // der Export noch nichts enthalten.
    let export_until = export_date.or_else(|| entries.iter().map(|e| e.date).max());
    let missing_checked_until = export_until.map_or(cutoff, |d| d.min(cutoff));
    let threshold = config.missing_threshold_percent / 100.0;

    // Referenzzeitraum der Prognose-Faktoren: 1. Januar bis Ende des letzten
    // abgeschlossenen Monats vor dem ersten Prognosetag (ersatzweise bis zum
    // Stand der Daten, wenn noch kein Monat abgeschlossen ist).
    let reference_to = {
        let first_forecast_day = missing_checked_until
            .succ_opt()
            .unwrap_or(missing_checked_until);
        let month_before = first_forecast_day
            .with_day(1)
            .and_then(|d| d.pred_opt())
            .unwrap_or(period_start);
        [month_before, missing_checked_until]
            .into_iter()
            .find(|d| *d >= period_start)
    };
    let mut references = vec![Acc::default(); config.team.len()];

    // Anzeigenamen der Arbeitsorte: erste Schreibweise im Export.
    let mut location_names: HashMap<String, String> = HashMap::new();
    for entries_of_day in by_person.iter().flat_map(|days| days.values()) {
        for entry in entries_of_day {
            let (key, name) = location_key(&entry.location);
            location_names.entry(key).or_insert(name);
        }
    }

    let mut invoice = InvoiceBuilder::new(config.vat_percent, cutoff);
    let mut team = BreakdownAcc::default();
    let mut persons = Vec::with_capacity(config.team.len());
    let mut flagged = Vec::new();
    let mut missing = Vec::new();

    for (index, member) in config.team.iter().enumerate() {
        let mut breakdown = BreakdownAcc::default();
        let mut missing_rate = Missing::default();
        let mut biller = Biller {
            config,
            person: &member.name,
            rates: &member.rates,
            index,
            invoice: &mut invoice,
            missing_rate: &mut missing_rate,
        };

        for &date in &days {
            let workday = is_workday(date);
            let assigned = member.is_assigned(date);
            let hpd = soll::hours_per_day_for(member, &config.working_hours, date);
            let mut day = Acc {
                soll_b: if workday && assigned {
                    hpd.unwrap_or(0.0)
                } else {
                    0.0
                },
                ..Acc::default()
            };
            let (mut raw_vacation, mut raw_sick) = (0.0, 0.0);
            // Gebuchte Arbeitszeit ohne Mult (für die Prüfung auf fehlende Buchungen).
            let mut booked_work = 0.0;
            let mut day_locations: BTreeMap<String, f64> = BTreeMap::new();

            for entry in by_person[index].get(&date).into_iter().flatten() {
                if !assigned {
                    // Außerhalb des Einsatzzeitraums zählt die Person nicht mit –
                    // nur Buchungen aufs Projekt werden abgerechnet und markiert.
                    if gearb::absence(entry, special).is_some()
                        || !is_project_booking(config, entry)
                    {
                        continue;
                    }
                    if member.may_book_outside {
                        // wie „darf buchen“: erlaubt, abgerechnet, ohne Zeiterfassung
                        guest_bookings.push(guest_booking(&mut biller, entry));
                        continue;
                    }
                    let mut item = outside_booking(entry, OutsideReason::OutsideAssignment);
                    if let Some((rule_index, rule)) =
                        billing::matching_rule(&config.billing_rules, entry, filter)
                        && let Some((billed, net)) =
                            biller.bill_day(&mut day, entry, rule_index, rule, true)
                    {
                        item.invoiced = true;
                        item.billed_hours = round2(billed);
                        item.net = round2(net);
                    }
                    outside.push(item);
                    continue;
                }
                match gearb::absence(entry, special) {
                    Some(Absence::Vacation) => raw_vacation += entry.hours,
                    Some(Absence::Sick) => raw_sick += entry.hours,
                    None => {
                        booked_work += entry.hours;
                        let worked = gearb::worked_hours(entry);
                        day.gearb += worked;
                        if worked > 0.0 {
                            *day_locations
                                .entry(location_key(&entry.location).0)
                                .or_default() += worked;
                        }
                        let rule = billing::matching_rule(&config.billing_rules, entry, filter);
                        let in_bill_h = rule.is_some_and(|(_, r)| r.billable_hours);
                        if !in_bill_h && gearb::counts_as_work(entry.mult) {
                            day.nonbill_h += entry.hours;
                        }
                        if let Some((rule_index, rule)) = rule {
                            biller.bill_day(&mut day, entry, rule_index, rule, false);
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

            if let Some(expected) = hpd.filter(|h| *h > 0.0)
                && workday
                && assigned
                && date <= missing_checked_until
            {
                let booked = booked_work + day.vac_h + day.sick_h;
                if booked < expected * threshold - 1e-9 {
                    day.missing_days = 1.0;
                    missing.push(MissingBooking {
                        person: member.name.clone(),
                        date,
                        expected_hours: round2(expected),
                        booked_hours: round2(booked),
                        coverage_percent: round2(booked / expected * 100.0),
                    });
                }
            }

            breakdown.add_day(date, &day);
            breakdown.locations.add_day(date, &day_locations);
            if reference_to.is_some_and(|to| date <= to) {
                references[index] += &day;
            }
        }

        warnings.extend(missing_rate.warning(&member.name));

        team.add_all(&breakdown);
        persons.push(PersonResult {
            name: member.name.clone(),
            assignments: member.assignments.clone(),
            periods: breakdown.finish(&location_names),
        });
    }

    // Rolle „darf buchen“: keine Zeiterfassung, nur Abrechnung nach Regel
    // (Kost2Art) mit dem eigenen Stundensatz.
    guest_entries.sort_by_key(|(guest, entry)| (entry.date, *guest));
    let mut guest_missing_rate: Vec<Missing> =
        config.guests.iter().map(|_| Missing::default()).collect();
    for (g, entry) in guest_entries {
        let guest = &config.guests[g];
        let mut biller = Biller {
            config,
            person: &guest.name,
            rates: &guest.rates,
            index: config.team.len() + g,
            invoice: &mut invoice,
            missing_rate: &mut guest_missing_rate[g],
        };
        guest_bookings.push(guest_booking(&mut biller, entry));
    }
    for (guest, missing_rate) in config.guests.iter().zip(&guest_missing_rate) {
        warnings.extend(missing_rate.warning(&guest.name));
    }
    // nach Datum; am selben Tag Teammitglieder vor „darf buchen“
    guest_bookings.sort_by_key(|b| b.date);

    Evaluation {
        period_start,
        persons,
        team: team.finish(&location_names),
        invoice: invoice.finish(),
        holidays: holiday_list,
        warnings,
        flagged,
        missing,
        missing_checked_until,
        outside: {
            outside.sort_by(|a, b| a.date.cmp(&b.date).then_with(|| a.person.cmp(&b.person)));
            outside
        },
        guest_bookings,
        cutoff,
        export_date,
        reference_to,
        references,
    }
}

/// Fehlende Buchungen bis zum Tag vor dem Stand des Exports (`stand`) –
/// unabhängig vom Stichtag: aus der Auswertung, wenn sie diesen Zeitraum
/// abdeckt, sonst aus einer zusätzlichen Auswertung bis zu diesem Tag.
pub fn current_missing(
    config: &ProjectConfig,
    entries: &[TimeEntry],
    ev: &Evaluation,
    stand: NaiveDate,
) -> Option<CurrentMissing> {
    let until = stand.pred_opt()?;
    let covered = ev.period_start.year() == until.year() && ev.missing_checked_until >= until;
    let bookings = if covered {
        ev.missing
            .iter()
            .filter(|m| m.date <= until)
            .cloned()
            .collect()
    } else {
        evaluate(config, entries, until, ev.export_date).missing
    };
    Some(CurrentMissing {
        checked_until: until,
        bookings,
    })
}

/// Stellt Buchungen einer Person nach ihrer Abrechnungsregel in Rechnung.
struct Biller<'a, 'b> {
    config: &'a ProjectConfig,
    person: &'a str,
    rates: &'a [RatePeriod],
    /// Reihenfolge in der Rechnung (Team, danach „darf buchen“).
    index: usize,
    invoice: &'b mut InvoiceBuilder,
    missing_rate: &'b mut Missing,
}

impl Biller<'_, '_> {
    /// Rechnungsposition für eine Buchung. Liefert (abgerechnete Stunden,
    /// Netto), wenn die Regel in Rechnung gestellt wird.
    fn invoice(
        &mut self,
        entry: &TimeEntry,
        rule_index: usize,
        rule: &BillingRule,
        outside: bool,
    ) -> Option<(f64, f64)> {
        if !rule.invoice {
            return None;
        }
        let billed = billing::billed_hours(entry, rule);
        let base_rate = billing::rate_for(self.rates, entry.date);
        let net = match base_rate {
            Some(rate) => billed * rate * rule.rate_percent / 100.0,
            None => {
                self.missing_rate.add(entry.date, billed);
                0.0
            }
        };
        self.invoice.add(InvoiceItem {
            month: month_key(entry.date),
            person_index: self.index,
            person: self.person,
            rule_index,
            service: &rule.name,
            base_rate,
            rate_percent: rule.rate_percent,
            vat_percent: rule.vat_percent.unwrap_or(self.config.vat_percent),
            hours: billed,
            outside,
        });
        Some((billed, net))
    }

    /// Wie `invoice`, schreibt zusätzlich Billable (h) und (€) des Tages fort.
    fn bill_day(
        &mut self,
        day: &mut Acc,
        entry: &TimeEntry,
        rule_index: usize,
        rule: &BillingRule,
        outside: bool,
    ) -> Option<(f64, f64)> {
        if rule.billable_hours {
            day.bill_h += billing::billed_hours(entry, rule);
        }
        let result = self.invoice(entry, rule_index, rule, outside);
        if let Some((billed, net)) = result {
            day.bill_eur += net;
            if !outside {
                day.inv_h += billed * rule.rate_percent / 100.0;
            }
        }
        result
    }
}

/// Buchung auf das Projekt: passende Abrechnungsregel oder Projekt-Element.
fn is_project_booking(config: &ProjectConfig, entry: &TimeEntry) -> bool {
    let element = entry.element.trim();
    let is =
        |wanted: &str| !wanted.trim().is_empty() && element.eq_ignore_ascii_case(wanted.trim());
    billing::matching_rule(&config.billing_rules, entry, &config.element_filter).is_some()
        || is(&config.element_filter)
        || config.billing_rules.iter().any(|r| is(&r.element))
}

/// Buchung mit der Rolle „darf buchen“: nach Regel (Kost2Art) abgerechnet,
/// ohne Zeiterfassung.
fn guest_booking(biller: &mut Biller, entry: &TimeEntry) -> GuestBooking {
    let config = biller.config;
    let rule = billing::matching_rule(&config.billing_rules, entry, &config.element_filter);
    let mut booking = GuestBooking {
        person: biller.person.to_string(),
        date: entry.date,
        element: entry.element.clone(),
        kost2art: entry.kost2art.clone(),
        hours: round2(entry.hours),
        rule: rule.map(|(_, r)| r.name.clone()),
        invoiced: false,
        billed_hours: 0.0,
        net: 0.0,
    };
    if let Some((rule_index, rule)) = rule
        && let Some((billed, net)) = biller.invoice(entry, rule_index, rule, false)
    {
        booking.invoiced = true;
        booking.billed_hours = round2(billed);
        booking.net = round2(net);
    }
    booking
}

fn outside_booking(entry: &TimeEntry, reason: OutsideReason) -> OutsideBooking {
    OutsideBooking {
        person: entry.name.trim().to_string(),
        date: entry.date,
        element: entry.element.clone(),
        kost2art: entry.kost2art.clone(),
        hours: round2(entry.hours),
        reason,
        invoiced: false,
        billed_hours: 0.0,
        net: 0.0,
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
            .filter(|d| is_workday(*d) && member.is_assigned(*d))
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
    missing_days: f64,
    /// Abgerechnete Stunden zum vollen Satz (Stunden × Satz-Anteil) – nur intern
    /// für den Ablenkungsfaktor der Prognose.
    inv_h: f64,
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
        self.missing_days += o.missing_days;
        self.inv_h += o.inv_h;
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
            missing_days: self.missing_days,
        }
    }
}

#[derive(Default)]
struct BreakdownAcc {
    ytd: Acc,
    months: BTreeMap<String, Acc>,
    weeks: BTreeMap<String, Acc>,
    month_weeks: BTreeMap<String, BTreeMap<String, Acc>>,
    locations: LocationAcc,
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
        self.locations.add_all(&other.locations);
    }

    fn finish(&self, location_names: &HashMap<String, String>) -> PeriodBreakdown {
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
            locations: self.locations.finish(location_names),
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

    fn warning(&self, person: &str) -> Option<String> {
        let (first, last, hours) = self.range()?;
        Some(format!(
            "{person}: kein Stundensatz für {} billable Stunden zwischen {} und {} – nicht in EUR enthalten.",
            fmt_hours(hours),
            fmt_date(first),
            fmt_date(last)
        ))
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
