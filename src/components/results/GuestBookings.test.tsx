import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { sampleResult } from "../../test/fixture";
import type { GuestBooking } from "../../types/results";
import { GuestBookings } from "./GuestBookings";

const text = () => document.body.textContent!.replace(/ | /g, " ");

describe("GuestBookings (darf buchen)", () => {
  it("fasst Buchungen neutral zusammen und zeigt sie aufgeklappt einzeln", async () => {
    const user = userEvent.setup();
    render(<GuestBookings bookings={sampleResult().guest_bookings} />);
    const summary = screen.getByText(/Darf buchen \(ohne Zeiterfassung\)/).closest("summary")!;
    expect(summary.textContent!.replace(/ | /g, " ")).toBe(
      "ℹ Darf buchen (ohne Zeiterfassung): 9,00 h aufs Projekt · 4,00 h abgerechnet (480,00 € netto) · 5,00 h nicht abgerechnet",
    );
    expect(summary.closest("details")).not.toHaveAttribute("open");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.click(summary);
    expect(screen.getAllByText("keine passende Regel")).toHaveLength(2);
    expect(text()).toContain("abgerechnet: 480,00 €");
    expect(screen.getAllByText("nicht abgerechnet")).toHaveLength(2);
    expect(text()).toContain("Di, 16.06.2026");
  });

  it("zeigt Summen je Person, wenn mehrere Personen buchen", () => {
    const booking = (person: string, hours: number, invoiced: boolean): GuestBooking => ({
      person,
      date: "2026-05-05",
      element: "P100 Lager-App",
      kost2art: invoiced ? "Delivery (billable)" : "",
      hours,
      rule: invoiced ? "Delivery" : null,
      invoiced,
      billed_hours: invoiced ? hours : 0,
      net: invoiced ? hours * 100 : 0,
    });
    render(
      <GuestBookings
        bookings={[booking("Karl Beispiel", 2, true), booking("Petra Beispiel", 1, false)]}
      />,
    );
    expect(text()).toContain("Karl Beispiel: 2,00 h aufs Projekt · 2,00 h abgerechnet (200,00 € netto)");
    expect(text()).toContain("Petra Beispiel: 1,00 h aufs Projekt · 1,00 h nicht abgerechnet");
    expect(text()).toContain("P100 Lager-App · –");
  });

  it("filtert nach Person, Monat und abgerechnet", async () => {
    const user = userEvent.setup();
    const result = sampleResult();
    const [feb, jun, sep] = result.guest_bookings;
    const bookings: GuestBooking[] = [feb, { ...jun, person: "Lena Beispiel", date: "2026-05-04" }, jun, sep];
    render(<GuestBookings bookings={bookings} persons={result.persons} />);
    await user.click(screen.getByText(/Darf buchen \(ohne Zeiterfassung\)/));
    const rows = () =>
      within(screen.getByRole("table")).getAllByRole("row").slice(1).map((r) => r.textContent!.replace(/\s/g, " "));
    const status = () => screen.getByRole("status").textContent!.replace(/\s/g, " ");
    expect(rows()).toHaveLength(4);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    const month = screen.getByLabelText<HTMLSelectElement>("Filter Monat");
    expect([...month.options].map((o) => o.textContent)).toEqual([
      "Alle Monate", "September 2026", "Juni 2026", "Mai 2026", "Februar 2026",
    ]);

    await user.selectOptions(screen.getByLabelText("Filter Person"), "Karl Beispiel");
    expect(rows()).toHaveLength(3);
    expect(status()).toBe(
      "Auswahl: 3 von 4 Buchungen · 9,00 h aufs Projekt · 4,00 h abgerechnet (480,00 € netto) · 5,00 h nicht abgerechnet",
    );
    await user.selectOptions(screen.getByLabelText("Filter abgerechnet"), "no");
    expect(rows().map((r) => r.slice(0, 14))).toEqual(["Di, 10.02.2026", "Di, 22.09.2026"]);
    expect(status()).toBe("Auswahl: 2 von 4 Buchungen · 5,00 h aufs Projekt · 5,00 h nicht abgerechnet");
    await user.selectOptions(month, "2026-06");
    expect(rows()).toEqual(["Keine Buchungen für diese Auswahl."]);

    await user.click(screen.getByRole("button", { name: "Filter zurücksetzen" }));
    expect(rows()).toHaveLength(4);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Filter abgerechnet"), "yes");
    expect(rows().map((r) => r.slice(0, 14))).toEqual(["Mo, 04.05.2026", "Di, 16.06.2026"]);
  });

  it("kennzeichnet Teammitglieder, die außerhalb ihres Einsatzes buchen dürfen", async () => {
    const user = userEvent.setup();
    const result = sampleResult();
    const lena = result.persons.find((p) => p.name === "Lena Beispiel")!;
    const bookings: GuestBooking[] = [
      ...result.guest_bookings,
      { ...result.guest_bookings[0], person: lena.name, date: "2026-05-04" },
    ];
    render(<GuestBookings bookings={bookings} persons={result.persons} />);
    await user.click(screen.getByText(/Darf buchen \(ohne Zeiterfassung\)/));
    const badges = screen.getAllByText("außerhalb Einsatz");
    expect(badges).toHaveLength(1);
    expect(badges[0].closest("td")).toHaveTextContent("Lena Beispiel");
    expect(badges[0]).toHaveAttribute("title", "Team – im Projekt: 01.01.2026–28.02.2026");
  });
});
