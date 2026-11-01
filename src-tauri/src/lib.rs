mod commands;
mod models;
mod parsing;
mod storage;

use tauri::Manager;

use storage::projects::ProjectStore;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let projects_dir = app.path().app_data_dir()?.join("projects");
            app.manage(ProjectStore::new(projects_dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::parse_export::parse_export,
            commands::config::list_projects,
            commands::config::get_project,
            commands::config::save_project,
            commands::config::delete_project,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
