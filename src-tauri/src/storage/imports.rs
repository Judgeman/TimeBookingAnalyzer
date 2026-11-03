//! Letzte Import-Datei je Projekt: Kopie unter `Import/<id>/<Dateiname>` neben
//! der Programmdatei, dazu `import.json` (Originalpfad, Zeitpunkt). Pro Projekt
//! wird nur die zuletzt eingelesene Datei aufbewahrt.

use std::fs::{self, File};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use chrono::{Local, NaiveDateTime, Timelike};
use serde::{Deserialize, Serialize};

use super::projects::validate_id;
use crate::models::results::LastImport;

const META_FILE: &str = "import.json";
const TMP_FILE: &str = ".import.tmp";

#[derive(Serialize, Deserialize)]
struct Meta {
    file_name: String,
    original_path: String,
    imported_at: NaiveDateTime,
}

pub struct ImportStore {
    dir: PathBuf,
}

impl ImportStore {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    fn project_dir(&self, project_id: &str) -> Result<PathBuf, String> {
        validate_id(project_id)?;
        Ok(self.dir.join(project_id))
    }

    /// Merkt sich `source` als letzten Import des Projekts: Kopie (mit
    /// Dateiname und Änderungsdatum des Originals – daraus ergibt sich der
    /// „Stand“ des Exports) ersetzt die vorige.
    pub fn remember(&self, project_id: &str, source: &Path) -> Result<LastImport, String> {
        let dir = self.project_dir(project_id)?;
        let file_name = source
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .filter(|n| n != META_FILE && n != TMP_FILE)
            .ok_or_else(|| format!("Ungültiger Dateipfad „{}“.", source.display()))?;
        let target = dir.join(&file_name);
        let failed = |e: std::io::Error| format!("Kopie im Ordner „Import“ fehlgeschlagen: {e}");

        fs::create_dir_all(&dir).map_err(failed)?;
        let previous = read_meta(&dir);
        // Erneut die gemerkte Kopie abgelegt → nichts zu kopieren.
        let same_file = target.exists()
            && fs::canonicalize(source).map_err(failed)?
                == fs::canonicalize(&target).map_err(failed)?;
        if !same_file {
            let tmp = dir.join(TMP_FILE);
            fs::copy(source, &tmp).map_err(failed)?;
            if let Ok(modified) = fs::metadata(source).and_then(|m| m.modified()) {
                File::options()
                    .write(true)
                    .open(&tmp)
                    .and_then(|f| f.set_modified(modified))
                    .map_err(failed)?;
            }
            fs::rename(&tmp, &target).map_err(failed)?;
        }

        // Ältere Importe entfernen – pro Projekt nur die letzte Datei.
        for entry in fs::read_dir(&dir).map_err(failed)?.flatten() {
            let path = entry.path();
            if path != target && entry.file_name() != META_FILE {
                let _ = fs::remove_file(path);
            }
        }

        let original_path = match previous {
            Some(meta) if same_file && meta.file_name == file_name => meta.original_path,
            _ => source.display().to_string(),
        };
        let meta = Meta {
            file_name,
            original_path,
            imported_at: Local::now()
                .naive_local()
                .with_nanosecond(0)
                .unwrap_or_default(),
        };
        let json = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
        fs::write(dir.join(META_FILE), json).map_err(failed)?;

        self.last(project_id)?
            .ok_or_else(|| "Import-Datei nach dem Kopieren nicht gefunden.".to_string())
    }

    /// Zuletzt eingelesene Datei des Projekts, falls vorhanden. Ohne
    /// `import.json` (z. B. von Hand abgelegt) gilt die neueste `.xlsx`.
    pub fn last(&self, project_id: &str) -> Result<Option<LastImport>, String> {
        let dir = self.project_dir(project_id)?;
        if let Some(meta) = read_meta(&dir) {
            let path = dir.join(&meta.file_name);
            if path.is_file() {
                return Ok(Some(LastImport {
                    path: path.display().to_string(),
                    file_name: meta.file_name,
                    original_path: Some(meta.original_path),
                    imported_at: Some(meta.imported_at),
                }));
            }
        }
        let read_dir = match fs::read_dir(&dir) {
            Ok(read_dir) => read_dir,
            Err(e) if e.kind() == ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(format!("Ordner „Import“ nicht lesbar: {e}")),
        };
        let newest = read_dir
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| {
                path.is_file()
                    && path
                        .extension()
                        .is_some_and(|ext| ext.eq_ignore_ascii_case("xlsx"))
            })
            .max_by_key(|path| fs::metadata(path).and_then(|m| m.modified()).ok());
        Ok(newest.map(|path| LastImport {
            file_name: path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
            path: path.display().to_string(),
            original_path: None,
            imported_at: None,
        }))
    }

    /// Entfernt die gemerkte Datei (beim Löschen des Projekts).
    pub fn forget(&self, project_id: &str) -> Result<(), String> {
        match fs::remove_dir_all(self.project_dir(project_id)?) {
            Err(e) if e.kind() != ErrorKind::NotFound => {
                Err(format!("Import-Kopie konnte nicht gelöscht werden: {e}"))
            }
            _ => Ok(()),
        }
    }
}

