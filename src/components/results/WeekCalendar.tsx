import { useState } from "react";
import type { BookingDetail, Holiday, MissingBooking } from "../../types/results";
import { formatDate, formatHours, formatNumber, formatWeek } from "../../lib/format";
import { clock, hourRange, layoutDay, shiftWeek, timed, weekDays, type Timed } from "./calendar";

/** Höhe einer Stunde im Zeitraster (px). */
const HOUR_PX = 56;
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

interface Props {
  bookings: BookingDetail[];
  /** Personen in Anzeigereihenfolge (Team-Ansicht). */
  persons: string[];
  /** Ausgewählte Person; `null` = Team. */
  person: string | null;
  holidays: Holiday[];
  /** Fehlende Buchungen (rot markiert). */
  missing: MissingBooking[];
  /** Stichtag – spätere Tage sind nicht ausgewertet. */
  cutoff: string;
  /** Woche, die zuerst angezeigt wird (die des Stichtags). */
  initialWeek: string;
}

const isWork = (b: BookingDetail) => b.kind === "work";

function color(b: BookingDetail): string {
  const base = b.invoiced
    ? "border-indigo-300 bg-indigo-50 text-indigo-950"
    : "border-slate-300 bg-slate-50 text-slate-800";
  return b.mult > 0 ? base : `${base} border-dashed`;
}

function describe(b: BookingDetail): string {
  const t = timed(b);
  return [
    `${t ? `${clock(t.from)} – ${clock(t.to)} · ` : ""}${b.element || "(ohne Element)"}`,
    b.kost2art,
    `${formatHours(b.hours)} h${b.mult !== 1 ? ` × Mult ${formatNumber(b.mult)}` : ""} · ${
      b.invoiced ? "abgerechnet" : "nicht abgerechnet"
    }`,
    b.location && `Ort: ${b.location}`,
    b.description,
  ]
    .filter(Boolean)
    .join("\n");
}

const sumHours = (list: BookingDetail[]) => list.reduce((sum, b) => sum + b.hours, 0);

