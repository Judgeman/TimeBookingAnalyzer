import type { BookingDetail } from "../../types/results";
import { isoWeekKey, isoWeekRange } from "../../lib/format";

/** „08:30:00“ → 510 Minuten seit Mitternacht; `null` → `null`. */
export function minutesOf(time: string | null): number | null {
  if (!time) return null;
  const [h, m] = time.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}

/** 510 → „08:30“. */
export function clock(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  const pad = (n: number) => String(n).padStart(2, "0");
  return minutes >= 1440 && m === 0 ? "24:00" : `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** Buchung mit Uhrzeit: Beginn und Ende in Minuten (über Mitternacht → bis 24:00). */
export interface Timed {
  booking: BookingDetail;
  from: number;
  to: number;
}

export function timed(booking: BookingDetail): Timed | null {
  const from = minutesOf(booking.start);
  if (from === null) return null;
  let to = minutesOf(booking.end) ?? from + Math.round(booking.hours * 60);
  if (to <= from) to = 1440; // über Mitternacht: im Kalender bis Tagesende
  return { booking, from, to: Math.max(to, from + 1) };
}

export interface Placed extends Timed {
  /** Spalte innerhalb überlappender Buchungen (0-basiert) … */
  lane: number;
  /** … und Anzahl der Spalten dieser Gruppe. */
  lanes: number;
}

/** Überlappende Buchungen eines Tages nebeneinander anordnen. */
export function layoutDay(items: Timed[]): Placed[] {
  const sorted = [...items].sort((a, b) => a.from - b.from || b.to - a.to);
  const placed: Placed[] = [];
  let group: Placed[] = [];
  let groupEnd = -1;
  let laneEnds: number[] = [];
  const closeGroup = () => {
    const lanes = Math.max(1, laneEnds.length);
    for (const item of group) item.lanes = lanes;
    group = [];
    laneEnds = [];
  };
  for (const item of sorted) {
    if (item.from >= groupEnd) closeGroup();
    let lane = laneEnds.findIndex((end) => end <= item.from);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(item.to);
    } else {
      laneEnds[lane] = item.to;
    }
    const entry: Placed = { ...item, lane, lanes: 1 };
    group.push(entry);
    placed.push(entry);
    groupEnd = Math.max(groupEnd, item.to);
  }
  closeGroup();
  return placed;
}

/** Sichtbarer Stundenbereich: mindestens 07–18 Uhr, erweitert um alle Buchungen. */
export function hourRange(items: Timed[]): [number, number] {
  let from = 7;
  let to = 18;
  for (const item of items) {
    from = Math.min(from, Math.floor(item.from / 60));
    to = Math.max(to, Math.ceil(item.to / 60));
  }
  return [from, Math.min(24, to)];
}

/** Woche um `delta` Wochen verschieben („2026-W46“ → „2026-W47“). */
export function shiftWeek(key: string, delta: number): string {
  const [monday] = isoWeekRange(key);
  const [y, m, d] = monday.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + delta * 7));
  return isoWeekKey(date.toISOString().slice(0, 10));
}

/** Die sieben Tage (ISO-Datum) einer Woche, Montag zuerst. */
export function weekDays(key: string): string[] {
  const [monday] = isoWeekRange(key);
  const [y, m, d] = monday.split("-").map(Number);
  return Array.from({ length: 7 }, (_, i) =>
    new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10),
  );
}
