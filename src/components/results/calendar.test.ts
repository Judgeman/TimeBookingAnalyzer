import { describe, expect, it } from "vitest";
import type { BookingDetail } from "../../types/results";
import { clock, hourRange, layoutDay, minutesOf, shiftWeek, timed, weekDays } from "./calendar";

function booking(start: string | null, end: string | null, hours = 1): BookingDetail {
  return {
    person: "Erika Mustermann",
    date: "2026-11-09",
    start,
    end,
    hours,
    mult: 1,
    element: "P100 Lager-App",
    kost2art: "Delivery (billable)",
    location: "Büro",
    description: "",
    kind: "work",
    invoiced: true,
  };
}

describe("Wochenkalender – Hilfen", () => {
  it("Uhrzeiten in Minuten und zurück", () => {
    expect(minutesOf("08:30:00")).toBe(510);
    expect(minutesOf(null)).toBeNull();
    expect(minutesOf("kaputt")).toBeNull();
    expect(clock(510)).toBe("08:30");
    expect(clock(1440)).toBe("24:00");
    expect(clock(0)).toBe("00:00");
  });

  it("Buchung mit Uhrzeit; über Mitternacht bis Tagesende, ohne Ende aus der Dauer", () => {
    expect(timed(booking("08:00:00", "09:30:00"))).toMatchObject({ from: 480, to: 570 });
    expect(timed(booking("22:00:00", "01:00:00", 3))).toMatchObject({ from: 1320, to: 1440 });
    expect(timed(booking("10:00:00", null, 1.5))).toMatchObject({ from: 600, to: 690 });
    expect(timed(booking(null, null))).toBeNull();
  });

  it("überlappende Buchungen nebeneinander, getrennte Gruppen einzeln", () => {
    const items = [
      booking("08:00:00", "10:00:00"),
      booking("09:00:00", "11:00:00"),
      booking("10:00:00", "10:30:00"), // passt in Spalte 1 nach 08–10
      booking("12:00:00", "13:00:00"), // eigene Gruppe
    ].map((b) => timed(b)!);
    const placed = layoutDay(items).map((p) => [clock(p.from), p.lane, p.lanes]);
    expect(placed).toEqual([
      ["08:00", 0, 2],
      ["09:00", 1, 2],
      ["10:00", 0, 2],
      ["12:00", 0, 1],
    ]);
    expect(layoutDay([])).toEqual([]);
  });

  it("Stundenbereich mindestens 07–18 Uhr, erweitert um Buchungen", () => {
    expect(hourRange([])).toEqual([7, 18]);
    expect(hourRange([timed(booking("06:15:00", "07:00:00"))!, timed(booking("19:00:00", "20:30:00"))!])).toEqual([6, 21]);
    expect(hourRange([timed(booking("22:00:00", "02:00:00", 4))!])).toEqual([7, 24]);
  });

  it("Wochen verschieben und Tage einer Woche", () => {
    expect(shiftWeek("2026-W46", 1)).toBe("2026-W47");
    expect(shiftWeek("2026-W01", -1)).toBe("2025-W52");
    expect(shiftWeek("2026-W53", 1)).toBe("2027-W01");
    expect(weekDays("2026-W46")).toEqual([
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
      "2026-11-14",
      "2026-11-15",
    ]);
  });
});
