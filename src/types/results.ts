// Spiegel von src-tauri/src/models/{entry,results}.rs.

import type { IsoDate } from "./config";

export interface ProjectSummary {
  id: string;
  name: string;
  element_filter: string;
  team_size: number;
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

/** Ergebnis von `parse_export` (Übersicht vor der eigentlichen Auswertung). */
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
  entry_count: number;
  hours: number;
  project_hours: number;
}

export interface SkippedRow {
  /** Excel-Zeilennummer (1-basiert). */
  row: number;
  reason: string;
}
