import { render, screen } from "@testing-library/react";
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
});
