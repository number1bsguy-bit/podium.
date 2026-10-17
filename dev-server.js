// Local server with zero dependencies: serves the app and the /api/coach endpoint.
// Usage:  ANTHROPIC_API_KEY=sk-... node dev-server.js   → http://localhost:3000
// (Not used on Vercel: there the files in public/ are served statically and
//  api/coach.js runs as a serverless function.)
import http from "node:http";
import { readFile, readFileSync, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { coach } from "./lib/coach.js";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PUB  = join(ROOT, "public");
const PORT = Number(process.env.PORT) || 3000;

// Optional .env support (KEY=VALUE lines) so you don't have to export variables.
const envFile = join(ROOT, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".json": "application/json", ".png": "image/png" };
const PUBLIC = new Set(["/index.html", "/app.js", "/app.css", "/sw.js", "/manifest.webmanifest", "/icon.svg"]);

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/api/coach") {
    if (req.method !== "POST") { res.writeHead(405, { Allow: "POST" }); return res.end(); }
    let raw = "";
    req.on("data", c => { raw += c; if (raw.length > 100_000) req.destroy(); });
    req.on("end", async () => {
      let body = {}; try { body = JSON.parse(raw || "{}"); } catch {}
      const { status, data } = await coach(body);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    });
    return;
  }
  let p = normalize(url.pathname === "/" ? "/index.html" : url.pathname);
  if (!PUBLIC.has(p)) { res.writeHead(404); return res.end("Not found"); }
  readFile(join(PUB, p), (err, buf) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" });
    res.end(buf);
  });
}).listen(PORT, () => {
  console.log(`Podium running → http://localhost:${PORT}`);
  console.log(process.env.ANTHROPIC_API_KEY ? "AI coach: enabled" : "AI coach: off (set ANTHROPIC_API_KEY to enable)");
});
