import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  defaultBillingRules,
  type BillingRule,
  type BudgetPeriod,
  type Guest,
  type PlannedAbsence,
  type TeamMember,
  type WorkingHoursPeriod,
} from "../../types/config";
import { GuestEditor } from "./GuestEditor";
import { monthCount, PlanningEditor } from "./PlanningEditor";
import { PeriodListEditor } from "./PeriodListEditor";
import { RulesEditor } from "./RulesEditor";
import { TeamEditor } from "./TeamEditor";
import { numberOf } from "./ui";

/** Rendert einen Editor mit echtem Zustand und meldet jede Änderung. */
function Stateful<T>({ initial, render: view, onChange }: {
  initial: T;
  render: (value: T, set: (v: T) => void) => React.ReactNode;
  onChange: (v: T) => void;
}) {
  const [value, setValue] = useState(initial);
  return <>{view(value, (v) => { setValue(v); onChange(v); })}</>;
}

describe("numberOf", () => {
  it("liest Zahlen mit Komma oder Punkt, sonst Ersatzwert", () => {
    expect(numberOf("7,5")).toBe(7.5);
    expect(numberOf("8")).toBe(8);
    expect(numberOf("")).toBe(0);
    expect(numberOf("abc", 3)).toBe(3);
  });
});

describe("PeriodListEditor", () => {
  it("fügt Zeiträume hinzu, ändert und entfernt sie", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Stateful<WorkingHoursPeriod[]>
        initial={[]}
        onChange={onChange}
        render={(items, set) => (
          <PeriodListEditor<WorkingHoursPeriod, "hours_per_day">
            items={items}
            onChange={set}
            valueKey="hours_per_day"
            valueLabel="h / Tag"
            create={() => ({ from: "2026-01-01", to: null, hours_per_day: 8 })}
            emptyText="Keine Arbeitszeit"
            addLabel="Zeitraum"
          />
        )}
      />,
    );
    expect(screen.getByText("Keine Arbeitszeit")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "+ Zeitraum" }));
    expect(onChange).toHaveBeenLastCalledWith([{ from: "2026-01-01", to: null, hours_per_day: 8 }]);

    const value = screen.getByRole("spinbutton");
    await user.clear(value);
    await user.type(value, "7.5");
    expect(onChange).toHaveBeenLastCalledWith([{ from: "2026-01-01", to: null, hours_per_day: 7.5 }]);

    await user.click(screen.getByTitle("Zeitraum entfernen"));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});

