//! Zwischenspeicher der aus ProjectForge abgerufenen Buchungen je Projekt:
//! `ProjectForge/<id>.json` neben der Programmdatei. Abgeschlossene Monate
//! werden nicht erneut abgerufen; die Auswertung funktioniert auch ohne Netz.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::ErrorKind;
use std::path::PathBuf;

use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};

use super::projects::validate_id;
use crate::models::entry::TimeEntry;
use crate::projectforge::{CostTypes, FetchedEntry, dedupe};

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct FetchCache {
    /// Zeitpunkt des letzten erfolgreichen Abrufs (Ortszeit).
    pub fetched_at: Option<NaiveDateTime>,
    /// Monat („2026-11“) → abgerufene Buchungen.
    #[serde(default)]
    pub months: BTreeMap<String, CachedMonth>,
    /// Kostenarten des letzten Abrufs (auch für spätere Abrufe).
    #[serde(default)]
    pub cost_types: CostTypes,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CachedMonth {
    pub fetched_at: NaiveDateTime,
    pub entries: Vec<FetchedEntry>,
    /// Kostenarten ohne bekannten Arbeitsanteil (mit 1 gerechnet).
    #[serde(default)]
    pub unknown_kinds: BTreeSet<String>,
}

impl FetchCache {
    /// Abrufzeitpunkt je Monat.
    pub fn fetched_months(&self) -> BTreeMap<String, NaiveDateTime> {
        self.months
            .iter()
            .map(|(month, data)| (month.clone(), data.fetched_at))
            .collect()
    }

    /// Alle Buchungen (jede nur einmal) als Export-Zeilen.
    pub fn entries(&self) -> Vec<TimeEntry> {
        dedupe(self.months.values().flat_map(|m| m.entries.iter().cloned()))
            .into_iter()
            .map(FetchedEntry::into_entry)
            .collect()
    }

    pub fn unknown_kinds(&self) -> BTreeSet<String> {
        self.months
            .values()
            .flat_map(|m| m.unknown_kinds.iter().cloned())
            .collect()
    }
}

pub struct FetchCacheStore {
    dir: PathBuf,
}

impl FetchCacheStore {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    fn path(&self, project_id: &str) -> Result<PathBuf, String> {
        validate_id(project_id)?;
        Ok(self.dir.join(format!("{project_id}.json")))
    }

    pub fn load(&self, project_id: &str) -> Result<Option<FetchCache>, String> {
        let content = match fs::read_to_string(self.path(project_id)?) {
            Ok(content) => content,
            Err(e) if e.kind() == ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(format!("Abgerufene ProjectForge-Daten nicht lesbar: {e}")),
        };
        serde_json::from_str(&content)
            .map(Some)
            .map_err(|e| format!("Abgerufene ProjectForge-Daten fehlerhaft: {e}"))
    }

    pub fn save(&self, project_id: &str, cache: &FetchCache) -> Result<(), String> {
        let path = self.path(project_id)?;
        let failed =
            |e: std::io::Error| format!("Abgerufene Daten konnten nicht gespeichert werden: {e}");
        fs::create_dir_all(&self.dir).map_err(failed)?;
        let json = serde_json::to_string(cache).map_err(|e| e.to_string())?;
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, json).map_err(failed)?;
        fs::rename(&tmp, &path).map_err(failed)
    }

    /// Entfernt die abgerufenen Daten (beim Löschen des Projekts).
    pub fn forget(&self, project_id: &str) -> Result<(), String> {
        match fs::remove_file(self.path(project_id)?) {
            Err(e) if e.kind() != ErrorKind::NotFound => Err(format!(
                "Abgerufene ProjectForge-Daten konnten nicht gelöscht werden: {e}"
            )),
            _ => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn entry(id: i64, day: u32) -> FetchedEntry {
        FetchedEntry {
            id,
            name: "Erika Mustermann".into(),
            date: NaiveDate::from_ymd_opt(2026, 11, day).unwrap(),
            hours: 8.0,
            mult: 1.0,
            element: "P100 Lager-App".into(),
            kost2art: "Delivery (billable)".into(),
            location: "Büro".into(),
            start: None,
            end: None,
            description: String::new(),
        }
    }

    #[test]
    fn saves_loads_and_forgets_the_cache() {
        let dir = tempfile::tempdir().unwrap();
        let store = FetchCacheStore::new(dir.path().join("ProjectForge"));
        assert_eq!(store.load("p1").unwrap(), None);
        let at = NaiveDate::from_ymd_opt(2026, 11, 13)
            .unwrap()
            .and_hms_opt(9, 0, 0)
            .unwrap();
        let mut cache = FetchCache {
            fetched_at: Some(at),
            ..Default::default()
        };
        cache.months.insert(
            "2026-11".into(),
            CachedMonth {
                fetched_at: at,
                entries: vec![entry(1, 2), entry(2, 3), entry(1, 2)],
                unknown_kinds: BTreeSet::from(["99".to_string()]),
            },
        );
        store.save("p1", &cache).unwrap();
        let loaded = store.load("p1").unwrap().unwrap();
        assert_eq!(loaded, cache);
        assert_eq!(loaded.entries().len(), 2);
        assert_eq!(loaded.entries()[0].billable, None);
        assert_eq!(loaded.unknown_kinds().len(), 1);
        assert_eq!(loaded.fetched_months().get("2026-11"), Some(&at));
        store.forget("p1").unwrap();
        store.forget("p1").unwrap();
        assert_eq!(store.load("p1").unwrap(), None);
        assert!(store.load("../x").is_err());

        std::fs::write(dir.path().join("ProjectForge/p2.json"), "{kaputt").unwrap();
        assert!(store.load("p2").unwrap_err().contains("fehlerhaft"));
    }
}
