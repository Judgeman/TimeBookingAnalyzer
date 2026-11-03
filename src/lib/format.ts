const hoursFormat = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatHours(value: number): string {
  return hoursFormat.format(value);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(value);
}

/** "2026-10-05" → "05.10.2026" (ohne Zeitzonen-Umrechnung). */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "–";
  const [year, month, day] = iso.split("-");
  return day && month && year ? `${day}.${month}.${year}` : iso;
}

/** 0 → "A", 26 → "AA". */
export function columnLetter(index: number): string {
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

const euroFormat = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

export function formatEuro(value: number): string {
  return euroFormat.format(value);
}

/** Stunden mit Vorzeichen, z. B. "+12,50" / "−3,00". */
export function formatSignedHours(value: number): string {
  if (value === 0) return formatHours(0);
  return (value > 0 ? "+" : "−") + formatHours(Math.abs(value));
}

const MONTHS = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

/** "2026-10" → "Oktober 2026" */
export function formatMonth(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return `${MONTHS[month - 1] ?? key} ${year}`;
}

/** "2026-W43" → "KW 43" */
export function formatWeek(key: string): string {
  const week = key.split("-W")[1];
  return week ? `KW ${Number(week)}` : key;
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Montag und Sonntag einer ISO-Woche ("2026-W43"). */
export function isoWeekRange(key: string): [string, string] {
  const [yearPart, weekPart] = key.split("-W");
  const year = Number(yearPart);
  const week = Number(weekPart);
  // Der 4. Januar liegt immer in KW 1.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return [toIso(monday), toIso(sunday)];
}

/** Erster und letzter Tag eines Monats ("2026-10"). */
export function monthRange(key: string): [string, string] {
  const [year, month] = key.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const last = new Date(Date.UTC(year, month, 0));
  return [toIso(first), toIso(last)];
}

/** Schnittmenge zweier Zeiträume als "01.10.–04.10." (ISO-Strings vergleichbar). */
export function formatRange(from: string, to: string): string {
  const short = (iso: string) => formatDate(iso).slice(0, 6);
  return from === to ? short(from) : `${short(from)}–${short(to)}`;
}

export function clampRange(
  [from, to]: [string, string],
  [min, max]: [string, string],
): [string, string] {
  return [from < min ? min : from, to > max ? max : to];
}


const pad = (n: number) => String(n).padStart(2, "0");

/** Heutiges Datum (lokale Zeit) als ISO-String. */
export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Letzter Tag des Vormonats relativ zu `iso`. */
export function endOfPreviousMonth(iso: string): string {
  const [year, month] = iso.split("-").map(Number);
  const last = new Date(Date.UTC(year, month - 1, 0));
  return last.toISOString().slice(0, 10);
}

/** ISO-Kalenderwoche eines Datums, z. B. "2026-W43" (wie im Backend). */
export function isoWeekKey(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  // Donnerstag derselben Woche bestimmt das Wochenjahr.
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) + 3);
  const weekYear = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(weekYear, 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${weekYear}-W${pad(week)}`;
}

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

/** "2026-07-25" → "Sa, 25.07.2026" */
export function formatDateWithWeekday(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${formatDate(iso)}`;
}

/** Prozentwert mit max. einer Nachkommastelle, z. B. "103,5 %". */
export function formatPercent(value: number): string {
  return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(value)} %`;
}

/** Kurzform eines Ordnerpfads: die letzten beiden Teile, z. B. `…\Kunde-A\projects`. */
export function shortPath(path: string): string {
  const separator = path.includes("\\") ? "\\" : "/";
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length <= 2 ? path : `…${separator}${parts.slice(-2).join(separator)}`;
}

/** "2026-11-03T11:20:15" → "03.11.2026, 11:20". */
export function formatDateTime(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  return match ? `${match[3]}.${match[2]}.${match[1]}, ${match[4]}:${match[5]}` : iso;
}
