//! Rückgabetypen der Tauri-Commands.

use std::collections::BTreeMap;

use chrono::NaiveDate;
use serde::Serialize;

use super::entry::TimeEntry;
use crate::calculation::holidays::Holiday;

/// Eintrag in der Projektliste (Sidebar).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub element_filter: String,
    pub team_size: usize,
}

/// Übersicht über die eingelesenen Rohdaten (Teil von `AuswertungResult`).
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

// ---------------------------------------------------------------------------
// Auswertung
// ---------------------------------------------------------------------------

/// Woher das Export-Datum („Stand“) stammt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportDateSource {
    FileName,
    Modified,
}

/// Ergebnis von `parse_export`.
#[derive(Debug, Clone, Serialize)]
pub struct AuswertungResult {
    pub project_id: String,
    pub project_name: String,
    pub file_name: String,
    pub export_date: Option<NaiveDate>,
    pub export_date_source: Option<ExportDateSource>,
    /// Ausgewerteter Zeitraum: 1. Januar des Stichtag-Jahres bis Stichtag.
    pub period_start: NaiveDate,
    pub cutoff_date: NaiveDate,
    /// Stichtag ohne manuelle Vorgabe (Export-Datum bzw. letzte Buchung).
    pub default_cutoff_date: NaiveDate,
    pub persons: Vec<PersonResult>,
    pub team: PeriodBreakdown,
    pub invoice: InvoiceSummary,
    pub holiday_region: String,
    pub holidays: Vec<Holiday>,
    pub warnings: Vec<String>,
    /// Hervorzuhebende Buchungen (z. B. Urlaub/Krank an arbeitsfreien Tagen).
    pub flagged: Vec<FlaggedBooking>,
    pub overview: ParsedExport,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AbsenceKind {
    Vacation,
    Sick,
}

/// Urlaub/Krank, der auffällt, aber mitgezählt wird.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct FlaggedBooking {
    pub person: String,
    pub date: NaiveDate,
    pub kind: AbsenceKind,
    /// Gebuchte (Personio-)Stunden des Tages.
    pub hours: f64,
    /// Angerechnete Tage (ganzer oder halber Standard-Tag).
    pub credited_days: f64,
    /// Angerechnete Stunden (Tage × h/Tag der Person).
    pub credited_hours: f64,
    /// Grund, z. B. "Samstag", "Feiertag (Neujahr)", "ungewöhnliche Dauer".
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PersonResult {
    pub name: String,
    #[serde(flatten)]
    pub periods: PeriodBreakdown,
}

/// Kennzahlen für das Jahr (bis Stichtag), je Monat, je ISO-Kalenderwoche und
/// je Kalenderwoche innerhalb eines Monats (Teilwochen an Monatsgrenzen).
#[derive(Debug, Clone, Default, Serialize)]
pub struct PeriodBreakdown {
    pub ytd: PeriodData,
    /// Schlüssel: "2026-10"
    pub by_month: BTreeMap<String, PeriodData>,
    /// Schlüssel: "2026-W43"
    pub by_week: BTreeMap<String, PeriodData>,
    /// Monat → Kalenderwoche → Werte nur der Tage dieses Monats.
    pub month_weeks: BTreeMap<String, BTreeMap<String, PeriodData>>,
    /// Gearbeitete Stunden je Arbeitsort.
    pub locations: LocationBreakdown,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct LocationBreakdown {
    /// Jahr bis Stichtag, absteigend nach Stunden.
    pub ytd: Vec<LocationShare>,
    /// Schlüssel: "2026-10"
    pub by_month: BTreeMap<String, Vec<LocationShare>>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LocationShare {
    /// Wert der Ort-Spalte bzw. „(ohne Angabe)“.
    pub location: String,
    /// Gearbeitete Stunden (× Mult) an diesem Ort.
    pub hours: f64,
    /// Anteil an den gearbeiteten Stunden in Prozent.
    pub share: f64,
    /// Tage mit Buchungen an diesem Ort (Team: Personentage).
    pub days: usize,
}

/// Kennzahlen eines Zeitraums, auf 2 Nachkommastellen gerundet.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize)]
pub struct PeriodData {
    /// Soll brutto: Σ h/Tag über Werktage (Mo–Fr ohne Feiertage).
    pub soll_b: f64,
    /// Soll netto: Soll brutto − Urlaub − Krank (normiert).
    pub soll_n: f64,
    pub vac_days: f64,
    pub vac_h: f64,
    pub sick_days: f64,
    pub sick_h: f64,
    /// Gearbeitete Stunden (Stunden × Mult, nur Mult > 0, ohne Urlaub/Krank).
    pub gearb: f64,
    /// Billable Stunden: Buchungen, deren Abrechnungsregel „billable Stunden“ hat.
    pub bill_h: f64,
    /// Billable EUR: abgerechnete Stunden × Stundensatz × Satz-Anteil der Regel.
    pub bill_eur: f64,
    /// Gearbeitete Stunden (Mult > 0, ohne Mult), die nicht in `bill_h` zählen.
    pub nonbill_h: f64,
    /// Überstunden: gearb − Soll netto.
    pub plus: f64,
    /// Überstunden, wenn Krankheit als Fehlzeit zählt: plus − Krank.
    pub plus_krank: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct InvoiceSummary {
    pub vat_percent: f64,
    /// Nur Monate mit abrechenbaren Stunden.
    pub months: Vec<InvoiceMonth>,
    pub total: InvoiceTotals,
}

#[derive(Debug, Clone, Serialize)]
pub struct InvoiceMonth {
    /// "2026-10"
    pub month: String,
    /// Monat ist zum Stichtag noch nicht abgeschlossen.
    pub partial: bool,
    pub lines: Vec<InvoiceLine>,
    pub hours: f64,
    pub net: f64,
    /// USt. je Steuersatz (aufsteigend nach Satz).
    pub vat_groups: Vec<VatGroup>,
    pub vat: f64,
    pub gross: f64,
}

/// Eine Rechnungsposition: Person × Leistung (Regel) × Stundensatz × USt.-Satz.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct InvoiceLine {
    pub person: String,
    /// Bezeichnung der Abrechnungsregel, z. B. "Delivery".
    pub service: String,
    /// Stundensatz der Person; `None`, wenn keiner hinterlegt ist (Netto = 0).
    pub base_rate: Option<f64>,
    /// Anteil des Satzes laut Regel in Prozent.
    pub rate_percent: f64,
    /// Abgerechneter Satz = Stundensatz × Anteil.
    pub rate: Option<f64>,
    pub hours: f64,
    pub net: f64,
    pub vat_percent: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct VatGroup {
    pub vat_percent: f64,
    pub net: f64,
    pub vat: f64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct InvoiceTotals {
    pub hours: f64,
    pub net: f64,
    pub vat_groups: Vec<VatGroup>,
    pub vat: f64,
    pub gross: f64,
}
