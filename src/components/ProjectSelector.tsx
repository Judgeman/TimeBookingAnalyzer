import type { ProjectSummary } from "../types/results";

interface Props {
  projects: ProjectSummary[];
  activeId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

export function ProjectSelector({ projects, activeId, loading, onSelect, onCreate }: Props) {
  return (
    <nav aria-label="Projekte" className="flex h-full flex-col">
      <div className="border-b border-slate-200 px-4 py-4">
        <h2 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Projekte</h2>
      </div>

      <ul className="flex-1 overflow-y-auto p-2">
        {loading && <li className="px-3 py-2 text-sm text-slate-400">Lade …</li>}
        {!loading && projects.length === 0 && (
          <li className="px-3 py-2 text-sm text-slate-500">Noch keine Projekte angelegt.</li>
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
        <button
          type="button"
          onClick={onCreate}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          + Neues Projekt
        </button>
      </div>
    </nav>
  );
}
