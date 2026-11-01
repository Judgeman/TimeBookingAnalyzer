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

    let evaluation = calculation::evaluate(
        config,
        &outcome.entries,
        cutoff_date,
        export.map(|(d, _)| d),
    );
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
        flagged: evaluation.flagged,
        missing: evaluation.missing,
        missing_checked_until: evaluation.missing_checked_until,
        missing_threshold_percent: config.missing_threshold_percent,
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
        assert_eq!(result.entry_count, 676);
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
        assert_eq!((erika.sick_days, erika.sick_h), (2.5, 20.0)); // inkl. halber Tag
        assert_eq!(erika.soll_n, 1501.0);
        assert_eq!(erika.gearb, 1542.0);
        assert_eq!(erika.bill_h, 1485.0);
        assert_eq!(erika.bill_eur, 151_940.0);
        assert_eq!(erika.nonbill_h, 57.0);
        assert_eq!((erika.plus, erika.plus_krank), (41.0, 21.0));

        let max = &auswertung.persons[1].periods.ytd;
        // Ab September 6 h/Tag (Ausnahme bei der Person): 44 Werktage × 1,5 h weniger
        assert_eq!(max.soll_b, 1570.0);
        // Urlaub inkl. Samstag 25.07. (zählt, wird hervorgehoben)
        assert_eq!((max.vac_days, max.vac_h), (11.0, 82.5));
        assert_eq!((max.sick_days, max.sick_h), (3.0, 18.0));
        assert_eq!(max.gearb, 1561.0);
        assert_eq!(max.bill_eur, 141_045.0);
        assert_eq!((max.plus, max.plus_krank), (91.5, 73.5));

        // Arbeitsorte (Basis = gearbeitete Stunden)
        let share = |person: usize, location: &str| {
            auswertung.persons[person]
                .periods
                .locations
                .ytd
                .iter()
                .find(|s| s.location == location)
                .map(|s| (s.hours, s.share, s.days))
                .unwrap()
        };
        assert_eq!(share(0, "Home Office"), (311.5, 20.2, 41));
        assert_eq!(share(0, "Büro"), (1226.0, 79.51, 152));
        assert_eq!(share(1, "Home Office"), (1460.0, 93.53, 188));

        // Fehlende Buchungen: Erika 20.10. ohne Buchung, Max 22.10. nur 2 von 6 h;
        // Erika 16.09. mit 4 von 7,5 h (53 %) liegt über der Schwelle.
        let missing: Vec<(&str, String, f64)> = auswertung
            .missing
            .iter()
            .map(|m| (m.person.as_str(), m.date.to_string(), m.coverage_percent))
            .collect();
        assert_eq!(
            missing,
            vec![
                ("Erika Mustermann", "2026-10-20".to_string(), 0.0),
                ("Max Mustermann", "2026-10-22".to_string(), 33.33),
            ]
        );
        assert_eq!(
            auswertung.persons[0].periods.by_month["2026-10"].missing_days,
            1.0
        );

        assert_eq!(auswertung.flagged.len(), 1);
        assert_eq!(auswertung.flagged[0].reasons, vec!["Samstag".to_string()]);

        let invoice = &auswertung.invoice;
        assert_eq!(invoice.months.len(), 10);
        assert!(!invoice.months[9].partial); // Stichtag 31.10. = Monatsende
        assert_eq!(invoice.total.net, 292_985.0);
        assert_eq!(invoice.total.vat, 55_612.27);
        assert_eq!(invoice.total.gross, 348_597.27);
        // Schulung mit 7 % USt. (eigene Abrechnungsregel)
        let reduced = &invoice.total.vat_groups[0];
        assert_eq!(
            (reduced.vat_percent, reduced.net, reduced.vat),
            (7.0, 457.5, 32.03)
        );
    }
}
