// E2E-Tests der Desktop-App mit den fiktiven Beispieldaten (sample-data/).
// Start: npm run build:e2e && npm run test:e2e   (Details: e2e/README.md)
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { test } from "node:test";
import {
  env,
  importDir,
  legacyDir,
  projectsDir,
  waitUntil,
  windowStateFile,
  withApp,
} from "../helpers.mjs";

async function loadSample(app) {
  await app.waitForText("Musterkunde GmbH / Lager-App");
  await app.dropFile(env.sample);
  await app.waitForText("Auswertung 01.01.");
  await app.click("button", "Stand des Exports");
  await app.waitForText("Auswertung 01.01.2026 – 31.10.2026");
}

test("Projekt über die Oberfläche anlegen", () =>
  withApp("projekt-anlegen", { withSample: false }, async (app) => {
    await app.waitForText("Noch keine Projekte angelegt.");
    await app.click("button", "+ Neues Projekt");
    await app.waitForText("Neues Projekt");
    await app.setValue('input[placeholder="Musterkunde GmbH / Lager-App"]', "Testprojekt");
    await app.setValue('input[placeholder="P100 Lager-App"]', "P100 Lager-App");
    await app.click("button", "+ Person");
    await app.setValue('input[aria-label="Name"]', "Erika Mustermann");
    await app.click("button", "Speichern");
    await app.waitForText("Element-Filter: P100 Lager-App");
    assert.match(await app.text(), /Testprojekt[\s\S]*1 Person/);
    // gespeichert im Ordner „projects“ neben der Programmdatei
    assert.equal(readdirSync(projectsDir()).filter((f) => f.endsWith(".json")).length, 1);
    assert.deepEqual(readdirSync(legacyDir()), []);
  }));

test("Projektordner neben der Exe; Projekte der Vorversion übernehmen", () =>
  withApp("vorversion", { withSample: false, legacySample: true }, async (app) => {
    await app.waitForText("1 Projekt aus früherer Version übernehmen");
    assert.ok((await app.text()).includes(`Projektordner: …${sep}app${sep}projects`));
    await app.execute(
      "[...document.querySelectorAll('button')].find((b) => b.textContent.startsWith('1 Projekt aus früherer Version')).click()",
    );
    await app.waitForText("Element-Filter: P100 Lager-App");
    assert.ok(existsSync(join(projectsDir(), "beispiel-lager-app.json")));
    assert.ok(existsSync(join(legacyDir(), "beispiel-lager-app.json"))); // Original bleibt
    assert.ok(!(await app.text()).includes("aus früherer Version"));
  }));

test("Beispielexport: Jahr, fehlende und hervorgehobene Buchungen", () =>
  withApp("auswertung", {}, async (app) => {
    await loadSample(app);
    const text = await app.text();
    for (const expected of [
      "Stand des Exports: 31.10.2026 (aus Dateiname)",
      "+41,00", // Erika Plus
      "+21,00", // Erika Plus (Krank = Fehlzeit)
      "+91,50", // Max Plus
      "1.570,00", // Max Soll brutto (Ausnahme 6 h/Tag ab September)
      "151.940,00 €",
      "! 2 fehlende Buchungen",
      "Fehlende Buchung – keine Buchung",
      "Fehlende Buchung – nur 33,33 % gebucht",
      "1 hervorgehobene Buchung(en) – werden mitgezählt",
      "Sa, 25.07.2026",
    ]) {
      assert.ok(text.includes(expected), `fehlt: ${expected}`);
    }
  }));

test("Tabs: Monate, Stundenkonto, Arbeitsort, Rechnung", () =>
  withApp("tabs", {}, async (app) => {
    await loadSample(app);

    await app.tab("Monate");
    await app.waitForText("Jahr bis Stichtag");
    await app.execute(
      "[...document.querySelectorAll('tbody tr')].find((r) => r.textContent.includes('Oktober 2026')).click()",
    );
    await app.waitForText("KW 43");
    assert.ok((await app.text()).includes("! 1 fehlende Buchung"));

    await app.tab("Stundenkonto");
    await app.waitForText("Krankheit als Fehlzeit");
    assert.ok((await app.text()).includes("Erika Mustermann hat Überstunden"));

    await app.tab("Arbeitsort");
    await app.waitForText("Home-Office-Anteil");
    assert.ok((await app.text()).includes("20,2 %"));
    const slices = await app.execute(
      "return document.querySelectorAll('svg[role=img] path, svg[role=img] circle').length",
    );
    assert.equal(slices, 3);

    await app.tab("Rechnung");
    await app.waitForText("Netto pro Person und Monat");
    const text = await app.text();
    for (const expected of ["319.865,00 €", "60.719,47 €", "380.584,47 €", "USt. 7 % / 19 %"]) {
      assert.ok(text.includes(expected), `fehlt: ${expected}`);
    }
  }));

