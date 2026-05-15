import { useEffect, useState, useCallback, useMemo, useRef, Fragment } from "react";
import { createPortal } from "react-dom";
import { supabase } from "./lib/supabase";

const API = "https://chat.jessaminee.top/api";
function spFetch(url, opts = {}) {
  const t = localStorage.getItem("memhome-auth-token") || "";
  const headers = { ...(opts.headers || {}) };
  if (t) headers.Authorization = "Bearer " + t;
  return fetch(url, { ...opts, headers });
}

// 9876 -> "9.9K"，跟 ChatPanel 右上角同一种缩写格式
function formatK(n) {
  if (!n || !isFinite(n)) return "0";
  if (n < 1000) return String(n);
  if (n < 10000) return (n / 1000).toFixed(1) + "K";
  return Math.round(n / 1000) + "K";
}

// 数据库存 UTC ISO，前端强制按 UTC+8 显示（不依赖浏览器时区）
function fmtSessionTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const utc8 = new Date(d.getTime() + 8 * 3600 * 1000);
  const mm = String(utc8.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utc8.getUTCDate()).padStart(2, "0");
  const hh = String(utc8.getUTCHours()).padStart(2, "0");
  const mi = String(utc8.getUTCMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

// 形状 = 来源：♥/♡ = forge 锻造，●/○ = 普通重启
// 填充 = 状态：实心 = active，空心 = ended
// 注：之前用 ㅇ (Korean ieung) 跟 ● 大小差太多，换成同 Unicode 几何系列的 ○ (U+25CB) 才协调
function sessionIcon(s) {
  const forge = !!s?.forged_from_session;
  const active = s?.status === "active";
  if (forge) return active ? "♥" : "♡";
  return active ? "●" : "○";
}

// 渲染 session 名字 —— 默认 span (点击进入编辑)，编辑态 input
function renderName(s, ctx) {
  if (!s) {
    return <span className="sp-name sp-name-empty">—</span>;
  }
  const { editingSid, nameDraft, setNameDraft, startEditName, commitName, cancelEditName } = ctx;
  if (editingSid === s.session_id) {
    return (
      <input
        autoFocus
        className="sp-name-input"
        value={nameDraft}
        placeholder="未命名"
        onChange={e => setNameDraft(e.target.value)}
        onBlur={commitName}
        onKeyDown={e => {
          if (e.key === "Enter") { e.preventDefault(); commitName(); }
          else if (e.key === "Escape") { e.preventDefault(); cancelEditName(); }
        }}
        onClick={e => e.stopPropagation()}
      />
    );
  }
  return (
    <span
      className={"sp-name" + (s.name ? "" : " sp-name-empty")}
      onClick={e => { e.stopPropagation(); startEditName(s); }}
      title="点击编辑名字"
    >
      {s.name || "未命名"}
    </span>
  );
}

const STYLES = `
.sp-root {
  position: fixed; inset: 0; z-index: 200;
  background: var(--bg-primary, #FAF6F0);
  display: flex; flex-direction: column;
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
  /* 跟随聊天界面字体（ChatPanel.jsx .cp-root） */
  font-family: 'Noto Serif SC', Georgia, serif;
  color: var(--text-primary, #2B2925);
  /* active 卡图标的粉：低饱和、保留亮度（HSL 344° 36% 74%）*/
  --sp-pink: #D9A0AE;
}
.sp-root[data-theme="dark"] {
  --sp-pink: #DDA8B5;
}
.sp-root[data-theme="dark"] {
  background: #1c1c1e;
  color: #f0ece6;
}
.sp-header {
  flex-shrink: 0;
  padding: 14px 16px;
  display: flex; align-items: center; justify-content: space-between;
  background: var(--bg-secondary, #fff);
  border-bottom: 1px solid var(--border-primary, #E0D8CE);
}
.sp-root[data-theme="dark"] .sp-header {
  background: #252527; border-bottom-color: #3a3a3c;
}
.sp-title {
  font-size: 13px; letter-spacing: 0.2em;
  color: var(--text-secondary, #6b6358);
  display: flex; align-items: center; gap: 8px;
}
.sp-close {
  background: none; border: none;
  color: var(--text-secondary, #6b6358);
  font-size: 22px; line-height: 1; cursor: pointer; padding: 4px 8px;
}
.sp-amnesia {
  background: none; border: 1px solid var(--border-primary, #E0D8CE);
  color: var(--text-secondary, #6b6358);
  font-size: 12px; padding: 4px 10px; border-radius: 4px;
  cursor: pointer; font-family: inherit;
  transition: color .15s, border-color .15s, background .15s;
  margin-left: auto; margin-right: 8px;
}
.sp-amnesia:hover {
  color: #c0392b; border-color: #c0392b;
  background: rgba(192, 57, 43, 0.06);
}
.sp-root[data-theme="dark"] .sp-amnesia {
  border-color: #3a3a3c;
}
.sp-root[data-theme="dark"] .sp-amnesia:hover {
  color: #ff8d80; border-color: #ff8d80;
  background: rgba(255, 141, 128, 0.08);
}
.sp-body {
  flex: 1; min-height: 0; overflow-y: auto;
  -webkit-overflow-scrolling: touch; overscroll-behavior: contain;
  padding: 14px 14px 24px;
}
.sp-loading, .sp-empty {
  text-align: center;
  color: var(--text-tertiary, #999);
  font-size: 13px;
  padding: 40px 0;
}

/* Session 卡片：直角、统一格式，活跃和已结束只是颜色/标记不同 */
.sp-card {
  border: 1px solid var(--border-primary, #E0D8CE);
  border-radius: 0;
  padding: 14px 16px;
  margin: 0 0 12px;
  background: var(--bg-secondary, #fff);
  transition: border-color 0.15s ease;
}
.sp-root[data-theme="dark"] .sp-card {
  background: #2a2a2c; border-color: #3a3a3c;
}
/* 不再给 active 卡上底色，仅靠图标的实心/粉色表达活跃状态 */
.sp-card-head {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  font-size: 13px;
}
.sp-card.ended .sp-card-head { cursor: pointer; user-select: none; }
/* 各 unicode 字形宽高不一致（♥ ♡ ● ㅇ），统一框住居中渲染 */
.sp-dot {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px;
  font-size: 14px; line-height: 1;
  flex-shrink: 0;
}
.sp-card.active .sp-dot { color: var(--sp-pink); }
.sp-card.ended .sp-dot { color: var(--text-tertiary, #999); }

/* 名字 + 创建时间堆叠在图标右边 */
.sp-name-block {
  flex: 1 1 auto; min-width: 0;
  display: flex; flex-direction: column; gap: 2px;
}
.sp-name {
  font-size: 14px; font-weight: 500;
  color: var(--text-primary, #2B2925);
  font-family: inherit;
  padding: 2px 6px; margin: -2px -6px;
  border-radius: 3px;
  cursor: text;
  word-break: break-all;
}
.sp-name:hover {
  background: var(--bg-sidebar-hover, rgba(0,0,0,0.04));
}
.sp-name-empty { color: var(--text-tertiary, #999); font-style: italic; font-weight: 400; }
.sp-name-input {
  font-size: 14px; font-weight: 500; font-family: inherit;
  color: var(--text-primary, #2B2925);
  background: transparent;
  border: none; border-bottom: 1px solid var(--sp-pink);
  outline: none; padding: 1px 2px; margin: 0;
  width: 100%; min-width: 0;
}
.sp-subtime {
  font-size: 11.5px; color: var(--text-tertiary, #999);
  font-family: inherit;
}
.sp-meta {
  color: var(--text-tertiary, #999);
  font-size: 12px;
}
.sp-status-active {
  color: var(--sp-pink);
  font-weight: 500;
}
/* 头部右侧：X turn / 删除 纵向叠（删除只在 ended 卡片显示） */
.sp-head-meta {
  margin-left: auto;
  display: flex; flex-direction: column;
  align-items: flex-end; gap: 4px;
  flex-shrink: 0;
  font-size: 12px;
}
.sp-head-turn { color: var(--text-tertiary, #999); }
.sp-toggle {
  margin-left: 4px;
  align-self: center;
  font-size: 13px;
  color: var(--text-tertiary, #999);
  display: inline-block;
  width: 14px; text-align: center;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  flex-shrink: 0;
}
.sp-card-head:hover .sp-toggle { color: var(--text-secondary, #6b6358); }

.sp-delete {
  background: none; border: none;
  color: var(--text-tertiary, #999);
  font-size: 11px; cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: color 0.15s ease, background 0.15s ease;
  font-family: inherit;
}
.sp-delete:hover {
  color: #d87878;
  background: rgba(216, 120, 120, 0.08);
}


/* 展开后的详情：第一行 时间范围 + turn 数；下一行 summary */
.sp-detail {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px dashed var(--border-primary, #E0D8CE);
}
.sp-detail-row {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 13px;
  margin-bottom: 10px;
}
.sp-detail-range { color: var(--text-primary, #2B2925); }
.sp-detail-turn { color: var(--text-tertiary, #999); font-size: 12px; }
.sp-detail-summary {
  padding: 11px 13px;
  background: var(--bg-bubble-bot, #fff);
  border: 1px solid var(--border-primary, #E0D8CE);
  border-radius: 0;
  font-size: 13px; line-height: 1.65;
  color: var(--text-primary, #2B2925);
  white-space: pre-wrap; word-break: break-word;
}
.sp-root[data-theme="dark"] .sp-detail-summary {
  background: #1c1c1e; border-color: #3a3a3c;
}
.sp-detail-empty {
  color: var(--text-tertiary, #999); font-style: italic;
}
.sp-fuxiang-btn {
  background: none; border: 1px solid var(--border-primary, #E0D8CE); border-radius: 4px;
  color: var(--text-secondary, #666); font-size: 11px; padding: 2px 8px; cursor: pointer;
  font-family: inherit; transition: color .15s, border-color .15s;
}
.sp-root[data-theme="dark"] .sp-fuxiang-btn { border-color: #3a3a3c; color: #aaa; }
.sp-preview { padding: 12px 0; max-height: 50vh; overflow-y: auto; }
.sp-preview-msg { padding: 6px 0; font-size: 12px; line-height: 1.6; }
.sp-preview-msg .sp-msg-label { font-weight: 600; font-size: 11px; margin-bottom: 2px; }
.sp-preview-msg .sp-msg-thinking {
  font-size: 11px; color: var(--text-tertiary, #999); margin-bottom: 4px;
  padding-left: 8px; border-left: 2px solid var(--border-primary, #E0D8CE);
  max-height: 100px; overflow-y: auto; white-space: pre-wrap; word-break: break-word;
}
.sp-root[data-theme="dark"] .sp-preview-msg .sp-msg-thinking { border-left-color: #3a3a3c; }
.sp-preview-msg .sp-msg-content { white-space: pre-wrap; word-break: break-word; }
.sp-preview-actions {
  display: flex; gap: 8px; padding: 8px 0; justify-content: center; align-items: center; flex-wrap: wrap;
  border-top: 1px dashed var(--border-primary, #E0D8CE);
}
.sp-token-cap {
  display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--text-secondary, #6b6358);
}
.sp-token-cap input {
  border: 1px solid var(--border-primary, #E0D8CE); border-radius: 4px;
  padding: 2px 4px; font-size: 11px; text-align: center; font-family: inherit;
  background: var(--bg-primary, #fff); color: inherit;
}
.sp-root[data-theme="dark"] .sp-token-cap input { border-color: #3a3a3c; background: #1e1e1e; }
.sp-root[data-theme="dark"] .sp-preview-actions { border-top-color: #3a3a3c; }
.sp-cutoff-info {
  text-align: center; font-size: 11px; color: #e67e22; padding: 8px 4px; font-weight: 500; line-height: 1.6;
}
.sp-cutoff-info b { font-size: 13px; }
.sp-cutoff-line {
  text-align: center; font-size: 10px; color: #e67e22; padding: 4px 0; font-weight: 600;
  border-top: 2px dashed #e67e22; border-bottom: 2px dashed #e67e22; margin: 6px 0;
  background: var(--bg-primary, #fff);
}
.sp-root[data-theme="dark"] .sp-cutoff-line { background: #1e1e1e; }
.sp-cutoff-ellipsis { text-align: center; font-size: 10px; color: var(--text-tertiary, #999); padding: 4px 0; }
.sp-conv-list { max-height: 400px; overflow-y: auto; }
.sp-conv-item {
  padding: 8px 10px; cursor: pointer; border-bottom: 1px solid var(--border-primary, #E0D8CE);
  transition: background 0.15s;
}
.sp-conv-item:hover, .sp-conv-item:active { background: var(--bg-hover, rgba(0,0,0,0.04)); }
.sp-conv-name { font-size: 13px; font-weight: 500; margin-bottom: 2px; }
.sp-conv-meta { font-size: 11px; color: var(--text-tertiary, #999); }
.sp-root[data-theme="dark"] .sp-conv-item { border-bottom-color: #3a3a3c; }
.sp-root[data-theme="dark"] .sp-conv-item:hover { background: rgba(255,255,255,0.06); }
.sp-msg-dimmed { opacity: 0.4; }
.sp-msg-idx { font-weight: 400; color: var(--text-tertiary, #999); margin-right: 4px; font-size: 10px; }
.sp-summary-box { width: 100%; }
.sp-summary-box label { display: block; font-size: 11px; color: #e67e22; margin-bottom: 4px; font-weight: 600; }
.sp-summary-box textarea {
  width: 100%; box-sizing: border-box; border: 1px solid #e67e22; border-radius: 6px;
  padding: 8px; font-size: 12px; font-family: inherit; resize: vertical;
  background: var(--bg-primary, #fff); color: inherit; line-height: 1.5;
}
.sp-root[data-theme="dark"] .sp-summary-box textarea { background: #1e1e1e; border-color: #e67e22; }
.sp-preview-status { text-align: center; font-size: 11px; color: var(--text-tertiary, #999); padding: 8px 0; }
.sp-import-btn {
  background: none; border: 1px solid var(--border-primary, #E0D8CE);
  color: var(--text-secondary, #6b6358);
  font-size: 12px; padding: 4px 10px; border-radius: 4px;
  cursor: pointer; font-family: inherit;
  transition: color .15s, border-color .15s, background .15s;
  margin-right: 8px;
}
.sp-import-btn:hover {
  color: #2980b9; border-color: #2980b9;
  background: rgba(41, 128, 185, 0.06);
}
.sp-root[data-theme="dark"] .sp-import-btn { border-color: #3a3a3c; }
.sp-root[data-theme="dark"] .sp-import-btn:hover {
  color: #7ec8e3; border-color: #7ec8e3;
  background: rgba(126, 200, 227, 0.08);
}
.sp-import-card {
  border: 1px solid #2980b9;
  border-radius: 0;
  padding: 14px 16px;
  margin: 0 0 12px;
  background: var(--bg-secondary, #fff);
}
.sp-root[data-theme="dark"] .sp-import-card {
  background: #2a2a2c; border-color: #7ec8e3;
}
.sp-import-header {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 13px; margin-bottom: 8px;
}
.sp-import-header span { color: #2980b9; font-weight: 500; }
.sp-root[data-theme="dark"] .sp-import-header span { color: #7ec8e3; }
.sp-import-close {
  background: none; border: none; cursor: pointer;
  color: var(--text-tertiary, #999); font-size: 16px; padding: 2px 6px;
}
`;

export default function SessionPanel({ onClose, theme = "light", currentTokens = 0, onAmnesia, convId }) {
  const [sessions, setSessions] = useState([]);
  const [expanded, setExpanded] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [editingSid, setEditingSid] = useState(null);
  const [nameDraft, setNameDraft] = useState("");
  const [previewSid, setPreviewSid] = useState(null);
  const [previewMsgs, setPreviewMsgs] = useState([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [injectState, setInjectState] = useState("idle"); // idle | loading | done
  const [injectResult, setInjectResult] = useState(null);

  // Claude.ai 导入
  const [importConvs, setImportConvs] = useState(null); // 原始对话列表（选择器用）
  const [importMsgs, setImportMsgs] = useState(null); // parsed messages array
  const [importName, setImportName] = useState("");
  const [importInjectState, setImportInjectState] = useState("idle");
  const [importInjectResult, setImportInjectResult] = useState(null);
  const [importTokenCap, setImportTokenCap] = useState(10);
  const [importSummary, setImportSummary] = useState("");
  const [importThinkingPct, setImportThinkingPct] = useState(100);
  const importFileRef = useRef(null);

  const fetchSessions = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("sessions_cheng")
        .select("session_id, name, started_at, ended_at, turn_count, tokens_total, status, summary, forged_from_session")
        .order("created_at", { ascending: false });
      if (!error && Array.isArray(data)) setSessions(data);
    } catch { /* 静默 */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchSessions();
    const t = setInterval(fetchSessions, 30000);
    return () => clearInterval(t);
  }, [fetchSessions]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const activeSession = useMemo(
    () => sessions.find(s => s.status === "active") || null,
    [sessions]
  );
  const endedSessions = useMemo(
    () => sessions.filter(s => s.status === "ended"),
    [sessions]
  );

  const toggle = useCallback((sid) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid);
      else next.add(sid);
      return next;
    });
  }, []);

  const deleteSession = useCallback(async (sid) => {
    if (!sid) return;
    if (!window.confirm("删除这条 session 记录？只删除数据库里的元数据，JSONL 文件不动。")) return;
    try {
      await supabase.from("sessions_cheng").delete().eq("session_id", sid);
      setSessions(prev => prev.filter(s => s.session_id !== sid));
    } catch (e) {
      alert("删除失败：" + (e?.message || e));
    }
  }, []);

  const startEditName = useCallback((s) => {
    setEditingSid(s.session_id);
    setNameDraft(s.name || "");
  }, []);

  const commitName = useCallback(async () => {
    const sid = editingSid;
    if (!sid) return;
    const next = nameDraft.trim() || null;
    setEditingSid(null);
    // 本地先乐观更新
    setSessions(prev => prev.map(s => s.session_id === sid ? { ...s, name: next } : s));
    try {
      await supabase.from("sessions_cheng").update({ name: next }).eq("session_id", sid);
    } catch (e) {
      console.warn("rename failed:", e?.message || e);
    }
  }, [editingSid, nameDraft]);

  const cancelEditName = useCallback(() => {
    setEditingSid(null);
    setNameDraft("");
  }, []);

  const openPreview = useCallback(async (sid) => {
    if (previewSid === sid) { setPreviewSid(null); return; }
    setPreviewSid(sid);
    setPreviewLoading(true);
    setPreviewMsgs([]);
    setInjectState("idle");
    setInjectResult(null);
    try {
      const r = await spFetch(`${API}/cc/session-messages/${sid}`);
      const d = await r.json();
      if (r.ok && d.messages) setPreviewMsgs(d.messages);
    } catch { /* silent */ }
    setPreviewLoading(false);
  }, [previewSid]);

  const estimateTokens = (s) => {
    let t = 0;
    for (let i = 0; i < s.length; i++) t += s.charCodeAt(i) > 0x7f ? 1.5 : 0.25;
    return Math.ceil(t);
  };

  const importCutoffIdx = useMemo(() => {
    if (!importMsgs) return 0;
    const cap = importTokenCap * 1000;
    const pct = importThinkingPct / 100;
    let acc = 0, thinkingSeen = 0;
    for (let i = importMsgs.length - 1; i >= 0; i--) {
      const m = importMsgs[i];
      let tokens = estimateTokens(m.content);
      if (m.thinking && pct > 0) {
        thinkingSeen++;
        if (Math.ceil(thinkingSeen * pct) > Math.ceil((thinkingSeen - 1) * pct)) {
          tokens += estimateTokens(m.thinking);
        }
      }
      acc += tokens;
      if (acc > cap) return i + 1;
    }
    return 0;
  }, [importMsgs, importTokenCap, importThinkingPct]);

  const parseConvMessages = useCallback((conv) => {
    const chatMessages = conv?.chat_messages || conv?.messages || [];
    const msgs = [];
    for (const m of chatMessages) {
      const role = (m.sender === "human" || m.role === "human" || m.role === "user") ? "user" : "assistant";
      let text = "", thinking = null;
      const blocks = Array.isArray(m.content) ? m.content : Array.isArray(m.contentBlocks) ? m.contentBlocks : null;
      if (blocks && blocks.length > 0) {
        text = blocks.filter(b => b.type === "text").map(b => b.text || b.content || "").join("\n").trim();
        const thinkBlocks = blocks.filter(b => b.type === "thinking").map(b => b.thinking || b.text || "").join("\n").trim();
        if (thinkBlocks) thinking = thinkBlocks;
      }
      if (!text && typeof m.text === "string" && m.text.trim()) {
        text = m.text.trim();
      } else if (!text && typeof m.content === "string" && m.content.trim()) {
        text = m.content.trim();
      }
      if (!thinking && typeof m.thinking === "string" && m.thinking.trim()) thinking = m.thinking.trim();
      if (text) msgs.push({ role, content: text, thinking });
    }
    return msgs;
  }, []);

  const selectImportConv = useCallback((conv) => {
    const msgs = parseConvMessages(conv);
    if (msgs.length === 0) { alert("该对话无有效消息"); return; }
    setImportConvs(null);
    setImportMsgs(msgs);
    setImportName(conv?.name || "未命名对话");
    setImportInjectState("idle");
    setImportInjectResult(null);
    setImportSummary("");
  }, [parseConvMessages]);

  const handleImportFile = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(reader.result);
        if (Array.isArray(json) && json.length > 1) {
          const convList = json.map(c => ({
            raw: c,
            name: c.name || "未命名",
            msgCount: (c.chat_messages || c.messages || []).length,
            updatedAt: c.updatedAt || c.updated_at || "",
          })).filter(c => c.msgCount > 0).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
          if (convList.length === 0) { alert("未找到有效对话"); return; }
          setImportConvs(convList);
          setImportMsgs(null);
        } else {
          const conv = Array.isArray(json) ? json[0] : json;
          selectImportConv(conv);
        }
      } catch (err) {
        alert("JSON 解析失败：" + err.message);
      }
    };
    reader.readAsText(file);
  }, [selectImportConv]);

  const doImportInject = useCallback(async (withThinking) => {
    if (!importMsgs || importMsgs.length === 0) return;
    setImportInjectState("loading");
    try {
      // 把原始 JSON 再传给后端解析（后端也做解析，保证一致性）
      // 但这里我们直接传 messages 数组作为 data.chat_messages
      const payload = {
        data: { chat_messages: importMsgs.map(m => ({ sender: m.role === "user" ? "human" : "assistant", content: m.thinking ? [{ type: "thinking", thinking: m.thinking }, { type: "text", text: m.content }] : [{ type: "text", text: m.content }] })) },
        withThinking,
        thinkingPct: importThinkingPct,
        tokenCap: importTokenCap * 1000,
        summary: importSummary.trim() || undefined,
        conversation_id: convId || null,
      };
      const r = await spFetch(`${API}/cc/inject-external`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "HTTP " + r.status);
      setImportInjectResult(d);
      setImportInjectState("done");
    } catch (e) {
      alert("浮想失败：" + e.message);
      setImportInjectState("idle");
    }
  }, [importMsgs, importSummary, importTokenCap, importThinkingPct, convId]);

  const doSessionInject = useCallback(async (sid, withThinking) => {
    setInjectState("loading");
    try {
      const r = await spFetch(`${API}/cc/inject-session`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sid, withThinking, conversation_id: convId || null }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "HTTP " + r.status);
      setInjectResult(d);
      setInjectState("done");
    } catch (e) {
      alert("浮想失败：" + e.message);
      setInjectState("idle");
    }
  }, [convId]);

  return createPortal(
    <div className="sp-root" data-theme={theme}>
      <style>{STYLES}</style>
      <div className="sp-header">
        <span className="sp-title">SESSIONS</span>
        <input
          ref={importFileRef}
          type="file"
          accept=".json"
          style={{ display: "none" }}
          onChange={handleImportFile}
        />
        <button
          className="sp-import-btn"
          onClick={() => importFileRef.current?.click()}
          title="上传 Claude.ai 导出的 JSON，浮想到当前 session"
        >浮想 Claude.ai</button>
        {onAmnesia && (
          <button
            className="sp-amnesia"
            onClick={onAmnesia}
            title="清掉 forge marker，启动干净的新 session（不保留上文）"
          >失忆</button>
        )}
        <button className="sp-close" onClick={onClose} aria-label="close">×</button>
      </div>

      <div className="sp-body">
        {loading && sessions.length === 0 && (
          <div className="sp-loading">加载中…</div>
        )}

        {/* Claude.ai 对话选择器 */}
        {importConvs && (
          <div className="sp-import-card">
            <div className="sp-import-header">
              <span>选择对话 · {importConvs.length} 个</span>
              <button className="sp-import-close" onClick={() => setImportConvs(null)}>×</button>
            </div>
            <div className="sp-conv-list">
              {importConvs.map((c, i) => (
                <div key={i} className="sp-conv-item" onClick={() => selectImportConv(c.raw)}>
                  <div className="sp-conv-name">{c.name}</div>
                  <div className="sp-conv-meta">{c.msgCount} 条 · {c.updatedAt ? new Date(c.updatedAt).toLocaleDateString("zh-CN") : ""}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Claude.ai 导入预览卡 */}
        {importMsgs && (
          <div className="sp-import-card">
            <div className="sp-import-header">
              <span>Claude.ai · {importName} · {importMsgs.length} 条消息{importMsgs.some(m => m.thinking) ? ` · ${importMsgs.filter(m => m.thinking).length} 条思绪` : ""}</span>
              <button className="sp-import-close" onClick={() => { setImportMsgs(null); setImportInjectState("idle"); setImportInjectResult(null); setImportSummary(""); }}>×</button>
            </div>
            <div className="sp-preview">
              {(() => {
                if (importCutoffIdx === 0) {
                  return (
                    <div className="sp-cutoff-info">
                      全部 {importMsgs.length} 条消息将完整注入 (~{importTokenCap}K)
                    </div>
                  );
                }
                const before = Math.max(0, importCutoffIdx - 3);
                const after = Math.min(importMsgs.length, importCutoffIdx + 5);
                const sliced = importMsgs.slice(before, after);
                return (<>
                  <div className="sp-cutoff-info">
                    共 {importMsgs.length} 条 · 截断在第 <b>#{importCutoffIdx}</b> 条 · 前 {importCutoffIdx} 条需摘要 · 后 {importMsgs.length - importCutoffIdx} 条完整注入 (~{importTokenCap}K)
                  </div>
                  {before > 0 && <div className="sp-cutoff-ellipsis">… 第 #1~#{before} 条省略 …</div>}
                  {sliced.map((m, si) => {
                    const i = before + si;
                    return (
                      <Fragment key={i}>
                        {i === importCutoffIdx && (
                          <div className="sp-cutoff-line">
                            <span>──── 截断线 · 以上需摘要 · 以下完整注入 ────</span>
                          </div>
                        )}
                        <div className={`sp-preview-msg${i < importCutoffIdx ? " sp-msg-dimmed" : ""}`}>
                          <div className="sp-msg-label" style={{ color: m.role === "user" ? "#c0392b" : "#2980b9" }}>
                            <span className="sp-msg-idx">#{i + 1}</span> {m.role === "user" ? "小茉莉" : "澄"}
                          </div>
                          <div className="sp-msg-content">{m.content.length > 200 ? m.content.slice(0, 200) + "…" : m.content}</div>
                        </div>
                      </Fragment>
                    );
                  })}
                  {after < importMsgs.length && <div className="sp-cutoff-ellipsis">… 第 #{after + 1}~#{importMsgs.length} 条省略 …</div>}
                </>);
              })()}
            </div>
            {importInjectState === "idle" && (
              <div className="sp-preview-actions">
                <div className="sp-token-cap">
                  <label>注入上限</label>
                  <input type="number" value={importTokenCap} min={1} max={200} step={1} onChange={e => setImportTokenCap(Math.max(1, parseInt(e.target.value) || 1))} style={{ width: 60 }} />
                  <span>k tokens</span>
                </div>
                {importMsgs.some(m => m.thinking) && (
                  <div className="sp-token-cap">
                    <label>思绪</label>
                    <input type="number" value={importThinkingPct} min={0} max={100} step={10} onChange={e => setImportThinkingPct(Math.max(0, Math.min(100, parseInt(e.target.value) || 0)))} style={{ width: 50 }} />
                    <span>%</span>
                  </div>
                )}
                {importCutoffIdx > 0 && (
                  <div className="sp-summary-box">
                    <label>摘要（截断线以上 #{1}~#{importCutoffIdx} 的内容摘要）</label>
                    <textarea
                      value={importSummary}
                      onChange={e => setImportSummary(e.target.value)}
                      placeholder="粘贴 Claude.ai 写的摘要…注入时会放在聊天记录前面"
                      rows={4}
                    />
                  </div>
                )}
                <button className="sp-fuxiang-btn" onClick={() => doImportInject(importThinkingPct > 0)}>
                  浮想{importThinkingPct > 0 ? `思绪${importThinkingPct < 100 ? importThinkingPct + "%" : ""}回忆` : "回忆"}
                </button>
              </div>
            )}
            {importInjectState === "loading" && <div className="sp-preview-status">小太阳浮想外部思绪…</div>}
            {importInjectState === "done" && importInjectResult?.injected && (
              <div className="sp-preview-status">
                已浮想 {importInjectResult.msgCount} 个回忆（~{formatK(importInjectResult.estTokens)} tokens）
                {importInjectResult.thinkingCount > 0 && ` ${importInjectResult.thinkingCount} 个思绪（~${formatK(importInjectResult.thinkingTokens)} tokens）`}
              </div>
            )}
          </div>
        )}

        {/* 当前 session 卡（可展开看完整 detail） */}
        {(() => {
          const sid = activeSession?.session_id;
          const isOpen = sid ? expanded.has(sid) : false;
          const isEditing = sid && editingSid === sid;
          return (
            <div className="sp-card active">
              <div
                className="sp-card-head"
                onClick={() => { if (sid && !isEditing) toggle(sid); }}
                style={{ cursor: sid ? "pointer" : "default" }}
              >
                <span className="sp-dot">{sessionIcon(activeSession)}</span>
                <div className="sp-name-block">
                  {renderName(activeSession, {
                    editingSid, nameDraft, setNameDraft,
                    startEditName, commitName, cancelEditName,
                  })}
                  <span className="sp-subtime">
                    {activeSession ? fmtSessionTime(activeSession.started_at) : "—"}
                    {" · "}<span className="sp-status-active">活跃</span>
                  </span>
                </div>
                {sid && (
                  <>
                    <div className="sp-head-meta">
                      <span className="sp-head-turn" title="累计 input tokens（含 cache）">
                        {formatK(currentTokens || 0)} tokens
                      </span>
                    </div>
                    <span className="sp-toggle">{isOpen ? "v" : ">"}</span>
                  </>
                )}
              </div>
              {sid && isOpen && (
                <div className="sp-detail">
                  <div className="sp-detail-row">
                    <span className="sp-detail-range">
                      {fmtSessionTime(activeSession.started_at)} - 当前
                    </span>
                    <span className="sp-detail-turn">
                      {formatK(currentTokens || 0)} tokens · {activeSession.turn_count || 0} turn
                      {" · "}<span className="sp-status-active">活跃</span>
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* 历史 sessions */}
        {endedSessions.map(s => {
          const isOpen = expanded.has(s.session_id);
          const isEditing = editingSid === s.session_id;
          return (
            <div key={s.session_id} className="sp-card ended">
              <div
                className="sp-card-head"
                onClick={() => { if (!isEditing) toggle(s.session_id); }}
              >
                <span className="sp-dot">{sessionIcon(s)}</span>
                <div className="sp-name-block">
                  {renderName(s, {
                    editingSid, nameDraft, setNameDraft,
                    startEditName, commitName, cancelEditName,
                  })}
                  <span className="sp-subtime">
                    {fmtSessionTime(s.started_at)}
                  </span>
                </div>
                <div className="sp-head-meta">
                  <span className="sp-head-turn" title="结束时累计 input tokens">
                    {s.tokens_total != null ? `${formatK(s.tokens_total)} tokens` : `${s.turn_count || 0} turn`}
                  </span>
                  <button
                    className="sp-fuxiang-btn"
                    onClick={(e) => { e.stopPropagation(); openPreview(s.session_id); }}
                    title="查看并注入这段对话"
                  >浮想</button>
                  <button
                    className="sp-delete"
                    onClick={(e) => { e.stopPropagation(); deleteSession(s.session_id); }}
                    title="删除这条 session"
                  >删除</button>
                </div>
                <span className="sp-toggle">{isOpen ? "v" : ">"}</span>
              </div>
              {isOpen && (
                <div className="sp-detail">
                  <div className="sp-detail-row">
                    <span className="sp-detail-range">
                      {fmtSessionTime(s.started_at)} - {fmtSessionTime(s.ended_at)}
                    </span>
                    <span className="sp-detail-turn">
                      {s.tokens_total != null ? `${formatK(s.tokens_total)} tokens · ` : ""}
                      {s.turn_count || 0} turn
                    </span>
                  </div>
                  <div className="sp-detail-summary">
                    {s.summary || <span className="sp-detail-empty">无总结</span>}
                  </div>
                </div>
              )}
              {previewSid === s.session_id && (
                <div className="sp-preview">
                  {previewLoading && <div className="sp-preview-status">加载中…</div>}
                  {!previewLoading && previewMsgs.length === 0 && <div className="sp-preview-status">JSONL 为空或不存在</div>}
                  {!previewLoading && previewMsgs.map((m, i) => (
                    <div key={i} className="sp-preview-msg">
                      <div className="sp-msg-label" style={{ color: m.role === "user" ? "#c0392b" : "#2980b9" }}>
                        {m.role === "user" ? "小茉莉" : "澄"}
                      </div>
                      {m.thinking && (
                        <div className="sp-msg-thinking">{m.thinking.length > 500 ? m.thinking.slice(0, 500) + "…" : m.thinking}</div>
                      )}
                      <div className="sp-msg-content">{m.content.length > 300 ? m.content.slice(0, 300) + "…" : m.content}</div>
                    </div>
                  ))}
                  {!previewLoading && previewMsgs.length > 0 && injectState === "idle" && (
                    <div className="sp-preview-actions">
                      <button className="sp-fuxiang-btn" onClick={() => doSessionInject(s.session_id, true)}>
                        浮想思绪回忆
                      </button>
                      <button className="sp-fuxiang-btn" onClick={() => doSessionInject(s.session_id, false)}>
                        浮想回忆
                      </button>
                    </div>
                  )}
                  {injectState === "loading" && <div className="sp-preview-status">小太阳浮想思绪…</div>}
                  {injectState === "done" && injectResult?.injected && (
                    <div className="sp-preview-status">
                      已浮想 {injectResult.msgCount} 个回忆（~{formatK(injectResult.estTokens)} tokens）
                      {injectResult.thinkingCount > 0 && ` ${injectResult.thinkingCount} 个思绪（~${formatK(injectResult.thinkingTokens)} tokens）`}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {!loading && endedSessions.length === 0 && (
          <div className="sp-empty">还没有结束的 session</div>
        )}
      </div>
    </div>,
    document.body
  );
}
