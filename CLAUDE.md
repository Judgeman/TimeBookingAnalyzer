# Billing Tracker – Tauri Desktop App

## Projektziel
Desktop-App zur Auswertung von ProjectForge-Exporten für Consulting-Abrechnung.
Drag & Drop einer Export-Datei → sofortige Auswertung nach konfigurierbaren Projekt-Regeln.

> **Vertraulichkeit:** Keine echten Kunden-, Projekt- oder Personendaten (Namen,
> Element-Codes, Stundensätze, Arbeitszeiten, Exporte) ins Repository – auch nicht in
> Tests, Beispielen, Kommentaren oder dieser Datei. Echte Projekte legt der Nutzer nur
> lokal in der App an. Für Tests und Beispiele ausschließlich die fiktiven Daten aus
> `sample-data/` („Musterkunde GmbH“, Erika/Max Mustermann) verwenden bzw. erweitern.

## Tech Stack
- **Tauri 2** (Rust Backend + React + TypeScript Frontend)
- **Frontend**: React 18 + TypeScript + Vite
- **UI**: Tailwind CSS 4 (`@tailwindcss/vite`)
- **Backend**: Rust (calamine für Excel-Parsing, serde + serde_json für Config)
- **Config**: JSON-Dateien pro Projekt (im App-Datenverzeichnis)

## App-Struktur

```
src/                        # React Frontend
  components/
    DropZone.tsx            # Drag-and-Drop Bereich (Tauri-Webview-Events) + Datei-Dialog
    ProjectSelector.tsx     # Projekt-Auswahl (Sidebar)
    ProjectEditor.tsx       # Projekt-Konfiguration bearbeiten (vorläufig: Team/Zeiten als JSON)
    ExportSummary.tsx       # Übersicht über den eingelesenen Export
    ResultsView.tsx         # (geplant) Auswertungs-Ergebnis (Tabellen)
  lib/
    api.ts                  # Typisierte Wrapper um invoke()
    format.ts               # Zahl-/Datumsformatierung (de-DE)
  types/
    config.ts               # TypeScript-Typen für Projektkonfiguration
    results.ts              # TypeScript-Typen für Command-Ergebnisse
  App.tsx

src-tauri/
  src/
    main.rs                 # ruft billing_tracker_lib::run()
    lib.rs                  # Tauri-Builder, Plugins, State, Command-Registrierung
    commands/
      parse_export.rs       # Export einlesen (+ später auswerten)
      config.rs             # Projekte laden/speichern
    models/
      config.rs             # Projektkonfiguration (Rust-Structs) + Validierung
      entry.rs              # TimeEntry (eine Export-Zeile)
      results.rs            # Command-Ergebnisse (ParsedExport, ProjectSummary, …)
    parsing/
      cells.rs              # Zellwerte → Text/Datum/Stunden/Mult
      export.rs             # calamine: Tabellenblatt → Vec<TimeEntry>
      summary.rs            # Übersicht (Personen, Team-Abgleich, Vorschau)
    storage/
      projects.rs           # ProjectStore: <app_data_dir>/projects/<id>.json
    calculation/            # (geplant)
      gearb.rs              # Arbeitszeit-Berechnung
      billing.rs            # Billable-Berechnung
      soll.rs               # Soll-Stunden + Feiertage
  examples/
    generate_sample_export.rs  # erzeugt sample-data/Beispiel-Export_2026-10-31.xlsx

sample-data/                # Fiktive Testdaten (Export + passende Projektkonfiguration)
```

## Entwicklung

```bash
npm install
npm run tauri dev          # App im Dev-Modus starten
npm run build              # Typecheck + Frontend-Build
cd src-tauri && cargo test # Rust-Tests (Parser, Config, Speicher)
cd src-tauri && cargo clippy --all-targets
cd src-tauri && cargo run --example generate_sample_export  # Beispiel-Export neu erzeugen
```

---

## Projektkonfiguration (JSON-Schema)

Jedes Projekt wird als JSON-Datei gespeichert:

