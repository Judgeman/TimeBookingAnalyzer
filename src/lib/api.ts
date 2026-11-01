import { invoke } from "@tauri-apps/api/core";
import type { ProjectConfig } from "../types/config";
import type { ParsedExport, ProjectSummary } from "../types/results";

// Tauri wandelt camelCase-Argumente automatisch in snake_case (Rust) um.
export const api = {
  listProjects: () => invoke<ProjectSummary[]>("list_projects"),
  getProject: (id: string) => invoke<ProjectConfig>("get_project", { id }),
  saveProject: (config: ProjectConfig) => invoke<string>("save_project", { config }),
  deleteProject: (id: string) => invoke<void>("delete_project", { id }),
  parseExport: (filePath: string, projectId: string) =>
    invoke<ParsedExport>("parse_export", { filePath, projectId }),
};

/** Fehler aus `invoke` sind bei uns Strings (Result<_, String> im Backend). */
export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}
