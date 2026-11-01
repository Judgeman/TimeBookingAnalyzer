import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { sampleResult } from "../../test/fixture";
import { colorMapFor } from "./chartColors";
import { LocationView } from "./LocationView";

function setup(personIndex = 0) {
  const r = sampleResult();
  const colorMap = colorMapFor(r.team.locations.ytd.map((s) => s.location));
  const person = r.persons[personIndex];
  render(<LocationView name={person.name} data={person} colorMap={colorMap} isTeam={false} />);
  return { r, colorMap };
}

describe("LocationView (Arbeitsort)", () => {
  it("zeigt Home-Office-Anteil, Torte und Tabelle", () => {
    setup();
    expect(screen.getByText(/Home-Office-Anteil/)).toBeInTheDocument();
    expect(screen.getByText("20,2 %", { selector: "dd" })).toBeInTheDocument();
    const svg = screen.getByRole("img");
    expect(svg.getAttribute("aria-label")).toContain("Home Office 20,2 %");
    expect(svg.querySelectorAll("path, circle")).toHaveLength(3);
    expect(screen.getByText("Gesamt (= Gearbeitet)").closest("tr")!.textContent).toContain("1.542,00");
  });

  it("wechselt den Zeitraum über Auswahl und Monatsverlauf", async () => {
    const user = userEvent.setup();
    setup();
    await user.selectOptions(screen.getByRole("combobox"), "2026-10");
    expect(screen.getByText("Arbeitsorte · Erika Mustermann · Oktober 2026")).toBeInTheDocument();
    await user.click(screen.getByText("März 2026", { selector: "td" }));
    expect(screen.getByText("Arbeitsorte · Erika Mustermann · März 2026")).toBeInTheDocument();
  });

  it("hebt beim Überfahren die Scheibe hervor und zeigt einen Tooltip", () => {
    setup();
    const slice = screen.getByRole("img").querySelector("path")!;
    fireEvent.mouseEnter(slice);
    fireEvent.mouseMove(slice, { clientX: 10, clientY: 10 });
    expect(screen.getByText(/^Büro: 1\.226,00 h · 79,5 % · 152 Tage$/)).toBeInTheDocument();
    fireEvent.mouseLeave(screen.getByRole("img"));
    expect(screen.queryByText(/^Büro: 1\.226,00 h/)).not.toBeInTheDocument();
  });

  it("zeigt einen Hinweis, wenn nichts gearbeitet wurde", () => {
    const r = sampleResult();
    const person = { ...r.persons[0], locations: { ytd: [], by_month: {} } };
    render(<LocationView name="X" data={person} colorMap={colorMapFor([])} isTeam />);
    expect(screen.getByText("Keine gearbeiteten Stunden im Zeitraum.")).toBeInTheDocument();
  });
});
