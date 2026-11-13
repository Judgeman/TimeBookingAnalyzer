// E2E-Tests der Desktop-App mit den fiktiven Beispieldaten (sample-data/).
// Start: npm run build:e2e && npm run test:e2e   (Details: e2e/README.md)
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { test } from "node:test";
import {
  env,
  forecastDir,
  importDir,
  legacyDir,
  projectForgeDir,
  projectsDir,
  resetProjects,
  settingsFile,
  waitUntil,
  windowStateFile,
  withApp,
} from "../helpers.mjs";

/** Stichtag über das Datumsfeld setzen (Schnellwahl hängt vom heutigen Tag ab). */
async function setCutoff(app, iso) {
  await app.execute(`const input = [...document.querySelectorAll('input[type="date"]')]
      .find((i) => i.closest("label")?.textContent.includes("Stichtag"));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "${iso}");
    input.dispatchEvent(new Event("input", { bubbles: true }));`);
}

async function loadSample(app) {
  await app.waitForText("Musterkunde GmbH / Lager-App");
  await app.dropFile(env.sample);
  await app.waitForText("Auswertung 01.01.");
  await setCutoff(app, "2026-10-31");
  await app.waitForText("Auswertung 01.01.2026 – 31.10.2026");
}

test("Projekt über die Oberfläche anlegen", () =>
  withApp("projekt-anlegen", { withSample: false }, async (app) => {
    await app.waitForText("Noch keine Projekte angelegt.");
    // Versionsnummer aus package.json in der Seitenleiste und im Titel
    const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    await app.waitForText(`Billing Tracker ${version}`);
    assert.equal(await app.execute("return document.title"), `Billing Tracker ${version}`);
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

    // Wochen: Kalender der Stichtag-Woche (Mo–So), Buchungen als Blöcke mit Uhrzeit
    await app.tab("Wochen");
    await app.waitForText("KW 44 · 26.10.2026 – 01.11.2026");
    const blocks = await app.execute(
      `return [...document.querySelectorAll('[data-day="2026-10-30"] [role="note"]')].map((b) => b.firstChild.textContent)`,
    );
    assert.deepEqual(blocks, ["08:00 – 14:30", "15:00 – 16:30"]);
    assert.ok((await app.text()).includes("So. 1.11."));
    await app.click("button", "Team gesamt");
    await app.waitForText("Team: ");
    await app.click("button", "Erika Mustermann");
    await app.click("button", "Tabelle");
    await app.waitForText("Kalenderwoche");

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

test("Ohne Zeiterfassung: abgerechnet und in der Prognose, aber keine Zeitkontrolle", () =>
  withApp("ohne-zeiterfassung", {}, async (app) => {
    await loadSample(app);
    await app.waitForText("! 2 fehlende Buchungen"); // Erika 20.10., Max 22.10.

    // Max: Export enthält nicht alle seine Buchungen → ohne Zeiterfassung
    await app.click("button", "Projekt bearbeiten");
    await app.waitForText("Ohne Zeiterfassung (Export enthält nicht alle Buchungen der Person)");
    await app.execute(`const card = [...document.querySelectorAll('input[aria-label="Name"]')]
        .find((i) => i.value === "Max Mustermann").closest("div.rounded-lg");
      [...card.querySelectorAll("label")]
        .find((l) => l.textContent.startsWith("Ohne Zeiterfassung"))
        .querySelector('input[type="checkbox"]').click();`);
    await app.click("button", "Speichern");
    await app.waitForText("! 1 fehlende Buchung"); // nur noch Erika

    // keine Zeitkontrolle: Max fehlt bei den Personen, seine Projektbuchungen
    // stehen im Hinweis „Darf buchen“ (gekennzeichnet)
    const names = await app.execute(`return [...document.querySelectorAll("select[aria-label='Filter Person'] option")]
      .map((o) => o.textContent)`);
    assert.deepEqual(names, ["Alle Personen", "Max Mustermann", "Karl Beispiel"]);
    assert.ok(await app.execute(`return [...document.querySelectorAll("td")]
      .some((td) => td.textContent === "Max Mustermannohne Zeiterfassung")`));
    await app.tab("Monate");
    await app.waitForText("Team gesamt");
    assert.ok(!(await app.execute(`return [...document.querySelectorAll("button")]
      .some((b) => b.textContent === "Max Mustermann")`)));
    const saved = readdirSync(projectsDir())
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(projectsDir(), f), "utf8")))
      .flatMap((p) => p.team)
      .find((m) => m.name === "Max Mustermann");
    assert.equal(saved.untracked, true);

    // Rechnung unverändert, Max gekennzeichnet; Prognose über die Auslastung
    await app.tab("Rechnung");
    await app.waitForText("319.865,00 €");
    assert.ok(await app.execute(`return [...document.querySelectorAll("th")]
      .some((th) => th.textContent === "Max Mustermannohne Zeiterfassung")`));
    await app.tab("Prognose");
    await app.waitForText("Prognose je Person");
    const max = await app.execute(`return [...document.querySelectorAll("tr")]
      .find((tr) => tr.querySelector("td")?.textContent === "Max Mustermann").textContent`);
    assert.match(max, /Auslastung \d+(,\d)? %ohne Zeiterfassung/);
  }));