/** „2026-11-09“ (Index 0) → „Mo. 9.11.“ */
function dayLabel(iso: string, index: number): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${WEEKDAYS[index]}. ${d}.${m}.`;
}

/**
 * Woche Mo–So als Kalender: je Person Buchungen als Blöcke im Zeitraster
 * (überlappende nebeneinander), im Team je Person eine Zeile.
 */
export function WeekCalendar({
  bookings,
  persons,
  person,
  holidays,
  missing,
  cutoff,
  initialWeek,
}: Props) {
  const [week, setWeek] = useState(initialWeek);
  const days = weekDays(week);
  const holidayNames = new Map(holidays.map((h) => [h.date, h.name]));
  const inWeek = bookings.filter(
    (b) => b.date >= days[0] && b.date <= days[6] && (person === null || b.person === person),
  );
  const shade = (day: string, index: number) =>
    day > cutoff ? "bg-slate-100" : index >= 5 || holidayNames.has(day) ? "bg-slate-50" : "bg-white";
  const isMissing = (who: string, day: string) =>
    missing.some((m) => m.person === who && m.date === day);
  const note = (day: string) =>
    day > cutoff ? "nach dem Stichtag" : (holidayNames.get(day) ?? null);

  return (
    <section aria-label="Wochenkalender" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-label="Vorige Woche"
          onClick={() => setWeek(shiftWeek(week, -1))}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-sm hover:bg-slate-50"
        >
          ‹
        </button>
        <h3 className="text-sm font-semibold">
          {formatWeek(week)} · {formatDate(days[0])} – {formatDate(days[6])}
        </h3>
        <button
          type="button"
          aria-label="Nächste Woche"
          onClick={() => setWeek(shiftWeek(week, 1))}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-sm hover:bg-slate-50"
        >
          ›
        </button>
        {week !== initialWeek && (
          <button
            type="button"
            onClick={() => setWeek(initialWeek)}
            className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600 hover:bg-slate-200"
          >
            Woche des Stichtags
          </button>
        )}
        <span className="ml-auto text-sm text-slate-500">
          {person ?? "Team"}: {formatHours(sumHours(inWeek.filter(isWork)))} h gebucht
        </span>
      </div>

      {person === null ? (
        <TeamWeek
          days={days}
          bookings={inWeek}
          persons={persons}
          note={note}
          shade={shade}
          isMissing={isMissing}
        />
      ) : (
        <PersonWeek
          days={days}
          bookings={inWeek}
          note={note}
          shade={shade}
          isMissing={(day) => isMissing(person, day)}
        />
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        <Swatch className="border-indigo-300 bg-indigo-50">abgerechnet</Swatch>
        <Swatch className="border-slate-300 bg-slate-50">nicht abgerechnet</Swatch>
        <Swatch className="border-dashed border-slate-400 bg-white">Mult 0 (keine Arbeitszeit)</Swatch>
        <Swatch className="border-amber-300 bg-amber-50">Urlaub</Swatch>
        <Swatch className="border-rose-300 bg-rose-50">Krank</Swatch>
        <Swatch className="border-red-400 bg-red-100">fehlende Buchung</Swatch>
        <span>
          Buchungen ohne Beginn/Ende (Spalten im Projekt unter „Export-Format“) stehen bei
          „ganztags“.
        </span>
      </div>
    </section>
  );
}

function Swatch({ className, children }: { className: string; children: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`inline-block h-3 w-3 rounded-sm border ${className}`} />
      {children}
    </span>
  );
}

interface DayProps {
  days: string[];
  bookings: BookingDetail[];
  /** Hinweis unter dem Tag (Feiertag, nach dem Stichtag). */
  note: (day: string) => string | null;
  shade: (day: string, index: number) => string;
}

/** Urlaub/Krank und Summe des Tages, dazu Buchungen ohne Uhrzeit. */
function AllDay({ list, missing }: { list: BookingDetail[]; missing: boolean }) {
  const work = list.filter(isWork);
  return (
    <>
      {missing && (
        <div className="rounded border border-red-400 bg-red-100 px-1.5 py-0.5 font-medium text-red-800">
          Fehlende Buchung
        </div>
      )}
      {(["vacation", "sick"] as const).map((kind) => {
        const absent = list.filter((b) => b.kind === kind);
        if (absent.length === 0) return null;
        return (
          <div
            key={kind}
            className={`rounded border px-1.5 py-0.5 ${
              kind === "vacation"
                ? "border-amber-300 bg-amber-50 text-amber-900"
                : "border-rose-300 bg-rose-50 text-rose-900"
            }`}
          >
            {kind === "vacation" ? "Urlaub" : "Krank"} {formatHours(sumHours(absent))} h
          </div>
        );
      })}
      {work.length > 0 && <div className="text-slate-600">Gebucht {formatHours(sumHours(work))} h</div>}
      {work
        .filter((b) => !timed(b))
        .map((b, i) => (
          <div key={i} title={describe(b)} className={`truncate rounded border px-1.5 py-0.5 ${color(b)}`}>
            {formatHours(b.hours)} h {b.element}
          </div>
        ))}
    </>
  );
}

function PersonWeek({
  days,
  bookings,
  note,
  shade,
  isMissing,
}: DayProps & { isMissing: (day: string) => boolean }) {
  const perDay = days.map((day) => bookings.filter((b) => b.date === day));
  const timedPerDay = perDay.map((list) =>
    list.filter(isWork).map(timed).filter((t): t is Timed => t !== null),
  );
  const [fromHour, toHour] = hourRange(timedPerDay.flat());
  const height = (toHour - fromHour) * HOUR_PX;
  const hours = Array.from({ length: toHour - fromHour }, (_, i) => fromHour + i);

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <div
        className="grid min-w-[760px] text-xs"
        style={{ gridTemplateColumns: "3.5rem repeat(7, minmax(0, 1fr))" }}
      >
        <div />
        {days.map((day, i) => (
          <div
            key={day}
            className={`border-l border-slate-200 px-2 py-2 text-center ${shade(day, i)}`}
          >
            <div className="text-sm font-semibold">{dayLabel(day, i)}</div>
            {note(day) && <div className="truncate text-[11px] text-slate-500">{note(day)}</div>}
          </div>
        ))}

        <div className="border-t border-slate-200 px-1 py-1 text-[11px] text-slate-500">
          ganztags
        </div>
        {days.map((day, i) => (
          <div
            key={day}
            data-day={day}
            className={`space-y-1 border-t border-l border-slate-200 p-1 ${shade(day, i)}`}
          >
            <AllDay list={perDay[i]} missing={isMissing(day)} />
          </div>
        ))}

        <div className="relative border-t border-slate-200" style={{ height }}>
          {hours.map((h) => (
            <div
              key={h}
              className="absolute right-1 text-[11px] text-slate-500 tabular-nums"
              style={{ top: (h - fromHour) * HOUR_PX - 1 }}
            >
              {String(h).padStart(2, "0")}:00
            </div>
          ))}
        </div>
        {days.map((day, i) => (
          <div
            key={day}
            data-day={day}
            className={`relative border-t border-l border-slate-200 ${shade(day, i)}`}
            style={{
              height,
              backgroundImage: "linear-gradient(to bottom, rgb(226 232 240) 1px, transparent 1px)",
              backgroundSize: `100% ${HOUR_PX}px`,
            }}
          >
            {layoutDay(timedPerDay[i]).map((p, j) => (
              <div
                key={j}
                role="note"
                title={describe(p.booking)}
                className={`absolute overflow-hidden rounded border px-1.5 py-0.5 leading-tight ${color(
                  p.booking,
                )}`}
                style={{
                  top: ((p.from - fromHour * 60) / 60) * HOUR_PX + 1,
                  height: Math.max(18, ((p.to - p.from) / 60) * HOUR_PX - 2),
                  left: `calc(${(p.lane * 100) / p.lanes}% + 2px)`,
                  width: `calc(${100 / p.lanes}% - 4px)`,
                }}
              >
                <div className="tabular-nums text-[11px]">
                  {clock(p.from)} – {clock(p.to)}
                </div>
                <div className="font-semibold">{p.booking.element || "(ohne Element)"}</div>
                {p.booking.location && <div>{p.booking.location}</div>}
                {p.booking.description && (
                  <div className="text-slate-600">{p.booking.description}</div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function TeamWeek({
  days,
  bookings,
  persons,
  note,
  shade,
  isMissing,
}: DayProps & { persons: string[]; isMissing: (person: string, day: string) => boolean }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[900px] table-fixed text-xs">
        <thead>
          <tr>
            <th className="w-36 px-2 py-2 text-left text-sm font-semibold">Person</th>
            {days.map((day, i) => (
              <th
                key={day}
                className={`border-l border-slate-200 px-2 py-2 text-center text-sm font-semibold ${shade(day, i)}`}
              >
                {dayLabel(day, i)}
                {note(day) && (
                  <div className="truncate text-[11px] font-normal text-slate-500">{note(day)}</div>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {persons.map((person) => {
            const own = bookings.filter((b) => b.person === person);
            return (
              <tr key={person} className="border-t border-slate-200">
                <th scope="row" className="px-2 py-1.5 text-left align-top font-medium">
                  {person}
                  <div className="font-normal text-slate-500">
                    {formatHours(sumHours(own.filter(isWork)))} h
                  </div>
                </th>
                {days.map((day, i) => {
                  const list = own.filter((b) => b.date === day);
                  const timedList = list
                    .filter(isWork)
                    .map(timed)
                    .filter((t): t is Timed => t !== null)
                    .sort((a, b) => a.from - b.from);
                  return (
                    <td
                      key={day}
                      data-day={day}
                      className={`space-y-0.5 border-l border-slate-200 p-1 align-top ${shade(day, i)}`}
                    >
                      <AllDay list={list} missing={isMissing(person, day)} />
                      {timedList.map((t, j) => (
                        <div
                          key={j}
                          title={describe(t.booking)}
                          className={`rounded border px-1 py-0.5 leading-tight ${color(t.booking)}`}
                        >
                          <div className="tabular-nums">
                            {clock(t.from)}–{clock(t.to)}
                          </div>
                          <div className="truncate font-medium">{t.booking.element}</div>
                        </div>
                      ))}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
