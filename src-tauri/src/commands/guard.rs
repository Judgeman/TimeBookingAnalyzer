//! Interne Fehler (Panics) werden zu Fehlermeldungen statt das Programm zu
//! beenden – mit Stelle im Code, damit sie sich melden und beheben lassen.

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::Mutex;

/// Stelle im Code des letzten internen Fehlers (vom Panic-Hook gesetzt).
static LAST_LOCATION: Mutex<Option<String>> = Mutex::new(None);

/// Merkt sich bei jedem internen Fehler die Stelle im Code (für [`guarded`]).
pub fn install_panic_hook() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if let Some(location) = info.location()
            && let Ok(mut last) = LAST_LOCATION.lock()
        {
            *last = Some(format!("{}:{}", location.file(), location.line()));
        }
        default(info);
    }));
}

/// Führt `f` aus; stürzt es intern ab, kommt eine Fehlermeldung zurück.
pub fn guarded<T>(what: &str, f: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    catch_unwind(AssertUnwindSafe(f)).unwrap_or_else(|payload| {
        let message = payload
            .downcast_ref::<String>()
            .map(String::as_str)
            .or_else(|| payload.downcast_ref::<&str>().copied())
            .unwrap_or("unbekannt");
        let location = LAST_LOCATION
            .lock()
            .ok()
            .and_then(|mut last| last.take())
            .map(|l| format!(" [{l}]"))
            .unwrap_or_default();
        Err(format!(
            "Interner Fehler bei {what}: {message}{location}. Bitte diese Meldung melden – die Export-Datei und das Projekt bleiben unverändert."
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn panics_become_error_messages() {
        assert_eq!(guarded("der Auswertung", || Ok::<_, String>(7)), Ok(7));
        assert_eq!(
            guarded("der Auswertung", || Err::<(), _>("Datei fehlt".to_string())),
            Err("Datei fehlt".to_string())
        );
        let error = guarded("der Auswertung", || -> Result<(), String> {
            panic!("Bereich verkehrt")
        })
        .unwrap_err();
        assert!(
            error.starts_with("Interner Fehler bei der Auswertung: Bereich verkehrt"),
            "{error}"
        );
        assert!(error.contains("Bitte diese Meldung melden"), "{error}");
        let number = 3;
        let error = guarded("x", || -> Result<(), String> { panic!("Wert {number}") }).unwrap_err();
        assert!(error.contains("Wert 3"), "{error}");
    }
}
