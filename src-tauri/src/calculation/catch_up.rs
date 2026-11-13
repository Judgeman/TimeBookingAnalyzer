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

use std::collections::{HashMap, HashSet};

use chrono::{Datelike, NaiveDate};

use super::{Evaluation, round2, soll};
use crate::models::config::{PlannedAbsenceKind, ProjectConfig, TeamMember};
use crate::models::results::{CatchUp, CatchUpPerson, CatchUpTeam};

/// Unterhalb davon gilt ein Saldo als ausgeglichen (Rundung auf Cent-Stunden).
const EPSILON: f64 = 0.005;

pub fn catch_up(config: &ProjectConfig, ev: &Evaluation) -> CatchUp {
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

    let mut persons: Vec<CatchUpPerson> = ev
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
            ))
        })
        .collect();

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

    CatchUp {
        from,
        to,
        workdays: workdays.len() as u32,
        persons,
        team,
    }
}

fn person_catch_up(
    config: &ProjectConfig,
    member: &TeamMember,
    balance: f64,
    vacation_taken: f64,
    workdays: &[NaiveDate],
) -> CatchUpPerson {
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
    }

    let year = workdays.first().map(|d| d.year());
    let entitlement = year.and_then(|y| member.vacation.iter().find(|v| v.year == y));
    let open_vacation = entitlement
        .map(|v| (v.days + v.carry_over - vacation_taken - planned_vacation).max(0.0))
        .unwrap_or(0.0)
        .min((days - planned_days).max(0.0));
    let available_days = (days - planned_days - open_vacation).max(0.0);
    let deficit = if balance < -EPSILON { -balance } else { 0.0 };

    CatchUpPerson {
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
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::calculation::evaluate;
    use crate::models::config::{
        AssignmentPeriod, ExportFormat, HolidayConfig, PlannedAbsence, VacationEntitlement,
        WorkingHoursPeriod, default_billing_rules,
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
        let result = catch_up(&config, &ev);
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
        let result = catch_up(&config, &ev);
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
        let result = catch_up(&config, &ev);
        assert_eq!(result.workdays, 0);
        assert_eq!(result.persons[0].available_days, 0.0);
        assert_eq!(result.persons[0].extra_per_day, None);
        assert!(result.persons[0].deficit > 0.0);
        assert_eq!(result.team.extra_per_workday, None);
        assert_eq!(result.team.extra_per_person_day, None);
    }
}
