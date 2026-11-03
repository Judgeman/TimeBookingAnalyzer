mod calculation;
mod commands;
mod models;
mod parsing;
mod storage;

use tauri::Manager;

use storage::beside_exe;
use storage::imports::ImportStore;
use storage::projects::ProjectStore;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Projekte und letzte Import-Dateien liegen neben der Programmdatei:
            // Jede Kopie der App hat eigene Daten, mehrere Instanzen laufen unabhängig.
            let exe = std::env::current_exe()?;
            let legacy_dir = app.path().app_data_dir().ok().map(|d| d.join("projects"));
            app.manage(ProjectStore::new(beside_exe(&exe, "projects")).with_legacy(legacy_dir));
            app.manage(ImportStore::new(beside_exe(&exe, "Import")));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::parse_export::parse_export,
            commands::config::list_projects,
            commands::config::get_project,
            commands::config::save_project,
            commands::config::delete_project,
            commands::config::project_folder,
            commands::config::import_legacy_projects,
            commands::config::last_import,
            commands::config::remember_import,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
