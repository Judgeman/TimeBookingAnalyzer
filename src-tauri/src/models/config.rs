//! Projektkonfiguration – wird pro Projekt als JSON-Datei gespeichert.
//!
//! Felder mit `#[serde(default)]` dürfen in der Datei fehlen; so bleiben
//! ältere oder von Hand geschriebene Konfigurationen ladbar.

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProjectConfig {
    /// UUID v4. Leer beim Anlegen – wird von `save_project` vergeben.
    #[serde(default)]
    pub id: String,
    pub name: String,
    /// Wert der Element-Spalte, der zum Projekt gehört (z. B. "P100 Lager-App").
    #[serde(default)]
    pub element_filter: String,
    #[serde(default)]
    pub team: Vec<TeamMember>,
    #[serde(default)]
    pub working_hours: Vec<WorkingHoursPeriod>,
    #[serde(default)]
    pub holidays: HolidayConfig,
    #[serde(default)]
    pub export_format: ExportFormat,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TeamMember {
    /// Name wie in der Namensspalte des Exports.
    pub name: String,
    #[serde(default)]
    pub rates: Vec<RatePeriod>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RatePeriod {
    pub from: NaiveDate,
    /// `None` = unbefristet.
    #[serde(default)]
    pub to: Option<NaiveDate>,
    /// Stundensatz in EUR.
    pub rate: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorkingHoursPeriod {
    pub from: NaiveDate,
    #[serde(default)]
    pub to: Option<NaiveDate>,
    pub hours_per_day: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HolidayConfig {
    /// Bundesland-Kürzel, z. B. "HE".
    #[serde(default = "default_region")]
    pub region: String,
    /// Zusätzliche freie Tage (z. B. Betriebsferien).
    #[serde(default)]
    pub custom: Vec<NaiveDate>,
}

impl Default for HolidayConfig {
    fn default() -> Self {
        Self {
            region: default_region(),
            custom: Vec::new(),
        }
    }
}

fn default_region() -> String {
    "HE".to_string()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExportFormat {
    #[serde(default = "default_sheet_name")]
    pub sheet_name: String,
    #[serde(default)]
    pub columns: ColumnMapping,
    #[serde(default)]
    pub special_elements: SpecialElements,
}

impl Default for ExportFormat {
    fn default() -> Self {
        Self {
            sheet_name: default_sheet_name(),
            columns: ColumnMapping::default(),
            special_elements: SpecialElements::default(),
        }
    }
}

fn default_sheet_name() -> String {
    "Details".to_string()
}

/// 0-basierte Spaltenindizes im Export (0 = Spalte A).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ColumnMapping {
    pub name: usize,
    pub date: usize,
    pub duration: usize,
    pub mult: usize,
    pub element: usize,
    pub kost2art: usize,
    pub location: usize,
}

impl Default for ColumnMapping {
    fn default() -> Self {
        Self {
            name: 0,
            date: 2,
            duration: 5,
            mult: 8,
            element: 9,
            kost2art: 11,
            location: 13,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SpecialElements {
    pub sick: String,
    pub vacation: String,
}

impl Default for SpecialElements {
    fn default() -> Self {
        Self {
            sick: "(Sick)".to_string(),
            vacation: "(Vacation)".to_string(),
        }
    }
}

impl ProjectConfig {
    /// Prüft die Konfiguration auf offensichtliche Fehler.
    /// Gibt alle gefundenen Probleme auf einmal zurück.
    pub fn validate(&self) -> Result<(), String> {
        let mut errors = Vec::new();

        if self.name.trim().is_empty() {
            errors.push("Projektname darf nicht leer sein.".to_string());
        }
        if self.export_format.sheet_name.trim().is_empty() {
            errors.push("Tabellenblatt-Name darf nicht leer sein.".to_string());
        }

        for member in &self.team {
            if member.name.trim().is_empty() {
                errors.push("Teammitglied ohne Namen.".to_string());
            }
            for rate in &member.rates {
                check_period(&mut errors, &member.name, rate.from, rate.to);
                if rate.rate < 0.0 {
                    errors.push(format!(
                        "{}: Stundensatz darf nicht negativ sein.",
                        member.name
                    ));
                }
            }
        }

        for period in &self.working_hours {
            check_period(&mut errors, "Arbeitszeit", period.from, period.to);
            if !(0.0..=24.0).contains(&period.hours_per_day) {
                errors.push(format!(
                    "Arbeitszeit ab {}: {} h/Tag liegt nicht zwischen 0 und 24.",
                    period.from, period.hours_per_day
                ));
            }
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join("\n"))
        }
    }
}

fn check_period(errors: &mut Vec<String>, label: &str, from: NaiveDate, to: Option<NaiveDate>) {
    if let Some(to) = to
        && to < from
    {
        errors.push(format!(
            "{label}: Zeitraum endet ({to}) vor dem Beginn ({from})."
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXAMPLE: &str = r#"{
      "id": "6f1c2a8e-0000-4000-8000-000000000001",
      "name": "Musterkunde GmbH / Lager-App",
      "element_filter": "P100 Lager-App",
      "team": [
        { "name": "Erika Mustermann", "rates": [
            { "from": "2026-01-01", "to": "2026-06-30", "rate": 100 },
            { "from": "2026-07-01", "to": null, "rate": 105 } ] }
      ],
      "working_hours": [
        { "from": "2026-01-01", "to": "2026-06-30", "hours_per_day": 8.0 },
        { "from": "2026-07-01", "to": null, "hours_per_day": 7.5 }
      ],
      "holidays": { "region": "HE", "custom": [] },
      "export_format": {
        "sheet_name": "Details",
        "columns": { "name": 0, "date": 2, "duration": 5, "mult": 8,
                     "element": 9, "kost2art": 11, "location": 13 },
        "special_elements": { "sick": "(Sick)", "vacation": "(Vacation)" }
      }
    }"#;

    #[test]
    fn parses_example_from_spec() {
        let config: ProjectConfig = serde_json::from_str(EXAMPLE).unwrap();
        assert_eq!(config.name, "Musterkunde GmbH / Lager-App");
        assert_eq!(config.team[0].rates[1].to, None);
        assert_eq!(config.team[0].rates[1].rate, 105.0);
        assert_eq!(config.working_hours[0].hours_per_day, 8.0);
        assert_eq!(config.export_format.columns.kost2art, 11);
        assert!(config.validate().is_ok());
    }

    #[test]
    fn missing_sections_fall_back_to_defaults() {
        let config: ProjectConfig = serde_json::from_str(r#"{ "name": "Minimal" }"#).unwrap();
        assert_eq!(config.id, "");
        assert_eq!(config.export_format, ExportFormat::default());
        assert_eq!(config.holidays.region, "HE");
    }

    #[test]
    fn roundtrip_keeps_dates_as_iso_strings() {
        let config: ProjectConfig = serde_json::from_str(EXAMPLE).unwrap();
        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains(r#""from":"2026-07-01","to":null"#));
        let back: ProjectConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(back, config);
    }

    #[test]
    fn validate_reports_all_problems() {
        let mut config: ProjectConfig = serde_json::from_str(EXAMPLE).unwrap();
        config.name = "  ".into();
        config.working_hours[0].to = NaiveDate::from_ymd_opt(2025, 12, 31);
        let err = config.validate().unwrap_err();
        assert!(err.contains("Projektname"));
        assert!(err.contains("endet"));
    }
}
