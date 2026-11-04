import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import sample from "../../sample-data/beispiel-projekt.json";
import { newProject, type ProjectConfig } from "../types/config";
import { ProjectEditor } from "./ProjectEditor";

/** Wie vom Backend geliefert: optionale Felder sind dort immer gesetzt. */
function sampleConfig(): ProjectConfig {
  const config = structuredClone(sample) as unknown as ProjectConfig;
  config.team = config.team.map((m) => ({
    ...m,
    working_hours: m.working_hours ?? [],
    assignments: m.assignments ?? [],
    vacation: m.vacation ?? [],
  }));
  return config;
}

describe("ProjectEditor", () => {
  it("speichert ein neues Projekt mit freien Tagen, Region und Schwelle", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ProjectEditor initial={newProject()} onSave={onSave} onCancel={() => {}} />);

    expect(screen.getByText("Neues Projekt")).toBeInTheDocument();
    expect(screen.queryByText("Projekt löschen")).not.toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("Musterkunde GmbH / Lager-App"), "Testprojekt");
    await user.type(screen.getByPlaceholderText("P100 Lager-App"), "P100 Lager-App");
    await user.selectOptions(screen.getByLabelText("Bundesland (Feiertage)"), "BY");
    await user.type(screen.getByLabelText(/Zusätzliche freie Tage/), "24.12.2026{enter}2026-12-31");
    const threshold = screen.getByLabelText(/Fehlende Buchung unter/);
    await user.clear(threshold);
    await user.type(threshold, "60");
    await user.click(screen.getByRole("button", { name: "Speichern" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as ProjectConfig;
    expect(saved).toMatchObject({
      name: "Testprojekt",
      element_filter: "P100 Lager-App",
      holidays: { region: "BY", custom: ["2026-12-24", "2026-12-31"] },
      missing_threshold_percent: 60,
      vat_percent: 19,
    });
  });

  it("zeigt Fehler aus der Datumsprüfung und vom Backend", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockRejectedValue("Arbeitszeit (Projekt): Zeiträume überschneiden sich.");
    render(<ProjectEditor initial={sampleConfig()} onSave={onSave} onCancel={() => {}} />);

    await user.type(screen.getByLabelText(/Zusätzliche freie Tage/), "31.02.2026");
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    expect(screen.getByRole("alert")).toHaveTextContent("„31.02.2026“ ist kein gültiges Datum.");
    expect(onSave).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText(/Zusätzliche freie Tage/));
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText(/überschneiden sich/)).toBeInTheDocument();
  });

  it("lädt bestehende Projekte vollständig und löscht erst nach Bestätigung", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();
    render(<ProjectEditor initial={sampleConfig()} onSave={vi.fn()} onCancel={onCancel} onDelete={onDelete} />);

    const team = screen.getByText("Team").closest("fieldset")!;
    expect(within(team).getByDisplayValue("Erika Mustermann")).toBeInTheDocument();
    // Planung: Budget 2026 und geplante Abwesenheiten
    const planning = screen.getByText("Planung (Budget & Prognose)").closest("fieldset")!;
    expect(within(planning).getByDisplayValue("360000")).toBeInTheDocument();
    expect(within(planning).getByText("30.000,00 €")).toBeInTheDocument(); // Richtwert / Monat
    expect(within(planning).getAllByLabelText("Abwesenheit Person")).toHaveLength(3);
    expect(screen.getByDisplayValue("Schulung")).toBeInTheDocument();
    expect(screen.getByDisplayValue("6")).toBeInTheDocument(); // Ausnahme Max: 6 h/Tag
    // Rolle „darf buchen“ in eigenem Abschnitt
    const guests = screen.getByText("Darf buchen (ohne Zeiterfassung)").closest("fieldset")!;
    expect(within(guests).getByDisplayValue("Karl Beispiel")).toBeInTheDocument();
    expect(within(guests).getByDisplayValue("120")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Projekt löschen" }));
    await user.click(screen.getByRole("button", { name: "Nein" }));
    expect(onDelete).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Projekt löschen" }));
    await user.click(screen.getByRole("button", { name: "Ja, löschen" }));
    expect(onDelete).toHaveBeenCalledWith("beispiel-lager-app");

    await user.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe("ProjectEditor – Export-Format, Arbeitszeit, USt.", () => {
  it("übernimmt alle Formularfelder in die gespeicherte Konfiguration", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ProjectEditor initial={sampleConfig()} onSave={onSave} onCancel={() => {}} />);

    const sheet = screen.getByLabelText("Tabellenblatt");
    await user.clear(sheet);
    await user.type(sheet, "Buchungen");
    const sick = screen.getByLabelText("Element „Krank“");
    await user.clear(sick);
    await user.type(sick, "(Krank)");
    const vacation = screen.getByLabelText("Element „Urlaub“");
    await user.clear(vacation);
    await user.type(vacation, "(Urlaub)");
    await user.selectOptions(screen.getByLabelText("Ort"), "14"); // Spalte O
    const vat = screen.getByLabelText(/Umsatzsteuer/);
    await user.clear(vat);
    await user.type(vat, "7");

    // Projekt-Arbeitszeit: zweiten Zeitraum ab 01.10. auf 7 h ändern
    const hours = screen.getByText("Arbeitszeit (Projekt)").closest("fieldset")!;
    const dates = within(hours).getAllByDisplayValue(/2026-/);
    fireEvent.change(dates[dates.length - 1], { target: { value: "2026-07-01" } });
    const toFields = hours.querySelectorAll<HTMLInputElement>('input[type="date"]:not([required])');
    fireEvent.change(toFields[1], { target: { value: "2026-12-31" } });

    await user.click(screen.getByRole("button", { name: "Speichern" }));
    const saved = onSave.mock.calls[0][0] as ProjectConfig;
    expect(saved.export_format).toEqual({
      sheet_name: "Buchungen",
      columns: { name: 0, date: 2, duration: 5, mult: 8, element: 9, kost2art: 11, location: 14 },
      special_elements: { sick: "(Krank)", vacation: "(Urlaub)" },
    });
    expect(saved.vat_percent).toBe(7);
    expect(saved.working_hours[1]).toEqual({ from: "2026-07-01", to: "2026-12-31", hours_per_day: 7.5 });
  });
});

describe("ProjectEditor – exakte Werte", () => {
  it("alle Zahlenfelder (außer dem Jahr) nehmen beliebige Nachkommastellen an", () => {
    const config = sampleConfig();
    config.team[0].vacation = [{ year: 2026, days: 30, carry_over: 0 }];
    const { container } = render(<ProjectEditor initial={config} onSave={vi.fn()} onCancel={() => {}} />);
    const fields = [...container.querySelectorAll<HTMLInputElement>('input[type="number"]')];
    expect(fields.length).toBeGreaterThan(15);
    for (const field of fields) {
      const expected = field.getAttribute("aria-label") === "Urlaub Jahr" ? "1" : "any";
      expect(field.getAttribute("step"), field.getAttribute("aria-label") ?? field.name).toBe(expected);
    }
  });
});
