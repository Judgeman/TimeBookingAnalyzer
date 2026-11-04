import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { sampleResult } from "../../test/fixture";
import { DeviationChart } from "./DeviationChart";
import { InsightsView } from "./InsightsView";
import { teamPace } from "./insights";

const text = (el: Element = document.body) => el.textContent!.replace(/ | /g, " ");
const tile = (label: string) => screen.getByText(label).closest("div")!;

describe("InsightsView", () => {
  it("zeigt Hinweise, Rekord-Monate, Team-Pace und Pace je Person", () => {
    render(<InsightsView result={sampleResult()} />);
    expect(text()).toContain("abgeschlossene Monate Januar 2026 – Oktober 2026");
    const hints = screen.getByRole("region", { name: "Hinweise" });
    expect(text(hints)).toContain("Das Team ruft 107 % des Richtwerts ab – bei diesem Tempo wird das Budget um 7.495 € überzogen.");
    expect(text(hints)).toContain("Max Mustermann: +91,5 h Überstunden – Abbau einplanen.");

    expect(text(tile("Meiste Krankheitstage"))).toContain("Oktober 20263 TageMax Mustermann 3 Tage");
    expect(text(tile("Meiste Urlaubstage"))).toContain("Juli 2026");
    expect(text(tile("Meiste Überstunden"))).toContain("+54,50 h");
    expect(text(tile("Meiste Minusstunden"))).toContain("−0,75 h");
    expect(text(tile("Meistes Budget liegen gelassen"))).toContain("August 2026−5.442,50 €24.557,50 € statt 30.000,00 €");
    expect(text(tile("Meistes Budget abgerufen"))).toContain("Januar 2026+14.350,00 €");

    expect(text(tile("Ø Abruf je Monat"))).toContain("31.986,50 €106,6 % des Richtwerts (30.000,00 €)");
    expect(within(tile("Ø letzte 3 Monate")).getByLabelText("fallend")).toBeInTheDocument();
    expect(text(tile("Nötig je Restmonat (2)"))).toContain("20.067,50 €Prognose: 23.814,76 € je Monat");
    expect(screen.getByRole("img", { name: "Abweichung des Abrufs vom Richtwert je Monat" })).toBeInTheDocument();

    const max = screen.getByText("Max Mustermann", { selector: "td" }).closest("tr")!;
    expect(text(max)).toContain("103,2 %");
    expect(text(max)).toContain("117 %");
    expect(within(max).getByLabelText("steigend")).toBeInTheDocument();
    expect(text(max)).toContain("+91,50 hzuletzt +83,50 h");
    expect(text(max)).toContain("1,1 % · 11 T");
    expect(text(screen.getByText("Lena Beispiel", { selector: "td" }).closest("tr")!)).toContain("2 M.");
    expect(screen.getByText("Kennzahlen erklärt")).toBeInTheDocument();
  });

  it("ohne Budget: Höchster/niedrigster Abruf statt Budget-Rekorden", () => {
    const r = sampleResult();
    r.forecast.budgets = [];
    render(<InsightsView result={r} />);
    expect(text(tile("Höchster Abruf"))).toContain("Januar 202644.350,00 €");
    expect(text(tile("Niedrigster Abruf"))).toContain("August 202624.557,50 €");
    expect(screen.queryByText("Ø Abruf je Monat")).not.toBeInTheDocument();
    expect(screen.getByText("Abrechnungsquote Team")).toBeInTheDocument();
  });

  it("ohne abgeschlossenen Monat nur ein Hinweis", () => {
    const r = sampleResult();
    r.forecast.from = "2026-01-10";
    render(<InsightsView result={r} />);
    expect(screen.getByText(/Noch kein abgeschlossener Monat/)).toBeInTheDocument();
  });
});

describe("DeviationChart", () => {
  it("beschriftet die Extreme und zeigt Werte bei Hover und Fokus", () => {
    const pace = teamPace(sampleResult())!;
    const { rerender, container } = render(<DeviationChart months={pace.months} ariaLabel="Abweichung" />);
    expect(text(screen.getByRole("img", { name: "Abweichung" }))).toContain("+14.350 €");
    expect(text(screen.getByRole("img", { name: "Abweichung" }))).toContain("-5.443 €");
    const august = screen.getByRole("button", { name: /August 2026: -5\.443\s€ zum Richtwert/ });
    fireEvent.pointerEnter(august);
    expect(text(screen.getByRole("status"))).toContain("24.557,50 € abgerechnet30.000,00 € Richtwert-5.443 € liegen gelassen");
    fireEvent.pointerLeave(august);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.focus(screen.getByRole("button", { name: /Januar 2026/ }));
    expect(text(screen.getByRole("status"))).toContain("mehr abgerufen");
    fireEvent.blur(screen.getByRole("button", { name: /Januar 2026/ }));
    rerender(<DeviationChart months={[]} ariaLabel="Abweichung" />);
    expect(container.querySelector("svg")).toBeNull();
  });
});