test("Billable-Spalte: entscheidet über die Abrechnung, Abweichungen werden gelistet", () =>
  withApp("billable-spalte", {}, async (app) => {
    await loadSample(app);
    assert.ok(!(await app.text()).includes("Billable-Spalte weicht"));

    // Export-Format: Billable-Spalte O, Wahrheitswerte automatisch (ohne eigene Werte)
    await app.click("button", "Projekt bearbeiten");
    await app.waitForText("Billable-Spalte (optional)");
    await app.waitForText("Wahrheitswerte werden automatisch erkannt:");
    await app.execute(`const s = document.querySelector('select[aria-label="Billable-Spalte"]');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, "14");
      s.dispatchEvent(new Event("change", { bubbles: true }));`);
    await app.waitForText("Eigener Wert „nicht billable“ (optional)");
    await app.click("button", "Speichern");
    await app.waitForText(
      "⚑ Billable-Spalte weicht bei 2 Buchungen von den Abrechnungsregeln ab (es gilt die Spalte): " +
        "3,00 h zusätzlich abgerechnet (+360,00 € netto) · 4,00 h nicht abgerechnet (−420,00 € laut Regel)",
    );
    const saved = readdirSync(projectsDir())
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(projectsDir(), f), "utf8")))[0];
    assert.deepEqual(saved.export_format.billable, { column: 14, yes: "", no: "" });

    // Rechnung nach der Spalte: + 3 h × 120 € (Karl) − 4 h × 105 € (Erika, 12.09.)
    await app.tab("Rechnung");
    await app.waitForText("319.805,00 €");
    // Import: Billable-Spalte in der Vorschau
    await app.tab("Import");
    await app.waitForText("Erste 25 von 892 Buchungen");
    assert.ok(await app.execute(`return [...document.querySelectorAll("th")].some((th) => th.textContent === "Billable")`));

    // falsche Spalte (H = Tätigkeit): nichts ist billable, deutlicher Hinweis
    await app.click("button", "Projekt bearbeiten");
    await app.waitForText("Billable-Spalte (optional)");
    await app.execute(`const s = document.querySelector('select[aria-label="Billable-Spalte"]');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, "7");
      s.dispatchEvent(new Event("change", { bubbles: true }));`);
    await app.click("button", "Speichern");
    await app.waitForText("mit unbekanntem Wert in der Billable-Spalte H – gefunden:");
    assert.ok((await app.text()).includes("Diese Buchungen gelten als nicht billable"));
    await app.tab("Rechnung");
    await app.waitForText("Bis zum Stichtag gibt es keine abrechenbaren Stunden");
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

    // Filter: nur nicht abgerechnete Buchungen
    await app.execute(`const s = document.querySelector('select[aria-label="Filter abgerechnet"]');
      s.closest("details").open = true;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, "no");
      s.dispatchEvent(new Event("change", { bubbles: true }));`);
    await app.waitForText("Auswahl: 2 von 3 Buchungen · 5,00 h aufs Projekt · 5,00 h nicht abgerechnet");

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
    await setCutoff(app, "2026-10-31");
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

