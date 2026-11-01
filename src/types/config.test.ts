import { describe, expect, it } from "vitest";
import { COLUMN_LABELS, REGIONS, defaultBillingRules, defaultExportFormat, newProject } from "./config";
import sampleProject from "../../sample-data/beispiel-projekt.json";

describe("Projekt-Vorgaben", () => {
  it("legt neue Projekte mit den Standardwerten des Backends an", () => {
    const p = newProject();
    expect(p.id).toBe("");
    expect(p.vat_percent).toBe(19);
    expect(p.missing_threshold_percent).toBe(50);
    expect(p.holidays).toEqual({ region: "HE", custom: [] });
    expect(p.export_format).toEqual(defaultExportFormat());
    expect(p.billing_rules).toEqual(defaultBillingRules());
  });

  it("Standardregeln und Spalten entsprechen der Beispielkonfiguration", () => {
    const rules = defaultBillingRules();
    expect(rules.map((r) => [r.kost2art, r.match_mode, r.billable_hours, r.invoice])).toEqual([
      ["Delivery (billable)", "exact", true, true],
      ["(billable)", "contains", false, true],
    ]);
    expect(sampleProject.export_format).toEqual(defaultExportFormat());
    expect(Object.keys(COLUMN_LABELS)).toEqual(Object.keys(defaultExportFormat().columns));
  });

  it("kennt alle 16 Bundesländer", () => {
    expect(REGIONS).toHaveLength(16);
    expect(REGIONS.map(([code]) => code)).toContain("HE");
  });
});
