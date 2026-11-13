//! Einstellungen der Instanz (`settings.json` neben der Programmdatei), z. B.
//! der Zugang zu ProjectForge. Der Schlüssel (Token) liegt nicht in der Datei,
//! sondern in der Anmeldeinformationsverwaltung des Betriebssystems.

use std::fs;
use std::io::ErrorKind;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default)]
    pub projectforge: Option<ProjectForgeAccess>,
}

/// Server-Adresse und User-ID (Zahl, nicht der Login-Name).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProjectForgeAccess {
    pub base_url: String,
    pub user_id: i64,
}

impl ProjectForgeAccess {
    /// Name des Eintrags in der Anmeldeinformationsverwaltung.
    fn secret_key(&self) -> String {
        format!("ProjectForge {} #{}", self.base_url, self.user_id)
    }
}

/// Ablage für geheime Werte (Token).
pub trait SecretStore: Send + Sync {
    fn get(&self, key: &str) -> Result<Option<String>, String>;
    fn set(&self, key: &str, value: &str) -> Result<(), String>;
    fn delete(&self, key: &str) -> Result<(), String>;
}

/// Anmeldeinformationsverwaltung des Betriebssystems (Windows: Credential Manager).
pub struct SystemSecrets;

const SERVICE: &str = "Billing Tracker";

impl SecretStore for SystemSecrets {
    fn get(&self, key: &str) -> Result<Option<String>, String> {
        let entry = keyring::Entry::new(SERVICE, key).map_err(secret_error)?;
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(secret_error(e)),
        }
    }
    fn set(&self, key: &str, value: &str) -> Result<(), String> {
        keyring::Entry::new(SERVICE, key)
            .and_then(|entry| entry.set_password(value))
            .map_err(secret_error)
    }
    fn delete(&self, key: &str) -> Result<(), String> {
        match keyring::Entry::new(SERVICE, key).and_then(|entry| entry.delete_credential()) {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(secret_error(e)),
        }
    }
}

fn secret_error(e: keyring::Error) -> String {
    format!("Anmeldeinformationsverwaltung: {e}")
}

/// Geheime Werte als Dateien in einem Ordner – nur für Tests
/// (`BILLING_TRACKER_SECRETS_DIR`), nicht für den Alltag.
pub struct FileSecrets {
    dir: PathBuf,
}

impl FileSecrets {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }
    fn path(&self, key: &str) -> PathBuf {
        let name: String = key
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
            .collect();
        self.dir.join(name)
    }
}

impl SecretStore for FileSecrets {
    fn get(&self, key: &str) -> Result<Option<String>, String> {
        match fs::read_to_string(self.path(key)) {
            Ok(value) => Ok(Some(value)),
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }
    fn set(&self, key: &str, value: &str) -> Result<(), String> {
        fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        fs::write(self.path(key), value).map_err(|e| e.to_string())
    }
    fn delete(&self, key: &str) -> Result<(), String> {
        match fs::remove_file(self.path(key)) {
            Err(e) if e.kind() != ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        }
    }
}

pub struct SettingsStore {
    file: PathBuf,
    secrets: Box<dyn SecretStore>,
}

impl SettingsStore {
    pub fn new(file: impl Into<PathBuf>, secrets: Box<dyn SecretStore>) -> Self {
        Self {
            file: file.into(),
            secrets,
        }
    }

    pub fn load(&self) -> Result<Settings, String> {
        match fs::read_to_string(&self.file) {
            Ok(content) => serde_json::from_str(&content)
                .map_err(|e| format!("Einstellungen fehlerhaft ({}): {e}", self.file.display())),
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(Settings::default()),
            Err(e) => Err(format!("Einstellungen nicht lesbar: {e}")),
        }
    }

    pub fn save(&self, settings: &Settings) -> Result<(), String> {
        let failed =
            |e: std::io::Error| format!("Einstellungen konnten nicht gespeichert werden: {e}");
        if let Some(dir) = self.file.parent() {
            fs::create_dir_all(dir).map_err(failed)?;
        }
        let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
        let tmp = self.file.with_extension("json.tmp");
        fs::write(&tmp, json).map_err(failed)?;
        fs::rename(&tmp, &self.file).map_err(failed)
    }

    pub fn token(&self, access: &ProjectForgeAccess) -> Result<Option<String>, String> {
        self.secrets
            .get(&access.secret_key())
            .map(|t| t.filter(|t| !t.trim().is_empty()))
    }

    pub fn set_token(&self, access: &ProjectForgeAccess, token: &str) -> Result<(), String> {
        self.secrets.set(&access.secret_key(), token.trim())
    }

    pub fn delete_token(&self, access: &ProjectForgeAccess) -> Result<(), String> {
        self.secrets.delete(&access.secret_key())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stores_access_in_the_file_and_the_token_separately() {
        let dir = tempfile::tempdir().unwrap();
        let store = SettingsStore::new(
            dir.path().join("settings.json"),
            Box::new(FileSecrets::new(dir.path().join("secrets"))),
        );
        assert_eq!(store.load().unwrap(), Settings::default());
        let access = ProjectForgeAccess {
            base_url: "https://pf.example.com".into(),
            user_id: 42,
        };
        store
            .save(&Settings {
                projectforge: Some(access.clone()),
            })
            .unwrap();
        assert_eq!(store.load().unwrap().projectforge, Some(access.clone()));
        assert_eq!(store.token(&access).unwrap(), None);
        store.set_token(&access, " geheim\n").unwrap();
        assert_eq!(store.token(&access).unwrap().as_deref(), Some("geheim"));
        // Token steht nicht in der Datei
        let file = std::fs::read_to_string(dir.path().join("settings.json")).unwrap();
        assert!(!file.contains("geheim"), "{file}");
        store.delete_token(&access).unwrap();
        store.delete_token(&access).unwrap();
        assert_eq!(store.token(&access).unwrap(), None);

        std::fs::write(dir.path().join("settings.json"), "{kaputt").unwrap();
        assert!(
            store
                .load()
                .unwrap_err()
                .starts_with("Einstellungen fehlerhaft")
        );
    }
}
