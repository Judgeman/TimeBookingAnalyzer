mod calculation;
mod commands;
mod models;
mod parsing;
mod storage;
mod window;

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use tauri::{Manager, WindowEvent};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

use storage::beside_exe;
use storage::forecasts::ForecastStore;
use storage::imports::ImportStore;
use storage::projects::ProjectStore;

/// Fensterposition und -größe des letzten Aufrufs – neben der Programmdatei,
/// damit jede Instanz ihr eigenes Fenster behält.
const WINDOW_STATE_FILE: &str = "window-state.json";

fn window_state_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    let builder = tauri_plugin_window_state::Builder::new();
    // Das Plugin legt die Datei unter `app_config_dir().join(filename)` ab; ein
    // absoluter Pfad ersetzt dabei das Verzeichnis.
    match std::env::current_exe() {
        Ok(exe) => builder.with_filename(beside_exe(&exe, WINDOW_STATE_FILE).to_string_lossy()),
        Err(_) => builder,
    }
    .build()
}

/// Speichert Position und Größe kurz nach dem Verschieben bzw. Ändern der
/// Größe – nicht erst beim Beenden. So bleibt der Stand auch erhalten, wenn
/// die App nicht regulär beendet wird (Absturz, Herunterfahren).
fn save_window_state_on_change(app: &tauri::App) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let handle = app.handle().clone();
    let generation = Arc::new(AtomicU64::new(0));
    window.on_window_event(move |event| {
        if !matches!(event, WindowEvent::Moved(_) | WindowEvent::Resized(_)) {
            return;
        }
        let current = generation.fetch_add(1, Ordering::SeqCst) + 1;
        let (generation, handle) = (generation.clone(), handle.clone());
        tauri::async_runtime::spawn_blocking(move || {
            std::thread::sleep(Duration::from_millis(500));
            // nur die letzte Änderung einer Serie (z. B. beim Ziehen) speichern –
            // auf dem Haupt-Thread wie das Plugin selbst: von einem anderen
            // Thread aus blockiert sich das Abfragen des Fensters mit den
            // Fenster-Ereignissen (Sperre des Plugins).
            if generation.load(Ordering::SeqCst) == current {
                let app = handle.clone();
                let _ = handle.run_on_main_thread(move || {
                    let _ = app.save_window_state(StateFlags::all());
                });
            }
        });
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    commands::guard::install_panic_hook();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(window_state_plugin())
        .setup(|app| {
            // Projekte und letzte Import-Dateien liegen neben der Programmdatei:
            // Jede Kopie der App hat eigene Daten, mehrere Instanzen laufen unabhängig.
            let exe = std::env::current_exe()?;
            let legacy_dir = app.path().app_data_dir().ok().map(|d| d.join("projects"));
            app.manage(ProjectStore::new(beside_exe(&exe, "projects")).with_legacy(legacy_dir));
            app.manage(ImportStore::new(beside_exe(&exe, "Import")));
            app.manage(ForecastStore::new(beside_exe(&exe, "Prognosen")));
            // Gespeichertes Fenster (bzw. Standardgröße) an den Bildschirm anpassen.
            // Sofort (Windows: Maße stimmen schon) und noch einmal, sobald das
            // Fenster angezeigt wird (GTK liefert vorher unsinnige Maße).
            if let Some(main) = app.get_webview_window("main") {
                // Versionsnummer (aus package.json) im Fenstertitel
                let info = app.package_info();
                let _ = main.set_title(&format!("{} {}", info.name, info.version));
                let _ = window::fit_to_screen(&main);
                window::fit_to_screen_soon(main);
            }
            save_window_state_on_change(app);
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

#[cfg(test)]
mod tests {
    /// Die Versionsnummer steht in package.json (Quelle für tauri.conf.json und
    /// die Anzeige) und in Cargo.toml – beide müssen gleich sein.
    #[test]
    fn version_is_the_same_everywhere() {
        let read = |file: &str| -> serde_json::Value {
            let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(file);
            serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
        };
        let package = read("../package.json");
        assert_eq!(package["version"], env!("CARGO_PKG_VERSION"));
        assert_eq!(read("tauri.conf.json")["version"], "../package.json");
        let lock = read("../package-lock.json");
        assert_eq!(lock["version"], package["version"]);
        assert_eq!(lock["packages"][""]["version"], package["version"]);
        // so liest Tauri sie (Fenstertitel, Datei-Version der Exe)
        let context: tauri::Context<tauri::Wry> = tauri::generate_context!();
        assert_eq!(
            context.package_info().version.to_string(),
            package["version"].as_str().unwrap()
        );
        assert_eq!(context.package_info().name, "Billing Tracker");
    }
}
