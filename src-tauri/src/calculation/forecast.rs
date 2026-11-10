//! Prognose der Rechnung und Budget-Abgleich.
//!
//! Je Teammitglied werden aus dem Referenzzeitraum (1. Januar bis Ende des
//! letzten abgeschlossenen Monats) zwei Faktoren bestimmt:
//! - Krankheitsfaktor = Krank ÷ (Soll brutto − Urlaub)
//! - Ablenkungsfaktor = 1 − abgerechnet (zum vollen Satz) ÷ gearbeitet
//!
//! Für jeden Werktag nach dem Stand der Daten gilt dann:
//! erwartete Stunden = (h/Tag − geplante Abwesenheit) × (1 − Krankheit) × (1 − Ablenkung),
//! Netto = Stunden × Stundensatz des Tages. Prognostiziert wird bis Jahresende
//! bzw. bis zum Ende des spätesten Budget-Zeitraums.
//!
//! Teammitglieder ohne Zeiterfassung (Export unvollständig) haben statt der
//! beiden Faktoren eine Auslastung = abgerechnet (zum vollen Satz) ÷ (Soll
//! brutto − Urlaub) im Einsatz: erwartete Stunden = (h/Tag − geplante
//! Abwesenheit) × Auslastung.

use std::collections::{BTreeMap, HashMap, HashSet};

use chrono::{Datelike, Months, NaiveDate};

use super::{
    Acc, Evaluation, Missing, billing, evaluate, fmt_date, fmt_hours, holidays, round2, soll,
};
use crate::models::config::{PlannedAbsence, ProjectConfig};
use crate::models::entry::TimeEntry;
use crate::models::results::{
    AccuracyMonth, BudgetStatus, Forecast, ForecastMonth, ForecastPerson, ForecastReference,
};

/// Höchstens so viele Jahre über das Stichtag-Jahr hinaus prognostizieren bzw.
/// für Budget-Zeiträume zurückrechnen.
const MAX_YEARS: i32 = 3;

pub fn build(config: &ProjectConfig, entries: &[TimeEntry], ev: &Evaluation) -> Forecast {
    build_until(config, entries, ev, None)
}

/// Prognosegüte (nachgerechnet): für jeden abgeschlossenen Monat des Jahres die
/// Prognose, die mit dem Stand am Ende des Vormonats entstanden wäre (heutige
/// Konfiguration), gegenüber dem tatsächlich abgerechneten Betrag.
pub fn backtest(
    config: &ProjectConfig,
    entries: &[TimeEntry],
    ev: &Evaluation,
) -> Vec<AccuracyMonth> {
    let data_end = ev.missing_checked_until;
    let year_start = ymd(ev.cutoff.year(), 1, 1);
    month_starts(year_start, data_end)
        .filter(|start| month_end(*start) <= data_end)
        .map(|start| {
            let before = start.pred_opt().expect("Vormonat");
            let past = evaluate(config, entries, before, Some(before));
            let forecast = build_until(config, entries, &past, Some(month_end(start)));
            let key = super::month_key(start);
            let predicted = forecast
                .months
                .iter()
                .find(|m| m.month == key)
                .map_or(0.0, |m| m.actual_net + m.forecast_net);
            let actual = ev
                .invoice
                .months
                .iter()
                .find(|m| m.month == key)
                .map_or(0.0, |m| m.net);
            AccuracyMonth {
                month: key,
                actual_net: actual,
                backtest_net: round2(predicted),
                recorded_net: None,
                recorded_on: None,
            }
        })
        .collect()
}

