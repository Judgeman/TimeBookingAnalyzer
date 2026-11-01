import { defaultBillingRules, type BillingRule } from "../../types/config";
import { formatNumber } from "../../lib/format";
import { numberOf, ui } from "./ui";

interface Props {
  rules: BillingRule[];
  onChange: (rules: BillingRule[]) => void;
  elementFilter: string;
  projectVat: number;
}

/** Abrechnungsregeln: erste passende Regel gilt, Reihenfolge per Pfeil änderbar. */
export function RulesEditor({ rules, onChange, elementFilter, projectVat }: Props) {
  const update = (index: number, patch: Partial<BillingRule>) =>
    onChange(rules.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const move = (index: number, delta: number) => {
    const next = [...rules];
    const [rule] = next.splice(index, 1);
    next.splice(index + delta, 0, rule);
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <p className={ui.hint}>
        Jede Buchung wird der <strong>ersten passenden</strong> Regel zugeordnet (Kost2Art ohne
        Groß-/Kleinschreibung). Buchungen ohne passende Regel sind nicht billable. Element leer =
        Projekt-Element „{elementFilter || "–"}“.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[60rem] text-sm">
          <thead className="text-xs text-slate-500">
            <tr className="text-left">
              <th className="w-14 py-1 font-medium" />
              <th className="py-1 font-medium">Bezeichnung</th>
              <th className="py-1 font-medium">Kost2Art</th>
              <th className="w-28 py-1 font-medium">Vergleich</th>
              <th className="py-1 font-medium">Element</th>
              <th className="w-16 py-1 text-center font-medium" title="Zählt in „Billable (h)“">
                Billable h
              </th>
              <th className="w-16 py-1 text-center font-medium" title="Wird in Rechnung gestellt">
                Abrechnen
              </th>
              <th
                className="w-16 py-1 text-center font-medium"
                title="Abgerechnete Stunden = Stunden × Mult"
              >
                × Mult
              </th>
              <th className="w-20 py-1 font-medium" title="Anteil des Stundensatzes">
                Satz %
              </th>
              <th className="w-20 py-1 font-medium" title="Leer = USt.-Satz des Projekts">
                USt. %
              </th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {rules.map((rule, index) => (
              <tr key={index} className="align-middle">
                <td className="py-1 whitespace-nowrap text-slate-400">
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    className="px-1 hover:text-slate-800 disabled:opacity-30"
                    title="Nach oben (höhere Priorität)"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    disabled={index === rules.length - 1}
                    onClick={() => move(index, 1)}
                    className="px-1 hover:text-slate-800 disabled:opacity-30"
                    title="Nach unten"
                  >
                    ▼
                  </button>
                </td>
                <td className="py-1 pr-2">
                  <input
                    required
                    value={rule.name}
                    onChange={(e) => update(index, { name: e.target.value })}
                    className={ui.inputSm}
                    aria-label="Bezeichnung"
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    required
                    value={rule.kost2art}
                    onChange={(e) => update(index, { kost2art: e.target.value })}
                    className={ui.inputSm}
                    aria-label="Kost2Art"
                  />
                </td>
                <td className="py-1 pr-2">
                  <select
                    value={rule.match_mode}
                    onChange={(e) =>
                      update(index, { match_mode: e.target.value as BillingRule["match_mode"] })
                    }
                    className={ui.inputSm}
                    aria-label="Vergleich"
                  >
                    <option value="exact">exakt</option>
                    <option value="contains">enthält</option>
                  </select>
                </td>
                <td className="py-1 pr-2">
                  <input
                    value={rule.element}
                    onChange={(e) => update(index, { element: e.target.value })}
                    placeholder="Projekt-Element"
                    className={ui.inputSm}
                    aria-label="Element"
                  />
                </td>
                <Check
                  checked={rule.billable_hours}
                  onChange={(v) => update(index, { billable_hours: v })}
                  label="Billable h"
                />
                <Check
                  checked={rule.invoice}
                  onChange={(v) => update(index, { invoice: v })}
                  label="Abrechnen"
                />
                <Check
                  checked={rule.apply_mult}
                  onChange={(v) => update(index, { apply_mult: v })}
                  label="× Mult"
                />
                <td className="py-1 pr-2">
                  <input
                    type="number"
                    min={0}
                    step={1}
                    required
                    value={rule.rate_percent}
                    onChange={(e) => update(index, { rate_percent: numberOf(e.target.value) })}
                    className={`${ui.inputSm} text-right`}
                    aria-label="Satz %"
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    value={rule.vat_percent ?? ""}
                    placeholder={formatNumber(projectVat)}
                    onChange={(e) =>
                      update(index, {
                        vat_percent: e.target.value.trim() === "" ? null : numberOf(e.target.value),
                      })
                    }
                    className={`${ui.inputSm} text-right`}
                    aria-label="USt. %"
                  />
                </td>
                <td className="py-1">
                  <button
                    type="button"
                    onClick={() => onChange(rules.filter((_, i) => i !== index))}
                    className={ui.removeButton}
                    title="Regel entfernen"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-4">
        <button
          type="button"
          onClick={() =>
            onChange([
              ...rules,
              {
                name: "",
                kost2art: "",
                match_mode: "exact",
                element: "",
                billable_hours: false,
                invoice: true,
                apply_mult: false,
                rate_percent: 100,
                vat_percent: null,
              },
            ])
          }
          className={ui.addButton}
        >
          + Regel
        </button>
        <button
          type="button"
          onClick={() => onChange(defaultBillingRules())}
          className={ui.addButton}
        >
          Standardregeln wiederherstellen
        </button>
      </div>
    </div>
  );
}

function Check({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <td className="py-1 text-center">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
        className="h-4 w-4 accent-slate-800"
      />
    </td>
  );
}
