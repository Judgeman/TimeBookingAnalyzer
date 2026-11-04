import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { sampleResult } from "../../test/fixture";
import type { InvoiceSummary } from "../../types/results";
import { formatEuro } from "../../lib/format";
import { InvoiceView } from "./InvoiceView";

const text = () => document.body.textContent!.replace(/ | /g, " ");

describe("InvoiceView", () => {
  it("zeigt Summen, USt. je Satz und Netto pro Person und Monat", () => {
    const r = sampleResult();
    render(
      <InvoiceView invoice={r.invoice} persons={r.persons.map((p) => p.name)} cutoffDate={r.cutoff_date} />,
    );
    expect(text()).toContain("319.865,00 €");
    expect(text()).toContain("60.719,47 €");
    expect(text()).toContain("380.584,47 €");
    expect(text()).toContain("USt. 7 % / 19 %");
    expect(text()).toContain("7 %: 32,03 €");

    const table = screen.getByText("Netto pro Person und Monat").nextElementSibling as HTMLElement;
    const october = within(table).getByText("Oktober 2026").closest("tr")!;
    expect(october.textContent!.replace(/ /g, " ")).toContain("17.036,25 €");
  });

  it("zeigt Personen mit „darf buchen“ als eigene Spalte und Position", async () => {
    const user = userEvent.setup();
    const r = sampleResult();
    render(
      <InvoiceView
        invoice={r.invoice}
        persons={r.persons.map((p) => p.name)}
        guests={r.guests}
        cutoffDate={r.cutoff_date}
      />,
    );
    const table = screen.getByText("Netto pro Person und Monat").nextElementSibling as HTMLElement;
    const header = within(table).getByText("Karl Beispiel").closest("th")!;
    expect(header).toHaveTextContent("darf buchen");
    const cells = (month: string) =>
      [...within(table).getByText(month).closest("tr")!.querySelectorAll("td")].map((td) =>
        td.textContent!.replace(/\u00a0|\u202f/g, " "),
      );
    // Spalten: Monat, Erika, Max, Lena, Karl, Netto, USt., Brutto
    expect(cells("Juni 2026")[4]).toBe("480,00 €");
    expect(cells("Mai 2026")[4]).toBe("–");
    expect(cells("Gesamt")[4]).toBe("480,00 €");

    await user.click(screen.getByText("Juni 2026", { selector: "summary span" }));
    const line = screen
      .getAllByText("Karl Beispiel")
      .map((el) => el.closest("tr")!)
      .find((tr) => tr.closest("details"))!;
    expect(line).toHaveTextContent("darf buchen");
    expect(line).toHaveTextContent("Delivery");
    expect(line).not.toHaveClass("bg-red-50");
  });

  it("kennzeichnet Teammitglieder ohne Zeiterfassung", async () => {
    const user = userEvent.setup();
    const r = sampleResult();
    // Max ohne Zeiterfassung: nicht unter den Personen, aber mit Rechnungspositionen
    render(
      <InvoiceView
        invoice={r.invoice}
        persons={["Erika Mustermann", "Lena Beispiel", "Max Mustermann"]}
        guests={r.guests}
        untracked={["Max Mustermann"]}
        cutoffDate={r.cutoff_date}
      />,
    );
    const table = screen.getByText("Netto pro Person und Monat").nextElementSibling as HTMLElement;
    expect(within(table).getByText("Max Mustermann").closest("th")).toHaveTextContent("Max Mustermannohne Zeiterfassung");
    expect(within(table).getByText("Erika Mustermann").closest("th")).toHaveTextContent(/^Erika Mustermann$/);
    await user.click(screen.getByText("Juni 2026", { selector: "summary span" }));
    const line = screen
      .getAllByText("Max Mustermann")
      .map((el) => el.closest("tr")!)
      .find((tr) => tr.closest("details"))!;
    expect(line).toHaveTextContent("ohne Zeiterfassung");
  });

  it("öffnet Monatsdetails mit Leistung, Satz-Anteil und USt.-Gruppen", async () => {
    const user = userEvent.setup();
    const r = sampleResult();
    // Eine Position mit halbem Satz, eine ohne Satz
    const sep = r.invoice.months.find((m) => m.month === "2026-09")!;
    sep.lines.push(
      { person: "Max Mustermann", service: "Reisezeit", base_rate: 95, rate_percent: 50, rate: 47.5, hours: 2, net: 95, vat_percent: 19, outside_hours: 0 },
      { person: "Max Mustermann", service: "Delivery", base_rate: null, rate_percent: 100, rate: null, hours: 1, net: 0, vat_percent: 19, outside_hours: 0 },
    );
    render(<InvoiceView invoice={r.invoice} persons={["Erika Mustermann", "Max Mustermann"]} cutoffDate="2026-10-31" />);

    await user.click(screen.getByText("September 2026", { selector: "summary span" }));
    expect(screen.getAllByText("Schulung").length).toBeGreaterThan(0);
    expect(text()).toContain("zzgl. USt. 7 % auf 157,50 €");
    expect(text()).toContain("(50 % von 95,00 €)");
    expect(screen.getByText("kein Satz hinterlegt")).toBeInTheDocument();
  });

  it("markiert den laufenden Monat und meldet fehlende Stunden", () => {
    const r = sampleResult();
    r.invoice.months[r.invoice.months.length - 1].partial = true;
    const { unmount } = render(
      <InvoiceView invoice={r.invoice} persons={["Erika Mustermann"]} cutoffDate="2026-10-15" />,
    );
    expect(screen.getAllByText("bis 15.10.2026").length).toBeGreaterThan(0);
    unmount();

    const empty: InvoiceSummary = {
      vat_percent: 19,
      months: [],
      total: { hours: 0, net: 0, vat_groups: [], vat: 0, gross: 0 },
    };
    render(<InvoiceView invoice={empty} persons={[]} cutoffDate="2026-10-31" />);
    expect(screen.getByText(/keine abrechenbaren Stunden/)).toBeInTheDocument();
  });
});