test("Fenster: zu groß oder außerhalb des Bildschirms → passend und vollständig sichtbar", async () => {
  const cases = [
    // vom großen Monitor auf einen kleineren Bildschirm → verkleinert
    { name: "zu-gross", saved: { x: 100, y: 50, width: 2560, height: 1400 }, fill: true },
    // ragt rechts unten heraus → in den Bildschirm geschoben, Größe bleibt
    { name: "halb-ausserhalb", saved: { x: 1200, y: 900, width: 1000, height: 700 }, corner: true },
    // gespeicherter Monitor fehlt → sichtbar, Größe bleibt
    { name: "monitor-fehlt", saved: { x: 3000, y: 200, width: 1000, height: 700 } },
  ];
  for (const c of cases) {
    resetProjects({ withSample: true });
    writeFileSync(
      windowStateFile(),
      JSON.stringify({
        main: { ...c.saved, prev_x: c.saved.x, prev_y: c.saved.y, maximized: false, visible: true, decorated: true, fullscreen: false },
      }),
    );
    await withApp(`fenster-${c.name}`, { keepData: true, resize: false }, async (app) => {
      await app.waitForText("Musterkunde GmbH / Lager-App");
      const screen = await app.execute("return { width: screen.width, height: screen.height }");
      const expected = (r) =>
        c.fill
          ? r.x === 0 && r.y === 0 && r.width === screen.width && r.height === screen.height
          : r.width === 1000 &&
            r.height === 700 &&
            r.x >= 0 &&
            r.y >= 0 &&
            r.x + r.width <= screen.width &&
            r.y + r.height <= screen.height &&
            (!c.corner || (r.x === screen.width - 1000 && r.y === screen.height - 700));
      // angepasst wird, sobald das Fenster angezeigt ist
      let rect;
      for (let i = 0; i < 50; i++) {
        rect = await app.windowRect();
        if (expected(rect)) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.ok(expected(rect), `${c.name}: ${JSON.stringify(rect)} auf ${JSON.stringify(screen)}`);
    });
  }
});

test("Prognose: Budget-Überziehung, Diagramm, Budget im Projekt ändern", () =>
  withApp("prognose", {}, async (app) => {
    await loadSample(app);
    await app.tab("Prognose");
    await app.waitForText("Prognose je Person");
    let text = await app.text();
    for (const expected of [
      "Rechnung November 2026 (laufender Monat)",
      "23.362,30 €",
      "Voraussichtliche Überziehung: 7.494,52 € über Budget zum Ende Dezember 2026",
      "Budget laut Prognose aufgebraucht am 17.12.2026.",
      "367.494,52 €",
      // Kachel „Prognose bis Ende“ = abgerechnet + Prognose für den Rest
      "Prognose bis Ende Dezember 2026",
      "Abgerechnet 319.865,00 € + Prognose 47.629,52 €",
      "Abweichung zum Budget",
    ]) {
      assert.ok(text.includes(expected), `fehlt: ${expected}`);
    }
    // laufender Monat: wann das Budget aufgebraucht ist
    const end = await app.execute(`return [...document.querySelectorAll("dt")]
      .find((dt) => dt.textContent === "Budget aufgebraucht am").nextElementSibling.textContent`);
    assert.equal(end, "17.12.2026");
    const chart = await app.execute(
      "return document.querySelector('svg[role=img]').getAttribute('aria-label')",
    );
    assert.equal(chart, "Abgerechnet und Prognose kumuliert mit Richtwert und Budget");

    // Budget im Projekt centgenau auf 400.000,55 € erhöhen → reicht (exakte Werte
    // dürfen die Formularprüfung des Browsers nicht blockieren)
    await app.click("button", "Projekt bearbeiten");
    await app.waitForText("Planung (Budget & Prognose)");
    await app.setValue('input[aria-label="Budget netto"]', "400000.55");
    await app.click("button", "Speichern");
    await app.waitForText("Auswertung 01.01.2026");
    await app.tab("Prognose");
    await app.waitForText("Budget reicht voraussichtlich: 32.506,03 € Rest zum Ende Dezember 2026");
    text = await app.text();
    assert.ok(!text.includes("aufgebraucht am"));
  }));

test("Stand des Exports zu früh: Prognose zählt abgerechnete Tage nicht doppelt", () =>
  withApp("stand-zu-frueh", {}, async (app) => {
    await app.waitForText("Musterkunde GmbH / Lager-App");
    // gleicher Export, Dateiname mit zu frühem Datum (Buchungen reichen bis 30.10.)
    const dir = mkdtempSync(join(tmpdir(), "export-"));
    const file = join(dir, "Beispiel-Export_2026-09-30.xlsx");
    copyFileSync(env.sample, file);
    await app.dropFile(file);
    await app.waitForText("Auswertung 01.01.");
    await setCutoff(app, "2026-10-31");
    await app.waitForText("Auswertung 01.01.2026 – 31.10.2026");
    await app.waitForText(
      "Der Export enthält abgerechnete Buchungen nach dem Stand des Exports (30.09.2026) – bis 30.10.2026.",
    );
    await app.tab("Prognose");
    await app.waitForText("Prognose deshalb erst ab 31.10.2026");
    // Oktober: abgerechnet, keine zusätzliche Prognose
    const october = await app.execute(`return [...document.querySelectorAll("tr")]
      .find((tr) => tr.querySelector("td")?.textContent.startsWith("Oktober 2026"))
      .querySelectorAll("td")[2].textContent`);
    assert.equal(october, "–");
  }));

test("Budget-Zeitraum endet vor dem Stand der Daten: kein Absturz", () =>
  withApp("budget-beendet", {}, async (app) => {
    await loadSample(app);
    // Beauftragung Januar–Juni (300.000 €) und Juli–Dezember (200.000 €):
    // die erste ist beim Stand 31.10. schon beendet
    await app.click("button", "Projekt bearbeiten");
    await app.waitForText("Planung (Budget & Prognose)");
    await app.click("button", "+ Budget-Zeitraum");
    await app.execute(`const set = (el, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      };
      const all = (label) => [...document.querySelectorAll('input[aria-label="' + label + '"]')];
      set(all("Budget bis")[0], "2026-06");
      set(all("Budget netto")[0], "300000");
      set(all("Budget von")[1], "2026-07");
      set(all("Budget bis")[1], "2026-12");
      set(all("Budget netto")[1], "200000");`);
    await app.click("button", "Speichern");
    await app.waitForText("Auswertung 01.01.2026");
    const saved = readdirSync(projectsDir())
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(projectsDir(), f), "utf8")))[0];
    assert.deepEqual(saved.budgets, [
      { from: "2026-01", to: "2026-06", amount: 300000 },
      { from: "2026-07", to: "2026-12", amount: 200000 },
    ]);
    await app.tab("Prognose");
    // neu ausgewertet: beide Beauftragungen wählbar
    await app.waitForText("2026-07 – 2026-12");
    const budgets = await app.execute(`return [...document.querySelectorAll('[aria-label="Budget-Zeitraum"] button')]
      .map((b) => b.textContent)`);
    assert.deepEqual(budgets, ["2026-01 – 2026-06", "2026-07 – 2026-12"]);
    // die beendete Beauftragung anzeigen: Ist 202.070 € von 300.000 €
    await app.click("button", "2026-01 – 2026-06");
    await app.waitForText("97.930,00 € Rest zum Ende Juni 2026");
    await app.tab("Insights");
    await app.waitForText("Pace des Teams");
    assert.ok((await app.text()).includes("Bezogen auf das aktuelle Budget Juli 2026 – Dezember 2026"));
  }));

