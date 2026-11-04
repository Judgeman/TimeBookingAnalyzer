//! Tauri-Commands zum Laden/Speichern der Projektkonfigurationen.

use tauri::State;

use crate::models::config::ProjectConfig;
use crate::models::results::{LastImport, ProjectFolder, ProjectSummary};
use crate::storage::forecasts::ForecastStore;
use crate::storage::imports::ImportStore;
use crate::storage::projects::ProjectStore;

#[tauri::command]
pub async fn list_projects(store: State<'_, ProjectStore>) -> Result<Vec<ProjectSummary>, String> {
    store.list()
}

#[tauri::command]
pub async fn get_project(
    id: String,
    store: State<'_, ProjectStore>,
) -> Result<ProjectConfig, String> {
    store.get(&id)
}

/// Legt ein Projekt an (leere `id`) oder überschreibt es. Gibt die ID zurück.
#[tauri::command]
pub async fn save_project(
    config: ProjectConfig,
    store: State<'_, ProjectStore>,
) -> Result<String, String> {
    store.save(config)
}

/// Löscht das Projekt samt gemerkter Import-Datei und gespeicherter Prognosen.
#[tauri::command]
pub async fn delete_project(
    id: String,
    store: State<'_, ProjectStore>,
    imports: State<'_, ImportStore>,
    forecasts: State<'_, ForecastStore>,
) -> Result<(), String> {
    store.delete(&id)?;
    imports.forget(&id)?;
    forecasts.forget(&id)
}

/// Projektordner dieser Instanz (neben der Programmdatei).
#[tauri::command]
pub async fn project_folder(store: State<'_, ProjectStore>) -> Result<ProjectFolder, String> {
    Ok(store.folder())
}

/// Übernimmt Projekte vom früheren Ablageort (App-Datenverzeichnis).
#[tauri::command]
pub async fn import_legacy_projects(store: State<'_, ProjectStore>) -> Result<usize, String> {
    store.import_legacy()
}

/// Zuletzt eingelesene Export-Datei des Projekts (Kopie im Ordner `Import`).
#[tauri::command]
pub async fn last_import(
    project_id: String,
    imports: State<'_, ImportStore>,
) -> Result<Option<LastImport>, String> {
    imports.last(&project_id)
}

/// Merkt sich die Datei als letzten Import des Projekts (legt eine Kopie ab).
#[tauri::command]
pub async fn remember_import(
    project_id: String,
    file_path: String,
    imports: State<'_, ImportStore>,
) -> Result<LastImport, String> {
    imports.remember(&project_id, std::path::Path::new(&file_path))
}
