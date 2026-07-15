// ============================================================
// Coze 流式代理 —— 核心逻辑（与运行环境无关的纯函数）
// 被本地 Node 服务 server.mjs 复用；ESA 上的 src/index.ts 为等效自包含实现。
//
// 职责：
//   1. 校验请求域名是否在白名单（ALLOWED_HOST），否则 403
//   2. 从环境变量读取 COZE_TOKEN（前端永不接触）
//   3. 将用户消息转发给 Coze 的 stream_run 接口
//   4. 把 Coze 返回的 SSE 流原样透传回浏览器
// ============================================================

export const COZE_ENDPOINT = "https://h68g4m5246.coze.site/stream_run";
export const COZE_PROJECT_ID = 7662259982867660806;
export const DEFAULT_SESSION_ID = "3Zvk1mhLLkTwQ9E70tUAn";

// 兼容 ESA 边缘函数的 env 对象与 Node 的 process.env
export function getEnv(name, env) {
  if (env && env[name]) return env[name];
  if (typeof process !== "undefined" && process.env && process.env[name]) {
    return process.env[name];
  }
  return "";
}

// ESA 单条环境变量 Value 上限 200 字符，Coze Bearer 令牌（约 739 字符）需分片存储：
//   COZE_TOKEN_1 / COZE_TOKEN_2 / ... / COZE_TOKEN_9（按顺序拼接还原）
// 也兼容单行完整令牌 COZE_TOKEN（本地无此限制）。
export function getCozeToken(env) {
  const parts = [];
  for (let i = 1; i <= 9; i++) {
    const v = getEnv("COZE_TOKEN_" + i, env);
    if (v) parts.push(v);
    else break;
  }
  if (parts.length) return parts.join("");
  return getEnv("COZE_TOKEN", env);
}

// 域名白名单校验：ALLOWED_HOST 留空则放行（开发态），生产务必配置
export function isAllowedHost(request, allowed) {
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

export async function handleCozeProxy(request, envLike) {
  const token = getCozeToken(envLike);
  const allowed = getEnv("ALLOWED_HOST", envLike);
  const endpoint = getEnv("COZE_API_URL", envLike) || COZE_ENDPOINT;

  // 1) 域名白名单
  if (!isAllowedHost(request, allowed)) {
    return new Response("Forbidden: domain not allowed", { status: 403 });
  }

  // 2) 令牌必须存在（服务端）
  if (!token) {
    return new Response("Server misconfiguration: COZE_TOKEN missing", {
      status: 500,
    });
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

  // 4) 转发到 Coze 并流式回传 SSE
  const upstream = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
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
