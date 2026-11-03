mod calculation;
mod commands;
mod models;
mod parsing;
mod storage;

use tauri::Manager;

use storage::projects::{ProjectStore, projects_dir_beside};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Projekte liegen neben der Programmdatei: Jede Kopie der App hat
            // eigene Projekte, mehrere Instanzen laufen unabhängig.
            let projects_dir = projects_dir_beside(&std::env::current_exe()?);
            let legacy_dir = app.path().app_data_dir().ok().map(|d| d.join("projects"));
            app.manage(ProjectStore::new(projects_dir).with_legacy(legacy_dir));
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
