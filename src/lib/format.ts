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
