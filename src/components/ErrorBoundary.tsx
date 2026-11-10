import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Was nicht angezeigt werden konnte, z. B. „Die Auswertung“. */
  what: string;
}

interface State {
  error: Error | null;
}

/**
 * Fängt Fehler beim Anzeigen ab: statt eines leeren Fensters erscheint eine
 * Meldung (mit Fehlertext zum Melden) – der Rest der App bleibt bedienbar.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="rounded-xl border-2 border-red-400 bg-red-50 px-4 py-3 text-sm text-red-950">
        <p className="font-semibold text-red-800">{this.props.what} konnte nicht angezeigt werden.</p>
        <p className="mt-1">
          Interner Fehler: <code className="rounded bg-red-100 px-1">{error.message || String(error)}</code>
        </p>
        <p className="mt-1 text-red-900">
          Bitte diese Meldung melden. Ein anderer Stichtag, ein anderes Projekt oder eine andere Datei
          funktionieren weiterhin.
        </p>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="mt-2 rounded-md border border-red-300 bg-white px-3 py-1 text-sm font-medium text-red-800 hover:bg-red-100"
        >
          Erneut versuchen
        </button>
      </div>
    );
  }
}
