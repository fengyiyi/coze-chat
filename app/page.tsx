"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// ============ 可配置项 ============
const BOT_NAME = "爱立方爱国主义教育启蒙智能体";
const BOT_DESC = "学爱国启蒙，玩主题玩具，趣味知识科普，互动游戏陪伴幼儿成长。";
const DEFAULT_SESSION_ID = "3Zvk1mhLLkTwQ9E70tUAn";
// ===================================

type Msg = {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
};

// 每轮对话生成独立 session，避免多人串台
function getSessionId(): string {
  if (typeof window === "undefined") return DEFAULT_SESSION_ID;
  let id = sessionStorage.getItem("coze_session_id");
  if (!id) {
    id = "sess_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem("coze_session_id", id);
  }
  return id;
}

// 从 Coze SSE 的 data JSON 中提取文本片段
// Coze stream_run 实测返回结构：{ type:"answer", content:{ answer:"...文本..." , thinking, tool_request, ... }, finish:false }
function extractText(obj: any): string {
  if (!obj || typeof obj !== "object") return "";
  if (typeof obj.content === "string") return obj.content;
  // ⭐ Coze 实测结构：obj.content.answer 是增量文本片段
  if (obj.content && typeof obj.content.answer === "string") return obj.content.answer;
  if (obj.data && typeof obj.data.content === "string") return obj.data.content;
  if (obj.data && typeof obj.data.answer === "string") return obj.data.answer;
  if (typeof obj.answer === "string") return obj.answer;
  if (obj.choices && obj.choices[0]?.delta?.content)
    return obj.choices[0].delta.content;
  return "";
}

// 判断某事件是否为「结束」信号
function isFinish(obj: any, event: string): boolean {
  if (event === "done" || event === "conversation.message.completed" || event === "message_end")
    return true;
  if (!obj || typeof obj !== "object") return false;
  return (
    obj.finish === true ||
    obj.node_is_finish === true ||
    obj.is_finish === true ||
    obj.node_is_finish === "true"
  );
}

export default function Page() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<string>("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    sessionRef.current = getSessionId();
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setError("");
    const userMsg: Msg = { role: "user", content: text };
    const assistantMsg: Msg = { role: "assistant", content: "", streaming: true };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    autoGrow();
    setLoading(true);

    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, session_id: sessionRef.current }),
      });

      if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        throw new Error(t || `请求失败 (${resp.status})`);
      }

      // 非 SSE（如 Coze 返回 JSON 错误）直接读全文
      const ct = resp.headers.get("content-type") || "";
      if (!ct.includes("text/event-stream")) {
        const txt = await resp.text();
        let msg = "智能体返回了非预期内容";
        try {
          const j = JSON.parse(txt);
          msg = j?.msg || j?.message || j?.error || txt;
        } catch {
          msg = txt || msg;
        }
        throw new Error(msg);
      }

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let lastEvent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let newText = "";
        for (const line of lines) {
          const ln = line.trim();
          if (!ln) continue;
          if (ln.startsWith("event:")) {
            lastEvent = ln.slice(6).trim();
            continue;
          }
          if (!ln.startsWith("data:")) continue;
          const data = ln.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const obj = JSON.parse(data);
            // 处理代理层错误事件
            if (obj.type === "error") {
              throw new Error(obj.message || "上游服务错误");
            }
            // 跳过 ping/done 等控制事件
            if (obj.type === "thinking" || obj.type === "done") continue;
            if (isFinish(obj, lastEvent)) continue;
            const t = extractText(obj);
            if (t) newText += t;
          } catch (e: any) {
            // JSON 解析失败时如果是代理层的 error，抛出
            if (e?.message) throw e;
            // 容错：忽略无法解析的行
          }
        }

        if (newText) {
          setMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last && last.role === "assistant") {
              copy[copy.length - 1] = {
                ...last,
                content: last.content + newText,
              };
            }
            return copy;
          });
        }
      }
    } catch (e: any) {
      setError(e?.message || "出错了，请稍后再试");
    } finally {
      setLoading(false);
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last && last.role === "assistant") {
          copy[copy.length - 1] = { ...last, streaming: false };
        }
        return copy;
      });
    }
  }

  function reset() {
    sessionStorage.removeItem("coze_session_id");
    sessionRef.current = getSessionId();
    setMessages([]);
    setError("");
    taRef.current?.focus();
  }

  function autoGrow() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
  }

  const lastAssistant = messages[messages.length - 1];
  const showTyping =
    loading && lastAssistant?.role === "assistant" && !lastAssistant.content;

  return (
    <div className="app">
      <div className="card">
        <div className="header">
          <div className="avatar">🐘</div>
          <div>
            <div className="title">{BOT_NAME}</div>
            <div className="subtitle">{BOT_DESC}</div>
          </div>
          <div className="spacer" />
          <button className="new-chat" onClick={reset}>
            新对话
          </button>
        </div>

        <div className="messages" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="empty">
              <div className="big">💬</div>
              <div className="t1">开始和智能体对话</div>
              <div className="t2">
                在下方输入你的问题，智能体会以流式方式逐字回复。
                <br />
                本服务仅允许在授权域名下访问。
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              <div className="ava">{m.role === "user" ? "🙂" : "🤖"}</div>
              <div className="bubble">
                {m.role === "assistant" ? (
                  m.content ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {m.content}
                    </ReactMarkdown>
                  ) : m.streaming ? (
                    <span className="typing">
                      <span />
                      <span />
                      <span />
                    </span>
                  ) : null
                ) : (
                  m.content
                )}
              </div>
            </div>
          ))}

          {showTyping && (
            <div className="msg assistant">
              <div className="ava">🤖</div>
              <div className="bubble">
                <span className="typing">
                  <span />
                  <span />
                  <span />
                </span>
              </div>
            </div>
          )}
        </div>

        {error && <div className="error-bar">⚠️ {error}</div>}

        <div className="composer">
          <textarea
            ref={taRef}
            value={input}
            rows={1}
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            onChange={(e) => {
              setInput(e.target.value);
              autoGrow();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button
            className="send-btn"
            onClick={send}
            disabled={loading || !input.trim()}
            aria-label="发送"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M3.4 20.4L21 12 3.4 3.6 3.4 10.2 15 12 3.4 13.8z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
