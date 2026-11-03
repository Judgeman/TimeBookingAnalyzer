import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sample from "../sample-data/beispiel-projekt.json";
import { sampleResult } from "./test/fixture";
import type { ProjectConfig } from "./types/config";
import type { LastImport } from "./types/results";

// --- Nachgebildete Tauri-Schnittstelle ------------------------------------
type DragHandler = (event: { payload: { type: string; paths?: string[] } }) => void;
let tauri = true;
let dragHandler: DragHandler | null = null;
let projects: ProjectConfig[] = [];
/** Projekte am früheren Ablageort (App-Datenverzeichnis). */
let legacy: ProjectConfig[] = [];
const missingLegacy = () => legacy.filter((l) => !projects.some((p) => p.id === l.id));
/** Gemerkte letzte Import-Dateien je Projekt (Ordner „Import“). */
let imports: Record<string, LastImport> = {};
const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => tauri,
  invoke: (...args: unknown[]) => invoke(...args),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (handler: DragHandler) => {
      dragHandler = handler;
      return Promise.resolve(() => {});
    },
  }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const { default: App } = await import("./App");

function sampleConfig(): ProjectConfig {
  const config = structuredClone(sample) as unknown as ProjectConfig;
  config.team = config.team.map((m) => ({
    ...m,
    working_hours: m.working_hours ?? [],
    assignments: m.assignments ?? [],
  }));
  return config;
}

function backend(command: string, args: Record<string, unknown> = {}) {
  switch (command) {
    case "list_projects":
      return projects.map((p) => ({
        id: p.id,
        name: p.name,
        element_filter: p.element_filter,
        team_size: p.team.length,
        guest_count: p.guests.length,
      }));
    case "project_folder":
      return { dir: "C:\\Tools\\Kunde-A\\projects", legacy_count: missingLegacy().length };
    case "import_legacy_projects": {
      const imported = missingLegacy();
      projects = [...projects, ...structuredClone(imported)];
      return imported.length;
    }
    case "last_import":
      return imports[args.projectId as string] ?? null;
    case "remember_import": {
      const projectId = args.projectId as string;
      const fileName = String(args.filePath).split(/[\\/]/).pop()!;
      imports[projectId] = {
        path: `C:\\Tools\\Kunde-A\\Import\\${projectId}\\${fileName}`,
        file_name: fileName,
        original_path: args.filePath as string,
        imported_at: "2026-11-01T09:00:00",
      };
      return imports[projectId];
    }
    case "get_project":
      return structuredClone(projects.find((p) => p.id === args.id)!);
    case "save_project": {
      const config = structuredClone(args.config as ProjectConfig);
      if (!config.id) config.id = "neu-1";
      projects = [...projects.filter((p) => p.id !== config.id), config];
      return config.id;
    }
    case "delete_project":
      projects = projects.filter((p) => p.id !== args.id);
      return null;
    case "parse_export":
      if (String(args.filePath).includes("kaputt")) throw "Tabellenblatt „Details“ nicht gefunden.";
      return { ...sampleResult(), cutoff_date: (args.cutoffDate as string) ?? "2026-10-31" };
    default:
      throw new Error(`unbekannter Command ${command}`);
  }
}

const calls = (command: string) => invoke.mock.calls.filter(([c]) => c === command);

async function drop(path: string) {
  await waitFor(() => expect(dragHandler).not.toBeNull());
  await act(async () => dragHandler!({ payload: { type: "drop", paths: [path] } }));
}