test("Insights: Rekord-Monate, Pace und Hinweise", () =>
  withApp("insights", {}, async (app) => {
    await loadSample(app);
    await app.tab("Insights");
    await app.waitForText("Rekord-Monate (Team)");
    const text = await app.text();
    for (const expected of [
      "Das Team ruft 107 % des Richtwerts ab – bei diesem Tempo wird das Budget um 7.495 € überzogen.",
      "Meistes Budget liegen gelassen",
      "−5.442,50 €",
      "Meistes Budget abgerufen",
      "+14.350,00 €",
      "31.986,50 €",
      "Max Mustermann: +91,5 h Überstunden – Abbau einplanen.",
      "Meiste Minusstunden (Krank = Fehlzeit)",
      "−15,50 h",
      "Fehlende Buchungen aktuell",
      "Bis 30.10.2026 (Vortag des Exports)",
    ]) {
      assert.ok(text.includes(expected), `fehlt: ${expected}`);
    }
    assert.ok(!text.includes("Meiste fehlende Buchungen"));
    const bars = () => app.execute("return document.querySelectorAll('svg[role=img] g[role=button]').length");
    assert.equal(await bars(), 10); // Januar–Oktober

    // Diagramm „Abruf je Monat“: eigener Zeitraum März–Mai
    await app.execute(`const s = document.querySelector('select[aria-label="Zeitraum des Diagramms"]');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, "range");
      s.dispatchEvent(new Event("change", { bubbles: true }));`);
    await app.waitForText("Monate ohne Budget haben keinen Richtwert");
    await app.execute(`const set = (label, value) => {
        const el = document.querySelector('input[aria-label="' + label + '"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      };
      set("Zeitraum von", "2026-03");
      set("Zeitraum bis", "2026-05");`);
    await app.waitForText("3 Monate (März 2026 – Mai 2026): 84.955,00 € abgerufen, Richtwert 90.000,00 €");
    assert.equal(await bars(), 3);

    // Stichtag am Vortag des Exports: Oktober ist dann noch nicht abgeschlossen,
    // die aktuell fehlenden Buchungen bleiben dieselben
    await setCutoff(app, "2026-10-30");
    await app.waitForText("Auswertung 01.01.2026 – 30.10.2026");
    await app.tab("Insights");
    await app.waitForText("abgeschlossene Monate Januar 2026 – September 2026");
    const current = await app.execute(`return [...document.querySelectorAll("h3")]
      .find((h) => h.textContent === "Fehlende Buchungen aktuell")
      .closest("section").querySelectorAll("tbody tr").length`);
    assert.equal(current, 2); // Erika 20.10., Max 22.10.
  }));

