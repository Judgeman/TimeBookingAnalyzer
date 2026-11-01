/** Eine Zeile pro Datum, "TT.MM.JJJJ" oder "JJJJ-MM-TT" → ISO-Daten. */
export function parseDateList(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const german = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(line);
      const iso = german
        ? `${german[3]}-${german[2].padStart(2, "0")}-${german[1].padStart(2, "0")}`
        : line;
      const date = new Date(`${iso}T00:00:00Z`);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(iso) ||
        Number.isNaN(date.getTime()) ||
        date.toISOString().slice(0, 10) !== iso
      ) {
        throw new Error(`„${line}“ ist kein gültiges Datum.`);
      }
      return iso;
    });
}
