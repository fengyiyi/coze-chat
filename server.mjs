// ============================================================
// 本地开发服务器（Node，无需额外依赖）
// 作用：1) 托管 next build 生成的静态站 out/  2) 代理 /api/chat 到 Coze
// 用法：
//   npm run build      # 先生成静态站
//   npm run serve      # 再启动本服务（默认 http://localhost:3000）
// 令牌从项目根目录 .env.local 读取（该文件已被 .gitignore 忽略）
// ============================================================
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { handleCozeProxy } from "./lib/cozeProxy.mjs";

const ROOT = fileURLToPath(new URL("./out", import.meta.url));

// ---- 读取 .env.local（极简实现，避免引入依赖）----
function loadEnvLocal() {
  const p = fileURLToPath(new URL("./.env.local", import.meta.url));
  if (!existsSync(p)) return;
  const txt = readFileSync(p, "utf8");
  for (const raw of txt.split("\n")) {
    const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(m[1] in process.env)) process.env[m[1]] = val;
  }
}
loadEnvLocal();

const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function nodeToWebRequest(req, url) {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  }
  const init = { method: req.method, headers };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = req;
    init.duplex = "half";
  }
  return new Request(url, init);
}

async function pipeWebToNode(response, res) {
  res.statusCode = response.status;
  response.headers.forEach((v, k) => res.setHeader(k, v));
  if (!response.body) {
    res.end();
    return;
  }
  const nodeStream = Readable.fromWeb(response.body);
  nodeStream.pipe(res);
}

async function serveStatic(url, res) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  // 防目录穿越
  let filePath = normalize(join(ROOT, pathname));
  if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[extname(filePath)] || "application/octet-stream",
    });
    res.end(data);
  } catch {
    // SPA / 未知路径回退到 index.html
    try {
      const data = await readFile(join(ROOT, "index.html"));
      res.writeHead(200, { "Content-Type": MIME[".html"] });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("Not Found");
    }
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/chat") {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": req.headers.origin || "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      });
      return res.end();
    }
    if (req.method !== "POST") {
      res.writeHead(405);
      return res.end("Method Not Allowed");
    }
    try {
      const webReq = nodeToWebRequest(req, url);
      const response = await handleCozeProxy(webReq);
      await pipeWebToNode(response, res);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Proxy error: " + (e && e.message ? e.message : String(e)));
    }
    return;
  }

  await serveStatic(url, res);
});

server.listen(PORT, () => {
  console.log(`\n  coze-chat 本地服务已启动`);
  console.log(`  ➜  UI:    http://localhost:${PORT}`);
  console.log(`  ➜  代理:  http://localhost:${PORT}/api/chat\n`);
});
