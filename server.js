// Local development / self-hosting server. Builds the site, serves dist/, and stores data in SQLite.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { build } from "./scripts/build.js";
import { ROOT } from "./src/config.js";
import { createApp } from "./src/core.js";
import { createSqliteStore } from "./src/store-sqlite.js";

const PORT = Number(process.env.PORT) || 3000;
const DIST = build();

const handle = createApp({
  store: createSqliteStore(path.resolve(ROOT, process.env.DATA_DIR || "data")),
  adminPassword: process.env.ADMIN_PASSWORD || "",
});

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

function serveStatic(res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith("/")) rel += "index.html";
  else if (!path.extname(rel)) rel += ".html";
  const filePath = path.normalize(path.join(DIST, rel));
  const inside = filePath.startsWith(DIST + path.sep);
  if (inside && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    return res.end(fs.readFileSync(filePath));
  }
  res.writeHead(404, { "Content-Type": MIME[".html"] });
  res.end(fs.readFileSync(path.join(DIST, "404.html")));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 128 * 1024) req.destroy();
      else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

http
  .createServer(async (req, res) => {
    const { pathname } = new URL(req.url, "http://localhost");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");

    try {
      if (pathname.startsWith("/api/") || pathname === "/admin" || pathname.startsWith("/admin/")) {
        const result = await handle({
          method: req.method,
          path: pathname,
          headers: req.headers,
          body: await readBody(req),
          ip: req.socket.remoteAddress,
        });
        res.writeHead(result.status, result.headers);
        return res.end(result.body);
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405);
        return res.end();
      }
      serveStatic(res, pathname);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  })
  .listen(PORT, () => {
    console.log(`Toy drive site running at http://localhost:${PORT}`);
    if (!process.env.ADMIN_PASSWORD) console.log("Admin page disabled: set ADMIN_PASSWORD to enable /admin");
  });
