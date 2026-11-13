//! Stresstest: viele zufällige, aber reproduzierbare Exporte und
//! Projektkonfigurationen (fiktive Daten) laufen durch die komplette
//! Auswertung – sie darf nie abstürzen, sondern liefert ein Ergebnis oder eine
//! Fehlermeldung. Anzahl der Fälle über `ROBUSTNESS_CASES` (Standard 150);
//! mit `ROBUSTNESS_DUMP=<Ordner>` werden die Ergebnisse als JSON abgelegt.

use std::panic::{AssertUnwindSafe, catch_unwind};

use chrono::NaiveDate;

use super::parse_export::evaluate_export;
use crate::models::config::{
    AssignmentPeriod, BillableColumn, BudgetPeriod, Guest, PlannedAbsence, PlannedAbsenceKind,
    ProjectConfig, RatePeriod, VacationEntitlement, WorkingHoursPeriod,
};
use crate::models::entry::TimeEntry;
use crate::models::results::ExportDateSource;
use crate::parsing::export::ParseOutcome;

/// Kleiner deterministischer Zufallsgenerator (xorshift64*).
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
    fn chance(&mut self, percent: u64) -> bool {
        self.next() % 100 < percent
    }
    fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        &items[self.below(items.len())]
    }
}

const NAMES: [&str; 8] = [
    "Erika Mustermann",
    "erika mustermann ",
    "Max Mustermann",
    "Lena Beispiel",
    "Karl Beispiel",
    "Jonas Beispiel",
    "Jörg Beispiel",
    "",
];
const ELEMENTS: [&str; 7] = [
    "P100 Lager-App",
    "p100 lager-app",
    "P200 Intranet",
    "(Sick)",
    "(Vacation)",
    "Z900 Intern",
    "",
];
const KOST2ART: [&str; 6] = [
    "Delivery (billable)",
    "DELIVERY (BILLABLE)",
    "Travel (billable)",
    "Management",
    "Sales",
    "",
];

fn date(rng: &mut Rng) -> NaiveDate {
    let year = *rng.pick(&[1899, 1900, 2024, 2025, 2026, 2026, 2026, 2027, 2100, 9999]);
    let month = 1 + rng.below(12) as u32;
    let day = 1 + rng.below(31) as u32;
    NaiveDate::from_ymd_opt(year, month, day)
        .or_else(|| NaiveDate::from_ymd_opt(year, month, 28))
        .unwrap()
}

/// Meist ein Datum nahe 2026, gelegentlich extreme Jahre.
fn near_date(rng: &mut Rng) -> NaiveDate {
    if rng.chance(85) {
        let base = NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
        base + chrono::Days::new(rng.below(420) as u64) - chrono::Days::new(30)
    } else {
        date(rng)
    }
}

fn entry(rng: &mut Rng) -> TimeEntry {
    TimeEntry {
        name: rng.pick(&NAMES).to_string(),
        date: near_date(rng),
        hours: *rng.pick(&[0.0, 0.25, 4.0, 8.0, 8.0, 8.8, 12.0, 24.0, -4.0, 1e6, 0.0001]),
        mult: *rng.pick(&[1.0, 1.0, 1.0, 0.0, 0.5, -1.0, 2.0, 1e9]),
        element: rng.pick(&ELEMENTS).to_string(),
        kost2art: rng.pick(&KOST2ART).to_string(),
        location: rng.pick(&["Home Office", "Büro", "", "KUNDE"]).to_string(),
        billable: rng
            .pick(&[None, Some("WAHR"), Some("FALSCH"), Some(""), Some("ja")])
            .map(str::to_string),
        ..Default::default()
    }
}

fn period(rng: &mut Rng) -> (NaiveDate, Option<NaiveDate>) {
    let from = near_date(rng);
    let to = rng
        .chance(60)
        .then(|| from + chrono::Days::new(rng.below(400) as u64));
    (from, to)
}

fn month_key(date: NaiveDate) -> String {
    date.format("%Y-%m").to_string()
}

