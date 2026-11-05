import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { BillableMismatch } from "../../types/results";
import { BillableMismatches } from "./BillableMismatches";

const plain = (text: string | null) => text!.replace(/\s/g, " ");

// wie im Beispiel-Export mit Billable-Spalte
const mismatches: BillableMismatch[] = [
  {
    person: "Karl Beispiel", date: "2026-02-10", element: "P100 Lager-App", kost2art: "Management",
    hours: 3, billable: true, rule: null, net: 360,
  },
  {
    person: "Erika Mustermann", date: "2026-09-12", element: "P100 Lager-App", kost2art: "Delivery (billable)",
    hours: 4, billable: false, rule: "Delivery", net: 420,
  },
];

describe("BillableMismatches", () => {
  it("fasst die Abweichungen zusammen und listet sie aufgeklappt", async () => {
    const user = userEvent.setup();
    render(<BillableMismatches mismatches={mismatches} />);
    const summary = screen.getByText(/Billable-Spalte weicht bei 2 Buchungen/).closest("summary")!;
    expect(plain(summary.textContent)).toBe(
      "⚑ Billable-Spalte weicht bei 2 Buchungen von den Abrechnungsregeln ab (es gilt die Spalte): " +
        "3,00 h zusätzlich abgerechnet (+360,00 € netto) · 4,00 h nicht abgerechnet (−420,00 € laut Regel)",
    );
    await user.click(summary);
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1).map((r) => plain(r.textContent));
    expect(rows).toEqual([
      "Di, 10.02.2026Karl BeispielP100 Lager-App · Management3,00billablekeine passende Regel+360,00 € abgerechnet",
      "Sa, 12.09.2026Erika MustermannP100 Lager-App · Delivery (billable)4,00nicht billableDelivery−420,00 € nicht abgerechnet",
    ]);
  });

  it("filtert nach Person, Monat und Richtung", async () => {
    const user = userEvent.setup();
    render(<BillableMismatches mismatches={[...mismatches, { ...mismatches[1], date: "2026-09-19", kost2art: "" }]} />);
    await user.click(screen.getByText(/Billable-Spalte weicht bei 3 Buchungen/));
    const rows = () => within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows()).toHaveLength(3);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Abweichungen Person"), "Erika Mustermann");
    expect(rows()).toHaveLength(2);
    expect(plain(screen.getByRole("status").textContent)).toBe(
      "Auswahl: 2 von 3 · 8,00 h nicht abgerechnet (−840,00 € laut Regel)",
    );
    expect(plain(rows()[1].textContent)).toContain("P100 Lager-App · –");
    await user.selectOptions(screen.getByLabelText("Abweichungen Richtung"), "billable");
    expect(plain(rows()[0].textContent)).toBe("Keine Abweichungen für diese Auswahl.");
    expect(plain(screen.getByRole("status").textContent)).toBe("Auswahl: 0 von 3 · keine");

    await user.click(screen.getByRole("button", { name: "Filter zurücksetzen" }));
    await user.selectOptions(screen.getByLabelText("Abweichungen Monat"), "2026-02");
    expect(rows()).toHaveLength(1);
    expect(plain(rows()[0].textContent)).toContain("Karl Beispiel");
    await user.selectOptions(screen.getByLabelText("Abweichungen Richtung"), "not");
    expect(rows()).toHaveLength(1);
    expect(plain(rows()[0].textContent)).toBe("Keine Abweichungen für diese Auswahl.");
  });
});
