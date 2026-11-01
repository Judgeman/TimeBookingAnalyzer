//! Auswertung nach Arbeitsort (Spalte „Ort“): gearbeitete Stunden je Ort.
//!
//! Basis sind dieselben Stunden wie bei „Gearbeitet“ (Stunden × Mult, nur
//! Mult > 0, ohne Urlaub/Krank) – die Summe aller Orte ergibt also gearb.
//! Orte werden ohne Groß-/Kleinschreibung zusammengefasst; leere Zellen
//! erscheinen als „(ohne Angabe)“.

use std::collections::{BTreeMap, HashMap};

use chrono::NaiveDate;

use super::{month_key, round2};
use crate::models::results::{LocationBreakdown, LocationShare};

pub const UNKNOWN_LOCATION: &str = "(ohne Angabe)";

/// (Gruppierungsschlüssel, Anzeigename) eines Ortes.
pub fn location_key(raw: &str) -> (String, String) {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        (String::new(), UNKNOWN_LOCATION.to_string())
    } else {
        (trimmed.to_lowercase(), trimmed.to_string())
    }
}

#[derive(Debug, Default, Clone, Copy)]
struct Cell {
    hours: f64,
    /// Tage mit Buchungen an diesem Ort (im Team: Personentage).
    days: usize,
}

#[derive(Default)]
pub struct LocationAcc {
    ytd: BTreeMap<String, Cell>,
    months: BTreeMap<String, BTreeMap<String, Cell>>,
}

impl LocationAcc {
    /// Gearbeitete Stunden eines Tages je Ort (Schlüssel aus [`location_key`]).
    pub fn add_day(&mut self, date: NaiveDate, day: &BTreeMap<String, f64>) {
        let month = self.months.entry(month_key(date)).or_default();
        for (key, &hours) in day {
            if hours <= 0.0 {
                continue;
            }
            for cell in [
                self.ytd.entry(key.clone()).or_default(),
                month.entry(key.clone()).or_default(),
            ] {
                cell.hours += hours;
                cell.days += 1;
            }
        }
    }

    pub fn add_all(&mut self, other: &LocationAcc) {
        merge(&mut self.ytd, &other.ytd);
        for (month, cells) in &other.months {
            merge(self.months.entry(month.clone()).or_default(), cells);
        }
    }

    pub fn finish(&self, names: &HashMap<String, String>) -> LocationBreakdown {
        LocationBreakdown {
            ytd: shares(&self.ytd, names),
            by_month: self
                .months
                .iter()
                .map(|(month, cells)| (month.clone(), shares(cells, names)))
                .collect(),
        }
    }
}

fn merge(target: &mut BTreeMap<String, Cell>, source: &BTreeMap<String, Cell>) {
    for (key, cell) in source {
        let entry = target.entry(key.clone()).or_default();
        entry.hours += cell.hours;
        entry.days += cell.days;
    }
}

/// Anteile, absteigend nach Stunden.
fn shares(cells: &BTreeMap<String, Cell>, names: &HashMap<String, String>) -> Vec<LocationShare> {
    let total: f64 = cells.values().map(|c| c.hours).sum();
    let mut list: Vec<LocationShare> = cells
        .iter()
        .map(|(key, cell)| LocationShare {
            location: names
                .get(key)
                .cloned()
                .unwrap_or_else(|| location_key(key).1),
            hours: round2(cell.hours),
            share: if total > 0.0 {
                round2(cell.hours / total * 100.0)
            } else {
                0.0
            },
            days: cell.days,
        })
        .collect();
    list.sort_by(|a, b| {
        b.hours
            .total_cmp(&a.hours)
            .then_with(|| a.location.cmp(&b.location))
    });
    list
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, m, day).unwrap()
    }

    fn day(items: &[(&str, f64)]) -> BTreeMap<String, f64> {
        let mut map = BTreeMap::new();
        for (raw, hours) in items {
            *map.entry(location_key(raw).0).or_default() += hours;
        }
        map
    }

    #[test]
    fn groups_case_insensitively_and_counts_days() {
        let names: HashMap<String, String> = [
            ("home office".to_string(), "Home Office".to_string()),
            ("büro".to_string(), "Büro".to_string()),
            (String::new(), UNKNOWN_LOCATION.to_string()),
        ]
        .into();
        let mut erika = LocationAcc::default();
        erika.add_day(d(9, 30), &day(&[("Home Office", 6.0), ("Büro", 2.0)]));
        erika.add_day(d(10, 1), &day(&[("home office ", 8.0)]));
        erika.add_day(d(10, 2), &day(&[("", 4.0), ("Büro", 0.0)]));
        let mut max = LocationAcc::default();
        max.add_day(d(10, 1), &day(&[("Büro", 8.0)]));

        let result = erika.finish(&names);
        let ytd: Vec<(&str, f64, f64, usize)> = result
            .ytd
            .iter()
            .map(|s| (s.location.as_str(), s.hours, s.share, s.days))
            .collect();
        assert_eq!(
            ytd,
            vec![
                ("Home Office", 14.0, 70.0, 2),
                ("(ohne Angabe)", 4.0, 20.0, 1),
                ("Büro", 2.0, 10.0, 1),
            ]
        );
        assert_eq!(result.by_month["2026-10"].len(), 2);
        assert_eq!(result.by_month["2026-10"][0].share, 66.67);

        let mut team = LocationAcc::default();
        team.add_all(&erika);
        team.add_all(&max);
        let team = team.finish(&names);
        let office = team.ytd.iter().find(|s| s.location == "Büro").unwrap();
        assert_eq!((office.hours, office.days), (10.0, 2)); // Personentage
    }
}
