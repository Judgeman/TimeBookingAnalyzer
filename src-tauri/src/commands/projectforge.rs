//! Tauri-Commands: Zugang zu ProjectForge und Abruf der Buchungen (statt
//! Export-Datei). Abgerufene Daten bleiben im Ordner „ProjectForge“ neben der
//! Programmdatei, die Auswertung funktioniert damit auch ohne Netz.

use chrono::{Local, NaiveDate};
use serde::Serialize;
use tauri::State;

use super::guard::guarded;
use super::parse_export::{evaluate_export, track_forecast};
use crate::models::config::ProjectConfig;
use crate::models::results::{AuswertungResult, ExportDateSource};
use crate::parsing::export::ParseOutcome;
use crate::projectforge::client::{Access, Client, normalize_base_url, refresh};
use crate::projectforge::{CostTypes, fetch_start};
use crate::storage::forecasts::ForecastStore;
use crate::storage::projectforge::{FetchCache, FetchCacheStore};
use crate::storage::projects::ProjectStore;
use crate::storage::settings::{ProjectForgeAccess, SettingsStore};

/// Zugang, wie ihn die Oberfläche sieht (ohne den Schlüssel selbst).
#[derive(Debug, Serialize, PartialEq)]
pub struct ProjectForgeSettings {
    pub base_url: String,
    pub user_id: Option<i64>,
    pub has_token: bool,
}

fn view(settings: &SettingsStore) -> Result<ProjectForgeSettings, String> {
    Ok(match settings.load()?.projectforge {
        Some(access) => ProjectForgeSettings {
            has_token: settings.token(&access)?.is_some(),
            base_url: access.base_url,
            user_id: Some(access.user_id),
        },
        None => ProjectForgeSettings {
            base_url: String::new(),
            user_id: None,
            has_token: false,
        },
    })
}

#[tauri::command]
pub async fn projectforge_settings(
    settings: State<'_, SettingsStore>,
) -> Result<ProjectForgeSettings, String> {
    view(&settings)
}

/// Speichert Adresse und User-ID; `token` nur, wenn angegeben (sonst bleibt der
/// gespeicherte – bei geänderter Adresse/User-ID wird er übernommen).
#[tauri::command]
pub async fn save_projectforge_settings(
    base_url: String,
    user_id: i64,
    token: Option<String>,
    settings: State<'_, SettingsStore>,
) -> Result<ProjectForgeSettings, String> {
    save_access(&settings, &base_url, user_id, token)?;
    view(&settings)
}

pub fn save_access(
    settings: &SettingsStore,
    base_url: &str,
    user_id: i64,
    token: Option<String>,
) -> Result<(), String> {
    let base_url = normalize_base_url(base_url)?;
    if user_id <= 0 {
        return Err(
            "Die User-ID ist eine Zahl – zu finden unter <Server>/rs/userStatus als „userId“."
                .into(),
        );
    }
    let mut current = settings.load()?;
    let access = ProjectForgeAccess { base_url, user_id };
    match token
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
    {
        Some(token) => settings.set_token(&access, &token)?,
        None => {
            if let Some(old) = current.projectforge.as_ref().filter(|old| **old != access)
                && let Some(token) = settings.token(old)?
            {
                settings.set_token(&access, &token)?;
            }
        }
    }
    current.projectforge = Some(access);
    settings.save(&current)
}

#[tauri::command]
pub async fn delete_projectforge_token(
    settings: State<'_, SettingsStore>,
) -> Result<ProjectForgeSettings, String> {
    if let Some(access) = settings.load()?.projectforge {
        settings.delete_token(&access)?;
    }
    view(&settings)
}

fn client_from(settings: &SettingsStore) -> Result<Client, String> {
    let access = settings.load()?.projectforge.ok_or(
        "Zugang zu ProjectForge fehlt – bitte unter „ProjectForge-Zugang“ (links unten) eintragen.",
    )?;
    let token = settings.token(&access)?.ok_or(
        "Schlüssel für ProjectForge fehlt – bitte unter „ProjectForge-Zugang“ (links unten) eintragen.",
    )?;
    Client::new(&Access {
        base_url: access.base_url,
        user_id: access.user_id,
        token,
    })
}

/// Prüft den Zugang mit `/rs/bookableTasks`.
#[tauri::command]
pub async fn test_projectforge(settings: State<'_, SettingsStore>) -> Result<String, String> {
    let client = client_from(&settings)?;
    let tasks = client.bookable_tasks().await?;
    let kinds = CostTypes::from_bookable(&tasks).kinds.len();
    Ok(format!(
        "Verbindung steht: {} buchbare Tasks, {kinds} Kostenarten.",
        tasks.len()
    ))
}

