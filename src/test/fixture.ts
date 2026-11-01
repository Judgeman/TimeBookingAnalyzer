import type { AuswertungResult } from "../types/results";
import fixture from "./fixtures/sample-result.json";

/**
 * Echtes Auswertungsergebnis der Beispieldaten (von Rust erzeugt, siehe
 * `frontend_fixture_is_up_to_date` in src-tauri/src/commands/parse_export.rs).
 * Liefert jedes Mal eine frische Kopie.
 */
export function sampleResult(): AuswertungResult {
  return structuredClone(fixture) as unknown as AuswertungResult;
}
