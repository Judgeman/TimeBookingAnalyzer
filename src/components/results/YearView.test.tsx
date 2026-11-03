import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { sampleResult } from "../../test/fixture";
import { YearView } from "./YearView";

describe("YearView", () => {
  it("zeigt Kennzahlen je Person und Team inkl. fehlender Buchungen", () => {
    const r = sampleResult();
    render(
      <YearView
        columns={[
          ...r.persons.map((p) => ({ name: p.name, data: p.ytd })),
          { name: "Team gesamt", data: r.team.ytd },
        ]}
      />,
    );
    const row = (label: string) => screen.getByText(label).closest("tr")!.textContent;
    expect(row("Soll brutto")).toContain("1.636,00");
    expect(row("Plus/Minus")).toContain("+41,00");
    expect(row("Fehlende Buchungen (Tage)")).toMatch(/1102$/); // Erika 1, Max 1, Lena 0, Team 2
    expect(screen.getByText("Gearbeitet").closest("td")).toHaveAttribute("title");
  });
});