/// Wie [`build`], prognostiziert aber mindestens bis `min_to`.
fn build_until(
    config: &ProjectConfig,
    entries: &[TimeEntry],
    ev: &Evaluation,
    min_to: Option<NaiveDate>,
) -> Forecast {
    let data_end = ev.missing_checked_until;
    let from = data_end.succ_opt().unwrap_or(data_end);
    let year = ev.cutoff.year();
    let mut notes = Vec::new();

    let budgets: Vec<_> = config
        .budgets
        .iter()
        .filter_map(|b| b.range().map(|range| (b, range)))
        .collect();
    let wanted_to = budgets.iter().map(|(_, (_, to))| *to).fold(
        ymd(year, 12, 31).max(min_to.unwrap_or(ymd(year, 1, 1))),
        NaiveDate::max,
    );
    let limit = ymd(year + MAX_YEARS, 12, 31);
    let to = if wanted_to > limit {
        notes.push(format!(
            "Prognose nur bis {} – Budget-Zeiträume reichen weiter.",
            fmt_date(limit)
        ));
        limit
    } else {
        wanted_to
    };

    // --- Tagesprognose je Person ---
    let mut holiday_sets: HashMap<i32, HashSet<NaiveDate>> = HashMap::new();
    let mut by_month: BTreeMap<String, (f64, f64)> = BTreeMap::new();
    let mut daily: BTreeMap<NaiveDate, f64> = BTreeMap::new();
    let mut persons = Vec::with_capacity(config.team.len());

    for (member, reference) in config.team.iter().zip(&ev.references) {
        let utilization = member.untracked.then(|| utilization(reference));
        let (sick, distraction) = if member.untracked {
            (0.0, 0.0)
        } else {
            factors(reference)
        };
        let absences: Vec<&PlannedAbsence> = config
            .planned_absences
            .iter()
            .filter(|a| a.person.trim().eq_ignore_ascii_case(member.name.trim()))
            .collect();
        let mut sums = PersonSums::default();
        let mut missing_rate = Missing::default();

        for day in from.iter_days().take_while(|d| *d <= to) {
            let holidays = holiday_sets.entry(day.year()).or_insert_with(|| {
                holidays::holidays(day.year(), &config.holidays.region, &config.holidays.custom)
                    .into_iter()
                    .map(|h| h.date)
                    .collect()
            });
            if !soll::is_workday(day, holidays) || !member.is_assigned(day) {
                continue;
            }
            let Some(hpd) =
                soll::hours_per_day_for(member, &config.working_hours, day).filter(|h| *h > 0.0)
            else {
                continue;
            };
            let (absent_hours, absent_days) = absences
                .iter()
                .find(|a| a.from <= day && day <= a.to)
                .map_or((0.0, 0.0), |a| {
                    if a.half_day {
                        (hpd / 2.0, 0.5)
                    } else {
                        (hpd, 1.0)
                    }
                });
            let hours =
                (hpd - absent_hours) * utilization.unwrap_or((1.0 - sick) * (1.0 - distraction));
            let net = match billing::rate_for(&member.rates, day) {
                Some(rate) => hours * rate,
                None => {
                    if hours > 0.0 {
                        missing_rate.add(day, hours);
                    }
                    0.0
                }
            };
            sums.contract += hpd;
            sums.absent_hours += absent_hours;
            sums.absent_days += absent_days;
            sums.hours += hours;
            sums.net += net;
            let month = by_month.entry(super::month_key(day)).or_default();
            month.0 += net;
            month.1 += hours;
            *daily.entry(day).or_default() += net;
        }

        if let Some((first, last, hours)) = missing_rate.range() {
            notes.push(format!(
                "Prognose: {} hat zwischen {} und {} keinen Stundensatz – {} h mit 0 € angesetzt.",
                member.name,
                fmt_date(first),
                fmt_date(last),
                fmt_hours(hours)
            ));
        }
        if member.untracked && reference.soll_b - reference.vac_h <= 0.0 && sums.contract > 0.0 {
            notes.push(format!(
                "Prognose: {} (ohne Zeiterfassung) hat noch keine Zeit im Einsatz im Referenzzeitraum – volle Arbeitszeit angesetzt.",
                member.name
            ));
        }
        persons.push(ForecastPerson {
            name: member.name.clone(),
            sick_factor: round4(sick),
            distraction_factor: round4(distraction),
            utilization: utilization.map(round4),
            reference: ForecastReference {
                available_hours: round2(reference.soll_b - reference.vac_h),
                sick_hours: round2(reference.sick_h),
                worked_hours: round2(reference.gearb),
                invoiced_hours: round2(reference.inv_h),
            },
            contract_hours: round2(sums.contract),
            planned_absence_hours: round2(sums.absent_hours),
            planned_absence_days: round2(sums.absent_days),
            hours: round2(sums.hours),
            net: round2(sums.net),
        });
    }

    if ev.reference_to.is_none() {
        notes.push(
            "Noch keine Buchungen im Jahr – Prognose ohne Krankheits- und Ablenkungsfaktor."
                .to_string(),
        );
    }
    if !config.guests.is_empty() {
        notes.push(
            "Personen mit „darf buchen“ werden nicht prognostiziert – nur ihre bereits abgerechneten Buchungen zählen."
                .to_string(),
        );
    }

    // --- Ist je Monat (Rechnung), bei Budgets vor dem Jahr aus früheren Jahren ---
    let mut actual: BTreeMap<String, (f64, f64)> = ev
        .invoice
        .months
        .iter()
        .map(|m| (m.month.clone(), (m.net, m.hours)))
        .collect();
    let first = budgets
        .iter()
        .map(|(_, (from, _))| *from)
        .fold(ymd(year, 1, 1), NaiveDate::min)
        .max(ymd(year - MAX_YEARS, 1, 1));
    for earlier in first.year()..year {
        let past = evaluate(config, entries, ymd(earlier, 12, 31), ev.export_date);
        actual.extend(
            past.invoice
                .months
                .into_iter()
                .map(|m| (m.month, (m.net, m.hours))),
        );
    }

    let months = month_starts(first, to)
        .map(|start| {
            let key = super::month_key(start);
            let (actual_net, actual_hours) = actual.get(&key).copied().unwrap_or_default();
            let (forecast_net, forecast_hours) = by_month.get(&key).copied().unwrap_or_default();
            ForecastMonth {
                month: key,
                actual_net: round2(actual_net),
                actual_hours: round2(actual_hours),
                forecast_net: round2(forecast_net),
                forecast_hours: round2(forecast_hours),
            }
        })
        .collect::<Vec<_>>();

    // --- Budget-Zeiträume ---
    let budgets = budgets
        .into_iter()
        .map(|(budget, (start, end))| {
            let in_period: Vec<&ForecastMonth> = months
                .iter()
                .filter(|m| {
                    let key = m.month.as_str();
                    key >= budget.from.as_str() && key <= budget.to.as_str()
                })
                .collect();
            let month_count = month_starts(start, end).count() as u32;
            let monthly_target = budget.amount / f64::from(month_count);
            let actual_net: f64 = in_period.iter().map(|m| m.actual_net).sum();
            let forecast_net: f64 = in_period.iter().map(|m| m.forecast_net).sum();
            let exceeded = actual_net > budget.amount;
            // Budget schon vor dem ersten Prognosetag beendet → keine Prognose mehr darin
            let exhausted_on = if exceeded || from.max(start) > end {
                None
            } else {
                let mut total = actual_net;
                daily
                    .range(from.max(start)..=end)
                    .find(|(_, net)| {
                        total += **net;
                        total >= budget.amount
                    })
                    .map(|(day, _)| *day)
            };
            BudgetStatus {
                from: budget.from.clone(),
                to: budget.to.clone(),
                amount: round2(budget.amount),
                monthly_target: round2(monthly_target),
                month_count,
                target_to_date: round2(target_to_date(start, end, data_end, monthly_target)),
                actual_net: round2(actual_net),
                forecast_net: round2(forecast_net),
                expected_net: round2(actual_net + forecast_net),
                deviation: round2(actual_net + forecast_net - budget.amount),
                exhausted_on,
                exceeded,
            }
        })
        .collect();

    Forecast {
        from,
        to,
        reference_from: ev.period_start,
        reference_to: ev.reference_to,
        persons,
        months,
        budgets,
        notes,
    }
}

