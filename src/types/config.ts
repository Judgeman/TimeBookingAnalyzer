// Spiegel von src-tauri/src/models/config.rs – Felder in snake_case wie im JSON.

/** ISO-Datum "YYYY-MM-DD". */
export type IsoDate = string;

export type DataSource = "export" | "projectforge";

export interface ProjectConfig {
  /** UUID; leer beim Anlegen, wird von `save_project` vergeben. */
  id: string;
  name: string;
  element_filter: string;
  team: TeamMember[];
  /** Rolle „darf buchen“: Buchungen aufs Projekt ohne Zeiterfassung. */
  guests: Guest[];
  working_hours: WorkingHoursPeriod[];
  holidays: HolidayConfig;
  export_format: ExportFormat;
  /** Umsatzsteuersatz in Prozent (Standard für die Rechnung). */
  vat_percent: number;
  /** Abrechnungsregeln; die erste passende gilt. */
  billing_rules: BillingRule[];
  /** Werktag mit weniger als diesem Anteil (%) der Soll-Stunden = fehlende Buchung. */
  missing_threshold_percent: number;
  /** Geplante Abwesenheiten ohne Buchung (nur für die Prognose). */
  planned_absences: PlannedAbsence[];
  /** Budget-Zeiträume (ganze Monate) mit Betrag. */
  budgets: BudgetPeriod[];
  /** Quelle der Buchungen: Export-Datei (Standard) oder Abruf aus ProjectForge. */
  data_source?: DataSource;
}

export type PlannedAbsenceKind = "vacation" | "other";

/** Geplante Abwesenheit, für die es noch keine Buchung gibt. */
export interface PlannedAbsence {
  /** Teammitglied */
  person: string;
  from: IsoDate;
  to: IsoDate;
  kind: PlannedAbsenceKind;
  /** Jeweils nur halbe Tage. */
  half_day: boolean;
}

/** Budget für ganze Monate; Richtwert = Betrag ÷ Anzahl Monate. */
export interface BudgetPeriod {
  /** "2026-01" */
  from: string;
  /** "2026-12" (einschließlich) */
  to: string;
  /** Netto in EUR */
  amount: number;
}

export interface TeamMember {
  name: string;
  rates: RatePeriod[];
  /** Abweichende Arbeitszeit; leer = Arbeitszeit des Projekts. */
  working_hours: WorkingHoursPeriod[];
  /** Einsatzzeiträume im Projekt; leer = immer im Projekt. */
  assignments: AssignmentPeriod[];
  /**
   * Ohne Zeiterfassung (Export unvollständig): nur Buchungen aufs Projekt –
   * abgerechnet wie „darf buchen“ und in der Prognose (Auslastung); kein Soll,
   * kein Stundenkonto, keine fehlenden Buchungen.
   */
  untracked?: boolean;
  /** Urlaubsanspruch je Kalenderjahr. */
  vacation: VacationEntitlement[];
}

/** Urlaubsanspruch eines Jahres (Tage) und Übertrag aus dem Vorjahr. */
export interface VacationEntitlement {
  year: number;
  days: number;
  carry_over: number;
}

/**
 * Rolle „darf buchen“ (z. B. Geschäftsführung): Buchungen aufs Projekt werden
 * nach den Abrechnungsregeln mit dem eigenen Satz abgerechnet, die Arbeitszeit
 * wird nicht ausgewertet.
 */
export interface Guest {
  name: string;
  rates: RatePeriod[];
}

export interface AssignmentPeriod {
  from: IsoDate;
  /** `null` = unbefristet. */
  to: IsoDate | null;
}

export type MatchMode = "exact" | "contains";

export interface BillingRule {
  name: string;
  kost2art: string;
  match_mode: MatchMode;
  /** Leer = Element-Filter des Projekts. */
  element: string;
  /** Zählt in „Billable (h)“. */
  billable_hours: boolean;
  /** Wird in Rechnung gestellt. */
  invoice: boolean;
  /** Abgerechnete Stunden = Stunden × Mult. */
  apply_mult: boolean;
  /** Anteil des Stundensatzes in Prozent. */
  rate_percent: number;
  /** Abweichender USt.-Satz; `null` = Projekt. */
  vat_percent: number | null;
}

