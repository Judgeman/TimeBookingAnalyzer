//! Gesetzliche Feiertage in Deutschland je Bundesland.
//!
//! Berücksichtigt nur landesweit geltende Feiertage. Regionale Sonderfälle
//! (z. B. Mariä Himmelfahrt in Teilen Bayerns, Fronleichnam in Teilen Sachsens
//! und Thüringens, Augsburger Friedensfest) lassen sich über `custom` ergänzen.

use std::collections::BTreeMap;

use chrono::{Datelike, Duration, NaiveDate, Weekday};
use serde::Serialize;

/// Bundesland-Kürzel und Name (für Validierung und Dropdown).
pub const REGIONS: [(&str, &str); 16] = [
    ("BW", "Baden-Württemberg"),
    ("BY", "Bayern"),
    ("BE", "Berlin"),
    ("BB", "Brandenburg"),
    ("HB", "Bremen"),
    ("HH", "Hamburg"),
    ("HE", "Hessen"),
    ("MV", "Mecklenburg-Vorpommern"),
    ("NI", "Niedersachsen"),
    ("NW", "Nordrhein-Westfalen"),
    ("RP", "Rheinland-Pfalz"),
    ("SL", "Saarland"),
    ("SN", "Sachsen"),
    ("ST", "Sachsen-Anhalt"),
    ("SH", "Schleswig-Holstein"),
    ("TH", "Thüringen"),
];

