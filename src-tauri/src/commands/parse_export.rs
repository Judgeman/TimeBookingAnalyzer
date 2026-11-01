//! Tauri-Command: Export-Datei einlesen.

use std::path::Path;

use tauri::State;

use crate::models::config::ProjectConfig;
use crate::models::results::ParsedExport;
use crate::parsing::{export::read_export, export_date, summary::summarize};
use crate::storage::projects::ProjectStore;

/// Liest den Export mit dem Spalten-Mapping des Projekts ein.
///
/// Liefert vorerst eine Übersicht (`ParsedExport`); die Berechnung von
/// Soll/Ist/Billable (`AuswertungResult`) baut im nächsten Schritt darauf auf.
#[tauri::command]
pub async fn parse_export(
    file_path: String,
    project_id: String,
    store: State<'_, ProjectStore>,
) -> Result<ParsedExport, String> {
    let config = store.get(&project_id)?;
    // calamine liest synchron – nicht auf dem Async-Runtime-Thread blockieren.
    tauri::async_runtime::spawn_blocking(move || parse_export_file(Path::new(&file_path), &config))
        .await
        .map_err(|e| format!("Einlesen abgebrochen: {e}"))?
}

pub fn parse_export_file(path: &Path, config: &ProjectConfig) -> Result<ParsedExport, String> {
    let outcome = read_export(path, &config.export_format)?;
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(summarize(config, file_name, export_date(path), outcome))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;
    use std::path::PathBuf;

    fn sample(file: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../sample-data")
            .join(file)
    }

    /// Hält die fiktiven Beispieldaten in `sample-data/` und den Parser synchron.
    #[test]
    fn parses_bundled_sample_export() {
        let json = std::fs::read_to_string(sample("beispiel-projekt.json")).unwrap();
        let config: ProjectConfig = serde_json::from_str(&json).unwrap();
        config.validate().unwrap();

        let result =
            parse_export_file(&sample("Beispiel-Export_2026-10-31.xlsx"), &config).unwrap();

        assert_eq!(result.file_name, "Beispiel-Export_2026-10-31.xlsx");
        assert_eq!(result.sheet_name, "Details");
        assert_eq!(result.export_date, NaiveDate::from_ymd_opt(2026, 10, 31));
        assert_eq!(result.first_entry_date, NaiveDate::from_ymd_opt(2026, 1, 2));
        assert_eq!(
            result.last_entry_date,
            NaiveDate::from_ymd_opt(2026, 10, 30)
        );
        assert_eq!(result.entry_count, 677);
        assert!(result.skipped_rows.is_empty(), "{:?}", result.skipped_rows);
        assert!(result.missing_team_members.is_empty());

        let persons: Vec<(&str, bool)> = result
            .persons
            .iter()
            .map(|p| (p.name.as_str(), p.in_team))
            .collect();
        assert_eq!(
            persons,
            vec![
                ("Erika Mustermann", true),
                ("Max Mustermann", true),
                ("Jonas Beispiel", false)
            ]
        );
        let jonas = &result.persons[2];
        assert_eq!(jonas.project_hours, 0.0);
        assert!(result.persons[0].project_hours > 0.0);
    }
}
