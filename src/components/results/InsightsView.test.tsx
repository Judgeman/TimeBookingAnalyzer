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
    expect(text(tile("Meiste Minusstunden (Krank = Fehlzeit)"))).toContain(
      "Februar 2026−15,50 hErika Mustermann −14,50 h · Max Mustermann −1,00 h",
    );
    expect(screen.queryByText("Meiste fehlende Buchungen")).not.toBeInTheDocument();
    expect(text(tile("Meistes Budget liegen gelassen"))).toContain("August 2026−5.442,50 €24.557,50 € statt 30.000,00 €");
    expect(text(tile("Meistes Budget abgerufen"))).toContain("Januar 2026+14.350,00 €");

    expect(text(tile("Ø Abruf je Monat"))).toContain("31.986,50 €106,6 % des Richtwerts (30.000,00 €)");
    expect(within(tile("Ø letzte 3 Monate")).getByLabelText("fallend")).toBeInTheDocument();
    expect(text(tile("Nötig je Restmonat (2)"))).toContain("20.067,50 €Prognose: 23.814,76 € je Monat");
    expect(screen.getByRole("img", { name: "Abweichung des Abrufs vom Richtwert je Monat" })).toBeInTheDocument();

    const paceTable = screen.getByText("Pace je Person").nextElementSibling as HTMLElement;
    const max = within(paceTable).getByText("Max Mustermann", { selector: "td" }).closest("tr")!;
    expect(text(max)).toContain("103,2 %");
    expect(text(max)).toContain("117 %");
    expect(within(max).getByLabelText("steigend")).toBeInTheDocument();
    expect(text(max)).toContain("+91,50 hzuletzt +83,50 h");
    expect(text(max)).toContain("+73,50 hzuletzt +65,50 h"); // Krank = Fehlzeit
    expect(text(max)).toContain("1,1 % · 11 T");
    expect(text(within(paceTable).getByText("Lena Beispiel", { selector: "td" }).closest("tr")!)).toContain("2 M.");
    expect(screen.getByText("Kennzahlen erklärt")).toBeInTheDocument();

    // Urlaub: Rest = Anspruch + Übertrag − genommen − geplant, Hinweis kurz vor Jahresende
    const vacation = screen.getByText("Urlaub 2026").nextElementSibling as HTMLElement;
    const erika = within(vacation).getByText("Erika Mustermann").closest("tr")!;
    expect(text(erika)).toBe("Erika Mustermann30 T2 T15 T5 T12 T");
    expect(text(screen.getByText(/Ohne Urlaubsanspruch 2026/))).toBe("Ohne Urlaubsanspruch 2026: Lena Beispiel");
    expect(text(hints)).toContain("Erika Mustermann: noch 12 Urlaubstage offen und nicht eingeplant – bis 31.12.2026 einplanen.");
    expect(text(hints)).toContain("Max Mustermann: noch 9 Urlaubstage offen");
  });

  it("fehlende Buchungen aktuell: bis zum Vortag des Exports, meiste zuerst", () => {
    render(<InsightsView result={sampleResult()} />);
    const section = screen.getByText("Fehlende Buchungen aktuell", { selector: "h3" }).closest("section")!;
    expect(text(section)).toContain("Bis 30.10.2026 (Vortag des Exports) – unabhängig vom Stichtag");
    const rows = within(section).getAllByRole("row").slice(1).map((row) => text(row));
    expect(rows).toEqual([
      "Erika Mustermann17,50 hDi, 20.10.2026",
      "Max Mustermann14,00 hDo, 22.10.2026",
    ]);
  });

  it("fehlende Buchungen aktuell: alles gebucht, viele Tage, ohne Angabe", () => {
    const r = sampleResult();
    r.missing_current = { checked_until: "2026-10-30", bookings: [] };
    const { unmount } = render(<InsightsView result={r} />);
    expect(text()).toContain("Alles gebucht bis 30.10.2026.");
    unmount();

    const many = sampleResult();
    many.missing_current!.bookings = Array.from({ length: 8 }, (_, i) => ({
      ...many.missing_current!.bookings[1],
      date: `2026-10-${String(19 + i).padStart(2, "0")}`,
    }));
    const second = render(<InsightsView result={many} />);
    expect(text()).toContain("Max Mustermann832,00 hMo, 26.10.2026 · ");
    expect(text()).toContain(" · +2 weitere");
    second.unmount();

    const none = sampleResult();
    none.missing_current = null;
    render(<InsightsView result={none} />);
    expect(screen.queryByText("Fehlende Buchungen aktuell", { selector: "h3" })).not.toBeInTheDocument();
  });

  it("Abruf je Monat: Budget wählen, alle Budgets oder eigener Zeitraum", () => {
    const r = sampleResult();
    const [b] = r.forecast.budgets;
    r.forecast.budgets = [
      { ...b, from: "2026-01", to: "2026-06", amount: 210_000, monthly_target: 35_000, month_count: 6 },
      { ...b, from: "2026-07", to: "2026-12", amount: 150_000, monthly_target: 25_000, month_count: 6 },
    ];
    render(<InsightsView result={r} />);
    expect(text()).toContain("Bezogen auf das aktuelle Budget Juli 2026 – Dezember 2026 · 150.000,00 €.");
    const select = screen.getByLabelText<HTMLSelectElement>("Zeitraum des Diagramms");
    const card = select.closest<HTMLElement>("div.rounded-xl")!;
    // Standard: das aktuelle (zuletzt begonnene) Budget
    expect(select.value).toBe("budget:1");
    expect([...select.options].map((o) => text(o))).toEqual([
      "Budget Januar 2026 – Juni 2026 · 210.000,00 €",
      "Budget Juli 2026 – Dezember 2026 · 150.000,00 €",
      "Alle Budgets",
      "Eigener Zeitraum …",
    ]);
    expect(text(card)).toContain(
      "4 Monate (Juli 2026 – Oktober 2026): 117.795,00 € abgerufen, Richtwert 100.000,00 € → +17.795,00 € (117,8 % des Richtwerts)",
    );

    fireEvent.change(select, { target: { value: "all" } });
    expect(text(card)).toContain("10 Monate (Januar 2026 – Oktober 2026): 319.865,00 € abgerufen, Richtwert 310.000,00 €");
    expect(within(card).getAllByRole("button", { name: /zum Richtwert/ })).toHaveLength(10);

    fireEvent.change(select, { target: { value: "range" } });
    const from = screen.getByLabelText("Zeitraum von");
    const to = screen.getByLabelText("Zeitraum bis");
    expect([from, to].map((i) => (i as HTMLInputElement).value)).toEqual(["2026-01", "2026-10"]);
    fireEvent.change(from, { target: { value: "2026-03" } });
    fireEvent.change(to, { target: { value: "2026-05" } });
    expect(text(card)).toContain("3 Monate (März 2026 – Mai 2026): 84.955,00 € abgerufen, Richtwert 105.000,00 €");
    expect(text(card)).toContain("Monate ohne Budget haben keinen Richtwert und fehlen.");
    fireEvent.change(to, { target: { value: "" } }); // geleertes Feld ändert nichts
    fireEvent.change(from, { target: { value: "2025-01" } });
    fireEvent.change(to, { target: { value: "2025-02" } });
    expect(text(card)).toContain("Keine abgeschlossenen Monate mit Budget in diesem Zeitraum.");
  });

  it("Urlaub ohne Anspruch und überzogen", () => {
    const r = sampleResult();
    r.vacation = [];
    const { unmount } = render(<InsightsView result={r} />);
    expect(text()).toContain("Kein Urlaubsanspruch hinterlegt");
    unmount();
    const over = sampleResult();
    over.vacation = [{ ...over.vacation[1], planned: 20, remaining: -3 }];
    render(<InsightsView result={over} />);
    const row = within(screen.getByText("Urlaub 2026").nextElementSibling as HTMLElement).getByText("-3 T");
    expect(row).toHaveClass("text-red-700");
    expect(text()).toContain("Max Mustermann: 3 Urlaubstage mehr genommen bzw. geplant als Anspruch 2026.");
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

  it("über mehrere Jahre mit Jahr, bei vielen Monaten nur jede zweite Beschriftung", () => {
    const month = (key: string) => ({ month: key, actual: 100, target: 90, diff: 10 });
    const labels = () =>
      [...document.querySelectorAll("svg text")].map((t) => t.textContent).filter((t) => /^[A-ZÄÖÜ][a-zäöü]{2}/.test(t!));
    const { rerender } = render(
      <DeviationChart months={["2025-11", "2025-12", "2026-01", "2026-02"].map(month)} ariaLabel="A" />,
    );
    expect(labels()).toEqual(["Nov 25", "Dez", "Jan 26", "Feb"]);
    const keys = Array.from({ length: 36 }, (_, i) => `${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`);
    rerender(<DeviationChart months={keys.map(month)} ariaLabel="A" />);
    expect(labels()).toHaveLength(18);
    expect(labels().slice(0, 7)).toEqual(["Jan 24", "Mär", "Mai", "Jul", "Sep", "Nov", "Jan 25"]);
  });
});
