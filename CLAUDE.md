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
- **Config**: JSON-Dateien pro Projekt (Ordner `projects` neben der Exe)

## App-Struktur

```
src/                        # React Frontend
  components/
    DropZone.tsx            # Drag-and-Drop Bereich (Tauri-Webview-Events) + Datei-Dialog
    ProjectSelector.tsx     # Projekt-Auswahl (Sidebar)
    ProjectEditor.tsx       # Projekt-Konfiguration bearbeiten
    editor/
      TeamEditor.tsx        # Personen, Stundensätze, abw. Arbeitszeit, Einsatzzeitraum, Urlaubsanspruch
      GuestEditor.tsx       # Rolle „darf buchen“: Name + Stundensätze
      PlanningEditor.tsx    # Budget-Zeiträume (Monate + Betrag), geplante Abwesenheiten
      PeriodListEditor.tsx  # Zeiträume (Von/Bis/Wert)
      RulesEditor.tsx       # Abrechnungsregeln (Reihenfolge = Priorität)
    ExportSummary.tsx       # Übersicht über den eingelesenen Export (Tab „Import“)
    results/
      ResultsView.tsx       # Kopf (Zeitraum, Stichtag, Hinweise) + Tabs
      YearView.tsx          # Jahr: Kennzahlen × Personen
      PeriodTable.tsx       # Monate (aufklappbar auf KW) / Wochen, ⚑-Markierungen
      AccountView.tsx       # Stundenkonto: Vertragsabgleich (2 Varianten), kumuliert
      LocationView.tsx      # Arbeitsort: Torte + Tabelle, Home-Office-Anteil, Monatsverlauf
      PieChart.tsx          # SVG-Tortendiagramm (ohne Bibliothek), Hover-Tooltip
      chartColors.ts        # validierte kategorische Palette, Farbe folgt dem Ort
      InvoiceView.tsx       # Rechnung: Netto pro Person/Monat, USt., Brutto
      OutsideBookings.tsx   # roter Hinweis: Projektbuchungen außerhalb des Teams
      GuestBookings.tsx     # neutraler Hinweis: Buchungen der Rolle „darf buchen“
      ForecastView.tsx      # Prognose: laufender Monat, Budget-Status, Monate, Faktoren je Person
      BudgetChart.tsx       # SVG-Linien kumuliert: Ist, Prognose (gestrichelt), Richtwert, Budget
      forecast.ts           # Hilfen: kumulierte Kurven, aktives Budget, Stand der Daten
      InsightsView.tsx      # Insights: Hinweise, Rekord-Monate, Pace Team/Person
      DeviationChart.tsx    # Säulen „abgerechnet − Richtwert“ je Monat (Gegensatzpaar blau/rot)
      insights.ts           # Kennzahlen + Hinweis-Schwellen (THRESHOLDS), nur Frontend
      metrics.ts            # Kennzahl-Labels, Tooltips (Rechenregeln), Formatierung
  lib/
    api.ts                  # Typisierte Wrapper um invoke()
    format.ts               # Zahl-/Datumsformatierung (de-DE)
    dates.ts                # Eingabe freier Tage (TT.MM.JJJJ / ISO) parsen
    assignments.ts          # Einsatzzeiträume: Text, Überschneidung mit Monat/KW
  test/
    setup.ts                # Vitest: jest-dom, cleanup
    fixture.ts              # sampleResult(): echtes Rust-Ergebnis der Beispieldaten
    fixtures/sample-result.json  # von Rust erzeugt (Vertragstest, s. u.)
  **/*.test.ts(x)           # Vitest-Unit-/Komponententests neben dem Code
  types/
    config.ts               # TypeScript-Typen für Projektkonfiguration
    results.ts              # TypeScript-Typen für Command-Ergebnisse
  App.tsx

src-tauri/
  src/
    main.rs                 # ruft billing_tracker_lib::run()
    lib.rs                  # Tauri-Builder, Plugins (dialog, window-state), State, Commands
    window.rs               # Fenster an den Bildschirm anpassen (fit: reine Rechnung + Anwenden)
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
      projects.rs           # ProjectStore: <Ordner der Exe>/projects/<id>.json, Übernahme alter Projekte
      imports.rs            # ImportStore: letzte Export-Datei je Projekt (<Ordner der Exe>/Import/<id>/)
      forecasts.rs          # ForecastStore: gespeicherte Prognosen (<Ordner der Exe>/Prognosen/<id>.json)
    calculation/
      mod.rs                # evaluate(): Tageswerte → Jahr/Monat/KW/Monat×KW, Hinweise
      gearb.rs              # Arbeitszeit-Berechnung, Urlaub/Krank-Erkennung
      billing.rs            # Abrechnungsregeln (erste passende), Stundensatz je Tag
      soll.rs               # Soll-Stunden, h/Tag je Person, ½-/ganze Tage
      holidays.rs           # Feiertage aller Bundesländer (Osterformel)
      invoice.rs            # Rechnung je Monat (Cent-genau), USt., Brutto
      forecast.rs           # Prognose: Faktoren je Person, Tagesprognose, Budget-Status, Nachrechnung
      vacation.rs           # Resturlaub je Person (Anspruch + Übertrag − genommen − geplant)
      location.rs           # Stunden/Anteile/Tage je Arbeitsort (Spalte „Ort“)
      tests.rs              # Szenario-Test mit handgerechneten Werten
  examples/
    generate_sample_export.rs  # erzeugt sample-data/Beispiel-Export_2026-10-31.xlsx

sample-data/                # Fiktive Testdaten (Export + passende Projektkonfiguration)
e2e/                        # E2E-Tests der Desktop-App (tauri-driver, node:test), s. e2e/README.md
.github/workflows/ci.yml    # CI: Rust (fmt/clippy/Tests/Abdeckung), Frontend, E2E
```

