import { useState, type FormEvent, type ReactNode } from "react";
import {
  COLUMN_LABELS,
  type ColumnMapping,
  type HolidayConfig,
  type ProjectConfig,
  type TeamMember,
  type WorkingHoursPeriod,
} from "../types/config";
import { columnLetter } from "../lib/format";
import { errorMessage } from "../lib/api";

interface Props {
  initial: ProjectConfig;
  onSave: (config: ProjectConfig) => Promise<void>;
  onCancel: () => void;
  onDelete?: (id: string) => Promise<void>;
}

/** Spalten A … AZ zur Auswahl. */
const COLUMN_OPTIONS = Array.from({ length: 52 }, (_, i) => i);

interface Advanced {
  team: TeamMember[];
  working_hours: WorkingHoursPeriod[];
  holidays: HolidayConfig;
}

/**
 * Einfacher Projekt-Editor: Stammdaten und Export-Format als Formular,
 * Team/Arbeitszeiten/Feiertage vorerst als JSON. Datumswerte und Zeiträume
 * prüft das Backend beim Speichern.
 */
export function ProjectEditor({ initial, onSave, onCancel, onDelete }: Props) {
  const [draft, setDraft] = useState<ProjectConfig>(initial);
  const [advancedJson, setAdvancedJson] = useState(() =>
    JSON.stringify(
      { team: initial.team, working_hours: initial.working_hours, holidays: initial.holidays },
      null,
      2,
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isNew = initial.id === "";
  const format = draft.export_format;

  function setFormat(patch: Partial<ProjectConfig["export_format"]>) {
    setDraft((d) => ({ ...d, export_format: { ...d.export_format, ...patch } }));
  }

  function setColumn(key: keyof ColumnMapping, value: number) {
    setFormat({ columns: { ...format.columns, [key]: value } });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);

    let advanced: Advanced;
    try {
      advanced = parseAdvanced(advancedJson);
    } catch (e) {
      setError(`Team / Arbeitszeiten / Feiertage: ${errorMessage(e)}`);
      return;
    }

    setSaving(true);
    try {
      await onSave({ ...draft, ...advanced });
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
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{isNew ? "Neues Projekt" : "Projekt bearbeiten"}</h2>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className={secondaryButton}>
            Abbrechen
          </button>
          <button type="submit" disabled={saving} className={primaryButton}>
            {saving ? "Speichere …" : "Speichern"}
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm whitespace-pre-line text-red-800">
          {error}
        </p>
      )}

      <fieldset className={card}>
        <legend className={legend}>Projekt</legend>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Projektname">
            <input
              required
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Musterkunde GmbH / Lager-App"
              className={input}
            />
          </Field>
          <Field label="Element-Filter" hint="Wert der Element-Spalte, der zum Projekt gehört">
            <input
              value={draft.element_filter}
              onChange={(e) => setDraft({ ...draft, element_filter: e.target.value })}
              placeholder="P100 Lager-App"
              className={input}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className={card}>
        <legend className={legend}>Export-Format</legend>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Tabellenblatt">
            <input
              required
              value={format.sheet_name}
              onChange={(e) => setFormat({ sheet_name: e.target.value })}
              className={input}
            />
          </Field>
          <Field label="Element „Krank“">
            <input
              value={format.special_elements.sick}
              onChange={(e) =>
                setFormat({ special_elements: { ...format.special_elements, sick: e.target.value } })
              }
              className={input}
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
              className={input}
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
                className={input}
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
      </fieldset>

      <fieldset className={card}>
        <legend className={legend}>Team, Arbeitszeiten &amp; Feiertage</legend>
        <p className="mb-2 text-sm text-slate-500">
          Vorläufig als JSON. Datumswerte im Format <code>YYYY-MM-DD</code>, offenes Ende ={" "}
          <code>null</code>.
        </p>
        <textarea
          value={advancedJson}
          onChange={(e) => setAdvancedJson(e.target.value)}
          spellCheck={false}
          rows={16}
          className={`${input} font-mono text-xs leading-5`}
        />
      </fieldset>

      {!isNew && onDelete && (
        <div className="flex justify-end">
          {confirmDelete ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-red-700">Projekt „{initial.name}“ wirklich löschen?</span>
              <button type="button" onClick={() => setConfirmDelete(false)} className={secondaryButton}>
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

function parseAdvanced(json: string): Advanced {
  const value: unknown = JSON.parse(json);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Erwartet wird ein Objekt mit team, working_hours und holidays.");
  }
  const { team = [], working_hours = [], holidays } = value as Partial<Advanced>;
  if (!Array.isArray(team)) throw new Error("„team“ muss eine Liste sein.");
  if (!Array.isArray(working_hours)) throw new Error("„working_hours“ muss eine Liste sein.");
  if (holidays !== undefined && (typeof holidays !== "object" || holidays === null)) {
    throw new Error("„holidays“ muss ein Objekt sein.");
  }
  return { team, working_hours, holidays: holidays ?? { region: "HE", custom: [] } };
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

const card = "rounded-xl border border-slate-200 bg-white p-5";
const legend = "px-1 text-sm font-semibold text-slate-800";
const input =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:ring-2 focus:ring-slate-200 focus:outline-none";
const primaryButton =
  "rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50";
const secondaryButton =
  "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50";
