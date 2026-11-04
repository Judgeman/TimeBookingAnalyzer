// E2E-Tests der Desktop-App mit den fiktiven Beispieldaten (sample-data/).
// Start: npm run build:e2e && npm run test:e2e   (Details: e2e/README.md)
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { test } from "node:test";
import {
  env,
  forecastDir,
  importDir,
  legacyDir,
  projectsDir,
  resetProjects,
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

test("Einsatzzeitraum: außerhalb wie „darf buchen“ – neutral statt rot, weiter abgerechnet", () =>
  withApp("einsatz-darf-buchen", {}, async (app) => {
    await loadSample(app);
    await app.waitForText("2 Buchungen auf das Projekt außerhalb des Teams");

    // Lena (Einsatz Januar/Februar) darf danach wie „darf buchen“ aufs Projekt buchen
    await app.click("button", "Projekt bearbeiten");
    await app.waitForText("Außerhalb des Einsatzzeitraums wie „darf buchen“ behandeln");
    const checked = await app.execute(`const boxes = [...document.querySelectorAll("label")]
      .filter((l) => l.textContent.startsWith("Außerhalb des Einsatzzeitraums wie"))
      .map((l) => l.querySelector('input[type="checkbox"]'));
      boxes[0].click();
      return boxes.map((b) => b.checked);`);
    assert.deepEqual(checked, [true]); // nur Lena hat einen Einsatzzeitraum
    await app.click("button", "Speichern");
    await app.waitForText("1 Buchung auf das Projekt außerhalb des Teams");

    const text = await app.text();
    for (const expected of [
      "3,00 h von Personen, die nicht im Team sind – nicht abgerechnet",
      "ℹ Darf buchen (ohne Zeiterfassung): 11,00 h aufs Projekt · 6,00 h abgerechnet (640,00 € netto) · 5,00 h nicht abgerechnet",
    ]) {
      assert.ok(text.includes(expected), `fehlt: ${expected}`);
    }
    assert.ok(!text.includes("außerhalb des Einsatzzeitraums – abgerechnet"));
    const lena = await app.execute(
      "return [...document.querySelectorAll('td')].filter((td) => td.textContent.startsWith('Lena Beispiel')).map((td) => td.textContent)",
    );
    assert.deepEqual(lena, ["Lena Beispielaußerhalb Einsatz"]);
    const saved = readdirSync(projectsDir())
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(projectsDir(), f), "utf8")))
      .flatMap((p) => p.team)
      .find((m) => m.name === "Lena Beispiel");
    assert.equal(saved.may_book_outside, true);

    // Rechnung: Betrag unverändert, keine rote Markierung mehr für Lena
    await app.tab("Rechnung");
    await app.waitForText("319.865,00 €");
    assert.ok(!(await app.text()).includes("⚠ enthält Buchungen außerhalb des Einsatzzeitraums"));
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
    ]) {
      assert.ok(text.includes(expected), `fehlt: ${expected}`);
    }
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

    // Schnellwahl „Vortag des Exports“: Oktober ist dann noch nicht abgeschlossen,
    // die aktuell fehlenden Buchungen bleiben dieselben
    await app.click("button", "Vortag des Exports");
    await app.waitForText("Auswertung 01.01.2026 – 30.10.2026");
    await app.tab("Insights");
    await app.waitForText("abgeschlossene Monate Januar 2026 – September 2026");
    const current = await app.execute(`return [...document.querySelectorAll("h3")]
      .find((h) => h.textContent === "Fehlende Buchungen aktuell")
      .closest("section").querySelectorAll("tbody tr").length`);
    assert.equal(current, 2); // Erika 20.10., Max 22.10.
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
    await app.click("button", "Stand des Exports");
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