test("Editor: Überschneidung wird abgelehnt, Regeländerung wirkt auf die Rechnung", () =>
  withApp("editor-regeln", {}, async (app) => {
    await loadSample(app);
    await app.click("button", "Projekt bearbeiten");
    await app.waitForText("Abrechnungsregeln");

    // Überschneidender Arbeitszeit-Zeitraum → Fehlermeldung vom Backend
    await app.execute(`const fs = [...document.querySelectorAll("fieldset")]
      .find((f) => f.querySelector("legend").textContent === "Arbeitszeit (Projekt)");
      [...fs.querySelectorAll("button")].find((b) => b.textContent.includes("Zeitraum")).click();`);
    await app.click("button", "Speichern");
    await app.waitForText("überschneiden sich");
    await app.execute(`const fs = [...document.querySelectorAll("fieldset")]
      .find((f) => f.querySelector("legend").textContent === "Arbeitszeit (Projekt)");
      const rm = fs.querySelectorAll('button[title="Zeitraum entfernen"]'); rm[rm.length - 1].click();`);

    // Sonstige billable (Travel): halber Satz und Mult anwenden
    await app.setValue("tbody tr:nth-child(3) input[aria-label='Satz %']", "50");
    await app.execute("document.querySelector(\"tbody tr:nth-child(3) input[aria-label='× Mult']\").click()");
    await app.click("button", "Speichern");
    await app.waitForText("Auswertung 01.01.2026");
    await app.tab("Rechnung");
    // 9 Reise-Montage à 2 h: 1.660 € → 2 h × Mult 0,5 × 50 % = 415 € ⇒ netto −1.245 €
    await app.waitForText("318.620,00 €");
  }));

test("Einsatzzeitraum: Buchungen außerhalb des Teams fallen sofort auf", () =>
  withApp("einsatzzeitraum", {}, async (app) => {
    await loadSample(app);
    // Banner über der Auswertung (vor allen Tabs)
    let text = await app.text();
    for (const expected of [
      "2 Buchungen auf das Projekt außerhalb des Teams",
      "2,00 h außerhalb des Einsatzzeitraums – abgerechnet (160,00 € netto)",
      "3,00 h von Personen, die nicht im Team sind – nicht abgerechnet",
      "im Projekt: 01.01.2026–28.02.2026",
    ]) {
      assert.ok(text.includes(expected), `fehlt: ${expected}`);
    }
    const badge = await app.execute(
      "return [...document.querySelectorAll('[role=tab]')].find((t) => t.textContent.startsWith('Rechnung')).textContent",
    );
    assert.equal(badge, "Rechnung⚠ 2");

    // Lena ist nur Januar/Februar im Projekt
    await app.tab("Monate");
    await app.click("button", "Lena Beispiel");
    await app.waitForText("nicht im Projekt");
    assert.ok((await app.text()).includes("⚠ 1 außerhalb des Teams"));

    await app.tab("Rechnung");
    await app.waitForText("⚠ enthält Buchungen außerhalb des Einsatzzeitraums");
    text = await app.text();
    for (const expected of [
      "Diese Rechnung enthält 2,00 h (160,00 € netto)",
      "3,00 h von Personen, die nicht im Team sind, sind nicht abgerechnet (Jonas Beispiel)",
    ]) {
      assert.ok(text.includes(expected), `fehlt: ${expected}`);
    }
  }));

