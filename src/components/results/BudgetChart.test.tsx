import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { sampleResult } from "../../test/fixture";
import { BudgetChart, monthLabels, niceTicks } from "./BudgetChart";
import { cumulativeSeries } from "./forecast";

const text = (el: Element) => el.textContent!.replace(/ | /g, " ");
const points = () => cumulativeSeries(sampleResult().forecast, "2026-01", "2026-12", 30_000);

describe("BudgetChart", () => {
  it("teilt die y-Achse rund", () => {
    expect(niceTicks(367_494)).toEqual([0, 100_000, 200_000, 300_000, 400_000]);
    expect(niceTicks(45_000)).toEqual([0, 20_000, 40_000, 60_000]);
    expect(niceTicks(0)).toEqual([0]);
  });

  it("beschriftet Monate mittig, bei vielen Monaten nur jeden n-ten", () => {
    const labels = monthLabels(points());
    expect(labels).toHaveLength(12);
    expect(labels[0]).toEqual({ date: "2026-01-15", label: "Jan" });
    const long = cumulativeSeries(sampleResult().forecast, "2026-01", "2026-12", null);
    // zwei Jahre → jeder zweite Monat, Jahreszahl beim Januar
    const twoYears = [...long, ...long.slice(1).map((p) => ({ ...p, month: p.month!.replace("2026", "2027") }))];
    const many = monthLabels(twoYears);
    expect(many).toHaveLength(12);
    expect(many[0].label).toBe("Jan 26");
    expect(many.map((l) => l.label)).toContain("Jan 27");
  });

  it("zeigt Legende, Budget-Linie, erwartetes Ende und Tooltip per Maus/Tastatur", () => {
    render(<BudgetChart points={points()} budget={360_000} ariaLabel="Budget-Verlauf" />);
    expect(screen.getByText("Richtwert (Budget ÷ Monate)")).toBeInTheDocument();
    const chart = screen.getByRole("img", { name: "Budget-Verlauf" });
    expect(text(chart)).toContain("Budget 360.000 €");
    expect(text(chart)).toContain("erwartet 367.495 €");

    fireEvent.pointerMove(chart, { clientX: 0 });
    expect(text(screen.getByRole("status"))).toContain("Ende Januar 2026");
    expect(text(screen.getByRole("status"))).toMatch(/44\.350,00 €\s*Abgerechnet/);
    fireEvent.pointerLeave(chart);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    fireEvent.focus(chart); // letzter Monat
    expect(text(screen.getByRole("status"))).toContain("Ende Dezember 2026");
    expect(text(screen.getByRole("status"))).toMatch(/367\.494,52 €\s*Ist \+ Prognose/);
    expect(text(screen.getByRole("status"))).toMatch(/360\.000,00 €\s*Richtwert/);
    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    expect(text(screen.getByRole("status"))).toContain("Ende November 2026");
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(text(screen.getByRole("status"))).toContain("Ende Dezember 2026");
    fireEvent.keyDown(chart, { key: "Enter" }); // ignoriert
    fireEvent.blur(chart);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("ohne Budget nur Abgerechnet/Prognose; zu wenige Punkte → nichts", () => {
    const withoutBudget = cumulativeSeries(sampleResult().forecast, "2026-01", "2026-12", null);
    const { container, rerender } = render(
      <BudgetChart points={withoutBudget} budget={null} ariaLabel="Verlauf" />,
    );
    expect(screen.queryByText("Richtwert (Budget ÷ Monate)")).not.toBeInTheDocument();
    expect(text(container)).not.toContain("Budget 360.000 €");
    rerender(<BudgetChart points={withoutBudget.slice(0, 1)} budget={null} ariaLabel="Verlauf" />);
    expect(container.querySelector("svg[role=img]")).toBeNull();
  });
});
