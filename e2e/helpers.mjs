import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AppSession, isConnectionError } from "./webdriver.mjs";

export const env = {
  app: process.env.E2E_APP,
  sample: process.env.E2E_SAMPLE_EXPORT,
  sampleProject: process.env.E2E_SAMPLE_PROJECT,
  dataDir: process.env.E2E_DATA_DIR,
  artifacts: process.env.E2E_ARTIFACTS,
};

/** Projektordner der App im Test-Datenverzeichnis (Linux: XDG_DATA_HOME, Windows: APPDATA). */
const projectsDir = () => join(env.dataDir, "de.judgeman.billingtracker", "projects");

/** Setzt die Projekte zurück: ohne Projekt oder mit dem fiktiven Beispielprojekt. */
export function resetProjects({ withSample }) {
  rmSync(projectsDir(), { recursive: true, force: true });
  mkdirSync(projectsDir(), { recursive: true });
  if (withSample) copyFileSync(env.sampleProject, join(projectsDir(), "beispiel-lager-app.json"));
}

/**
 * Startet die App, führt `body` aus und beendet sie wieder. Bei einem
 * Verbindungsabbruch des Treibers wird der Test einmal wiederholt; bei einem
 * Fehlschlag landet ein Screenshot in e2e/artifacts.
 */
export async function withApp(name, { withSample = true } = {}, body) {
  for (let attempt = 1; ; attempt++) {
    resetProjects({ withSample });
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