describe("App (Integration mit nachgebildetem Backend)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 1, 9, 0, 0)); // 01.11.2026
    tauri = true;
    dragHandler = null;
    projects = [sampleConfig()];
    legacy = [];
    imports = {};
    localStorage.clear();
    invoke.mockReset().mockImplementation(async (command: string, args?: Record<string, unknown>) =>
      backend(command, args),
    );
  });
  afterEach(() => vi.useRealTimers());

  it("lädt das Projekt, wertet eine abgelegte Datei aus und wechselt den Stichtag", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Musterkunde GmbH / Lager-App" })).toBeInTheDocument();

    await drop("/daten/Beispiel-Export_2026-10-31.xlsx");
    // Stichtag beim Start = heute
    expect(calls("parse_export")[0][1]).toEqual({
      filePath: "/daten/Beispiel-Export_2026-10-31.xlsx",
      projectId: "beispiel-lager-app",
      cutoffDate: "2026-11-01",
    });
    expect(await screen.findByText("Auswertung 01.01.2026 – 01.11.2026")).toBeInTheDocument();
    expect(localStorage.getItem("billing-tracker.active-project")).toBe("beispiel-lager-app");

    await user.click(screen.getByRole("button", { name: "Stand des Exports" }));
    expect(await screen.findByText("Auswertung 01.01.2026 – 31.10.2026")).toBeInTheDocument();
    expect(calls("parse_export").at(-1)![1]).toMatchObject({ cutoffDate: "2026-10-31" });
  });

  it("speichert Änderungen am Projekt und wertet erneut aus", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Musterkunde GmbH / Lager-App" });
    await drop("/daten/export.xlsx");
    await screen.findByText(/Auswertung 01\.01\.2026/);
    const parsesBefore = calls("parse_export").length;

    await user.click(screen.getByRole("button", { name: "Projekt bearbeiten" }));
    const name = screen.getByDisplayValue("Musterkunde GmbH / Lager-App");
    await user.clear(name);
    await user.type(name, "Musterkunde GmbH / Lager-App 2");
    await user.click(screen.getByRole("button", { name: "Speichern" }));

    expect(await screen.findByRole("heading", { name: "Musterkunde GmbH / Lager-App 2" })).toBeInTheDocument();
    expect(calls("save_project")).toHaveLength(1);
    await waitFor(() => expect(calls("parse_export").length).toBeGreaterThan(parsesBefore));
  });

  it("legt ein neues Projekt an, wechselt dorthin und löscht es wieder", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Musterkunde GmbH / Lager-App" });

    await user.click(screen.getByRole("button", { name: "+ Neues Projekt" }));
    await user.type(screen.getByPlaceholderText("Musterkunde GmbH / Lager-App"), "Zweites Projekt");
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByRole("heading", { name: "Zweites Projekt" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Projekt bearbeiten" }));
    await user.click(screen.getByRole("button", { name: "Projekt löschen" }));
    await user.click(screen.getByRole("button", { name: "Ja, löschen" }));
    expect(await screen.findByRole("heading", { name: "Musterkunde GmbH / Lager-App" })).toBeInTheDocument();
    expect(calls("delete_project")[0][1]).toEqual({ id: "neu-1" });
  });

  it("zeigt Fehler beim Einlesen und lässt sie schließen", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Musterkunde GmbH / Lager-App" });
    await drop("/daten/kaputt.xlsx");
    expect(await screen.findByRole("alert")).toHaveTextContent("Tabellenblatt „Details“ nicht gefunden.");
    await user.click(screen.getByRole("button", { name: "Meldung schließen" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("ohne Projekte: Hinweis statt Auswertung", async () => {
    projects = [];
    render(<App />);
    expect(await screen.findByText("Noch keine Projekte angelegt.")).toBeInTheDocument();
    expect(screen.getByText("Kein Projekt ausgewählt")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Projekt bearbeiten" })).toBeDisabled();
  });

  it("übernimmt Projekte aus der früheren Version in den Projektordner", async () => {
    const user = userEvent.setup();
    projects = [];
    legacy = [sampleConfig()];
    render(<App />);
    expect(await screen.findByText("Projektordner: …\\Kunde-A\\projects")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /1 Projekt aus früherer Version übernehmen/ }));
    expect(await screen.findByRole("heading", { name: "Musterkunde GmbH / Lager-App" })).toBeInTheDocument();
    expect(screen.queryByText(/aus früherer Version/)).not.toBeInTheDocument();
    expect(calls("import_legacy_projects")).toHaveLength(1);
  });

  it("meldet Fehler beim Übernehmen früherer Projekte", async () => {
    const user = userEvent.setup();
    projects = [];
    legacy = [sampleConfig()];
    render(<App />);
    invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === "import_legacy_projects") throw "Projekt konnte nicht übernommen werden: Zugriff verweigert";
      return backend(command, args);
    });
    await user.click(await screen.findByRole("button", { name: /aus früherer Version übernehmen/ }));
    expect(await screen.findByText(/Zugriff verweigert/)).toBeInTheDocument();
  });

  it("merkt sich die eingelesene Datei je Projekt und lädt sie beim nächsten Start", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await screen.findByRole("heading", { name: "Musterkunde GmbH / Lager-App" });
    expect(calls("parse_export")).toHaveLength(0); // noch nichts gemerkt

    await drop("/daten/Beispiel-Export_2026-10-31.xlsx");
    expect(await screen.findByText(/Als letzter Import gemerkt \(01\.11\.2026, 09:00\)/)).toBeInTheDocument();
    expect(calls("remember_import")[0][1]).toEqual({
      projectId: "beispiel-lager-app",
      filePath: "/daten/Beispiel-Export_2026-10-31.xlsx",
    });
    // neuer Stichtag: erneut auswerten, aber nicht erneut kopieren
    await user.click(screen.getByRole("button", { name: "Stand des Exports" }));
    await screen.findByText("Auswertung 01.01.2026 – 31.10.2026");
    expect(calls("remember_import")).toHaveLength(1);
    unmount();

    // Neustart: die Kopie wird ohne Drop ausgewertet
    invoke.mockClear();
    render(<App />);
    expect(await screen.findByText("Auswertung 01.01.2026 – 01.11.2026")).toBeInTheDocument();
    expect(calls("parse_export")[0][1]).toMatchObject({
      filePath: "C:\\Tools\\Kunde-A\\Import\\beispiel-lager-app\\Beispiel-Export_2026-10-31.xlsx",
      projectId: "beispiel-lager-app",
    });
    expect(calls("remember_import")).toHaveLength(0);
  });

  it("Projektwechsel zeigt die Datei des jeweiligen Projekts", async () => {
    const user = userEvent.setup();
    projects = [sampleConfig(), { ...sampleConfig(), id: "zweites", name: "Zweites Projekt" }];
    imports = {
      "beispiel-lager-app": {
        path: "C:\\Import\\beispiel-lager-app\\export.xlsx",
        file_name: "export.xlsx",
        original_path: null,
        imported_at: null,
      },
    };
    render(<App />);
    expect(await screen.findByText(/Auswertung 01\.01\.2026/)).toBeInTheDocument();
    expect(screen.getByText(/Letzter Import: export\.xlsx/)).toBeInTheDocument();

    await user.click(screen.getByText("Zweites Projekt"));
    expect(await screen.findByRole("heading", { name: "Zweites Projekt" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/Auswertung 01\.01\.2026/)).not.toBeInTheDocument());
    expect(screen.queryByText(/Letzter Import/)).not.toBeInTheDocument();
    expect(calls("parse_export").every(([, a]) => a.projectId === "beispiel-lager-app")).toBe(true);

    await user.click(screen.getByText("Musterkunde GmbH / Lager-App"));
    expect(await screen.findByText(/Auswertung 01\.01\.2026/)).toBeInTheDocument();
  });

  it("meldet, wenn die Datei nicht gemerkt werden konnte – die Auswertung bleibt", async () => {
    invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === "remember_import") throw "Kopie im Ordner „Import“ fehlgeschlagen: Zugriff verweigert";
      return backend(command, args);
    });
    render(<App />);
    await screen.findByRole("heading", { name: "Musterkunde GmbH / Lager-App" });
    await drop("/daten/export.xlsx");
    expect(await screen.findByText(/nicht als letzter Import gemerkt: Kopie im Ordner/)).toBeInTheDocument();
    expect(screen.getByText(/Auswertung 01\.01\.2026/)).toBeInTheDocument();
  });

  it("Prognose zeigt die geplanten Abwesenheiten des Projekts", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Musterkunde GmbH / Lager-App" });
    await drop("/daten/Beispiel-Export_2026-10-31.xlsx");
    await screen.findByText(/Auswertung 01\.01\.2026/);
    await user.click(screen.getByRole("tab", { name: "Prognose" }));
    expect(screen.getByText("Geplante Abwesenheiten")).toBeInTheDocument();
    expect(document.body.textContent).toContain("Erika Mustermann: 23.11.2026 – 27.11.2026 · Urlaub");
  });

  it("im Browser (ohne Tauri) erscheint ein Hinweis", () => {
    tauri = false;
    render(<App />);
    expect(screen.getByText(/Oberfläche läuft im Browser/)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });
});