/// Zufällige Variante der Beispielkonfiguration; nur gültige (wie in der App
/// gespeichert) werden verwendet.
fn config(rng: &mut Rng, sample: &ProjectConfig) -> ProjectConfig {
    let mut config = sample.clone();
    if rng.chance(20) {
        config.working_hours.clear();
    } else if rng.chance(20) {
        let (from, to) = period(rng);
        config.working_hours = vec![WorkingHoursPeriod {
            from,
            to,
            hours_per_day: *rng.pick(&[0.0, 4.0, 8.8, 24.0]),
        }];
    }
    for member in &mut config.team {
        if rng.chance(25) {
            member.rates.clear();
        } else if rng.chance(15) {
            let (from, to) = period(rng);
            member.rates = vec![RatePeriod {
                from,
                to,
                rate: *rng.pick(&[0.0, 0.01, 105.0, 1e7]),
            }];
        }
        if rng.chance(25) {
            let (from, to) = period(rng);
            member.assignments = vec![AssignmentPeriod { from, to }];
        }
        if rng.chance(15) {
            let (from, to) = period(rng);
            member.working_hours = vec![WorkingHoursPeriod {
                from,
                to,
                hours_per_day: *rng.pick(&[0.0, 6.0, 8.8]),
            }];
        }
        member.untracked = rng.chance(20);
        if rng.chance(30) {
            member.vacation = vec![VacationEntitlement {
                year: *rng.pick(&[2025, 2026, 2027]),
                days: *rng.pick(&[0.0, 30.0, 366.0]),
                carry_over: *rng.pick(&[0.0, -5.0, 12.5]),
            }];
        }
    }
    if rng.chance(30) {
        config.guests.clear();
    } else if rng.chance(30) {
        config.guests = vec![Guest {
            name: "Jonas Beispiel".into(),
            rates: vec![],
        }];
    }
    if rng.chance(40) {
        config.planned_absences = (0..rng.below(4))
            .map(|_| {
                let from = near_date(rng);
                PlannedAbsence {
                    person: rng.pick(&NAMES[..4]).trim().to_string(),
                    from,
                    to: from + chrono::Days::new(rng.below(20) as u64),
                    kind: *rng.pick(&[PlannedAbsenceKind::Vacation, PlannedAbsenceKind::Other]),
                    half_day: rng.chance(30),
                }
            })
            .collect();
    }
    if rng.chance(50) {
        config.budgets = (0..rng.below(3))
            .map(|_| {
                let from = near_date(rng);
                let to = from + chrono::Days::new(rng.below(800) as u64);
                BudgetPeriod {
                    from: month_key(from),
                    to: month_key(to),
                    amount: *rng.pick(&[0.0, 1.0, 360_000.0, 1e12]),
                }
            })
            .collect();
    }
    if rng.chance(40) {
        config.export_format.billable = Some(BillableColumn {
            column: 14,
            yes: rng.pick(&["", "ja"]).to_string(),
            no: rng.pick(&["", "nein"]).to_string(),
        });
    }
    if rng.chance(15) {
        config.billing_rules.clear();
    }
    config.missing_threshold_percent = *rng.pick(&[0.0, 50.0, 100.0]);
    config
}

#[test]
fn random_exports_never_crash_the_evaluation() {
    let json = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../sample-data/beispiel-projekt.json"),
    )
    .unwrap();
    let sample: ProjectConfig = serde_json::from_str(&json).unwrap();
    let cases: usize = std::env::var("ROBUSTNESS_CASES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(150);
    let mut rng = Rng(0x5EED_2026_1110);
    let (mut evaluated, mut rejected) = (0, 0);
    for case in 0..cases {
        let config = config(&mut rng, &sample);
        if config.validate().is_err() {
            rejected += 1;
            continue;
        }
        let entries: Vec<TimeEntry> = (0..rng.below(80)).map(|_| entry(&mut rng)).collect();
        let export = rng
            .chance(70)
            .then(|| (near_date(&mut rng), ExportDateSource::FileName));
        let cutoff = rng.chance(60).then(|| near_date(&mut rng));
        let outcome = ParseOutcome {
            sheet_name: "Details".into(),
            entries: entries.clone(),
            skipped: vec![],
            notes: vec![],
        };
        let run = catch_unwind(AssertUnwindSafe(|| {
            evaluate_export(&config, outcome, "Export.xlsx".into(), export, cutoff).map(|result| {
                let json = serde_json::to_string(&result).unwrap();
                // Ergebnisse für den Oberflächen-Test ablegen (ROBUSTNESS_DUMP=<Ordner>)
                if let Ok(dir) = std::env::var("ROBUSTNESS_DUMP") {
                    std::fs::write(format!("{dir}/case-{case}.json"), &json).unwrap();
                }
                json.len()
            })
        }));
        match run {
            Ok(_) => evaluated += 1,
            Err(panic) => {
                let message = panic
                    .downcast_ref::<String>()
                    .cloned()
                    .or_else(|| panic.downcast_ref::<&str>().map(|s| s.to_string()))
                    .unwrap_or_default();
                panic!(
                    "Fall {case} stürzt ab: {message}\nStichtag {cutoff:?}, Stand {export:?}\nKonfiguration: {}\nBuchungen: {entries:#?}",
                    serde_json::to_string(&config).unwrap()
                );
            }
        }
    }
    assert!(
        evaluated > cases / 2,
        "nur {evaluated} von {cases} ausgewertet ({rejected} ungültig)"
    );
}
