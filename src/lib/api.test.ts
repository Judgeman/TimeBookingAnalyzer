import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { api, errorMessage } = await import("./api");
const { newProject } = await import("../types/config");

describe("api – Tauri-Commands und Argumentnamen", () => {
  beforeEach(() => invoke.mockReset().mockResolvedValue("ok"));

  it("ruft die Commands mit camelCase-Argumenten auf (Tauri → snake_case)", async () => {
    await api.listProjects();
    await api.getProject("p1");
    const config = newProject();
    await api.saveProject(config);
    await api.deleteProject("p1");
    await api.parseExport("/x/export.xlsx", "p1", "2026-10-31");
    await api.parseExport("/x/export.xlsx", "p1", null);

    expect(invoke.mock.calls).toEqual([
      ["list_projects"],
      ["get_project", { id: "p1" }],
      ["save_project", { config }],
      ["delete_project", { id: "p1" }],
      ["parse_export", { filePath: "/x/export.xlsx", projectId: "p1", cutoffDate: "2026-10-31" }],
      ["parse_export", { filePath: "/x/export.xlsx", projectId: "p1", cutoffDate: null }],
    ]);
  });

  it("macht aus Fehlern lesbaren Text", () => {
    expect(errorMessage("Projekt nicht gefunden.")).toBe("Projekt nicht gefunden.");
    expect(errorMessage(new Error("kaputt"))).toBe("kaputt");
    expect(errorMessage(42)).toBe("42");
  });
});
