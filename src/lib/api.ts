import { invoke } from "@tauri-apps/api/core";
import type { ProjectConfig } from "../types/config";
import type {
  AuswertungResult,
  LastImport,
  ProjectFolder,
  ProjectForgeSettings,
  ProjectSummary,
} from "../types/results";

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
  /** Zuletzt eingelesene Export-Datei des Projekts (Kopie im Ordner „Import“). */
  lastImport: (projectId: string) => invoke<LastImport | null>("last_import", { projectId }),
  /** Legt eine Kopie als letzten Import des Projekts ab. */
  rememberImport: (projectId: string, filePath: string) =>
    invoke<LastImport>("remember_import", { projectId, filePath }),
  /** `cutoffDate` = Stichtag (ISO-Datum); `null` → Stand des Exports. */
  parseExport: (filePath: string, projectId: string, cutoffDate: string | null) =>
    invoke<AuswertungResult>("parse_export", { filePath, projectId, cutoffDate }),
  /** Zugang zu ProjectForge (Adresse, User-ID, Schlüssel vorhanden?). */
  projectForgeSettings: () => invoke<ProjectForgeSettings>("projectforge_settings"),
  /** `token` = `null` → gespeicherten Schlüssel behalten. */
  saveProjectForgeSettings: (baseUrl: string, userId: number, token: string | null) =>
    invoke<ProjectForgeSettings>("save_projectforge_settings", { baseUrl, userId, token }),
  deleteProjectForgeToken: () => invoke<ProjectForgeSettings>("delete_projectforge_token"),
  /** Prüft den Zugang; liefert eine Erfolgsmeldung. */
  testProjectForge: () => invoke<string>("test_projectforge"),
  /** Ruft fehlende/offene Monate ab (`full` = alle) und wertet aus. */
  fetchProjectForge: (projectId: string, cutoffDate: string | null, full: boolean) =>
    invoke<AuswertungResult>("fetch_projectforge", { projectId, cutoffDate, full }),
  /** Wertet die zuletzt abgerufenen Daten aus; `null` = noch kein Abruf. */
  projectForgeCached: (projectId: string, cutoffDate: string | null) =>
    invoke<AuswertungResult | null>("projectforge_cached", { projectId, cutoffDate }),
};

/** Fehler aus `invoke` sind bei uns Strings (Result<_, String> im Backend). */
export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}
