//! Rückgabetypen der Tauri-Commands.

use std::collections::BTreeMap;

use chrono::{NaiveDate, NaiveDateTime};
use serde::Serialize;

use super::config::AssignmentPeriod;
use super::entry::TimeEntry;
use crate::calculation::holidays::Holiday;

/// Eintrag in der Projektliste (Sidebar).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub element_filter: String,
    pub team_size: usize,
    /// Personen mit der Rolle „darf buchen“.
    pub guest_count: usize,
}

/// Wo die Projekte dieser Instanz liegen (Sidebar).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ProjectFolder {
    /// Ordner mit den Projektdateien (neben der Programmdatei).
    pub dir: String,
    /// Projekte am früheren Ablageort (App-Datenverzeichnis), die hier fehlen.
    pub legacy_count: usize,
}

/// Zuletzt eingelesene Export-Datei eines Projekts (Kopie im Ordner `Import`).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LastImport {
    /// Pfad der Kopie – wird beim nächsten Öffnen ausgewertet.
    pub path: String,
    pub file_name: String,
    /// Ursprünglicher Pfad beim Einlesen (fehlt bei von Hand abgelegten Dateien).
    pub original_path: Option<String>,
    /// Zeitpunkt der Übernahme (Ortszeit).
    pub imported_at: Option<NaiveDateTime>,
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
    /// Rolle „darf buchen“ (ohne Zeiterfassung).
    pub guest: bool,
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
    /// Werktage mit fehlender oder zu geringer Buchung.
    pub missing: Vec<MissingBooking>,
    /// Bis zu diesem Tag wurde auf fehlende Buchungen geprüft
    /// (Stichtag, höchstens Stand des Exports).
    pub missing_checked_until: NaiveDate,
    pub missing_threshold_percent: f64,
    /// Fehlende Buchungen „aktuell“: bis zum Tag vor dem Stand des Exports,
    /// unabhängig vom Stichtag.
    pub missing_current: Option<CurrentMissing>,
    /// Buchungen aufs Projekt „außerhalb des Teams“: außerhalb des
    /// Einsatzzeitraums (abgerechnet) oder von Nicht-Teammitgliedern (nicht abgerechnet).
    pub outside: Vec<OutsideBooking>,
    /// Personen mit der Rolle „darf buchen“ (Reihenfolge der Konfiguration).
    pub guests: Vec<String>,
    /// Teammitglieder ohne Zeiterfassung – ihre Projektbuchungen stehen in
    /// `guest_bookings`, sie fehlen in `persons`.
    pub untracked: Vec<String>,
    /// Ihre Buchungen aufs Projekt im Auswertungszeitraum.
    pub guest_bookings: Vec<GuestBooking>,
    /// Buchungen aufs Projekt, bei denen die Billable-Spalte von den
    /// Abrechnungsregeln abweicht (es gilt die Spalte).
    pub billable_mismatches: Vec<BillableMismatch>,
    /// Prognose der Rechnung und Budget-Abgleich.
    pub forecast: Forecast,
    /// Prognosegüte je abgeschlossenem Monat.
    pub forecast_accuracy: Vec<AccuracyMonth>,
    /// Resturlaub je Person mit Urlaubsanspruch im Stichtag-Jahr.
    pub vacation: Vec<VacationStatus>,
    pub overview: ParsedExport,
}

/// Resturlaub = Anspruch + Übertrag − genommen − geplant (Tage).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct VacationStatus {
    pub person: String,
    pub year: i32,
    pub entitlement: f64,
    pub carry_over: f64,
    /// Urlaub bis zum Stichtag (ganze/halbe Tage).
    pub taken: f64,
    /// Geplante Urlaube nach dem Stand der Daten bis Jahresende (Werktage).
    pub planned: f64,
    pub remaining: f64,
}

