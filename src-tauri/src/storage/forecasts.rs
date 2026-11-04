//! Gespeicherte Prognosen je Projekt (`Prognosen/<id>.json` neben der
//! Programmdatei): bei jeder Auswertung eines vollständigen Exports eine
//! Momentaufnahme je Stand der Daten. Später vergleicht die Prognosegüte sie mit
//! dem tatsächlich abgerechneten Betrag.

use std::fs;
use std::io::ErrorKind;
use std::path::PathBuf;

use chrono::{Local, NaiveDate, NaiveDateTime, Timelike};
use serde::{Deserialize, Serialize};

use super::projects::validate_id;
use crate::calculation::round2;
use crate::models::config::month_start;
use crate::models::results::{AccuracyMonth, Forecast};

/// Höchstens so viele Momentaufnahmen je Projekt aufbewahren (die neuesten).
const MAX_SNAPSHOTS: usize = 120;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Snapshot {
    /// Stand der Daten (letzter Tag mit Buchungen im Export).
    pub data_end: NaiveDate,
    pub recorded_at: NaiveDateTime,
    /// Laufender und folgende Monate: bereits abgerechnet + Prognose.
    pub months: Vec<SnapshotMonth>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SnapshotMonth {
    pub month: String,
    pub actual_net: f64,
    pub forecast_net: f64,
}

impl Snapshot {
    /// Momentaufnahme der Prognose (ab dem Monat des ersten Prognosetags).
    pub fn of(forecast: &Forecast) -> Self {
        let first = crate::calculation::month_key(forecast.from);
        Snapshot {
            data_end: forecast.from.pred_opt().unwrap_or(forecast.from),
            recorded_at: Local::now()
                .naive_local()
                .with_nanosecond(0)
                .unwrap_or_default(),
            months: forecast
                .months
                .iter()
                .filter(|m| m.month >= first)
                .map(|m| SnapshotMonth {
                    month: m.month.clone(),
                    actual_net: m.actual_net,
                    forecast_net: m.forecast_net,
                })
                .collect(),
        }
    }
}

pub struct ForecastStore {
    dir: PathBuf,
}

impl ForecastStore {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    fn path(&self, project_id: &str) -> Result<PathBuf, String> {
        validate_id(project_id)?;
        Ok(self.dir.join(format!("{project_id}.json")))
    }

    /// Alle Momentaufnahmen des Projekts, aufsteigend nach Stand.
    pub fn load(&self, project_id: &str) -> Result<Vec<Snapshot>, String> {
        let content = match fs::read_to_string(self.path(project_id)?) {
            Ok(content) => content,
            Err(e) if e.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(format!("Gespeicherte Prognosen nicht lesbar: {e}")),
        };
        serde_json::from_str(&content)
            .map_err(|e| format!("Gespeicherte Prognosen fehlerhaft: {e}"))
    }

    /// Speichert die Momentaufnahme (ersetzt eine mit gleichem Stand).
    pub fn record(&self, project_id: &str, snapshot: Snapshot) -> Result<(), String> {
        let path = self.path(project_id)?;
        let mut snapshots = self.load(project_id).unwrap_or_default();
        snapshots.retain(|s| s.data_end != snapshot.data_end);
        snapshots.push(snapshot);
        snapshots.sort_by_key(|s| s.data_end);
        if snapshots.len() > MAX_SNAPSHOTS {
            snapshots.drain(..snapshots.len() - MAX_SNAPSHOTS);
        }
        let failed = |e: std::io::Error| format!("Prognose konnte nicht gespeichert werden: {e}");
        fs::create_dir_all(&self.dir).map_err(failed)?;
        let json = serde_json::to_string_pretty(&snapshots).map_err(|e| e.to_string())?;
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, json).map_err(failed)?;
        fs::rename(&tmp, &path).map_err(failed)
    }

    /// Entfernt die gespeicherten Prognosen (beim Löschen des Projekts).
    pub fn forget(&self, project_id: &str) -> Result<(), String> {
        match fs::remove_file(self.path(project_id)?) {
            Err(e) if e.kind() != ErrorKind::NotFound => Err(format!(
                "Gespeicherte Prognosen konnten nicht gelöscht werden: {e}"
            )),
            _ => Ok(()),
        }
    }
}