/// Ruft fehlende und offene Monate ab (`full` = alle) und wertet aus.
#[tauri::command]
pub async fn fetch_projectforge(
    project_id: String,
    cutoff_date: Option<NaiveDate>,
    full: bool,
    store: State<'_, ProjectStore>,
    settings: State<'_, SettingsStore>,
    caches: State<'_, FetchCacheStore>,
    forecasts: State<'_, ForecastStore>,
) -> Result<AuswertungResult, String> {
    let config = store.get(&project_id)?;
    let client = client_from(&settings)?;
    let cache = caches.load(&project_id)?.unwrap_or_default();
    let now = Local::now().naive_local();
    let budget_starts = config
        .budgets
        .iter()
        .filter_map(|b| b.range().map(|(from, _)| from));
    let from = fetch_start(now.date(), budget_starts);
    let cache = refresh(&client, cache, from, now, full).await?;
    caches.save(&project_id, &cache)?;
    evaluate(config, cache, cutoff_date, &forecasts, &project_id).await
}

/// Wertet die zuletzt abgerufenen Daten aus (ohne Netz); `None` = noch kein Abruf.
#[tauri::command]
pub async fn projectforge_cached(
    project_id: String,
    cutoff_date: Option<NaiveDate>,
    store: State<'_, ProjectStore>,
    caches: State<'_, FetchCacheStore>,
    forecasts: State<'_, ForecastStore>,
) -> Result<Option<AuswertungResult>, String> {
    let config = store.get(&project_id)?;
    match caches.load(&project_id)? {
        Some(cache) if cache.fetched_at.is_some() => {
            evaluate(config, cache, cutoff_date, &forecasts, &project_id)
                .await
                .map(Some)
        }
        _ => Ok(None),
    }
}

async fn evaluate(
    config: ProjectConfig,
    cache: FetchCache,
    cutoff: Option<NaiveDate>,
    forecasts: &ForecastStore,
    project_id: &str,
) -> Result<AuswertungResult, String> {
    let mut result = tauri::async_runtime::spawn_blocking(move || {
        guarded("der Auswertung", || evaluate_cache(&config, &cache, cutoff))
    })
    .await
    .map_err(|e| format!("Auswertung abgebrochen: {e}"))??;
    if let Err(e) = guarded("der gespeicherten Prognose", || {
        track_forecast(forecasts, project_id, &mut result);
        Ok(())
    }) {
        result.warnings.push(e);
    }
    Ok(result)
}

