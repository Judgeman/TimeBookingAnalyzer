//! Ablage der Projektkonfigurationen als `<id>.json` in einem Verzeichnis
//! (in der App: `projects/` neben der Programmdatei – jede Kopie der App hat
//! so ihre eigenen Projekte). Frühere Versionen speicherten unter
//! `<app_data_dir>/projects/`; von dort lassen sich Projekte übernehmen.

use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use crate::models::config::ProjectConfig;
use crate::models::results::{ProjectFolder, ProjectSummary};

pub struct ProjectStore {
    dir: PathBuf,
    /// Früherer Ablageort, aus dem Projekte übernommen werden können.
    legacy: Option<PathBuf>,
}

impl ProjectStore {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self {
            dir: dir.into(),
            legacy: None,
        }
    }

    pub fn with_legacy(mut self, legacy: Option<PathBuf>) -> Self {
        self.legacy = legacy;
        self
    }

    #[cfg(test)]
    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// Projektordner und Anzahl der Projekte, die sich vom früheren
    /// Ablageort übernehmen lassen.
    pub fn folder(&self) -> ProjectFolder {
        ProjectFolder {
            dir: self.dir.display().to_string(),
            legacy_count: self.legacy_candidates().len(),
        }
    }

    /// Kopiert lesbare Projekte vom früheren Ablageort, die hier noch fehlen
    /// (die Originale bleiben liegen). Gibt die Anzahl zurück.
    pub fn import_legacy(&self) -> Result<usize, String> {
        let candidates = self.legacy_candidates();
        if candidates.is_empty() {
            return Ok(0);
        }
        fs::create_dir_all(&self.dir)
            .map_err(|e| format!("Projektverzeichnis konnte nicht angelegt werden: {e}"))?;
        for (file_name, source) in &candidates {
            fs::copy(source, self.dir.join(file_name))
                .map_err(|e| format!("Projekt konnte nicht übernommen werden: {e}"))?;
        }
        Ok(candidates.len())
    }

    /// (Dateiname, Quelle) der übernehmbaren Projekte.
    fn legacy_candidates(&self) -> Vec<(String, PathBuf)> {
        let Some(legacy) = self.legacy.as_ref().filter(|l| *l != &self.dir) else {
            return Vec::new();
        };
        ProjectStore::new(legacy)
            .list()
            .unwrap_or_default()
            .into_iter()
            .map(|p| format!("{}.json", p.id))
            .filter(|file_name| !self.dir.join(file_name).exists())
            .map(|file_name| {
                let source = legacy.join(&file_name);
                (file_name, source)
            })
            .collect()
    }

    /// Alle Projekte, alphabetisch nach Name. Unlesbare Dateien werden
    /// übersprungen (und auf stderr gemeldet), damit eine kaputte Datei
    /// nicht die ganze Liste blockiert.
    pub fn list(&self) -> Result<Vec<ProjectSummary>, String> {
        let read_dir = match fs::read_dir(&self.dir) {
            Ok(read_dir) => read_dir,
            Err(e) if e.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(format!("Projektverzeichnis nicht lesbar: {e}")),
        };

        let mut projects = Vec::new();
        for entry in read_dir.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let Some(id) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            if validate_id(id).is_err() {
                continue;
            }
            match read_config(&path) {
                Ok(config) => projects.push(ProjectSummary {
                    // Der Dateiname ist maßgeblich – so funktioniert `get` auch
                    // für von Hand angelegte Dateien ohne passende `id`.
                    id: id.to_string(),
                    name: config.name,
                    element_filter: config.element_filter,
                    team_size: config.team.len(),
                    guest_count: config.guests.len(),
                }),
                Err(e) => eprintln!("Überspringe {}: {e}", path.display()),
            }
        }
        projects.sort_by_cached_key(|p| p.name.to_lowercase());
        Ok(projects)
    }

    pub fn get(&self, id: &str) -> Result<ProjectConfig, String> {
        let path = self.path_for(id)?;
        let mut config = read_config(&path).map_err(|e| match e {
            ReadError::NotFound => format!("Projekt „{id}“ nicht gefunden."),
            other => other.to_string(),
        })?;
        config.id = id.to_string();
        Ok(config)
    }

    /// Speichert das Projekt und gibt die (ggf. neu vergebene) ID zurück.
    pub fn save(&self, mut config: ProjectConfig) -> Result<String, String> {
        config.name = config.name.trim().to_string();
        config.element_filter = config.element_filter.trim().to_string();
        config.validate()?;

        if config.id.trim().is_empty() {
            config.id = uuid::Uuid::new_v4().to_string();
        }
        let path = self.path_for(&config.id)?;

        fs::create_dir_all(&self.dir)
            .map_err(|e| format!("Projektverzeichnis konnte nicht angelegt werden: {e}"))?;
        let json = serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Projekt konnte nicht serialisiert werden: {e}"))?;

        // Erst in eine temporäre Datei schreiben, dann umbenennen – so bleibt
        // bei einem Absturz keine halb geschriebene Konfiguration zurück.
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, json)
            .map_err(|e| format!("Projekt konnte nicht gespeichert werden: {e}"))?;
        fs::rename(&tmp, &path).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            format!("Projekt konnte nicht gespeichert werden: {e}")
        })?;

        Ok(config.id)
    }

    pub fn delete(&self, id: &str) -> Result<(), String> {
        let path = self.path_for(id)?;
        fs::remove_file(&path).map_err(|e| match e.kind() {
            ErrorKind::NotFound => format!("Projekt „{id}“ nicht gefunden."),
            _ => format!("Projekt konnte nicht gelöscht werden: {e}"),
        })
    }

    fn path_for(&self, id: &str) -> Result<PathBuf, String> {
        validate_id(id)?;
        Ok(self.dir.join(format!("{id}.json")))
    }
}

