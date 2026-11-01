//! Projektkonfiguration – wird pro Projekt als JSON-Datei gespeichert.
//!
//! Felder mit `#[serde(default)]` dürfen in der Datei fehlen; so bleiben
//! ältere oder von Hand geschriebene Konfigurationen ladbar.

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

use crate::calculation::holidays::is_known_region;

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
    /// Umsatzsteuersatz in Prozent für die Brutto-Berechnung der Rechnung
    /// (Standard; einzelne Abrechnungsregeln können abweichen).
    #[serde(default = "default_vat_percent")]
    pub vat_percent: f64,
    /// Welche Buchungen billable sind und wie sie abgerechnet werden.
    /// Die erste passende Regel gilt.
    #[serde(default = "default_billing_rules")]
    pub billing_rules: Vec<BillingRule>,
}

fn default_vat_percent() -> f64 {
    19.0
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TeamMember {
    /// Name wie in der Namensspalte des Exports.
    pub name: String,
    #[serde(default)]
    pub rates: Vec<RatePeriod>,
    /// Abweichende Arbeitszeit (h/Tag) für diese Person. Für Tage ohne
    /// passenden Zeitraum gilt die Arbeitszeit des Projekts.
    #[serde(default)]
    pub working_hours: Vec<WorkingHoursPeriod>,
}

/// Abrechnungsregel: ordnet Buchungen anhand von Kost2Art (und Element) ein.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BillingRule {
    /// Bezeichnung der Leistung, z. B. "Delivery" oder "Reisezeit".
    pub name: String,
    /// Vergleichswert für die Kost2Art-Spalte (ohne Groß-/Kleinschreibung).
    pub kost2art: String,
    #[serde(default)]
    pub match_mode: MatchMode,
    /// Element, für das die Regel gilt; leer = Element-Filter des Projekts.
    #[serde(default)]
    pub element: String,
    /// Zählt in „Billable (h)“.
    #[serde(default = "yes")]
    pub billable_hours: bool,
    /// Wird in Rechnung gestellt (Billable €).
    #[serde(default = "yes")]
    pub invoice: bool,
    /// Abgerechnete Stunden = Stunden × Mult (sonst Stunden ohne Mult).
    #[serde(default)]
    pub apply_mult: bool,
    /// Anteil des Stundensatzes in Prozent (z. B. 50 für Reisezeit zum halben Satz).
    #[serde(default = "hundred")]
    pub rate_percent: f64,
    /// Abweichender USt.-Satz; `None` = Satz des Projekts.
    #[serde(default)]
    pub vat_percent: Option<f64>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MatchMode {
    #[default]
    Exact,
    Contains,
}

fn yes() -> bool {
    true
}

fn hundred() -> f64 {
    100.0
}

/// Standardregeln laut Spezifikation: Delivery zählt als billable Stunden und
/// wird abgerechnet; alle übrigen „(billable)“-Arten (z. B. Travel) werden nur
/// abgerechnet. Mult wird bei der Abrechnung nicht angewendet.
pub fn default_billing_rules() -> Vec<BillingRule> {
    vec![
        BillingRule {
            name: "Delivery".into(),
            kost2art: "Delivery (billable)".into(),
            match_mode: MatchMode::Exact,
            element: String::new(),
            billable_hours: true,
            invoice: true,
            apply_mult: false,
            rate_percent: 100.0,
            vat_percent: None,
        },
        BillingRule {
            name: "Sonstige billable (z. B. Travel)".into(),
            kost2art: "(billable)".into(),
            match_mode: MatchMode::Contains,
            element: String::new(),
            billable_hours: false,
            invoice: true,
            apply_mult: false,
            rate_percent: 100.0,
            vat_percent: None,
        },
    ]
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
    /// Index des Teammitglieds mit diesem Namen (Groß-/Kleinschreibung und
    /// Leerzeichen am Rand werden ignoriert).
    pub fn team_index(&self, name: &str) -> Option<usize> {
        let name = name.trim();
        self.team
            .iter()
            .position(|m| m.name.trim().eq_ignore_ascii_case(name))
    }

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
        if !is_known_region(&self.holidays.region) {
            errors.push(format!(
                "Unbekannte Feiertags-Region „{}“ (erwartet z. B. „HE“).",
                self.holidays.region
            ));
        }
        if !(0.0..=100.0).contains(&self.vat_percent) {
            errors.push(format!(
                "Umsatzsteuersatz {} % liegt nicht zwischen 0 und 100.",
                self.vat_percent
            ));
        }

        for (i, member) in self.team.iter().enumerate() {
            if member.name.trim().is_empty() {
                errors.push("Teammitglied ohne Namen.".to_string());
            } else if self.team_index(&member.name) != Some(i) {
                errors.push(format!("{}: Person ist doppelt im Team.", member.name));
            }
            let label = format!("{}: Stundensatz", member.name);
            check_periods(
                &mut errors,
                &label,
                member.rates.iter().map(|r| (r.from, r.to)),
            );
            for rate in &member.rates {
                if rate.rate < 0.0 {
                    errors.push(format!("{label} darf nicht negativ sein."));
                }
            }
            let label = format!("{}: Arbeitszeit", member.name);
            check_working_hours(&mut errors, &label, &member.working_hours);
        }

        check_working_hours(&mut errors, "Arbeitszeit (Projekt)", &self.working_hours);

        for rule in &self.billing_rules {
            let label = format!("Abrechnungsregel „{}“", rule.name);
            if rule.name.trim().is_empty() {
                errors.push("Abrechnungsregel ohne Bezeichnung.".to_string());
            }
            if rule.kost2art.trim().is_empty() {
                errors.push(format!("{label}: Kost2Art darf nicht leer sein."));
            }
            if rule.rate_percent < 0.0 {
                errors.push(format!("{label}: Satz-Anteil darf nicht negativ sein."));
            }
            if let Some(vat) = rule.vat_percent
                && !(0.0..=100.0).contains(&vat)
            {
                errors.push(format!(
                    "{label}: USt. {vat} % liegt nicht zwischen 0 und 100."
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

fn check_working_hours(errors: &mut Vec<String>, label: &str, periods: &[WorkingHoursPeriod]) {
    check_periods(errors, label, periods.iter().map(|p| (p.from, p.to)));
    for period in periods {
        if !(0.0..=24.0).contains(&period.hours_per_day) {
            errors.push(format!(
                "{label} ab {}: {} h/Tag liegt nicht zwischen 0 und 24.",
                period.from, period.hours_per_day
            ));
        }
    }
}

/// Zeiträume dürfen nicht rückwärts laufen und sich nicht überschneiden.
fn check_periods(
    errors: &mut Vec<String>,
    label: &str,
    periods: impl Iterator<Item = (NaiveDate, Option<NaiveDate>)>,
) {
    let mut sorted: Vec<(NaiveDate, Option<NaiveDate>)> = periods.collect();
    for &(from, to) in &sorted {
        if let Some(to) = to
            && to < from
        {
            errors.push(format!(
                "{label}: Zeitraum endet ({to}) vor dem Beginn ({from})."
            ));
        }
    }
    sorted.sort_by_key(|(from, _)| *from);
    for pair in sorted.windows(2) {
        let ((from_a, to_a), (from_b, _)) = (pair[0], pair[1]);
        if to_a.is_none_or(|to| to >= from_b) {
            errors.push(format!(
                "{label}: Zeiträume ab {from_a} und ab {from_b} überschneiden sich."
            ));
        }
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
        assert_eq!(config.vat_percent, 19.0);
        assert_eq!(config.billing_rules, default_billing_rules());
    }

    #[test]
    fn billing_rule_fields_have_defaults() {
        let rule: BillingRule =
            serde_json::from_str(r#"{ "name": "Reisezeit", "kost2art": "Travel (billable)" }"#)
                .unwrap();
        assert_eq!(rule.match_mode, MatchMode::Exact);
        assert!(rule.billable_hours && rule.invoice && !rule.apply_mult);
        assert_eq!(rule.rate_percent, 100.0);
        assert_eq!(rule.vat_percent, None);
        let json = serde_json::to_string(&default_billing_rules()[1]).unwrap();
        assert!(json.contains(r#""match_mode":"contains""#), "{json}");
    }

    #[test]
    fn overlapping_periods_and_duplicates_are_rejected() {
        let mut config: ProjectConfig = serde_json::from_str(EXAMPLE).unwrap();
        config.working_hours[1].from = NaiveDate::from_ymd_opt(2026, 6, 1).unwrap();
        let mut copy = config.team[0].clone();
        copy.name = " erika mustermann".into();
        copy.working_hours = vec![WorkingHoursPeriod {
            from: NaiveDate::from_ymd_opt(2026, 9, 1).unwrap(),
            to: None,
            hours_per_day: 30.0,
        }];
        config.team.push(copy);
        config.billing_rules[0].kost2art = " ".into();
        config.billing_rules[1].vat_percent = Some(150.0);

        let err = config.validate().unwrap_err();
        assert!(err.contains("Arbeitszeit (Projekt): Zeiträume ab 2026-01-01 und ab 2026-06-01 überschneiden sich"), "{err}");
        assert!(err.contains("doppelt im Team"), "{err}");
        assert!(err.contains("30 h/Tag"), "{err}");
        assert!(err.contains("Kost2Art darf nicht leer sein"), "{err}");
        assert!(err.contains("USt. 150 %"), "{err}");
    }

    #[test]
    fn team_index_ignores_case_and_whitespace() {
        let config: ProjectConfig = serde_json::from_str(EXAMPLE).unwrap();
        assert_eq!(config.team_index(" erika MUSTERMANN "), Some(0));
        assert_eq!(config.team_index("Max Mustermann"), None);
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
        config.holidays.region = "XX".into();
        config.vat_percent = 120.0;
        let err = config.validate().unwrap_err();
        assert!(err.contains("Projektname"));
        assert!(err.contains("endet"));
        assert!(err.contains("Region"));
        assert!(err.contains("Umsatzsteuersatz"));
    }
}
