// 3D 认知场的静态服务器（无依赖）。
//
//   node tools/serve-brain3d.ts
//
// 默认 0.0.0.0:6123，方便同一局域网用手机打开。只服务 public/brain3d。

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { extname, resolve, sep } from "node:path";

const ROOT = resolve("public/brain3d");
const PORT = Number(process.env.PORT ?? 6123);
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const file = resolve(ROOT, `.${pathname}`);
    if (!file.startsWith(ROOT + sep)) {
      response.writeHead(403).end("forbidden");
      return;
    }
    const info = await stat(file);
    if (!info.isFile()) {
      response.writeHead(404).end("not found");
      return;
    }
    const body = await readFile(file);
    const ext = extname(file);
    response.writeHead(200, {
      "content-type": MIME[ext] ?? "application/octet-stream",
      "cache-control": pathname.startsWith("/vendor/") ? "public, max-age=31536000, immutable" : "no-cache",
      "content-length": body.length,
    });
    response.end(body);
  } catch {
    response.writeHead(404).end("not found");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`EXPERIENCE // GROWING FIELD`);
  console.log(`  http://127.0.0.1:${PORT}/`);
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        console.log(`  http://${address.address}:${PORT}/   (${name}, 手机同一局域网)`);
      }
    }
  }
});
