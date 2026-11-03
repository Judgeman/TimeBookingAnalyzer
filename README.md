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
- [x] Arbeitsort: Anteile je Ort (Tortendiagramm + Tabelle), Home-Office-Anteil, Monatsverlauf
- [x] Fehlende Buchungen: Werktage unter einer Schwelle (Standard 50 %) als Liste und Kennzeichen
- [x] Rechnung: Netto pro Person und Monat, USt. je Steuersatz, Brutto, Positionen je Leistung
- [x] Abrechnungsregeln (billable, Mult, Satz-Anteil, USt.), Arbeitszeit-Ausnahmen je Person
- [x] Einsatzzeitraum je Person; Projektbuchungen außerhalb des Teams deutlich markiert
- [x] Rolle „darf buchen“ (ohne Zeiterfassung, abgerechnet nach Kost2Art)
- [x] Projekt-Editor mit Formularen für Team, Arbeitszeiten, Regeln, Feiertage
- [x] Tests: Rust-Unit-Tests, Vitest (Unit/Komponenten/Integration), E2E, Vertragstest, CI
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

Tests:

```bash
cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings
```

```bash
npm test
```

```bash
npm run build:e2e && npm run test:e2e
```

E2E-Voraussetzungen (u. a. `tauri-driver`) stehen in [`e2e/README.md`](e2e/README.md).
Bei jedem Push laufen alle Tests, Lint und Abdeckungsberichte in GitHub Actions
(`.github/workflows/ci.yml`).

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
