# Billing Tracker

Desktop-App (Tauri 2 + React + TypeScript) zur Auswertung von ProjectForge-Exporten
für die Consulting-Abrechnung. Export-Datei per Drag & Drop ablegen → Auswertung nach
konfigurierbaren Projekt-Regeln. Details zu Regeln und Datenmodell: [CLAUDE.md](CLAUDE.md).

## Stand

- [x] `parse_export`: Excel-Export mit calamine einlesen (Spalten-Mapping pro Projekt)
- [x] Projektkonfiguration laden/speichern/löschen (JSON pro Projekt im App-Datenverzeichnis)
- [x] Berechnung: gearb, billable, Soll/Ist inkl. Feiertage (alle Bundesländer)
- [x] Auswertung pro Person: Jahr, Monate (aufklappbar auf KW), Kalenderwochen, Stichtag wählbar
- [x] Stundenkonto: Vertragsabgleich (Urlaub/Krank angerechnet bzw. Krankheit als Fehlzeit)
- [x] Rechnung: Netto pro Person und Monat, USt. je Steuersatz, Brutto, Positionen je Leistung
- [x] Abrechnungsregeln (billable, Mult, Satz-Anteil, USt.), Arbeitszeit-Ausnahmen je Person
- [x] Projekt-Editor mit Formularen für Team, Arbeitszeiten, Regeln, Feiertage
- [ ] Spalten-Mapping per Drag & Drop auf eine Beispielzeile

## Voraussetzungen

- Rust (stable) und Node.js ≥ 20
- Systempakete laut [Tauri-Prerequisites](https://tauri.app/start/prerequisites/)
  (Linux z. B. `libwebkit2gtk-4.1-dev librsvg2-dev`)

## Entwicklung

```bash
npm install
```

```bash
npm run tauri dev
```

Tests und Lint für das Rust-Backend:

```bash
cd src-tauri && cargo test && cargo clippy --all-targets
```

Zum Ausprobieren gibt es fiktive Beispieldaten in [`sample-data/`](sample-data/README.md)
(Export + passende Projektkonfiguration).

Release-Build (Installer unter `src-tauri/target/release/bundle/`):

```bash
npm run tauri build
```

## Projektdateien

Projekte liegen als `<id>.json` unter `<App-Datenverzeichnis>/projects/` – also nur
lokal auf dem Rechner, nicht im Repository:

| System  | Pfad                                                                 |
| ------- | -------------------------------------------------------------------- |
| macOS   | `~/Library/Application Support/de.judgeman.billingtracker/projects/` |
| Windows | `%APPDATA%\de.judgeman.billingtracker\projects\`                     |
| Linux   | `~/.local/share/de.judgeman.billingtracker/projects/`                |
