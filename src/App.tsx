import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { DropZone } from "./components/DropZone";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ProjectEditor } from "./components/ProjectEditor";
import { ProjectForgeAccess, isConfigured } from "./components/ProjectForgeAccess";
import { ProjectForgeSource } from "./components/ProjectForgeSource";
import { ProjectSelector } from "./components/ProjectSelector";
import { ResultsView } from "./components/results/ResultsView";
import { api, errorMessage } from "./lib/api";
import { todayIso } from "./lib/format";
import { APP_TITLE } from "./lib/version";
import { newProject, type ProjectConfig } from "./types/config";
import type {
  AuswertungResult,
  LastImport,
  ProjectFolder,
  ProjectForgeSettings,
  ProjectSummary,
} from "./types/results";

const ACTIVE_PROJECT_KEY = "billing-tracker.active-project";

/**
 * Datei-Anfrage für ein Projekt. `seq` macht jede Anfrage eindeutig (dieselbe
 * Datei kann erneut eingelesen werden); `remember` = nach erfolgreichem
 * Einlesen als letzten Import des Projekts merken (Kopie im Ordner „Import“).
 */
interface FileRequest {
  path: string;
  projectId: string;
  remember: boolean;
  seq: number;
}

/**
 * Auswertung aus ProjectForge: `cache` = zuletzt abgerufene Daten, `refresh` =
 * fehlende/offene Monate abrufen, `full` = alles neu abrufen.
 */
interface ProjectForgeRequest {
  projectId: string;
  mode: "cache" | "refresh" | "full";
  seq: number;
}

