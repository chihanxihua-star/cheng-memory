# ...import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "./lib/supabase";

/* ===== CONFIG ===== */
const WS_URL = import.meta.env.VITE_WS_URL || "ws://216.36.116.146:3001";
const API_URL = import.meta.env.VITE_API_URL || "http://216.36.116.146:3001";
const PROJECT_ID = "b5e5d83a-0c17-4421-a0e2-217519ed62fb";

/* ===== MARKDOWN ===== */
const esc = t => t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

function md(text) {
  if (!text) return "";
  // split code blocks out first
  const parts = [];
  let rest = text;
  const re = /```(\w*)\n?([\s\S]*?)```/g;
  let m, last = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ t: "txt", c: text.slice(last, m.index) });
    parts.push({ t: "code", lang: m[1], c: m[2].replace(/\n$/, "") });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ t: "txt", c: text.slice(last) });

  return parts.map(p => {
    if (p.t === "code") {
      return `<pre class="cp-pre"><code>${esc(p.c)}</code></pre>`;
    }
    let h = esc(p.c);
    // bold before italic
    h = h.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    h = h.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
    // inline code
    h = h.replace(/`([^`\n]+)`/g, '<code class="cp-ic">$1</code>');
    // links
    h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="cp-a">$1</a>');
    // headers
    h = h.replace(/^### (.+)$/gm, '<div class="cp-h3">$1</div>');
    h = h.replace(/^## (.+)$/gm, '<div class="cp-h2">$1</div>');
    h = h.replace(/^# (.+)$/gm, '<div class="cp-h1">$1</div>');
    // list items
    h = h.replace(/^[-*] (.+)$/gm, '<div class="cp-li">$1</div>');
    h = h.replace(/^\d+\. (.+)$/gm, '<div class="cp-li cp-oli">$1</div>');
    // line breaks
    h = h.replace(/\n/g, "<br>");
    return h;
  }).join("");
}

/* ===== ICONS ===== */
const SendIcon = ({ c = "#999" }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);
const StopIcon = ({ c = "#c75" }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);
const PlusIcon = ({ c = "#999" }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const ListIcon = ({ c = "#999" }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round">
    <line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="14" y2="17" />
  </svg>
);
const ChevronIcon = ({ open, c = "#aaa" }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
    style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s ease" }}>
    <polyline points="9 6 15 12 9 18" />
  </svg>
);

/* ===== STYLES (injected once) ===== */
const CSS = `
.cp-pre{background:rgba(0,0,0,0.04);padding:10px 12px;border-radius:6px;overflow-x:auto;font-family:'SF Mono',SFMono-Regular,Menlo,monospace;font-size:11.5px;line-height:1.55;margin:6px 0;white-space:pre-wrap;word-break:break-all}
.cp-ic{background:rgba(0,0,0,0.04);padding:1px 4px;border-radius:3px;font-family:'SF Mono',SFMono-Regular,Menlo,monospace;font-size:0.88em}
.cp-a{color:#7b8fb2;text-decoration:underline}
.cp-h1{font-size:15px;font-weight:600;margin:14px 0 6px}
.cp-h2{font-size:14px;font-weight:600;margin:12px 0 5px}
.cp-h3{font-size:13.5px;font-weight:600;margin:10px 0 4px}
.cp-li{padding-left:14px;position:relative;margin:2px 0}
.cp-li::before{content:"·";position:absolute;left:2px;color:#aaa}
.cp-oli::before{content:"";display:none}
.cp-msg-md{font-size:13.5px;line-height:1.75;word-break:break-word}
.cp-msg-md p{margin:0}
.cp-msg-md strong{font-weight:600}
.cp-thinking{font-size:12px;color:#999;line-height:1.6;white-space:pre-wrap;word-break:break-word;max-height:200px;overflow-y:auto}
.cp-tool{font-size:11.5px;line-height:1.5;font-family:'SF Mono',SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-all;color:#888}
@keyframes cp-blink{0%,100%{opacity:0.2}50%{opacity:1}}
.cp-cursor{display:inline-block;width:2px;height:14px;background:#999;margin-left:1px;vertical-align:text-bottom;animation:cp-blink 0.8s ease infinite}
@keyframes cp-pulse{0%,100%{opacity:0.4}50%{opacity:1}}
.cp-dot{width:5px;height:5px;border-radius:50%;animation:cp-pulse 1.2s ease infinite}
.cp-input{width:100%;border:none;background:none;outline:none;font-size:14px;font-family:inherit;color:#333;resize:none;line-height:1.5;max-height:120px}
.cp-input::placeholder{color:#ccc}
`;

/* ===== COMPONENT ===== */
export default function ChatPanel({ th }) {
  /* --- state --- */
  const [convId, setConvId] = useState(null);
  const [convList, setConvList] = useState([]);
  const [convTitle, setConvTitle] = useState("新对话");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [ccStatus, setCcStatus] = useState("unknown");
  const [showList, setShowList] = useState(false);
  const [toast, setToast] = useState(null);

  // streaming accumulator
  const stream = useRef({ thinking: "", delta: "", tools: [], clean: null, usage: null });
  const [streamSnap, setStreamSnap] = useState(null); // snapshot for render
  const [pendingUser, setPendingUser] = useState(null); // user msg waiting for response

  const wsRef = useRef(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const reconnectTimer = useRef(null);

  /* --- colors --- */
  const ac = th?.ac || "#8b9eb0";
  const dk = th?.dk || false;
  const bg = th?.bg || "#F8F5F0";

  /* --- toast helper --- */
  const showToast = useCallback((msg, ms = 3000) => {
    setToast(msg);
    setTimeout(() => setToast(null), ms);
  }, []);

  /* --- WebSocket --- */
  const connectWS = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    try {
      const ws = new WebSocket(WS_URL);
      ws.onopen = () => {
        console.log("[ws] connected");
        clearTimeout(reconnectTimer.current);
      };
      ws.onclose = () => {
        console.log("[ws] closed, reconnecting in 3s…");
        reconnectTimer.current = setTimeout(connectWS, 3000);
      };
      ws.onerror = () => {};
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          handleWsMsg(msg);
        } catch {}
      };
      wsRef.current = ws;
    } catch {}
  }, []); // eslint-disable-line

  const handleWsMsg = useCallback((msg) => {
    switch (msg.type) {
      case "cc_status":
        setCcStatus(msg.status || "ready");
        break;
      case "start":
        stream.current = { thinking: "", delta: "", tools: [], clean: null, usage: null };
        setIsStreaming(true);
        setStreamSnap({ thinking: "", delta: "", tools: [] });
        break;
      case "thinking":
        stream.current.thinking += (msg.text || "");
        setStreamSnap(s => s ? { ...s, thinking: stream.current.thinking } : s);
        break;
      case "delta":
        stream.current.delta += (msg.text || "");
        setStreamSnap(s => s ? { ...s, delta: stream.current.delta } : s);
        break;
      case "tool_use":
        stream.current.tools.push({ id: msg.id, name: msg.name, input: msg.input });
        setStreamSnap(s => s ? { ...s, tools: [...stream.current.tools] } : s);
        break;
      case "tool_result": {
        const idx = stream.current.tools.findIndex(t => t.id === msg.tool_use_id);
        if (idx >= 0) {
          stream.current.tools[idx].result = msg.content;
          stream.current.tools[idx].isError = msg.is_error;
          setStreamSnap(s => s ? { ...s, tools: [...stream.current.tools] } : s);
        }
        break;
      }
      case "clean":
        stream.current.clean = msg.text;
        stream.current.delta = msg.text || stream.current.delta;
        setStreamSnap(s => s ? { ...s, delta: stream.current.delta } : s);
        break;
      case "done": {
        const final = {
          role: "assistant",
          content: stream.current.clean || stream.current.delta,
          thinking: stream.current.thinking || null,
          tool_calls: stream.current.tools.length ? stream.current.tools : null,
          usage: msg.usage || null,
        };
        setMessages(prev => [...prev, final]);
        setStreamSnap(null);
        setPendingUser(null);
        setIsStreaming(false);
        break;
      }
      case "stopped":
        setIsStreaming(false);
        setStreamSnap(null);
        break;
      case "error":
        showToast(msg.message || "发生错误");
        setIsStreaming(false);
        setStreamSnap(null);
        break;
      case "char_count":
        if (msg.total > msg.threshold * 0.8) {
          showToast(`对话较长 (${Math.round(msg.total/1000)}k)，考虑开新窗口`, 5000);
        }
        break;
      case "toast":
        showToast(msg.message, 4000);
        break;
      default:
        break;
    }
  }, [showToast]);

  /* --- health check --- */
  const checkHealth = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/api/health`);
      const d = await r.json();
      setCcStatus(d.cc_ready ? "ready" : "down");
    } catch {
      setCcStatus("down");
    }
  }, []);

  /* --- conversations --- */
  const loadConvList = useCallback(async () => {
    const { data } = await supabase
      .from("conversations")
      .select("id, title, updated_at")
      .eq("project_id", PROJECT_ID)
      .order("updated_at", { ascending: false })
      .limit(30);
    setConvList(data || []);
  }, []);

  const createConv = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/api/conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "新对话", project_id: PROJECT_ID }),
      });
      const d = await r.json();
      const newId = d.id || d.conversation_id;
      if (!newId) { showToast("创建会话失败"); return; }
      setConvId(newId);
      setConvTitle("新对话");
      setMessages([]);
      setPendingUser(null);
      setStreamSnap(null);
      loadConvList();
      return newId;
    } catch {
      showToast("创建会话失败");
      return null;
    }
  }, [loadConvList, showToast]);

  const loadMessages = useCallback(async (cid) => {
    if (!cid) return;
    try {
      const r = await fetch(`${API_URL}/api/conversations/${cid}/messages`);
      const d = await r.json();
      const arr = Array.isArray(d) ? d : d.messages || [];
      setMessages(arr.map(m => ({
        role: m.role,
        content: m.content,
        thinking: m.thinking || null,
        tool_calls: m.tool_calls || null,
        usage: m.usage || m.tokens || null,
      })));
    } catch {
      setMessages([]);
    }
  }, []);

  const selectConv = useCallback((c) => {
    setConvId(c.id);
    setConvTitle(c.title || "对话");
    setShowList(false);
    loadMessages(c.id);
  }, [loadMessages]);

  /* --- init --- */
  useEffect(() => {
    connectWS();
    checkHealth();
    loadConvList();
    const hTimer = setInterval(checkHealth, 30000);
    return () => {
      clearInterval(hTimer);
      clearTimeout(reconnectTimer.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connectWS, checkHealth, loadConvList]);

  /* --- send --- */
  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    let cid = convId;
    if (!cid) {
      cid = await createConv();
      if (!cid) return;
    }

    // optimistic user message
    const userMsg = { role: "user", content: text };
    setMessages(prev => [...prev, userMsg]);
    setPendingUser(text);
    setInput("");

    // auto-resize input back
    if (inputRef.current) inputRef.current.style.height = "auto";

    // send via WS
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "chat", content: text, conversation_id: cid }));
    } else {
      showToast("连接断开，正在重连…");
      connectWS();
    }
  }, [input, isStreaming, convId, createConv, connectWS, showToast]);

  const handleStop = useCallback(() => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "stop" }));
    }
  }, []);

  /* --- auto scroll --- */
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamSnap]);

  /* --- input auto resize --- */
  const handleInputChange = (e) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  /* --- status color --- */
  const statusColor = ccStatus === "ready" ? "#7ab392" : ccStatus === "down" ? "#c75" : "#ccc";
  const statusLabel = ccStatus === "ready" ? "在线" : ccStatus === "down" ? "离线" : "…";

  /* ===== RENDER ===== */
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
      <style>{CSS}</style>

      {/* --- Header --- */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "0 14px", height: 40, flexShrink: 0,
        borderBottom: "1px solid rgba(0,0,0,0.04)",
      }}>
        <button onClick={() => { setShowList(!showList); if (!showList) loadConvList(); }}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex" }}>
          <ListIcon c={dk ? "#ddd" : "#888"} />
        </button>
        <span style={{
          flex: 1, fontSize: 13, color: dk ? "#eee" : "#555",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {convTitle}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: statusColor }}>
          <div style={{ width: 5, height: 5, borderRadius: "50%", background: statusColor }} />
          {statusLabel}
        </div>
        <button onClick={createConv}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex" }}>
          <PlusIcon c={dk ? "#ddd" : "#888"} />
        </button>
      </div>

      {/* --- Conversation List Overlay --- */}
      {showList && <>
        <div onClick={() => setShowList(false)}
          style={{ position: "absolute", inset: 0, zIndex: 20, background: "rgba(0,0,0,0.1)" }} />
        <div style={{
          position: "absolute", top: 40, left: 0, right: 0, zIndex: 21,
          background: dk ? "#333" : "#fff",
          borderBottom: `1px solid ${dk ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}`,
          maxHeight: 280, overflowY: "auto",
          boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
        }}>
          {convList.length === 0 && (
            <div style={{ padding: 16, textAlign: "center", color: "#ccc", fontSize: 12 }}>暂无对话</div>
          )}
          {convList.map(c => (
            <div key={c.id} onClick={() => selectConv(c)}
              style={{
                padding: "10px 14px", cursor: "pointer",
                borderBottom: `1px solid ${dk ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)"}`,
                background: c.id === convId ? (dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.02)") : "transparent",
              }}>
              <div style={{
                fontSize: 13, color: dk ? "#eee" : "#444",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{c.title || "新对话"}</div>
              <div style={{ fontSize: 10, color: "#aaa", marginTop: 2 }}>
                {c.updated_at ? new Date(c.updated_at).toLocaleDateString("zh-CN") : ""}
              </div>
            </div>
          ))}
        </div>
      </>}

      {/* --- Messages --- */}
      <div ref={scrollRef} style={{
        flex: 1, overflowY: "auto", padding: "12px 14px 8px",
        display: "flex", flexDirection: "column", gap: 14,
      }}>
        {/* empty state */}
        {messages.length === 0 && !streamSnap && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ textAlign: "center", color: "#ccc", fontSize: 13 }}>
              <div style={{ fontSize: 22, marginBottom: 6, opacity: 0.4 }}>澄</div>
              说点什么吧
            </div>
          </div>
        )}

        {/* rendered messages */}
        {messages.map((m, i) => (
          <MessageBubble key={i} msg={m} dk={dk} ac={ac} />
        ))}

        {/* streaming message */}
        {streamSnap && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {/* thinking */}
            {streamSnap.thinking && (
              <ThinkingBlock text={streamSnap.thinking} dk={dk} streaming />
            )}
            {/* tool calls */}
            {streamSnap.tools.length > 0 && (
              <ToolCallsBlock calls={streamSnap.tools} dk={dk} />
            )}
            {/* delta */}
            {streamSnap.delta ? (
              <div style={{
                maxWidth: "88%",
                padding: "8px 12px",
                borderRadius: "12px 12px 12px 4px",
                background: dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.03)",
              }}>
                <div className="cp-msg-md" style={{ color: dk ? "#eee" : "#333" }}
                  dangerouslySetInnerHTML={{ __html: md(streamSnap.delta) }} />
                <span className="cp-cursor" />
              </div>
            ) : (
              !streamSnap.thinking && streamSnap.tools.length === 0 && (
                <div style={{ display: "flex", gap: 4, padding: "8px 0" }}>
                  <div className="cp-dot" style={{ background: ac }} />
                  <div className="cp-dot" style={{ background: ac, animationDelay: "0.2s" }} />
                  <div className="cp-dot" style={{ background: ac, animationDelay: "0.4s" }} />
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* --- Token usage (last message) --- */}
      {messages.length > 0 && messages[messages.length - 1]?.usage && !isStreaming && (
        <div style={{
          textAlign: "center", fontSize: 10, color: "#ccc", padding: "0 0 4px",
        }}>
          {messages[messages.length - 1].usage.input_tokens?.toLocaleString() || "?"} → {messages[messages.length - 1].usage.output_tokens?.toLocaleString() || "?"} tokens
        </div>
      )}

      {/* --- Input Bar --- */}
      <div style={{
        padding: "8px 12px 10px", flexShrink: 0,
        borderTop: `1px solid ${dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)"}`,
      }}>
        <div style={{
          display: "flex", alignItems: "flex-end", gap: 8,
          background: dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.025)",
          borderRadius: 10,
          padding: "8px 10px",
          border: `1px solid ${dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)"}`,
        }}>
          <textarea
            ref={inputRef}
            className="cp-input"
            style={{ color: dk ? "#eee" : "#333" }}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="给澄发消息…"
            rows={1}
          />
          {isStreaming ? (
            <button onClick={handleStop}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 4, flexShrink: 0, display: "flex" }}>
              <StopIcon />
            </button>
          ) : (
            <button onClick={handleSend}
              disabled={!input.trim()}
              style={{
                background: "none", border: "none", cursor: input.trim() ? "pointer" : "default",
                padding: 4, flexShrink: 0, display: "flex", opacity: input.trim() ? 1 : 0.3,
              }}>
              <SendIcon c={ac} />
            </button>
          )}
        </div>
      </div>

      {/* --- Toast --- */}
      {toast && (
        <div style={{
          position: "absolute", top: 50, left: "50%", transform: "translateX(-50%)",
          background: "rgba(0,0,0,0.7)", color: "#fff", fontSize: 12,
          padding: "6px 14px", borderRadius: 6, zIndex: 50,
          animation: "fi 0.2s ease",
          pointerEvents: "none", whiteSpace: "nowrap",
        }}>{toast}</div>
      )}
    </div>
  );
}

