import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleResult } from "../../test/fixture";
import { ResultsView } from "./ResultsView";

const text = () => document.body.textContent!.replace(/\u00a0|\u202f/g, " ");

describe("ResultsView", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 1, 9, 0, 0)); // 01.11.2026
  });
  afterEach(() => vi.useRealTimers());

  function setup() {
    const onCutoffChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ResultsView result={sampleResult()} elementFilter="P100 Lager-App" busy={false} onCutoffChange={onCutoffChange} />,
    );
    return { user, onCutoffChange };
  }

  it("zeigt Kopf, fehlende und hervorgehobene Buchungen", () => {
    setup();
    expect(screen.getByText("Auswertung 01.01.2026 – 31.10.2026")).toBeInTheDocument();
    expect(text()).toContain("Stand des Exports: 31.10.2026 (aus Dateiname)");
    expect(text()).toContain("! 2 fehlende Buchungen");
    expect(text()).toContain("Fehlende Buchung – keine Buchung");
    expect(text()).toContain("Fehlende Buchung – nur 33,33 % gebucht");
    expect(text()).toContain("1 hervorgehobene Buchung(en) – werden mitgezählt");
    expect(text()).toContain("Sa, 25.07.2026");
  });

  it("setzt den Stichtag über Schnellwahl und Datumsfeld", async () => {
    const { user, onCutoffChange } = setup();
    await user.click(screen.getByRole("button", { name: "Heute" }));
    expect(onCutoffChange).toHaveBeenLastCalledWith("2026-11-01");
    await user.click(screen.getByRole("button", { name: "Ende Vormonat" }));
    expect(onCutoffChange).toHaveBeenLastCalledWith("2026-10-31");
    await user.click(screen.getByRole("button", { name: "Stand des Exports" }));
    expect(onCutoffChange).toHaveBeenLastCalledWith("2026-10-31");
    const dayBefore = screen.getByRole("button", { name: "Vortag des Exports" });
    expect(dayBefore.title).toMatch(/^30\.10\.2026 – der Export entsteht meist morgens/);
    await user.click(dayBefore);
    expect(onCutoffChange).toHaveBeenLastCalledWith("2026-10-30");
  });

  it("wechselt Tabs und Personen", async () => {
    const { user } = setup();
    const tabs = screen.getByRole("tablist");

    await user.click(within(tabs).getByRole("tab", { name: "Monate" }));
    expect(screen.getByText("! 1 fehlende Buchung")).toBeInTheDocument(); // Erika, Oktober
    await user.click(screen.getByRole("button", { name: "Max Mustermann" }));
    expect(screen.getByText("⚑ 1")).toBeInTheDocument(); // Urlaub am Samstag im Juli

    await user.click(within(tabs).getByRole("tab", { name: "Wochen" }));
    expect(screen.getAllByText("KW 43").length).toBeGreaterThan(0);

    await user.click(within(tabs).getByRole("tab", { name: "Stundenkonto" }));
    expect(screen.getAllByText("Max Mustermann hat Überstunden")).toHaveLength(2);

    await user.click(within(tabs).getByRole("tab", { name: "Arbeitsort" }));
    expect(text()).toContain("93,5 %");
    await user.click(screen.getByRole("button", { name: "Team gesamt" }));
    expect(text()).toContain("Personentage");

    await user.click(within(tabs).getByRole("tab", { name: /^Rechnung/ }));
    expect(screen.getByText("Netto pro Person und Monat")).toBeInTheDocument();

    await user.click(within(tabs).getByRole("tab", { name: "Import" }));
    expect(screen.getByText("Personen")).toBeInTheDocument();
    expect(text()).toContain("Jonas Beispiel");
  });

  it("weist auf ein fehlendes Team hin", () => {
    const r = sampleResult();
    r.persons = [];
    render(<ResultsView result={r} elementFilter="" busy onCutoffChange={() => {}} />);
    expect(screen.getByText(/kein Team hinterlegt/)).toBeInTheDocument();
  });
});

