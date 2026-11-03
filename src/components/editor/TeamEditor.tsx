import type { RatePeriod, TeamMember, WorkingHoursPeriod } from "../../types/config";
import { PeriodListEditor, RangeListEditor } from "./PeriodListEditor";
import { ui } from "./ui";

interface Props {
  team: TeamMember[];
  onChange: (team: TeamMember[]) => void;
  /** Für neue Zeiträume: Beginn des aktuellen Jahres. */
  defaultFrom: string;
}

export function TeamEditor({ team, onChange, defaultFrom }: Props) {
  const update = (index: number, patch: Partial<TeamMember>) =>
    onChange(team.map((m, i) => (i === index ? { ...m, ...patch } : m)));

  return (
    <div className="space-y-4">
      {team.length === 0 && (
        <p className={ui.hint}>Noch keine Personen. Namen wie in der Namensspalte des Exports.</p>
      )}
      {team.map((member, index) => (
        <div key={index} className="rounded-lg border border-slate-200 p-4">
          <div className="mb-3 flex items-center gap-3">
            <input
              required
              value={member.name}
              onChange={(e) => update(index, { name: e.target.value })}
              placeholder="Name wie im Export, z. B. Erika Mustermann"
              aria-label="Name"
              className={`${ui.input} font-medium`}
            />
            <button
              type="button"
              onClick={() => onChange(team.filter((_, i) => i !== index))}
              className="shrink-0 text-sm text-red-600 hover:underline"
            >
              Person entfernen
            </button>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <section>
              <h4 className="mb-2 text-sm font-medium text-slate-700">Stundensätze</h4>
              <PeriodListEditor<RatePeriod, "rate">
                items={member.rates}
                onChange={(rates) => update(index, { rates })}
                valueKey="rate"
                valueLabel="€ / h"
                create={() => ({ from: defaultFrom, to: null, rate: 0 })}
                emptyText="Kein Stundensatz – billable Stunden werden mit 0 € berechnet."
                addLabel="Stundensatz"
              />
            </section>
            <section>
              <h4 className="mb-2 text-sm font-medium text-slate-700">
                Abweichende Arbeitszeit
              </h4>
              <PeriodListEditor<WorkingHoursPeriod, "hours_per_day">
                items={member.working_hours}
                onChange={(working_hours) => update(index, { working_hours })}
                valueKey="hours_per_day"
                valueLabel="h / Tag"
                step={0.05}
                create={() => ({ from: defaultFrom, to: null, hours_per_day: 8 })}
                emptyText="Keine Ausnahme – es gilt die Arbeitszeit des Projekts."
                addLabel="Ausnahme"
              />
            </section>
            <section className="lg:col-span-2">
              <h4 className="mb-1 text-sm font-medium text-slate-700">Einsatzzeitraum im Projekt</h4>
              <p className={`mb-2 ${ui.hint}`}>
                Außerhalb zählt die Person nicht mit (kein Soll, keine Arbeitszeit, keine Prüfung
                auf fehlende Buchungen). Buchungen aufs Projekt außerhalb werden trotzdem
                abgerechnet und deutlich markiert.
              </p>
              <RangeListEditor
                items={member.assignments}
                onChange={(assignments) => update(index, { assignments })}
                create={() => ({ from: defaultFrom, to: null })}
                emptyText="Kein Zeitraum – die Person ist durchgehend im Projekt."
                addLabel="Einsatzzeitraum"
              />
            </section>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange([...team, { name: "", rates: [], working_hours: [], assignments: [] }])
        }
        className={ui.secondaryButton}
      >
        + Person
      </button>
    </div>
  );
}
