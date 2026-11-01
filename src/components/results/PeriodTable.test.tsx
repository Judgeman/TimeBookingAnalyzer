import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { sampleResult } from "../../test/fixture";
import { PeriodTable, type PeriodRow } from "./PeriodTable";

const erika = sampleResult().persons[0];

function rows(): PeriodRow[] {
  return [
    {
      key: "2026-09",
      label: "September 2026",
      data: erika.by_month["2026-09"],
    },
    {
      key: "2026-10",
      label: "Oktober 2026",
      data: erika.by_month["2026-10"],
      missing: ["Di, 20.10.2026 · Erika Mustermann: fehlende Buchung"],
      flags: ["Sa, 25.07.2026 · Urlaub"],
      children: Object.entries(erika.month_weeks["2026-10"]).map(([week, data]) => ({
        key: week,
        label: week,
        data,
        missing: week === "2026-W43" ? ["Di, 20.10.2026"] : undefined,
      })),
    },
  ];
}

describe("PeriodTable", () => {
  it("zeigt Zeilen, Summe und Kennzeichen", () => {
    render(<PeriodTable rows={rows()} total={erika.ytd} totalLabel="Jahr bis Stichtag" periodLabel="Monat" />);
    expect(screen.getByText("September 2026")).toBeInTheDocument();
    expect(screen.getByText("Jahr bis Stichtag")).toBeInTheDocument();
    expect(screen.getByText("! 1 fehlende Buchung")).toHaveAttribute(
      "title",
      "Di, 20.10.2026 · Erika Mustermann: fehlende Buchung",
    );
    expect(screen.getByText("⚑ 1")).toBeInTheDocument();
    // Plus der Summenzeile grün
    const footer = screen.getByText("Jahr bis Stichtag").closest("tr")!;
    expect(within(footer).getByText("+41,00")).toHaveClass("text-emerald-700");
  });

  it("klappt Kalenderwochen eines Monats auf und zu", async () => {
    const user = userEvent.setup();
    render(<PeriodTable rows={rows()} total={erika.ytd} totalLabel="Summe" periodLabel="Monat" />);
    expect(screen.queryByText("2026-W43")).not.toBeInTheDocument();

    await user.click(screen.getByText("Oktober 2026"));
    expect(screen.getByText("2026-W43")).toBeInTheDocument();
    expect(screen.getAllByText(/fehlende Buchung$/)).toHaveLength(2);

    await user.click(screen.getByText("Oktober 2026"));
    expect(screen.queryByText("2026-W43")).not.toBeInTheDocument();

    await user.click(screen.getByTitle("Alle aufklappen"));
    expect(screen.getByText("2026-W40")).toBeInTheDocument();
    await user.click(screen.getByTitle("Alle zuklappen"));
    expect(screen.queryByText("2026-W40")).not.toBeInTheDocument();
  });
});