/// IDs werden als Dateinamen verwendet – nur unbedenkliche Zeichen zulassen
/// (verhindert u. a. Pfade wie `../../etc/passwd`).
pub(crate) fn validate_id(id: &str) -> Result<(), String> {
    let valid = !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if valid {
        Ok(())
    } else {
        Err(format!("Ungültige Projekt-ID „{id}“."))
    }
}

enum ReadError {
    NotFound,
    Io(std::io::Error),
    Json(serde_json::Error),
}

impl std::fmt::Display for ReadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ReadError::NotFound => write!(f, "Datei nicht gefunden"),
            ReadError::Io(e) => write!(f, "Projektdatei nicht lesbar: {e}"),
            ReadError::Json(e) => write!(f, "Projektdatei fehlerhaft: {e}"),
        }
    }
}

fn read_config(path: &Path) -> Result<ProjectConfig, ReadError> {
    let content = fs::read_to_string(path).map_err(|e| match e.kind() {
        ErrorKind::NotFound => ReadError::NotFound,
        _ => ReadError::Io(e),
    })?;
    serde_json::from_str(&content).map_err(ReadError::Json)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::config::{ExportFormat, HolidayConfig, TeamMember, default_billing_rules};

    fn config(name: &str) -> ProjectConfig {
        ProjectConfig {
            id: String::new(),
            name: name.into(),
            element_filter: "P100 Lager-App".into(),
            team: vec![TeamMember {
                name: "Erika Mustermann".into(),
                rates: vec![],
                working_hours: vec![],
                assignments: vec![],
                untracked: false,
                vacation: vec![],
            }],
            guests: vec![],
            working_hours: vec![],
            holidays: HolidayConfig::default(),
            export_format: ExportFormat::default(),
            vat_percent: 19.0,
            billing_rules: default_billing_rules(),
            missing_threshold_percent: 50.0,
            planned_absences: vec![],
            budgets: vec![],
        }
    }

    #[test]
    fn folders_live_beside_the_executable() {
        use crate::storage::beside_exe;
        let exe = Path::new("tools")
            .join("BillingTracker")
            .join("billing-tracker.exe");
        assert_eq!(
            beside_exe(&exe, "projects"),
            Path::new("tools").join("BillingTracker").join("projects")
        );
        assert_eq!(
            beside_exe(Path::new(""), "Import"),
            Path::new(".").join("Import")
        );
    }

    #[test]
    fn imports_missing_projects_from_the_legacy_folder() {
        let dir = tempfile::tempdir().unwrap();
        let legacy = ProjectStore::new(dir.path().join("appdata"));
        let id_a = legacy.save(config("Alt A")).unwrap();
        let id_b = legacy.save(config("Alt B")).unwrap();
        fs::write(legacy.dir().join("kaputt.json"), "{").unwrap();

        // Instanz hat B schon (z. B. von Hand kopiert)
        let store = ProjectStore::new(dir.path().join("instanz").join("projects"))
            .with_legacy(Some(legacy.dir().to_path_buf()));
        let mut b = legacy.get(&id_b).unwrap();
        b.name = "B (geändert)".into();
        store.save(b).unwrap();

        let folder = store.folder();
        assert!(folder.dir.ends_with("projects"), "{}", folder.dir);
        assert_eq!(folder.legacy_count, 1);
        assert_eq!(store.import_legacy().unwrap(), 1);
        let names: Vec<String> = store.list().unwrap().into_iter().map(|p| p.name).collect();
        assert_eq!(names, vec!["Alt A", "B (geändert)"]); // B nicht überschrieben
        assert!(legacy.dir().join(format!("{id_a}.json")).exists()); // Original bleibt
        assert_eq!(store.folder().legacy_count, 0);
        assert_eq!(store.import_legacy().unwrap(), 0);

        // ohne bzw. mit identischem früheren Ablageort: nichts zu übernehmen
        assert_eq!(ProjectStore::new(dir.path()).folder().legacy_count, 0);
        let same = ProjectStore::new(legacy.dir()).with_legacy(Some(legacy.dir().to_path_buf()));
        assert_eq!(same.import_legacy().unwrap(), 0);
    }

    #[test]
    fn list_of_missing_directory_is_empty() {
        let dir = tempfile::tempdir().unwrap();
        let store = ProjectStore::new(dir.path().join("projects"));
        assert!(store.list().unwrap().is_empty());
    }

    #[test]
    fn save_get_list_delete_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let store = ProjectStore::new(dir.path().join("projects"));

        let id_b = store.save(config("  Zeta  ")).unwrap();
        let id_a = store.save(config("alpha")).unwrap();
        assert!(uuid::Uuid::parse_str(&id_a).is_ok());
        assert!(store.dir().join(format!("{id_a}.json")).exists());

        let loaded = store.get(&id_b).unwrap();
        assert_eq!(loaded.id, id_b);
        assert_eq!(loaded.name, "Zeta");

        let names: Vec<String> = store.list().unwrap().into_iter().map(|p| p.name).collect();
        assert_eq!(names, vec!["alpha", "Zeta"]);

        // Speichern mit bestehender ID überschreibt.
        let mut changed = loaded.clone();
        changed.name = "Zeta 2".into();
        assert_eq!(store.save(changed).unwrap(), id_b);
        assert_eq!(store.get(&id_b).unwrap().name, "Zeta 2");
        assert_eq!(store.list().unwrap().len(), 2);

        store.delete(&id_a).unwrap();
        assert_eq!(store.list().unwrap().len(), 1);
        assert!(store.get(&id_a).unwrap_err().contains("nicht gefunden"));
        assert!(store.delete(&id_a).unwrap_err().contains("nicht gefunden"));
    }

    #[test]
    fn invalid_config_is_not_saved() {
        let dir = tempfile::tempdir().unwrap();
        let store = ProjectStore::new(dir.path());
        assert!(
            store
                .save(config("   "))
                .unwrap_err()
                .contains("Projektname")
        );
        assert!(store.list().unwrap().is_empty());
    }

    #[test]
    fn rejects_path_traversal_ids() {
        let dir = tempfile::tempdir().unwrap();
        let store = ProjectStore::new(dir.path());
        for id in ["../secret", "a/b", "", "x.json"] {
            assert!(
                store.get(id).unwrap_err().contains("Ungültige Projekt-ID"),
                "{id}"
            );
        }
        let mut evil = config("Evil");
        evil.id = "../../evil".into();
        assert!(store.save(evil).is_err());
    }

    #[test]
    fn hand_written_and_broken_files() {
        let dir = tempfile::tempdir().unwrap();
        let store = ProjectStore::new(dir.path());
        fs::write(
            dir.path().join("musterkunde.json"),
            r#"{ "name": "Musterkunde" }"#,
        )
        .unwrap();
        fs::write(dir.path().join("kaputt.json"), "{ nope").unwrap();
        fs::write(dir.path().join("notiz.txt"), "ignorieren").unwrap();

        let list = store.list().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "musterkunde");
        assert_eq!(store.get("musterkunde").unwrap().id, "musterkunde");
        assert!(store.get("kaputt").unwrap_err().contains("fehlerhaft"));
    }
}
