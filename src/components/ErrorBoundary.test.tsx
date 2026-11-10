import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

let broken = true;
function Results() {
  if (broken) throw new Error("Cannot read properties of undefined (reading 'month')");
  return <p>Auswertung da</p>;
}

describe("ErrorBoundary", () => {
  it("zeigt bei einem Anzeigefehler eine Meldung statt eines leeren Fensters", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    render(
      <>
        <p>Projektliste</p>
        <ErrorBoundary what="Die Auswertung">
          <Results />
        </ErrorBoundary>
      </>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Die Auswertung konnte nicht angezeigt werden.");
    expect(alert).toHaveTextContent("Interner Fehler: Cannot read properties of undefined (reading 'month')");
    expect(screen.getByText("Projektliste")).toBeInTheDocument(); // Rest bleibt bedienbar

    broken = false;
    await user.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    expect(screen.getByText("Auswertung da")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("neues Ergebnis (resetKey) setzt den Fehler zurück", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    broken = true;
    const { rerender } = render(
      <ErrorBoundary what="Die Auswertung" resetKey="a">
        <Results />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    broken = false;
    rerender(
      <ErrorBoundary what="Die Auswertung" resetKey="a">
        <Results />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument(); // gleicher Schlüssel → bleibt
    rerender(
      <ErrorBoundary what="Die Auswertung" resetKey="b">
        <Results />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Auswertung da")).toBeInTheDocument();
  });
});
