// Minimaler WebDriver-Client (W3C) für tauri-driver – ohne Abhängigkeiten.

const BASE = process.env.E2E_WEBDRIVER_URL ?? "http://127.0.0.1:4444";

/** Verbindungsabbruch des Treibers (bei WebKitWebDriver unter Xvfb gelegentlich). */
export function isConnectionError(error) {
  const text = `${error?.message ?? ""} ${error?.cause?.code ?? ""} ${error?.cause?.message ?? ""}`;
  return /fetch failed|ECONNRESET|ECONNREFUSED|UND_ERR_SOCKET|other side closed|socket hang up/i.test(text);
}

async function call(method, path, body) {
  const response = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok || json.value?.error) {
    throw new Error(`WebDriver ${method} ${path}: ${json.value?.message ?? response.status}`);
  }
  return json.value;
}

export async function waitForDriver(timeoutMs = 20_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      await fetch(`${BASE}/status`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(`tauri-driver antwortet nicht unter ${BASE}`);
}

export class AppSession {
  static async start(application) {
    const value = await call("POST", "/session", {
      capabilities: {
        alwaysMatch: { browserName: "wry", "tauri:options": { application } },
      },
    });
    const session = new AppSession(value.sessionId);
    await session.#call("POST", "/window/rect", { width: 1440, height: 1000 }).catch(() => {});
    return session;
  }

  constructor(id) {
    this.id = id;
  }

  #call(method, path, body) {
    return call(method, `/session/${this.id}${path}`, body);
  }

  async end() {
    await this.#call("DELETE", "").catch(() => {});
  }

  execute(script, ...args) {
    return this.#call("POST", "/execute/sync", { script, args });
  }

  executeAsync(script, ...args) {
    return this.#call("POST", "/execute/async", { script, args });
  }

  /** Sichtbarer Text; geschützte Leerzeichen (z. B. vor „€“) als normale. */
  async text() {
    const value = await this.execute("return document.body.innerText");
    return value.replace(/ | /g, " ");
  }

  async waitForText(expected, timeoutMs = 15_000) {
    const end = Date.now() + timeoutMs;
    let last = "";
    while (Date.now() < end) {
      last = await this.text();
      if (last.includes(expected)) return last;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`Text nicht gefunden: „${expected}“\n--- Seite ---\n${last.slice(0, 3000)}`);
  }

  /** Klickt das erste Element (CSS-Selektor) mit genau diesem Text. */
  async click(selector, text) {
    const ok = await this.execute(
      `const el = [...document.querySelectorAll(arguments[0])].find((e) => e.textContent.trim() === arguments[1]);
       if (!el) return false; el.click(); return true;`,
      selector,
      text,
    );
    if (!ok) throw new Error(`Element ${selector} „${text}“ nicht gefunden`);
  }

  /**
   * Setzt den Wert eines Eingabefelds React-kompatibel (nativer Setter + Event).
   * Tastatureingaben über WebDriver sind mit WebKitWebDriver unter Xvfb instabil.
   */
  async setValue(selector, value) {
    const ok = await this.execute(
      `const el = document.querySelector(arguments[0]);
       if (!el) return false;
       const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
         : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
       Object.getOwnPropertyDescriptor(proto, "value").set.call(el, arguments[1]);
       el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
       return true;`,
      selector,
      value,
    );
    if (!ok) throw new Error(`Eingabefeld ${selector} nicht gefunden`);
  }

  /** Simuliert das Ablegen einer Datei (dasselbe Event, das Tauri beim Drop sendet). */
  async dropFile(path) {
    await this.executeAsync(
      `const done = arguments[arguments.length - 1];
       window.__TAURI_INTERNALS__
         .invoke("plugin:event|emit", { event: "tauri://drag-drop", payload: { paths: [arguments[0]], position: { x: 1, y: 1 } } })
         .then(() => done("ok"), (e) => done("Fehler: " + e));`,
      path,
    );
  }

  async screenshot() {
    return Buffer.from(await this.#call("GET", "/screenshot"), "base64");
  }
}
