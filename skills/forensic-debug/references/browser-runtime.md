# Debugging a runtime you can't read directly (the log-server bridge)

Read this when the failing code runs somewhere whose `console.log`/stdout you can't see from your filesystem: a **browser tab**, a **mobile webview**, a **remote device**, or a **sandboxed process**. The fix is a bridge: a tiny local HTTP server receives logs the instrumented code sends it, and writes them to a file you can `cat`. This is the same idea as a frontend "debug mode" — it removes the "open DevTools and paste the console" round-trip.

Use this **only** when the runtime can't write where you can read. CLI tools, scripts, test suites, and backends should just log to a file directly (see the main SKILL.md) — the server is unnecessary overhead there.

## Workflow

1. **Start the server** (bundled, no dependencies, Node 18+). It binds to `127.0.0.1` only and writes logs under `<project>/.debug/`:

   ```bash
   node scripts/log_server.js /path/to/project &
   ```

   It prints `{"status":"started",...}`, or `{"status":"already_running",...}` if it's already up (re-running is a safe no-op).

2. **Create a session** — give it a short name describing the bug. The response hands back the session id and the exact log file path:

   ```bash
   curl -s -X POST http://127.0.0.1:8787/session -d '{"name":"fix-null-userid"}'
   # -> {"session_id":"fix-null-userid-a1b2c3","log_file":"/path/to/project/.debug/debug-fix-null-userid-a1b2c3.log"}
   ```

   Keep the `session_id`; it ties every log line to this run.

3. **Instrument** the code with a small logger that POSTs to the server (snippets below). Tag each call with the hypothesis it tests. Wrap the helper block in `// #region debug … // #endregion` so cleanup is one search.

4. **Reproduce.** Give the user precise steps (start command, the action that triggers the bug). As they exercise the app, lines stream into the log file.

5. **Read the file directly** — no copy-paste:

   ```bash
   cat /path/to/project/.debug/debug-<session_id>.log
   ```

   Truncate it (`: > file`) before each fresh reproduction so you only read the latest run.

6. **Tear down** once the fix is verified: remove the `#region debug` blocks, stop the server, delete `.debug/`.

## Logger snippets

Adapt the syntax to the project; the shape is the same everywhere. The key trick for browsers is `navigator.sendBeacon`, which is a "simple" request and so skips the CORS preflight that can silently drop logs.

**JavaScript / TypeScript:**

```js
// #region debug-<id>
const SESSION_ID = "REPLACE_WITH_SESSION_ID";
const DEBUG_URL = "http://localhost:8787/log";
function dbg(msg, data = {}, hypothesisId = null) {
  const payload = JSON.stringify({
    sessionId: SESSION_ID,
    msg,
    data,
    hypothesisId,
    loc: new Error().stack?.split("\n")[2]?.trim(),
  });
  // sendBeacon avoids the OPTIONS preflight; fall back to fetch if unavailable.
  if (navigator.sendBeacon?.(DEBUG_URL, payload)) return;
  fetch(DEBUG_URL, { method: "POST", body: payload, keepalive: true }).catch(() => {});
}
// #endregion debug-<id>

// usage — log values AND types, tagged by hypothesis
dbg("calculateScore entry", { userId, score, scoreType: typeof score }, "H1,H2");
```

**Python (e.g. a webview backend or remote service)** — uses only the standard library, so there's nothing to `pip install`:

```python
# region debug-<id>
import urllib.request, json, traceback
SESSION_ID = "REPLACE_WITH_SESSION_ID"
def dbg(msg, data=None, hypothesis_id=None):
    try:
        body = json.dumps({
            "sessionId": SESSION_ID, "msg": msg, "data": data,
            "hypothesisId": hypothesis_id,
            "loc": traceback.format_stack()[-2].strip(),
        }).encode()
        req = urllib.request.Request(
            "http://localhost:8787/log", data=body,
            headers={"Content-Type": "application/json"},
        )
        urllib.request.urlopen(req, timeout=0.5)
    except Exception:
        pass
# endregion debug-<id>

dbg("calculate_score entry", {"user_id": user_id, "type": type(user_id).__name__}, "H1")
```

## Log format

Each line the server writes is one NDJSON record — easy to scan or filter by `hypothesisId`:

```json
{"ts":"2026-01-03T12:00:00.000Z","msg":"calculateScore entry","data":{"userId":null},"hypothesisId":"H1","loc":"app.js:42"}
```

## When logs don't arrive

Almost always one of these browser constraints is silently dropping the request:

- **CORS preflight.** A `fetch` with `Content-Type: application/json` triggers an `OPTIONS` preflight. Prefer `navigator.sendBeacon` (no preflight), or send the body as plain text. The bundled server already answers `OPTIONS` and sets permissive CORS headers, so this is mostly a concern if you swap servers.
- **Mixed content.** An `https://` page is not allowed to call `http://localhost:8787`. Route the logs through your dev server as a same-origin path instead (proxy example below), or serve the endpoint over HTTPS.
- **Content Security Policy.** A strict `connect-src` blocks the log URL. Add the endpoint to CSP for the dev build, or use the same-origin proxy so the request target is your own origin.
- **Chrome extension isolated worlds.** A content script can't reach `localhost` directly. Relay through the background service worker: the content script `chrome.runtime.sendMessage(...)`, and the background script does the `fetch` to the server. Injected MAIN-world scripts relay via `window.postMessage` to the content script first.

**Same-origin dev proxy (Vite example)** — make the app POST to `/__log` on its own origin, which the dev server forwards to the log server, sidestepping mixed-content and CSP:

```js
// vite.config.js
export default {
  server: {
    proxy: {
      "/__log": {
        target: "http://localhost:8787",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/__log/, "/log"),
      },
    },
  },
};
// then POST to "/__log" instead of "http://localhost:8787/log"
```

## Remote or deployed targets

If the failing runtime isn't on `localhost` — a staging server, a phone on another network, a deployed app — it can't reach your `127.0.0.1` log server directly. Options, in order of preference:

- **Reproduce locally first.** Almost always the right move: pull the scenario down to a local run where the bridge just works. Debug on a remote/production target only when the bug genuinely won't reproduce locally.
- **Point the logger at a host the target can reach** — a log server on a machine both can see (e.g. on the same LAN), still firewalled to trusted networks.
- **A temporary tunnel** (ngrok/cloudflared) exposing the local log server, as a last resort. Treat this as sensitive: it puts a writable endpoint on the public internet, so add a hard-to-guess path or token, tear it down the moment you're done, and never send secrets or real user data through it. Get the user's explicit OK before opening a public tunnel — don't do it on your own initiative.

## Safety

- The server listens on `127.0.0.1` only — keep it that way; don't bind it to a public interface.
- Never log secrets, tokens, passwords, or personal data, even temporarily — they'd land in `.debug/` on disk.
- `.debug/` is throwaway: delete it when done, and add it to `.gitignore` so it never gets committed.
