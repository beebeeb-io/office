#!/usr/bin/env bun
// Beebeeb office — evidence-gathering static server (task 1567 goal 3/4).
//
// Serves the built LO-WASM artifact (workdir/installation/LibreOffice/emscripten/)
// from localhost with the two headers upstream's static/README.wasm.md says are
// required (COOP/COEP, for SharedArrayBuffer/pthreads), plus a CSP that restricts
// fetch/XHR/WebSocket to 'self' — this is the header set the Playwright egress test
// (egress.spec.js) runs against. Not a product server: local evidence-gathering only.
//
// Usage: bun run server.js <artifact-dir> <port>
const path = require("path");
const fs = require("fs");
const http = require("http");

const artifactDir = process.argv[2] || path.join(__dirname, "artifact");
const port = Number(process.argv[3] || 8743);
// The bbOffice bridge's canonical source lives at the repo root (`bridge/`),
// not under evidence/ -- served directly from there so the harness never
// drifts from a copy. See bridge/bb-office-worker.js's own header comment.
const bridgeDir = path.join(__dirname, "..", "..", "bridge");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".wasm": "application/wasm",
  ".data": "application/octet-stream",
  ".json": "application/json",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

function send(res, status, body, headers) {
  res.writeHead(status, headers);
  res.end(body);
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  // host.html (and other harness-only pages) live alongside this server script, not
  // in the artifact directory -- serve those from here first. /bridge/* is the
  // canonical bbOffice bridge source at the repo root (bridge/), served
  // directly so this harness can never drift from a stale copy.
  const harnessPath = path.join(__dirname, urlPath);
  const bridgePath = urlPath.startsWith("/bridge/") ? path.join(bridgeDir, urlPath.slice("/bridge/".length)) : null;
  const filePath = bridgePath && fs.existsSync(bridgePath) && fs.statSync(bridgePath).isFile()
    ? bridgePath
    : fs.existsSync(harnessPath) && fs.statSync(harnessPath).isFile()
    ? harnessPath
    : path.join(artifactDir, urlPath === "/" ? "/index.html" : urlPath);

  // Egress gate headers (task 1567 goal 4): COOP/COEP required by upstream for the
  // WASM module itself (pthreads need SharedArrayBuffer, which requires cross-origin
  // isolation); CSP connect-src 'self' is the actual egress assertion surface —
  // Playwright's request capture is the ground truth, this header is defense in depth
  // so a real browser (not just our test) also refuses any non-self fetch/XHR/WS.
  const headers = {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
  };
  // connect-src 'self' is defense in depth on top of the Playwright-side request
  // capture (egress.spec.js) -- BB_SERVE_NO_CSP=1 drops it so that spec's red-proof
  // (a deliberate external fetch) can prove the CAPTURE ITSELF catches an escaped
  // request, independent of this header stopping it first. script-src allows
  // 'unsafe-inline' because qt_soffice.html's own generated loader script is inline;
  // that governs what CODE may run, not what network access it has once running.
  if (process.env.BB_SERVE_NO_CSP !== "1") {
    headers["Content-Security-Policy"] =
      "default-src 'self'; connect-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;";
  }

  if (!filePath.startsWith(artifactDir) && !filePath.startsWith(path.join(__dirname)) && !filePath.startsWith(bridgeDir)) {
    return send(res, 403, "forbidden", headers);
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      return send(res, 404, "not found: " + urlPath, headers);
    }
    const ext = path.extname(filePath);
    headers["Content-Type"] = MIME[ext] || "application/octet-stream";
    send(res, 200, data, headers);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`serving ${artifactDir} on http://127.0.0.1:${port} (COOP/COEP + CSP connect-src 'self')`);
});
