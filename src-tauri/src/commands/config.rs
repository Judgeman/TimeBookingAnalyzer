//! Tauri-Commands zum Laden/Speichern der Projektkonfigurationen.

use tauri::State;

use crate::models::config::ProjectConfig;
use crate::models::results::ProjectSummary;
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

#[tauri::command]
pub async fn delete_project(id: String, store: State<'_, ProjectStore>) -> Result<(), String> {
    store.delete(&id)
}