test("Stundenkonto: Aufholen bis 31.12. je Person und im Team", () =>
  withApp("aufholen", {}, async (app) => {
    await loadSample(app);
    // Ende Oktober liegen alle über 100 % → kein Hinweis
    await app.tab("Stundenkonto");
    await app.waitForText("Krankheit als Fehlzeit");
    assert.ok(!(await app.text()).includes("Aufholen bis"));
    // Ende Juni: Erika −14,50 h, Max −5,00 h (Krankheit als Fehlzeit)
    await setCutoff(app, "2026-06-30");
    await app.waitForText("Auswertung 01.01.2026 – 30.06.2026");
    await app.waitForText("Aufholen bis 31.12.2026 – Krankheit als Fehlzeit");
    const section = () =>
      app.execute(`return document.querySelector('section[aria-label="Aufholen"]').textContent
        .replace(/\\s/g, " ")`);
    let text = await section();
    for (const expected of [
      "Mehr je Arbeitstag+0,14 h≈ 8 Min.",
      "7,50 → 7,64 h",
      "Es fehlen 14,50 h bis 100 % · 104 Arbeitstage bis 31.12.2026 (131 Werktage im Einsatz − 5 geplant abwesend − 22 offener Urlaub).",
      "+0,09 h je Arbeitstag, Anteil 9,82 h",
    ]) {
      assert.ok(text.includes(expected), `fehlt: ${expected}`);
    }
    await app.click("button", "Team gesamt");
    await app.waitForText("Aufholen bis 31.12.2026 – Team – Krankheit als Fehlzeit");
    text = await section();
    for (const expected of [
      "Team gesamt je Werktag+0,15 h19,50 h ÷ 131 Werktage",
      "Je Person und Arbeitstag+0,09 h19,50 h ÷ 206,5 Personen-Arbeitstage",
      "Max Mustermann−5,00102,56,50+0,05 h/Tag9,68 h6,50 → 6,59",
      // Budget 2026 ist laut Prognose schon überzogen
      "Mit dem restlichen Budget (Januar 2026 – Dezember 2026)",
      "schon ohne Aufholen ausgeschöpft (10.932,99 € über Budget)",
    ]) {
      assert.ok(text.includes(expected), `fehlt: ${expected}`);
    }

    // Budget nur bis November, laut Prognose 1.000 € Rest (erwartet 346.673,43 €)
    await app.click("button", "Projekt bearbeiten");
    await app.waitForText("Planung (Budget & Prognose)");
    await app.execute(`const set = (label, value) => {
        const el = document.querySelector('input[aria-label="' + label + '"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      };
      set("Budget bis", "2026-11");
      set("Budget netto", "347673.43");`);
    await app.click("button", "Speichern");
    await app.waitForText("Auswertung 01.01.2026 – 30.06.2026");
    await app.tab("Stundenkonto");
    await app.click("button", "Team gesamt");
    await app.waitForText("Mit dem restlichen Budget (Januar 2026 – November 2026)");
    text = await section();
    for (const expected of [
      "Rest laut Prognose1.000,00 €Budget 347.673,43 € − abgerechnet + Prognose 346.673,43 €",
      "Damit aufholbar10,01 hvon 19,50 h · Ø Satz 99,86 €",
      "Je Person und Arbeitstag bis 30.11.2026+0,06 h10,01 h ÷ 176,63 Personen-Arbeitstage",
      "Team gesamt je Werktag bis 30.11.2026+0,09 h10,01 h ÷ 109 Werktage",
      "Ohne Budget bleiben 9,49 h",
    ]) {
      assert.ok(text.includes(expected), `fehlt: ${expected}`);
    }
  }));

