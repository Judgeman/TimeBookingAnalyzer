import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProjectForgeSource } from "./ProjectForgeSource";

describe("ProjectForgeSource", () => {
  it("Abruf, alles neu laden und Hinweis bei fehlendem Zugang", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    const onOpenAccess = vi.fn();
    const props = { onRefresh, onOpenAccess };
    const { rerender } = render(
      <ProjectForgeSource
        busy={false}
        configured
        fetched="ProjectForge – Abruf 13.11.2026, 14:05"
        {...props}
      />,
    );
    expect(screen.getByText("Letzter Abruf 13.11.2026, 14:05")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Aktualisieren" }));
    await user.click(screen.getByRole("button", { name: "Alles neu laden" }));
    expect(onRefresh.mock.calls).toEqual([[false], [true]]);

    rerender(<ProjectForgeSource busy fetched={null} configured {...props} />);
    expect(
      screen.getByText("Noch keine Daten abgerufen. · Buchungen werden abgerufen …"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aktualisieren" })).toBeDisabled();

    rerender(<ProjectForgeSource busy={false} fetched={null} configured={false} {...props} />);
    expect(screen.getByRole("button", { name: "Alles neu laden" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "ProjectForge-Zugang einrichten" }));
    expect(onOpenAccess).toHaveBeenCalled();
  });
});
