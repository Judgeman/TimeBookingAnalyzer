import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  defaultBillingRules,
  type BillingRule,
  type TeamMember,
  type WorkingHoursPeriod,
} from "../../types/config";
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
        initial={[{ name: "Lena Beispiel", rates: [], working_hours: [], assignments: [] }]}
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
});