describe("InvoiceView – Netto ist die führende Größe", () => {
  // Testing Library vergleicht mit normalisiertem Text (geschützte Leerzeichen → Leerzeichen).
  const euro = (value: number) => formatEuro(value).replace(/ | /g, " ");

  it("hebt Netto hervor, Brutto nur zurückhaltend", () => {
    const r = sampleResult();
    render(<InvoiceView invoice={r.invoice} persons={r.persons.map((p) => p.name)} cutoffDate={r.cutoff_date} />);
    const october = r.invoice.months.find((m) => m.month === "2026-10")!;

    // Kacheln: nur Netto dunkel hervorgehoben
    expect(screen.getByText(/Netto gesamt bis/).closest("div")).toHaveClass("bg-slate-800");
    expect(screen.getByText("Brutto gesamt").closest("div")).not.toHaveClass("bg-slate-800");

    // Monatstabelle: Netto fett, Brutto grau
    const table = screen.getByText("Netto pro Person und Monat").nextElementSibling as HTMLElement;
    const row = within(table).getByText("Oktober 2026").closest("tr")!;
    expect(within(row).getByText(euro(october.net))).toHaveClass("font-semibold");
    expect(within(row).getByText(euro(october.gross))).toHaveClass("text-slate-500");
    expect(within(row).getByText(euro(october.gross))).not.toHaveClass("font-semibold");

    // Kopfzeile des Monats (aufgeklappt): fett ist der Netto-Betrag
    const summary = screen.getByText("Oktober 2026", { selector: "summary span" }).closest("summary")!;
    expect(within(summary).getByText(euro(october.net))).toHaveClass("font-semibold");
    expect(within(summary).queryByText(euro(october.gross))).toBeNull(); // Brutto nur als normaler Text

    // Summenzeilen der Monatsdetails
    const details = summary.parentElement!;
    expect(within(details).getByText("Netto", { selector: "td" }).closest("tr")).toHaveClass("font-semibold");
    expect(within(details).getByText("Brutto", { selector: "td" }).closest("tr")).not.toHaveClass("font-semibold");
  });
});

describe("InvoiceView – Buchungen außerhalb des Teams", () => {
  it("weist auf abgerechnete und nicht abgerechnete Buchungen hin und markiert die Position", async () => {
    const user = userEvent.setup();
    const r = sampleResult();
    render(
      <InvoiceView
        invoice={r.invoice}
        persons={r.persons.map((p) => p.name)}
        cutoffDate={r.cutoff_date}
        outside={r.outside}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(text()).toContain("Diese Rechnung enthält 2,00 h (160,00 € netto) aus Buchungen außerhalb des Einsatzzeitraums");
    expect(alert.textContent).toContain("nicht abgerechnet (Jonas Beispiel)");

    // Übersicht: ⚠ bei Lena im März, „–“ ab April
    const table = screen.getByText("Netto pro Person und Monat").nextElementSibling as HTMLElement;
    const march = within(table).getByText("März 2026").closest("tr")!;
    expect(within(march).getByTitle("davon 2,00 h außerhalb des Einsatzzeitraums")).toBeInTheDocument();
    const april = within(table).getByText("April 2026").closest("tr")!;
    expect(april.cells[3]).toHaveTextContent("–");

    // Monatsdetails: Kopf und Position markiert
    await user.click(screen.getByText("März 2026", { selector: "summary span" }));
    expect(screen.getByText("⚠ enthält Buchungen außerhalb des Einsatzzeitraums")).toBeInTheDocument();
    const line = screen.getByText("⚠ außerhalb Einsatzzeitraum").closest("tr")!;
    expect(line).toHaveClass("bg-red-50");
    expect(line.textContent).toContain("Lena Beispiel");
  });
});
