import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { sampleResult } from "../../test/fixture";
import type { CatchUp } from "../../types/results";
import { PersonCatchUp, TeamCatchUp } from "./CatchUpView";

const text = (el: HTMLElement = document.body) => el.textContent!.replace(/\s/g, " ");

/** Werte der Beispieldaten mit Stichtag 30.06.2026 (wie im Rust-Test nachgerechnet). */
function june(): CatchUp {
  const catchUp = sampleResult().catch_up;
  const [erika, max, lena] = catchUp.persons;
  return {
    ...catchUp,
    from: "2026-07-01",
    workdays: 131,
    persons: [
      { ...erika, balance: -14.5, deficit: 14.5, workdays: 131, planned_days: 5,
        open_vacation_days: 22, available_days: 104, extra_per_day: 0.14, team_share: 9.82 },
      { ...max, balance: -5, deficit: 5, workdays: 131, hours_per_day: 6.5, planned_days: 8.5,
        open_vacation_days: 20, available_days: 102.5, extra_per_day: 0.05, team_share: 9.68 },
      lena,
    ],
    team: { balance: -19.5, deficit: 19.5, available_days: 206.5, extra_per_workday: 0.15,
      extra_per_person_day: 0.09 },
    // Budget nur bis November, laut Prognose 1.000 € Rest
    budget: { from: "2026-01", to: "2026-11", amount: 347673.43, expected_net: 346673.43,
      remaining: 1000, until: "2026-11-30", workdays: 109, available_days: 176.63,
      average_rate: 99.86, affordable_hours: 10.01, covered_hours: 10.01, covered_net: 1000,
      uncovered_hours: 9.49, extra_per_workday: 0.09, extra_per_person_day: 0.06 },
  };
}

const budgetSection = () => screen.getByRole("region", { name: "Aufholen im Budget" });

