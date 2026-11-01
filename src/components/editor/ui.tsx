import type { ReactNode } from "react";

/** Gemeinsame Bausteine und Klassen der Editor-Formulare. */
export const ui = {
  card: "rounded-xl border border-slate-200 bg-white p-5",
  legend: "px-1 text-sm font-semibold text-slate-800",
  input:
    "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:ring-2 focus:ring-slate-200 focus:outline-none",
  inputSm:
    "w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-slate-500 focus:ring-2 focus:ring-slate-200 focus:outline-none",
  primaryButton:
    "rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50",
  secondaryButton:
    "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50",
  addButton: "text-sm font-medium text-slate-600 hover:text-slate-900",
  removeButton: "rounded px-2 text-slate-400 hover:bg-red-50 hover:text-red-600",
  hint: "text-xs text-slate-500",
};

export function Field({
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
      {hint && <span className={`mt-1 block ${ui.hint}`}>{hint}</span>}
    </label>
  );
}

/** Zahl aus einem Eingabefeld; leer → `fallback`. */
export function numberOf(value: string, fallback = 0): number {
  if (value.trim() === "") return fallback;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}