## Entwicklung

```bash
npm install
npm run tauri dev          # App im Dev-Modus starten
npm run build              # Typecheck + Frontend-Build
npm test                   # Frontend-Tests (Vitest)
npm run test:coverage      # … mit Abdeckung (Mindestwerte in vite.config.ts)
npm run build:e2e && npm run test:e2e   # E2E-Tests der echten App (Linux headless: xvfb-run -a)
cd src-tauri && cargo test # Rust-Tests (Parser, Config, Speicher, Berechnung)
cd src-tauri && cargo clippy --all-targets -- -D warnings
cd src-tauri && cargo llvm-cov --lib --summary-only         # Rust-Abdeckung
cd src-tauri && cargo run --example generate_sample_export  # Beispiel-Export neu erzeugen
cd src-tauri && UPDATE_FIXTURES=1 cargo test frontend_fixture  # Vertrags-Fixture neu erzeugen
```

### Tests
- **Rust**: Unit-Tests je Modul + `calculation/tests.rs` (handgerechnetes Szenario) +
  Beispieldaten-Test in `commands/parse_export.rs`. CI verlangt ≥ 90 % Zeilen.
- **Vertragstest Rust ↔ Frontend**: `frontend_fixture_is_up_to_date` (Rust) vergleicht das
  Ergebnis der Beispieldaten mit `src/test/fixtures/sample-result.json`; `src/test/fixture.test.ts`
  prüft die Datei beim Typecheck gegen `AuswertungResult`. Ändert sich das Datenmodell oder
  die Berechnung → Fixture neu erzeugen (Befehl oben) und TS-Typen anpassen.
- **Frontend**: Vitest + Testing Library (jsdom); `App.test.tsx` testet die ganze App mit
  nachgebildetem Tauri-Backend. Mindestabdeckung 90 % Zeilen/Anweisungen, 85 % Zweige/Funktionen.
- **E2E**: `e2e/` – echte App über `tauri-driver`, als Kopie in einem temporären Ordner
  (Projekte daneben) mit isoliertem Datenverzeichnis.
