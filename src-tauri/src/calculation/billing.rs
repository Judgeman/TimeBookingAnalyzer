//! Billable-Klassifikation und Stundensätze.

use chrono::NaiveDate;

use crate::models::config::TeamMember;

pub const DELIVERY: &str = "Delivery (billable)";

pub fn is_billable(kost2art: &str) -> bool {
    kost2art.contains("(billable)")
}

pub fn is_delivery(kost2art: &str) -> bool {
    kost2art == DELIVERY
}

/// Stundensatz einer Person an einem Tag; `None`, wenn kein Zeitraum passt.
pub fn rate_for(member: &TeamMember, date: NaiveDate) -> Option<f64> {
    member
        .rates
        .iter()
        .find(|r| r.from <= date && r.to.is_none_or(|to| date <= to))
        .map(|r| r.rate)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::config::RatePeriod;

    fn d(m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, m, day).unwrap()
    }

    #[test]
    fn classification() {
        assert!(is_billable("Delivery (billable)"));
        assert!(is_billable("Travel (billable)"));
        assert!(!is_billable("Sales"));
        assert!(is_delivery("Delivery (billable)"));
        assert!(!is_delivery("Travel (billable)"));
    }

    #[test]
    fn rate_periods() {
        let member = TeamMember {
            name: "Erika Mustermann".into(),
            rates: vec![
                RatePeriod {
                    from: d(1, 1),
                    to: Some(d(6, 30)),
                    rate: 100.0,
                },
                RatePeriod {
                    from: d(7, 1),
                    to: None,
                    rate: 105.0,
                },
            ],
        };
        assert_eq!(rate_for(&member, d(6, 30)), Some(100.0));
        assert_eq!(rate_for(&member, d(7, 1)), Some(105.0));
        assert_eq!(
            rate_for(&member, NaiveDate::from_ymd_opt(2025, 12, 1).unwrap()),
            None
        );
    }
}
