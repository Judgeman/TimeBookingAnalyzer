// E2E-Tests der Desktop-App mit den fiktiven Beispieldaten (sample-data/).
// Start: npm run build:e2e && npm run test:e2e   (Details: e2e/README.md)
import assert from "node:assert/strict";
import { test } from "node:test";
import { env, withApp } from "../helpers.mjs";

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

    await app.click("button", "Monate");
    await app.waitForText("Jahr bis Stichtag");
    await app.execute(
      "[...document.querySelectorAll('tbody tr')].find((r) => r.textContent.includes('Oktober 2026')).click()",
    );
    await app.waitForText("KW 43");
    assert.ok((await app.text()).includes("! 1 fehlende Buchung"));

    await app.click("button", "Stundenkonto");
    await app.waitForText("Krankheit als Fehlzeit");
    assert.ok((await app.text()).includes("Erika Mustermann hat Überstunden"));

    await app.click("button", "Arbeitsort");
    await app.waitForText("Home-Office-Anteil");
    assert.ok((await app.text()).includes("20,2 %"));
    const slices = await app.execute(
      "return document.querySelectorAll('svg[role=img] path, svg[role=img] circle').length",
    );
    assert.equal(slices, 3);

    await app.click("button", "Rechnung");
    await app.waitForText("Netto pro Person und Monat");
    const text = await app.text();
    for (const expected of ["292.985,00 €", "55.612,27 €", "348.597,27 €", "USt. 7 % / 19 %"]) {
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
    await app.click("button", "Rechnung");
    // 9 Reise-Montage à 2 h: 1.660 € → 2 h × Mult 0,5 × 50 % = 415 € ⇒ netto −1.245 €
    await app.waitForText("291.740,00 €");
  }));

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
