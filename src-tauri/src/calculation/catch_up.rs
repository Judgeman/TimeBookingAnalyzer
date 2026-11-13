//! Aufholen bis Jahresende im Stundenkonto „Krankheit als Fehlzeit“
//! (Saldo = `plus_krank`): Wie viele Stunden je Arbeitstag müssen Personen bzw.
//! das Team ab dem Tag nach dem Stichtag bis zum 31.12. zusätzlich leisten, um
//! auf 100 % Erfüllung zu kommen?
//!
//! Arbeitstage einer Person = Werktage (Mo–Fr ohne Feiertag) im Einsatz mit
//! h/Tag > 0 − geplante Abwesenheiten (alle Arten, ½ Tag = 0,5) − offener
//! Urlaub (Anspruch + Übertrag − genommen bis Stichtag − im Zeitraum geplant;
//! ohne Anspruch für das Jahr: 0). Urlaubstage verringern das Soll, an ihnen
//! wird nichts aufgeholt. Annahme: keine weitere Krankheit.
//!
//! Team: Saldo = Summe aller Personen (Überstunden gleichen Fehlstunden aus);
//! der Fehlbetrag wird gleichmäßig auf alle Personen-Arbeitstage verteilt.
//!
//! Budget: Was lässt sich mit dem Budget aufholen, in dem der erste Tag liegt?
//! Rest = Budget − (abgerechnet + Prognose bis Budgetende). Aufgeholt werden
//! kann bis min(Budgetende, 31.12.); nachgeholte Stunden kosten den vollen
//! Stundensatz (Ø je Personen-Arbeitstag). Offener Urlaub wird anteilig auf die
//! Arbeitstage vor und nach dem Budgetende verteilt.

use std::collections::{HashMap, HashSet};

use chrono::{Datelike, NaiveDate};

use super::{Evaluation, billing, round2, soll};
use crate::models::config::{BudgetPeriod, PlannedAbsenceKind, ProjectConfig, TeamMember};
use crate::models::results::{BudgetStatus, CatchUp, CatchUpBudget, CatchUpPerson, CatchUpTeam};

/// Unterhalb davon gilt ein Saldo als ausgeglichen (Rundung auf Cent-Stunden).
const EPSILON: f64 = 0.005;

/// Arbeitstage einer Person bis zum Budgetende (für [`CatchUpBudget`]).
#[derive(Default)]
struct BudgetDays {
    /// Arbeitstage bis zum Budgetende (offener Urlaub anteilig abgezogen).
    available: f64,
    /// Σ Stundensatz × Arbeitstag bis zum Budgetende (ebenso anteilig).
    rate_days: f64,
}

