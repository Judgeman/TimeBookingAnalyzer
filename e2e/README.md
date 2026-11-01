# E2E-Tests (Desktop-App)

Klicktests der echten App über [`tauri-driver`](https://v2.tauri.app/develop/tests/webdriver/)
(WebDriver) mit den fiktiven Beispieldaten aus `sample-data/`. Ohne zusätzliche
npm-Pakete: Node ≥ 20 mit eingebautem `fetch` und `node:test`.

Die Tests laufen mit einem eigenen, temporären App-Datenverzeichnis – echte
Projekte auf dem Rechner werden nicht angefasst.

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
| `run.mjs` | startet `tauri-driver` mit isoliertem Datenverzeichnis und `node --test` |
| `webdriver.mjs` | minimaler WebDriver-Client (Session, Script, Klick, Eingabe, Drop) |
| `helpers.mjs` | `withApp()`: App starten, Projekte zurücksetzen, Screenshot, Wiederholung |
| `tests/*.test.mjs` | die Tests |
