import { ui, numberOf } from "./ui";

interface Period {
  from: string;
  to: string | null;
}

interface Props<T extends Period, K extends keyof T & string> {
  items: T[];
  onChange: (items: T[]) => void;
  /** Feld mit dem Zahlenwert, z. B. "rate" oder "hours_per_day". */
  valueKey: K;
  valueLabel: string;
  step?: number;
  /** Vorlage für einen neuen Zeitraum. */
  create: () => T;
  emptyText: string;
  addLabel: string;
}

/** Liste von Zeiträumen (Von/Bis/Wert); Bis leer = unbefristet. */
export function PeriodListEditor<T extends Period, K extends keyof T & string>({
  items,
  onChange,
  valueKey,
  valueLabel,
  step = 0.01,
  create,
  emptyText,
  addLabel,
}: Props<T, K>) {
  const update = (index: number, patch: Partial<T>) =>
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  return (
    <div className="space-y-2">
      {items.length === 0 ? (
        <p className={ui.hint}>{emptyText}</p>
      ) : (
        <div className="grid grid-cols-[1fr_1fr_8rem_auto] items-center gap-2 text-xs text-slate-500">
          <span>Von</span>
          <span>Bis (leer = offen)</span>
          <span>{valueLabel}</span>
          <span />
          {items.map((item, index) => (
            <PeriodRow
              key={index}
              item={item}
              value={item[valueKey] as unknown as number}
              step={step}
              onFrom={(from) => update(index, { from } as Partial<T>)}
              onTo={(to) => update(index, { to } as Partial<T>)}
              onValue={(v) => update(index, { [valueKey]: v } as unknown as Partial<T>)}
              onRemove={() => onChange(items.filter((_, i) => i !== index))}
            />
          ))}
        </div>
      )}
      <button type="button" onClick={() => onChange([...items, create()])} className={ui.addButton}>
        + {addLabel}
      </button>
    </div>
  );
}

function PeriodRow({
  item,
  value,
  step,
  onFrom,
  onTo,
  onValue,
  onRemove,
}: {
  item: Period;
  value: number;
  step: number;
  onFrom: (v: string) => void;
  onTo: (v: string | null) => void;
  onValue: (v: number) => void;
  onRemove: () => void;
}) {
  return (
    <>
      <input
        type="date"
        required
        value={item.from}
        onChange={(e) => onFrom(e.target.value)}
        className={ui.inputSm}
      />
      <input
        type="date"
        value={item.to ?? ""}
        min={item.from || undefined}
        onChange={(e) => onTo(e.target.value || null)}
        className={ui.inputSm}
      />
      <input
        type="number"
        min={0}
        step={step}
        required
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => onValue(numberOf(e.target.value))}
        className={`${ui.inputSm} text-right`}
      />
      <button type="button" onClick={onRemove} className={ui.removeButton} title="Zeitraum entfernen">
        ✕
      </button>
    </>
  );
}

interface RangeProps {
  items: Period[];
  onChange: (items: Period[]) => void;
  create: () => Period;
  emptyText: string;
  addLabel: string;
}

/** Liste von Zeiträumen ohne Wert (nur Von/Bis), z. B. Einsatzzeiträume. */
export function RangeListEditor({ items, onChange, create, emptyText, addLabel }: RangeProps) {
  const update = (index: number, patch: Partial<Period>) =>
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  return (
    <div className="space-y-2">
      {items.length === 0 ? (
        <p className={ui.hint}>{emptyText}</p>
      ) : (
        <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-2 text-xs text-slate-500">
          <span>Von</span>
          <span>Bis (leer = offen)</span>
          <span />
          {items.map((item, index) => (
            <RangeRow
              key={index}
              item={item}
              onFrom={(from) => update(index, { from })}
              onTo={(to) => update(index, { to })}
              onRemove={() => onChange(items.filter((_, i) => i !== index))}
            />
          ))}
        </div>
      )}
      <button type="button" onClick={() => onChange([...items, create()])} className={ui.addButton}>
        + {addLabel}
      </button>
    </div>
  );
}

function RangeRow({
  item,
  onFrom,
  onTo,
  onRemove,
}: {
  item: Period;
  onFrom: (v: string) => void;
  onTo: (v: string | null) => void;
  onRemove: () => void;
}) {
  return (
    <>
      <input
        type="date"
        required
        value={item.from}
        onChange={(e) => onFrom(e.target.value)}
        className={ui.inputSm}
        aria-label="Einsatz von"
      />
      <input
        type="date"
        value={item.to ?? ""}
        min={item.from || undefined}
        onChange={(e) => onTo(e.target.value || null)}
        className={ui.inputSm}
        aria-label="Einsatz bis"
      />
      <button type="button" onClick={onRemove} className={ui.removeButton} title="Einsatzzeitraum entfernen">
        ✕
      </button>
    </>
  );
}