/// Trägt je Monat die zuletzt **vor Monatsbeginn** gespeicherte Prognose ein.
pub fn apply_recorded(months: &mut [AccuracyMonth], snapshots: &[Snapshot]) {
    for month in months {
        let Some(start) = month_start(&month.month) else {
            continue;
        };
        let latest = snapshots
            .iter()
            .filter(|s| s.data_end < start)
            .max_by_key(|s| s.data_end)
            .and_then(|s| {
                s.months
                    .iter()
                    .find(|m| m.month == month.month)
                    .map(|m| (s.data_end, m))
            });
        if let Some((data_end, m)) = latest {
            month.recorded_net = Some(round2(m.actual_net + m.forecast_net));
            month.recorded_on = Some(data_end);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::results::ForecastMonth;

    fn d(m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, m, day).unwrap()
    }

    fn snapshot(data_end: NaiveDate, months: &[(&str, f64, f64)]) -> Snapshot {
        Snapshot {
            data_end,
            recorded_at: d(11, 4).and_hms_opt(10, 0, 0).unwrap(),
            months: months
                .iter()
                .map(|(month, actual_net, forecast_net)| SnapshotMonth {
                    month: month.to_string(),
                    actual_net: *actual_net,
                    forecast_net: *forecast_net,
                })
                .collect(),
        }
    }

    fn accuracy(month: &str) -> AccuracyMonth {
        AccuracyMonth {
            month: month.into(),
            actual_net: 100.0,
            backtest_net: 90.0,
            recorded_net: None,
            recorded_on: None,
        }
    }

    #[test]
    fn snapshot_keeps_current_and_following_months() {
        let month = |m: &str, actual, forecast| ForecastMonth {
            month: m.into(),
            actual_net: actual,
            actual_hours: 0.0,
            forecast_net: forecast,
            forecast_hours: 0.0,
        };
        let forecast = Forecast {
            from: d(9, 14),
            to: d(12, 31),
            reference_from: d(1, 1),
            reference_to: Some(d(8, 31)),
            persons: vec![],
            months: vec![
                month("2026-08", 900.0, 0.0),
                month("2026-09", 400.0, 500.0),
                month("2026-10", 0.0, 950.0),
            ],
            budgets: vec![],
            notes: vec![],
        };
        let s = Snapshot::of(&forecast);
        assert_eq!(s.data_end, d(9, 13));
        assert_eq!(
            s.months
                .iter()
                .map(|m| m.month.as_str())
                .collect::<Vec<_>>(),
            vec!["2026-09", "2026-10"]
        );
    }

    #[test]
    fn records_replaces_and_forgets_snapshots() {
        let tmp = tempfile::tempdir().unwrap();
        let store = ForecastStore::new(tmp.path().join("Prognosen"));
        assert!(store.load("p1").unwrap().is_empty());
        store
            .record("p1", snapshot(d(9, 30), &[("2026-10", 0.0, 1000.0)]))
            .unwrap();
        store
            .record("p1", snapshot(d(8, 31), &[("2026-09", 0.0, 800.0)]))
            .unwrap();
        // gleicher Stand → ersetzt
        store
            .record("p1", snapshot(d(9, 30), &[("2026-10", 0.0, 1100.0)]))
            .unwrap();
        let loaded = store.load("p1").unwrap();
        assert_eq!(
            loaded.iter().map(|s| s.data_end).collect::<Vec<_>>(),
            vec![d(8, 31), d(9, 30)]
        );
        assert_eq!(loaded[1].months[0].forecast_net, 1100.0);

        for day in 1..=(MAX_SNAPSHOTS as u32 + 5) {
            let date = d(1, 1) + chrono::Days::new(u64::from(day));
            store.record("p2", snapshot(date, &[])).unwrap();
        }
        assert_eq!(store.load("p2").unwrap().len(), MAX_SNAPSHOTS);

        store.forget("p1").unwrap();
        assert!(store.load("p1").unwrap().is_empty());
        store.forget("p1").unwrap();
        fs::write(tmp.path().join("Prognosen").join("kaputt.json"), "{").unwrap();
        assert!(store.load("kaputt").unwrap_err().contains("fehlerhaft"));
        assert!(store.load("../x").is_err());
    }

    #[test]
    fn uses_the_latest_snapshot_before_the_month_started() {
        let snapshots = vec![
            snapshot(
                d(8, 31),
                &[("2026-09", 0.0, 800.0), ("2026-10", 0.0, 900.0)],
            ),
            snapshot(
                d(9, 15),
                &[("2026-09", 400.0, 450.0), ("2026-10", 0.0, 950.0)],
            ),
            snapshot(d(10, 5), &[("2026-10", 100.0, 870.0)]),
        ];
        let mut months = vec![
            accuracy("2026-08"),
            accuracy("2026-09"),
            accuracy("2026-10"),
            accuracy("xx"),
        ];
        apply_recorded(&mut months, &snapshots);
        // August: keine Prognose davor
        assert_eq!(
            (months[0].recorded_net, months[0].recorded_on),
            (None, None)
        );
        // September: Stand 31.08. (der vom 15.09. lag schon im Monat)
        assert_eq!(
            (months[1].recorded_net, months[1].recorded_on),
            (Some(800.0), Some(d(8, 31)))
        );
        // Oktober: Stand 15.09.
        assert_eq!(
            (months[2].recorded_net, months[2].recorded_on),
            (Some(950.0), Some(d(9, 15)))
        );
        assert_eq!(months[3].recorded_net, None);
    }
}
