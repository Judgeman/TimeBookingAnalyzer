# Beispieldaten (fiktiv)

Alle Namen, Projekte, Stundensätze und Buchungen sind ausgedacht. Echte
Projektkonfigurationen gehören **nicht** ins Repository – sie liegen nur lokal im
App-Datenverzeichnis (siehe Haupt-README).

| Datei | Inhalt |
| ----- | ------ |
| `Beispiel-Export_2026-10-31.xlsx` | ProjectForge-ähnlicher Export, 01.01.–30.10.2026, Blatt „Details“ |
| `beispiel-projekt.json` | Passende Projektkonfiguration „Musterkunde GmbH / Lager-App“ |

Enthalten sind u. a.: Feiertage Hessen (ohne Buchungen), Urlaub/Krank mit 8 h/Tag,
ein halber Krankheitstag, ein Urlaubstag an einem Samstag (wird hervorgehoben),
Wochenend-Buchungen (eine davon mit Mult 0), Reisezeit mit Mult 0,5, Key-User-Schulungen
(eigene Regel mit 7 % USt.), Sales- und interne Buchungen sowie eine Person außerhalb
des Projektteams („Jonas Beispiel“). Arbeitsorte: „Home Office“, „Büro“, „Kunde vor Ort“. Fehlende Buchungen: Erika
am 20.10. ohne Buchung, Max am 22.10. nur 2 von 6 h; Erika am 16.09. mit 4 von 7,5 h
(53 %) liegt knapp über der 50-%-Schwelle. Max Mustermann hat ab September eine abweichende
Arbeitszeit von 6 h/Tag.

Zum Ausprobieren in der App: `beispiel-projekt.json` in den Projektordner kopieren
und danach die `.xlsx` in das Fenster ziehen.

Export neu erzeugen (Generator: `src-tauri/examples/generate_sample_export.rs`):

```bash
cd src-tauri && cargo run --example generate_sample_export
```