/// `budgets` = Budget-Status der Prognose (Ist + Prognose je Budget).
pub fn catch_up(config: &ProjectConfig, ev: &Evaluation, budgets: &[BudgetStatus]) -> CatchUp {
    let year = ev.cutoff.year();
    let to = NaiveDate::from_ymd_opt(year, 12, 31).unwrap_or(ev.cutoff);
    let from = ev.cutoff.succ_opt().unwrap_or(ev.cutoff);
    let holidays: HashSet<NaiveDate> = ev.holidays.iter().map(|h| h.date).collect();
    let workdays: Vec<NaiveDate> = if from > ev.cutoff && from <= to {
        from.iter_days()
            .take_while(|d| *d <= to)
            .filter(|d| soll::is_workday(*d, &holidays))
            .collect()
    } else {
        Vec::new()
    };

    // Budget, in dem der erste Tag liegt
    let budget = (!workdays.is_empty())
        .then(|| {
            budgets.iter().find_map(|status| {
                let period = BudgetPeriod {
                    from: status.from.clone(),
                    to: status.to.clone(),
                    amount: status.amount,
                };
                let (start, end) = period.range()?;
                (start <= from && from <= end).then_some((status, end.min(to)))
            })
        })
        .flatten();
    let until = budget.map(|(_, until)| until);

    let (mut persons, budget_days): (Vec<CatchUpPerson>, Vec<BudgetDays>) = ev
        .persons
        .iter()
        .filter_map(|person| {
            let member = config.team.iter().find(|m| m.name == person.name)?;
            Some(person_catch_up(
                config,
                member,
                person.periods.ytd.plus_krank,
                person.periods.ytd.vac_days,
                &workdays,
                until,
            ))
        })
        .unzip();

    // Team: Fehlbetrag (netto) gleichmäßig je Personen-Arbeitstag verteilen
    let balance = ev.team.ytd.plus_krank;
    let deficit = if balance < -EPSILON { -balance } else { 0.0 };
    let person_days: f64 = persons.iter().map(|p| p.available_days).sum();
    let per_person_day = (person_days > 0.0).then(|| deficit / person_days);
    for p in &mut persons {
        p.team_share = round2(per_person_day.unwrap_or(0.0) * p.available_days);
    }
    let team = CatchUpTeam {
        balance: round2(balance),
        deficit: round2(deficit),
        available_days: round2(person_days),
        extra_per_workday: (!workdays.is_empty()).then(|| round2(deficit / workdays.len() as f64)),
        extra_per_person_day: per_person_day.map(round2),
    };

    let budget = budget.map(|(status, until)| {
        let workdays = workdays.iter().filter(|d| **d <= until).count();
        let available: f64 = budget_days.iter().map(|b| b.available).sum();
        let rate_days: f64 = budget_days.iter().map(|b| b.rate_days).sum();
        let average_rate = (available > 0.0).then(|| rate_days / available);
        let remaining = status.amount - status.expected_net;
        // ohne Stundensatz kostet Aufholen kein Budget
        let affordable = average_rate
            .filter(|rate| *rate > 0.0)
            .map(|rate| remaining.max(0.0) / rate);
        let covered = if available > 0.0 {
            affordable.map_or(deficit, |hours| hours.min(deficit))
        } else {
            0.0
        };
        CatchUpBudget {
            from: status.from.clone(),
            to: status.to.clone(),
            amount: status.amount,
            expected_net: status.expected_net,
            remaining: round2(remaining),
            until,
            workdays: workdays as u32,
            available_days: round2(available),
            average_rate: average_rate.map(round2),
            affordable_hours: affordable.map(round2),
            covered_hours: round2(covered),
            covered_net: round2(covered * average_rate.unwrap_or(0.0)),
            uncovered_hours: round2(deficit - covered),
            extra_per_workday: (workdays > 0).then(|| round2(covered / workdays as f64)),
            extra_per_person_day: (available > 0.0).then(|| round2(covered / available)),
        }
    });

    CatchUp {
        from,
        to,
        workdays: workdays.len() as u32,
        persons,
        team,
        budget,
    }
}

