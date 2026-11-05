import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { sampleResult } from "../test/fixture";
import { ExportSummary } from "./ExportSummary";

describe("ExportSummary (Import)", () => {
  it("zeigt Zeitraum, Personen und Vorschau", () => {
    render(<ExportSummary result={sampleResult().overview} elementFilter="P100 Lager-App" />);
    expect(screen.getByText("02.01.2026 – 30.10.2026")).toBeInTheDocument();
    expect(screen.getByText("892")).toBeInTheDocument();
    // Personen-Tabelle (erste Fundstelle): Nicht-Teammitglieder ausgegraut,
    // „darf buchen“ gekennzeichnet
    expect(screen.getAllByText("Jonas Beispiel")[0].closest("tr")).toHaveClass("text-slate-400");
    const karl = screen.getAllByText("Karl Beispiel")[0].closest("tr")!;
    expect(karl).not.toHaveClass("text-slate-400");
    expect(karl).toHaveTextContent("darf buchen");
    expect(screen.getByText(/Erste 25 von 892 Buchungen/)).toBeInTheDocument();
    // ohne Billable-Spalte im Export-Format keine Spalte in der Vorschau
    expect(screen.queryByRole("columnheader", { name: "Billable" })).not.toBeInTheDocument();
  });

  it("zeigt die Billable-Spalte in der Vorschau, wenn sie gesetzt ist", () => {
    const overview = sampleResult().overview;
    overview.preview = overview.preview.slice(0, 3).map((entry, i) => ({ ...entry, billable: [true, false, null][i] }));
    render(<ExportSummary result={overview} elementFilter="P100 Lager-App" />);
    expect(screen.getByRole("columnheader", { name: "Billable" })).toBeInTheDocument();
    const rows = screen.getAllByRole("row").filter((r) => r.closest("tbody") && r.querySelectorAll("td").length === 8);
    expect(rows.map((r) => r.querySelectorAll("td")[7].textContent)).toEqual(["ja", "nein", "–"]);
  });

  it("warnt bei fehlenden Teammitgliedern, Element-Treffern und übersprungenen Zeilen", () => {
    const overview = sampleResult().overview;
    overview.missing_team_members = ["Lena Neu"];
    overview.element_match_count = 0;
    overview.skipped_rows = [{ row: 7, reason: "Spalte C (Datum): kein gültiges Datum" }];
    render(<ExportSummary result={overview} elementFilter="P999" />);
    expect(screen.getByText("Lena Neu")).toBeInTheDocument();
    expect(screen.getByText(/Keine Buchung hat das Element „P999“/)).toBeInTheDocument();
    expect(screen.getByText("1 Zeile wurde übersprungen")).toBeInTheDocument();
    expect(screen.getByText("Zeile 7: Spalte C (Datum): kein gültiges Datum")).toBeInTheDocument();
  });
});
