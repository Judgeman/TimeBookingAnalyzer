import { shortPath } from "../lib/format";
import { APP_NAME, APP_VERSION } from "../lib/version";
import type { ProjectFolder, ProjectSummary } from "../types/results";

interface Props {
  projects: ProjectSummary[];
  activeId: string | null;
  loading: boolean;
  /** Projektordner dieser Instanz (neben der Programmdatei). */
  folder?: ProjectFolder | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  /** Projekte aus dem früheren Ablageort übernehmen. */
  onImportLegacy?: () => void;
}

export function ProjectSelector({
  projects,
  activeId,
  loading,
  folder,
  onSelect,
  onCreate,
  onImportLegacy,
}: Props) {
  const legacyCount = folder?.legacy_count ?? 0;
  return (
    <nav aria-label="Projekte" className="flex h-full flex-col">
      <div className="border-b border-slate-200 px-4 py-4">
        <h2 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Projekte</h2>
      </div>

      <ul className="flex-1 overflow-y-auto p-2">
        {loading && <li className="px-3 py-2 text-sm text-slate-400">Lade …</li>}
        {!loading && projects.length === 0 && (
          <li className="px-3 py-2 text-sm text-slate-500">
            Noch keine Projekte angelegt.
            {legacyCount > 0 && onImportLegacy && (
              <button
                type="button"
                onClick={onImportLegacy}
                className="mt-3 block w-full rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-left text-xs text-sky-900 hover:bg-sky-100"
              >
                <span className="block font-medium">
                  {legacyCount === 1
                    ? "1 Projekt aus früherer Version übernehmen"
                    : `${legacyCount} Projekte aus früherer Version übernehmen`}
                </span>
                <span className="block text-sky-700">
                  Wird in den Projektordner dieser Instanz kopiert.
                </span>
              </button>
            )}
          </li>
        )}
        {projects.map((project) => {
          const active = project.id === activeId;
          const details =
            `${project.element_filter || "kein Element-Filter"} · ${project.team_size} ` +
            (project.team_size === 1 ? "Person" : "Personen") +
            (project.guest_count > 0 ? ` + ${project.guest_count} darf buchen` : "");
          return (
            <li key={project.id}>
              <button
                type="button"
                onClick={() => onSelect(project.id)}
                aria-current={active ? "true" : undefined}
                className={`w-full rounded-md px-3 py-2 text-left transition-colors ${
                  active ? "bg-slate-800 text-white" : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                <span className="block truncate text-sm font-medium">{project.name}</span>
                <span
                  title={details}
                  className={`block truncate text-xs ${active ? "text-slate-300" : "text-slate-500"}`}
                >
                  {details}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-slate-200 p-3">
        {folder && (
          <p className="mb-2 truncate text-[11px] text-slate-400" title={folder.dir}>
            Projektordner: {shortPath(folder.dir)}
          </p>
        )}
        <button
          type="button"
          onClick={onCreate}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          + Neues Projekt
        </button>
        <p className="mt-2 text-center text-[11px] text-slate-400">
          {APP_NAME} {APP_VERSION}
        </p>
      </div>
    </nav>
  );
}
