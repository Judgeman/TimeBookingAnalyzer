import type {
  RatePeriod,
  TeamMember,
  VacationEntitlement,
  WorkingHoursPeriod,
} from "../../types/config";
import { PeriodListEditor, RangeListEditor } from "./PeriodListEditor";
import { numberOf, ui } from "./ui";

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
            <section className="lg:col-span-2">
              <h4 className="mb-1 text-sm font-medium text-slate-700">Urlaubsanspruch</h4>
              <p className={`mb-2 ${ui.hint}`}>
                Tage je Kalenderjahr und Übertrag aus dem Vorjahr – für den Resturlaub in „Insights“.
              </p>
              <VacationEditor
                items={member.vacation}
                onChange={(vacation) => update(index, { vacation })}
                defaultYear={Number(defaultFrom.slice(0, 4))}
              />
            </section>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange([
            ...team,
            { name: "", rates: [], working_hours: [], assignments: [], vacation: [] },
          ])
        }
        className={ui.secondaryButton}
      >
        + Person
      </button>
    </div>
  );
}

/** Urlaubsanspruch je Jahr: Jahr, Tage, Übertrag. */
function VacationEditor({
  items,
  onChange,
  defaultYear,
}: {
  items: VacationEntitlement[];
  onChange: (items: VacationEntitlement[]) => void;
  defaultYear: number;
}) {
  const update = (index: number, patch: Partial<VacationEntitlement>) =>
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  // neues Jahr: nach dem letzten erfassten, sonst das aktuelle
  const nextYear = items.length ? Math.max(...items.map((v) => v.year)) + 1 : defaultYear;
  return (
    <div className="space-y-2">
      {items.length === 0 ? (
        <p className={ui.hint}>Kein Anspruch hinterlegt – Resturlaub wird nicht berechnet.</p>
      ) : (
        <div className="grid max-w-xl grid-cols-[6rem_1fr_1fr_auto] items-center gap-2 text-xs text-slate-500">
          <span>Jahr</span>
          <span>Tage</span>
          <span>Übertrag Vorjahr</span>
          <span />
          {items.map((item, index) => (
            <VacationRow
              key={index}
              item={item}
              onChange={(patch) => update(index, patch)}
              onRemove={() => onChange(items.filter((_, i) => i !== index))}
            />
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => onChange([...items, { year: nextYear, days: 30, carry_over: 0 }])}
        className={ui.addButton}
      >
        + Urlaubsanspruch
      </button>
    </div>
  );
}

function VacationRow({
  item,
  onChange,
  onRemove,
}: {
  item: VacationEntitlement;
  onChange: (patch: Partial<VacationEntitlement>) => void;
  onRemove: () => void;
}) {
  return (
    <>
      <input
        type="number"
        required
        step={1}
        aria-label="Urlaub Jahr"
        value={item.year}
        onChange={(e) => onChange({ year: numberOf(e.target.value, item.year) })}
        className={ui.inputSm}
      />
      <input
        type="number"
        required
        min={0}
        step={0.5}
        aria-label="Urlaub Tage"
        value={item.days}
        onChange={(e) => onChange({ days: numberOf(e.target.value) })}
        className={`${ui.inputSm} text-right`}
      />
      <input
        type="number"
        step={0.5}
        aria-label="Urlaub Übertrag"
        value={item.carry_over}
        onChange={(e) => onChange({ carry_over: numberOf(e.target.value) })}
        className={`${ui.inputSm} text-right`}
      />
      <button type="button" onClick={onRemove} className={ui.removeButton} title="Urlaubsanspruch entfernen">
        ✕
      </button>
    </>
  );
}