fn read_meta(dir: &Path) -> Option<Meta> {
    let content = fs::read_to_string(dir.join(META_FILE)).ok()?;
    serde_json::from_str(&content).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, SystemTime};

    fn export(dir: &Path, name: &str, content: &str) -> PathBuf {
        let path = dir.join(name);
        fs::write(&path, content).unwrap();
        path
    }

    #[test]
    fn remembers_a_copy_with_name_and_modification_time() {
        let tmp = tempfile::tempdir().unwrap();
        let downloads = tmp.path().join("Downloads");
        fs::create_dir_all(&downloads).unwrap();
        let source = export(&downloads, "Beispiel-Export_2026-10-31.xlsx", "eins");
        let modified = SystemTime::UNIX_EPOCH + Duration::from_secs(1_793_000_000);
        File::options()
            .write(true)
            .open(&source)
            .unwrap()
            .set_modified(modified)
            .unwrap();

        let store = ImportStore::new(tmp.path().join("Import"));
        assert_eq!(store.last("p1").unwrap(), None);
        let info = store.remember("p1", &source).unwrap();

        let copy = tmp
            .path()
            .join("Import")
            .join("p1")
            .join("Beispiel-Export_2026-10-31.xlsx");
        assert_eq!(info.path, copy.display().to_string());
        assert_eq!(info.file_name, "Beispiel-Export_2026-10-31.xlsx");
        assert_eq!(info.original_path, Some(source.display().to_string()));
        assert!(info.imported_at.is_some());
        assert_eq!(fs::read_to_string(&copy).unwrap(), "eins");
        assert_eq!(fs::metadata(&copy).unwrap().modified().unwrap(), modified);
        assert_eq!(store.last("p1").unwrap(), Some(info.clone()));

        // Erneut die Kopie selbst abgelegt: bleibt, Originalpfad bleibt erhalten
        let again = store.remember("p1", &copy).unwrap();
        assert_eq!(again.original_path, info.original_path);
        assert_eq!(fs::read_to_string(&copy).unwrap(), "eins");
    }

    #[test]
    fn keeps_only_the_latest_import_per_project() {
        let tmp = tempfile::tempdir().unwrap();
        let store = ImportStore::new(tmp.path().join("Import"));
        let old = export(tmp.path(), "Export_2026-09-30.xlsx", "alt");
        let new = export(tmp.path(), "Export_2026-10-31.xlsx", "neu");
        store.remember("p1", &old).unwrap();
        store.remember("p2", &old).unwrap();
        let info = store.remember("p1", &new).unwrap();

        let mut files: Vec<String> = fs::read_dir(tmp.path().join("Import").join("p1"))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        files.sort();
        assert_eq!(files, vec!["Export_2026-10-31.xlsx", "import.json"]);
        assert_eq!(info.file_name, "Export_2026-10-31.xlsx");
        // anderes Projekt unberührt
        assert_eq!(
            store.last("p2").unwrap().unwrap().file_name,
            "Export_2026-09-30.xlsx"
        );

        store.forget("p1").unwrap();
        assert_eq!(store.last("p1").unwrap(), None);
        store.forget("p1").unwrap(); // schon weg → ok
    }

    #[test]
    fn without_metadata_the_newest_xlsx_counts() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("Import").join("p1");
        fs::create_dir_all(&dir).unwrap();
        let older = export(&dir, "alt.xlsx", "");
        let newer = export(&dir, "neu.XLSX", "");
        export(&dir, "notiz.txt", "");
        let at = |secs| SystemTime::UNIX_EPOCH + Duration::from_secs(secs);
        for (path, secs) in [(&older, 1_000), (&newer, 2_000)] {
            File::options()
                .write(true)
                .open(path)
                .unwrap()
                .set_modified(at(secs))
                .unwrap();
        }
        let store = ImportStore::new(tmp.path().join("Import"));
        let info = store.last("p1").unwrap().unwrap();
        assert_eq!(
            (info.file_name.as_str(), info.imported_at),
            ("neu.XLSX", None)
        );
        // kaputte Metadaten werden ignoriert
        fs::write(dir.join(META_FILE), "{").unwrap();
        assert_eq!(store.last("p1").unwrap().unwrap().file_name, "neu.XLSX");
    }

    #[test]
    fn rejects_invalid_ids_and_paths() {
        let tmp = tempfile::tempdir().unwrap();
        let store = ImportStore::new(tmp.path().join("Import"));
        let source = export(tmp.path(), "export.xlsx", "");
        assert!(store.remember("../x", &source).is_err());
        assert!(store.last("../x").is_err());
        assert!(store.forget("").is_err());
        let err = store.remember("p1", Path::new("/")).unwrap_err();
        assert!(err.contains("Ungültiger Dateipfad"), "{err}");
        let err = store
            .remember("p1", &tmp.path().join("fehlt.xlsx"))
            .unwrap_err();
        assert!(
            err.contains("Kopie im Ordner „Import“ fehlgeschlagen"),
            "{err}"
        );
    }
}
