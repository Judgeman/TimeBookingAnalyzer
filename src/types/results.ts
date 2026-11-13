// Spiegel von src-tauri/src/models/{entry,results}.rs.

import type { AssignmentPeriod, IsoDate } from "./config";

export interface ProjectSummary {
  id: string;
  name: string;
  element_filter: string;
  team_size: number;
  /** Personen mit der Rolle „darf buchen“. */
  guest_count: number;
}

export interface TimeEntry {
  name: string;
  date: IsoDate;
  hours: number;
  mult: number;
  element: string;
  kost2art: string;
  location: string;
  /** Inhalt der Billable-Spalte wie in Excel angezeigt (null = Spalte nicht gesetzt). */
  billable: string | null;
}

/** Wo die Projekte dieser Instanz liegen (neben der Programmdatei). */
export interface ProjectFolder {
  dir: string;
  /** Projekte am früheren Ablageort (App-Datenverzeichnis), die hier fehlen. */
  legacy_count: number;
}

/** Zuletzt eingelesene Export-Datei eines Projekts (Kopie im Ordner „Import“). */
export interface LastImport {
  /** Pfad der Kopie – wird beim nächsten Öffnen ausgewertet. */
  path: string;
  file_name: string;
  /** Ursprünglicher Pfad (fehlt bei von Hand abgelegten Dateien). */
  original_path: string | null;
  /** Zeitpunkt der Übernahme (Ortszeit, "2026-11-03T11:20:00"). */
  imported_at: string | null;
}

/** Übersicht über die eingelesenen Rohdaten (Teil der Auswertung). */
export interface ParsedExport {
  project_id: string;
  project_name: string;
  file_name: string;
  sheet_name: string;
  /** Stand des Exports: Datum im Dateinamen, sonst Änderungsdatum der Datei. */
  export_date: IsoDate | null;
  first_entry_date: IsoDate | null;
  last_entry_date: IsoDate | null;
  entry_count: number;
  total_hours: number;
  element_match_count: number;
  persons: PersonOverview[];
  missing_team_members: string[];
  skipped_rows: SkippedRow[];
  preview: TimeEntry[];
}

export interface PersonOverview {
  name: string;
  in_team: boolean;
  /** Rolle „darf buchen“ (ohne Zeiterfassung). */
  guest: boolean;
  entry_count: number;
  hours: number;
  project_hours: number;
}

export interface SkippedRow {
  /** Excel-Zeilennummer (1-basiert). */
  row: number;
  reason: string;
}

// --- Auswertung (Spiegel von AuswertungResult in models/results.rs) ---

export type ExportDateSource = "file_name" | "modified" | "fetched";

/** Ergebnis von `parse_export`. */
export interface AuswertungResult {
  project_id: string;
  project_name: string;
  file_name: string;
  export_date: IsoDate | null;
  export_date_source: ExportDateSource | null;
  /** 1. Januar des Stichtag-Jahres. */
  period_start: IsoDate;
  cutoff_date: IsoDate;
  default_cutoff_date: IsoDate;
  persons: PersonResult[];
  team: PeriodBreakdown;
  invoice: InvoiceSummary;
  holiday_region: string;
  holidays: Holiday[];
  warnings: string[];
  /** Hervorzuhebende Buchungen (Urlaub/Krank an arbeitsfreien Tagen u. a.). */
  flagged: FlaggedBooking[];
  /** Werktage mit fehlender oder zu geringer Buchung. */
  missing: MissingBooking[];
  /** Geprüft bis (Stichtag, höchstens Stand des Exports). */
  missing_checked_until: IsoDate;
  missing_threshold_percent: number;
  /** Fehlende Buchungen bis zum Tag vor dem Stand des Exports – unabhängig vom Stichtag. */
  missing_current: CurrentMissing | null;
  /** Buchungen aufs Projekt außerhalb des Einsatzzeitraums oder von Nicht-Teammitgliedern. */
  outside: OutsideBooking[];
  /** Personen mit der Rolle „darf buchen“ (Reihenfolge der Konfiguration). */
  guests: string[];
  /** Teammitglieder ohne Zeiterfassung (Projektbuchungen in guest_bookings, nicht in persons). */
  untracked: string[];
  /** Ihre Buchungen aufs Projekt im Auswertungszeitraum. */
  guest_bookings: GuestBooking[];
  /** Buchungen aufs Projekt, bei denen die Billable-Spalte von den Regeln abweicht (es gilt die Spalte). */
  billable_mismatches: BillableMismatch[];
  /** Einzelne Buchungen der Teammitglieder (mit Zeiterfassung) – Wochenkalender. */
  bookings: BookingDetail[];
  /** Prognose der Rechnung und Budget-Abgleich. */
  forecast: Forecast;
  /** Prognosegüte je abgeschlossenem Monat. */
  forecast_accuracy: AccuracyMonth[];
  /** Resturlaub je Person mit Urlaubsanspruch im Stichtag-Jahr. */
  vacation: VacationStatus[];
  /** Aufholen bis 31.12. im Stundenkonto „Krankheit als Fehlzeit“. */
  catch_up: CatchUp;
  overview: ParsedExport;
}

