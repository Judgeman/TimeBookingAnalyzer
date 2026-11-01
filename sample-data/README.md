# Beispieldaten (fiktiv)

Alle Namen, Projekte, Stundensätze und Buchungen sind ausgedacht. Echte
Projektkonfigurationen gehören **nicht** ins Repository – sie liegen nur lokal im
App-Datenverzeichnis (siehe Haupt-README).

| Datei | Inhalt |
| ----- | ------ |
| `Beispiel-Export_2026-10-31.xlsx` | ProjectForge-ähnlicher Export, 01.01.–30.10.2026, Blatt „Details“ |
| `beispiel-projekt.json` | Passende Projektkonfiguration „Musterkunde GmbH / Lager-App“ |

Enthalten sind u. a.: Feiertage Hessen (ohne Buchungen), Urlaub/Krank mit 8 h/Tag,
Wochenend-Buchungen (eine davon mit Mult 0), Reisezeit mit Mult 0,5, Sales- und
interne Buchungen sowie eine Person außerhalb des Projektteams („Jonas Beispiel“).

Zum Ausprobieren in der App: `beispiel-projekt.json` in den Projektordner kopieren
und danach die `.xlsx` in das Fenster ziehen.

Export neu erzeugen (Generator: `src-tauri/examples/generate_sample_export.rs`):

```bash
cd src-tauri && cargo run --example generate_sample_export
```
