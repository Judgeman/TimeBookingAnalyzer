import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { AppSession, isConnectionError } from "./webdriver.mjs";

export const env = {
  app: process.env.E2E_APP,
  sample: process.env.E2E_SAMPLE_EXPORT,
  sampleProject: process.env.E2E_SAMPLE_PROJECT,
  dataDir: process.env.E2E_DATA_DIR,
  artifacts: process.env.E2E_ARTIFACTS,
};

/** Projektordner der App: `projects` neben der Programmdatei. */
export const projectsDir = () => join(dirname(env.app), "projects");

/** Letzte Import-Dateien je Projekt: `Import` neben der Programmdatei. */
export const importDir = () => join(dirname(env.app), "Import");

/** Früherer Ablageort im App-Datenverzeichnis (Linux: XDG_DATA_HOME, Windows: APPDATA). */
export const legacyDir = () => join(env.dataDir, "de.judgeman.billingtracker", "projects");

/**
 * Setzt die Projekte zurück: ohne Projekt oder mit dem fiktiven Beispielprojekt
 * (`withSample` im Projektordner, `legacySample` am früheren Ablageort).
 */
export function resetProjects({ withSample, legacySample = false }) {
  rmSync(importDir(), { recursive: true, force: true });
  for (const dir of [projectsDir(), legacyDir()]) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  }
  if (withSample) copyFileSync(env.sampleProject, join(projectsDir(), "beispiel-lager-app.json"));
  if (legacySample) copyFileSync(env.sampleProject, join(legacyDir(), "beispiel-lager-app.json"));
}

/**
 * Startet die App, führt `body` aus und beendet sie wieder. Bei einem
 * Verbindungsabbruch des Treibers wird der Test einmal wiederholt; bei einem
 * Fehlschlag landet ein Screenshot in e2e/artifacts.
 */
export async function withApp(
  name,
  { withSample = true, legacySample = false, keepData = false } = {},
  body,
) {
  for (let attempt = 1; ; attempt++) {
    // keepData: Projekte und Importe vom vorigen Start behalten (Neustart der App)
    if (!keepData) resetProjects({ withSample, legacySample });
    let session;
    try {
      session = await AppSession.start(env.app);
      await body(session);
      return;
    } catch (error) {
      if (session && !isConnectionError(error)) {
        try {
          mkdirSync(env.artifacts, { recursive: true });
          writeFileSync(join(env.artifacts, `${name}.png`), await session.screenshot());
        } catch {
          // Screenshot ist nur Komfort
        }
      }
      if (attempt < 2 && isConnectionError(error)) {
        console.warn(`[e2e] ${name}: Verbindung zum Treiber verloren – Wiederholung`);
        continue;
      }
      throw error;
    } finally {
      await session?.end();
    }
  }
}