- Neue Funktionen immer mit Tests in allen betroffenen Ebenen ergänzen.

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
      ],
      "working_hours": [
        { "from": "2026-09-01", "to": null, "hours_per_day": 6.0 }
      ]
    },
    {
      "name": "Lena Beispiel",
      "rates": [{ "from": "2026-01-01", "to": null, "rate": 80 }],
      "assignments": [{ "from": "2026-01-01", "to": "2026-02-28" }],
      "vacation": [{ "year": 2026, "days": 30, "carry_over": 2 }]
    }
  ],
  "guests": [
    { "name": "Karl Beispiel", "rates": [{ "from": "2026-01-01", "to": null, "rate": 120 }] }
  ],
  "planned_absences": [
    { "person": "Erika Mustermann", "from": "2026-11-23", "to": "2026-11-27",
      "kind": "vacation", "half_day": false }
  ],
  "budgets": [{ "from": "2026-01", "to": "2026-12", "amount": 360000 }],
  "working_hours": [
    { "from": "2026-01-01", "to": "2026-06-30", "hours_per_day": 8.0 },
    { "from": "2026-07-01", "to": null, "hours_per_day": 7.5 }
  ],
  "holidays": {
    "region": "HE",
    "custom": []
  },
  "vat_percent": 19.0,
  "missing_threshold_percent": 50.0,
  "billing_rules": [
    { "name": "Delivery", "kost2art": "Delivery (billable)", "match_mode": "exact",
      "element": "", "billable_hours": true, "invoice": true, "apply_mult": false,
      "rate_percent": 100.0, "vat_percent": null },
    { "name": "Sonstige billable (z. B. Travel)", "kost2art": "(billable)",
      "match_mode": "contains", "element": "", "billable_hours": false, "invoice": true,
      "apply_mult": false, "rate_percent": 100.0, "vat_percent": null }
  ],
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

### Abrechnungsregeln (statt fester Kost2Art-Klassifikation)
Jede Nicht-Abwesenheits-Buchung wird der **ersten passenden** Regel aus
`billing_rules` zugeordnet (Kost2Art `exact`/`contains`, ohne Groß-/Kleinschreibung;
`element` leer = `element_filter`). Ohne passende Regel: nicht billable.
- `billable_hours` → zählt in `bill_h`
- `invoice` → geht in `bill_eur` und die Rechnung
- `apply_mult` → abgerechnete Stunden = Stunden × Mult (sonst ohne Mult)
- `rate_percent` → Anteil des Stundensatzes (z. B. 50 für Reisezeit)
- `vat_percent` → eigener USt.-Satz (`null` = `vat_percent` des Projekts)

Standardregeln (`default_billing_rules`, gelten auch wenn das Feld fehlt) = Spezifikation:
Delivery → billable h + €; übrige „(billable)“ → nur €; ohne Mult.

```rust
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

### bill_h / bill_eur
```rust
// Regel = erste passende Abrechnungsregel der Buchung
billed  = if rule.apply_mult { e.hours * e.mult } else { e.hours }
bill_h  = Σ billed            (rule.billable_hours)
bill_eur = Σ billed × rate_for(person, e.date) × rule.rate_percent / 100   (rule.invoice)
```

### Soll-Berechnung
```rust
// hpd(person, d) = Zeitraum der Person (working_hours am Teammitglied), sonst Projekt
// Soll brutto = Σ hpd für jeden Werktag (Mo–Fr, kein Feiertag)
soll_brutto = workdays.sum(|d| hpd(person, d))

// Urlaub/Krank je Tag als ganzer oder halber Standard-Tag anrechnen
// (Personio: 8 h = 1 Tag, 4 h = ½ Tag; andere Werte auf ½ Tag gerundet)
days        = round(raw_h_des_tages / 8 × 2) / 2
vac_h_norm  = days_vac  × hpd(person, d)
sick_h_norm = days_sick × hpd(person, d)