fn person_catch_up(
    config: &ProjectConfig,
    member: &TeamMember,
    balance: f64,
    vacation_taken: f64,
    workdays: &[NaiveDate],
    budget_until: Option<NaiveDate>,
) -> (CatchUpPerson, BudgetDays) {
    // Geplante Abwesenheiten je Tag (je Person ohne Überschneidung; sicherheitshalber max.)
    let mut planned: HashMap<NaiveDate, (f64, bool)> = HashMap::new();
    for absence in config
        .planned_absences
        .iter()
        .filter(|a| a.person.trim().eq_ignore_ascii_case(member.name.trim()))
    {
        let share = if absence.half_day { 0.5 } else { 1.0 };
        let vacation = absence.kind == PlannedAbsenceKind::Vacation;
        for day in absence.from.iter_days().take_while(|d| *d <= absence.to) {
            let entry = planned.entry(day).or_insert((0.0, vacation));
            if share > entry.0 {
                *entry = (share, vacation);
            }
        }
    }

    let mut days = 0.0;
    let mut contract_hours = 0.0;
    let mut planned_days = 0.0;
    let mut planned_vacation = 0.0;
    // bis zum Budgetende: Tage ohne geplante Abwesenheit, gewichtet mit dem Satz
    let mut window = BudgetDays::default();
    for day in workdays {
        let (absent, vacation) = planned.get(day).copied().unwrap_or((0.0, false));
        // geplanter Urlaub zählt wie im Resturlaub an jedem Werktag
        if vacation {
            planned_vacation += absent;
        }
        if !member.is_assigned(*day) {
            continue;
        }
        let hpd = soll::hours_per_day_for(member, &config.working_hours, *day).unwrap_or(0.0);
        if hpd <= 0.0 {
            continue;
        }
        days += 1.0;
        contract_hours += hpd;
        planned_days += absent;
        if budget_until.is_some_and(|until| *day <= until) {
            let present = 1.0 - absent;
            window.available += present;
            window.rate_days += present * billing::rate_for(&member.rates, *day).unwrap_or(0.0);
        }
    }

    let year = workdays.first().map(|d| d.year());
    let entitlement = year.and_then(|y| member.vacation.iter().find(|v| v.year == y));
    let open_vacation = entitlement
        .map(|v| (v.days + v.carry_over - vacation_taken - planned_vacation).max(0.0))
        .unwrap_or(0.0)
        .min((days - planned_days).max(0.0));
    let available_days = (days - planned_days - open_vacation).max(0.0);
    let deficit = if balance < -EPSILON { -balance } else { 0.0 };
    // offenen Urlaub anteilig auf die Tage vor und nach dem Budgetende verteilen
    let present = days - planned_days;
    let factor = if present > 0.0 {
        available_days / present
    } else {
        0.0
    };
    window.available *= factor;
    window.rate_days *= factor;

    let person = CatchUpPerson {
        person: member.name.clone(),
        balance: round2(balance),
        deficit: round2(deficit),
        workdays: days,
        hours_per_day: if days > 0.0 {
            round2(contract_hours / days)
        } else {
            0.0
        },
        planned_days: round2(planned_days),
        open_vacation_days: round2(open_vacation),
        has_entitlement: entitlement.is_some(),
        available_days: round2(available_days),
        extra_per_day: (available_days > 0.0).then(|| round2(deficit / available_days)),
        team_share: 0.0,
    };
    (person, window)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::calculation::evaluate;
    use crate::models::config::{
        AssignmentPeriod, ExportFormat, HolidayConfig, PlannedAbsence, RatePeriod,
        VacationEntitlement, WorkingHoursPeriod, default_billing_rules,
    };
    use crate::models::entry::TimeEntry;

    fn d(m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, m, day).unwrap()
    }

    fn member(name: &str) -> TeamMember {
        TeamMember {
            name: name.into(),
            rates: vec![],
            working_hours: vec![],
            assignments: vec![],
            untracked: false,
            vacation: vec![],
        }
    }

    fn work(name: &str, date: NaiveDate, hours: f64) -> TimeEntry {
        TimeEntry {
            name: name.into(),
            date,
            hours,
            mult: 1.0,
            element: "P100 Lager-App".into(),
            kost2art: "Delivery (billable)".into(),
            location: String::new(),
            billable: None,
            ..Default::default()
        }
    }

    fn sick(name: &str, date: NaiveDate) -> TimeEntry {
        TimeEntry {
            element: "(Sick)".into(),
            kost2art: String::new(),
            ..work(name, date, 8.0)
        }
    }

    fn config(team: Vec<TeamMember>, planned_absences: Vec<PlannedAbsence>) -> ProjectConfig {
        ProjectConfig {
            id: "p".into(),
            name: "Musterkunde GmbH / Lager-App".into(),
            element_filter: "P100 Lager-App".into(),
            team,
            guests: vec![],
            planned_absences,
            budgets: vec![],
            data_source: Default::default(),
            working_hours: vec![WorkingHoursPeriod {
                from: d(1, 1),
                to: None,
                hours_per_day: 8.0,
            }],
            holidays: HolidayConfig {
                region: "HE".into(),
                custom: vec![],
            },
            vat_percent: 19.0,
            missing_threshold_percent: 50.0,
            billing_rules: default_billing_rules(),
            export_format: ExportFormat::default(),
        }
    }

    /// Jeden Werktag im Dezember bis zum Stichtag 8 h buchen (außer `skip`).
    fn december(name: &str, until: u32, skip: &[u32]) -> Vec<TimeEntry> {
        (1..=until)
            .map(|day| d(12, day))
            .filter(|date| date.weekday().num_days_from_monday() < 5)
            .filter(|date| !skip.contains(&date.day()))
            .map(|date| work(name, date, 8.0))
            .collect()
    }

    #[test]
    fn deficit_is_spread_over_the_remaining_working_days() {
        // Nur Dezember im Einsatz; Stichtag Fr 11.12.2026.
        // Restliche Werktage 14.–31.12.: 13 (25.12. = Feiertag, 26.12. = Samstag).
        let mut erika = member("Erika Mustermann");
        erika.assignments = vec![AssignmentPeriod {
            from: d(12, 1),
            to: None,
        }];
        // Anspruch 3 + Übertrag 1, genommen 0, geplant 1,5 → offen 2,5
        erika.vacation = vec![VacationEntitlement {
            year: 2026,
            days: 3.0,
            carry_over: 1.0,
        }];
        let mut max = member("Max Mustermann");
        max.assignments = erika.assignments.clone();
        max.working_hours = vec![WorkingHoursPeriod {
            from: d(12, 1),
            to: None,
            hours_per_day: 6.0,
        }];
        let mut lena = member("Lena Beispiel"); // Einsatz endet am Stichtag
        lena.assignments = vec![AssignmentPeriod {
            from: d(12, 1),
            to: Some(d(12, 11)),
        }];
        let planned = vec![
            PlannedAbsence {
                person: "erika mustermann".into(),
                from: d(12, 14),
                to: d(12, 14),
                kind: PlannedAbsenceKind::Vacation,
                half_day: false,
            },
            PlannedAbsence {
                person: "Erika Mustermann".into(),
                from: d(12, 15),
                to: d(12, 15),
                kind: PlannedAbsenceKind::Vacation,
                half_day: true,
            },
            PlannedAbsence {
                person: "Max Mustermann".into(),
                from: d(12, 19), // Samstag: kein Werktag
                to: d(12, 21),
                kind: PlannedAbsenceKind::Other,
                half_day: false,
            },
        ];
        let config = config(vec![erika, max, lena], planned);
        // Erika: 1 Tag krank (−8 h), 1 Tag 4 h zu wenig → −12 h
        let mut entries = december("Erika Mustermann", 11, &[3, 4]);
        entries.push(sick("Erika Mustermann", d(12, 3)));
        entries.push(work("Erika Mustermann", d(12, 4), 4.0));
        // Max: 9 Werktage × 6 h Soll = 54 h, gebucht 9 × 8 h = 72 h → +18 h
        entries.extend(december("Max Mustermann", 11, &[]));
        // Lena: genau Soll → 0 h
        entries.extend(december("Lena Beispiel", 11, &[]));

        let ev = evaluate(&config, &entries, d(12, 11), Some(d(12, 11)));
        let result = catch_up(&config, &ev, &[]);
        assert_eq!(result.from, d(12, 12)); // Samstag nach dem Stichtag
        assert_eq!(result.to, d(12, 31));
        assert_eq!(result.workdays, 13); // 14.–18., 21.–24., 28.–31.

        let erika = &result.persons[0];
        assert_eq!(erika.balance, -12.0);
        assert_eq!(erika.deficit, 12.0);
        assert_eq!(erika.workdays, 13.0);
        assert_eq!(erika.planned_days, 1.5);
        assert_eq!(erika.open_vacation_days, 2.5);
        assert!(erika.has_entitlement);
        assert_eq!(erika.available_days, 9.0); // 13 − 1,5 geplant − 2,5 offen
        assert_eq!(erika.hours_per_day, 8.0);
        assert_eq!(erika.extra_per_day, Some(1.33)); // 12 h ÷ 9 Tage

        let max = &result.persons[1];
        assert_eq!(max.balance, 18.0);
        assert_eq!(max.deficit, 0.0);
        assert_eq!(max.planned_days, 1.0); // nur Mo 21.12.
        assert_eq!(max.open_vacation_days, 0.0);
        assert!(!max.has_entitlement);
        assert_eq!(max.available_days, 12.0);
        assert_eq!(max.hours_per_day, 6.0);
        assert_eq!(max.extra_per_day, Some(0.0));

        let lena = &result.persons[2];
        assert_eq!(lena.workdays, 0.0);
        assert_eq!(lena.available_days, 0.0);
        assert_eq!(lena.extra_per_day, None);
        assert_eq!(lena.hours_per_day, 0.0);

        // Team: −12 + 18 = +6 → kein Aufholen nötig
        assert_eq!(result.team.balance, 6.0);
        assert_eq!(result.team.deficit, 0.0);
        assert_eq!(result.team.available_days, 21.0);
        assert_eq!(result.team.extra_per_person_day, Some(0.0));
        assert_eq!(result.team.extra_per_workday, Some(0.0));
        assert!(result.persons.iter().all(|p| p.team_share == 0.0));
    }

    #[test]
    fn team_deficit_is_shared_by_everybody_who_still_works() {
        // Stichtag Fr 11.12.; beide durchgehend 8 h, kein Urlaubsanspruch.
        let config = config(
            vec![member("Erika Mustermann"), member("Max Mustermann")],
            vec![PlannedAbsence {
                person: "Max Mustermann".into(),
                from: d(12, 28),
                to: d(12, 31),
                kind: PlannedAbsenceKind::Vacation,
                half_day: false,
            }],
        );
        // Bis November genau Soll, im Dezember: Erika 2 Tage krank (−16 h),
        // Max 1 Tag 4 h zu wenig (−4 h) → Team −20 h
        let holidays: HashSet<NaiveDate> = crate::calculation::holidays::holidays(2026, "HE", &[])
            .iter()
            .map(|h| h.date)
            .collect();
        let mut entries: Vec<TimeEntry> = d(1, 1)
            .iter_days()
            .take_while(|day| *day <= d(11, 30))
            .filter(|day| soll::is_workday(*day, &holidays))
            .flat_map(|day| {
                [
                    work("Erika Mustermann", day, 8.0),
                    work("Max Mustermann", day, 8.0),
                ]
            })
            .collect();
        entries.extend(december("Erika Mustermann", 11, &[1, 2]));
        entries.push(sick("Erika Mustermann", d(12, 1)));
        entries.push(sick("Erika Mustermann", d(12, 2)));
        entries.extend(december("Max Mustermann", 11, &[7]));
        entries.push(work("Max Mustermann", d(12, 7), 4.0));

        let ev = evaluate(&config, &entries, d(12, 11), Some(d(12, 11)));
        let result = catch_up(&config, &ev, &[]);
        assert_eq!(result.workdays, 13);
        let workdays = 13.0;
        let [erika, max] = &result.persons[..] else {
            panic!("zwei Personen erwartet")
        };
        assert_eq!(erika.balance, -16.0);
        assert_eq!(max.balance, -4.0);
        assert_eq!(erika.available_days, workdays);
        assert_eq!(max.planned_days, 4.0);
        assert_eq!(max.available_days, workdays - 4.0);
        assert_eq!(erika.extra_per_day, Some(round2(16.0 / workdays)));
        assert_eq!(max.extra_per_day, Some(round2(4.0 / (workdays - 4.0))));

        let person_days = 2.0 * workdays - 4.0;
        assert_eq!(result.team.balance, -20.0);
        assert_eq!(result.team.deficit, 20.0);
        assert_eq!(result.team.available_days, person_days);
        assert_eq!(result.team.extra_per_workday, Some(round2(20.0 / workdays)));
        assert_eq!(
            result.team.extra_per_person_day,
            Some(round2(20.0 / person_days))
        );
        assert_eq!(erika.team_share, round2(20.0 / person_days * workdays));
        assert_eq!(
            max.team_share,
            round2(20.0 / person_days * (workdays - 4.0))
        );
        assert!((erika.team_share + max.team_share - 20.0).abs() < 0.02);
    }

    #[test]
    fn nothing_left_to_catch_up_on_new_years_eve() {
        let config = config(vec![member("Erika Mustermann")], vec![]);
        let entries = vec![sick("Erika Mustermann", d(12, 30))];
        let ev = evaluate(&config, &entries, d(12, 31), None);
        let result = catch_up(&config, &ev, &[]);
        assert_eq!(result.workdays, 0);
        assert_eq!(result.persons[0].available_days, 0.0);
        assert_eq!(result.persons[0].extra_per_day, None);
        assert!(result.persons[0].deficit > 0.0);
        assert_eq!(result.team.extra_per_workday, None);
        assert_eq!(result.team.extra_per_person_day, None);
    }

    fn status(from: &str, to: &str, amount: f64, expected_net: f64) -> BudgetStatus {
        BudgetStatus {
            from: from.into(),
            to: to.into(),
            amount,
            monthly_target: 0.0,
            month_count: 0,
            target_to_date: 0.0,
            actual_net: expected_net,
            forecast_net: 0.0,
            expected_net,
            deviation: expected_net - amount,
            exhausted_on: None,
            exceeded: false,
        }
    }

    /// Ab 02.11. im Einsatz, Stichtag Fr 20.11.; Erika −20 h (2 Tage krank, 4 h zu
    /// wenig), Max genau Soll. Restliche Werktage: 23.–30.11. (6) + Dezember (22).
    fn november() -> (ProjectConfig, Evaluation) {
        let rate = |rate| {
            vec![RatePeriod {
                from: d(1, 1),
                to: None,
                rate,
            }]
        };
        let assigned = vec![AssignmentPeriod {
            from: d(11, 2),
            to: None,
        }];
        let mut erika = member("Erika Mustermann");
        erika.rates = rate(100.0);
        erika.assignments = assigned.clone();
        // 7 offene Urlaubstage → Arbeitstage 28 − 7 = 21, bis Budgetende anteilig 6 × ¾
        erika.vacation = vec![VacationEntitlement {
            year: 2026,
            days: 7.0,
            carry_over: 0.0,
        }];
        let mut max = member("Max Mustermann");
        max.rates = rate(80.0);
        max.assignments = assigned;
        let config = config(
            vec![erika, max],
            vec![PlannedAbsence {
                person: "Max Mustermann".into(),
                from: d(11, 30),
                to: d(11, 30),
                kind: PlannedAbsenceKind::Other,
                half_day: false,
            }],
        );
        let entries: Vec<TimeEntry> = d(11, 2)
            .iter_days()
            .take_while(|day| *day <= d(11, 20))
            .filter(|day| day.weekday().num_days_from_monday() < 5)
            .flat_map(|day| {
                let erika = match day.day() {
                    2 | 3 => sick("Erika Mustermann", day),
                    4 => work("Erika Mustermann", day, 4.0),
                    _ => work("Erika Mustermann", day, 8.0),
                };
                [erika, work("Max Mustermann", day, 8.0)]
            })
            .collect();
        let ev = evaluate(&config, &entries, d(11, 20), Some(d(11, 20)));
        (config, ev)
    }

    #[test]
    fn remaining_budget_limits_what_can_be_caught_up() {
        let (config, ev) = november();
        // Budget bis November, laut Prognose bleiben 850 € übrig
        let budgets = [
            status("2025-01", "2025-12", 1.0, 0.0),
            status("2026-01", "2026-11", 100_000.0, 99_150.0),
        ];
        let result = catch_up(&config, &ev, &budgets);
        assert_eq!(result.workdays, 28);
        assert_eq!(result.team.deficit, 20.0);
        assert_eq!(result.persons[0].available_days, 21.0);
        assert_eq!(result.persons[1].available_days, 27.0);

        let budget = result.budget.expect("Budget bis November");
        assert_eq!(
            (budget.from.as_str(), budget.to.as_str()),
            ("2026-01", "2026-11")
        );
        assert_eq!(budget.until, d(11, 30));
        assert_eq!(budget.remaining, 850.0);
        assert_eq!(budget.workdays, 6);
        // Erika 6 × ¾ = 4,5 Tage à 100 €, Max 5 Tage à 80 € (30.11. abwesend)
        assert_eq!(budget.available_days, 9.5);
        assert_eq!(budget.average_rate, Some(round2(850.0 / 9.5)));
        // 850 € ÷ Ø 89,47 € = 9,5 h – von 20 h fehlenden
        assert_eq!(budget.affordable_hours, Some(9.5));
        assert_eq!(budget.covered_hours, 9.5);
        assert_eq!(budget.covered_net, 850.0);
        assert_eq!(budget.uncovered_hours, 10.5);
        assert_eq!(budget.extra_per_workday, Some(round2(9.5 / 6.0)));
        assert_eq!(budget.extra_per_person_day, Some(1.0));
    }

    #[test]
    fn budget_left_over_or_already_used_up() {
        let (config, ev) = november();
        // genug Budget bis Jahresende: alles aufholbar, Zeitraum bis 31.12.
        let plenty = catch_up(
            &config,
            &ev,
            &[status("2026-11", "2027-03", 50_000.0, 10_000.0)],
        );
        let budget = plenty.budget.unwrap();
        assert_eq!(budget.until, d(12, 31));
        assert_eq!(budget.workdays, 28);
        assert_eq!(budget.available_days, 48.0);
        assert_eq!(budget.covered_hours, 20.0);
        assert_eq!(budget.uncovered_hours, 0.0);
        assert_eq!(budget.extra_per_person_day, Some(round2(20.0 / 48.0)));
        // Ø Satz (21 × 100 + 27 × 80) ÷ 48
        assert_eq!(budget.average_rate, Some(round2(4260.0 / 48.0)));
        assert_eq!(budget.covered_net, round2(20.0 * 4260.0 / 48.0));

        // laut Prognose schon überzogen: nichts im Budget aufholbar
        let used = catch_up(
            &config,
            &ev,
            &[status("2026-01", "2026-12", 1000.0, 1200.0)],
        );
        let budget = used.budget.unwrap();
        assert_eq!(budget.remaining, -200.0);
        assert_eq!(budget.affordable_hours, Some(0.0));
        assert_eq!(budget.covered_hours, 0.0);
        assert_eq!(budget.uncovered_hours, 20.0);

        // kein Budget, in dem der 21.11. liegt
        let none = catch_up(&config, &ev, &[status("2026-01", "2026-10", 1000.0, 0.0)]);
        assert_eq!(none.budget, None);

        // ohne Stundensätze kostet Aufholen nichts
        let mut free = config.clone();
        free.team.iter_mut().for_each(|m| m.rates.clear());
        let ev = evaluate(&free, &[], d(11, 20), None);
        let result = catch_up(&free, &ev, &[status("2026-01", "2026-11", 0.0, 0.0)]);
        let budget = result.budget.unwrap();
        assert_eq!(budget.average_rate, Some(0.0));
        assert_eq!(budget.affordable_hours, None);
        assert_eq!(budget.covered_hours, result.team.deficit);
    }
}
