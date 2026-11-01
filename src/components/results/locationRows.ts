import type { LocationShare } from "../../types/results";
import { OTHER_LABEL, type ColorMap } from "./chartColors";

/** Orte, die als Home Office gelten (für die Kennzahl oben). */
export const HOME_OFFICE = /home|remote|mobil/i;

export interface LocationRow {
  key: string;
  label: string;
  hours: number;
  share: number;
  days: number;
  color: string;
}

/** Fasst Orte außerhalb der Farbzuordnung zu „Sonstige“ zusammen. */
export function toRows(shares: LocationShare[], colorMap: ColorMap): LocationRow[] {
  const total = shares.reduce((sum, s) => sum + s.hours, 0);
  const rows: LocationRow[] = [];
  let other: LocationRow | null = null;
  for (const s of shares) {
    if (colorMap.folded.has(s.location) || !colorMap.colors.has(s.location)) {
      other ??= {
        key: OTHER_LABEL,
        label: OTHER_LABEL,
        hours: 0,
        share: 0,
        days: 0,
        color: colorMap.colors.get(OTHER_LABEL) ?? "#008300",
      };
      other.hours += s.hours;
      other.days += s.days;
    } else {
      rows.push({
        key: s.location,
        label: s.location,
        hours: s.hours,
        share: s.share,
        days: s.days,
        color: colorMap.colors.get(s.location)!,
      });
    }
  }
  if (other) {
    other.share = total > 0 ? (other.hours / total) * 100 : 0;
    rows.push(other);
  }
  return rows;
}

/** Orte, die als Home Office zählen (Name enthält „home“, „remote“ oder „mobil“). */
export function homeOfficeShares(shares: LocationShare[]): LocationShare[] {
  return shares.filter((s) => HOME_OFFICE.test(s.location));
}