describe("TeamEditor", () => {
  it("legt Personen an, benennt sie und entfernt sie", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Stateful<TeamMember[]>
        initial={[]}
        onChange={onChange}
        render={(team, set) => <TeamEditor team={team} onChange={set} defaultFrom="2026-01-01" />}
      />,
    );
    await user.click(screen.getByRole("button", { name: "+ Person" }));
    await user.type(screen.getByLabelText("Name"), "Erika Mustermann");
    await user.click(screen.getByRole("button", { name: "+ Stundensatz" }));
    await user.click(screen.getByRole("button", { name: "+ Ausnahme" }));
    expect(onChange).toHaveBeenLastCalledWith([
      {
        name: "Erika Mustermann",
        rates: [{ from: "2026-01-01", to: null, rate: 0 }],
        working_hours: [{ from: "2026-01-01", to: null, hours_per_day: 8 }],
        assignments: [],
        may_book_outside: false,
        vacation: [],
      },
    ]);
    await user.click(screen.getByRole("button", { name: "Person entfernen" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});

describe("RulesEditor", () => {
  function setup() {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Stateful<BillingRule[]>
        initial={defaultBillingRules()}
        onChange={onChange}
        render={(rules, set) => (
          <RulesEditor rules={rules} onChange={set} elementFilter="P100 Lager-App" projectVat={19} />
        )}
      />,
    );
    const last = () => onChange.mock.calls.at(-1)![0] as BillingRule[];
    return { user, last };
  }

  it("ändert Reihenfolge, Häkchen, Satz und USt.", async () => {
    const { user, last } = setup();
    const rows = () => screen.getAllByRole("row").slice(1);

    await user.click(within(rows()[1]).getByTitle("Nach oben (höhere Priorität)"));
    expect(last().map((r) => r.name)).toEqual(["Sonstige billable (z. B. Travel)", "Delivery"]);

    await user.click(within(rows()[0]).getByLabelText("× Mult"));
    expect(last()[0].apply_mult).toBe(true);

    const rate = within(rows()[0]).getByLabelText("Satz %");
    await user.clear(rate);
    await user.type(rate, "50");
    expect(last()[0].rate_percent).toBe(50);

    const vat = within(rows()[0]).getByLabelText("USt. %");
    await user.type(vat, "7");
    expect(last()[0].vat_percent).toBe(7);
    await user.clear(vat);
    expect(last()[0].vat_percent).toBeNull();

    await user.selectOptions(within(rows()[0]).getByLabelText("Vergleich"), "exact");
    expect(last()[0].match_mode).toBe("exact");
  });

  it("fügt Regeln hinzu, entfernt sie und stellt die Standardregeln wieder her", async () => {
    const { user, last } = setup();
    await user.click(screen.getByRole("button", { name: "+ Regel" }));
    expect(last()).toHaveLength(3);
    await user.type(screen.getAllByLabelText("Bezeichnung")[2], "Schulung");
    await user.type(screen.getAllByLabelText("Kost2Art")[2], "Training (billable)");
    expect(last()[2]).toMatchObject({ name: "Schulung", kost2art: "Training (billable)", invoice: true });

    await user.click(screen.getAllByTitle("Regel entfernen")[0]);
    expect(last().map((r) => r.name)).toEqual(["Sonstige billable (z. B. Travel)", "Schulung"]);

    await user.click(screen.getByRole("button", { name: "Standardregeln wiederherstellen" }));
    expect(last()).toEqual(defaultBillingRules());
  });
});

describe("TeamEditor – Einsatzzeitraum", () => {
  it("legt Einsatzzeiträume an, ändert und entfernt sie", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Stateful<TeamMember[]>
        initial={[{ name: "Lena Beispiel", rates: [], working_hours: [], assignments: [], vacation: [] }]}
        onChange={onChange}
        render={(team, set) => <TeamEditor team={team} onChange={set} defaultFrom="2026-01-01" />}
      />,
    );
    expect(screen.getByText("Kein Zeitraum – die Person ist durchgehend im Projekt.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "+ Einsatzzeitraum" }));
    fireEvent.change(screen.getByLabelText("Einsatz bis"), { target: { value: "2026-02-28" } });
    expect(onChange.mock.calls.at(-1)![0][0].assignments).toEqual([{ from: "2026-01-01", to: "2026-02-28" }]);
    fireEvent.change(screen.getByLabelText("Einsatz von"), { target: { value: "2026-01-15" } });
    expect(onChange.mock.calls.at(-1)![0][0].assignments).toEqual([{ from: "2026-01-15", to: "2026-02-28" }]);
    await user.click(screen.getByTitle("Einsatzzeitraum entfernen"));
    expect(onChange.mock.calls.at(-1)![0][0].assignments).toEqual([]);
  });

  it("außerhalb des Einsatzes wie „darf buchen“ – nur mit Einsatzzeitraum wählbar", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Stateful<TeamMember[]>
        initial={[{ name: "Lena Beispiel", rates: [], working_hours: [], assignments: [], vacation: [] }]}
        onChange={onChange}
        render={(team, set) => <TeamEditor team={team} onChange={set} defaultFrom="2026-01-01" />}
      />,
    );
    const label = /Außerhalb des Einsatzzeitraums wie „darf buchen“ behandeln/;
    expect(screen.queryByRole("checkbox", { name: label })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "+ Einsatzzeitraum" }));
    const checkbox = screen.getByRole("checkbox", { name: label });
    expect(checkbox).not.toBeChecked();
    await user.click(checkbox);
    expect(onChange.mock.calls.at(-1)![0][0].may_book_outside).toBe(true);
    expect(checkbox).toBeChecked();
    await user.click(checkbox);
    expect(onChange.mock.calls.at(-1)![0][0].may_book_outside).toBe(false);
  });
});

