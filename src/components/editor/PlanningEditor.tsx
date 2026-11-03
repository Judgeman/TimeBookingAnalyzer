import type { BudgetPeriod, PlannedAbsence, PlannedAbsenceKind } from "../../types/config";
import { formatEuro, todayIso } from "../../lib/format";
import { numberOf, ui } from "./ui";

interface Props {
  budgets: BudgetPeriod[];
  absences: PlannedAbsence[];
  /** Namen der Teammitglieder (Auswahl für Abwesenheiten). */
  team: string[];
  onBudgets: (budgets: BudgetPeriod[]) => void;
  onAbsences: (absences: PlannedAbsence[]) => void;
}

const KIND_LABEL: Record<PlannedAbsenceKind, string> = {
  vacation: "Urlaub",
  other: "Sonstiges",
};

/** Anzahl der Monate von "2026-01" bis "2026-12" (einschließlich); 0 bei Unsinn. */
export function monthCount(from: string, to: string): number {
  const parse = (m: string) => {
    const match = /^(\d{4})-(\d{2})$/.exec(m);
    return match ? Number(match[1]) * 12 + Number(match[2]) - 1 : NaN;
  };
  const count = parse(to) - parse(from) + 1;
  return Number.isFinite(count) && count > 0 ? count : 0;
}

/**
 * Planung für die Prognose: Budget-Zeiträume (ganze Monate) und geplante
 * Abwesenheiten ohne Buchung.
 */