/* ===== SUB-COMPONENTS ===== */

function MessageBubble({ msg, dk, ac }) {
  const isUser = msg.role === "user";

  if (isUser) {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <div style={{
          maxWidth: "82%",
          padding: "8px 12px",
          borderRadius: "12px 12px 4px 12px",
          background: dk ? "rgba(248,245,240,0.12)" : "#E6D2D5",
          fontSize: 13.5, lineHeight: 1.7,
          color: dk ? "#F8F5F0" : "#333",
          whiteSpace: "pre-wrap", wordBreak: "break-word",
        }}>{msg.content}</div>
      </div>
    );
  }

  // assistant
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {msg.thinking && <ThinkingBlock text={msg.thinking} dk={dk} />}
      {msg.tool_calls?.length > 0 && <ToolCallsBlock calls={msg.tool_calls} dk={dk} />}
      {msg.content && (
        <div style={{
          maxWidth: "88%",
          padding: "8px 12px",
          borderRadius: "12px 12px 12px 4px",
          background: dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.03)",
        }}>
          <div className="cp-msg-md" style={{ color: dk ? "#eee" : "#333" }}
            dangerouslySetInnerHTML={{ __html: md(msg.content) }} />
        </div>
      )}
      {msg.usage && (
        <div style={{ fontSize: 10, color: "#ccc", paddingLeft: 4 }}>
          {msg.usage.input_tokens?.toLocaleString() || "?"} → {msg.usage.output_tokens?.toLocaleString() || "?"} tokens
        </div>
      )}
    </div>
  );
}

