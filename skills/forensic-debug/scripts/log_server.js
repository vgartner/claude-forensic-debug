#!/usr/bin/env node
/*
 * log_server.js — tiny local log sink for debugging runtimes you can't read directly
 * (browser tabs, mobile webviews, remote devices). The instrumented code POSTs each
 * log line here over HTTP; the server appends it to a file the agent can read with `cat`.
 *
 * Usage:   node scripts/log_server.js [projectDir]
 *          PORT=8787 node scripts/log_server.js /path/to/project
 *
 * No dependencies. Node 18+. Binds to 127.0.0.1 only (never exposed to the network).
 *
 * Endpoints:
 *   GET  /            -> {"status":"ok","logDir":"..."}            health check
 *   POST /session     -> {"session_id":"...","log_file":"..."}    body: {"name":"short-desc"}
 *   POST /log         -> {"ok":true}                              body: {"sessionId","msg","data","hypothesisId","loc"}
 *
 * Each /log call appends one NDJSON line:
 *   {"ts":"<iso>","msg":"...","data":{...},"hypothesisId":"H1","loc":"file:line"}
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT) || 8787;
const HOST = "127.0.0.1";
const projectDir = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const logDir = path.join(projectDir, ".debug");

fs.mkdirSync(logDir, { recursive: true });

// Permissive CORS so a browser fetch/sendBeacon from any dev origin can reach us.
// This server is localhost-only and exists only during a debug session.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json", ...CORS });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 1_000_000) req.destroy(); // 1 MB guard
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({ _raw: raw }); // tolerate non-JSON (e.g. sendBeacon text)
      }
    });
  });
}

function logFileFor(sessionId) {
  // Keep the filename to a safe character set derived from the session id.
  const safe = String(sessionId).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  return path.join(logDir, `debug-${safe}.log`);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    return res.end();
  }

  if (req.method === "GET" && req.url === "/") {
    return send(res, 200, { status: "ok", logDir });
  }

  if (req.method === "POST" && req.url === "/session") {
    const body = await readBody(req);
    const name = String(body.name || "session").replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 60);
    const sessionId = `${name}-${crypto.randomBytes(3).toString("hex")}`;
    const file = logFileFor(sessionId);
    fs.writeFileSync(file, ""); // create/truncate
    return send(res, 200, { session_id: sessionId, log_file: file });
  }

  if (req.method === "POST" && req.url === "/log") {
    const body = await readBody(req);
    if (!body.sessionId) return send(res, 400, { ok: false, error: "missing sessionId" });
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      msg: body.msg ?? "",
      data: body.data ?? null,
      hypothesisId: body.hypothesisId ?? null,
      loc: body.loc ?? null,
    });
    fs.appendFile(logFileFor(body.sessionId), line + "\n", () => {});
    return send(res, 200, { ok: true });
  }

  send(res, 404, { ok: false, error: "not found" });
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    // Re-running is a no-op: a server is already listening on this port.
    console.log(JSON.stringify({ status: "already_running", port: PORT, logDir }));
    process.exit(0);
  }
  console.error(JSON.stringify({ status: "error", error: String(err) }));
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(JSON.stringify({ status: "started", port: PORT, host: HOST, logDir }));
});
