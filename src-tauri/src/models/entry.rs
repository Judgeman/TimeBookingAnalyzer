use chrono::NaiveDate;
use serde::Serialize;

/// Eine Buchungszeile aus dem ProjectForge-Export.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TimeEntry {
    pub name: String,
    pub date: NaiveDate,
    /// Gebuchte Dauer in Stunden (ohne Multiplikator).
    pub hours: f64,
    /// Multiplikator; leere Zelle = 1.0.
    pub mult: f64,
    pub element: String,
    pub kost2art: String,
    pub location: String,
    /// Wert der Billable-Spalte (falls im Export-Format gesetzt): `None` =
    /// keine Spalte bzw. leerer/unbekannter Wert.
    pub billable: Option<bool>,
}
