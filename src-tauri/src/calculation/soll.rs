//! Soll-Stunden: Werktage (Mo–Fr ohne Feiertage) × vertragliche Stunden pro Tag.

use std::collections::HashSet;

use chrono::{Datelike, NaiveDate, Weekday};

use crate::models::config::{TeamMember, WorkingHoursPeriod};

/// Personio bucht Urlaub/Krank immer mit 8 h pro Tag.
pub const PERSONIO_HOURS_PER_DAY: f64 = 8.0;

/// Vertragliche Stunden für einen Tag; `None`, wenn kein Zeitraum passt.
pub fn hours_per_day(date: NaiveDate, periods: &[WorkingHoursPeriod]) -> Option<f64> {
    periods
        .iter()
        .find(|p| p.from <= date && p.to.is_none_or(|to| date <= to))
        .map(|p| p.hours_per_day)
}

/// Stunden pro Tag für eine Person: eigener Zeitraum der Person, sonst Projekt.
pub fn hours_per_day_for(
    member: &TeamMember,
    project: &[WorkingHoursPeriod],
    date: NaiveDate,
) -> Option<f64> {
    hours_per_day(date, &member.working_hours).or_else(|| hours_per_day(date, project))
}

pub fn is_workday(date: NaiveDate, holidays: &HashSet<NaiveDate>) -> bool {
    !matches!(date.weekday(), Weekday::Sat | Weekday::Sun) && !holidays.contains(&date)
}

/// Rechnet Personio-Stunden eines Tages in angerechnete Tage um: ganzer oder
/// halber Standard-Tag (8 h → 1, 4 h → ½; andere Werte auf ½ Tag gerundet).
/// Liefert (Tage, angerechnete Stunden = Tage × vertragliche h/Tag).
pub fn normalize_absence(raw_hours: f64, hours_per_day: f64) -> (f64, f64) {
    let days = (raw_hours / PERSONIO_HOURS_PER_DAY * 2.0).round() / 2.0;
    (days, days * hours_per_day)
}

/// Personio-Buchung, die keinem ganzen oder halben Tag entspricht.
pub fn is_unusual_absence(raw_hours: f64) -> bool {
    let halves = raw_hours / PERSONIO_HOURS_PER_DAY * 2.0;
    (halves - halves.round()).abs() > 1e-9
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, m, day).unwrap()
    }

    fn periods() -> Vec<WorkingHoursPeriod> {
        vec![
            WorkingHoursPeriod {
                from: d(1, 1),
                to: Some(d(6, 30)),
                hours_per_day: 8.0,
            },
            WorkingHoursPeriod {
                from: d(7, 1),
                to: None,
                hours_per_day: 7.5,
            },
        ]
    }

    #[test]
    fn hours_per_day_follows_periods() {
        let p = periods();
        assert_eq!(hours_per_day(d(6, 30), &p), Some(8.0));
        assert_eq!(hours_per_day(d(7, 1), &p), Some(7.5));
        assert_eq!(hours_per_day(d(12, 31), &p), Some(7.5));
        assert_eq!(
            hours_per_day(NaiveDate::from_ymd_opt(2025, 12, 31).unwrap(), &p),
            None
        );
    }

    #[test]
    fn workdays_skip_weekends_and_holidays() {
        let holidays: HashSet<NaiveDate> = [d(10, 3), d(5, 1)].into();
        assert!(is_workday(d(10, 2), &holidays)); // Freitag
        assert!(!is_workday(d(10, 3), &holidays)); // Samstag + Feiertag
        assert!(!is_workday(d(10, 4), &holidays)); // Sonntag
        assert!(!is_workday(d(5, 1), &holidays)); // Feiertag (Freitag)
    }

    #[test]
    fn absence_is_credited_as_full_or_half_standard_day() {
        assert_eq!(normalize_absence(8.0, 7.5), (1.0, 7.5));
        assert_eq!(normalize_absence(4.0, 8.0), (0.5, 4.0));
        assert_eq!(normalize_absence(6.0, 8.0), (1.0, 8.0)); // ¾ → 1 Tag
        assert_eq!(normalize_absence(3.0, 8.0), (0.5, 4.0)); // ⅜ → ½ Tag
        assert_eq!(normalize_absence(1.0, 8.0), (0.0, 0.0)); // ⅛ → 0
        assert_eq!(normalize_absence(16.0, 6.0), (2.0, 12.0));
        assert!(!is_unusual_absence(8.0));
        assert!(!is_unusual_absence(4.0));
        assert!(is_unusual_absence(6.0));
    }

    #[test]
    fn person_override_falls_back_to_project() {
        let member = TeamMember {
            name: "Max Mustermann".into(),
            rates: vec![],
            working_hours: vec![WorkingHoursPeriod {
                from: d(9, 1),
                to: Some(d(9, 30)),
                hours_per_day: 6.0,
            }],
            assignments: vec![],
            untracked: false,
            vacation: vec![],
        };
        let project = periods();
        assert_eq!(hours_per_day_for(&member, &project, d(8, 31)), Some(7.5));
        assert_eq!(hours_per_day_for(&member, &project, d(9, 15)), Some(6.0));
        assert_eq!(hours_per_day_for(&member, &project, d(10, 1)), Some(7.5));
    }
}