describe("ResultsView – Einsatzzeitraum und Buchungen außerhalb des Teams", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 1, 9, 0, 0));
  });
  afterEach(() => vi.useRealTimers());

  it("zeigt den Warnkasten ganz oben und ein Warnzeichen am Rechnungs-Tab", () => {
    render(<ResultsView result={sampleResult()} elementFilter="P100 Lager-App" busy={false} onCutoffChange={() => {}} />);
    const box = screen.getByRole("alert", { name: "Buchungen außerhalb des Teams" });
    // vor allen anderen Hinweisen und vor den Tabs
    expect(box.compareDocumentPosition(screen.getByRole("tablist")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(screen.getByRole("tab", { name: /^Rechnung/ })).getByText("⚠ 2")).toHaveClass("bg-red-600");
  });

  it("graut Monate außerhalb des Einsatzzeitraums aus und markiert die Übergabe", async () => {
    const user = userEvent.setup();
    render(<ResultsView result={sampleResult()} elementFilter="P100 Lager-App" busy={false} onCutoffChange={() => {}} />);
    await user.click(screen.getByRole("tab", { name: "Monate" }));
    await user.click(screen.getByRole("button", { name: "Lena Beispiel" }));

    // ohne die Monate im Filter „darf buchen“
    const row = (month: string) => screen.getByText(month, { ignore: "script, style, option" }).closest("tr")!;
    expect(within(row("Februar 2026")).queryByText("nicht im Projekt")).toBeNull();
    expect(within(row("April 2026")).getByText("nicht im Projekt")).toBeInTheDocument();
    expect(row("April 2026")).toHaveClass("text-slate-400");
    expect(within(row("März 2026")).getByText("⚠ 1 außerhalb des Teams")).toHaveAttribute(
      "title",
      expect.stringContaining("Lena Beispiel: 2,00 h auf P100 Lager-App (außerhalb Einsatzzeitraum, abgerechnet)"),
    );

    // Team: auch Jonas (nicht im Team) im Oktober
    await user.click(screen.getByRole("button", { name: "Team gesamt" }));
    expect(within(row("Oktober 2026")).getByText("⚠ 1 außerhalb des Teams")).toBeInTheDocument();
  });

  it("nennt den Einsatzzeitraum in der Jahresübersicht", () => {
    render(<ResultsView result={sampleResult()} elementFilter="P100 Lager-App" busy={false} onCutoffChange={() => {}} />);
    const table = screen.getByText("Kennzahl").closest("table")!;
    expect(within(table).getByText("im Projekt: 01.01.2026–28.02.2026")).toBeInTheDocument();
  });
});

describe("ResultsView – Rolle „darf buchen“", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 1, 9, 0, 0));
  });
  afterEach(() => vi.useRealTimers());

  it("zeigt Buchungen neutral (nicht im Warnkasten) und als Spalte in der Rechnung", async () => {
    const user = userEvent.setup();
    render(<ResultsView result={sampleResult()} elementFilter="P100 Lager-App" busy={false} onCutoffChange={() => {}} />);
    const alert = screen.getByRole("alert", { name: "Buchungen außerhalb des Teams" });
    expect(alert).not.toHaveTextContent("Karl Beispiel");
    expect(screen.getByText(/Darf buchen \(ohne Zeiterfassung\)/).closest("details")).toHaveClass("bg-sky-50");
    // keine Person in der Jahresübersicht
    const year = screen.getByText("Kennzahl").closest("table")!;
    expect(within(year).queryByText("Karl Beispiel")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /^Rechnung/ }));
    const table = screen.getByText("Netto pro Person und Monat").nextElementSibling as HTMLElement;
    expect(within(table).getByText("Karl Beispiel").closest("th")).toHaveTextContent("darf buchen");
  });
});

describe("ResultsView – Prognose", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 1, 9, 0, 0));
  });
  afterEach(() => vi.useRealTimers());

  it("zeigt die Prognose im eigenen Tab", async () => {
    const user = userEvent.setup();
    render(<ResultsView result={sampleResult()} elementFilter="P100 Lager-App" busy={false} onCutoffChange={() => {}} />);
    await user.click(screen.getByRole("tab", { name: "Prognose" }));
    expect(screen.getByText("Prognose je Person")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Abgerechnet und Prognose kumuliert mit Richtwert und Budget/ })).toBeInTheDocument();
  });

  it("zeigt Insights im eigenen Tab", async () => {
    const user = userEvent.setup();
    render(<ResultsView result={sampleResult()} elementFilter="P100 Lager-App" busy={false} onCutoffChange={() => {}} />);
    await user.click(screen.getByRole("tab", { name: "Insights" }));
    expect(screen.getByText("Rekord-Monate (Team)")).toBeInTheDocument();
    expect(screen.getByText("Pace je Person")).toBeInTheDocument();
  });
});
