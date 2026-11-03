import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { formatDate, formatDateTime } from "../lib/format";
import type { LastImport } from "../types/results";

type HoverState = "none" | "valid" | "invalid";

interface Props {
  /** Kein aktives Projekt → Drop wird abgelehnt. */
  disabled: boolean;
  busy: boolean;
  /** Zuletzt eingelesene Datei (für die Anzeige). */
  current: { fileName: string; exportDate: string | null } | null;
  /** Gemerkte letzte Import-Datei des Projekts (Kopie im Ordner „Import“). */
  lastImport?: LastImport | null;
  onFile: (path: string) => void;
  onError: (message: string) => void;
}

const isXlsx = (path: string) => path.toLowerCase().endsWith(".xlsx");

/**
 * Drop-Bereich für den ProjectForge-Export.
 *
 * In Tauri liefert das HTML5-Drag-and-Drop keine Dateipfade; deshalb hören wir
 * auf die Drag-Drop-Events des Webviews. Diese gelten für das ganze Fenster –
 * die Datei kann also überall abgelegt werden, der Bereich zeigt den Zustand an.
 */
export function DropZone({ disabled, busy, current, lastImport, onFile, onError }: Props) {
  const [hover, setHover] = useState<HoverState>("none");

  // Callbacks in Refs halten, damit der Listener nur einmal registriert wird.
  const handlers = useRef({ disabled, onFile, onError });
  handlers.current = { disabled, onFile, onError };

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    getCurrentWebview()
      .onDragDropEvent(({ payload }) => {
        if (payload.type === "enter") {
          setHover(payload.paths.some(isXlsx) ? "valid" : "invalid");
        } else if (payload.type === "leave") {
          setHover("none");
        } else if (payload.type === "drop") {
          setHover("none");
          accept(payload.paths);
        }
      })
      .then((fn) => {
        // StrictMode mountet doppelt – späte Registrierung sofort wieder lösen.
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((e) => handlers.current.onError(`Drag & Drop nicht verfügbar: ${e}`));

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  function accept(paths: string[]) {
    const { disabled, onFile, onError } = handlers.current;
    const path = paths.find(isXlsx);
    if (!path) {
      onError("Bitte eine .xlsx-Datei (ProjectForge-Export) ablegen.");
    } else if (disabled) {
      onError("Bitte zuerst links ein Projekt auswählen oder anlegen.");
    } else {
      onFile(path);
    }
  }

  async function browse() {
    try {
      const path = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "ProjectForge-Export", extensions: ["xlsx"] }],
      });
      if (path) accept([path]);
    } catch (e) {
      onError(`Dateiauswahl fehlgeschlagen: ${e}`);
    }
  }

  const tone =
    hover === "valid" && !disabled
      ? "border-emerald-500 bg-emerald-50"
      : hover !== "none"
        ? "border-red-400 bg-red-50"
        : disabled
          ? "border-slate-200 bg-slate-50"
          : "border-slate-300 bg-white";

  return (
    <section
      aria-label="Export-Datei ablegen"
      className={`rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${tone}`}
    >
      <p className="text-base font-medium text-slate-800">
        {busy
          ? "Export wird eingelesen …"
          : hover === "valid" && !disabled
            ? "Loslassen zum Einlesen"
            : hover !== "none"
              ? disabled
                ? "Kein Projekt ausgewählt"
                : "Nur .xlsx-Dateien werden unterstützt"
              : "ProjectForge-Export (.xlsx) hierher ziehen"}
      </p>
      <p className="mt-1 text-sm text-slate-500">
        {disabled
          ? "Wähle links ein Projekt aus oder lege ein neues an, um einen Export auszuwerten."
          : "Die Datei wird sofort mit dem aktiven Projekt eingelesen."}
      </p>

      <button
        type="button"
        onClick={browse}
        disabled={disabled || busy || !isTauri()}
        className="mt-4 rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Datei auswählen …
      </button>

      {current && (
        <p className="mt-4 text-sm text-slate-600">
          <span className="font-medium text-slate-800">{current.fileName}</span>
          {" · "}Stand {formatDate(current.exportDate)}
        </p>
      )}
      {lastImport && (
        <p
          className="mt-1 text-xs text-slate-500"
          title={[
            `Kopie: ${lastImport.path}`,
            lastImport.original_path && `Original: ${lastImport.original_path}`,
          ]
            .filter(Boolean)
            .join("\n")}
        >
          {current?.fileName === lastImport.file_name
            ? "Als letzter Import gemerkt"
            : `Letzter Import: ${lastImport.file_name}`}
          {lastImport.imported_at && ` (${formatDateTime(lastImport.imported_at)})`} – wird beim
          nächsten Öffnen automatisch geladen.
        </p>
      )}
    </section>
  );
}
