// Startet tauri-driver mit isoliertem Datenverzeichnis und führt die E2E-Tests aus.
// Voraussetzung: npm run build:e2e (Debug-App mit eingebettetem Frontend).
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { waitForDriver } from "./webdriver.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exe = process.platform === "win32" ? "billing-tracker.exe" : "billing-tracker";
const builtApp = process.env.E2E_APP ?? join(root, "src-tauri", "target", "debug", exe);

if (!existsSync(builtApp)) {
  console.error(`App nicht gefunden: ${builtApp}\nZuerst bauen: npm run build:e2e`);
  process.exit(1);
}

const dataDir = mkdtempSync(join(tmpdir(), "billing-tracker-e2e-"));

// Die App legt ihre Projekte neben der Programmdatei ab – daher eine eigene
// Kopie (bzw. einen Hardlink) in einem temporären Ordner starten.
const appDir = join(dataDir, "app");
mkdirSync(appDir);
const app = join(appDir, basename(builtApp));
try {
  linkSync(builtApp, app);
} catch {
  copyFileSync(builtApp, app);
}
const loader = join(dirname(builtApp), "WebView2Loader.dll");
if (existsSync(loader)) copyFileSync(loader, join(appDir, "WebView2Loader.dll"));
const env = {
  ...process.env,
  // App-Datenverzeichnis umleiten (früherer Ablageort der Projekte, WebView-Daten).
  XDG_DATA_HOME: dataDir,
  APPDATA: dataDir,
  // GTK: Barrierefreiheits-Bus nicht suchen – ohne laufenden AT-SPI-Dienst
  // (z. B. in CI) wartet jeder App-Start sonst ~30 s auf eine Zeitüberschreitung.
  NO_AT_BRIDGE: "1",
  E2E_APP: app,
  E2E_DATA_DIR: dataDir,
  E2E_SAMPLE_EXPORT: join(root, "sample-data", "Beispiel-Export_2026-10-31.xlsx"),
  E2E_SAMPLE_PROJECT: join(root, "sample-data", "beispiel-projekt.json"),
  E2E_ARTIFACTS: join(root, "e2e", "artifacts"),
};

const driverArgs = process.env.E2E_NATIVE_DRIVER ? ["--native-driver", process.env.E2E_NATIVE_DRIVER] : [];
const driver = spawn(process.env.TAURI_DRIVER ?? "tauri-driver", driverArgs, {
  env,
  stdio: ["ignore", "ignore", "inherit"],
});
driver.on("error", (error) => {
  console.error(`tauri-driver konnte nicht gestartet werden (${error.message}). Siehe e2e/README.md.`);
  process.exit(1);
});

let status = 1;
try {
  await waitForDriver();
  const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", "e2e/tests/*.test.mjs"], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  status = result.status ?? 1;
} finally {
  driver.kill();
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(status);