/// Prognose für einen abgeschlossenen Monat gegenüber dem tatsächlichen Ergebnis.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AccuracyMonth {
    /// "2026-09"
    pub month: String,
    /// Tatsächlich abgerechnet (Netto).
    pub actual_net: f64,
    /// Nachgerechnete Prognose mit dem Stand am Monatsbeginn (heutige Konfiguration).
    pub backtest_net: f64,
    /// Zuletzt vor Monatsbeginn gespeicherte Prognose (falls vorhanden) …
    pub recorded_net: Option<f64>,
    /// … und ihr Stand der Daten.
    pub recorded_on: Option<NaiveDate>,
}

/// Prognose der Rechnung ab dem Tag nach dem Stand der Daten.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Forecast {
    /// Erster prognostizierter Tag (Tag nach min(Stichtag, Stand des Exports)).
    pub from: NaiveDate,
    /// Letzter prognostizierter Tag (Jahresende bzw. Ende des Budget-Zeitraums).
    pub to: NaiveDate,
    /// Referenzzeitraum der Faktoren (`None` = keine Daten → Faktoren 0).
    pub reference_from: NaiveDate,
    pub reference_to: Option<NaiveDate>,
    pub persons: Vec<ForecastPerson>,
    /// Alle Monate vom Jahresanfang (bzw. Budget-Beginn) bis `to`.
    pub months: Vec<ForecastMonth>,
    pub budgets: Vec<BudgetStatus>,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ForecastPerson {
    pub name: String,
    /// Anteil krank an der verfügbaren Zeit (Soll − Urlaub), 0…1.
    pub sick_factor: f64,
    /// Anteil der gearbeiteten Zeit, der nicht abgerechnet wurde, 0…1.
    pub distraction_factor: f64,
    /// Nur ohne Zeiterfassung: abgerechnet ÷ (Soll − Urlaub), 0…1 – ersetzt
    /// Krankheits- und Ablenkungsfaktor.
    pub utilization: Option<f64>,
    /// Grundlage der Faktoren (Referenzzeitraum).
    pub reference: ForecastReference,
    /// Soll im Prognosezeitraum (Werktage × h/Tag, im Einsatz).
    pub contract_hours: f64,
    /// Davon geplant abwesend.
    pub planned_absence_hours: f64,
    pub planned_absence_days: f64,
    /// Erwartete abgerechnete Stunden (zum vollen Satz).
    pub hours: f64,
    pub net: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ForecastReference {
    /// Soll brutto − Urlaub
    pub available_hours: f64,
    pub sick_hours: f64,
    /// Gearbeitet (× Mult, ohne Abwesenheit)
    pub worked_hours: f64,
    /// Abgerechnet zum vollen Satz (Stunden × Satz-Anteil der Regel)
    pub invoiced_hours: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ForecastMonth {
    /// "2026-11"
    pub month: String,
    /// Rechnung bis zum Stand der Daten (Netto, abgerechnete Stunden).
    pub actual_net: f64,
    pub actual_hours: f64,
    /// Prognose für die restlichen Tage des Monats.
    pub forecast_net: f64,
    pub forecast_hours: f64,
}

/// Budget-Zeitraum mit Ist, Prognose und Richtwert.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct BudgetStatus {
    /// "2026-01"
    pub from: String,
    /// "2026-12"
    pub to: String,
    pub amount: f64,
    /// Richtwert je Monat = Betrag ÷ Anzahl Monate.
    pub monthly_target: f64,
    pub month_count: u32,
    /// Richtwert bis zum Stand der Daten (anteilig im laufenden Monat).
    pub target_to_date: f64,
    /// Abgerechnet bis zum Stand der Daten.
    pub actual_net: f64,
    /// Prognose bis zum Ende des Zeitraums.
    pub forecast_net: f64,
    /// Ist + Prognose.
    pub expected_net: f64,
    /// Erwartet − Budget (positiv = Überziehung).
    pub deviation: f64,
    /// Tag, an dem das Budget laut Prognose aufgebraucht ist (`None`: reicht
    /// bzw. schon aufgebraucht → `exceeded`).
    pub exhausted_on: Option<NaiveDate>,
    /// Ist liegt bereits über dem Budget.
    pub exceeded: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AbsenceKind {
    Vacation,
    Sick,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OutsideReason {
    /// Teammitglied, aber an diesem Tag nicht im Einsatzzeitraum.
    OutsideAssignment,
    /// Person ist nicht im Team.
    NotInTeam,
}

/// Buchung auf das Projekt, die nicht zum Team (bzw. Einsatzzeitraum) passt.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct OutsideBooking {
    pub person: String,
    pub date: NaiveDate,
    pub element: String,
    pub kost2art: String,
    /// Gebuchte Stunden.
    pub hours: f64,
    pub reason: OutsideReason,
    /// In der Rechnung enthalten (nur bei `OutsideAssignment` mit Abrechnungsregel).
    pub invoiced: bool,
    /// Abgerechnete Stunden (nach Regel, z. B. × Mult).
    pub billed_hours: f64,
    /// Angesetzter Nettobetrag (0, wenn nicht abgerechnet oder ohne Stundensatz).
    pub net: f64,
}

/// Buchung aufs Projekt von einer Person mit der Rolle „darf buchen“.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GuestBooking {
    pub person: String,
    pub date: NaiveDate,
    pub element: String,
    pub kost2art: String,
    /// Gebuchte Stunden.
    pub hours: f64,
    /// Passende Abrechnungsregel; `None` = keine (nicht abrechenbar).
    pub rule: Option<String>,
    /// In der Rechnung enthalten (Regel mit „in Rechnung“).
    pub invoiced: bool,
    /// Abgerechnete Stunden (nach Regel, z. B. × Mult).
    pub billed_hours: f64,
    /// Nettobetrag (0, wenn nicht abgerechnet oder ohne Stundensatz).
    pub net: f64,
}

/// Buchung aufs Projekt, bei der die Billable-Spalte von der Abrechnungsregel
/// (Kost2Art) abweicht – abgerechnet wird nach der Spalte.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct BillableMismatch {
    pub person: String,
    pub date: NaiveDate,
    pub element: String,
    pub kost2art: String,
    pub hours: f64,
    /// Inhalt der Billable-Spalte (wie in Excel angezeigt).
    pub value: String,
    /// Bedeutung (gilt): nur der Wert „billable“ ist billable – „nicht
    /// billable“, leere und unbekannte Werte nicht.
    pub billable: bool,
    /// Regel laut Kost2Art (`None` = keine passende Regel).
    pub rule: Option<String>,
    /// `billable`: zusätzlich abgerechnet (netto); sonst: laut Regel, aber
    /// nicht abgerechnet.
    pub net: f64,
}

/// Fehlende Buchungen bis zum Tag vor dem Stand des Exports – der Export
/// entsteht meist morgens, der Tag selbst ist dann noch nicht gebucht.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CurrentMissing {
    pub checked_until: NaiveDate,
    pub bookings: Vec<MissingBooking>,
}

/// Werktag, an dem weniger als die Schwelle der Soll-Stunden gebucht ist.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MissingBooking {
    pub person: String,
    pub date: NaiveDate,
    /// Soll-Stunden des Tages (h/Tag der Person).
    pub expected_hours: f64,
    /// Gebucht: Arbeitszeit (ohne Mult) + angerechneter Urlaub/Krank.
    pub booked_hours: f64,
    pub coverage_percent: f64,
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
    /// Einsatzzeiträume aus der Konfiguration (leer = immer im Projekt).
    pub assignments: Vec<AssignmentPeriod>,
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
    /// Werktage mit fehlender Buchung (unter der Schwelle).
    pub missing_days: f64,
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
    /// Davon Stunden aus Buchungen außerhalb des Einsatzzeitraums.
    pub outside_hours: f64,
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
