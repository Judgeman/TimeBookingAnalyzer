use chrono::{NaiveDate, NaiveTime};
use serde::Serialize;

/// Eine Buchungszeile aus dem ProjectForge-Export.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
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
    /// Inhalt der Billable-Spalte, wie in Excel angezeigt (Wahrheitswerte als
    /// „WAHR“/„FALSCH“); `None` = Spalte im Export-Format nicht gesetzt.
    pub billable: Option<String>,
    /// Beginn und Ende (Uhrzeit, für den Wochenkalender); `None` = unbekannt.
    pub start: Option<NaiveTime>,
    pub end: Option<NaiveTime>,
    /// Beschreibung der Buchung (z. B. Ticketnummer), für den Wochenkalender.
    pub description: String,
}
