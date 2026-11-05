import { useState, type FormEvent } from "react";
import {
  COLUMN_LABELS,
  REGIONS,
  type ColumnMapping,
  type ProjectConfig,
  type WorkingHoursPeriod,
} from "../types/config";
import { columnLetter, formatDate } from "../lib/format";
import { parseDateList } from "../lib/dates";
import { errorMessage } from "../lib/api";
import { GuestEditor } from "./editor/GuestEditor";
import { PeriodListEditor } from "./editor/PeriodListEditor";
import { PlanningEditor } from "./editor/PlanningEditor";
import { RulesEditor } from "./editor/RulesEditor";
import { TeamEditor } from "./editor/TeamEditor";
import { Field, numberOf, ui } from "./editor/ui";

interface Props {
  initial: ProjectConfig;
  onSave: (config: ProjectConfig) => Promise<void>;
  onCancel: () => void;
  onDelete?: (id: string) => Promise<void>;
}

/** Spalten A … AZ zur Auswahl. */
const COLUMN_OPTIONS = Array.from({ length: 52 }, (_, i) => i);

/**
 * Projekt-Editor. Zeiträume, Regeln und Werte prüft das Backend beim
 * Speichern zusätzlich (z. B. Überschneidungen).
 */
export function ProjectEditor({ initial, onSave, onCancel, onDelete }: Props) {
  const [draft, setDraft] = useState<ProjectConfig>(initial);
  const [customDays, setCustomDays] = useState(() =>
    initial.holidays.custom.map(formatDate).join("\n"),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isNew = initial.id === "";
  const format = draft.export_format;
  const defaultFrom = `${new Date().getFullYear()}-01-01`;

  function patch(update: Partial<ProjectConfig>) {
    setDraft((d) => ({ ...d, ...update }));
  }

  function setFormat(update: Partial<ProjectConfig["export_format"]>) {
    setDraft((d) => ({ ...d, export_format: { ...d.export_format, ...update } }));
  }

  function setColumn(key: keyof ColumnMapping, value: number) {
    setFormat({ columns: { ...format.columns, [key]: value } });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);

    let custom: string[];
    try {
      custom = parseDateList(customDays);
    } catch (e) {
      setError(`Zusätzliche freie Tage: ${errorMessage(e)}`);
      return;
    }

    setSaving(true);
    try {
      await onSave({ ...draft, holidays: { ...draft.holidays, custom } });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!onDelete) return;
    setSaving(true);
    try {
      await onDelete(initial.id);
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <div className="sticky -top-6 z-10 -mx-6 -mt-6 flex items-center justify-between border-b border-slate-200 bg-slate-50/95 px-6 py-4 backdrop-blur">
        <h2 className="text-lg font-semibold">{isNew ? "Neues Projekt" : "Projekt bearbeiten"}</h2>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className={ui.secondaryButton}>
            Abbrechen
          </button>
          <button type="submit" disabled={saving} className={ui.primaryButton}>
            {saving ? "Speichere …" : "Speichern"}
          </button>
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-4 py-3 text-sm whitespace-pre-line text-red-800"
        >
          {error}
        </p>
      )}

      <fieldset className={ui.card}>
        <legend className={ui.legend}>Projekt</legend>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Projektname">
            <input
              required
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="Musterkunde GmbH / Lager-App"
              className={ui.input}
            />
          </Field>
          <Field label="Element-Filter" hint="Wert der Element-Spalte, der zum Projekt gehört">
            <input
              value={draft.element_filter}
              onChange={(e) => patch({ element_filter: e.target.value })}
              placeholder="P100 Lager-App"
              className={ui.input}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className={ui.card}>
        <legend className={ui.legend}>Team</legend>
        <TeamEditor
          team={draft.team}
          onChange={(team) => patch({ team })}
          defaultFrom={defaultFrom}
        />
      </fieldset>

      <fieldset className={ui.card}>
        <legend className={ui.legend}>Darf buchen (ohne Zeiterfassung)</legend>
        <GuestEditor
          guests={draft.guests}
          onChange={(guests) => patch({ guests })}
          defaultFrom={defaultFrom}
        />
      </fieldset>

      <fieldset className={ui.card}>
        <legend className={ui.legend}>Planung (Budget &amp; Prognose)</legend>
        <PlanningEditor
          budgets={draft.budgets}
          absences={draft.planned_absences}
          team={draft.team.map((m) => m.name).filter((n) => n.trim() !== "")}
          onBudgets={(budgets) => patch({ budgets })}
          onAbsences={(planned_absences) => patch({ planned_absences })}
        />
      </fieldset>

      <fieldset className={ui.card}>
        <legend className={ui.legend}>Arbeitszeit (Projekt)</legend>
        <p className={`mb-3 ${ui.hint}`}>
          Vertragliche Stunden pro Werktag für alle Personen – außer für Zeiträume mit einer
          abweichenden Arbeitszeit bei der Person.
        </p>
        <PeriodListEditor<WorkingHoursPeriod, "hours_per_day">
          items={draft.working_hours}
          onChange={(working_hours) => patch({ working_hours })}
          valueKey="hours_per_day"
          valueLabel="h / Tag"
          create={() => ({ from: defaultFrom, to: null, hours_per_day: 8 })}
          emptyText="Keine Arbeitszeit hinterlegt – das Soll ist 0 h."
          addLabel="Zeitraum"
        />
      </fieldset>

      <fieldset className={ui.card}>
        <legend className={ui.legend}>Abrechnungsregeln</legend>
        <RulesEditor
          rules={draft.billing_rules}
          onChange={(billing_rules) => patch({ billing_rules })}
          elementFilter={draft.element_filter}
          projectVat={draft.vat_percent}
        />
      </fieldset>

      <fieldset className={ui.card}>
        <legend className={ui.legend}>Feiertage &amp; Umsatzsteuer</legend>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Bundesland (Feiertage)">
            <select
              value={draft.holidays.region}
              onChange={(e) => patch({ holidays: { ...draft.holidays, region: e.target.value } })}
              className={ui.input}
            >
              {REGIONS.map(([code, name]) => (
                <option key={code} value={code}>
                  {name} ({code})
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Zusätzliche freie Tage"
            hint="Ein Datum pro Zeile, z. B. 24.12.2026 (Betriebsferien, regionale Feiertage)"
          >
            <textarea
              value={customDays}
              onChange={(e) => setCustomDays(e.target.value)}
              rows={3}
              placeholder={"24.12.2026\n31.12.2026"}
              className={`${ui.input} font-mono text-xs`}
            />
          </Field>
          <Field
            label="Umsatzsteuer (%)"
            hint="Standard für die Rechnung; einzelne Regeln können abweichen"
          >
            <input
              type="number"
              min={0}
              max={100}
              step="any"
              required
              value={draft.vat_percent}
              onChange={(e) => patch({ vat_percent: numberOf(e.target.value) })}
              className={ui.input}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className={ui.card}>
        <legend className={ui.legend}>Prüfung</legend>
        <div className="grid grid-cols-3 gap-4">
          <Field
            label="Fehlende Buchung unter (%)"
            hint="Werktag gilt als „fehlende Buchung“, wenn weniger als dieser Anteil der Soll-Stunden gebucht ist (Arbeitszeit + Urlaub/Krank)"
          >
            <input
              type="number"
              min={0}
              max={100}
              step="any"
              required
              value={draft.missing_threshold_percent}
              onChange={(e) => patch({ missing_threshold_percent: numberOf(e.target.value) })}
              className={ui.input}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className={ui.card}>
        <legend className={ui.legend}>Export-Format</legend>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Tabellenblatt">
            <input
              required
              value={format.sheet_name}
              onChange={(e) => setFormat({ sheet_name: e.target.value })}
              className={ui.input}
            />
          </Field>
          <Field label="Element „Krank“">
            <input
              value={format.special_elements.sick}
              onChange={(e) =>
                setFormat({ special_elements: { ...format.special_elements, sick: e.target.value } })
              }
              className={ui.input}
            />
          </Field>
          <Field label="Element „Urlaub“">
            <input
              value={format.special_elements.vacation}
              onChange={(e) =>
                setFormat({
                  special_elements: { ...format.special_elements, vacation: e.target.value },
                })
              }
              className={ui.input}
            />
          </Field>
        </div>

        <p className="mt-5 mb-2 text-sm font-medium text-slate-700">Spalten-Mapping</p>
        <div className="grid grid-cols-7 gap-3">
          {(Object.keys(COLUMN_LABELS) as (keyof ColumnMapping)[]).map((key) => (
            <Field key={key} label={COLUMN_LABELS[key]}>
              <select
                value={format.columns[key]}
                onChange={(e) => setColumn(key, Number(e.target.value))}
                className={ui.input}
              >
                {COLUMN_OPTIONS.map((i) => (
                  <option key={i} value={i}>
                    {columnLetter(i)}
                  </option>
                ))}
              </select>
            </Field>
          ))}
        </div>

        <p className="mt-5 mb-1 text-sm font-medium text-slate-700">Billable-Spalte (optional)</p>
        <p className={`mb-2 ${ui.hint}`}>
          Ist sie gesetzt, entscheidet die Spalte, ob eine Buchung aufs Projekt abgerechnet wird
          (billable ohne passende Regel → „Billable laut Export“ zum vollen Satz). Satz-Anteil, Mult
          und USt. kommen weiter aus der Regel; Abweichungen zu den Regeln werden angezeigt.
        </p>
        <p className={`mb-2 ${ui.hint}`}>
          <strong className="font-medium">Wahrheitswerte werden automatisch erkannt:</strong> WAHR/FALSCH
          bzw. TRUE/FALSE (als Excel-Wahrheitswert oder Text). Eigene Werte nur angeben, wenn die
          Spalte anderen Text enthält (z. B. „ja“/„nein“). Leere und unbekannte Werte gelten als nicht
          billable – mit Hinweis und den gefundenen Werten.
        </p>
        <div className="grid grid-cols-3 gap-3 lg:w-2/3">
          <Field label="Spalte">
            <select
              aria-label="Billable-Spalte"
              value={format.billable ? String(format.billable.column) : ""}
              onChange={(e) =>
                setFormat({
                  billable:
                    e.target.value === ""
                      ? null
                      : {
                          yes: format.billable?.yes ?? "",
                          no: format.billable?.no ?? "",
                          column: Number(e.target.value),
                        },
                })
              }
              className={ui.input}
            >
              <option value="">– nicht verwenden –</option>
              {COLUMN_OPTIONS.map((i) => (
                <option key={i} value={i}>
                  {columnLetter(i)}
                </option>
              ))}
            </select>
          </Field>
          {format.billable && (
            <>
              <Field label="Eigener Wert „billable“ (optional)">
                <input
                  aria-label="Wert billable"
                  placeholder="z. B. ja"
                  value={format.billable.yes}
                  onChange={(e) => setFormat({ billable: { ...format.billable!, yes: e.target.value } })}
                  className={ui.input}
                />
              </Field>
              <Field label="Eigener Wert „nicht billable“ (optional)">
                <input
                  aria-label="Wert nicht billable"
                  placeholder="z. B. nein"
                  value={format.billable.no}
                  onChange={(e) => setFormat({ billable: { ...format.billable!, no: e.target.value } })}
                  className={ui.input}
                />
              </Field>
            </>
          )}
        </div>
      </fieldset>

      {!isNew && onDelete && (
        <div className="flex justify-end">
          {confirmDelete ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-red-700">Projekt „{initial.name}“ wirklich löschen?</span>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className={ui.secondaryButton}
              >
                Nein
              </button>
              <button
                type="button"
                onClick={remove}
                disabled={saving}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                Ja, löschen
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="text-sm text-red-600 hover:underline"
            >
              Projekt löschen
            </button>
          )}
        </div>
      )}
    </form>
  );
}
