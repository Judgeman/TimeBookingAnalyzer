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
}

/** Wo die Projekte dieser Instanz liegen (neben der Programmdatei). */
export interface ProjectFolder {
  dir: string;
  /** Projekte am früheren Ablageort (App-Datenverzeichnis), die hier fehlen. */
  legacy_count: number;
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

export type ExportDateSource = "file_name" | "modified";

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
  /** Buchungen aufs Projekt außerhalb des Einsatzzeitraums oder von Nicht-Teammitgliedern. */
  outside: OutsideBooking[];
  /** Personen mit der Rolle „darf buchen“ (Reihenfolge der Konfiguration). */
  guests: string[];
  /** Ihre Buchungen aufs Projekt im Auswertungszeitraum. */
  guest_bookings: GuestBooking[];
  overview: ParsedExport;
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