describe("PersonCatchUp", () => {
  it("zeigt die Mehrstunden je Arbeitstag bis 31.12. mit Urlaub und Team-Anteil", () => {
    render(<PersonCatchUp catchUp={june()} person="Erika Mustermann" />);
    const section = screen.getByRole("region", { name: "Aufholen" });
    expect(within(section).getByRole("heading")).toHaveTextContent(
      "Aufholen bis 31.12.2026 – Krankheit als Fehlzeit",
    );
    expect(text(section)).toContain("Zusätzlich je Arbeitstag ab 01.07.2026");
    expect(text(section)).toContain("Mehr je Arbeitstag+0,14 h≈ 8 Min.");
    expect(text(section)).toContain("Statt Ø h/Tag7,50 → 7,64 h");
    expect(text(section)).toContain(
      "Es fehlen 14,50 h bis 100 % · 104 Arbeitstage bis 31.12.2026 (131 Werktage im Einsatz − 5 geplant abwesend − 22 offener Urlaub).",
    );
    expect(text(section)).toContain("+0,09 h je Arbeitstag, Anteil 9,82 h – s. Team.");
  });

  it("nichts bei Erfüllung ab 100 %", () => {
    const { container } = render(
      <PersonCatchUp catchUp={sampleResult().catch_up} person="Erika Mustermann" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("ohne Arbeitstage nicht mehr aufholbar, ohne Urlaubsanspruch kein Urlaubsabzug", () => {
    const catchUp = june();
    catchUp.persons[0] = {
      ...catchUp.persons[0],
      has_entitlement: false,
      open_vacation_days: 0,
      available_days: 0,
      extra_per_day: null,
    };
    catchUp.team = { ...catchUp.team, deficit: 0 };
    render(<PersonCatchUp catchUp={catchUp} person="Erika Mustermann" />);
    expect(text()).toContain(
      "bleiben Erika Mustermann keine Arbeitstage im Projekt – die fehlenden 14,50 h lassen sich in diesem Jahr nicht mehr aufholen.",
    );
    expect(text()).toContain("kein Urlaubsanspruch hinterlegt");
    expect(text()).not.toContain("Im Team verteilt");
  });
});

describe("TeamCatchUp", () => {
  it("verteilt den Fehlbetrag aufs Team: gesamt je Werktag und je Person", () => {
    render(<TeamCatchUp catchUp={june()} />);
    const section = screen.getByRole("region", { name: "Aufholen" });
    expect(within(section).getByRole("heading", { level: 3 })).toHaveTextContent(
      "Aufholen bis 31.12.2026 – Team – Krankheit als Fehlzeit",
    );
    expect(text(section)).toContain("Team gesamt je Werktag+0,15 h19,50 h ÷ 131 Werktage");
    expect(text(section)).toContain(
      "Je Person und Arbeitstag+0,09 h19,50 h ÷ 206,5 Personen-Arbeitstage · ≈ 5 Min.",
    );
    expect(text(section)).toContain("Dem Team fehlen 19,50 h bis 100 %");
    const rows = within(section).getAllByRole("row").map((r) => text(r));
    expect(rows[0]).toBe(
      "PersonSaldoArbeitstageØ h/TagAllein aufholenAnteil TeamNeu h/Tag (Team)",
    );
    expect(rows[1]).toBe("Erika Mustermann−14,501047,50+0,14 h/Tag9,82 h7,50 → 7,59");
    expect(rows[2]).toBe("Max Mustermann−5,00102,56,50+0,05 h/Tag9,68 h6,50 → 6,59");
    expect(rows[3]).toBe("Lena Beispiel0,000––––"); // Einsatz beendet
    expect(within(section).getAllByRole("row")[1].querySelectorAll("td")[2].title).toBe(
      "131 Werktage im Einsatz − 5 geplant abwesend − 22 offener Urlaub",
    );
  });

  it("Team insgesamt ab 100 %: Überstunden gleichen aus, nur eigene Fehlstunden", () => {
    const catchUp = june();
    catchUp.team = { ...catchUp.team, balance: 6, deficit: 0, extra_per_person_day: 0, extra_per_workday: 0 };
    catchUp.persons[0] = { ...catchUp.persons[0], extra_per_day: null };
    render(<TeamCatchUp catchUp={catchUp} />);
    expect(text()).toContain("Das Team liegt insgesamt bei 100 % oder mehr (Saldo +6,00 h)");
    expect(screen.queryByText("Anteil Team")).not.toBeInTheDocument();
    expect(text(screen.getAllByRole("row")[1])).toContain("nicht mehr möglich");
  });

  it("nichts, wenn niemand unter 100 % liegt", () => {
    const { container } = render(<TeamCatchUp catchUp={sampleResult().catch_up} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("ohne verbleibende Werktage nicht mehr aufholbar", () => {
    const catchUp = june();
    catchUp.team = { ...catchUp.team, extra_per_workday: null, extra_per_person_day: null };
    render(<TeamCatchUp catchUp={catchUp} />);
    expect(text()).toContain(
      "bleiben keine Arbeitstage – die fehlenden 19,50 h lassen sich in diesem Jahr nicht mehr aufholen.",
    );
    expect(text(screen.getAllByRole("row")[1])).toMatch(/9,82 h–$/); // keine neue h/Tag
  });

  it("mit dem restlichen Budget: aufholbare Stunden bis Budgetende, Rest ohne Budget", () => {
    render(<TeamCatchUp catchUp={june()} />);
    const section = budgetSection();
    expect(within(section).getByRole("heading")).toHaveTextContent(
      "Mit dem restlichen Budget (Januar 2026 – November 2026)",
    );
    const t = text(section);
    expect(t).toContain(
      "Rest laut Prognose1.000,00 €Budget 347.673,43 € − abgerechnet + Prognose 346.673,43 €",
    );
    expect(t).toContain("Damit aufholbar10,01 hvon 19,50 h · Ø Satz 99,86 € · 1.000,00 € netto");
    expect(t).toContain(
      "Je Person und Arbeitstag bis 30.11.2026+0,06 h10,01 h ÷ 176,63 Personen-Arbeitstage · ≈ 4 Min.",
    );
    expect(t).toContain("Team gesamt je Werktag bis 30.11.2026+0,09 h10,01 h ÷ 109 Werktage");
    expect(t).toContain(
      "Ohne Budget bleiben 9,49 h – diese lassen sich nur ohne Abrechnung aufholen (z. B. intern oder nach dem Budgetende).",
    );
    expect(t).toContain("Aufgeholt wird bis 30.11.2026 (Budgetende, spätestens 31.12.)");
  });

  it("Budget reicht für alles bzw. kostet ohne Stundensatz nichts", () => {
    const catchUp = june();
    catchUp.budget = { ...catchUp.budget!, to: "2026-12", until: "2026-12-31", remaining: 29067.01,
      affordable_hours: 290.67, covered_hours: 19.5, uncovered_hours: 0 };
    const { unmount } = render(<TeamCatchUp catchUp={catchUp} />);
    expect(text(budgetSection())).toContain("Der Rest reicht für die ganzen 19,50 h.");
    unmount();
    catchUp.budget = { ...catchUp.budget, average_rate: 0, affordable_hours: null, covered_net: 0 };
    render(<TeamCatchUp catchUp={catchUp} />);
    expect(text(budgetSection())).toContain("Damit aufholbar19,50 hohne Stundensatz – kostet kein Budget");
  });

  it("Budget schon ausgeschöpft oder keine Arbeitstage bis Budgetende", () => {
    const catchUp = june();
    catchUp.budget = { ...catchUp.budget!, remaining: -6673.43, covered_hours: 0, uncovered_hours: 19.5 };
    const { unmount } = render(<TeamCatchUp catchUp={catchUp} />);
    expect(text(budgetSection())).toContain(
      "Das Budget ist laut Prognose schon ohne Aufholen ausgeschöpft (6.673,43 € über Budget) – die fehlenden 19,50 h lassen sich nur ohne Abrechnung aufholen.",
    );
    unmount();
    catchUp.budget = { ...catchUp.budget, remaining: 500, available_days: 0, extra_per_person_day: null };
    render(<TeamCatchUp catchUp={catchUp} />);
    expect(text(budgetSection())).toContain(
      "Bis zum Budgetende (30.11.2026) bleiben keine Arbeitstage",
    );
  });

  it("ohne Budget bzw. ohne Team-Fehlbetrag kein Budget-Abschnitt", () => {
    const catchUp = june();
    catchUp.budget = null;
    const { unmount } = render(<TeamCatchUp catchUp={catchUp} />);
    expect(screen.queryByRole("region", { name: "Aufholen im Budget" })).not.toBeInTheDocument();
    unmount();
    const positive = june();
    positive.team = { ...positive.team, balance: 6, deficit: 0 };
    render(<TeamCatchUp catchUp={positive} />);
    expect(screen.queryByRole("region", { name: "Aufholen im Budget" })).not.toBeInTheDocument();
  });
});
