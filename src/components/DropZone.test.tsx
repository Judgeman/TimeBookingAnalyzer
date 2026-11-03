import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

type DragHandler = (event: { payload: { type: string; paths?: string[] } }) => void;
let dragHandler: DragHandler | null = null;
const unlisten = vi.fn();
const openDialog = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (handler: DragHandler) => {
      dragHandler = handler;
      return Promise.resolve(unlisten);
    },
  }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: (...args: unknown[]) => openDialog(...args) }));

const { DropZone } = await import("./DropZone");

async function drag(type: string, paths?: string[]) {
  await act(async () => dragHandler!({ payload: { type, paths } }));
}

describe("DropZone", () => {
  beforeEach(() => {
    dragHandler = null;
    openDialog.mockReset();
  });

  it("nimmt abgelegte .xlsx-Dateien an und zeigt den Zustand beim Ziehen", async () => {
    const onFile = vi.fn();
    const onError = vi.fn();
    render(<DropZone disabled={false} busy={false} current={null} onFile={onFile} onError={onError} />);
    await vi.waitFor(() => expect(dragHandler).not.toBeNull());

    await drag("enter", ["/x/export.xlsx"]);
    expect(screen.getByText("Loslassen zum Einlesen")).toBeInTheDocument();
    await drag("drop", ["/x/notiz.txt", "/x/export.XLSX"]);
    expect(onFile).toHaveBeenCalledWith("/x/export.XLSX");

    await drag("enter", ["/x/notiz.txt"]);
    expect(screen.getByText("Nur .xlsx-Dateien werden unterstützt")).toBeInTheDocument();
    await drag("drop", ["/x/notiz.txt"]);
    expect(onError).toHaveBeenCalledWith("Bitte eine .xlsx-Datei (ProjectForge-Export) ablegen.");
    await drag("leave");
    expect(screen.getByText("ProjectForge-Export (.xlsx) hierher ziehen")).toBeInTheDocument();
  });

  it("lehnt Dateien ohne aktives Projekt ab und löst den Listener beim Entfernen", async () => {
    const onError = vi.fn();
    const { unmount } = render(
      <DropZone disabled busy={false} current={null} onFile={vi.fn()} onError={onError} />,
    );
    await vi.waitFor(() => expect(dragHandler).not.toBeNull());
    await drag("drop", ["/x/export.xlsx"]);
    expect(onError).toHaveBeenCalledWith("Bitte zuerst links ein Projekt auswählen oder anlegen.");
    expect(screen.getByRole("button", { name: "Datei auswählen …" })).toBeDisabled();
    unmount();
    expect(unlisten).toHaveBeenCalled();
  });

  it("öffnet den Datei-Dialog und zeigt die aktuelle Datei", async () => {
    const user = userEvent.setup();
    const onFile = vi.fn();
    openDialog.mockResolvedValue("C:\\Exporte\\export_2026-10-31.xlsx");
    render(
      <DropZone
        disabled={false}
        busy={false}
        current={{ fileName: "export_2026-10-31.xlsx", exportDate: "2026-10-31" }}
        onFile={onFile}
        onError={vi.fn()}
      />,
    );
    expect(screen.getByText("export_2026-10-31.xlsx")).toBeInTheDocument();
    expect(screen.getByText(/Stand 31\.10\.2026/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Datei auswählen …" }));
    expect(openDialog).toHaveBeenCalledWith(expect.objectContaining({ multiple: false }));
    expect(onFile).toHaveBeenCalledWith("C:\\Exporte\\export_2026-10-31.xlsx");
  });

  it("zeigt die gemerkte letzte Import-Datei", () => {
    const lastImport = {
      path: "C:\\Tools\\Kunde-A\\Import\\p1\\export_2026-10-31.xlsx",
      file_name: "export_2026-10-31.xlsx",
      original_path: "C:\\Downloads\\export_2026-10-31.xlsx",
      imported_at: "2026-11-03T11:20:15",
    };
    const props = { disabled: false, busy: false, onFile: vi.fn(), onError: vi.fn() };
    const { rerender } = render(
      <DropZone
        {...props}
        current={{ fileName: "export_2026-10-31.xlsx", exportDate: "2026-10-31" }}
        lastImport={lastImport}
      />,
    );
    const note = screen.getByText(/Als letzter Import gemerkt \(03\.11\.2026, 11:20\)/);
    expect(note).toHaveTextContent("wird beim nächsten Öffnen automatisch geladen");
    expect(note.title).toBe(
      "Kopie: C:\\Tools\\Kunde-A\\Import\\p1\\export_2026-10-31.xlsx\nOriginal: C:\\Downloads\\export_2026-10-31.xlsx",
    );

    // noch nicht (oder nicht mehr) ausgewertet, von Hand abgelegt
    rerender(
      <DropZone {...props} current={null} lastImport={{ ...lastImport, original_path: null, imported_at: null }} />,
    );
    const manual = screen.getByText(/Letzter Import: export_2026-10-31\.xlsx/);
    expect(manual.title).toBe("Kopie: C:\\Tools\\Kunde-A\\Import\\p1\\export_2026-10-31.xlsx");
    expect(manual).not.toHaveTextContent("(");
  });
});
