import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
const { ProjectForgeAccess, isConfigured } = await import("./ProjectForgeAccess");

describe("ProjectForgeAccess", () => {
  let stored = { base_url: "https://pf.example.com", user_id: 42 as number | null, has_token: true };
  beforeEach(() => {
    stored = { base_url: "https://pf.example.com", user_id: 42, has_token: true };
    invoke.mockReset().mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      switch (command) {
        case "projectforge_settings":
          return { ...stored };
        case "save_projectforge_settings":
          stored = { base_url: String(args!.baseUrl), user_id: args!.userId as number, has_token: true };
          return { ...stored };
        case "delete_projectforge_token":
          stored = { ...stored, has_token: false };
          return { ...stored };
        case "test_projectforge":
          throw "ProjectForge hat die Anmeldung abgelehnt (Weiterleitung zur Anmeldeseite).";
      }
    });
  });

  it("zeigt den gespeicherten Zugang, speichert ohne neuen Schlüssel und entfernt ihn", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onClose = vi.fn();
    render(<ProjectForgeAccess onClose={onClose} onChange={onChange} />);
    expect(await screen.findByDisplayValue("https://pf.example.com")).toBeInTheDocument();
    expect(screen.getByLabelText("User-ID")).toHaveValue("42");
    expect(screen.getByLabelText("Schlüssel")).toHaveAttribute(
      "placeholder",
      "gespeichert – leer lassen, um ihn zu behalten",
    );
    await user.click(screen.getByRole("button", { name: "Nur speichern" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Zugang gespeichert.");
    expect(invoke).toHaveBeenCalledWith("save_projectforge_settings", {
      baseUrl: "https://pf.example.com",
      userId: 42,
      token: null,
    });
    expect(onChange).toHaveBeenCalledWith({
      base_url: "https://pf.example.com",
      user_id: 42,
      has_token: true,
    });

    await user.click(screen.getByRole("button", { name: "Schlüssel entfernen" }));
    expect(await screen.findByText("Schlüssel entfernt.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Schlüssel entfernen" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Schlüssel")).toHaveAttribute("placeholder", "Schlüssel einfügen");
    await user.click(screen.getByRole("button", { name: "Schließen" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("meldet ungültige User-ID und abgelehnte Anmeldung", async () => {
    const user = userEvent.setup();
    stored = { base_url: "", user_id: null, has_token: false };
    render(<ProjectForgeAccess onClose={() => {}} />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("projectforge_settings"));
    await user.type(screen.getByLabelText("Server-Adresse"), "pf.example.com");
    await user.type(screen.getByLabelText("User-ID"), "emustermann");
    await user.click(screen.getByRole("button", { name: "Nur speichern" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Die User-ID ist eine Zahl");
    await user.clear(screen.getByLabelText("User-ID"));
    await user.type(screen.getByLabelText("User-ID"), "42");
    await user.type(screen.getByLabelText("Schlüssel"), "falsch");
    await user.click(screen.getByRole("button", { name: "Speichern und Verbindung testen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Anmeldung abgelehnt");
    expect(screen.getByLabelText("Schlüssel")).toHaveValue(""); // gespeichert, Feld geleert
  });

  it("Fehler beim Laden und isConfigured", async () => {
    invoke.mockRejectedValueOnce("Einstellungen fehlerhaft");
    render(<ProjectForgeAccess onClose={() => {}} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Einstellungen fehlerhaft");
    expect(isConfigured(null)).toBe(false);
    expect(isConfigured({ base_url: "x", user_id: 1, has_token: false })).toBe(false);
    expect(isConfigured({ base_url: "x", user_id: 1, has_token: true })).toBe(true);
  });
});