```json
{
  "id": "uuid-v4",
  "name": "Musterkunde GmbH / Lager-App",
  "element_filter": "P100 Lager-App",
  "team": [
    {
      "name": "Erika Mustermann",
      "rates": [
        { "from": "2026-01-01", "to": "2026-06-30", "rate": 100 },
        { "from": "2026-07-01", "to": null, "rate": 105 }
      ]
    },
    {
      "name": "Max Mustermann",
      "rates": [
        { "from": "2026-01-01", "to": "2026-06-30", "rate": 90 },
        { "from": "2026-07-01", "to": null, "rate": 95 }
      ]
    }
  ],
  "working_hours": [
    { "from": "2026-01-01", "to": "2026-06-30", "hours_per_day": 8.0 },
    { "from": "2026-07-01", "to": null, "hours_per_day": 7.5 }
  ],
  "holidays": {
    "region": "HE",
    "custom": []
  },
  "export_format": {
    "sheet_name": "Details",
    "columns": {
      "name": 0,
      "date": 2,
      "duration": 5,
      "mult": 8,
      "element": 9,
      "kost2art": 11,
      "location": 13
    },
    "special_elements": {
      "sick": "(Sick)",
      "vacation": "(Vacation)"
    }
  }
}
```

---

## Kern-Berechnungslogik (Rust)

### Datenmodell pro Export-Zeile
```rust
struct TimeEntry {
    name: String,
    date: NaiveDate,
    hours: f64,
    mult: f64,
    element: String,
    kost2art: String,
    location: String,
}
```

### Kost2Art-Klassifikation
```rust
fn is_billable(kost2art: &str) -> bool {
    kost2art.contains("(billable)")
}

fn is_delivery(kost2art: &str) -> bool {
    kost2art == "Delivery (billable)"
}

fn counts_as_work(mult: f64) -> bool {
    mult > 0.0
}
```

### gearb (Gearbeitete Stunden)
```rust
// Alle Einträge mit Mult > 0 (ausgenommen Sick/Vacation-Elemente)
// ACHTUNG: Wochenend-Einträge einschließen!
gearb = entries
    .filter(|e| e.element != config.sick && e.element != config.vacation)
    .filter(|e| e.mult > 0.0)
    .sum(|e| e.hours * e.mult)
```

### bill_h (Billable Stunden)
```rust
// NUR Projekt-Element + Delivery — kein Sales, kein Travel
bill_h = entries
    .filter(|e| e.element == config.element_filter)
    .filter(|e| e.kost2art == "Delivery (billable)")
    .sum(|e| e.hours)
```

### bill_eur (Billable EUR)
```rust
// Projekt-Element + alle (billable) — inkl. Travel (billable)
bill_eur = entries
    .filter(|e| e.element == config.element_filter)
    .filter(|e| is_billable(&e.kost2art))
    .sum(|e| e.hours * rate_for(person, e.date, &config))
```

### Soll-Berechnung
```rust
// Soll brutto = Σ hpd für jeden Werktag (Mo–Fr, kein Feiertag)
soll_brutto = workdays.sum(|d| hours_per_day(d, &config))

// Urlaub/Krank normalisieren (Personio gibt 8h/Tag, wir skalieren auf Vertrag)
vac_h_norm = (vac_raw_h / 8.0) * hpd(date, &config)
sick_h_norm = (sick_raw_h / 8.0) * hpd(date, &config)

soll_netto = soll_brutto - vac_h_norm - sick_h_norm
plus       = gearb - soll_netto
plus_krank = plus - sick_h_norm
```

---

## Feiertage Hessen 2026 (Beispiel)

Easter-Berechnung nach Gauß-Algorithmus. Für Hessen relevante Feiertage:
- Neujahr (1.1.)
- Karfreitag (Easter − 2)
- Ostermontag (Easter + 1)
- Tag der Arbeit (1.5.)
- Christi Himmelfahrt (Easter + 39)
- Pfingstmontag (Easter + 49)
- Fronleichnam (Easter + 60) ← Hessen-spezifisch
- Tag der Deutschen Einheit (3.10.)
- Weihnachten (25.12., 26.12.)

Empfehlung: Crate `holidays` oder `workalendar` verwenden, oder eigene Berechnung.

---

## Tauri Commands (IPC Frontend ↔ Backend)

