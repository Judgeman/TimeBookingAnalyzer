import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { sampleResult } from "../../test/fixture";
import { AccountView } from "./AccountView";

describe("AccountView (Stundenkonto)", () => {
  it("zeigt beide Varianten mit Saldo und Erfüllung", () => {
    const erika = sampleResult().persons[0];
    render(<AccountView name={erika.name} data={erika} catchUp={sampleResult().catch_up} person={erika.name} />);
    expect(screen.getAllByText("Erika Mustermann hat Überstunden")).toHaveLength(2);
    expect(screen.getAllByText("+41,00 h")).toHaveLength(1);
    expect(screen.getAllByText("+21,00 h")).toHaveLength(1);
    expect(screen.getByText("1.501,00", { selector: "dd" })).toBeInTheDocument(); // zu leisten
    expect(screen.getByText("102,7 %")).toBeInTheDocument(); // 1.542 / 1.501
  });

  it("kumuliert den Saldo je Monat", () => {
    const erika = sampleResult().persons[0];
    render(<AccountView name={erika.name} data={erika} catchUp={sampleResult().catch_up} person={erika.name} />);
    const january = screen.getByText("Januar 2026").closest("tr")!;
    const february = screen.getByText("Februar 2026").closest("tr")!;
    // Januar +1,00 → Februar +1,50 → kumuliert +2,50; Krank als Fehlzeit: +1,00 − 14,50 = −13,50
    expect(january.textContent).toContain("+1,00");
    expect(february.textContent).toContain("+2,50");
    expect(february.textContent).toContain("−13,50");
  });

  it("meldet Stundenschuld bei negativem Saldo", () => {
    const erika = sampleResult().persons[0];
    erika.ytd = { ...erika.ytd, plus: -12.5, plus_krank: -20 };
    render(<AccountView name={erika.name} data={erika} catchUp={sampleResult().catch_up} person={erika.name} />);
    expect(screen.getAllByText("Erika Mustermann schuldet dem Unternehmen")).toHaveLength(2);
    expect(screen.getByText("−12,50 h")).toHaveClass("text-red-700");
  });

  it("zeigt das Aufholen bis 31.12. für die Person bzw. das Team", () => {
    const result = sampleResult();
    const catchUp = result.catch_up;
    catchUp.persons[0] = { ...catchUp.persons[0], balance: -13, deficit: 13, extra_per_day: 0.5 };
    const { unmount } = render(
      <AccountView name="Erika Mustermann" data={result.persons[0]} catchUp={catchUp} person="Erika Mustermann" />,
    );
    expect(screen.getByRole("heading", { name: /^Aufholen bis 31\.12\.2026 – Krankheit/ })).toBeInTheDocument();
    expect(screen.getByText("+0,50 h")).toBeInTheDocument();
    unmount();
    render(<AccountView name="Das Team" data={result.team} catchUp={catchUp} person={null} />);
    expect(screen.getByRole("heading", { name: /– Team – Krankheit als Fehlzeit/ })).toBeInTheDocument();
    expect(screen.getByText(/Das Team liegt insgesamt bei 100 % oder mehr/)).toBeInTheDocument();
  });
});
