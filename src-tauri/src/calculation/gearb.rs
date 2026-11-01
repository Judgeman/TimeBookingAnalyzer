//! Gearbeitete Stunden (gearb) und Abwesenheiten.

use crate::models::config::SpecialElements;
use crate::models::entry::TimeEntry;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Absence {
    Sick,
    Vacation,
}

pub fn absence(entry: &TimeEntry, special: &SpecialElements) -> Option<Absence> {
    if entry.element == special.sick {
        Some(Absence::Sick)
    } else if entry.element == special.vacation {
        Some(Absence::Vacation)
    } else {
        None
    }
}

pub fn counts_as_work(mult: f64) -> bool {
    mult > 0.0
}

/// Beitrag einer (Nicht-Abwesenheits-)Buchung zu gearb: Stunden × Mult, falls Mult > 0.
pub fn worked_hours(entry: &TimeEntry) -> f64 {
    if counts_as_work(entry.mult) {
        entry.hours * entry.mult
    } else {
        0.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn entry(element: &str, hours: f64, mult: f64) -> TimeEntry {
        TimeEntry {
            name: "Erika Mustermann".into(),
            date: NaiveDate::from_ymd_opt(2026, 10, 5).unwrap(),
            hours,
            mult,
            element: element.into(),
            kost2art: String::new(),
            location: String::new(),
        }
    }

    #[test]
    fn classifies_absences() {
        let special = SpecialElements::default();
        assert_eq!(
            absence(&entry("(Sick)", 8.0, 1.0), &special),
            Some(Absence::Sick)
        );
        assert_eq!(
            absence(&entry("(Vacation)", 8.0, 1.0), &special),
            Some(Absence::Vacation)
        );
        assert_eq!(absence(&entry("P100 Lager-App", 8.0, 1.0), &special), None);
    }

    #[test]
    fn worked_hours_apply_mult() {
        assert_eq!(worked_hours(&entry("P100", 2.0, 0.5)), 1.0);
        assert_eq!(worked_hours(&entry("P100", 3.0, 0.0)), 0.0);
        assert_eq!(worked_hours(&entry("P100", 8.0, 1.0)), 8.0);
    }
}
