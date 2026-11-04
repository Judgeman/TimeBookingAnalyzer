//! Resturlaub je Person im Stichtag-Jahr:
//! Rest = Anspruch + Übertrag − genommen (Urlaub bis zum Stichtag, ganze/halbe
//! Tage wie in der Auswertung) − geplant (geplante Urlaube nach dem Stand der
//! Daten bis Jahresende, nur Werktage, halbe Tage = ½).

use std::collections::HashSet;

use chrono::{Datelike, NaiveDate};

use super::{Evaluation, round2, soll};
use crate::models::config::{PlannedAbsenceKind, ProjectConfig};
use crate::models::results::VacationStatus;

pub fn vacation_status(config: &ProjectConfig, ev: &Evaluation) -> Vec<VacationStatus> {
    let year = ev.cutoff.year();
    let Some(year_end) = NaiveDate::from_ymd_opt(year, 12, 31) else {
        return Vec::new();
    };
    let data_end = ev.missing_checked_until;
    let holidays: HashSet<NaiveDate> = ev.holidays.iter().map(|h| h.date).collect();

    config
        .team
        .iter()
        .filter_map(|member| {
            // ohne Zeiterfassung keine Person (und kein Resturlaub)
            let person = ev.persons.iter().find(|p| p.name == member.name)?;
            let entitlement = member.vacation.iter().find(|v| v.year == year)?;
            let taken = person.periods.ytd.vac_days;
            let planned: f64 = config
                .planned_absences
                .iter()
                .filter(|a| {
                    a.kind == PlannedAbsenceKind::Vacation
                        && a.person.trim().eq_ignore_ascii_case(member.name.trim())
                })
                .flat_map(|a| {
                    let share = if a.half_day { 0.5 } else { 1.0 };
                    a.from
                        .iter_days()
                        .take_while(move |d| *d <= a.to)
                        .filter(|d| *d > data_end && *d <= year_end)
                        .filter(|d| soll::is_workday(*d, &holidays))
                        .map(move |_| share)
                })
                .sum();
            Some(VacationStatus {
                person: member.name.clone(),
                year,
                entitlement: entitlement.days,
                carry_over: entitlement.carry_over,
                taken,
                planned: round2(planned),
                remaining: round2(entitlement.days + entitlement.carry_over - taken - planned),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::calculation::evaluate;
    use crate::models::config::{
        ExportFormat, HolidayConfig, PlannedAbsence, TeamMember, VacationEntitlement,
        WorkingHoursPeriod, default_billing_rules,
    };
    use crate::models::entry::TimeEntry;

    fn d(m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, m, day).unwrap()
    }

    fn member(name: &str, vacation: Vec<VacationEntitlement>) -> TeamMember {
        TeamMember {
            name: name.into(),
            rates: vec![],
            working_hours: vec![],
            assignments: vec![],
            untracked: false,
            vacation,
        }
    }

    fn absence(
        from: NaiveDate,
        to: NaiveDate,
        kind: PlannedAbsenceKind,
        half_day: bool,
    ) -> PlannedAbsence {
        PlannedAbsence {
            person: "erika mustermann".into(),
            from,
            to,
            kind,
            half_day,
        }
    }

    #[test]
    fn remaining_vacation_counts_taken_and_planned_days() {
        let config = ProjectConfig {
            id: "p".into(),
            name: "Musterkunde GmbH / Lager-App".into(),
            element_filter: "P100 Lager-App".into(),
            team: vec![
                member(
                    "Erika Mustermann",
                    vec![
                        VacationEntitlement {
                            year: 2025,
                            days: 28.0,
                            carry_over: 0.0,
                        },
                        VacationEntitlement {
                            year: 2026,
                            days: 30.0,
                            carry_over: 2.0,
                        },
                    ],
                ),
                member("Max Mustermann", vec![]), // ohne Anspruch → nicht aufgeführt
            ],
            guests: vec![],
            working_hours: vec![WorkingHoursPeriod {
                from: d(1, 1),
                to: None,
                hours_per_day: 8.0,
            }],
            holidays: HolidayConfig::default(),
            export_format: ExportFormat::default(),
            vat_percent: 19.0,
            billing_rules: default_billing_rules(),
            missing_threshold_percent: 50.0,
            planned_absences: vec![
                absence(d(1, 15), d(1, 15), PlannedAbsenceKind::Vacation, false), // vor dem Stand
                absence(d(2, 2), d(2, 6), PlannedAbsenceKind::Vacation, false),   // 5 Werktage
                absence(d(3, 2), d(3, 3), PlannedAbsenceKind::Vacation, true),    // 2 × ½
                absence(d(3, 9), d(3, 13), PlannedAbsenceKind::Other, false),     // kein Urlaub
                absence(d(12, 24), d(12, 31), PlannedAbsenceKind::Vacation, false), // 25./26. Feiertag, 27. So
            ],
            budgets: vec![],
        };
        let entry = |date, hours| TimeEntry {
            name: "Erika Mustermann".into(),
            date,
            hours,
            mult: 1.0,
            element: "(Vacation)".into(),
            kost2art: String::new(),
            location: String::new(),
        };
        // 02.01. ganzer Tag, 07.01. halber Tag (4 h)
        let entries = vec![entry(d(1, 2), 8.0), entry(d(1, 7), 4.0)];
        let ev = evaluate(&config, &entries, d(1, 16), Some(d(1, 16)));
        let status = vacation_status(&config, &ev);

        assert_eq!(
            status,
            vec![VacationStatus {
                person: "Erika Mustermann".into(),
                year: 2026,
                entitlement: 30.0,
                carry_over: 2.0,
                taken: 1.5,
                planned: 11.0, // 5 (Feb.) + 2 × ½ (März) + 5 (24., 28.–31.12.)
                remaining: 19.5,
            }]
        );
    }
}
