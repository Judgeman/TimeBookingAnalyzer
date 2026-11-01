//! Rückgabetypen der Tauri-Commands.
//!
//! Die eigentliche Auswertung (`AuswertungResult`: Soll/Ist, gearb, billable …)
//! folgt im nächsten Schritt; bis dahin liefert `parse_export` eine Übersicht
//! über die eingelesenen Daten, damit Spalten-Mapping und Projektregeln
//! geprüft werden können.

use chrono::NaiveDate;
use serde::Serialize;

use super::entry::TimeEntry;

/// Eintrag in der Projektliste (Sidebar).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub element_filter: String,
    pub team_size: usize,
}

/// Ergebnis von `parse_export`.
#[derive(Debug, Clone, Serialize)]
pub struct ParsedExport {
    pub project_id: String,
    pub project_name: String,
    pub file_name: String,
    pub sheet_name: String,
    /// "Stand" des Exports: Datum aus dem Dateinamen, sonst Änderungsdatum der Datei.
    pub export_date: Option<NaiveDate>,
    /// Erste und letzte Buchung im Export.
    pub first_entry_date: Option<NaiveDate>,
    pub last_entry_date: Option<NaiveDate>,
    pub entry_count: usize,
    pub total_hours: f64,
    /// Einträge, deren Element dem Projektfilter entspricht.
    pub element_match_count: usize,
    pub persons: Vec<PersonOverview>,
    /// Teammitglieder aus der Konfiguration, die im Export nicht vorkommen.
    pub missing_team_members: Vec<String>,
    /// Zeilen, die nicht eingelesen werden konnten (Kopfzeile ausgenommen).
    pub skipped_rows: Vec<SkippedRow>,
    /// Die ersten Einträge zur Kontrolle des Spalten-Mappings.
    pub preview: Vec<TimeEntry>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PersonOverview {
    pub name: String,
    pub in_team: bool,
    pub entry_count: usize,
    /// Summe der gebuchten Stunden (ohne Multiplikator), gerundet auf 2 Stellen.
    pub hours: f64,
    /// Davon auf das Projekt-Element gebucht.
    pub project_hours: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SkippedRow {
    /// Zeilennummer wie in Excel (1-basiert).
    pub row: usize,
    pub reason: String,
}
