import { useCallback, useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { DropZone } from "./components/DropZone";
import { ProjectEditor } from "./components/ProjectEditor";
import { ProjectSelector } from "./components/ProjectSelector";
import { ResultsView } from "./components/results/ResultsView";
import { api, errorMessage } from "./lib/api";
import { todayIso } from "./lib/format";
import { newProject, type ProjectConfig } from "./types/config";
import type { AuswertungResult, ProjectSummary } from "./types/results";

const ACTIVE_PROJECT_KEY = "billing-tracker.active-project";

/** Datei-Anfrage mit Zähler, damit dieselbe Datei erneut eingelesen werden kann. */
interface FileRequest {
  path: string;
  seq: number;
}

export default function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState<ProjectConfig | null>(null);
  const [editing, setEditing] = useState<ProjectConfig | null>(null);
  const [file, setFile] = useState<FileRequest | null>(null);
  /** Stichtag der Auswertung – beim Programmstart heute. */
  const [cutoff, setCutoff] = useState<string>(todayIso);
  const [result, setResult] = useState<AuswertungResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshProjects = useCallback(async () => {
    const list = await api.listProjects();
    setProjects(list);
    return list;
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
  }, [refreshProjects]);

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

  // Export auswerten – nach jedem Drop, bei Projektwechsel und neuem Stichtag.
  useEffect(() => {
    if (!file || !activeProject) {
      setResult(null);
      setBusy(false);
      return;
    }
    let stale = false;
    setBusy(true);
    setError(null);
    api
      .parseExport(file.path, activeProject.id, cutoff)
      .then((parsed) => !stale && setResult(parsed))
      .catch((e) => {
        if (stale) return;
        setResult(null);
        setError(errorMessage(e));
      })
      .finally(() => !stale && setBusy(false));
    return () => {
      stale = true;
    };
  }, [file, activeProject, cutoff]);

  function selectProject(id: string) {
    setEditing(null);
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
          onSelect={selectProject}
          onCreate={() => setEditing(newProject())}
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
                ? `Element-Filter: ${activeProject.element_filter || "–"} · Blatt „${activeProject.export_format.sheet_name}“`
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

          {editing ? (
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
              <DropZone
                disabled={!activeProject}
                busy={busy}
                current={
                  result ? { fileName: result.file_name, exportDate: result.export_date } : null
                }
                onFile={(path) => setFile((prev) => ({ path, seq: (prev?.seq ?? 0) + 1 }))}
                onError={setError}
              />
              {result && activeProject && (
                <ResultsView
                  result={result}
                  elementFilter={activeProject.element_filter}
                  busy={busy}
                  onCutoffChange={setCutoff}
                />
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
