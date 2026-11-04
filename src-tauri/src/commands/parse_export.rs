//! Tauri-Command: Export-Datei einlesen und auswerten.

use std::path::Path;

use chrono::NaiveDate;
use tauri::State;

use crate::calculation;
use crate::models::config::ProjectConfig;
use crate::models::results::AuswertungResult;
use crate::parsing::{export::read_export, export_date, summary::summarize};
use crate::storage::forecasts::{ForecastStore, Snapshot, apply_recorded};
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
    forecasts: State<'_, ForecastStore>,
) -> Result<AuswertungResult, String> {
    let config = store.get(&project_id)?;
    // calamine liest synchron – nicht auf dem Async-Runtime-Thread blockieren.
    let mut result = tauri::async_runtime::spawn_blocking(move || {
        parse_export_file(Path::new(&file_path), &config, cutoff_date)
    })
    .await
    .map_err(|e| format!("Einlesen abgebrochen: {e}"))??;
    track_forecast(&forecasts, &project_id, &mut result);
    Ok(result)
}

/// Prognosegüte: Prognose eines vollständigen Exports (Stand der Daten =
/// Stand des Exports) speichern und gespeicherte Prognosen den Monaten zuordnen.
/// Fehler beim Speichern verhindern die Auswertung nicht – sie werden Hinweise.
pub fn track_forecast(store: &ForecastStore, project_id: &str, result: &mut AuswertungResult) {
    let data_end = result.forecast.from.pred_opt();
    if result.export_date.is_some()
        && result.export_date == data_end
        && let Err(e) = store.record(project_id, Snapshot::of(&result.forecast))
    {
        result.warnings.push(e);
    }
    match store.load(project_id) {
        Ok(snapshots) => apply_recorded(&mut result.forecast_accuracy, &snapshots),
        Err(e) => result.warnings.push(e),
    }
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
    let forecast = calculation::forecast::build(config, &outcome.entries, &evaluation);
    let forecast_accuracy = calculation::forecast::backtest(config, &outcome.entries, &evaluation);
    let vacation = calculation::vacation::vacation_status(config, &evaluation);
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
        outside: evaluation.outside,
        guests: config.guests.iter().map(|g| g.name.clone()).collect(),
        guest_bookings: evaluation.guest_bookings,
        forecast,
        forecast_accuracy,
        vacation,
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

    /// Vertragstest Rust ↔ Frontend: Das Auswertungsergebnis der Beispieldaten
    /// liegt als JSON in `src/test/fixtures/sample-result.json`; die
    /// Frontend-Tests prüfen es gegen die TypeScript-Typen. Ändert sich das
    /// Ergebnis, schlägt dieser Test fehl – neu erzeugen mit
    /// `UPDATE_FIXTURES=1 cargo test frontend_fixture`.
    #[test]
    fn frontend_fixture_is_up_to_date() {
        let json = std::fs::read_to_string(sample("beispiel-projekt.json")).unwrap();
        let config: ProjectConfig = serde_json::from_str(&json).unwrap();
        let result =
            parse_export_file(&sample("Beispiel-Export_2026-10-31.xlsx"), &config, None).unwrap();
        let actual = serde_json::to_string_pretty(&result).unwrap() + "\n";
        let fixture =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/test/fixtures/sample-result.json");

        if std::env::var_os("UPDATE_FIXTURES").is_some() {
            std::fs::create_dir_all(fixture.parent().unwrap()).unwrap();
            std::fs::write(&fixture, &actual).unwrap();
            return;
        }
        let expected = std::fs::read_to_string(&fixture).unwrap_or_default();
        assert!(
            expected == actual,
            "{} ist veraltet – mit `UPDATE_FIXTURES=1 cargo test frontend_fixture` neu erzeugen.",
            fixture.display()
        );
    }

    /// Die gemerkte Kopie im Ordner `Import` ergibt dieselbe Auswertung
    /// (Dateiname → „Stand“ des Exports bleibt erhalten).
    #[test]
    fn remembered_copy_evaluates_like_the_original() {
        use crate::storage::imports::ImportStore;
        let json = std::fs::read_to_string(sample("beispiel-projekt.json")).unwrap();
        let config: ProjectConfig = serde_json::from_str(&json).unwrap();
        let original = sample("Beispiel-Export_2026-10-31.xlsx");
        let tmp = tempfile::tempdir().unwrap();
        let imports = ImportStore::new(tmp.path().join("Import"));
        let copy = imports.remember(&config.id, &original).unwrap();

        let a = parse_export_file(&original, &config, None).unwrap();
        let b = parse_export_file(Path::new(&copy.path), &config, None).unwrap();
        assert_eq!(b.export_date_source, Some(ExportDateSource::FileName));
        assert_eq!((b.file_name, b.cutoff_date), (a.file_name, a.cutoff_date));
        assert_eq!(b.invoice.total, a.invoice.total);
    }

    #[test]
    fn saves_forecasts_of_full_exports_and_compares_them_later() {
        use crate::storage::forecasts::{ForecastStore, Snapshot, SnapshotMonth};
        let json = std::fs::read_to_string(sample("beispiel-projekt.json")).unwrap();
        let config: ProjectConfig = serde_json::from_str(&json).unwrap();
        let file = sample("Beispiel-Export_2026-10-31.xlsx");
        let d = |m, day| NaiveDate::from_ymd_opt(2026, m, day).unwrap();
        let tmp = tempfile::tempdir().unwrap();
        let store = ForecastStore::new(tmp.path().join("Prognosen"));

        // Stichtag vor dem Stand des Exports → keine echte Prognose, nicht gespeichert
        let mut early = parse_export_file(&file, &config, Some(d(9, 30))).unwrap();
        track_forecast(&store, "p", &mut early);
        assert!(store.load("p").unwrap().is_empty());

        // vollständiger Export → gespeichert (Stand 31.10.)
        let mut full = parse_export_file(&file, &config, None).unwrap();
        track_forecast(&store, "p", &mut full);
        let saved = store.load("p").unwrap();
        assert_eq!(saved.len(), 1);
        assert_eq!(saved[0].data_end, d(10, 31));
        assert_eq!(saved[0].months[0].month, "2026-11");

        // früher gespeicherte Prognose (Stand 31.08.) wird September/Oktober zugeordnet
        store
            .record(
                "p",
                Snapshot {
                    data_end: d(8, 31),
                    recorded_at: d(9, 1).and_hms_opt(8, 0, 0).unwrap(),
                    months: ["2026-09", "2026-10"]
                        .iter()
                        .map(|m| SnapshotMonth {
                            month: m.to_string(),
                            actual_net: 0.0,
                            forecast_net: 31_000.0,
                        })
                        .collect(),
                },
            )
            .unwrap();
        let mut later = parse_export_file(&file, &config, None).unwrap();
        track_forecast(&store, "p", &mut later);
        let recorded: Vec<(&str, Option<f64>, Option<NaiveDate>)> = later
            .forecast_accuracy
            .iter()
            .skip(7)
            .map(|m| (m.month.as_str(), m.recorded_net, m.recorded_on))
            .collect();
        assert_eq!(
            recorded,
            vec![
                ("2026-08", None, None),
                ("2026-09", Some(31_000.0), Some(d(8, 31))),
                ("2026-10", Some(31_000.0), Some(d(8, 31))),
            ]
        );

        // kaputte Datei → Hinweis statt Fehler
        std::fs::write(tmp.path().join("Prognosen").join("p.json"), "{").unwrap();
        let mut broken = parse_export_file(&file, &config, Some(d(9, 30))).unwrap();
        track_forecast(&store, "p", &mut broken);
        assert!(
            broken.warnings.iter().any(|w| w.contains("fehlerhaft")),
            "{:?}",
            broken.warnings
        );
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
        assert_eq!(result.entry_count, 892);
        assert!(result.skipped_rows.is_empty(), "{:?}", result.skipped_rows);
        assert!(result.missing_team_members.is_empty());

        let persons: Vec<(&str, bool, bool)> = result
            .persons
            .iter()
            .map(|p| (p.name.as_str(), p.in_team, p.guest))
            .collect();
        assert_eq!(
            persons,
            vec![
                ("Erika Mustermann", true, false),
                ("Lena Beispiel", true, false),
                ("Max Mustermann", true, false),
                ("Karl Beispiel", false, true),
                ("Jonas Beispiel", false, false)
            ]
        );
        let jonas = &result.persons[4];
        assert_eq!(jonas.project_hours, 3.0); // Code-Review am 01.10.
        assert!(result.persons[0].project_hours > 0.0);

        // Werte unabhängig nachgerechnet (Python, direkt aus der xlsx nach den
        // Formeln in CLAUDE.md) – Jonas ist nicht im Team und fehlt hier.
        assert!(auswertung.warnings.is_empty(), "{:?}", auswertung.warnings);
        let names: Vec<&str> = auswertung.persons.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(
            names,
            vec!["Erika Mustermann", "Max Mustermann", "Lena Beispiel"]
        );

        // Lena: nur Januar/Februar im Team (Einsatzzeitraum)
        let lena = &auswertung.persons[2];
        assert_eq!(lena.assignments.len(), 1);
        assert_eq!(
            (lena.periods.ytd.soll_b, lena.periods.ytd.gearb),
            (328.0, 328.0)
        );
        assert_eq!(lena.periods.ytd.plus, 0.0);
        assert_eq!(lena.periods.ytd.missing_days, 0.0);
        assert_eq!(lena.periods.by_month["2026-04"].soll_b, 0.0);
        assert_eq!(lena.periods.ytd.bill_eur, 26_400.0); // 330 h × 80 € inkl. Übergabe

        // Buchungen aufs Projekt „außerhalb des Teams“
        let outside: Vec<(&str, String, bool, f64)> = auswertung
            .outside
            .iter()
            .map(|o| (o.person.as_str(), o.date.to_string(), o.invoiced, o.net))
            .collect();
        assert_eq!(
            outside,
            vec![
                ("Lena Beispiel", "2026-03-02".to_string(), true, 160.0),
                ("Jonas Beispiel", "2026-10-01".to_string(), false, 0.0),
            ]
        );

        // Karl: Rolle „darf buchen“ – nur Projektbuchungen, abgerechnet nach Kost2Art
        assert_eq!(auswertung.guests, vec!["Karl Beispiel".to_string()]);
        let karl: Vec<(String, f64, bool, f64)> = auswertung
            .guest_bookings
            .iter()
            .map(|b| (b.date.to_string(), b.hours, b.invoiced, b.net))
            .collect();
        assert_eq!(
            karl,
            vec![
                ("2026-02-10".to_string(), 3.0, false, 0.0), // Management
                ("2026-06-16".to_string(), 4.0, true, 480.0), // Delivery × 120 €
                ("2026-09-22".to_string(), 2.0, false, 0.0),
            ]
        );

        // Prognose (unabhängig nachgerechnet): Faktoren aus Januar–Oktober,
        // geplante Abwesenheiten, Budget 360.000 € für 2026
        let forecast = &auswertung.forecast;
        assert_eq!(
            (forecast.from, forecast.to),
            (
                NaiveDate::from_ymd_opt(2026, 11, 1).unwrap(),
                NaiveDate::from_ymd_opt(2026, 12, 31).unwrap()
            )
        );
        let erika_forecast = &forecast.persons[0];
        assert_eq!(
            (
                erika_forecast.sick_factor,
                erika_forecast.distraction_factor
            ),
            (0.0131, 0.034)
        );
        assert_eq!(
            (erika_forecast.planned_absence_days, erika_forecast.net),
            (5.0, 28_526.06)
        );
        assert_eq!(forecast.persons[1].planned_absence_days, 8.5); // ½ Tag + 8 Tage
        assert_eq!(forecast.persons[2].contract_hours, 0.0); // Lena nicht mehr im Projekt
        let budget = &forecast.budgets[0];
        assert_eq!(
            (budget.actual_net, budget.forecast_net, budget.deviation),
            (319_865.0, 47_629.52, 7_494.52)
        );
        assert_eq!(budget.exhausted_on, NaiveDate::from_ymd_opt(2026, 12, 17));

        // Resturlaub: Erika 30 + 2 − 15 genommen − 5 geplant, Max 28 − 11 − 8 geplant
        let vacation: Vec<(&str, f64, f64, f64)> = auswertung
            .vacation
            .iter()
            .map(|v| (v.person.as_str(), v.taken, v.planned, v.remaining))
            .collect();
        assert_eq!(
            vacation,
            vec![
                ("Erika Mustermann", 15.0, 5.0, 12.0),
                ("Max Mustermann", 11.0, 8.0, 9.0)
            ]
        );
        // Prognosegüte (unabhängig nachgerechnet): Prognose zu Monatsbeginn je Monat
        let accuracy: Vec<(&str, f64)> = auswertung
            .forecast_accuracy
            .iter()
            .map(|m| (m.month.as_str(), m.backtest_net))
            .collect();
        assert_eq!(accuracy.len(), 10);
        assert_eq!(accuracy[6], ("2026-07", 33_282.76)); // Urlaub nicht eingeplant
        assert_eq!(accuracy[9], ("2026-10", 28_846.03));
        assert_eq!(auswertung.forecast_accuracy[9].actual_net, 30_526.25);

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
        // inkl. Karl im Juni: 480 € netto + 91,20 € USt.
        assert_eq!(invoice.total.net, 319_865.0);
        assert_eq!(invoice.total.vat, 60_719.47);
        assert_eq!(invoice.total.gross, 380_584.47);
        let march_lena = invoice.months[2]
            .lines
            .iter()
            .find(|l| l.person == "Lena Beispiel")
            .unwrap();
        assert_eq!((march_lena.hours, march_lena.outside_hours), (2.0, 2.0));
        // Schulung mit 7 % USt. (eigene Abrechnungsregel)
        let reduced = &invoice.total.vat_groups[0];
        assert_eq!(
            (reduced.vat_percent, reduced.net, reduced.vat),
            (7.0, 457.5, 32.03)
        );
    }
}
