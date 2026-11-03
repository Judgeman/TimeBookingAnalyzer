import { invoke } from "@tauri-apps/api/core";
import type { ProjectConfig } from "../types/config";
import type { AuswertungResult, ProjectFolder, ProjectSummary } from "../types/results";

// Tauri wandelt camelCase-Argumente automatisch in snake_case (Rust) um.
export const api = {
  listProjects: () => invoke<ProjectSummary[]>("list_projects"),
  getProject: (id: string) => invoke<ProjectConfig>("get_project", { id }),
  saveProject: (config: ProjectConfig) => invoke<string>("save_project", { config }),
  deleteProject: (id: string) => invoke<void>("delete_project", { id }),
  /** Projektordner dieser Instanz (neben der Programmdatei). */
  projectFolder: () => invoke<ProjectFolder>("project_folder"),
  /** Kopiert Projekte aus dem früheren Ablageort; liefert die Anzahl. */
  importLegacyProjects: () => invoke<number>("import_legacy_projects"),
  /** `cutoffDate` = Stichtag (ISO-Datum); `null` → Stand des Exports. */
  parseExport: (filePath: string, projectId: string, cutoffDate: string | null) =>
    invoke<AuswertungResult>("parse_export", { filePath, projectId, cutoffDate }),
};

/** Fehler aus `invoke` sind bei uns Strings (Result<_, String> im Backend). */
export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}
