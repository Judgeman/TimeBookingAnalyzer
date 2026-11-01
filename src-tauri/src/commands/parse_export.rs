//! Tauri-Command: Export-Datei einlesen und auswerten.

use std::path::Path;

use chrono::NaiveDate;
use tauri::State;

use crate::calculation;
use crate::models::config::ProjectConfig;
use crate::models::results::AuswertungResult;
use crate::parsing::{export::read_export, export_date, summary::summarize};
use crate::storage::projects::ProjectStore;

/// Liest den Export mit dem Spalten-Mapping des Projekts ein und wertet ihn aus.
///
/// `cutoff_date` (Stichtag) ist optional; ohne Vorgabe gilt das Export-Datum
/// („Stand“), ersatzweise die letzte Buchung im Export.
#[tauri::command]
pub async fn parse_export(
    file_path: String,
    project_id: String,
    cutoff_date: Option<NaiveDate>,
    store: State<'_, ProjectStore>,
) -> Result<AuswertungResult, String> {
    let config = store.get(&project_id)?;
    // calamine liest synchron – nicht auf dem Async-Runtime-Thread blockieren.
    tauri::async_runtime::spawn_blocking(move || {
        parse_export_file(Path::new(&file_path), &config, cutoff_date)
    })
    .await
    .map_err(|e| format!("Einlesen abgebrochen: {e}"))?
}

pub fn parse_export_file(
    path: &Path,
    config: &ProjectConfig,
    cutoff: Option<NaiveDate>,
) -> Result<AuswertungResult, String> {
    let outcome = read_export(path, &config.export_format)?;
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let export = export_date(path);

    let last_entry = outcome.entries.iter().map(|e| e.date).max();
    let default_cutoff = export
        .map(|(date, _)| date)
        .or(last_entry)
        .ok_or("Export enthält keine Buchungen.")?;
    let cutoff_date = cutoff.unwrap_or(default_cutoff);

    let evaluation = calculation::evaluate(config, &outcome.entries, cutoff_date);
    let overview = summarize(config, file_name.clone(), export.map(|(d, _)| d), outcome);

    Ok(AuswertungResult {
        project_id: config.id.clone(),
        project_name: config.name.clone(),
        file_name,
        export_date: export.map(|(d, _)| d),
        export_date_source: export.map(|(_, source)| source),
        period_start: evaluation.period_start,
        cutoff_date,
        default_cutoff_date: default_cutoff,
        persons: evaluation.persons,
        team: evaluation.team,
        invoice: evaluation.invoice,
        holiday_region: config.holidays.region.clone(),
        holidays: evaluation.holidays,
        warnings: evaluation.warnings,
        overview,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::results::ExportDateSource;
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

        let auswertung =
            parse_export_file(&sample("Beispiel-Export_2026-10-31.xlsx"), &config, None).unwrap();
        assert_eq!(
            auswertung.cutoff_date,
            NaiveDate::from_ymd_opt(2026, 10, 31).unwrap()
        );
        assert_eq!(
            auswertung.export_date_source,
            Some(ExportDateSource::FileName)
        );
        let result = &auswertung.overview;

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

        // Werte unabhängig nachgerechnet (Python, direkt aus der xlsx nach den
        // Formeln in CLAUDE.md) – Jonas ist nicht im Team und fehlt hier.
        assert!(auswertung.warnings.is_empty(), "{:?}", auswertung.warnings);
        let names: Vec<&str> = auswertung.persons.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, vec!["Erika Mustermann", "Max Mustermann"]);

        let erika = &auswertung.persons[0].periods.ytd;
        assert_eq!(erika.soll_b, 1636.0);
        assert_eq!((erika.vac_days, erika.vac_h), (15.0, 115.0));
        assert_eq!((erika.sick_days, erika.sick_h), (2.0, 16.0));
        assert_eq!(erika.soll_n, 1505.0);
        assert_eq!(erika.gearb, 1558.0);
        assert_eq!(erika.bill_h, 1499.5);
        assert_eq!(erika.bill_eur, 152_992.5);
        assert_eq!(erika.nonbill_h, 58.5);
        assert_eq!((erika.plus, erika.plus_krank), (53.0, 37.0));

        let max = &auswertung.persons[1].periods.ytd;
        assert_eq!((max.vac_h, max.sick_h), (75.0, 22.5));
        assert_eq!(max.gearb, 1567.0);
        assert_eq!(max.bill_eur, 141_520.0);
        assert_eq!((max.plus, max.plus_krank), (28.5, 6.0));

        let invoice = &auswertung.invoice;
        assert_eq!(invoice.months.len(), 10);
        assert!(!invoice.months[9].partial); // Stichtag 31.10. = Monatsende
        assert_eq!(invoice.total.net, 294_512.5);
        assert_eq!(invoice.total.vat, 55_957.38);
        assert_eq!(invoice.total.gross, 350_469.88);
    }
}
