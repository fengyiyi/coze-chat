// ============================================================
// ESA 边缘函数：Coze 流式代理（Serverless）
//
// 部署方式：在阿里云 ESA「函数和 Pages」中导入本 GitHub 仓库，
// 将「函数文件路径」指向本文件（./src/index.ts），并把函数路由
// 绑定到 /api/chat（或 /api/*）。运行时读取环境变量：
//   COZE_TOKEN     —— Coze 令牌（在 ESA 函数环境变量中配置，勿入库）
//   ALLOWED_HOST   —— 允许访问的域名白名单，如 ai.alfedu.com
//
// ESA 边缘函数遵循 Web 标准（Request / Response / fetch），
// 入口与 Cloudflare Workers 类似：export default { fetch }
// ============================================================

const COZE_ENDPOINT = "https://h68g4m5246.coze.site/stream_run";
const COZE_PROJECT_ID = 7662259982867660806;
const DEFAULT_SESSION_ID = "3Zvk1mhLLkTwQ9E70tUAn";

// 兼容 ESA 的 env 对象与 Node 的 process.env（防御性）
function getEnv(name, env) {
  if (env && env[name]) return env[name];
  if (typeof process !== "undefined" && process.env && process.env[name]) {
    return process.env[name];
  }
  return "";
}

// ESA 单条环境变量 Value 上限 200 字符，Coze Bearer 令牌（约 739 字符）需分片存储：
//   COZE_TOKEN_1 / COZE_TOKEN_2 / ... / COZE_TOKEN_9（按顺序拼接还原）
// 也兼容单行完整令牌 COZE_TOKEN（本地无此限制）。
function getCozeToken(env) {
  const parts = [];
  for (let i = 1; i <= 9; i++) {
    const v = getEnv("COZE_TOKEN_" + i, env);
    if (v) parts.push(v);
    else break;
  }
  if (parts.length) return parts.join("");
  return getEnv("COZE_TOKEN", env);
}

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

async function handleChat(request, env) {
  const token = getCozeToken(env);
  const allowed = getEnv("ALLOWED_HOST", env);
  const endpoint = getEnv("COZE_API_URL", env) || COZE_ENDPOINT;

  // 1) 域名白名单
  if (!isAllowedHost(request, allowed)) {
    return new Response("Forbidden: domain not allowed", { status: 403 });
  }

  // 2) 令牌必须存在（服务端，前端永不接触）
  if (!token) {
    // 调试信息：输出 env 对象状态，排查环境变量注入问题（上线前请删除此段）
    const envKeys = env ? Object.keys(env).join(", ") : "(env is null/undefined)";
    const envType = typeof env;
    const token1 = getEnv("COZE_TOKEN_1", env);
    const token2 = getEnv("COZE_TOKEN_2", env);
    const tokenFull = getEnv("COZE_TOKEN", env);
    const debugInfo = {
      envType,
      envKeys,
      token1_len: token1 ? token1.length : 0,
      token2_len: token2 ? token2.length : 0,
      tokenFull_len: tokenFull ? tokenFull.length : 0,
      hint: "如果在「基本信息→构建信息→环境变量」中配置的，那是不对的——那里只给 npm run build 用。需要找到函数运行时环境变量的入口。",
    };
    return new Response(
      "Server misconfiguration: COZE_TOKEN missing\n\nDebug: " +
        JSON.stringify(debugInfo, null, 2),
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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/chat") {
      // 预检请求
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
      return handleChat(request, env);
    }

    return new Response("Not Found", { status: 404 });
  },
};
