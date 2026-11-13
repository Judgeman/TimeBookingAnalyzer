import { ui } from "./editor/ui";

interface Props {
  busy: boolean;
  /** Zugang vollständig eingerichtet? `null` = noch unbekannt. */
  configured: boolean | null;
  /** Beschreibung des letzten Abrufs (z. B. „ProjectForge – Abruf 13.11.2026, 14:05“). */
  fetched: string | null;
  onRefresh: (full: boolean) => void;
  onOpenAccess: () => void;
}

/** Datenquelle „ProjectForge“: Abruf statt Drop-Zone. */
export function ProjectForgeSource({ busy, configured, fetched, onRefresh, onOpenAccess }: Props) {
  return (
    <section
      aria-label="Daten aus ProjectForge"
      className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-5 py-4"
    >
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">Daten aus ProjectForge</h2>
        <p className="text-sm text-slate-500">
          {fetched ? `Letzter ${fetched.replace(/^ProjectForge – /, "")}` : "Noch keine Daten abgerufen."}
          {busy && " · Buchungen werden abgerufen …"}
        </p>
        {configured === false && (
          <p className="mt-1 text-sm text-amber-800">
            Der Zugang fehlt noch –{" "}
            <button type="button" onClick={onOpenAccess} className="font-medium underline">
              ProjectForge-Zugang einrichten
            </button>
            .
          </p>
        )}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || !configured}
          onClick={() => onRefresh(false)}
          title="Fehlende und noch offene Monate abrufen"
          className={ui.primaryButton}
        >
          Aktualisieren
        </button>
        <button
          type="button"
          disabled={busy || !configured}
          onClick={() => onRefresh(true)}
          title="Alle Monate neu abrufen (z. B. nach nachträglichen Änderungen in abgeschlossenen Monaten)"
          className={`${ui.secondaryButton} disabled:opacity-50`}
        >
          Alles neu laden
        </button>
      </div>
    </section>
  );
}
