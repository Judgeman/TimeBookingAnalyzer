import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { sampleResult } from "../../test/fixture";
import type { BookingDetail } from "../../types/results";
import { WeekCalendar } from "./WeekCalendar";

const text = (el: Element) => el.textContent!.replace(/\s/g, " ");

function props(person: string | null) {
  const result = sampleResult();
  return {
    bookings: result.bookings,
    persons: result.persons.map((p) => p.name),
    person,
    holidays: result.holidays,
    missing: result.missing,
    cutoff: "2026-10-23",
    initialWeek: "2026-W43",
  };
}

const day = (date: string) => document.querySelectorAll(`[data-day="${date}"]`);

describe("WeekCalendar", () => {
  it("Person: Tage Mo–So, Blöcke mit Uhrzeit, Summe, fehlende Buchung, nach dem Stichtag", () => {
    render(<WeekCalendar {...props("Erika Mustermann")} />);
    const calendar = screen.getByRole("region", { name: "Wochenkalender" });
    expect(screen.queryByRole("status")).not.toBeInTheDocument(); // alle mit Uhrzeit
    expect(within(calendar).getByRole("heading")).toHaveTextContent(
      "KW 43 · 19.10.2026 – 25.10.2026",
    );
    for (const label of ["Mo. 19.10.", "Di. 20.10.", "Sa. 24.10.", "So. 25.10."]) {
      expect(within(calendar).getByText(label)).toBeInTheDocument();
    }
    expect(within(calendar).getAllByText("nach dem Stichtag")).toHaveLength(2); // Sa, So
    expect(text(calendar)).toContain("Erika Mustermann: 32,75 h gebucht");
    // Freitag: zwei Blöcke, ganztags-Summe
    const [allDay, grid] = day("2026-10-23");
    expect(text(allDay)).toContain("Gebucht 8,00 h");
    const blocks = within(grid as HTMLElement).getAllByRole("note");
    expect(blocks.map(text)).toEqual([
      "08:00 – 14:30P100 Lager-AppHome OfficeEntwicklung",
      "15:00 – 16:30P100 Lager-AppHome OfficeAngebot Folgephase",
    ]);
    expect(blocks[0].title).toContain("Delivery (billable)\n6,50 h · abgerechnet");
    // Block-Position: 08:00 bei Raster ab 07:00 → 1 Stunde (56 px) + 1
    expect(blocks[0]).toHaveStyle({ top: "57px" });
    // Dienstag ohne Buchung → fehlende Buchung
    expect(text(day("2026-10-20")[0])).toContain("Fehlende Buchung");
  });

  it("Navigation zwischen Wochen und zurück zum Stichtag", async () => {
    const user = userEvent.setup();
    render(<WeekCalendar {...props("Max Mustermann")} />);
    await user.click(screen.getByRole("button", { name: "Vorige Woche" }));
    expect(screen.getByRole("heading")).toHaveTextContent("KW 42 · 12.10.2026 – 18.10.2026");
    await user.click(screen.getByRole("button", { name: "Woche des Stichtags" }));
    expect(screen.getByRole("heading")).toHaveTextContent("KW 43");
    expect(screen.queryByRole("button", { name: "Woche des Stichtags" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Nächste Woche" }));
    expect(screen.getByRole("heading")).toHaveTextContent("KW 44");
  });

  it("Team: je Person eine Zeile, Buchungen kompakt mit Uhrzeit", () => {
    render(<WeekCalendar {...props(null)} />);
    const rows = screen.getAllByRole("row");
    expect(rows.map((r) => within(r).queryByRole("rowheader")?.textContent ?? "header")).toEqual([
      "header",
      "Erika Mustermann32,75 h",
      "Max Mustermann34,00 h",
      "Lena Beispiel40,00 h",
    ]);
    expect(text(screen.getByRole("region"))).toContain("Team: 106,75 h gebucht");
    const lena = within(rows[3]).getAllByRole("cell")[0];
    expect(text(lena)).toBe("Gebucht 8,00 h08:00–16:00P200 Intranet");
    expect(lena.querySelector<HTMLElement>("[title]")!.title).toContain("nicht abgerechnet");
    expect(text(within(rows[1]).getAllByRole("cell")[1])).toBe("Fehlende Buchung");
  });

  it("Urlaub/Krank ganztags, Buchungen ohne Uhrzeit, Mult 0 gestrichelt, Feiertag", () => {
    const base: BookingDetail = {
      person: "Erika Mustermann",
      date: "2026-12-21",
      start: null,
      end: null,
      hours: 2,
      mult: 0,
      element: "Z900 Intern",
      kost2art: "Travel",
      location: "",
      description: "",
      kind: "work",
      invoiced: false,
    };
    render(
      <WeekCalendar
        bookings={[
          base,
          { ...base, date: "2026-12-22", kind: "vacation", hours: 8, element: "(Vacation)" },
          { ...base, date: "2026-12-23", kind: "sick", hours: 4, element: "(Sick)" },
          { ...base, date: "2026-12-21", start: "21:00:00", end: "23:00:00", mult: 1 },
        ]}
        persons={["Erika Mustermann"]}
        person="Erika Mustermann"
        holidays={[{ date: "2026-12-25", name: "1. Weihnachtstag" }]}
        missing={[]}
        cutoff="2026-12-31"
        initialWeek="2026-W52"
      />,
    );
    expect(text(day("2026-12-21")[0])).toBe("Gebucht 4,00 h2,00 h Z900 Intern");
    expect(day("2026-12-21")[0].querySelector(".border-dashed")).not.toBeNull();
    expect(text(day("2026-12-22")[0])).toBe("Urlaub 8,00 h");
    expect(screen.getByRole("status")).toHaveTextContent(
      "1 Buchung dieser Woche ohne Beginn/Ende – sie stehen bei „ganztags“.",
    );
    expect(text(day("2026-12-23")[0])).toBe("Krank 4,00 h");
    expect(screen.getByText("1. Weihnachtstag")).toBeInTheDocument();
    // Raster bis 23 Uhr wegen der Buchung um 21–23 Uhr (letzte Zeile 22:00)
    expect(screen.getByText("22:00")).toBeInTheDocument();
    expect(screen.queryByText("23:00")).not.toBeInTheDocument();
    expect(screen.getByText("21:00 – 23:00")).toBeInTheDocument();
  });
});
