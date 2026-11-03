import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProjectSelector } from "./ProjectSelector";

describe("ProjectSelector", () => {
  it("listet Projekte, markiert das aktive und meldet Auswahl/Neu", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onCreate = vi.fn();
    render(
      <ProjectSelector
        projects={[
          { id: "a", name: "Musterkunde GmbH / Lager-App", element_filter: "P100 Lager-App", team_size: 2, guest_count: 1 },
          { id: "b", name: "Zweites Projekt", element_filter: "", team_size: 1, guest_count: 0 },
        ]}
        activeId="a"
        loading={false}
        onSelect={onSelect}
        onCreate={onCreate}
      />,
    );
    expect(screen.getByText("P100 Lager-App · 2 Personen + 1 darf buchen")).toHaveAttribute(
      "title",
      "P100 Lager-App · 2 Personen + 1 darf buchen",
    );
    expect(screen.getByText("kein Element-Filter · 1 Person")).toBeInTheDocument();
    expect(screen.getByText("Musterkunde GmbH / Lager-App").closest("button")).toHaveAttribute("aria-current", "true");

    await user.click(screen.getByText("Zweites Projekt"));
    expect(onSelect).toHaveBeenCalledWith("b");
    await user.click(screen.getByRole("button", { name: "+ Neues Projekt" }));
    expect(onCreate).toHaveBeenCalled();
  });

  it("zeigt Lade- und Leerzustand", () => {
    const { rerender } = render(
      <ProjectSelector projects={[]} activeId={null} loading onSelect={() => {}} onCreate={() => {}} />,
    );
    expect(screen.getByText("Lade …")).toBeInTheDocument();
    rerender(<ProjectSelector projects={[]} activeId={null} loading={false} onSelect={() => {}} onCreate={() => {}} />);
    expect(screen.getByText("Noch keine Projekte angelegt.")).toBeInTheDocument();
  });
});