export default function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [folder, setFolder] = useState<ProjectFolder | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState<ProjectConfig | null>(null);
  const [editing, setEditing] = useState<ProjectConfig | null>(null);
  const [file, setFile] = useState<FileRequest | null>(null);
  const [lastImport, setLastImport] = useState<LastImport | null>(null);
  const fileSeq = useRef(0);
  const remembered = useRef(new Set<number>());
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  /** Stichtag der Auswertung – beim Programmstart heute. */
  const [cutoff, setCutoff] = useState<string>(todayIso);
  const [result, setResult] = useState<AuswertungResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Datenquelle ProjectForge
  const [pfSettings, setPfSettings] = useState<ProjectForgeSettings | null>(null);
  const [pfLoaded, setPfLoaded] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [pfRequest, setPfRequest] = useState<ProjectForgeRequest | null>(null);
  const pfSeq = useRef(0);
  /** Abrufe, die schon laufen/liefen – bei neuem Stichtag nur neu auswerten. */
  const pfStarted = useRef(new Set<number>());
  /** Projekte, die in dieser Sitzung schon automatisch aktualisiert wurden. */
  const autoRefreshed = useRef(new Set<string>());
  const pfConfigured = pfLoaded ? isConfigured(pfSettings) : null;
  const pfConfiguredRef = useRef(pfConfigured);
  pfConfiguredRef.current = pfConfigured;
  const isProjectForge = activeProject?.data_source === "projectforge";

  const refreshProjects = useCallback(async () => {
    const [list, location] = await Promise.all([api.listProjects(), api.projectFolder()]);
    setProjects(list);
    setFolder(location);
    return list;
  }, []);

  // Versionsnummer im Titel (das Fenster bekommt sie vom Backend).
  useEffect(() => {
    document.title = APP_TITLE;
  }, []);

  // Projektliste laden und zuletzt aktives Projekt wiederherstellen.
  useEffect(() => {
    if (!isTauri()) {
      setProjectsLoading(false);
      return;
    }
    refreshProjects()
      .then((list) => {
        const stored = readStoredActiveId();
        setActiveId(list.find((p) => p.id === stored)?.id ?? list[0]?.id ?? null);
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setProjectsLoading(false));
    api
      .projectForgeSettings()
      .then(setPfSettings)
      .catch(() => setPfSettings(null))
      .finally(() => setPfLoaded(true));
  }, [refreshProjects]);

  // Datenquelle ProjectForge: zuerst die zuletzt abgerufenen Daten auswerten.
  useEffect(() => {
    if (activeProject?.data_source !== "projectforge") {
      setPfRequest(null);
      return;
    }
    setPfRequest({ projectId: activeProject.id, mode: "cache", seq: ++pfSeq.current });
  }, [activeProject]);

  // Konfiguration des aktiven Projekts laden.
  useEffect(() => {
    if (activeId) storeActiveId(activeId);
    if (!activeId) {
      setActiveProject(null);
      return;
    }
    let stale = false;
    api
      .getProject(activeId)
      .then((config) => !stale && setActiveProject(config))
      .catch((e) => {
        if (stale) return;
        setActiveProject(null);
        setError(errorMessage(e));
      });
    return () => {
      stale = true;
    };
  }, [activeId]);

  // Zuletzt eingelesene Datei des Projekts laden (Kopie im Ordner „Import“).
  useEffect(() => {
    setFile(null);
    setLastImport(null);
    if (!activeId) return;
    let stale = false;
    api
      .lastImport(activeId)
      .then((info) => {
        if (stale || !info) return;
        setLastImport(info);
        setFile({ path: info.path, projectId: activeId, remember: false, seq: ++fileSeq.current });
      })
      .catch((e) => !stale && setError(errorMessage(e)));
    return () => {
      stale = true;
    };
  }, [activeId]);

  // Export auswerten – nach jedem Drop, beim Öffnen eines Projekts, nach dem
  // Speichern der Konfiguration und bei neuem Stichtag. Bei der Datenquelle
  // ProjectForge: abgerufene Daten auswerten bzw. abrufen.
  useEffect(() => {
    if (activeProject?.data_source === "projectforge") {
      const request = pfRequest;
      if (!request || request.projectId !== activeProject.id) {
        setResult(null);
        setBusy(false);
        return;
      }
      let stale = false;
      const fetchNow = request.mode !== "cache" && !pfStarted.current.has(request.seq);
      if (fetchNow) {
        pfStarted.current.add(request.seq);
        autoRefreshed.current.add(request.projectId);
        setError(null);
      }
      setBusy(true);
      const call = fetchNow
        ? api.fetchProjectForge(request.projectId, cutoff, request.mode === "full")
        : api.projectForgeCached(request.projectId, cutoff);
      call
        .then((evaluated) => {
          if (stale) {
            // Stichtag während des Abrufs geändert → abgerufene Daten neu auswerten
            if (fetchNow) {
              setPfRequest((current) =>
                current?.seq === request.seq
                  ? { ...current, mode: "cache", seq: ++pfSeq.current }
                  : current,
              );
            }
            return;
          }
          setResult(evaluated);
          // Einmal je Sitzung automatisch aktualisieren (fehlende/offene Monate)
          if (
            !fetchNow &&
            pfConfiguredRef.current &&
            !autoRefreshed.current.has(request.projectId)
          ) {
            autoRefreshed.current.add(request.projectId);
            setPfRequest({ projectId: request.projectId, mode: "refresh", seq: ++pfSeq.current });
          }
        })
        .catch((e) => {
          if (stale) return;
          if (fetchNow) {
            // bisheriges Ergebnis (letzter Abruf) bleibt stehen
            setError(`Abruf aus ProjectForge fehlgeschlagen: ${errorMessage(e)}`);
          } else {
            setResult(null);
            setError(errorMessage(e));
          }
        })
        .finally(() => !stale && setBusy(false));
      return () => {
        stale = true;
      };
    }
    if (!file || !activeProject || file.projectId !== activeProject.id) {
      setResult(null);
      setBusy(false);
      return;
    }
    let stale = false;
    const request = file;
    setBusy(true);
    setError(null);
    api
      .parseExport(request.path, activeProject.id, cutoff)
      .then((parsed) => {
        if (stale) return;
        setResult(parsed);
        if (request.remember && !remembered.current.has(request.seq)) {
          remembered.current.add(request.seq);
          rememberImport(request);
        }
      })
      .catch((e) => {
        if (stale) return;
        setResult(null);
        setError(errorMessage(e));
      })
      .finally(() => !stale && setBusy(false));
    return () => {
      stale = true;
    };
  }, [file, pfRequest, activeProject, cutoff]);

  function requestProjectForge(mode: ProjectForgeRequest["mode"]) {
    if (activeId) setPfRequest({ projectId: activeId, mode, seq: ++pfSeq.current });
  }

  function accessChanged(settings: ProjectForgeSettings) {
    setPfSettings(settings);
    setPfLoaded(true);
    if (isConfigured(settings) && isProjectForge) requestProjectForge("refresh");
  }

  /** Eingelesene Datei als letzten Import des Projekts merken. */
  function rememberImport(request: FileRequest) {
    api
      .rememberImport(request.projectId, request.path)
      .then((info) => activeIdRef.current === request.projectId && setLastImport(info))
      .catch((e) =>
        setError(`Ausgewertet, aber nicht als letzter Import gemerkt: ${errorMessage(e)}`),
      );
  }

  function selectProject(id: string) {
    setEditing(null);
    setAccessOpen(false);
    setActiveId(id);
  }

  async function saveProject(config: ProjectConfig) {
    const id = await api.saveProject(config);
    await refreshProjects();
    setEditing(null);
    if (id === activeId) {
      // Gleiche ID → Effekt greift nicht, daher direkt neu laden (löst Neu-Einlesen aus).
      setActiveProject(await api.getProject(id));
    } else {
      setActiveId(id);
    }
  }

  /** Projekte aus dem früheren Ablageort (App-Datenverzeichnis) übernehmen. */
  async function importLegacy() {
    try {
      await api.importLegacyProjects();
      const list = await refreshProjects();
      setActiveId(list[0]?.id ?? null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function deleteProject(id: string) {
    await api.deleteProject(id);
    const list = await refreshProjects();
    setEditing(null);
    if (id === activeId) setActiveId(list[0]?.id ?? null);
  }

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900">
      <aside className="w-64 shrink-0 border-r border-slate-200 bg-white">
        <ProjectSelector
          projects={projects}
          activeId={activeId}
          loading={projectsLoading}
          folder={folder}
          onSelect={selectProject}
          onCreate={() => setEditing(newProject())}
          onImportLegacy={importLegacy}
          onOpenAccess={() => setAccessOpen(true)}
        />
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-6 py-4">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">
              {activeProject?.name ?? "Billing Tracker"}
            </h1>
            <p className="truncate text-sm text-slate-500">
              {activeProject
                ? `Element-Filter: ${activeProject.element_filter || "–"} · ${
                    isProjectForge
                      ? "Daten aus ProjectForge"
                      : `Blatt „${activeProject.export_format.sheet_name}“`
                  }`
                : "Kein Projekt ausgewählt"}
            </p>
          </div>
          <button
            type="button"
            disabled={!activeProject || editing !== null}
            onClick={() => activeProject && setEditing(activeProject)}
            className="shrink-0 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            Projekt bearbeiten
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          {!isTauri() && (
            <p className="rounded-md bg-sky-50 px-4 py-3 text-sm text-sky-900">
              Die Oberfläche läuft im Browser. Dateizugriff und Projekte funktionieren nur in der
              Desktop-App (<code>npm run tauri dev</code>).
            </p>
          )}

          {error && (
            <div
              role="alert"
              className="flex items-start justify-between gap-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-800"
            >
              <span className="whitespace-pre-line">{error}</span>
              <button
                type="button"
                onClick={() => setError(null)}
                aria-label="Meldung schließen"
                className="text-red-500 hover:text-red-700"
              >
                ✕
              </button>
            </div>
          )}

          {accessOpen ? (
            <ProjectForgeAccess onClose={() => setAccessOpen(false)} onChange={accessChanged} />
          ) : editing ? (
            <ProjectEditor
              // Neu mounten, wenn ein anderes Projekt bearbeitet wird.
              key={editing.id || "new"}
              initial={editing}
              onSave={saveProject}
              onCancel={() => setEditing(null)}
              onDelete={deleteProject}
            />
          ) : (
            <>
              {isProjectForge ? (
                <ProjectForgeSource
                  busy={busy}
                  configured={pfConfigured}
                  fetched={result?.export_date_source === "fetched" ? result.file_name : null}
                  onRefresh={(full) => requestProjectForge(full ? "full" : "refresh")}
                  onOpenAccess={() => setAccessOpen(true)}
                />
              ) : (
                <DropZone
                  disabled={!activeProject}
                  busy={busy}
                  current={
                    result ? { fileName: result.file_name, exportDate: result.export_date } : null
                  }
                  lastImport={lastImport}
                  onFile={(path) =>
                    activeId &&
                    setFile({ path, projectId: activeId, remember: true, seq: ++fileSeq.current })
                  }
                  onError={setError}
                />
              )}
              {result && activeProject && (
                // neues Ergebnis → Fehleranzeige zurücksetzen (ohne Neuaufbau: Tab bleibt)
                <ErrorBoundary resetKey={result} what="Die Auswertung">
                  <ResultsView
                    result={result}
                    elementFilter={activeProject.element_filter}
                    plannedAbsences={activeProject.planned_absences}
                    busy={busy}
                    onCutoffChange={setCutoff}
                  />
                </ErrorBoundary>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

// localStorage ist hier nur Komfort (zuletzt aktives Projekt) – Fehler ignorieren.
function readStoredActiveId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_PROJECT_KEY);
  } catch {
    return null;
  }
}

function storeActiveId(id: string) {
  try {
    localStorage.setItem(ACTIVE_PROJECT_KEY, id);
  } catch {
    // ignorieren
  }
}