soll_netto = soll_brutto - vac_h_norm - sick_h_norm
plus       = gearb - soll_netto
plus_krank = plus - sick_h_norm
```

### Festlegungen (umgesetzt in `calculation/`)
- **Zeitraum**: 1. Januar des Stichtag-Jahres bis Stichtag. Stichtag in der UI beim
  Programmstart = heute (Schnellwahl: Heute / Stand des Exports / Ende Vormonat); ohne
  Vorgabe im Backend = Export-Datum. Liegt der Stichtag nach dem Export-Stand → Hinweis.
  Buchungen nach dem Stichtag werden ignoriert (Hinweis), aus Vorjahren still ignoriert.
- **Personen**: nur Teammitglieder aus der Konfiguration (Namensabgleich ohne
  Groß-/Kleinschreibung). `gearb` zählt alle Elemente, nicht nur das Projekt.
- **Einsatzzeitraum** (`assignments` am Teammitglied, leer = durchgehend im Projekt;
  Zeiträume dürfen sich nicht überschneiden): außerhalb zählt die Person an dem Tag
  **nicht** mit – kein Soll, keine Arbeitszeit/Urlaub/Krank, kein Arbeitsort, keine
  Prüfung auf fehlende Buchungen, nicht in den Team-Summen. Ausnahme (Variante 1):
  Buchungen **aufs Projekt** (passende Abrechnungsregel oder Projekt-Element) werden
  trotzdem nach den Regeln abgerechnet (`bill_h`/`bill_eur`, Rechnung mit
  `outside_hours`) und in `outside` gelistet (`reason = outside_assignment`).
  Projektbuchungen von Personen, die **nicht im Team** sind, stehen ebenfalls in
  `outside` (`reason = not_in_team`), werden aber nicht abgerechnet (kein Satz).
  UI: roter Hinweis über der Auswertung, ⚠-Zähler am Tab „Rechnung“, markierte
  Rechnungspositionen/Monate, Monate/Wochen außerhalb des Einsatzes ausgegraut.
- **Rolle „darf buchen“** (`guests`: Name + Stundensätze, z. B. Geschäftsführung):
  keine Zeiterfassung – keine Person in Jahr/Monaten/Stundenkonto/Arbeitsort, nicht in
  den Team-Summen, keine fehlenden/hervorgehobenen Buchungen, nicht in `outside`.
  Ihre Buchungen **aufs Projekt** (ohne Abwesenheiten, bis Stichtag) stehen in
  `guest_bookings` und werden nach den Abrechnungsregeln (Kost2Art) mit dem eigenen
  Satz abgerechnet (Rechnungspositionen nach dem Team; ohne Satz → 0 € + Hinweis).
  Name darf nicht zugleich im Team stehen (Validierung). Rechnung netto = Team
  `bill_eur` + `guest_bookings[].net`. UI: neutraler (blauer) Hinweis mit Liste,
  eigene Spalte „darf buchen“ in der Rechnung, Kennzeichnung im Tab „Import“.
- **Prognose** (`forecast.rs`): ab dem Tag nach min(Stichtag, Stand des Exports) bis
  Jahresende bzw. Ende des spätesten Budget-Zeitraums (max. 3 Jahre). Faktoren je
  Person aus 1. Januar bis Ende des letzten abgeschlossenen Monats (sonst bis zum Stand):
  Krankheitsfaktor = krank ÷ (Soll brutto − Urlaub); Ablenkungsfaktor = 1 − abgerechnet
  zum vollen Satz (Σ abgerechnete Stunden × Satz-Anteil, ohne Buchungen außerhalb des
  Einsatzes) ÷ gearbeitet; beide 0…1. Je Werktag (im Einsatz, h/Tag > 0):
  Stunden = (h/Tag − geplante Abwesenheit [ganz/halb]) × (1 − Krankheit) × (1 − Ablenkung),
  Netto = Stunden × Satz des Tages (ohne Satz → 0 € + Hinweis). Keine Überstunden-,
  keine „darf buchen“-Prognose. Ist je Monat = Rechnung (für Budgets vor dem Jahr aus
  zusätzlichen Auswertungen der Vorjahre). Budget (`budgets`, ganze Monate, keine
  Überschneidung): Richtwert/Monat = Betrag ÷ Monate, Richtwert bis Stand anteilig nach
  Tagen, erwartet = Ist + Prognose, Abweichung = erwartet − Budget, `exhausted_on` = erster
  Prognosetag, an dem Ist + kumulierte Prognose das Budget erreicht. Geplante Abwesenheiten
  (`planned_absences`) je Teammitglied, je Person ohne Überschneidung.
- **Prognosegüte**: (1) nachgerechnet (`forecast::backtest`): je abgeschlossenem Monat M
  des Jahres eine Auswertung mit Stichtag = Stand = Ende M−1 und Prognose bis Ende M
  (heutige Konfiguration, Januar mit Faktoren des Vorjahres) → `backtest_net` vs. Ist (Rechnung
  netto). (2) gespeichert (`storage/forecasts.rs`): der Command `parse_export` legt bei jeder
  Auswertung eines vollständigen Exports (Stand der Daten = Stand des Exports) eine
  Momentaufnahme (laufender + folgende Monate: Ist + Prognose) unter `Prognosen/<id>.json`
  ab (gleicher Stand ersetzt, max. 120); je Monat zählt die letzte vor Monatsbeginn
  (`recorded_net`, `recorded_on`). Fehler dabei → Hinweis, nie Abbruch. UI: Ø Abweichung
  (MAPE), Tendenz (Σ(Prognose − Ist) ÷ Σ Ist), Treffer ±10 %.
- **Resturlaub** (`vacation.rs`, `vacation` am Teammitglied: Jahr, Tage, Übertrag): im
  Stichtag-Jahr Rest = Anspruch + Übertrag − genommen (`vac_days` bis Stichtag) − geplant
  (geplante Abwesenheiten Art Urlaub nach dem Stand der Daten bis 31.12., Werktage, ½ Tag
  = 0,5). Nur Personen mit Anspruch für das Jahr. Hinweis in Insights bei Rest < 0 oder
  ≥ 5 Tagen in den letzten 3 Monaten.
- **Insights** (`insights.ts`, im Frontend aus PeriodData/Prognose): nur **abgeschlossene**
  Monate (Monatsende ≤ Stand der Daten). Rekord-Monate des Teams (Krank-/Urlaubstage,
  Über-/Minusstunden, fehlende Buchungen; Budget: abgerechnet − Richtwert min/max).
  Pace Team = Ø abgerechnet je Monat ÷ Richtwert (gesamt, letzte 3 Monate); nötig je
  Restmonat = (Budget − Ist) ÷ offene Monate. Pace Person (Monate im Einsatz): Abrechnungs-
  quote = bill_h ÷ soll_n (Jahr, letzte 3), Ø bill_eur/Monat, € je gearbeitete Stunde =
  bill_eur ÷ gearb, Überstunden (plus), Krankenquote = sick_h ÷ soll_b. Hinweise ab den
  Schwellen in `THRESHOLDS` (Pace > 105 % / < 90 %, Quote −10 Pp., Plus > 40 h / < −20 h,
  krank > 5 %, Ablenkung > 15 %, fehlende Buchungen).
- **Urlaub/Krank** zählt an **jedem** Tag (auch Wochenende/Feiertag) mit h/Tag der
  Person. Hervorgehoben (`flagged`) werden: arbeitsfreie Tage, Dauern ≠ ganzer/halber
  Tag, Tage ohne hinterlegte Arbeitszeit.
- **h/Tag** fehlt für einen Werktag → Soll 0 h (Hinweis, je Person oder „Alle Personen“).
- **Zeiträume** (Sätze, Arbeitszeiten) dürfen sich nicht überschneiden (Validierung).
- **nonbill_h** = Stunden (ohne Mult) aller gearbeiteten Buchungen mit Mult > 0, die
  nicht in `bill_h` zählen (Travel, Sales, andere Elemente).
- **Kein Stundensatz** für einen Tag → 0 € (Hinweis + Rechnungsposition „kein Satz“).
- **Stundenkonto** (UI, aus PeriodData): zu leisten = Soll netto, Saldo = `plus`
  (negativ = Person schuldet Stunden); Variante „Krankheit als Fehlzeit“: zu leisten =
  Soll brutto − Urlaub, Saldo = `plus_krank`; Erfüllung = gearb ÷ zu leisten.
- **Fehlende Buchung**: Werktag (Mo–Fr ohne Feiertag) mit h/Tag > 0, an dem
  gebucht = Arbeitszeit **ohne** Mult (alle Nicht-Abwesenheits-Buchungen, auch Mult 0)
  + angerechneter Urlaub/Krank < `missing_threshold_percent` (Standard 50 %) der
  Soll-Stunden. Geprüft bis min(Stichtag, Stand des Exports) → `missing_checked_until`.
  Zählt als `missing_days` je Zeitraum; Liste `missing` (Soll, gebucht, Anteil).
  Personen, die später ins Projekt kommen oder es verlassen: Einsatzzeitraum setzen.
- **Arbeitsort** (`location.rs`): Basis = gearbeitete Stunden (wie `gearb`: × Mult,
  Mult > 0, ohne Urlaub/Krank) → Summe aller Orte = `gearb`. Orte ohne Groß-/Klein-
  schreibung gruppiert, Anzeigename = erste Schreibweise, leer = „(ohne Angabe)“.
  Tage = Tage mit Buchung an dem Ort (Team: Personentage). Anteile kaufmännisch auf
  2 Stellen. UI: Home-Office-Kennzahl für Orte mit „home“, „remote“ oder „mobil“.
  Torte: max. 6 Farben (feste Reihenfolge aus `chartColors.ts`, Zuordnung nach
  Team-Rang im Jahr), weitere Orte → „Sonstige“.
- **Kalenderwochen** nach ISO 8601 (`2026-W53` kann im Januar des Folgejahres liegen).
  `month_weeks` enthält Teilwochen je Monat, damit aufgeklappte Wochen den Monat ergeben.
- **Rechnung** (`invoice.rs`): eine Rechnung pro Monat, Positionen je Person × Regel ×
  Satz × USt.-Satz. Netto = round(Stunden auf 2 Stellen × Satz × Anteil, Cent);
  USt. je Monat und Steuersatz = round(Netto-Summe × Satz); Brutto = Netto + USt.;
  Jahressummen = Summe der Monatsrechnungen. Monat des Stichtags ist `partial`, wenn
  der Stichtag nicht der Monatsletzte ist.

---

## Feiertage Hessen 2026 (Beispiel)

Easter-Berechnung nach Gauß-Algorithmus. Für Hessen relevante Feiertage:
- Neujahr (1.1.)
- Karfreitag (Easter − 2)
- Ostermontag (Easter + 1)
- Tag der Arbeit (1.5.)
- Christi Himmelfahrt (Easter + 39)
- Pfingstmontag (Easter + 50)
- Fronleichnam (Easter + 60) ← Hessen-spezifisch
- Tag der Deutschen Einheit (3.10.)
- Weihnachten (25.12., 26.12.)

Umgesetzt als eigene Berechnung in `calculation/holidays.rs` für alle 16 Bundesländer
(nur landesweite Feiertage; regionale Sonderfälle über `holidays.custom`).

---

## Tauri Commands (IPC Frontend ↔ Backend)

```rust
// cutoff_date = Stichtag; None → Export-Datum („Stand“), ersatzweise letzte Buchung
#[tauri::command]
async fn parse_export(
    file_path: String,
    project_id: String,
    cutoff_date: Option<NaiveDate>,
) -> Result<AuswertungResult, String>

