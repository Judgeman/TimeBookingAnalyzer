pub mod cells;
pub mod export;
pub mod summary;

use std::path::Path;

use chrono::{DateTime, Datelike, Local, NaiveDate};

/// "Stand" des Exports: Datum im Dateinamen (z. B. `…_2026-10-31.xlsx`,
/// `…_31.10.2026.xlsx` oder `…_20261031.xlsx`), sonst Änderungsdatum der Datei.
pub fn export_date(path: &Path) -> Option<NaiveDate> {
    let file_name = path.file_stem()?.to_string_lossy();
    date_from_file_name(&file_name).or_else(|| file_modified_date(path))
}

pub fn date_from_file_name(name: &str) -> Option<NaiveDate> {
    let chars: Vec<char> = name.chars().collect();

    // 10 Zeichen: 2026-10-31, 2026_10_31, 31.10.2026
    const FORMATS_10: [&str; 3] = ["%Y-%m-%d", "%Y_%m_%d", "%d.%m.%Y"];
    let found = chars.windows(10).find_map(|window| {
        // chrono parst nachsichtig (führende Leerzeichen, 3-stellige Jahre) –
        // deshalb nur Fenster aus Ziffern/Trennern, die mit Ziffern beginnen und enden.
        let shape_ok = window[0].is_ascii_digit()
            && window[9].is_ascii_digit()
            && window
                .iter()
                .all(|c| c.is_ascii_digit() || matches!(c, '-' | '_' | '.'));
        if !shape_ok {
            return None;
        }
        let candidate: String = window.iter().collect();
        FORMATS_10
            .iter()
            .find_map(|fmt| NaiveDate::parse_from_str(&candidate, fmt).ok())
            .filter(plausible)
    });
    if found.is_some() {
        return found;
    }

    // 8 Ziffern am Stück: 20261031
    name.split(|c: char| !c.is_ascii_digit())
        .filter(|run| run.len() == 8)
        .find_map(|run| {
            NaiveDate::parse_from_str(run, "%Y%m%d")
                .ok()
                .filter(plausible)
        })
}

fn plausible(date: &NaiveDate) -> bool {
    (2000..2100).contains(&date.year())
}

fn file_modified_date(path: &Path) -> Option<NaiveDate> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    Some(DateTime::<Local>::from(modified).date_naive())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date(y: i32, m: u32, d: u32) -> Option<NaiveDate> {
        NaiveDate::from_ymd_opt(y, m, d)
    }

    #[test]
    fn finds_dates_in_file_names() {
        assert_eq!(
            date_from_file_name("ProjectForge-Export_2026-10-31"),
            date(2026, 10, 31)
        );
        assert_eq!(
            date_from_file_name("export 31.10.2026 final"),
            date(2026, 10, 31)
        );
        assert_eq!(
            date_from_file_name("Zeitberichte_2026_10_31"),
            date(2026, 10, 31)
        );
        assert_eq!(
            date_from_file_name("timesheets-20261031"),
            date(2026, 10, 31)
        );
        assert_eq!(
            date_from_file_name("Auswertung-Ü-20261031"),
            date(2026, 10, 31)
        );
        assert_eq!(date_from_file_name("export"), None);
        assert_eq!(date_from_file_name("export-12345678"), None);
        assert_eq!(date_from_file_name("v1.10.2026"), None);
    }

    #[test]
    fn falls_back_to_modification_date() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("export.xlsx");
        std::fs::write(&path, b"x").unwrap();
        assert_eq!(export_date(&path), Some(Local::now().date_naive()));
    }
}