pub fn is_known_region(code: &str) -> bool {
    REGIONS.iter().any(|(c, _)| *c == code)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Holiday {
    pub date: NaiveDate,
    pub name: String,
}

/// Ostersonntag (gregorianisch, Gaußsche Osterformel in der Form von
/// Meeus/Jones/Butcher).
pub fn easter_sunday(year: i32) -> NaiveDate {
    let a = year % 19;
    let b = year / 100;
    let c = year % 100;
    let d = b / 4;
    let e = b % 4;
    let f = (b + 8) / 25;
    let g = (b - f + 1) / 3;
    let h = (19 * a + b - d - g + 15) % 30;
    let i = c / 4;
    let k = c % 4;
    let l = (32 + 2 * e + 2 * i - h - k) % 7;
    let m = (a + 11 * h + 22 * l) / 451;
    let month = (h + l - 7 * m + 114) / 31;
    let day = (h + l - 7 * m + 114) % 31 + 1;
    NaiveDate::from_ymd_opt(year, month as u32, day as u32).expect("gültiges Osterdatum")
}

/// Mittwoch vor dem 23. November.
fn buss_und_bettag(year: i32) -> NaiveDate {
    let mut date = NaiveDate::from_ymd_opt(year, 11, 22).unwrap();
    while date.weekday() != Weekday::Wed {
        date = date.pred_opt().unwrap();
    }
    date
}

/// Alle Feiertage eines Jahres für ein Bundesland, sortiert, inkl. zusätzlicher
/// freier Tage aus der Projektkonfiguration (nur die des angefragten Jahres).
pub fn holidays(year: i32, region: &str, custom: &[NaiveDate]) -> Vec<Holiday> {
    let ymd = |m: u32, d: u32| NaiveDate::from_ymd_opt(year, m, d).unwrap();
    let easter = easter_sunday(year);
    let after_easter = |days: i64| easter + Duration::days(days);
    let in_region = |codes: &[&str]| codes.contains(&region);

    let mut days: BTreeMap<NaiveDate, String> = BTreeMap::new();
    let mut add = |date: NaiveDate, name: &str| {
        days.entry(date).or_insert_with(|| name.to_string());
    };

    // Bundesweit
    add(ymd(1, 1), "Neujahr");
    add(after_easter(-2), "Karfreitag");
    add(after_easter(1), "Ostermontag");
    add(ymd(5, 1), "Tag der Arbeit");
    add(after_easter(39), "Christi Himmelfahrt");
    add(after_easter(50), "Pfingstmontag");
    add(ymd(10, 3), "Tag der Deutschen Einheit");
    add(ymd(12, 25), "1. Weihnachtstag");
    add(ymd(12, 26), "2. Weihnachtstag");

    // Landesweit in einzelnen Bundesländern
    if in_region(&["BW", "BY", "ST"]) {
        add(ymd(1, 6), "Heilige Drei Könige");
    }
    if (region == "BE" && year >= 2019) || (region == "MV" && year >= 2023) {
        add(ymd(3, 8), "Internationaler Frauentag");
    }
    if in_region(&["BW", "BY", "HE", "NW", "RP", "SL"]) {
        add(after_easter(60), "Fronleichnam");
    }
    if region == "SL" {
        add(ymd(8, 15), "Mariä Himmelfahrt");
    }
    if region == "TH" && year >= 2019 {
        add(ymd(9, 20), "Weltkindertag");
    }
    let reformation = in_region(&["BB", "MV", "SN", "ST", "TH"])
        || (in_region(&["HB", "HH", "NI", "SH"]) && year >= 2018)
        || year == 2017;
    if reformation {
        add(ymd(10, 31), "Reformationstag");
    }
    if in_region(&["BW", "BY", "NW", "RP", "SL"]) {
        add(ymd(11, 1), "Allerheiligen");
    }
    if region == "SN" {
        add(buss_und_bettag(year), "Buß- und Bettag");
    }

    for date in custom.iter().filter(|d| d.year() == year) {
        add(*date, "Zusätzlicher freier Tag");
    }

    days.into_iter()
        .map(|(date, name)| Holiday { date, name })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    #[test]
    fn easter_dates() {
        assert_eq!(easter_sunday(2019), d(2019, 4, 21));
        assert_eq!(easter_sunday(2024), d(2024, 3, 31));
        assert_eq!(easter_sunday(2025), d(2025, 4, 20));
        assert_eq!(easter_sunday(2026), d(2026, 4, 5));
        assert_eq!(easter_sunday(2027), d(2027, 3, 28));
        assert_eq!(easter_sunday(2038), d(2038, 4, 25));
    }

    #[test]
    fn hessen_2026() {
        let list = holidays(2026, "HE", &[]);
        let dates: Vec<NaiveDate> = list.iter().map(|h| h.date).collect();
        assert_eq!(
            dates,
            vec![
                d(2026, 1, 1),
                d(2026, 4, 3),
                d(2026, 4, 6),
                d(2026, 5, 1),
                d(2026, 5, 14),
                d(2026, 5, 25),
                d(2026, 6, 4),
                d(2026, 10, 3),
                d(2026, 12, 25),
                d(2026, 12, 26),
            ]
        );
        assert_eq!(list[5].name, "Pfingstmontag");
        assert_eq!(list[6].name, "Fronleichnam");
    }

    #[test]
    fn regional_differences() {
        let has = |region: &str, date: NaiveDate| {
            holidays(date.year(), region, &[])
                .iter()
                .any(|h| h.date == date)
        };
        assert!(has("BY", d(2026, 1, 6)));
        assert!(!has("HE", d(2026, 1, 6)));
        assert!(has("NW", d(2026, 11, 1)));
        assert!(has("NI", d(2026, 10, 31)));
        assert!(!has("NI", d(2016, 10, 31)));
        assert!(has("NI", d(2017, 10, 31))); // Reformationsjubiläum bundesweit
        assert!(has("SN", d(2026, 11, 18))); // Buß- und Bettag
        assert!(has("SN", d(2025, 11, 19)));
        assert!(has("BE", d(2026, 3, 8)));
        assert!(!has("MV", d(2022, 3, 8)));
        assert!(has("TH", d(2026, 9, 20)));
        assert!(has("SL", d(2026, 8, 15)));
        assert!(!has("BE", d(2026, 6, 4)));
    }

    #[test]
    fn custom_days_of_the_year_are_added() {
        let custom = [d(2026, 12, 24), d(2025, 12, 24), d(2026, 1, 1)];
        let list = holidays(2026, "HE", &custom);
        assert!(
            list.iter()
                .any(|h| h.date == d(2026, 12, 24) && h.name == "Zusätzlicher freier Tag")
        );
        assert!(!list.iter().any(|h| h.date == d(2025, 12, 24)));
        // Doppelte Tage behalten den gesetzlichen Namen.
        assert_eq!(list[0].name, "Neujahr");
    }

    #[test]
    fn all_regions_known() {
        assert!(is_known_region("HE"));
        assert!(!is_known_region("XX"));
        assert_eq!(REGIONS.len(), 16);
    }
}