export interface RatePeriod {
  from: IsoDate;
  /** `null` = unbefristet. */
  to: IsoDate | null;
  rate: number;
}

export interface WorkingHoursPeriod {
  from: IsoDate;
  to: IsoDate | null;
  hours_per_day: number;
}

export interface HolidayConfig {
  /** Bundesland-Kürzel, z. B. "HE". */
  region: string;
  custom: IsoDate[];
}

export interface ExportFormat {
  sheet_name: string;
  columns: ColumnMapping;
  special_elements: SpecialElements;
  /** Optionale Billable-Spalte: entscheidet, ob eine Buchung aufs Projekt abgerechnet wird. */
  billable?: BillableColumn | null;
}

/** Billable-Spalte: Wahrheitswerte automatisch, eigene Textwerte optional (ohne Groß-/Kleinschreibung). */
export interface BillableColumn {
  /** 0-basierter Spaltenindex (0 = Spalte A). */
  column: number;
  /** Eigener Textwert für „billable“ (leer = nur Wahrheitswerte WAHR/TRUE). */
  yes: string;
  /** Eigener Textwert für „nicht billable“ (leer = nur Wahrheitswerte FALSCH/FALSE). */
  no: string;
}

/** 0-basierte Spaltenindizes (0 = Spalte A). */
export interface ColumnMapping {
  name: number;
  date: number;
  duration: number;
  mult: number;
  element: number;
  kost2art: number;
  location: number;
}

export interface SpecialElements {
  sick: string;
  vacation: string;
}

export const COLUMN_LABELS: Record<keyof ColumnMapping, string> = {
  name: "Name",
  date: "Datum",
  duration: "Dauer",
  mult: "Mult",
  element: "Element",
  kost2art: "Kost2Art",
  location: "Ort",
};

export function defaultExportFormat(): ExportFormat {
  return {
    sheet_name: "Details",
    columns: { name: 0, date: 2, duration: 5, mult: 8, element: 9, kost2art: 11, location: 13 },
    special_elements: { sick: "(Sick)", vacation: "(Vacation)" },
  };
}

/** Bundesländer für die Feiertags-Region (wie im Backend). */
export const REGIONS: [code: string, name: string][] = [
  ["BW", "Baden-Württemberg"],
  ["BY", "Bayern"],
  ["BE", "Berlin"],
  ["BB", "Brandenburg"],
  ["HB", "Bremen"],
  ["HH", "Hamburg"],
  ["HE", "Hessen"],
  ["MV", "Mecklenburg-Vorpommern"],
  ["NI", "Niedersachsen"],
  ["NW", "Nordrhein-Westfalen"],
  ["RP", "Rheinland-Pfalz"],
  ["SL", "Saarland"],
  ["SN", "Sachsen"],
  ["ST", "Sachsen-Anhalt"],
  ["SH", "Schleswig-Holstein"],
  ["TH", "Thüringen"],
];

/** Standardregeln laut Spezifikation (wie `default_billing_rules` im Backend). */
export function defaultBillingRules(): BillingRule[] {
  return [
    {
      name: "Delivery",
      kost2art: "Delivery (billable)",
      match_mode: "exact",
      element: "",
      billable_hours: true,
      invoice: true,
      apply_mult: false,
      rate_percent: 100,
      vat_percent: null,
    },
    {
      name: "Sonstige billable (z. B. Travel)",
      kost2art: "(billable)",
      match_mode: "contains",
      element: "",
      billable_hours: false,
      invoice: true,
      apply_mult: false,
      rate_percent: 100,
      vat_percent: null,
    },
  ];
}

export function newProject(): ProjectConfig {
  return {
    id: "",
    name: "",
    element_filter: "",
    team: [],
    guests: [],
    working_hours: [],
    holidays: { region: "HE", custom: [] },
    export_format: defaultExportFormat(),
    vat_percent: 19,
    billing_rules: defaultBillingRules(),
    missing_threshold_percent: 50,
    planned_absences: [],
    budgets: [],
    data_source: "export",
  };
}
