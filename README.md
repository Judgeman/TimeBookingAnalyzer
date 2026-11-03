# Billing Tracker

Desktop-App (Tauri 2 + React + TypeScript) zur Auswertung von ProjectForge-Exporten
für die Consulting-Abrechnung. Export-Datei per Drag & Drop ablegen → Auswertung nach
konfigurierbaren Projekt-Regeln. Details zu Regeln und Datenmodell: [CLAUDE.md](CLAUDE.md).

## Stand

- [x] `parse_export`: Excel-Export mit calamine einlesen (Spalten-Mapping pro Projekt)
- [x] Projektkonfiguration laden/speichern/löschen (JSON pro Projekt, Ordner neben der Exe)
- [x] Berechnung: gearb, billable, Soll/Ist inkl. Feiertage (alle Bundesländer)
- [x] Auswertung pro Person: Jahr, Monate (aufklappbar auf KW), Kalenderwochen, Stichtag wählbar
- [x] Stundenkonto: Vertragsabgleich (Urlaub/Krank angerechnet bzw. Krankheit als Fehlzeit)
- [x] Arbeitsort: Anteile je Ort (Tortendiagramm + Tabelle), Home-Office-Anteil, Monatsverlauf
- [x] Fehlende Buchungen: Werktage unter einer Schwelle (Standard 50 %) als Liste und Kennzeichen
- [x] Rechnung: Netto pro Person und Monat, USt. je Steuersatz, Brutto, Positionen je Leistung
- [x] Abrechnungsregeln (billable, Mult, Satz-Anteil, USt.), Arbeitszeit-Ausnahmen je Person
- [x] Einsatzzeitraum je Person; Projektbuchungen außerhalb des Teams deutlich markiert
- [x] Rolle „darf buchen“ (ohne Zeiterfassung, abgerechnet nach Kost2Art)
- [x] Letzte Export-Datei je Projekt gemerkt (Kopie im Ordner `Import`), beim Öffnen automatisch ausgewertet
- [x] Fensterposition und -größe vom letzten Aufruf (je Instanz, `window-state.json` neben der Exe)
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

Projekte liegen als `<id>.json` im Ordner `projects` **neben der Programmdatei** – also
nur lokal auf dem Rechner, nicht im Repository. Jede Kopie der App (eigener Ordner) ist
eine eigene Instanz mit eigenen Projekten; mehrere Instanzen können gleichzeitig laufen.
Der Ordner muss beschreibbar sein (z. B. nicht unter `C:\Program Files`). Die Projektliste
zeigt unten, welchen Ordner die Instanz benutzt.

Frühere Versionen speicherten unter `<App-Datenverzeichnis>/projects/` (Windows:
`%APPDATA%\de.judgeman.billingtracker\projects\`). Ist der Projektordner einer Instanz
leer, bietet die App an, diese Projekte zu übernehmen (sie werden kopiert).

Position und Größe des Fensters merkt sich jede Instanz in `window-state.json` neben der
Programmdatei; beim ersten Start öffnet sich das Fenster zentriert.

Die zuletzt eingelesene Export-Datei jedes Projekts legt die App als Kopie unter
`Import/<Projekt-ID>/` neben der Programmdatei ab (nur die neueste) und wertet sie beim
nächsten Öffnen des Projekts automatisch aus.

Im Dev-Modus (`npm run tauri dev`) liegen die Ordner unter `src-tauri/target/debug/`.