test("Resturlaub: Anspruch im Projekt, Rest und Hinweis in Insights", () =>
  withApp("resturlaub", {}, async (app) => {
    await loadSample(app);
    await app.tab("Insights");
    await app.waitForText("Urlaub 2026");
    let text = await app.text();
    for (const expected of [
      "Erika Mustermann: noch 12 Urlaubstage offen und nicht eingeplant – bis 31.12.2026 einplanen.",
      "Ohne Urlaubsanspruch 2026: Lena Beispiel",
    ]) {
      assert.ok(text.includes(expected), `fehlt: ${expected}`);
    }
    // Erikas Anspruch auf 25 Tage senken → Rest 7
    await app.click("button", "Projekt bearbeiten");
    await app.waitForText("Urlaubsanspruch");
    await app.setValue('input[aria-label="Urlaub Tage"]', "25");
    await app.click("button", "Speichern");
    await app.waitForText("Auswertung 01.01.2026");
    await app.tab("Insights");
    await app.waitForText("Erika Mustermann: noch 7 Urlaubstage offen");
  }));

test("Prognosegüte: nachgerechnet, gespeichert und beim nächsten Start verglichen", async () => {
  const saved = join(forecastDir(), "beispiel-lager-app.json");
  await withApp("prognoseguete", {}, async (app) => {
    await loadSample(app);
    await app.tab("Prognose");
    await app.waitForText("Prognosegüte");
    const text = await app.text();
    for (const expected of ["8,5 %", "im Schnitt 2 % zu hoch", "7 von 10", "+17,6 %", "noch keine"]) {
      assert.ok(text.includes(expected), `fehlt: ${expected}`);
    }
    // vollständiger Export → Prognose mit Stand 31.10. gespeichert
    await waitUntil(() => existsSync(saved), "Prognose nicht gespeichert");
    const snapshots = JSON.parse(readFileSync(saved, "utf8"));
    assert.deepEqual(snapshots.map((s) => s.data_end), ["2026-10-31"]);
  });
  // eine frühere Prognose (Stand 31.08.) ergänzen → Vergleich für September/Oktober
  const snapshots = JSON.parse(readFileSync(saved, "utf8"));
  snapshots.unshift({
    data_end: "2026-08-31",
    recorded_at: "2026-09-01T08:00:00",
    months: [
      { month: "2026-09", actual_net: 0, forecast_net: 31000 },
      { month: "2026-10", actual_net: 0, forecast_net: 31000 },
    ],
  });
  writeFileSync(saved, JSON.stringify(snapshots));
  await withApp("prognoseguete-neustart", { keepData: true }, async (app) => {
    await app.waitForText("Auswertung 01.01.");
    await setCutoff(app, "2026-10-31");
    await app.waitForText("Auswertung 01.01.2026 – 31.10.2026");
    await app.tab("Prognose");
    await app.waitForText("Stand 31.08.2026");
    assert.ok((await app.text()).includes("−9,9 %")); // September: 31.000 statt 34.400
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

/**
 * Nachgebildeter ProjectForge-Server (REST-API) mit fiktiven Buchungen vom
 * Vortag: Erika 8 h Delivery, Max 2 h Travel (billable, Arbeitsanteil 0).
 */
async function fakeProjectForge() {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const row = (id, person, hours, kost2, kind, name) => ({
    timesheet: {
      id,
      task: { id: 1, title: "P100 Lager-App", displayName: "P100 Lager-App (#1)" },
      user: { id: 40 + id, displayName: person },
      kost2: { id: kost2, displayName: `5.100.00.0${kind}: ${name} - Lager-App`, endziffer: kind },
      location: "Büro",
      startTime: `${yesterday}T07:00:00.000Z`,
      stopTime: `${yesterday}T${String(7 + hours).padStart(2, "0")}:00:00.000Z`,
    },
    id,
    durationMillis: hours * 3_600_000,
  });
  const rows = [
    row(1, "Erika Mustermann", 8, 501, 4, "Delivery (billable)"),
    row(2, "Max Mustermann", 2, 502, 5, "Travel (billable)"),
  ];
  const bookable = [
    {
      id: 1,
      name: "P100 Lager-App",
      path: [],
      kost2: [
        { id: 501, workFraction: 1.0, kost2Art: { id: 4, name: "Delivery (billable)" } },
        { id: 502, workFraction: 0.0, kost2Art: { id: 5, name: "Travel (billable)" } },
      ],
    },
  ];
  const requests = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
      const json = (data) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
      };
      if (req.headers.authorization !== "Bearer 42:geheim") {
        res.writeHead(302, { Location: "/login" });
        res.end();
      } else if (req.url === "/rs/bookableTasks") {
        json(bookable);
      } else if (req.method === "PUT" && req.url === "/rs/timesheet/list?doNotStore=true") {
        const { from, to } = JSON.parse(body).entries.find((e) => e.field === "period").value;
        const found = yesterday >= from && yesterday <= to ? rows : [];
        json({ resultSet: found, totalSize: found.length, resultSetTruncated: false });
      } else {
        res.writeHead(404);
        res.end();
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => server.close(),
  };
}

test("Datenquelle ProjectForge: Zugang einrichten, Buchungen abrufen, Neustart", async () => {
  const pf = await fakeProjectForge();
  try {
    await withApp("projectforge", {}, async (app) => {
      await app.waitForText("Musterkunde GmbH / Lager-App");
      await app.click("button", "ProjectForge-Zugang …");
      await app.waitForText("Schlüssel für Rest-Clients");
      await app.setValue('input[aria-label="Server-Adresse"]', pf.url);
      await app.setValue('input[aria-label="User-ID"]', "42");
      await app.setValue('input[aria-label="Schlüssel"]', "falsch");
      await app.click("button", "Speichern und Verbindung testen");
      await app.waitForText("ProjectForge hat die Anmeldung abgelehnt");
      await app.setValue('input[aria-label="Schlüssel"]', "geheim");
      await app.click("button", "Speichern und Verbindung testen");
      await app.waitForText("Verbindung steht: 1 buchbare Tasks, 2 Kostenarten.");
      // Schlüssel liegt nicht in settings.json (Test: Datei im Ordner „secrets“)
      assert.deepEqual(JSON.parse(readFileSync(settingsFile(), "utf8")), {
        projectforge: { base_url: pf.url, user_id: 42 },
      });
      assert.ok(readdirSync(env.secretsDir).length === 1);
      await app.click("button", "Schließen");

      // Datenquelle des Projekts umstellen → Abruf startet
      await app.click("button", "Projekt bearbeiten");
      await app.waitForText("Datenquelle");
      await app.execute(`document.querySelectorAll('input[name="data_source"]')[1].click()`);
      await app.click("button", "Speichern");
      await app.waitForText("Daten aus ProjectForge");
      await app.waitForText("Stand: ProjectForge – Abruf");
      const lists = pf.requests.filter((r) => r.url.startsWith("/rs/timesheet/list"));
      assert.ok(lists.length >= 12, `nur ${lists.length} Monate abgerufen`); // ab 1. Januar des Vorjahres
      assert.equal(lists[0].method, "PUT");
      assert.equal(lists[0].auth, "Bearer 42:geheim");
      const filter = JSON.parse(lists[0].body);
      assert.equal(filter.entries[0].field, "period");
      assert.match(filter.entries[0].value.from, /^\d{4}-01-01$/);
      assert.ok(existsSync(join(projectForgeDir(), "beispiel-lager-app.json")));
      await app.tab("Import");
      await app.waitForText("Erste 2 von 2 Buchungen");
    });

    // Neustart: abgerufene Daten sofort, dann einmal automatisch aktualisieren
    const before = pf.requests.length;
    await withApp("projectforge-neustart", { keepData: true }, async (app) => {
      await app.waitForText("Stand: ProjectForge – Abruf");
      await waitUntil(() => pf.requests.length > before, "kein automatischer Abruf nach dem Neustart");
      await app.waitForText("Letzter Abruf");
    });
  } finally {
    pf.close();
  }
});

