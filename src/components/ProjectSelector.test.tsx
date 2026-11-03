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

  it("zeigt den Projektordner der Instanz und bietet frühere Projekte an", async () => {
    const user = userEvent.setup();
    const onImportLegacy = vi.fn();
    const folder = { dir: "C:\\Tools\\Kunde-A\\projects", legacy_count: 2 };
    const props = { activeId: null, loading: false, onSelect: () => {}, onCreate: () => {}, onImportLegacy };
    const { rerender } = render(<ProjectSelector projects={[]} folder={folder} {...props} />);
    expect(screen.getByText("Projektordner: …\\Kunde-A\\projects")).toHaveAttribute("title", folder.dir);
    await user.click(screen.getByRole("button", { name: /2 Projekte aus früherer Version übernehmen/ }));
    expect(onImportLegacy).toHaveBeenCalled();

    rerender(<ProjectSelector projects={[]} folder={{ ...folder, legacy_count: 1 }} {...props} />);
    expect(screen.getByText("1 Projekt aus früherer Version übernehmen")).toBeInTheDocument();
    rerender(<ProjectSelector projects={[]} folder={{ ...folder, legacy_count: 0 }} {...props} />);
    expect(screen.queryByText(/aus früherer Version/)).not.toBeInTheDocument();
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
