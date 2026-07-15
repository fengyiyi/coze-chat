// ============================================================
// ESA 边缘函数：Coze 流式代理（Serverless）
//
// 部署方式：在阿里云 ESA「函数和 Pages」中导入本 GitHub 仓库，
// 将「函数文件路径」指向本文件（./src/index.ts）。
//
// Coze 令牌通过构建时注入获取（见 scripts/prebuild.cjs）：
//   在 ESA「基本信息→构建信息→环境变量」中配置
//   COZE_TOKEN_1 ~ COZE_TOKEN_4（分片，每片 ≤200 字符）
//   构建时自动拼接写入 src/.coze-token.mjs，本文件 import 使用。
//
// ALLOWED_HOST 同理通过构建时 process.env 读取并内嵌。
//
// ESA 边缘函数遵循 Web 标准（Request / Response / fetch），
// 入口与 Cloudflare Workers 类似：export default { fetch }
// ============================================================

import { COZE_TOKEN } from "./.coze-token.mjs";

const COZE_ENDPOINT = "https://h68g4m5246.coze.site/stream_run";
const COZE_PROJECT_ID = 7662259982867660806;
const DEFAULT_SESSION_ID = "3Zvk1mhLLkTwQ9E70tUAn";
const ALLOWED_HOST = "ai.alfedu.com";

function isAllowedHost(request, allowed) {
  if (!allowed) return true;
  const hosts = allowed
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (hosts.length === 0) return true;
  const host = (
    request.headers.get("host") ||
    request.headers.get("x-forwarded-host") ||
    ""
  ).toLowerCase();
  return hosts.includes(host);
}

async function handleChat(request) {
  if (!isAllowedHost(request, ALLOWED_HOST)) {
    return new Response("Forbidden: domain not allowed", { status: 403 });
  }

  if (!COZE_TOKEN) {
    return new Response(
      "Server misconfiguration: COZE_TOKEN missing",
      { status: 500 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const message = body && body.message;
  if (!message || typeof message !== "string") {
    return new Response('Missing "message"', { status: 400 });
  }
  const sessionId = (body && body.session_id) || DEFAULT_SESSION_ID;

  const cozeBody = {
    content: {
      query: {
        prompt: [{ type: "text", content: { text: message } }],
      },
    },
    type: "query",
    session_id: sessionId,
    project_id: COZE_PROJECT_ID,
  };

  const origin = request.headers.get("origin") || "";

  const upstream = await fetch(COZE_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${COZE_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(cozeBody),
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": origin || "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/api/chat") {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": request.headers.get("origin") || "*",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
          },
        });
      }
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      return handleChat(request);
    }

    return new Response("Not Found", { status: 404 });
  },
};
