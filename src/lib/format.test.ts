import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clampRange,
  columnLetter,
  endOfPreviousMonth,
  fileNameOf,
  formatDate,
  formatDateWithWeekday,
  formatEuro,
  formatHours,
  formatMonth,
  formatNumber,
  formatPercent,
  formatRange,
  formatSignedHours,
  formatWeek,
  isoWeekKey,
  isoWeekRange,
  monthRange,
  todayIso,
} from "./format";

// Intl setzt zwischen Betrag und € ein geschütztes Leerzeichen.
const nbsp = (s: string) => s.replace(/\u00a0|\u202f/g, " ");

describe("Zahlen", () => {
  it("formatiert Stunden, Zahlen, Euro und Prozent deutsch", () => {
    expect(formatHours(1234.5)).toBe("1.234,50");
    expect(formatHours(0)).toBe("0,00");
    expect(formatNumber(2.5)).toBe("2,5");
    expect(formatNumber(1000)).toBe("1.000");
    expect(nbsp(formatEuro(350661.91))).toBe("350.661,91 €");
    expect(formatPercent(19.79)).toBe("19,8 %");
    expect(formatPercent(100)).toBe("100 %");
  });

  it("zeigt Vorzeichen bei Plus/Minus", () => {
    expect(formatSignedHours(12.5)).toBe("+12,50");
    expect(formatSignedHours(-3)).toBe("−3,00");
    expect(formatSignedHours(0)).toBe("0,00");
  });
});

describe("Datum", () => {
  afterEach(() => vi.useRealTimers());

  it("formatiert ISO-Daten ohne Zeitzonen-Effekte", () => {
    expect(formatDate("2026-10-05")).toBe("05.10.2026");
    expect(formatDate(null)).toBe("–");
    expect(formatDate(undefined)).toBe("–");
    expect(formatDateWithWeekday("2026-07-25")).toBe("Sa, 25.07.2026");
    expect(formatDateWithWeekday("2026-10-19")).toBe("Mo, 19.10.2026");
  });

  it("benennt Monate und Kalenderwochen", () => {
    expect(formatMonth("2026-10")).toBe("Oktober 2026");
    expect(formatMonth("2026-01")).toBe("Januar 2026");
    expect(formatWeek("2026-W43")).toBe("KW 43");
    expect(formatWeek("2026-W05")).toBe("KW 5");
  });

  it("berechnet ISO-Kalenderwochen wie das Backend (inkl. Jahreswechsel)", () => {
    expect(isoWeekKey("2026-01-01")).toBe("2026-W01");
    expect(isoWeekKey("2026-10-19")).toBe("2026-W43");
    expect(isoWeekKey("2027-01-01")).toBe("2026-W53");
    expect(isoWeekKey("2024-12-30")).toBe("2025-W01");
    expect(isoWeekKey("2021-01-03")).toBe("2020-W53");
  });

  it("liefert Wochen- und Monatsgrenzen", () => {
    expect(isoWeekRange("2026-W43")).toEqual(["2026-10-19", "2026-10-25"]);
    expect(isoWeekRange("2026-W01")).toEqual(["2025-12-29", "2026-01-04"]);
    expect(monthRange("2026-02")).toEqual(["2026-02-01", "2026-02-28"]);
    expect(monthRange("2028-02")).toEqual(["2028-02-01", "2028-02-29"]);
    expect(clampRange(["2025-12-29", "2026-01-04"], ["2026-01-01", "2026-12-31"])).toEqual([
      "2026-01-01",
      "2026-01-04",
    ]);
    expect(formatRange("2026-10-01", "2026-10-04")).toBe("01.10.–04.10.");
    expect(formatRange("2026-10-01", "2026-10-01")).toBe("01.10.");
  });

  it("bestimmt heute und das Ende des Vormonats", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 15, 10, 0, 0));
    expect(todayIso()).toBe("2026-01-15");
    expect(endOfPreviousMonth("2026-01-15")).toBe("2025-12-31");
    expect(endOfPreviousMonth("2026-03-01")).toBe("2026-02-28");
  });
});

describe("Sonstiges", () => {
  it("wandelt Spaltenindizes in Buchstaben", () => {
    expect(columnLetter(0)).toBe("A");
    expect(columnLetter(13)).toBe("N");
    expect(columnLetter(26)).toBe("AA");
    expect(columnLetter(51)).toBe("AZ");
  });

  it("schneidet Dateinamen aus Pfaden (Windows und Unix)", () => {
    expect(fileNameOf("C:\\Exporte\\export.xlsx")).toBe("export.xlsx");
    expect(fileNameOf("/home/u/export.xlsx")).toBe("export.xlsx");
    expect(fileNameOf("export.xlsx")).toBe("export.xlsx");
  });
});