/** Zusätzliche Stunden je Arbeitstag vom Tag nach dem Stichtag bis 31.12. */
export interface CatchUp {
  from: string;
  to: string;
  /** Werktage (Mo–Fr ohne Feiertag) im Zeitraum. */
  workdays: number;
  persons: CatchUpPerson[];
  team: CatchUpTeam;
  /** Aufholen mit dem restlichen Budget, in dem `from` liegt. */
  budget: CatchUpBudget | null;
}

export interface CatchUpBudget {
  /** "2026-01" */
  from: string;
  to: string;
  amount: number;
  /** Abgerechnet + Prognose bis Budgetende. */
  expected_net: number;
  /** Budget − erwartet (negativ = überzogen). */
  remaining: number;
  /** min(Budgetende, 31.12.) */
  until: string;
  workdays: number;
  available_days: number;
  average_rate: number | null;
  /** null = ohne Stundensatz (kostet kein Budget). */
  affordable_hours: number | null;
  covered_hours: number;
  covered_net: number;
  uncovered_hours: number;
  extra_per_workday: number | null;
  extra_per_person_day: number | null;
}

export interface CatchUpPerson {
  person: string;
  /** Saldo bis Stichtag (plus_krank). */
  balance: number;
  /** Fehlende Stunden bis 100 % (0 bei Saldo ≥ 0). */
  deficit: number;
  /** Werktage im Einsatz mit h/Tag > 0. */
  workdays: number;
  hours_per_day: number;
  planned_days: number;
  open_vacation_days: number;
  has_entitlement: boolean;
  /** Werktage − geplant − offener Urlaub. */
  available_days: number;
  /** null = keine Arbeitstage mehr. */
  extra_per_day: number | null;
  /** Anteil am Fehlbetrag des Teams (h). */
  team_share: number;
}

export interface CatchUpTeam {
  balance: number;
  deficit: number;
  available_days: number;
  extra_per_workday: number | null;
  extra_per_person_day: number | null;
}

/** Resturlaub = Anspruch + Übertrag − genommen − geplant (Tage). */
export interface VacationStatus {
  person: string;
  year: number;
  entitlement: number;
  carry_over: number;
  /** Urlaub bis zum Stichtag. */
  taken: number;
  /** Geplante Urlaube nach dem Stand der Daten bis Jahresende (Werktage). */
  planned: number;
  remaining: number;
}

/** Prognose eines abgeschlossenen Monats gegenüber dem tatsächlichen Ergebnis. */
export interface AccuracyMonth {
  month: string;
  actual_net: number;
  /** Nachgerechnet: Prognose mit dem Stand am Ende des Vormonats. */
  backtest_net: number;
  /** Zuletzt vor Monatsbeginn gespeicherte Prognose (falls vorhanden). */
  recorded_net: number | null;
  recorded_on: IsoDate | null;
}

