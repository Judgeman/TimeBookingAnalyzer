# E2E-Tests (Desktop-App)

Klicktests der echten App über [`tauri-driver`](https://v2.tauri.app/develop/tests/webdriver/)
(WebDriver) mit den fiktiven Beispieldaten aus `sample-data/`. Ohne zusätzliche
npm-Pakete: Node ≥ 20 mit eingebautem `fetch` und `node:test`.

Die App wird für die Tests in einen temporären Ordner kopiert (bzw. per Hardlink
abgelegt) – ihre Projekte liegen daneben in `projects/`. Das App-Datenverzeichnis
(früherer Ablageort) ist ebenfalls temporär; echte Projekte werden nicht angefasst.

## Voraussetzungen

```bash
cargo install tauri-driver --locked
```

- **Linux:** `webkit2gtk-driver` (liefert `WebKitWebDriver`), ohne Desktop zusätzlich `xvfb`
- **Windows:** [Microsoft Edge Driver](https://developer.microsoft.com/microsoft-edge/tools/webdriver/)
  passend zur installierten Edge-Version; Pfad über `E2E_NATIVE_DRIVER` angeben
- **macOS:** von `tauri-driver` nicht unterstützt

## Ausführen

```bash
npm run build:e2e
```

```bash
npm run test:e2e
```

Ohne Desktop (Linux, z. B. CI):

```bash
xvfb-run -a npm run test:e2e
```

Bei einem Fehlschlag liegt ein Screenshot unter `e2e/artifacts/<test>.png`.
Verliert der Treiber die Verbindung (bei WebKitWebDriver unter Xvfb gelegentlich),
wird der betroffene Test einmal wiederholt.

## Aufbau

| Datei | Inhalt |
| --- | --- |
| `run.mjs` | legt die App in einen temporären Ordner, startet `tauri-driver` (isoliertes Datenverzeichnis) und `node --test` |
| `webdriver.mjs` | minimaler WebDriver-Client (Session, Script, Klick, Eingabe, Drop) |
| `helpers.mjs` | `withApp()`: App starten, Projekte/Importe/Fensterzustand zurücksetzen (`keepData` = Neustart), Screenshot, Wiederholung |
| `tests/*.test.mjs` | die Tests |
