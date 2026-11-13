import { useEffect, useState, type FormEvent } from "react";
import { api, errorMessage } from "../lib/api";
import type { ProjectForgeSettings } from "../types/results";
import { Field, ui } from "./editor/ui";

interface Props {
  onClose: () => void;
  /** Nach dem Speichern bzw. Entfernen des Schlüssels. */
  onChange?: (settings: ProjectForgeSettings) => void;
}

type Status = { tone: "ok" | "error"; text: string } | null;

/**
 * Zugang zu ProjectForge für diese Instanz: Server-Adresse, User-ID und
 * Schlüssel für Rest-Clients (liegt in der Anmeldeinformationsverwaltung des
 * Betriebssystems, nicht in einer Datei).
 */
export function ProjectForgeAccess({ onClose, onChange }: Props) {
  const [settings, setSettings] = useState<ProjectForgeSettings | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [userId, setUserId] = useState("");
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<Status>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    api
      .projectForgeSettings()
      .then((loaded) => {
        setSettings(loaded);
        setBaseUrl(loaded.base_url);
        setUserId(loaded.user_id === null ? "" : String(loaded.user_id));
      })
      .catch((e) => setStatus({ tone: "error", text: errorMessage(e) }));
  }, []);

  function changed(next: ProjectForgeSettings) {
    setSettings(next);
    setToken("");
    onChange?.(next);
  }

  async function save(test: boolean) {
    setWorking(true);
    setStatus(null);
    try {
      const id = Number(userId);
      if (!Number.isInteger(id) || id <= 0) {
        throw "Die User-ID ist eine Zahl – im Browser <Server>/rs/userStatus öffnen und „userId“ ablesen.";
      }
      changed(await api.saveProjectForgeSettings(baseUrl, id, token.trim() || null));
      setStatus({
        tone: "ok",
        text: test ? await api.testProjectForge() : "Zugang gespeichert.",
      });
    } catch (e) {
      setStatus({ tone: "error", text: errorMessage(e) });
    } finally {
      setWorking(false);
    }
  }

  async function removeToken() {
    setWorking(true);
    setStatus(null);
    try {
      changed(await api.deleteProjectForgeToken());
      setStatus({ tone: "ok", text: "Schlüssel entfernt." });
    } catch (e) {
      setStatus({ tone: "error", text: errorMessage(e) });
    } finally {
      setWorking(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void save(true);
  }

  return (
    <form onSubmit={submit} className={`${ui.card} max-w-3xl space-y-4`} aria-label="ProjectForge-Zugang">
      <div>
        <h2 className="text-base font-semibold">ProjectForge-Zugang</h2>
        <p className={`mt-1 ${ui.hint}`}>
          Für Projekte mit der Datenquelle „ProjectForge“ holt die App die Buchungen selbst – ohne
          Export-Datei. Der Zugang gilt für alle Projekte dieser Instanz.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <Field label="Server-Adresse">
            <input
              aria-label="Server-Adresse"
              required
              placeholder="https://projectforge.example.com"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className={ui.input}
            />
          </Field>
        </div>
        <Field label="User-ID" hint="Zahl aus <Server>/rs/userStatus („userId“)">
          <input
            aria-label="User-ID"
            required
            inputMode="numeric"
            placeholder="z. B. 42"
            value={userId}
            onChange={(e) => setUserId(e.target.value.trim())}
            className={ui.input}
          />
        </Field>
      </div>
      <Field
        label="Schlüssel für Rest-Clients"
        hint="ProjectForge → Mein Zugang → „Schlüssel für Rest-Clients“. Wird in der Anmeldeinformationsverwaltung des Betriebssystems gespeichert, nie in einer Datei."
      >
        <input
          aria-label="Schlüssel"
          type="password"
          autoComplete="off"
          placeholder={
            settings?.has_token ? "gespeichert – leer lassen, um ihn zu behalten" : "Schlüssel einfügen"
          }
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className={ui.input}
        />
      </Field>

      {status && (
        <p
          role={status.tone === "error" ? "alert" : "status"}
          className={`rounded-md px-3 py-2 text-sm ${
            status.tone === "error" ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"
          }`}
        >
          {status.text}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={working} className={ui.primaryButton}>
          Speichern und Verbindung testen
        </button>
        <button
          type="button"
          disabled={working}
          onClick={() => void save(false)}
          className={ui.secondaryButton}
        >
          Nur speichern
        </button>
        {settings?.has_token && (
          <button
            type="button"
            disabled={working}
            onClick={() => void removeToken()}
            className={ui.secondaryButton}
          >
            Schlüssel entfernen
          </button>
        )}
        <button type="button" onClick={onClose} className={`${ui.secondaryButton} ml-auto`}>
          Schließen
        </button>
      </div>
    </form>
  );
}

/** Zugang vollständig (Adresse, User-ID, Schlüssel)? */
export function isConfigured(settings: ProjectForgeSettings | null): boolean {
  return Boolean(settings?.base_url && settings.user_id && settings.has_token);
}
