import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { sampleResult } from "../../test/fixture";
import { OutsideBookings } from "./OutsideBookings";

const text = (el: HTMLElement) => el.textContent!.replace(/ | /g, " ");

describe("OutsideBookings", () => {
  it("fällt sofort auf und erklärt, was abgerechnet wird und was nicht", () => {
    const r = sampleResult();
    render(<OutsideBookings outside={r.outside} persons={r.persons} />);
    const box = screen.getByRole("alert", { name: "Buchungen außerhalb des Teams" });
    expect(box).toHaveClass("border-red-500");
    expect(text(box)).toContain("2 Buchungen auf das Projekt außerhalb des Teams");
    expect(text(box)).toContain("2,00 h außerhalb des Einsatzzeitraums – abgerechnet (160,00 € netto)");
    expect(text(box)).toContain("3,00 h von Personen, die nicht im Team sind – nicht abgerechnet");

    const lena = within(box).getByText("Lena Beispiel").closest("tr")!;
    expect(text(lena)).toContain("außerhalb Einsatzzeitraum");
    expect(text(lena)).toContain("im Projekt: 01.01.2026–28.02.2026");
    expect(text(lena)).toContain("abgerechnet: 160,00 €");
    const jonas = within(box).getByText("Jonas Beispiel").closest("tr")!;
    expect(text(jonas)).toContain("nicht im Team");
    expect(text(jonas)).toContain("nicht abgerechnet");
    expect(text(jonas)).toContain("P100 Lager-App · Delivery (billable)");
  });
});