/** Prognose ab dem Tag nach dem Stand der Daten (Spiegel von models/results.rs). */
export interface Forecast {
  /** Erster prognostizierter Tag. */
  from: IsoDate;
  /** Letzter prognostizierter Tag (Jahresende bzw. Ende des Budget-Zeitraums). */
  to: IsoDate;
  reference_from: IsoDate;
  /** `null` = keine Daten → Faktoren 0. */
  reference_to: IsoDate | null;
  persons: ForecastPerson[];
  /** Monate vom Jahresanfang (bzw. Budget-Beginn) bis `to`. */
  months: ForecastMonth[];
  budgets: BudgetStatus[];
  notes: string[];
}

export interface ForecastPerson {
  name: string;
  /** Anteil krank an der verfügbaren Zeit (Soll − Urlaub), 0…1. */
  sick_factor: number;
  /** Anteil der gearbeiteten Zeit, der nicht abgerechnet wurde, 0…1. */
  distraction_factor: number;
  /** Nur ohne Zeiterfassung: abgerechnet ÷ (Soll − Urlaub), 0…1 (statt der Faktoren). */
  utilization: number | null;
  reference: {
    available_hours: number;
    sick_hours: number;
    worked_hours: number;
    invoiced_hours: number;
  };
  contract_hours: number;
  planned_absence_hours: number;
  planned_absence_days: number;
  /** Erwartete abgerechnete Stunden (zum vollen Satz). */
  hours: number;
  net: number;
}

export interface ForecastMonth {
  /** "2026-11" */
  month: string;
  actual_net: number;
  actual_hours: number;
  forecast_net: number;
  forecast_hours: number;
}

export interface BudgetStatus {
  from: string;
  to: string;
  amount: number;
  monthly_target: number;
  month_count: number;
  /** Richtwert bis zum Stand der Daten (anteilig im laufenden Monat). */
  target_to_date: number;
  actual_net: number;
  forecast_net: number;
  expected_net: number;
  /** Erwartet − Budget (positiv = Überziehung). */
  deviation: number;
  /** Tag, an dem das Budget laut Prognose aufgebraucht ist. */
  exhausted_on: IsoDate | null;
  /** Ist liegt bereits über dem Budget. */
  exceeded: boolean;
}

/** Abweichung der Billable-Spalte von der Abrechnungsregel – abgerechnet wird nach der Spalte. */
export interface BillableMismatch {
  person: string;
  date: IsoDate;
  element: string;
  kost2art: string;
  hours: number;
  /** Inhalt der Billable-Spalte (wie in Excel angezeigt). */
  value: string;
  /** Bedeutung (gilt): leere und unbekannte Werte sind nicht billable. */
  billable: boolean;
  /** Regel laut Kost2Art (null = keine passende Regel). */
  rule: string | null;
  /** billable: zusätzlich abgerechnet (netto); sonst: laut Regel, aber nicht abgerechnet. */
  net: number;
}

export interface CurrentMissing {
  checked_until: IsoDate;
  bookings: MissingBooking[];
}

export interface MissingBooking {
  person: string;
  date: IsoDate;
  expected_hours: number;
  /** Arbeitszeit (ohne Mult) + angerechneter Urlaub/Krank. */
  booked_hours: number;
  coverage_percent: number;
}

export interface FlaggedBooking {
  person: string;
  date: IsoDate;
  kind: "vacation" | "sick";
  /** Gebuchte (Personio-)Stunden. */
  hours: number;
  credited_days: number;
  credited_hours: number;
  reasons: string[];
}

export interface PeriodBreakdown {
  ytd: PeriodData;
  /** Key: "2026-10" */
  by_month: Record<string, PeriodData>;
  /** Key: "2026-W43" */
  by_week: Record<string, PeriodData>;
  /** Monat → Kalenderwoche → Werte nur der Tage dieses Monats. */
  month_weeks: Record<string, Record<string, PeriodData>>;
  /** Gearbeitete Stunden je Arbeitsort. */
  locations: LocationBreakdown;
}