#[tauri::command]
async fn list_projects() -> Result<Vec<ProjectSummary>, String>

#[tauri::command]
async fn get_project(id: String) -> Result<ProjectConfig, String>

#[tauri::command]
async fn save_project(config: ProjectConfig) -> Result<String, String>

#[tauri::command]
async fn delete_project(id: String) -> Result<(), String>

// Projektordner der Instanz + Anzahl übernehmbarer Projekte vom früheren Ort
#[tauri::command]
async fn project_folder() -> Result<ProjectFolder, String>   // { dir, legacy_count }

#[tauri::command]
async fn import_legacy_projects() -> Result<usize, String>

// Letzte Import-Datei je Projekt (Kopie im Ordner „Import“ neben der Exe)
#[tauri::command]
async fn last_import(project_id: String) -> Result<Option<LastImport>, String>

#[tauri::command]
async fn remember_import(project_id: String, file_path: String) -> Result<LastImport, String>
// LastImport { path (Kopie), file_name, original_path, imported_at }
```

---

## Ausgabe-Datenmodell

```typescript
// Vollständig in src/types/results.ts; hier die Kernstruktur.
interface AuswertungResult {
  project_name: string;
  export_date: string | null;
  period_start: string;
  cutoff_date: string;
  persons: PersonResult[];
  team: PeriodBreakdown;          // Summe aller Personen
  invoice: InvoiceSummary;        // Monate → Positionen (Person × Regel × Satz), USt. je Satz
  holidays: Holiday[];
  warnings: string[];
  flagged: FlaggedBooking[];      // hervorgehobene Urlaubs-/Krank-Tage (zählen mit)
  missing: MissingBooking[];      // Werktage mit fehlender/zu geringer Buchung
  missing_checked_until: string;  // min(Stichtag, Stand des Exports)
  outside: OutsideBooking[];      // Projektbuchungen außerhalb des Teams (s. Einsatzzeitraum)
  guests: string[];               // Rolle „darf buchen“ (Konfiguration)
  guest_bookings: GuestBooking[]; // deren Projektbuchungen (rule: string | null, invoiced, net)
  forecast: Forecast;             // { from, to, reference_*, persons (Faktoren, Prognose h/€),
                                  //   months (Ist/Prognose je Monat), budgets (BudgetStatus), notes }
  forecast_accuracy: AccuracyMonth[]; // { month, actual_net, backtest_net, recorded_net?, recorded_on? }
  vacation: VacationStatus[];     // { person, year, entitlement, carry_over, taken, planned, remaining }
  overview: ParsedExport;         // Rohdaten-Übersicht (Tab „Import“)
}

