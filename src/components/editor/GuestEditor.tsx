import type { Guest, RatePeriod } from "../../types/config";
import { PeriodListEditor } from "./PeriodListEditor";
import { ui } from "./ui";

interface Props {
  guests: Guest[];
  onChange: (guests: Guest[]) => void;
  /** Für neue Zeiträume: Beginn des aktuellen Jahres. */
  defaultFrom: string;
}

/**
 * Rolle „darf buchen“: Personen, die aufs Projekt buchen dürfen, deren
 * Arbeitszeit aber nicht ausgewertet wird (nur Name und Stundensatz).
 */
export function GuestEditor({ guests, onChange, defaultFrom }: Props) {
  const update = (index: number, patch: Partial<Guest>) =>
    onChange(guests.map((g, i) => (i === index ? { ...g, ...patch } : g)));

  return (
    <div className="space-y-4">
      <p className={ui.hint}>
        Z. B. Geschäftsführung: Buchungen aufs Projekt sind erlaubt und werden nicht als „außerhalb
        des Teams“ markiert. Kein Soll, kein Stundenkonto, keine Prüfung auf fehlende Buchungen. Ob
        eine Buchung abgerechnet wird, entscheiden die Abrechnungsregeln (Kost2Art) – mit dem
        Stundensatz der Person.
      </p>
      {guests.map((guest, index) => (
        <div key={index} className="rounded-lg border border-slate-200 p-4">
          <div className="mb-3 flex items-center gap-3">
            <input
              required
              value={guest.name}
              onChange={(e) => update(index, { name: e.target.value })}
              placeholder="Name wie im Export"
              aria-label="Name (darf buchen)"
              className={`${ui.input} font-medium`}
            />
            <button
              type="button"
              onClick={() => onChange(guests.filter((_, i) => i !== index))}
              className="shrink-0 text-sm text-red-600 hover:underline"
            >
              Person entfernen
            </button>
          </div>
          <h4 className="mb-2 text-sm font-medium text-slate-700">Stundensätze</h4>
          <PeriodListEditor<RatePeriod, "rate">
            items={guest.rates}
            onChange={(rates) => update(index, { rates })}
            valueKey="rate"
            valueLabel="€ / h"
            create={() => ({ from: defaultFrom, to: null, rate: 0 })}
            emptyText="Kein Stundensatz – billable Stunden werden mit 0 € berechnet."
            addLabel="Stundensatz"
          />
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...guests, { name: "", rates: [] }])}
        className={ui.secondaryButton}
      >
        + Person (darf buchen)
      </button>
    </div>
  );
}
