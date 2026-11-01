import { describe, expect, it } from "vitest";
import type { AuswertungResult } from "../types/results";
import fixture from "./fixtures/sample-result.json";
import { sampleResult } from "./fixture";

/** Literal-Unions wie "file_name" erscheinen im JSON als einfacher string. */
type Widen<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T extends null
        ? null
        : T extends (infer U)[]
          ? Widen<U>[]
          : T extends object
            ? { [K in keyof T]: Widen<T[K]> }
            : T;

// Vertragstest (Typecheck): Erwartet das Frontend ein Feld, das Rust nicht
// liefert, schlägt `npm run build` / `tsc` hier fehl.
const contract: Widen<AuswertungResult> = fixture;

const sum = (values: number[]) => Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100;

describe("Vertrag Rust ↔ Frontend (Beispieldaten)", () => {
  it("enthält die erwarteten Grunddaten", () => {
    const r = sampleResult();
    expect(contract.project_name).toBe("Musterkunde GmbH / Lager-App");
    expect(r.cutoff_date).toBe("2026-10-31");
    expect(r.export_date_source).toMatch(/^(file_name|modified)$/);
    expect(r.persons.map((p) => p.name)).toEqual(["Erika Mustermann", "Max Mustermann"]);
  });

  it("Team-Werte sind die Summe der Personen", () => {
    const r = sampleResult();
    for (const key of ["soll_b", "gearb", "bill_h", "bill_eur", "missing_days"] as const) {
      expect(r.team.ytd[key]).toBeCloseTo(sum(r.persons.map((p) => p.ytd[key])), 2);
    }
  });

  it("Monate ergeben das Jahr, aufgeklappte Wochen den Monat", () => {
    const r = sampleResult();
    for (const person of r.persons) {
      expect(sum(Object.values(person.by_month).map((m) => m.gearb))).toBeCloseTo(person.ytd.gearb, 2);
      for (const [month, weeks] of Object.entries(person.month_weeks)) {
        expect(sum(Object.values(weeks).map((w) => w.soll_b))).toBeCloseTo(
          person.by_month[month].soll_b,
          2,
        );
      }
    }
  });

  it("Arbeitsorte summieren sich zu „Gearbeitet“ und zu 100 %", () => {
    for (const person of sampleResult().persons) {
      expect(sum(person.locations.ytd.map((l) => l.hours))).toBeCloseTo(person.ytd.gearb, 2);
      expect(sum(person.locations.ytd.map((l) => l.share))).toBeCloseTo(100, 0);
    }
  });

  it("Rechnung: Jahressumme = Summe der Monatsrechnungen, Brutto = Netto + USt.", () => {
    const { invoice } = sampleResult();
    expect(invoice.total.net).toBeCloseTo(sum(invoice.months.map((m) => m.net)), 2);
    expect(invoice.total.vat).toBeCloseTo(sum(invoice.months.map((m) => m.vat)), 2);
    for (const month of invoice.months) {
      expect(month.gross).toBeCloseTo(month.net + month.vat, 2);
      expect(month.net).toBeCloseTo(sum(month.lines.map((l) => l.net)), 2);
    }
  });

  it("listet fehlende und hervorgehobene Buchungen", () => {
    const r = sampleResult();
    expect(r.missing.map((m) => [m.person, m.date])).toEqual([
      ["Erika Mustermann", "2026-10-20"],
      ["Max Mustermann", "2026-10-22"],
    ]);
    expect(r.flagged.map((f) => [f.person, f.date, f.kind])).toEqual([
      ["Max Mustermann", "2026-07-25", "vacation"],
    ]);
  });
});