describe("GuestEditor (darf buchen)", () => {
  it("legt Personen mit Stundensatz an, benennt sie und entfernt sie", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Stateful<Guest[]>
        initial={[]}
        onChange={onChange}
        render={(guests, set) => <GuestEditor guests={guests} onChange={set} defaultFrom="2026-01-01" />}
      />,
    );
    expect(screen.getByText(/entscheiden die Abrechnungsregeln \(Kost2Art\)/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "+ Person (darf buchen)" }));
    await user.type(screen.getByLabelText("Name (darf buchen)"), "Karl Beispiel");
    await user.click(screen.getByRole("button", { name: "+ Stundensatz" }));
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "120" } });
    expect(onChange).toHaveBeenLastCalledWith([
      { name: "Karl Beispiel", rates: [{ from: "2026-01-01", to: null, rate: 120 }] },
    ]);
    // keine Arbeitszeit, kein Einsatzzeitraum
    expect(screen.queryByText("Abweichende Arbeitszeit")).not.toBeInTheDocument();
    expect(screen.queryByText("Einsatzzeitraum im Projekt")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Person entfernen" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});

describe("PlanningEditor (Budget & Abwesenheiten)", () => {
  it("zählt Monate eines Budget-Zeitraums", () => {
    expect(monthCount("2026-01", "2026-12")).toBe(12);
    expect(monthCount("2025-11", "2026-02")).toBe(4);
    expect(monthCount("2026-05", "2026-04")).toBe(0);
    expect(monthCount("", "2026-04")).toBe(0);
  });

  it("legt Budget-Zeiträume an und zeigt den Richtwert je Monat", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 3));
    const user = userEvent.setup();
    const onBudgets = vi.fn();
    render(
      <Stateful<BudgetPeriod[]>
        initial={[]}
        onChange={onBudgets}
        render={(budgets, set) => (
          <PlanningEditor budgets={budgets} absences={[]} team={[]} onBudgets={set} onAbsences={() => {}} />
        )}
      />,
    );
    expect(screen.getByText(/Kein Budget hinterlegt/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Abwesenheit" })).toBeDisabled(); // ohne Team
    await user.click(screen.getByRole("button", { name: "+ Budget-Zeitraum" }));
    expect(onBudgets).toHaveBeenLastCalledWith([{ from: "2026-01", to: "2026-12", amount: 0 }]);
    fireEvent.change(screen.getByLabelText("Budget netto"), { target: { value: "120000" } });
    expect(screen.getByText("10.000,00 €")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Budget von"), { target: { value: "2026-07" } });
    expect(screen.getByText("20.000,00 €")).toBeInTheDocument(); // 6 Monate
    fireEvent.change(screen.getByLabelText("Budget bis"), { target: { value: "2026-06" } });
    expect(screen.getByText("–")).toBeInTheDocument(); // Ende vor Beginn
    await user.click(screen.getByTitle("Budget entfernen"));
    expect(onBudgets).toHaveBeenLastCalledWith([]);
    vi.useRealTimers();
  });

  it("erfasst geplante Abwesenheiten je Person", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 3));
    const user = userEvent.setup();
    const onAbsences = vi.fn();
    render(
      <Stateful<PlannedAbsence[]>
        initial={[{ person: "Ehemalige Person", from: "2026-12-01", to: "2026-12-02", kind: "other", half_day: false }]}
        onChange={onAbsences}
        render={(absences, set) => (
          <PlanningEditor
            budgets={[]}
            absences={absences}
            team={["Erika Mustermann", "Max Mustermann"]}
            onBudgets={() => {}}
            onAbsences={set}
          />
        )}
      />,
    );
    // Person nicht mehr im Team bleibt sichtbar (Backend meldet es beim Speichern)
    expect(screen.getByLabelText("Abwesenheit Person")).toHaveValue("Ehemalige Person");
    await user.click(screen.getByRole("button", { name: "+ Abwesenheit" }));
    expect(onAbsences.mock.calls.at(-1)![0][1]).toEqual({
      person: "Erika Mustermann",
      from: "2026-11-03",
      to: "2026-11-03",
      kind: "vacation",
      half_day: false,
    });
    const second = (label: string) => screen.getAllByLabelText(label)[1];
    fireEvent.change(second("Abwesenheit Person"), { target: { value: "Max Mustermann" } });
    fireEvent.change(second("Abwesenheit von"), { target: { value: "2026-12-21" } });
    fireEvent.change(second("Abwesenheit bis"), { target: { value: "2026-12-31" } });
    fireEvent.change(second("Abwesenheit Art"), { target: { value: "other" } });
    fireEvent.click(second("Halber Tag"));
    expect(onAbsences.mock.calls.at(-1)![0][1]).toEqual({
      person: "Max Mustermann",
      from: "2026-12-21",
      to: "2026-12-31",
      kind: "other",
      half_day: true,
    });
    await user.click(screen.getAllByTitle("Abwesenheit entfernen")[0]);
    expect(onAbsences.mock.calls.at(-1)![0]).toHaveLength(1);
    vi.useRealTimers();
  });
});

describe("TeamEditor – Urlaubsanspruch", () => {
  it("legt Ansprüche je Jahr an, ändert und entfernt sie", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Stateful<TeamMember[]>
        initial={[{ name: "Erika Mustermann", rates: [], working_hours: [], assignments: [], vacation: [] }]}
        onChange={onChange}
        render={(team, set) => <TeamEditor team={team} onChange={set} defaultFrom="2026-01-01" />}
      />,
    );
    expect(screen.getByText(/Kein Anspruch hinterlegt/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "+ Urlaubsanspruch" }));
    expect(onChange.mock.calls.at(-1)![0][0].vacation).toEqual([{ year: 2026, days: 30, carry_over: 0 }]);
    fireEvent.change(screen.getByLabelText("Urlaub Tage"), { target: { value: "28" } });
    fireEvent.change(screen.getByLabelText("Urlaub Übertrag"), { target: { value: "2.5" } });
    expect(onChange.mock.calls.at(-1)![0][0].vacation).toEqual([{ year: 2026, days: 28, carry_over: 2.5 }]);
    await user.click(screen.getByRole("button", { name: "+ Urlaubsanspruch" })); // nächstes Jahr
    expect(onChange.mock.calls.at(-1)![0][0].vacation[1].year).toBe(2027);
    fireEvent.change(screen.getAllByLabelText("Urlaub Jahr")[1], { target: { value: "2028" } });
    expect(onChange.mock.calls.at(-1)![0][0].vacation[1].year).toBe(2028);
    fireEvent.change(screen.getAllByLabelText("Urlaub Jahr")[1], { target: { value: "" } }); // bleibt
    expect(onChange.mock.calls.at(-1)![0][0].vacation[1].year).toBe(2028);
    await user.click(screen.getAllByTitle("Urlaubsanspruch entfernen")[0]);
    expect(onChange.mock.calls.at(-1)![0][0].vacation).toEqual([{ year: 2028, days: 30, carry_over: 0 }]);
  });
});
