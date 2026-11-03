import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import sample from "../../../sample-data/beispiel-projekt.json";
import { sampleResult } from "../../test/fixture";
import type { PlannedAbsence } from "../../types/config";
import type { Forecast } from "../../types/results";
import { ForecastView } from "./ForecastView";

const text = () => document.body.textContent!.replace(/ | /g, " ");
const absences = sample.planned_absences as PlannedAbsence[];

describe("ForecastView", () => {
  it("zeigt laufenden Monat, Budget-Überziehung, Faktoren und Abwesenheiten", () => {
    render(<ForecastView forecast={sampleResult().forecast} plannedAbsences={absences} />);
    expect(text()).toContain("Prognose ab 01.11.2026 bis 31.12.2026");
    expect(text()).toContain("Faktoren je Person aus 01.01.2026 – 31.10.2026");
    // laufender Monat
    const november = screen.getByText("Rechnung November 2026 (laufender Monat)").parentElement!;
    expect(november.textContent!.replace(/ /g, " ")).toContain("23.362,30 €");
    // Budget
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Voraussichtliche Überziehung");
    expect(status.textContent!.replace(/ /g, " ")).toContain("7.494,52 € über Budget zum Ende Dezember 2026");
    expect(status).toHaveTextContent("aufgebraucht am 17.12.2026");
    expect(text()).toContain("88,9 % des Budgets · +19.865,00 € zum Richtwert");
    expect(text()).toContain("+7.494,52 € zum Budget");
    // Monatstabelle mit Richtwert
    const december = screen.getByText("Dezember 2026").closest("tr")!;
    expect(december.textContent!.replace(/ /g, " ")).toContain("360.000,00 €");
    expect(within(december).getByText(/\+7\.494,52/)).toHaveClass("text-red-700");
    // Personen
    const erika = screen.getByText("Erika Mustermann", { selector: "td" }).closest("tr")!;
    expect(erika).toHaveTextContent("1,3 %");
    expect(erika).toHaveTextContent("3,4 %");
    expect(erika.textContent).toContain("5 T (37,50 h)");
    expect(within(erika).getByText("1,3 %")).toHaveAttribute("title", "20,00 h krank von 1.521,00 h verfügbar (Soll − Urlaub)");
    expect(screen.getByText("Max Mustermann", { selector: "td" }).closest("tr")!.textContent).toContain("8,5 T (51,00 h)");
    expect(screen.getByText("(im Zeitraum nicht im Einsatz)")).toBeInTheDocument();
    // Abwesenheiten, Hinweise, Rechenweg
    expect(text()).toContain("Max Mustermann: 13.11.2026 · Sonstiges (halbe Tage)");
    expect(text()).toContain("Erika Mustermann: 23.11.2026 – 27.11.2026 · Urlaub");
    expect(text()).toContain("„darf buchen“ werden nicht prognostiziert");
    expect(screen.getByText("So wird gerechnet")).toBeInTheDocument();
  });

  it("Budget reicht bzw. ist schon überschritten", () => {
    const forecast = sampleResult().forecast;
    forecast.budgets[0] = { ...forecast.budgets[0], amount: 400_000, deviation: -32_505.48, exhausted_on: null };
    const { rerender } = render(<ForecastView forecast={forecast} />);
    expect(screen.getByRole("status")).toHaveTextContent("Budget reicht voraussichtlich");
    expect(screen.getByRole("status").textContent!.replace(/ /g, " ")).toContain("32.505,48 € Rest zum Ende Dezember 2026");
    expect(screen.queryByText(/aufgebraucht am/)).not.toBeInTheDocument();

    const exceeded: Forecast = {
      ...forecast,
      budgets: [{ ...forecast.budgets[0], amount: 300_000, deviation: 67_494.52, exceeded: true }],
    };
    rerender(<ForecastView forecast={exceeded} />);
    expect(screen.getByRole("status")).toHaveTextContent("Budget bereits überschritten");
  });

  it("ohne Budget: Hinweis und Verlauf bis Jahresende; ohne Referenzdaten", () => {
    const forecast: Forecast = { ...sampleResult().forecast, budgets: [], reference_to: null, notes: [] };
    render(<ForecastView forecast={forecast} />);
    expect(screen.getByText("Verlauf bis Jahresende")).toBeInTheDocument();
    expect(text()).toContain("Kein Budget hinterlegt");
    expect(text()).toContain("Faktoren je Person aus – (keine Daten)");
    expect(screen.queryByText("Richtwert kumuliert")).not.toBeInTheDocument();
    expect(screen.queryByText("Geplante Abwesenheiten")).not.toBeInTheDocument();
  });

  it("wechselt zwischen mehreren Budget-Zeiträumen", async () => {
    const user = userEvent.setup();
    const forecast = sampleResult().forecast;
    const second = { ...forecast.budgets[0], from: "2026-07", to: "2026-12", amount: 150_000, month_count: 6, monthly_target: 25_000 };
    render(<ForecastView forecast={{ ...forecast, budgets: [forecast.budgets[0], second] }} />);
    // aktiv: der erste Zeitraum, der den laufenden Monat (November) enthält
    expect(screen.getByText("Budget Januar 2026 – Dezember 2026")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "2026-07 – 2026-12" }));
    expect(screen.getByText("Budget Juli 2026 – Dezember 2026")).toBeInTheDocument();
    expect(screen.queryByText("Januar 2026")).not.toBeInTheDocument();
  });
});
