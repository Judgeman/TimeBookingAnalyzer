/**
 * Kategorische Farben (Referenzpalette des dataviz-Leitfadens, helles Theme),
 * feste Reihenfolge. Geprüft mit validate_palette.js (6 Slots, inkl. Paar
 * Slot 6 ↔ Slot 1 für die geschlossene Torte): alle Pflichtprüfungen bestanden;
 * Aqua/Gelb/Magenta < 3:1 Kontrast → Werte stehen zusätzlich in der Tabelle.
 */
export const SERIES_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"];

export const OTHER_LABEL = "Sonstige";

export interface ColorMap {
  /** Ort → Farbe (feste Zuordnung für die ganze Auswertung). */
  colors: Map<string, string>;
  /** Orte, die zu „Sonstige“ zusammengefasst werden. */
  folded: Set<string>;
}

/**
 * Farbe folgt dem Ort, nicht dem Rang: Zuordnung einmal aus der Team-Reihenfolge
 * (Jahr bis Stichtag), damit Personen-/Monatswechsel nichts umfärbt. Mehr als
 * sechs Orte → die kleinsten werden „Sonstige“ (Slot 6).
 */
export function colorMapFor(locationsByHours: string[]): ColorMap {
  const colors = new Map<string, string>();
  const folded = new Set<string>();
  const fits = locationsByHours.length <= SERIES_COLORS.length;
  locationsByHours.forEach((location, i) => {
    if (fits || i < SERIES_COLORS.length - 1) colors.set(location, SERIES_COLORS[i]);
    else folded.add(location);
  });
  if (folded.size > 0) colors.set(OTHER_LABEL, SERIES_COLORS[SERIES_COLORS.length - 1]);
  return { colors, folded };
}