/// Auswertung der abgerufenen Buchungen; Stand = Zeitpunkt des Abrufs.
pub fn evaluate_cache(
    config: &ProjectConfig,
    cache: &FetchCache,
    cutoff: Option<NaiveDate>,
) -> Result<AuswertungResult, String> {
    let fetched_at = cache
        .fetched_at
        .ok_or("Noch keine Daten aus ProjectForge abgerufen.")?;
    let outcome = ParseOutcome {
        sheet_name: "ProjectForge".into(),
        entries: cache.entries(),
        skipped: vec![],
    };
    let file_name = format!(
        "ProjectForge – Abruf {}",
        fetched_at.format("%d.%m.%Y, %H:%M")
    );
    let mut result = evaluate_export(
        config,
        outcome,
        file_name,
        Some((fetched_at.date(), ExportDateSource::Fetched)),
        cutoff,
    )?;
    let unknown = cache.unknown_kinds();
    if !unknown.is_empty() {
        result.warnings.push(format!(
            "Arbeitsanteil („Mult“) unbekannt für Kostenart {} – mit 1 gerechnet (die Kostenart ist bei keinem Task hinterlegt, auf den der Zugang buchen darf).",
            unknown.into_iter().collect::<Vec<_>>().join(", ")
        ));
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projectforge::client::tests::{BOOKABLE, d, period, row_json, serve};
    use crate::storage::settings::FileSecrets;

    fn sample_config() -> ProjectConfig {
        let json = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../sample-data/beispiel-projekt.json"),
        )
        .unwrap();
        serde_json::from_str(&json).unwrap()
    }

    #[test]
    fn saves_access_and_keeps_or_moves_the_token() {
        let dir = tempfile::tempdir().unwrap();
        let settings = SettingsStore::new(
            dir.path().join("settings.json"),
            Box::new(FileSecrets::new(dir.path().join("secrets"))),
        );
        assert_eq!(
            view(&settings).unwrap(),
            ProjectForgeSettings {
                base_url: String::new(),
                user_id: None,
                has_token: false
            }
        );
        assert!(
            client_from(&settings)
                .err()
                .unwrap()
                .starts_with("Zugang zu ProjectForge fehlt")
        );
        assert!(
            save_access(&settings, "pf.example.com", 0, None)
                .unwrap_err()
                .contains("userStatus")
        );
        assert!(save_access(&settings, " ", 42, None).is_err());

        save_access(&settings, "pf.example.com/", 42, None).unwrap();
        assert_eq!(
            view(&settings).unwrap(),
            ProjectForgeSettings {
                base_url: "https://pf.example.com".into(),
                user_id: Some(42),
                has_token: false
            }
        );
        assert!(
            client_from(&settings)
                .err()
                .unwrap()
                .starts_with("Schlüssel für ProjectForge fehlt")
        );
        save_access(
            &settings,
            "https://pf.example.com",
            42,
            Some(" geheim ".into()),
        )
        .unwrap();
        assert!(view(&settings).unwrap().has_token);
        // andere User-ID ohne neuen Schlüssel → Schlüssel wird übernommen
        save_access(&settings, "https://pf.example.com", 43, Some("  ".into())).unwrap();
        let access = settings.load().unwrap().projectforge.unwrap();
        assert_eq!(settings.token(&access).unwrap().as_deref(), Some("geheim"));
        assert!(client_from(&settings).is_ok());
        settings.delete_token(&access).unwrap();
        assert!(!view(&settings).unwrap().has_token);
    }

    #[test]
    fn evaluates_fetched_bookings_like_an_export() {
        // Beispielprojekt, ein Abruf mit Buchungen von Erika und Max im November
        let (url, _) = serve(|request| {
            if request.path == "/rs/bookableTasks" {
                return (200, BOOKABLE.into());
            }
            let rows = if period(request).0 == "2026-11-01" {
                vec![
                    row_json(1, "Erika Mustermann", "2026-11-02T07:00:00.000Z", 8.0, 4),
                    row_json(2, "Max Mustermann", "2026-11-02T07:00:00.000Z", 6.0, 4),
                    row_json(3, "Max Mustermann", "2026-11-03T07:00:00.000Z", 2.0, 5),
                ]
            } else {
                vec![]
            };
            (200, format!(r#"{{"resultSet":[{}]}}"#, rows.join(",")))
        });
        let client = Client::new(&Access {
            base_url: url,
            user_id: 42,
            token: "geheim".into(),
        })
        .unwrap();
        let now = d(11, 3).and_hms_opt(18, 0, 0).unwrap();
        let cache = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(refresh(
                &client,
                FetchCache::default(),
                d(11, 1),
                now,
                false,
            ))
            .unwrap();
        let config = sample_config();
        let result = evaluate_cache(&config, &cache, None).unwrap();
        assert_eq!(result.file_name, "ProjectForge – Abruf 03.11.2026, 18:00");
        assert_eq!(result.export_date, Some(d(11, 3)));
        assert_eq!(result.export_date_source, Some(ExportDateSource::Fetched));
        assert_eq!(result.cutoff_date, d(11, 3));
        assert_eq!(result.overview.sheet_name, "ProjectForge");
        let erika = result
            .persons
            .iter()
            .find(|p| p.name == "Erika Mustermann")
            .unwrap();
        assert_eq!(erika.periods.ytd.bill_h, 8.0);
        assert_eq!(erika.periods.ytd.bill_eur, 840.0); // 8 h × 105 €
        let max = result
            .persons
            .iter()
            .find(|p| p.name == "Max Mustermann")
            .unwrap();
        // Travel (billable): Arbeitsanteil 0 → nicht gearbeitet, aber 2 h × 95 € abgerechnet
        assert_eq!(max.periods.ytd.gearb, 6.0);
        assert_eq!(max.periods.ytd.bill_eur, 6.0 * 95.0 + 2.0 * 95.0);
        assert!(
            result.warnings.iter().all(|w| !w.contains("Arbeitsanteil")),
            "{:?}",
            result.warnings
        );

        // ohne Abruf keine Auswertung; unbekannte Kostenart → Hinweis
        assert!(evaluate_cache(&config, &FetchCache::default(), None).is_err());
        let mut unknown = cache.clone();
        unknown
            .months
            .get_mut("2026-11")
            .unwrap()
            .unknown_kinds
            .insert("99 Sonstiges".into());
        let result = evaluate_cache(&config, &unknown, Some(d(11, 2))).unwrap();
        assert!(
            result
                .warnings
                .iter()
                .any(|w| w
                    .starts_with("Arbeitsanteil („Mult“) unbekannt für Kostenart 99 Sonstiges"))
        );
    }
}