export function PlanningEditor({ budgets, absences, team, onBudgets, onAbsences }: Props) {
  const year = todayIso().slice(0, 4);
  const updateBudget = (index: number, patch: Partial<BudgetPeriod>) =>
    onBudgets(budgets.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  const updateAbsence = (index: number, patch: Partial<PlannedAbsence>) =>
    onAbsences(absences.map((a, i) => (i === index ? { ...a, ...patch } : a)));

  return (
    <div className="space-y-6">
      <section>
        <h4 className="mb-1 text-sm font-medium text-slate-700">Budget</h4>
        <p className={`mb-2 ${ui.hint}`}>
          Netto-Budget für einen Zeitraum ganzer Monate. Richtwert je Monat = Budget ÷ Anzahl
          Monate; die Prognose zeigt, ob das Budget bis zum Ende reicht.
        </p>
        {budgets.length === 0 ? (
          <p className={ui.hint}>Kein Budget hinterlegt – die Prognose läuft bis Jahresende.</p>
        ) : (
          <div className="grid grid-cols-[1fr_1fr_10rem_9rem_auto] items-center gap-2 text-xs text-slate-500">
            <span>Von (Monat)</span>
            <span>Bis (Monat)</span>
            <span>Budget netto (€)</span>
            <span>Richtwert / Monat</span>
            <span />
            {budgets.map((budget, index) => {
              const months = monthCount(budget.from, budget.to);
              return (
                <BudgetRow
                  key={index}
                  budget={budget}
                  perMonth={months > 0 ? formatEuro(budget.amount / months) : "–"}
                  onChange={(patch) => updateBudget(index, patch)}
                  onRemove={() => onBudgets(budgets.filter((_, i) => i !== index))}
                />
              );
            })}
          </div>
        )}
        <button
          type="button"
          onClick={() => onBudgets([...budgets, { from: `${year}-01`, to: `${year}-12`, amount: 0 }])}
          className={`mt-2 ${ui.addButton}`}
        >
          + Budget-Zeitraum
        </button>
      </section>

      <section>
        <h4 className="mb-1 text-sm font-medium text-slate-700">Geplante Abwesenheiten</h4>
        <p className={`mb-2 ${ui.hint}`}>
          Urlaub oder andere Abwesenheiten, für die es noch keine Buchung gibt. Sie verringern die
          Arbeitszeit in der Prognose (nur Tage nach dem Stand des Exports).
        </p>
        {absences.length === 0 ? (
          <p className={ui.hint}>Keine geplanten Abwesenheiten.</p>
        ) : (
          <div className="grid grid-cols-[1.5fr_1fr_1fr_8rem_5rem_auto] items-center gap-2 text-xs text-slate-500">
            <span>Person</span>
            <span>Von</span>
            <span>Bis</span>
            <span>Art</span>
            <span>½ Tag</span>
            <span />
            {absences.map((absence, index) => (
              <AbsenceRow
                key={index}
                absence={absence}
                team={team}
                onChange={(patch) => updateAbsence(index, patch)}
                onRemove={() => onAbsences(absences.filter((_, i) => i !== index))}
              />
            ))}
          </div>
        )}
        <button
          type="button"
          disabled={team.length === 0}
          onClick={() =>
            onAbsences([
              ...absences,
              { person: team[0], from: todayIso(), to: todayIso(), kind: "vacation", half_day: false },
            ])
          }
          className={`mt-2 ${ui.addButton} disabled:opacity-40`}
        >
          + Abwesenheit
        </button>
      </section>
    </div>
  );
}

function BudgetRow({
  budget,
  perMonth,
  onChange,
  onRemove,
}: {
  budget: BudgetPeriod;
  perMonth: string;
  onChange: (patch: Partial<BudgetPeriod>) => void;
  onRemove: () => void;
}) {
  return (
    <>
      <input
        type="month"
        required
        aria-label="Budget von"
        value={budget.from}
        onChange={(e) => onChange({ from: e.target.value })}
        className={ui.inputSm}
      />
      <input
        type="month"
        required
        aria-label="Budget bis"
        value={budget.to}
        min={budget.from || undefined}
        onChange={(e) => onChange({ to: e.target.value })}
        className={ui.inputSm}
      />
      <input
        type="number"
        min={0}
        step={100}
        required
        aria-label="Budget netto"
        value={Number.isFinite(budget.amount) ? budget.amount : ""}
        onChange={(e) => onChange({ amount: numberOf(e.target.value) })}
        className={`${ui.inputSm} text-right`}
      />
      <span className="text-right text-sm text-slate-700 tabular-nums">{perMonth}</span>
      <button type="button" onClick={onRemove} className={ui.removeButton} title="Budget entfernen">
        ✕
      </button>
    </>
  );
}

function AbsenceRow({
  absence,
  team,
  onChange,
  onRemove,
}: {
  absence: PlannedAbsence;
  team: string[];
  onChange: (patch: Partial<PlannedAbsence>) => void;
  onRemove: () => void;
}) {
  // Person nicht (mehr) im Team → trotzdem anzeigen; das Backend meldet es beim Speichern.
  const names = team.includes(absence.person) ? team : [absence.person, ...team];
  return (
    <>
      <select
        aria-label="Abwesenheit Person"
        value={absence.person}
        onChange={(e) => onChange({ person: e.target.value })}
        className={ui.inputSm}
      >
        {names.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      <input
        type="date"
        required
        aria-label="Abwesenheit von"
        value={absence.from}
        onChange={(e) => onChange({ from: e.target.value })}
        className={ui.inputSm}
      />
      <input
        type="date"
        required
        aria-label="Abwesenheit bis"
        value={absence.to}
        min={absence.from || undefined}
        onChange={(e) => onChange({ to: e.target.value })}
        className={ui.inputSm}
      />
      <select
        aria-label="Abwesenheit Art"
        value={absence.kind}
        onChange={(e) => onChange({ kind: e.target.value as PlannedAbsenceKind })}
        className={ui.inputSm}
      >
        {(Object.keys(KIND_LABEL) as PlannedAbsenceKind[]).map((kind) => (
          <option key={kind} value={kind}>
            {KIND_LABEL[kind]}
          </option>
        ))}
      </select>
      <input
        type="checkbox"
        aria-label="Halber Tag"
        checked={absence.half_day}
        onChange={(e) => onChange({ half_day: e.target.checked })}
        className="h-4 w-4 justify-self-center"
      />
      <button type="button" onClick={onRemove} className={ui.removeButton} title="Abwesenheit entfernen">
        ✕
      </button>
    </>
  );
}