#[derive(Default)]
struct PersonSums {
    contract: f64,
    absent_hours: f64,
    absent_days: f64,
    hours: f64,
    net: f64,
}

/// Auslastung ohne Zeiterfassung: abgerechnet (voller Satz) ÷ (Soll − Urlaub)
/// im Referenzzeitraum, 0…1; ohne Zeit im Einsatz 1 (volle Arbeitszeit).
fn utilization(reference: &Acc) -> f64 {
    let available = reference.soll_b - reference.vac_h;
    if available > 0.0 {
        (reference.inv_h / available).clamp(0.0, 1.0)
    } else {
        1.0
    }
}

/// (Krankheitsfaktor, Ablenkungsfaktor) aus den Summen des Referenzzeitraums.
fn factors(reference: &Acc) -> (f64, f64) {
    let available = reference.soll_b - reference.vac_h;
    let sick = if available > 0.0 {
        (reference.sick_h / available).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let distraction = if reference.gearb > 0.0 {
        (1.0 - reference.inv_h / reference.gearb).clamp(0.0, 1.0)
    } else {
        0.0
    };
    (sick, distraction)
}

/// Richtwert bis zum Stand der Daten: volle Monate + anteilig der laufende Monat.
fn target_to_date(start: NaiveDate, end: NaiveDate, data_end: NaiveDate, monthly: f64) -> f64 {
    if data_end < start {
        return 0.0;
    }
    if data_end >= end {
        return monthly * month_starts(start, end).count() as f64;
    }
    let current = data_end.with_day(1).expect("Monatsanfang");
    let full = month_starts(start, current).count() as f64 - 1.0;
    let days_in_month = current
        .checked_add_months(Months::new(1))
        .map_or(30, |next| (next - current).num_days()) as f64;
    monthly * (full + f64::from(data_end.day()) / days_in_month)
}

/// Monatsanfänge von `from` bis `to` (jeweils der Monat des Datums).
fn month_starts(from: NaiveDate, to: NaiveDate) -> impl Iterator<Item = NaiveDate> {
    let first = from.with_day(1).expect("Monatsanfang");
    std::iter::successors(Some(first), |m| m.checked_add_months(Months::new(1)))
        .take_while(move |m| *m <= to)
}

/// Letzter Tag des Monats von `start`.
fn month_end(start: NaiveDate) -> NaiveDate {
    start
        .with_day(1)
        .and_then(|first| first.checked_add_months(Months::new(1)))
        .and_then(|next| next.pred_opt())
        .expect("Monatsende")
}

fn ymd(year: i32, month: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(year, month, day).expect("gültiges Datum")
}

fn round4(value: f64) -> f64 {
    (value * 10_000.0).round() / 10_000.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::config::{
        BudgetPeriod, ExportFormat, Guest, HolidayConfig, PlannedAbsenceKind, RatePeriod,
        TeamMember, WorkingHoursPeriod, default_billing_rules,
    };

    const ERIKA: &str = "Erika Mustermann";

    fn d(m: u32, day: u32) -> NaiveDate {
        ymd(2026, m, day)
    }

    fn entry(date: NaiveDate, hours: f64, element: &str, kost2art: &str) -> TimeEntry {
        TimeEntry {
            name: ERIKA.into(),
            date,
            hours,
            mult: 1.0,
            element: element.into(),
            kost2art: kost2art.into(),
            location: String::new(),
            billable: None,
        }
    }

    fn config() -> ProjectConfig {
        ProjectConfig {
            id: "p".into(),
            name: "Musterkunde GmbH / Lager-App".into(),
            element_filter: "P100 Lager-App".into(),
            team: vec![TeamMember {
                name: ERIKA.into(),
                rates: vec![RatePeriod {
                    from: d(1, 1),
                    to: None,
                    rate: 100.0,
                }],
                working_hours: vec![],
                assignments: vec![],
                untracked: false,
                vacation: vec![],
            }],
            guests: vec![],
            working_hours: vec![WorkingHoursPeriod {
                from: d(1, 1),
                to: None,
                hours_per_day: 8.0,
            }],
            holidays: HolidayConfig::default(), // Hessen
            export_format: ExportFormat::default(),
            vat_percent: 19.0,
            billing_rules: default_billing_rules(),
            missing_threshold_percent: 50.0,
            planned_absences: vec![
                PlannedAbsence {
                    person: "erika mustermann".into(),
                    from: d(2, 20),
                    to: d(2, 20),
                    kind: PlannedAbsenceKind::Other,
                    half_day: true,
                },
                PlannedAbsence {
                    person: ERIKA.into(),
                    from: d(2, 23),
                    to: d(2, 27),
                    kind: PlannedAbsenceKind::Vacation,
                    half_day: false,
                },
            ],
            budgets: vec![BudgetPeriod {
                from: "2026-01".into(),
                to: "2026-03".into(),
                amount: 30_000.0,
            }],
        }
    }

    /// Januar (Referenz): 21 Werktage à 8 h = 168 h Soll; 02.01. Urlaub,
    /// 05./06.01. krank, an den übrigen 18 Tagen 6 h Delivery + 2 h intern.
    /// Februar bis Freitag 13.02. (Stand): 10 Tage à 8 h Delivery.
    fn entries() -> Vec<TimeEntry> {
        let mut entries = vec![
            entry(d(1, 2), 8.0, "(Vacation)", ""),
            entry(d(1, 5), 8.0, "(Sick)", ""),
            entry(d(1, 6), 8.0, "(Sick)", ""),
        ];
        let holidays: HashSet<NaiveDate> = [d(1, 1)].into();
        for day in d(1, 7).iter_days().take_while(|day| *day <= d(1, 31)) {
            if soll::is_workday(day, &holidays) {
                entries.push(entry(day, 6.0, "P100 Lager-App", "Delivery (billable)"));
                entries.push(entry(day, 2.0, "Z900 Intern", "Internal"));
            }
        }
        for day in d(2, 1).iter_days().take_while(|day| *day <= d(2, 13)) {
            if soll::is_workday(day, &holidays) {
                entries.push(entry(day, 8.0, "P100 Lager-App", "Delivery (billable)"));
            }
        }
        entries
    }

    fn run(config: &ProjectConfig) -> Forecast {
        let entries = entries();
        let ev = evaluate(config, &entries, d(2, 13), Some(d(2, 13)));
        build(config, &entries, &ev)
    }

    #[test]
    fn hand_calculated_forecast_and_budget() {
        let forecast = run(&config());
        assert_eq!((forecast.from, forecast.to), (d(2, 14), d(12, 31)));
        assert_eq!(forecast.reference_to, Some(d(1, 31)));

        let erika = &forecast.persons[0];
        // verfügbar 168 − 8 Urlaub = 160 h, davon 16 h krank → 10 %
        assert_eq!(erika.sick_factor, 0.1);
        // gearbeitet 18 × 8 = 144 h, abgerechnet 18 × 6 = 108 h → 25 % Ablenkung
        assert_eq!(erika.distraction_factor, 0.25);
        assert_eq!(
            erika.reference,
            ForecastReference {
                available_hours: 160.0,
                sick_hours: 16.0,
                worked_hours: 144.0,
                invoiced_hours: 108.0,
            }
        );
        // geplant abwesend: 20.02. halb (4 h), 23.–27.02. (40 h)
        assert_eq!(
            (erika.planned_absence_days, erika.planned_absence_hours),
            (5.5, 44.0)
        );

        let month = |key: &str| forecast.months.iter().find(|m| m.month == key).unwrap();
        assert_eq!(forecast.months[0].month, "2026-01");
        assert_eq!(forecast.months.len(), 12);
        assert_eq!(
            (month("2026-01").actual_net, month("2026-01").actual_hours),
            (10_800.0, 108.0)
        );
        // Februar: Ist 80 h; Rest 16.–20.02. = 4 × 8 + 4 = 36 h × 0,9 × 0,75 = 24,3 h
        let feb = month("2026-02");
        assert_eq!(
            (feb.actual_net, feb.forecast_hours, feb.forecast_net),
            (8_000.0, 24.3, 2_430.0)
        );
        // März: 22 Werktage × 8 h × 0,675 = 118,8 h
        assert_eq!(
            (
                month("2026-03").forecast_hours,
                month("2026-03").forecast_net
            ),
            (118.8, 11_880.0)
        );
        let total_hours: f64 = forecast.months.iter().map(|m| m.forecast_hours).sum();
        assert!(
            (total_hours - erika.hours).abs() < 0.05,
            "{total_hours} vs {}",
            erika.hours
        );

        let budget = &forecast.budgets[0];
        assert_eq!((budget.month_count, budget.monthly_target), (3, 10_000.0));
        // Januar voll + 13/28 Februar
        assert_eq!(budget.target_to_date, 14_642.86);
        assert_eq!(
            (budget.actual_net, budget.forecast_net),
            (18_800.0, 14_310.0)
        );
        assert_eq!((budget.expected_net, budget.deviation), (33_110.0, 3_110.0));
        assert!(!budget.exceeded);
        // 21.230 € nach dem 20.02., dann 540 €/Werktag → 17. Werktag im März
        assert_eq!(budget.exhausted_on, Some(d(3, 24)));
        assert!(forecast.notes.is_empty(), "{:?}", forecast.notes);
    }

    #[test]
    fn exceeded_budget_earlier_years_and_notes() {
        let mut config = config();
        config.budgets = vec![
            BudgetPeriod {
                from: "2025-12".into(),
                to: "2026-01".into(),
                amount: 10_000.0,
            },
            BudgetPeriod {
                from: "2026-02".into(),
                to: "2030-12".into(),
                amount: 1_000_000.0,
            },
        ];
        config.team[0].rates[0].to = Some(d(6, 30)); // danach kein Satz
        config.guests.push(Guest {
            name: "Karl Beispiel".into(),
            rates: vec![],
        });
        let forecast = run(&config);

        // Budget-Beginn im Vorjahr → Monate ab Dezember 2025 (ohne Buchungen)
        assert_eq!(forecast.months[0].month, "2025-12");
        assert_eq!(forecast.months[0].actual_net, 0.0);
        let past = &forecast.budgets[0];
        assert!(past.exceeded);
        assert_eq!(
            (past.actual_net, past.forecast_net, past.deviation),
            (10_800.0, 0.0, 800.0)
        );
        assert_eq!((past.exhausted_on, past.target_to_date), (None, 10_000.0));

        // Prognose höchstens 3 Jahre über das Stichtag-Jahr hinaus
        assert_eq!(forecast.to, ymd(2029, 12, 31));
        let long = &forecast.budgets[1];
        assert_eq!(long.month_count, 59);
        // ab Juli kein Stundensatz → 0 €
        let july = forecast
            .months
            .iter()
            .find(|m| m.month == "2026-07")
            .unwrap();
        assert!(july.forecast_hours > 0.0 && july.forecast_net == 0.0);
        let notes = forecast.notes.join("\n");
        assert!(notes.contains("Prognose nur bis 31.12.2029"), "{notes}");
        assert!(
            notes.contains("Erika Mustermann hat zwischen 01.07.2026 und"),
            "{notes}"
        );
        assert!(
            notes.contains("„darf buchen“ werden nicht prognostiziert"),
            "{notes}"
        );
    }

    #[test]
    fn backtest_compares_the_forecast_at_month_start_with_the_actual_month() {
        let config = config();
        let entries = entries();
        // Stand 28.02.: Januar und Februar abgeschlossen (Buchungen bis 13.02.)
        let ev = evaluate(&config, &entries, d(2, 28), Some(d(2, 28)));
        let months = backtest(&config, &entries, &ev);
        let rows: Vec<(&str, f64, f64)> = months
            .iter()
            .map(|m| (m.month.as_str(), m.actual_net, m.backtest_net))
            .collect();
        assert_eq!(
            rows,
            vec![
                // Januar: Stand 31.12.2025, keine Vorjahresdaten → Faktoren 0:
                // 21 Werktage × 8 h × 100 €
                ("2026-01", 10_800.0, 16_800.0),
                // Februar: Faktoren aus Januar (0,9 × 0,75); 20 Werktage × 8 h
                // − 44 h geplant abwesend = 116 h × 0,675 = 78,3 h × 100 €
                ("2026-02", 8_000.0, 7_830.0),
            ]
        );
        assert!(months.iter().all(|m| m.recorded_net.is_none()));
    }

    #[test]
    fn without_bookings_in_the_year_the_factors_are_zero() {
        let config = config();
        let ev = evaluate(&config, &[], d(1, 10), Some(d(1, 10)));
        let forecast = build(&config, &[], &ev);
        // Stand 10.01. → Referenz 01.–10.01. (kein Monat abgeschlossen), ohne Buchungen
        assert_eq!(forecast.reference_to, Some(d(1, 10)));
        assert_eq!(forecast.persons[0].sick_factor, 0.0);
        assert_eq!(forecast.persons[0].distraction_factor, 0.0);

        // Stand vor dem Jahr (Export vom Dezember) → kein Referenzzeitraum
        let ev = evaluate(&config, &[], d(1, 10), Some(ymd(2025, 12, 31)));
        let forecast = build(&config, &[], &ev);
        assert_eq!((forecast.reference_to, forecast.from), (None, d(1, 1)));
        assert!(forecast.notes[0].contains("Noch keine Buchungen im Jahr"));
        // ganzer Januar: 21 Werktage (01.01. Feiertag) × 8 h × 100 €
        let jan = &forecast.months[0];
        assert_eq!((jan.forecast_hours, jan.forecast_net), (168.0, 16_800.0));
    }
}
