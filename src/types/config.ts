// Spiegel von src-tauri/src/models/config.rs – Felder in snake_case wie im JSON.

/** ISO-Datum "YYYY-MM-DD". */
export type IsoDate = string;

export interface ProjectConfig {
  /** UUID; leer beim Anlegen, wird von `save_project` vergeben. */
  id: string;
  name: string;
  element_filter: string;
  team: TeamMember[];
  working_hours: WorkingHoursPeriod[];
  holidays: HolidayConfig;
  export_format: ExportFormat;
}

export interface TeamMember {
  name: string;
  rates: RatePeriod[];
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

export function newProject(): ProjectConfig {
  return {
    id: "",
    name: "",
    element_filter: "",
    team: [],
    working_hours: [],
    holidays: { region: "HE", custom: [] },
    export_format: defaultExportFormat(),
  };
}