function ThinkingBlock({ text, dk, streaming }) {
  const [open, setOpen] = useState(false);
  const display = streaming ? true : open;

  return (
    <div style={{ maxWidth: "88%" }}>
      <button onClick={() => !streaming && setOpen(!open)}
        style={{
          display: "flex", alignItems: "center", gap: 4,
          background: "none", border: "none", cursor: streaming ? "default" : "pointer",
          padding: "2px 0", fontSize: 11, color: "#aaa",
        }}>
        <ChevronIcon open={display} c="#bbb" />
        <span>{streaming ? "思考中…" : "思考过程"}</span>
      </button>
      {display && (
        <div style={{
          marginTop: 4, padding: "6px 10px",
          background: dk ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
          borderRadius: 6,
          borderLeft: `2px solid ${dk ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}`,
        }}>
          <div className="cp-thinking">{text}</div>
          {streaming && <span className="cp-cursor" />}
        </div>
      )}
    </div>
  );
}

function ToolCallsBlock({ calls, dk }) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ maxWidth: "88%" }}>
      <button onClick={() => setOpen(!open)}
        style={{
          display: "flex", alignItems: "center", gap: 4,
          background: "none", border: "none", cursor: "pointer",
          padding: "2px 0", fontSize: 11, color: "#aaa",
        }}>
        <ChevronIcon open={open} c="#bbb" />
        <span>工具调用 ({calls.length})</span>
      </button>
      {open && (
        <div style={{
          marginTop: 4, padding: "6px 10px",
          background: dk ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
          borderRadius: 6,
          borderLeft: `2px solid ${dk ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}`,
          display: "flex", flexDirection: "column", gap: 8,
          maxHeight: 240, overflowY: "auto",
        }}>
          {calls.map((c, i) => (
            <div key={c.id || i}>
              <div style={{ fontSize: 11, fontWeight: 500, color: dk ? "#bbb" : "#666", marginBottom: 2 }}>
                {c.name}
                {c.result !== undefined && (
                  <span style={{ marginLeft: 6, fontSize: 10, color: c.isError ? "#c75" : "#7ab392" }}>
                    {c.isError ? "失败" : "完成"}
                  </span>
                )}
              </div>
              <div className="cp-tool">
                {typeof c.input === "string" ? c.input : JSON.stringify(c.input, null, 2)}
              </div>
              {c.result !== undefined && (
                <div className="cp-tool" style={{ marginTop: 3, color: c.isError ? "#c75" : "#999" }}>
                  → {typeof c.result === "string"
                    ? (c.result.length > 300 ? c.result.slice(0, 300) + "…" : c.result)
                    : JSON.stringify(c.result, null, 2)?.slice(0, 300)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}...
