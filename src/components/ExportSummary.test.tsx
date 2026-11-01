import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { sampleResult } from "../test/fixture";
import { ExportSummary } from "./ExportSummary";

describe("ExportSummary (Import)", () => {
  it("zeigt Zeitraum, Personen und Vorschau", () => {
    render(<ExportSummary result={sampleResult().overview} elementFilter="P100 Lager-App" />);
    expect(screen.getByText("02.01.2026 – 30.10.2026")).toBeInTheDocument();
    expect(screen.getByText("676")).toBeInTheDocument();
    // Personen-Tabelle (erste Fundstelle): Nicht-Teammitglieder ausgegraut
    expect(screen.getAllByText("Jonas Beispiel")[0].closest("tr")).toHaveClass("text-slate-400");
    expect(screen.getByText(/Erste 25 von 676 Buchungen/)).toBeInTheDocument();
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