```rust
// Aktuell: Result<ParsedExport, String> (Übersicht über die eingelesenen Daten).
// Ziel:    Result<AuswertungResult, String>, sobald calculation/ steht.
#[tauri::command]
async fn parse_export(
    file_path: String,
    project_id: String,
) -> Result<AuswertungResult, String>

#[tauri::command]
async fn list_projects() -> Result<Vec<ProjectSummary>, String>

#[tauri::command]
async fn get_project(id: String) -> Result<ProjectConfig, String>

#[tauri::command]
async fn save_project(config: ProjectConfig) -> Result<String, String>

#[tauri::command]
async fn delete_project(id: String) -> Result<(), String>
```

---

## Ausgabe-Datenmodell

```typescript
interface AuswertungResult {
  project_name: string;
  export_date: string;
  cutoff_date: string;
  persons: PersonResult[];
  team: TeamSummary;
}

interface PersonResult {
  name: string;
  ytd: PeriodData;
  by_month: Record<string, PeriodData>;
  by_week: Record<string, PeriodData>;  // Key: "2026-W43"
}

interface PeriodData {
  soll_b: number;      // Soll brutto
  soll_n: number;      // Soll netto
  vac_days: number;
  vac_h: number;
  sick_days: number;
  sick_h: number;
  gearb: number;       // Gearbeitete Stunden (×Mult)
  bill_h: number;      // Billable Stunden (nur Delivery)
  bill_eur: number;    // Billable EUR (Delivery + Travel)
  nonbill_h: number;   // Non-billable Stunden
  plus: number;        // Überstunden
  plus_krank: number;  // Überstunden (Krank = Fehlzeit)
}
```

---

## UI-Anforderungen

### Hauptansicht
1. **Sidebar links**: Projektliste + "Neues Projekt"-Button
2. **Mitte oben**: Drag-and-Drop-Zone (oder Datei-Browser)
3. **Mitte**: Auswertungsergebnis (Tabs: YTD / Monate / Wochen)
4. **Oben rechts**: Projekt-bearbeiten-Button

### Drag & Drop
- Drop-Zone akzeptiert `.xlsx`-Dateien
- Nach Drop: sofortige Auswertung mit aktivem Projekt
- Dateiname + Datum anzeigen (Stand des Exports)

### Projektkonfiguration (Editor)
- Formular: Projektname, Element-Filter
- Team: Person hinzufügen/entfernen, Stundensatz-Perioden
- Arbeitszeit-Perioden (h/Tag)
- Feiertage: Region-Dropdown + Custom-Dates
- Spalten-Mapping: welche Export-Spalte enthält was (Drag-and-Drop auf Sample-Zeile)

### Tabellen-Ansicht
- YTD-Übersicht: Personen als Spalten, Kennzahlen als Zeilen
- Monatsauswertung: Monat als Zeile, aufklappbar für Wochenwerte
- Farb-Codierung: Plus grün, Minus rot

---

## Wichtige Hinweise für die Implementierung

1. **calamine**: Bester Rust-Crate für XLSX-Parsing (kein Excel installiert nötig)
2. **Wochenend-Einträge**: Mitarbeiter können Sa/So buchen → immer alle 7 Tage der Woche aggregieren, nicht nur Mo–Fr
3. **Duration-Typ**: Im Export als `f64` oder `i64` gespeichert, manchmal als Excel-Zeit-Wert
4. **Fließkomma**: Interne Berechnung mit f64, Ausgabe auf 2 Dezimalstellen runden
5. **Mult-Default**: Wenn Mult-Zelle leer → 1.0 annehmen
6. **Kumulativer Export**: Der neueste Export enthält alle historischen Daten → kein Merging nötig
7. **Config-Speicherort**: `app.path().app_data_dir()` + `/projects/` (Tauri 2; Dateiname = `<id>.json`)
8. **Drag & Drop**: HTML5-Drop liefert in Tauri keine Pfade → `getCurrentWebview().onDragDropEvent()` verwenden
9. **IPC-Argumente**: Tauri mappt camelCase (JS) auf snake_case (Rust): `invoke("parse_export", { filePath, projectId })`

