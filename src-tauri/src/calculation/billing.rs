//! Abrechnungsregeln und Stundensätze.

use chrono::NaiveDate;

use crate::models::config::{BillingRule, MatchMode, TeamMember};
use crate::models::entry::TimeEntry;

/// Erste Regel, die zur Buchung passt (Index + Regel).
///
/// Element: leer in der Regel = Element-Filter des Projekts. Kost2Art und
/// Element werden ohne Groß-/Kleinschreibung und Leerzeichen am Rand verglichen.
pub fn matching_rule<'a>(
    rules: &'a [BillingRule],
    entry: &TimeEntry,
    element_filter: &str,
) -> Option<(usize, &'a BillingRule)> {
    let kost2art = entry.kost2art.trim().to_lowercase();
    let element = entry.element.trim();
    rules.iter().enumerate().find(|(_, rule)| {
        let wanted_element = if rule.element.trim().is_empty() {
            element_filter.trim()
        } else {
            rule.element.trim()
        };
        if wanted_element.is_empty() || !element.eq_ignore_ascii_case(wanted_element) {
            return false;
        }
        let pattern = rule.kost2art.trim().to_lowercase();
        match rule.match_mode {
            MatchMode::Exact => kost2art == pattern,
            MatchMode::Contains => !pattern.is_empty() && kost2art.contains(&pattern),
        }
    })
}

/// Abgerechnete Stunden einer Buchung nach der Regel (mit oder ohne Mult).
pub fn billed_hours(entry: &TimeEntry, rule: &BillingRule) -> f64 {
    if rule.apply_mult {
        entry.hours * entry.mult
    } else {
        entry.hours
    }
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
    use crate::models::config::{RatePeriod, default_billing_rules};

    fn d(m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, m, day).unwrap()
    }

    fn entry(element: &str, kost2art: &str, hours: f64, mult: f64) -> TimeEntry {
        TimeEntry {
            name: "Erika Mustermann".into(),
            date: d(10, 5),
            hours,
            mult,
            element: element.into(),
            kost2art: kost2art.into(),
            location: String::new(),
        }
    }

    #[test]
    fn default_rules_follow_spec() {
        let rules = default_billing_rules();
        let rule = |e: &TimeEntry| matching_rule(&rules, e, "P100 Lager-App").map(|(i, _)| i);
        assert_eq!(
            rule(&entry("P100 Lager-App", "Delivery (billable)", 8.0, 1.0)),
            Some(0)
        );
        assert_eq!(
            rule(&entry("P100 Lager-App", "Travel (billable)", 2.0, 0.5)),
            Some(1)
        );
        assert_eq!(
            rule(&entry("p100 lager-app ", "delivery (BILLABLE)", 8.0, 1.0)),
            Some(0)
        );
        assert_eq!(rule(&entry("P100 Lager-App", "Sales", 1.0, 1.0)), None);
        assert_eq!(
            rule(&entry("P200 Intranet", "Delivery (billable)", 8.0, 1.0)),
            None
        );
        // Ohne Element-Filter greift keine Standardregel.
        assert_eq!(
            matching_rule(&rules, &entry("P100", "Delivery (billable)", 8.0, 1.0), ""),
            None
        );
    }

    #[test]
    fn first_matching_rule_wins_and_element_can_be_overridden() {
        let mut rules = default_billing_rules();
        let mut travel = rules[0].clone();
        travel.name = "Reisezeit".into();
        travel.kost2art = "Travel (billable)".into();
        travel.apply_mult = true;
        rules.insert(0, travel);
        let mut other = rules[1].clone();
        other.element = "P900 Wartung".into();
        rules.push(other);

        let travel_entry = entry("P100 Lager-App", "Travel (billable)", 2.0, 0.5);
        let (index, rule) = matching_rule(&rules, &travel_entry, "P100 Lager-App").unwrap();
        assert_eq!((index, rule.name.as_str()), (0, "Reisezeit"));
        assert_eq!(billed_hours(&travel_entry, rule), 1.0);

        let maintenance = entry("P900 Wartung", "Delivery (billable)", 3.0, 1.0);
        assert_eq!(
            matching_rule(&rules, &maintenance, "P100 Lager-App").map(|(i, _)| i),
            Some(3)
        );
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
            working_hours: vec![],
            assignments: vec![],
        };
        assert_eq!(rate_for(&member, d(6, 30)), Some(100.0));
        assert_eq!(rate_for(&member, d(7, 1)), Some(105.0));
        assert_eq!(
            rate_for(&member, NaiveDate::from_ymd_opt(2025, 12, 1).unwrap()),
            None
        );
    }
}
