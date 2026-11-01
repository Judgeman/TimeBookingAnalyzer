//! Soll-Stunden: Werktage (Mo–Fr ohne Feiertage) × vertragliche Stunden pro Tag.

use std::collections::HashSet;

use chrono::{Datelike, NaiveDate, Weekday};

use crate::models::config::WorkingHoursPeriod;

/// Personio bucht Urlaub/Krank immer mit 8 h pro Tag.
pub const PERSONIO_HOURS_PER_DAY: f64 = 8.0;

/// Vertragliche Stunden für einen Tag; `None`, wenn kein Zeitraum passt.
pub fn hours_per_day(date: NaiveDate, periods: &[WorkingHoursPeriod]) -> Option<f64> {
    periods
        .iter()
        .find(|p| p.from <= date && p.to.is_none_or(|to| date <= to))
        .map(|p| p.hours_per_day)
}

pub fn is_workday(date: NaiveDate, holidays: &HashSet<NaiveDate>) -> bool {
    !matches!(date.weekday(), Weekday::Sat | Weekday::Sun) && !holidays.contains(&date)
}

/// Rechnet Personio-Stunden (8 h = 1 Tag) auf die vertraglichen Stunden um.
/// Liefert (Tage, normierte Stunden).
pub fn normalize_absence(raw_hours: f64, hours_per_day: f64) -> (f64, f64) {
    let days = raw_hours / PERSONIO_HOURS_PER_DAY;
    (days, days * hours_per_day)
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
    fn absence_is_scaled_to_contract_hours() {
        assert_eq!(normalize_absence(8.0, 7.5), (1.0, 7.5));
        assert_eq!(normalize_absence(4.0, 8.0), (0.5, 4.0));
    }
}