test("Darf buchen: Buchungen ohne Zeiterfassung, abgerechnet nach Kost2Art", () =>
  withApp("darf-buchen", {}, async (app) => {
    await loadSample(app);
    let text = await app.text();
    assert.ok(
      text.includes(
        "ℹ Darf buchen (ohne Zeiterfassung): 9,00 h aufs Projekt · 4,00 h abgerechnet (480,00 € netto) · 5,00 h nicht abgerechnet",
      ),
    );
    assert.ok(text.includes("2 Buchungen auf das Projekt außerhalb des Teams"));

    await app.tab("Rechnung");
    await app.waitForText("Netto pro Person und Monat");
    const header = await app.execute(
      "return [...document.querySelectorAll('th')].find((th) => th.textContent.startsWith('Karl Beispiel')).textContent",
    );
    assert.equal(header, "Karl Beispieldarf buchen");

    // Jonas (bisher „nicht im Team“) bekommt die Rolle „darf buchen“ mit 100 €/h
    await app.click("button", "Projekt bearbeiten");
    await app.waitForText("Darf buchen (ohne Zeiterfassung)");
    await app.click("button", "+ Person (darf buchen)");
    await app.execute(`const fs = [...document.querySelectorAll("fieldset")]
      .find((f) => f.querySelector("legend").textContent === "Darf buchen (ohne Zeiterfassung)");
      const set = (el, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      };
      const names = fs.querySelectorAll('input[aria-label="Name (darf buchen)"]');
      set(names[names.length - 1], "Jonas Beispiel");
      const add = [...fs.querySelectorAll("button")].filter((b) => b.textContent === "+ Stundensatz");
      add[add.length - 1].click();`);
    await app.execute(`const fs = [...document.querySelectorAll("fieldset")]
      .find((f) => f.querySelector("legend").textContent === "Darf buchen (ohne Zeiterfassung)");
      const rates = fs.querySelectorAll('input[type="number"]');
      const el = rates[rates.length - 1];
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "100");
      el.dispatchEvent(new Event("input", { bubbles: true }));`);
    await app.click("button", "Speichern");
    await app.waitForText("1 Buchung auf das Projekt außerhalb des Teams");
    text = await app.text();
    assert.ok(text.includes("12,00 h aufs Projekt · 7,00 h abgerechnet (780,00 € netto)"), text.slice(0, 2000));
    await app.tab("Rechnung");
    await app.waitForText("320.165,00 €"); // + 3 h × 100 € (Code-Review am 01.10.)
  }));

test("Letzte Import-Datei: Kopie im Ordner „Import“, beim Neustart automatisch geladen", async () => {
  const copy = join(importDir(), "beispiel-lager-app", "Beispiel-Export_2026-10-31.xlsx");
  await withApp("import-merken", {}, async (app) => {
    await loadSample(app);
    await app.waitForText("Als letzter Import gemerkt");
    assert.ok(existsSync(copy));
    const meta = JSON.parse(readFileSync(join(importDir(), "beispiel-lager-app", "import.json"), "utf8"));
    assert.equal(meta.original_path, env.sample);
  });
  // Neustart ohne Drop: die Kopie wird ausgewertet
  await withApp("import-neustart", { keepData: true }, async (app) => {
    await app.waitForText("Auswertung 01.01.");
    await app.waitForText("Als letzter Import gemerkt");
    await app.click("button", "Stand des Exports");
    await app.waitForText("Auswertung 01.01.2026 – 31.10.2026");
    assert.ok((await app.text()).includes("Stand des Exports: 31.10.2026 (aus Dateiname)"));
    // Projekt löschen entfernt auch die Kopie
    await app.click("button", "Projekt bearbeiten");
    await app.click("button", "Projekt löschen");
    await app.click("button", "Ja, löschen");
    await app.waitForText("Noch keine Projekte angelegt.");
    assert.ok(!existsSync(copy));
  });
});

test("Fenster: Position und Größe vom letzten Aufruf (gespeichert neben der Exe)", async () => {
  const saved = () =>
    existsSync(windowStateFile()) ? JSON.parse(readFileSync(windowStateFile(), "utf8")).main : null;
  const rect = { x: 40, y: 30, width: 1000, height: 700 };
  await withApp("fenster-verschieben", { resize: false }, async (app) => {
    await app.waitForText("Musterkunde GmbH / Lager-App");
    await app.setWindowRect(rect);
    // gespeichert wird kurz nach dem Verschieben – nicht erst beim Beenden
    await waitUntil(
      () => saved()?.x === rect.x && saved()?.width === rect.width,
      `Fensterzustand nicht gespeichert: ${JSON.stringify(saved())}`,
    );
  });
  await withApp("fenster-neustart", { keepData: true, resize: false }, async (app) => {
    await app.waitForText("Musterkunde GmbH / Lager-App");
    assert.deepEqual(await app.windowRect(), rect);
  });
});

test("Fehlende Buchungen: Schwelle im Projekt einstellbar", () =>
  withApp("schwelle", {}, async (app) => {
    await loadSample(app);
    await app.click("button", "Projekt bearbeiten");
    await app.waitForText("Fehlende Buchung unter (%)");
    await app.execute(`const input = [...document.querySelectorAll("label")]
      .find((l) => l.textContent.includes("Fehlende Buchung unter")).querySelector("input");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "60");
      input.dispatchEvent(new Event("input", { bubbles: true }));`);
    await app.click("button", "Speichern");
    // 16.09.: 4 von 7,5 h = 53,33 % liegt jetzt unter der Schwelle
    await app.waitForText("! 3 fehlende Buchungen");
    assert.ok((await app.text()).includes("nur 53,33 % gebucht"));
  }));
