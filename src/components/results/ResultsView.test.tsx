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

    await user.click(within(tabs).getByRole("tab", { name: "Rechnung" }));
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