interface OutsideBooking {
  person: string; date: string; element: string; kost2art: string; hours: number;
  reason: "outside_assignment" | "not_in_team";
  invoiced: boolean; billed_hours: number; net: number;
}

interface PersonResult {
  name: string;
  assignments: { from: string; to: string | null }[];  // Einsatzzeiträume (Konfiguration)
  ytd: PeriodData;
  by_month: Record<string, PeriodData>;   // Key: "2026-10"
  by_week: Record<string, PeriodData>;    // Key: "2026-W43"
  month_weeks: Record<string, Record<string, PeriodData>>;
  locations: { ytd: LocationShare[]; by_month: Record<string, LocationShare[]> };
}

interface LocationShare { location: string; hours: number; share: number; days: number }

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
  missing_days: number; // Werktage mit fehlender Buchung
}
```

---

## UI-Anforderungen

### Hauptansicht
1. **Sidebar links**: Projektliste + "Neues Projekt"-Button
2. **Mitte oben**: Drag-and-Drop-Zone (oder Datei-Browser)
3. **Mitte**: Auswertungsergebnis (Tabs: Jahr / Monate / Wochen / Stundenkonto / Arbeitsort / Rechnung / Prognose / Insights / Import)
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
7. **Config-Speicherort**: `projects/` neben der Programmdatei (`projects_dir_beside(current_exe)`,
   Dateiname = `<id>.json`) – jede Kopie der App ist eine eigene Instanz mit eigenen Projekten,
   mehrere Instanzen laufen parallel. Früherer Ort `app_data_dir()/projects/`: fehlende Projekte
   lassen sich in einer leeren Instanz per Button übernehmen (`import_legacy_projects`, kopiert).
   Im Dev-Modus liegt der Ordner unter `src-tauri/target/debug/projects/` (nicht im Repository).
   **Letzte Import-Datei** je Projekt: nach erfolgreichem Einlesen (Drop/Dateidialog) Kopie
   nach `Import/<id>/<Original-Dateiname>` neben der Exe (Dateiname + Änderungsdatum bleiben →
   „Stand“ des Exports), dazu `import.json` (Originalpfad, Zeitpunkt); ältere Kopie wird
   ersetzt. Beim Start/Projektwechsel wird die Kopie automatisch ausgewertet; Projekt ohne
   gemerkte Datei → leere Drop-Zone. Projekt löschen entfernt auch `Import/<id>/` und
   `Prognosen/<id>.json` (gespeicherte Prognosen, s. Prognosegüte).
   **Fenster**: Position/Größe/maximiert über `tauri-plugin-window-state` in
   `window-state.json` neben der Exe (absoluter Dateiname ersetzt `app_config_dir`).
   Gespeichert wird 500 ms nach dem letzten Verschieben/Ändern der Größe (und beim
   Beenden) – **auf dem Haupt-Thread** (`run_on_main_thread`), sonst Deadlock mit den
   Fenster-Ereignissen des Plugins. Erster Start ohne gespeicherten Zustand: zentriert.
   Danach `window::fit_to_screen`: Fenster muss in den nutzbaren Bereich (`work_area`,
   ohne Taskleiste) des Bildschirms mit der größten Überdeckung passen (sonst
   Hauptbildschirm, zentriert) – zu groß → verkleinern, überstehend → verschieben,
   Bereich kleiner als minWidth/minHeight → maximieren; maximiert/Vollbild bleibt.
   Läuft sofort (wenn die Maße plausibel sind) und 400 ms später erneut (GTK liefert
   vor dem Anzeigen unsinnige Maße).
8. **Drag & Drop**: HTML5-Drop liefert in Tauri keine Pfade → `getCurrentWebview().onDragDropEvent()` verwenden
9. **IPC-Argumente**: Tauri mappt camelCase (JS) auf snake_case (Rust): `invoke("parse_export", { filePath, projectId })`

