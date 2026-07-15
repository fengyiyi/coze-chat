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
// ⚠️ 关键：ESA 网关对边缘函数有 **10 秒首次响应超时**
//   （ER 在 10 秒内不返回任何数据 → 网关返回 504）。
//   本文件使用 ReadableStream 立即回传心跳事件来保活连接，
//   再异步管道式转发 Coze 的流式响应。
//
// ESA 边缘函数遵循 Web 标准（Request / Response / fetch），
// 入口与 Cloudflare Workers 类似：export default { fetch }
// ============================================================

import { COZE_TOKEN } from "./.coze-token.mjs";

const COZE_ENDPOINT = "https://h68g4m5246.coze.site/stream_run";
const COZE_PROJECT_ID = 7662259982867660806;
const DEFAULT_SESSION_ID = "3Zvk1mhLLkTwQ9E70tUAn";
// 构建时从 process.env.ALLOWED_HOST 注入（见 prebuild.cjs）
const ALLOWED_HOST =
  (typeof __ALLOWED_HOST__ !== "undefined" ? __ALLOWED_HOST__ : "") ||
  "ai.alfedu.com";

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
  // 1) 域名白名单
  if (!isAllowedHost(request, ALLOWED_HOST)) {
    return new Response("Forbidden: domain not allowed", { status: 403 });
  }

  // 2) 令牌由构建时注入（import 自 .coze-token.mjs）
  if (!COZE_TOKEN) {
    return new Response(
      "Server misconfiguration: COZE_TOKEN missing (prebuild failed or env vars not set)",
      { status: 500 }
    );
  }

  // 3) 解析请求体
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

  // 4) 转发到 Coze（非阻塞，拿到 response 即可开始流式传输）
  let upstream;
  try {
    upstream = await fetch(COZE_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${COZE_TOKEN}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(cozeBody),
    });
  } catch (fetchErr) {
    return new Response(
      "Upstream fetch failed: " + (fetchErr.message || String(fetchErr)),
      { status: 502 }
    );
  }

  // 5) 用 ReadableStream 立即回传数据，防止 ESA 10 秒网关超时导致 504
  //
  //    原理：ESA 网关要求 ER 在 10 秒内必须返回首个字节，
  //    否则断连返回 504。Coze 首次响应可能超过 10 秒，
  //    所以我们先发一个心跳事件让网关看到数据，再管道式透传 Coze 响应体。

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // 立即发送心跳 —— 让网关在 10 秒内看到数据
      controller.enqueue(
        encoder.encode('event: ping\ndata: {"type":"thinking"}\n\n')
      );

      // 如果上游返回了非 2xx，发送错误事件并关闭
      if (!upstream.ok) {
        const errText =
          (await upstream.text().catch(() => "")) ||
          `Coze API error (${upstream.status})`;
        controller.enqueue(
          encoder.encode(
            'event: error\ndata: ' +
              JSON.stringify({ type: "error", message: errText }) +
              "\n\n"
          )
        );
        controller.close();
        return;
      }

      // 管道式透传 Coze 的流式响应
      const reader = upstream.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
      } catch (pipeErr) {
        // 上游连接中断时通知客户端
        controller.enqueue(
          encoder.encode(
            'event: error\ndata: ' +
              JSON.stringify({
                type: "error",
                message: "Upstream stream interrupted",
              }) +
              "\n\n"
          )
        );
      } finally {
        reader.releaseLock();
      }

      // 发送结束标记
      controller.enqueue(
        encoder.encode('event: done\ndata: {"type":"done"}\n\n')
      );
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
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
      // 预检请求
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin":
              request.headers.get("origin") || "*",
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