export interface LocationBreakdown {
  /** Jahr bis Stichtag, absteigend nach Stunden. */
  ytd: LocationShare[];
  /** Key: "2026-10" */
  by_month: Record<string, LocationShare[]>;
}

export interface LocationShare {
  location: string;
  /** Gearbeitete Stunden (× Mult). */
  hours: number;
  /** Anteil in Prozent. */
  share: number;
  /** Tage mit Buchungen an diesem Ort (Team: Personentage). */
  days: number;
}

export interface PersonResult extends PeriodBreakdown {
  name: string;
  /** Einsatzzeiträume (leer = immer im Projekt). */
  assignments: AssignmentPeriod[];
}

export type OutsideReason = "outside_assignment" | "not_in_team";

/** Buchung aufs Projekt „außerhalb des Teams“. */
export interface OutsideBooking {
  person: string;
  date: IsoDate;
  element: string;
  kost2art: string;
  hours: number;
  reason: OutsideReason;
  /** In der Rechnung enthalten (nur außerhalb des Einsatzzeitraums mit Regel). */
  invoiced: boolean;
  billed_hours: number;
  net: number;
}

/** Buchung aufs Projekt von einer Person mit der Rolle „darf buchen“. */
export interface GuestBooking {
  person: string;
  date: IsoDate;
  element: string;
  kost2art: string;
  hours: number;
  /** Passende Abrechnungsregel; `null` = keine (nicht abrechenbar). */
  rule: string | null;
  invoiced: boolean;
  billed_hours: number;
  net: number;
}

export interface PeriodData {
  soll_b: number;
  soll_n: number;
  vac_days: number;
  vac_h: number;
  sick_days: number;
  sick_h: number;
  gearb: number;
  bill_h: number;
  bill_eur: number;
  nonbill_h: number;
  plus: number;
  plus_krank: number;
  /** Werktage mit fehlender Buchung. */
  missing_days: number;
}

export interface Holiday {
  date: IsoDate;
  name: string;
}

export interface InvoiceSummary {
  vat_percent: number;
  months: InvoiceMonth[];
  total: InvoiceTotals;
}

export interface InvoiceMonth {
  month: string;
  /** Monat ist zum Stichtag noch nicht abgeschlossen. */
  partial: boolean;
  lines: InvoiceLine[];
  hours: number;
  net: number;
  vat_groups: VatGroup[];
  vat: number;
  gross: number;
}

export interface InvoiceLine {
  person: string;
  /** Bezeichnung der Abrechnungsregel. */
  service: string;
  base_rate: number | null;
  rate_percent: number;
  /** Abgerechneter Satz = Stundensatz × Anteil. */
  rate: number | null;
  hours: number;
  net: number;
  vat_percent: number;
  /** Davon Stunden aus Buchungen außerhalb des Einsatzzeitraums. */
  outside_hours: number;
}

export interface VatGroup {
  vat_percent: number;
  net: number;
  vat: number;
}

export interface InvoiceTotals {
  hours: number;
  net: number;
  vat_groups: VatGroup[];
  vat: number;
  gross: number;
}

/** Zugang zu ProjectForge (ohne den Schlüssel selbst). */
export interface ProjectForgeSettings {
  base_url: string;
  /** Zahl aus `<Server>/rs/userStatus` („userId“), nicht der Login-Name. */
  user_id: number | null;
  /** Schlüssel in der Anmeldeinformationsverwaltung hinterlegt. */
  has_token: boolean;
}

/** Eine Buchung eines Teammitglieds (Wochenkalender). */
export interface BookingDetail {
  person: string;
  date: IsoDate;
  /** Beginn/Ende „HH:MM:SS“ (falls im Export bzw. Abruf vorhanden). */
  start: string | null;
  end: string | null;
  hours: number;
  mult: number;
  element: string;
  kost2art: string;
  location: string;
  description: string;
  kind: "work" | "vacation" | "sick";
  /** Nach Abrechnungsregel bzw. Billable-Spalte abgerechnet. */
  invoiced: boolean;
}
