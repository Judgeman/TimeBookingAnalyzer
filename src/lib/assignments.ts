import type { AssignmentPeriod } from "../types/config";
import { formatDate } from "./format";

/** "01.01.2026–28.02.2026", "ab 01.10.2026"; mehrere durch Komma getrennt; leer → null. */
export function describeAssignments(assignments: AssignmentPeriod[]): string | null {
  if (assignments.length === 0) return null;
  return assignments
    .map((a) => (a.to ? `${formatDate(a.from)}–${formatDate(a.to)}` : `ab ${formatDate(a.from)}`))
    .join(", ");
}

/** Überschneidet sich der Zeitraum [from, to] (ISO) mit einem Einsatzzeitraum? Leer = immer. */
export function overlapsAssignments(assignments: AssignmentPeriod[], [from, to]: [string, string]): boolean {
  if (assignments.length === 0) return true;
  return assignments.some((a) => a.from <= to && (a.to === null || a.to >= from));
}
