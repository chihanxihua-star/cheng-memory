import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { supabase } from "./lib/supabase";

// ── Helpers ──────────────────────────────────────────────
function esc(s) {
  if (!s) return "";
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function escRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getSender(m) {
  return m.sender || m.role || "unknown";
}

function getMsgText(m) {
  if (m.content && Array.isArray(m.content) && m.content.length > 0) {
    const text = m.content.filter(b => b.type === "text").map(b => b.text || b.content || "").join("\n");
    if (text.trim()) return text;
  }
  return m.text || (typeof m.content === "string" ? m.content : "") || "";
}

function getThinking(m) {
  if (!m.content || !Array.isArray(m.content)) return null;
  const blocks = m.content.filter(b => b.type === "thinking");
  if (!blocks.length) return null;
  return blocks.map(b => b.thinking || b.text || "").join("\n\n");
}

function getToolUse(m) {
  if (!m.content || !Array.isArray(m.content)) return [];
  return m.content.filter(b => b.type === "tool_use");
}

function getAttachments(m) {
  const a = [];
  if (m.attachments) a.push(...m.attachments);
  if (m.files) a.push(...m.files);
  if (m.content && Array.isArray(m.content))
    m.content.filter(b => b.type === "image").forEach(() => a.push({ name: "Image", type: "image" }));
  return a;
}

function shortModel(m) {
  if (!m) return "";
  if (m.includes("opus")) return "Opus";
  if (m.includes("sonnet")) return "Sonnet";
  if (m.includes("haiku")) return "Haiku";
  return m.split("-").slice(0, 2).join("-");
}

function _utc8(d) { return new Date(d.getTime() + 8 * 3600000); }
function fmtDate(d) {
  if (!d) return "";
  const u = _utc8(new Date(d));
  const n = _utc8(new Date());
  const z = v => String(v).padStart(2, "0");
  if (u.getUTCFullYear() === n.getUTCFullYear() && u.getUTCMonth() === n.getUTCMonth() && u.getUTCDate() === n.getUTCDate())
    return z(u.getUTCHours()) + ":" + z(u.getUTCMinutes());
  return (u.getUTCMonth() + 1) + "月" + u.getUTCDate() + "日";
}

function fmtDateTime(d) {
  if (!d) return "";
  const u = _utc8(new Date(d));
  const z = v => String(v).padStart(2, "0");
  return u.getUTCFullYear() + "/" + z(u.getUTCMonth() + 1) + "/" + z(u.getUTCDate()) + " " + z(u.getUTCHours()) + ":" + z(u.getUTCMinutes());
}

function estimateTokens(s) {
  if (!s) return 0;
  let t = 0;
  for (let i = 0; i < s.length; i++) t += s.charCodeAt(i) > 0x7f ? 1.5 : 0.25;
  return Math.ceil(t);
}

function countConvTokens(messages) {
  let total = 0;
  for (const m of messages) {
    total += estimateTokens(getMsgText(m));
    const th = getThinking(m);
    if (th) total += estimateTokens(th);
  }
  return total;
}

function countConvChars(messages) {
  let text = 0, thinking = 0;
  for (const m of messages) {
    const t = getMsgText(m);
    for (let i = 0; i < t.length; i++) {
      if (t.charCodeAt(i) > 0x2e7f) text++;
    }
    const th = getThinking(m);
    if (th) {
      for (let i = 0; i < th.length; i++) {
        if (th.charCodeAt(i) > 0x2e7f) thinking++;
      }
    }
  }
  return { text, thinking };
}

function fmtNum(n) {
  if (n >= 10000) return (n / 10000).toFixed(1) + "万";
  return n.toLocaleString("zh-CN");
}

function fmtTokens(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

function sanitizeFn(s) {
  return (s || "conversation").replace(/[<>:"/\\|?*]/g, "_").slice(0, 80);
}

function downloadFile(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Branch resolution ────────────────────────────────────
function getActiveBranch(conv, msgs) {
  if (!msgs.length) return new Set();
  const hasUuid = msgs.some(m => m.uuid);
  if (!hasUuid) return new Set(msgs.map((_, i) => i));
  const hasParentLinks = msgs.some(m => m.parent_message_uuid);
  if (!hasParentLinks) return new Set(msgs.map(m => m.uuid));
  const msgMap = {};
  const childrenMap = {};
  msgs.forEach(m => {
    if (m.uuid) msgMap[m.uuid] = m;
    const p = m.parent_message_uuid || "__root__";
    if (!childrenMap[p]) childrenMap[p] = [];
    childrenMap[p].push(m);
  });
  let leaf = conv.current_leaf_message_uuid;
  if (!leaf || !msgMap[leaf]) {
    const realLeaves = msgs.filter(m => m.uuid && (!childrenMap[m.uuid] || !childrenMap[m.uuid].length));
    const candidates = realLeaves.length ? realLeaves : msgs;
    candidates.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    leaf = candidates[0]?.uuid;
  }
  if (!leaf) return new Set(msgs.map(m => m.uuid));
  const active = new Set();
  let cur = leaf;
  while (cur && msgMap[cur]) { active.add(cur); cur = msgMap[cur].parent_message_uuid; }
  if (active.size <= 1 && msgs.length > 1) return new Set(msgs.map(m => m.uuid));
  return active;
}

function processConversations(data) {
  return data
    .filter(c => (c.chat_messages || c.messages || []).length > 0)
    .map(c => {
      const msgs = c.chat_messages || c.messages || [];
      const activeIds = getActiveBranch(c, msgs);
      const hasUuid = msgs.length > 0 && !!msgs[0].uuid;
      let active = hasUuid
        ? msgs.filter(m => activeIds.has(m.uuid))
        : msgs.filter((_, i) => activeIds.has(i));
      active.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      if (active.length === 0) {
        active = [...msgs].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      }
      const first = active.find(m => getSender(m) === "human");
      return {
        uuid: c.uuid || crypto.randomUUID(),
        name: c.name || (first ? getMsgText(first).slice(0, 50) : "无标题对话") || "无标题对话",
        model: c.model || "",
        created_at: c.created_at,
        updated_at: c.updated_at,
        messages: active,
        branchedCount: msgs.length - active.length,
        is_starred: c.is_starred,
      };
    })
    .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
}

// ── Markdown ─────────────────────────────────────────────
function renderMarkdown(text) {
  if (!text) return "";
  const codeBlocks = [];
  text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const id = codeBlocks.length;
    const langLabel = lang ? `<span style="position:absolute;top:6px;right:10px;font-size:11px;opacity:.5;text-transform:uppercase">${esc(lang)}</span>` : "";
    codeBlocks.push(`<pre style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:14px;margin:10px 0;overflow-x:auto;position:relative;font-size:13px;line-height:1.5">${langLabel}<code>${esc(code.trimEnd())}</code></pre>`);
    return `\x00CB${id}\x00`;
  });
  const inlineCodes = [];
  text = text.replace(/`([^`\n]+)`/g, (_, code) => {
    const id = inlineCodes.length;
    inlineCodes.push(`<code style="background:var(--bg-card);padding:2px 6px;border-radius:4px;font-size:.9em">${esc(code)}</code>`);
    return `\x00IC${id}\x00`;
  });

  const lines = text.split("\n");
  const result = [];
  let inList = false, listType = "";

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const cbMatch = line.match(/^\x00CB(\d+)\x00$/);
    if (cbMatch) { if (inList) { result.push(`</${listType}>`); inList = false; } result.push(codeBlocks[parseInt(cbMatch[1])]); continue; }

    const h3 = line.match(/^### (.+)/);
    if (h3) { if (inList) { result.push(`</${listType}>`); inList = false; } result.push(`<h3 style="margin:16px 0 8px;font-size:1.05em;font-weight:600">${inlineFmt(h3[1], inlineCodes)}</h3>`); continue; }
    const h2 = line.match(/^## (.+)/);
    if (h2) { if (inList) { result.push(`</${listType}>`); inList = false; } result.push(`<h2 style="margin:16px 0 8px;font-size:1.15em;font-weight:600">${inlineFmt(h2[1], inlineCodes)}</h2>`); continue; }
    const h1 = line.match(/^# (.+)/);
    if (h1) { if (inList) { result.push(`</${listType}>`); inList = false; } result.push(`<h1 style="margin:16px 0 8px;font-size:1.3em;font-weight:600">${inlineFmt(h1[1], inlineCodes)}</h1>`); continue; }

    const ul = line.match(/^[-*] (.+)/);
    if (ul) {
      if (!inList || listType !== "ul") { if (inList) result.push(`</${listType}>`); result.push("<ul style='margin:6px 0;padding-left:24px'>"); inList = true; listType = "ul"; }
      result.push(`<li style="margin:3px 0">${inlineFmt(ul[1], inlineCodes)}</li>`); continue;
    }
    const ol = line.match(/^\d+\. (.+)/);
    if (ol) {
      if (!inList || listType !== "ol") { if (inList) result.push(`</${listType}>`); result.push("<ol style='margin:6px 0;padding-left:24px'>"); inList = true; listType = "ol"; }
      result.push(`<li style="margin:3px 0">${inlineFmt(ol[1], inlineCodes)}</li>`); continue;
    }
    if (inList) { result.push(`</${listType}>`); inList = false; }

    const bq = line.match(/^> (.+)/);
    if (bq) { result.push(`<blockquote style="border-left:3px solid var(--accent);padding:4px 12px;margin:8px 0;opacity:.8;border-radius:0 6px 6px 0">${inlineFmt(bq[1], inlineCodes)}</blockquote>`); continue; }

    if (line.match(/^\|.*\|$/)) {
      const tableLines = [line];
      while (i + 1 < lines.length && lines[i + 1].match(/^\|.*\|$/)) tableLines.push(lines[++i]);
      result.push(renderTable(tableLines, inlineCodes));
      continue;
    }
    if (line.trim() === "") { result.push("<br>"); continue; }
    result.push(`<p style="margin:6px 0">${inlineFmt(line, inlineCodes)}</p>`);
  }
  if (inList) result.push(`</${listType}>`);
  return result.join("\n").replace(/(<br>\s*){3,}/g, "<br><br>");
}

function inlineFmt(text, inlineCodes) {
  text = esc(text);
  text = text.replace(/\x00IC(\d+)\x00/g, (_, id) => inlineCodes[parseInt(id)]);
  text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/(?<!\w)\*(.+?)\*(?!\w)/g, "<em>$1</em>");
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:none">$1</a>');
  return text;
}

function renderTable(lines, inlineCodes) {
  if (lines.length < 2) return lines.map(l => `<p>${inlineFmt(l, inlineCodes)}</p>`).join("");
  const parseRow = line => line.split("|").slice(1, -1).map(c => c.trim());
  const headers = parseRow(lines[0]);
  const startIdx = lines[1].match(/^[\|\s\-:]+$/) ? 2 : 1;
  let html = '<table style="border-collapse:collapse;margin:10px 0;width:100%;font-size:14px"><thead><tr>';
  headers.forEach(h => html += `<th style="border:1px solid var(--border);padding:6px 12px;text-align:left;background:var(--bg-card);font-weight:600">${inlineFmt(h, inlineCodes)}</th>`);
  html += "</tr></thead><tbody>";
  for (let i = startIdx; i < lines.length; i++) {
    const cells = parseRow(lines[i]);
    html += "<tr>"; cells.forEach(c => html += `<td style="border:1px solid var(--border);padding:6px 12px">${inlineFmt(c, inlineCodes)}</td>`); html += "</tr>";
  }
  return html + "</tbody></table>";
}

function highlightSearch(html, query) {
  if (!query) return html;
  const parts = html.split(/(<[^>]+>)/);
  return parts.map(part => {
    if (part.startsWith("<")) return part;
    return part.replace(new RegExp(`(${escRegex(query)})`, "gi"), '<span style="background:#fde68a;padding:1px 2px;border-radius:2px">$1</span>');
  }).join("");
}

// ── Collapsible block ────────────────────────────────────
function Collapsible({ label, badge, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: 10 }}>
      <button onClick={() => setOpen(o => !o)} style={{
        display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
        padding: "8px 12px", borderRadius: 8, background: "var(--bg-card)", border: "1px solid var(--border)",
        fontSize: 13, color: "var(--text-secondary)", width: "100%", textAlign: "left", fontFamily: "inherit",
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          style={{ transition: "transform .2s", transform: open ? "rotate(90deg)" : "rotate(0deg)", flexShrink: 0 }}>
          <path d="M9 18l6-6-6-6" />
        </svg>
        <span style={{ flex: 1 }}>{label}</span>
        {badge && <span style={{ fontSize: 11, opacity: .7 }}>{badge}</span>}
      </button>
      {open && (
        <div style={{
          marginTop: 6, padding: "12px 14px", borderRadius: 8,
          background: "var(--bg-card)", border: "1px solid var(--border)",
          fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7,
          maxHeight: 400, overflowY: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word",
        }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ── Message component ────────────────────────────────────
function fmtMsgTime(d) {
  if (!d) return "";
  const u = _utc8(new Date(d));
  const z = n => String(n).padStart(2, "0");
  return u.getUTCFullYear() + "/" + z(u.getUTCMonth() + 1) + "/" + z(u.getUTCDate()) + " " + z(u.getUTCHours()) + ":" + z(u.getUTCMinutes());
}

function ThinkingBlock({ text }) {
  const [open, setOpen] = useState(false);
  const badge = text.length > 1000 ? `${Math.round(text.length / 1000)}k 字符` : `${text.length} 字符`;
  return (
    <div style={{ marginBottom: 7 }}>
      <button onClick={() => setOpen(o => !o)} style={{
        fontSize: 11, color: "var(--text-tertiary)", cursor: "pointer",
        padding: "2px 4px 2px 0", background: "transparent", border: "none",
        display: "inline-flex", alignItems: "center", gap: 4, userSelect: "none", fontFamily: "inherit",
      }}>
        <span style={{ display: "inline-block", fontSize: 13, lineHeight: 1, transition: "transform 0.18s ease", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}>›</span>
        思绪
        <span style={{ fontSize: 10, opacity: 0.6 }}>{badge}</span>
      </button>
      {open && (
        <div style={{
          borderLeft: "2px solid var(--border)", padding: "7px 11px",
          fontSize: 12, color: "var(--text-tertiary)", whiteSpace: "pre-wrap",
          lineHeight: 1.45, marginTop: 4, maxHeight: 200, overflowY: "auto", wordBreak: "break-word",
        }}>{text}</div>
      )}
    </div>
  );
}

function Message({ m, searchQuery, id, idx, showSender = true, showTime = false, onFav, onStartSel, selMode, selected, onToggleSel, faved }) {
  const sender = getSender(m);
  const isHuman = sender === "human";
  const time = fmtMsgTime(m.created_at);
  const thinking = getThinking(m);
  const tools = getToolUse(m);
  const atts = getAttachments(m);
  let text = getMsgText(m);

  let rendered = "";
  if (isHuman) {
    rendered = text ? esc(text) : "";
    if (searchQuery) rendered = highlightSearch(rendered, searchQuery);
  } else {
    rendered = text ? renderMarkdown(text) : "";
    if (searchQuery) rendered = highlightSearch(rendered, searchQuery);
  }

  const thinkingOnly = thinking && !text && !tools.length && !atts.length;
  const isCont = !showSender;
  const bubbleRadius = isHuman
    ? "12px 12px 4px 12px"
    : (isCont ? "4px 12px 12px 4px" : "12px 12px 12px 4px");

  if (thinkingOnly) {
    return (
      <div id={id} style={{ maxWidth: "92%", marginBottom: 6 }}>
        {showSender && (
          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 3 }}>
            {isHuman ? "小茉莉" : "小太阳"} <span style={{ opacity: 0.6 }}>#{idx + 1}</span>
          </div>
        )}
        <ThinkingBlock text={thinking} />
      </div>
    );
  }

  return (
    <div id={id} style={{
      display: "flex", maxWidth: "92%", marginBottom: isCont ? 6 : 8,
      ...(isHuman ? { marginLeft: "auto", flexDirection: "row-reverse" } : {}),
      ...(isCont && !isHuman ? { marginLeft: 0 } : {}),
    }}>
      <div style={{ display: "flex", flexDirection: "column", ...(isHuman ? { alignItems: "flex-end" } : {}) }}>
        {showSender && (
          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 3, ...(isHuman ? { textAlign: "right" } : {}) }}>
            {isHuman ? "小茉莉" : "小太阳"} <span style={{ opacity: 0.6 }}>#{idx + 1}</span>
          </div>
        )}
        <div className={isHuman ? "bd-bubble me" : "bd-bubble them"}
          onClick={selMode ? () => onToggleSel?.(m.uuid) : undefined}
          style={{
            borderRadius: bubbleRadius, maxWidth: "none",
            ...(isHuman ? { whiteSpace: "pre-wrap" } : {}),
            ...(selMode ? { cursor: "pointer" } : {}),
            ...(selected ? { outline: "2px solid var(--text-primary)", outlineOffset: 1 } : {}),
          }}>
          {selMode && <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 16, height: 16, marginRight: 6, borderRadius: "50%", border: "1.5px solid var(--text-primary)", color: "var(--text-primary)", fontSize: 11 }}>{selected ? "✓" : ""}</span>}
          {thinking && <ThinkingBlock text={thinking} />}
          {tools.map((t, i) => {
            const name = t.name || "tool";
            const display = name === "create_artifact" ? `Artifact: ${t.input?.title || t.input?.type || "unknown"}` : name;
            let content = "";
            if (t.input) {
              if (typeof t.input === "string") content = t.input;
              else if (t.input.content) content = t.input.content;
              else content = JSON.stringify(t.input, null, 2);
            }
            return (
              <Collapsible key={i} label={display}>
                <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{content}</pre>
              </Collapsible>
            );
          })}
          {atts.map((a, i) => (
            <div key={i} style={{
              display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px",
              background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, margin: "4px 0",
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" />
              </svg>
              {a.file_name || a.name || a.fileName || "attachment"}
            </div>
          ))}
          {rendered && <div dangerouslySetInnerHTML={{ __html: rendered }} />}
        </div>
        {!selMode && text && text.trim() && (
          <div style={{ marginTop: 3, display: "flex", gap: 8, ...(isHuman ? { justifyContent: "flex-end" } : {}) }}>
            <button onClick={() => onFav?.({ sender, content: text, original_created_at: m.created_at || null, uuid: m.uuid })}
              title={faved ? "已收藏" : "收藏到低语"}
              style={{ background: "none", border: "none", cursor: "pointer", color: faved ? "var(--text-primary)" : "var(--text-tertiary)", padding: "2px 4px", display: "inline-flex", alignItems: "center" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill={faved ? "var(--text-primary)" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            </button>
            <button onClick={() => onStartSel?.(m.uuid)} title="选段收藏为故事"
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)", padding: "2px 4px", display: "inline-flex", alignItems: "center" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
            </button>
          </div>
        )}
        {showTime && time && <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2, opacity: 0.6, ...(isHuman ? { textAlign: "right" } : {}) }}>{time}</div>}
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────
const CV_API = "https://chat.jessaminee.top/api";
const CV_PROJECT_ID = "b5e5d83a-0c17-4421-a0e2-217519ed62fb";
function cvFetch(url, opts = {}) {
  const t = localStorage.getItem("memhome-auth-token") || "";
  const headers = { ...(opts.headers || {}) };
  if (t) headers.Authorization = "Bearer " + t;
  return fetch(url, { ...opts, headers });
}

// 思考面板/参考图那种分段按钮：可用=深底浅字、禁用=描边透明；直角无圆角
const segBtn = (on) => on
  ? { background: "#2b2b2b", border: "1px solid #2b2b2b", color: "#f5f2ec", cursor: "pointer", fontSize: 12, letterSpacing: "0.16em", padding: "8px 16px", borderRadius: 8, fontFamily: "inherit", whiteSpace: "nowrap" }
  : { background: "transparent", border: "1px solid var(--border)", color: "var(--text-tertiary)", cursor: "default", fontSize: 12, letterSpacing: "0.16em", padding: "8px 16px", borderRadius: 8, fontFamily: "inherit", whiteSpace: "nowrap" };

// 低语：拾光里的选合集面板（自包含；source_message_id 存 null，因拾光消息无真实行 id）
function CVCollectionPicker({ pending, convUuid, toast, onClose, onDone }) {
  const [cols, setCols] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const n = pending.items.length;
  const convId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(convUuid || "") ? convUuid : null;

  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data, error } = await supabase.from("favorite_collections_cheng")
        .select("id,name").order("created_at", { ascending: false });
      if (cancel) return;
      if (error) toast("加载合集失败：" + error.message); else setCols(data || []);
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [toast]);

  const saveInto = async (collectionId) => {
    if (saving) return; setSaving(true);
    const rows = pending.items.map(it => ({
      collection_id: collectionId, sender: it.sender, content: it.content,
      source_conversation_id: convId, source_message_id: null,
      original_created_at: it.original_created_at || null,
    }));
    const { error } = await supabase.from("favorites_cheng").insert(rows);
    setSaving(false);
    if (error) { toast("收藏失败：" + error.message); return; }
    toast(n > 1 ? `已收藏故事（${n} 段）` : "已收藏到低语"); onDone();
  };
  const createAndSave = async () => {
    const nm = newName.trim(); if (!nm || saving) return; setSaving(true);
    const { data, error } = await supabase.from("favorite_collections_cheng")
      .insert({ name: nm }).select("id").single();
    if (error || !data) { setSaving(false); toast("建合集失败：" + (error?.message || "")); return; }
    setSaving(false); saveInto(data.id);
  };

  const inputStyle = { flex: 1, background: "transparent", border: "none", borderBottom: "1px solid var(--border)", padding: "7px 0", color: "var(--text-primary)", fontSize: 13, outline: "none", fontFamily: "inherit" };
  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 430, maxHeight: "80vh", overflowY: "auto", background: "var(--bg-page)", border: "1px solid var(--border)", borderRadius: 0, padding: "20px 22px 30px", color: "var(--text-primary)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, fontSize: 15 }}>
          <span>{n > 1 ? `收藏故事 · ${n} 段` : "收藏到低语"}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          <input type="text" placeholder="新建合集…" value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") createAndSave(); }} style={inputStyle} />
          <button disabled={!newName.trim() || saving} onClick={createAndSave} style={segBtn(!!newName.trim() && !saving)}>建并存</button>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>选个合集</div>
        {loading ? <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>加载中…</div>
          : cols.length === 0 ? <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>还没有合集，上面新建一个吧</div>
          : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {cols.map(c => <button key={c.id} disabled={saving} onClick={() => saveInto(c.id)}
                style={{ textAlign: "left", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px", color: "var(--text-primary)", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>{c.name}</button>)}
            </div>}
      </div>
    </div>
  );
}

export default function ChatViewer({ onBack }) {
  const [conversations, setConversations] = useState([]);
  const [currentConv, setCurrentConv] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showExport, setShowExport] = useState(false);
  const [mobileShowList, setMobileShowList] = useState(true);
  const [scrollToMsg, setScrollToMsg] = useState(null);
  const [searchNav, setSearchNav] = useState(null);
  const fileRef = useRef(null);
  const msgRef = useRef(null);

  // ── VPS sessions ──
  const [vpsSessions, setVpsSessions] = useState([]);
  const [vpsLoading, setVpsLoading] = useState(true);
  const [vpsError, setVpsError] = useState(null);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [favorites, setFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem("cv_favorites") || "[]"); } catch { return []; }
  });
  const [renames, setRenames] = useState(() => {
    try { return JSON.parse(localStorage.getItem("cv_renames") || "{}"); } catch { return {}; }
  });
  const [favOrder, setFavOrder] = useState(() => {
    try { return JSON.parse(localStorage.getItem("cv_fav_order") || "[]"); } catch { return []; }
  });
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [contextMenu, setContextMenu] = useState(null);
  const [sidebarTab, setSidebarTab] = useState("vps");
  const [sortMode, setSortMode] = useState("time");
  const [vpsMatchCounts, setVpsMatchCounts] = useState({});
  const longPressRef = useRef(null);
  const searchTimerRef = useRef(null);

  // ── 低语收藏（把消息文字快照存进 supabase favorites_cheng；跟上面 localStorage 星标整段对话是两回事）──
  const [diyuPending, setDiyuPending] = useState(null); // { items:[{sender,content,original_created_at}], isStory }
  const [selMode, setSelMode] = useState(false);        // 故事多选模式
  const selAnchorRef = useRef(null);                    // 首尾框选起点 m.uuid，用 ref 读避免闭包旧值
  const [selIds, setSelIds] = useState(() => new Set());// 选中的 m.uuid
  const [favedUuids, setFavedUuids] = useState(() => new Set()); // 本会话内已收藏的 m.uuid → 心填实心
  const [toast, setToast] = useState(null);
  const cvToast = useCallback((msg) => { setToast(msg); setTimeout(() => setToast(null), 2200); }, []);

  const openDiyu = useCallback((payload) => setDiyuPending({ items: [payload], isStory: false }), []);
  const enterSel = useCallback(() => { selAnchorRef.current = null; setSelMode(true); setSelIds(new Set()); }, []);
  const exitSel = useCallback(() => { selAnchorRef.current = null; setSelMode(false); setSelIds(new Set()); }, []);
  const toggleSel = useCallback((uuid) => {
    const anchor = selAnchorRef.current;
    if (anchor == null) { selAnchorRef.current = uuid; setSelIds(new Set([uuid])); return; }
    setSelIds(prev => {
      const next = new Set(prev);
      if (next.has(uuid) && uuid !== anchor) { next.delete(uuid); return next; }
      const order = (currentConv?.messages || []).map(m => m.uuid);
      const ai = order.indexOf(anchor);
      const bi = order.indexOf(uuid);
      if (ai === -1 || bi === -1) { next.add(uuid); return next; }
      const [lo, hi] = ai < bi ? [ai, bi] : [bi, ai];
      for (let k = lo; k <= hi; k++) next.add(order[k]);
      return next;
    });
  }, [currentConv]);
  const diyuFromSel = useCallback(() => {
    const items = (currentConv?.messages || [])
      .filter(m => selIds.has(m.uuid))
      .map(m => ({ sender: getSender(m), content: getMsgText(m) || "", original_created_at: m.created_at || null, uuid: m.uuid }))
      .filter(x => x.content.trim());
    if (!items.length) { cvToast("没选到可收藏的内容"); return; }
    setDiyuPending({ items, isStory: items.length > 1 });
  }, [currentConv, selIds, cvToast]);

  const saveFavorites = (v) => { setFavorites(v); localStorage.setItem("cv_favorites", JSON.stringify(v)); };
  const saveRenames = (v) => { setRenames(v); localStorage.setItem("cv_renames", JSON.stringify(v)); };
  const saveFavOrder = (v) => { setFavOrder(v); localStorage.setItem("cv_fav_order", JSON.stringify(v)); };

  // VPS 搜索匹配计数（debounce）
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q || q.length < 2) { setVpsMatchCounts({}); return; }
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      supabase.from("messages")
        .select("conversation_id")
        .ilike("content", "%" + q + "%")
        .then(({ data }) => {
          const counts = {};
          for (const r of (data || [])) counts[r.conversation_id] = (counts[r.conversation_id] || 0) + 1;
          setVpsMatchCounts(counts);
        });
    }, 600);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [searchQuery]);

  // 加载 VPS session 列表
  useEffect(() => {
    setVpsLoading(true);
    supabase.from("conversations")
      .select("id, title, created_at, updated_at")
      .or("project_id.eq." + CV_PROJECT_ID + ",project_id.is.null")
      .order("updated_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) { setVpsError(error.message); }
        else {
          const sessions = (data || []).map(c => ({
            id: c.id,
            mtime: c.updated_at ? new Date(c.updated_at).getTime() : (c.created_at ? new Date(c.created_at).getTime() : 0),
            created_at: c.created_at,
            updated_at: c.updated_at,
            preview: c.title || "未命名对话",
          }));
          setVpsSessions(sessions);
          setVpsError(null);
        }
        setVpsLoading(false);
      });
  }, []);

  // 选中 VPS session 时加载消息
  const selectVpsSession = useCallback((sid) => {
    setActiveSessionId(sid);
    setSessionLoading(true);
    setMobileShowList(false);
    supabase.from("messages")
      .select("role, content, thinking, created_at")
      .eq("conversation_id", sid)
      .in("role", ["user", "assistant"])
      .order("created_at", { ascending: true })
      .then(({ data: rows }) => {
        if (rows) {
          const data = { messages: rows };
          const msgs = [];
          let idx = 0;
          for (const m of data.messages) {
            const sender = m.role === "user" ? "human" : "assistant";
            if (m.thinking) {
              msgs.push({ uuid: `${sid}-${idx++}`, sender, created_at: m.created_at || null, content: [{ type: "thinking", thinking: m.thinking }] });
            }
            if (sender === "assistant" && m.content && m.content.includes("---bubble---")) {
              const bubbles = m.content.split(/---bubble---/).map(s => s.replace(/\n{3,}/g, "\n\n").trim()).filter(Boolean);
              for (const b of bubbles) {
                msgs.push({ uuid: `${sid}-${idx++}`, sender, created_at: m.created_at || null, content: b });
              }
            } else if (m.content && m.content.includes("\n\n")) {
              const parts = m.content.split(/\n\n/).map(s => s.trim()).filter(Boolean);
              for (const p of parts) {
                msgs.push({ uuid: `${sid}-${idx++}`, sender, created_at: m.created_at || null, content: p });
              }
            } else {
              msgs.push({ uuid: `${sid}-${idx++}`, sender, created_at: m.created_at || null, content: m.content });
            }
          }
          const name = renames[sid] || vpsSessions.find(s => s.id === sid)?.preview || sid.slice(0, 8);
          setCurrentConv({
            uuid: sid, name, model: "", created_at: null,
            updated_at: null, messages: msgs, branchedCount: 0,
          });
        }
      })
      .catch(() => {})
      .finally(() => setSessionLoading(false));
  }, [renames, vpsSessions]);

  const loaded = conversations.length > 0 || vpsSessions.length > 0;

  // ── file load ──
  const handleFile = useCallback((file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        let data = JSON.parse(e.target.result);
        if (!Array.isArray(data)) {
          if (data.chat_messages || data.messages) {
            data = [data];
          } else {
            const arrKey = Object.keys(data).find(k => Array.isArray(data[k]) && data[k].length > 0);
            if (arrKey) {
              data = data[arrKey];
            } else {
              alert("无法识别的 JSON 格式\n顶层键: " + Object.keys(data).join(", "));
              return;
            }
          }
        }
        if (data.length > 0 && !data[0].chat_messages && !data[0].messages) {
          const hasMsgFields = data[0].sender || data[0].role || data[0].text || data[0].content;
          if (hasMsgFields) {
            data = [{ uuid: "imported", name: file.name.replace(/\.json$/i, ""), chat_messages: data }];
          }
        }
        const result = processConversations(data);
        if (result.length === 0 && data.length > 0) {
          const sample = data[0];
          alert(`解析到 ${data.length} 个对象但无消息\n字段: ${Object.keys(sample).slice(0, 8).join(", ")}`);
          return;
        }
        setConversations(result);
        setCurrentConv(null);
        setActiveSessionId(null);
        setMobileShowList(true);
        setSidebarTab("import");
      } catch (err) { alert("JSON 解析失败: " + err.message); }
    };
    reader.readAsText(file);
  }, []);

  const onDrop = useCallback((e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }, [handleFile]);
  const onDragOver = useCallback((e) => e.preventDefault(), []);

  // ── search ──
  const query = searchQuery.toLowerCase().trim();

  const { filtered, matchCounts } = useMemo(() => {
    if (!query) return { filtered: conversations, matchCounts: {} };
    const mc = {};
    const f = conversations.filter(c => {
      if (c.name?.toLowerCase().includes(query)) { mc[c.uuid] = -1; return true; }
      let count = 0;
      c.messages.forEach(m => {
        if (getMsgText(m).toLowerCase().includes(query) || (getThinking(m) || "").toLowerCase().includes(query)) count++;
      });
      if (count > 0) { mc[c.uuid] = count; return true; }
      return false;
    });
    return { filtered: f, matchCounts: mc };
  }, [conversations, query]);

  const grouped = useMemo(() => {
    const groups = {};
    const today = new Date(); today.setHours(0, 0, 0, 0);
    filtered.forEach(c => {
      const d = new Date(c.updated_at || c.created_at);
      const diff = (today - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000;
      let label;
      if (diff < 1) label = "今天";
      else if (diff < 2) label = "昨天";
      else if (diff < 7) label = "最近 7 天";
      else if (diff < 30) label = "最近 30 天";
      else label = d.getFullYear() + "年" + (d.getMonth() + 1) + "月";
      if (!groups[label]) groups[label] = [];
      groups[label].push(c);
    });
    return groups;
  }, [filtered]);

  // ── select conversation ──
  const selectConv = useCallback((c) => {
    setCurrentConv(c);
    setMobileShowList(false);
    setShowExport(false);
    if (query) {
      const idx = c.messages.findIndex(m =>
        getMsgText(m).toLowerCase().includes(query) ||
        (getThinking(m) || "").toLowerCase().includes(query)
      );
      if (idx >= 0) setScrollToMsg(idx);
    }
  }, [query]);

  useEffect(() => {
    if (scrollToMsg == null) return;
    const timer = setTimeout(() => {
      const el = document.getElementById(`msg-${scrollToMsg}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      setScrollToMsg(null);
    }, 100);
    return () => clearTimeout(timer);
  }, [scrollToMsg, currentConv]);

  // Auto-scroll to first match when search query changes in current conversation
  useEffect(() => {
    if (!query || !currentConv) return;
    const idx = currentConv.messages.findIndex(m =>
      getMsgText(m).toLowerCase().includes(query) ||
      (getThinking(m) || "").toLowerCase().includes(query)
    );
    if (idx >= 0) setScrollToMsg(idx);
  }, [query, currentConv]);

  // ── search nav: build ▲▼ match list ──
  useEffect(() => {
    if (!query || !currentConv) { setSearchNav(null); return; }
    const matchIds = [];
    currentConv.messages.forEach((m, idx) => {
      if (getMsgText(m).toLowerCase().includes(query) || (getThinking(m) || "").toLowerCase().includes(query))
        matchIds.push(idx);
    });
    setSearchNav(matchIds.length > 0 ? { keyword: query, matchIds, idx: 0 } : null);
  }, [query, currentConv]);

  const searchNavGo = useCallback((dir) => {
    setSearchNav(prev => {
      if (!prev || prev.matchIds.length === 0) return prev;
      const len = prev.matchIds.length;
      const next = (prev.idx + dir + len) % len;
      setTimeout(() => {
        const el = document.getElementById(`msg-${prev.matchIds[next]}`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 0);
      return { ...prev, idx: next };
    });
  }, []);

  // ── exports ──
  const exportJSON = () => {
    if (!currentConv) return;
    const data = {
      name: currentConv.name, model: currentConv.model, created_at: currentConv.created_at,
      messages: currentConv.messages.map(m => ({ sender: getSender(m), created_at: m.created_at, text: getMsgText(m), thinking: getThinking(m) })),
    };
    downloadFile(`${sanitizeFn(currentConv.name)}.json`, JSON.stringify(data, null, 2), "application/json");
    setShowExport(false);
  };
  const exportMarkdown = () => {
    if (!currentConv) return;
    let md = `# ${currentConv.name}\n\n*${fmtDateTime(currentConv.created_at)}*\n\n---\n\n`;
    currentConv.messages.forEach(m => {
      const s = getSender(m) === "human" ? "**小茉莉**" : "**小太阳**";
      const t = m.created_at ? ` *${new Date(m.created_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}*` : "";
      md += `### ${s}${t}\n\n`;
      const thinking = getThinking(m);
      if (thinking) md += `<details><summary>思考过程</summary>\n\n${thinking}\n\n</details>\n\n`;
      md += getMsgText(m) + "\n\n---\n\n";
    });
    downloadFile(`${sanitizeFn(currentConv.name)}.md`, md, "text/markdown");
    setShowExport(false);
  };

  // ── VPS session helpers ──
  const getSessionName = (s) => renames[s.id] || s.preview || s.id.slice(0, 8);
  const isFav = (id) => favorites.includes(id);

  const toggleFav = (id) => {
    if (isFav(id)) {
      saveFavorites(favorites.filter(f => f !== id));
      saveFavOrder(favOrder.filter(f => f !== id));
    } else {
      saveFavorites([...favorites, id]);
      saveFavOrder([...favOrder, id]);
    }
  };

  const moveFav = (id, dir) => {
    const arr = [...favOrder];
    const idx = arr.indexOf(id);
    if (idx < 0) return;
    const target = idx + dir;
    if (target < 0 || target >= arr.length) return;
    [arr[idx], arr[target]] = [arr[target], arr[idx]];
    saveFavOrder(arr);
  };

  const startRename = (id) => {
    setRenamingId(id);
    setRenameValue(renames[id] || "");
    setContextMenu(null);
  };

  const confirmRename = () => {
    if (renamingId) {
      const v = renameValue.trim();
      const next = { ...renames };
      if (v) next[renamingId] = v;
      else delete next[renamingId];
      saveRenames(next);
      if (currentConv?.uuid === renamingId) {
        const fallback = vpsSessions.find(s => s.id === renamingId)?.preview
          || conversations.find(c => c.uuid === renamingId)?.name
          || renamingId.slice(0, 8);
        setCurrentConv(prev => prev ? { ...prev, name: v || fallback } : prev);
      }
    }
    setRenamingId(null);
  };

  // 长按触发
  const handleTouchStart = useCallback((id, e) => {
    const touch = e.touches[0];
    longPressRef.current = setTimeout(() => {
      longPressRef.current = "fired";
      setContextMenu({ id, x: touch.clientX, y: touch.clientY });
    }, 500);
  }, []);
  const handleTouchEnd = useCallback(() => {
    if (longPressRef.current && longPressRef.current !== "fired") clearTimeout(longPressRef.current);
    longPressRef.current = null;
  }, []);
  const handleTouchClick = useCallback((id) => {
    if (longPressRef.current === "fired") { longPressRef.current = null; return; }
    selectVpsSession(id);
  }, [selectVpsSession]);

  // VPS sessions 过滤 + 排序
  const vpsSorted = useMemo(() => {
    let list = [...vpsSessions];
    if (sortMode === "size") list.sort((a, b) => b.size - a.size);
    else list.sort((a, b) => b.mtime - a.mtime);
    return list;
  }, [vpsSessions, sortMode]);

  const vpsFiltered = useMemo(() => {
    if (!query) return vpsSorted;
    return vpsSorted.filter(s => {
      const name = getSessionName(s).toLowerCase();
      return name.includes(query) || s.id.includes(query) || vpsMatchCounts[s.id];
    });
  }, [vpsSorted, query, renames, vpsMatchCounts]);

  const { favSessions, normalSessions } = useMemo(() => {
    const favSet = new Set(favorites);
    const fav = vpsFiltered.filter(s => favSet.has(s.id));
    fav.sort((a, b) => {
      const ai = favOrder.indexOf(a.id);
      const bi = favOrder.indexOf(b.id);
      return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
    });
    const normal = vpsFiltered.filter(s => !favSet.has(s.id));
    return { favSessions: fav, normalSessions: normal };
  }, [vpsFiltered, favorites, favOrder]);

  // ── PanelHeader ──
  const header = (
    <div style={{
      flexShrink: 0, display: "flex", alignItems: "center", gap: 14,
      padding: "calc(12px + env(safe-area-inset-top, 0px)) 16px 12px",
      background: "var(--bg-page)", borderBottom: "1px solid var(--border)", touchAction: "none",
    }}>
      <button onClick={onBack} style={{ background: "none", border: "none", color: "var(--text-secondary)", fontSize: 20, cursor: "pointer", padding: 0, lineHeight: 1, width: 24, fontFamily: "inherit" }}>←</button>
      <span style={{ fontSize: 14, color: "var(--text-primary)", letterSpacing: "0.15em", flex: 1 }}>拾光</span>
    </div>
  );

  // ── Tab bar ──
  const tabBar = (
    <div style={{ display: "flex", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
      <button onClick={() => setSidebarTab("vps")} style={{
        flex: 1, padding: "10px 0", border: "none", cursor: "pointer", fontSize: 13, fontFamily: "inherit",
        background: "none", color: sidebarTab === "vps" ? "var(--accent)" : "var(--text-secondary)",
        borderBottom: sidebarTab === "vps" ? "2px solid var(--accent)" : "2px solid transparent",
        fontWeight: sidebarTab === "vps" ? 600 : 400,
      }}>对话</button>
      <button onClick={() => setSidebarTab("import")} style={{
        flex: 1, padding: "10px 0", border: "none", cursor: "pointer", fontSize: 13, fontFamily: "inherit",
        background: "none", color: sidebarTab === "import" ? "var(--accent)" : "var(--text-secondary)",
        borderBottom: sidebarTab === "import" ? "2px solid var(--accent)" : "2px solid transparent",
        fontWeight: sidebarTab === "import" ? 600 : 400,
      }}>导入{conversations.length > 0 ? ` (${conversations.length})` : ""}</button>
    </div>
  );

  // ── Search bar (shared) ──
  const searchBar = (
    <div style={{ padding: "10px 14px", flexShrink: 0 }}>
      <div style={{ position: "relative" }}>
        <input
          type="text" placeholder="搜索…" value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={{
            width: "100%", padding: "7px 12px 7px 32px", border: "1px solid var(--border)",
            borderRadius: 8, fontSize: 13, background: "var(--bg-card)", outline: "none",
            color: "var(--text-primary)", fontFamily: "inherit",
          }}
        />
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-secondary)" }}>
          <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
        </svg>
        {query && (
          <button onClick={() => setSearchQuery("")} style={{
            position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
            background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)", fontSize: 16, fontFamily: "inherit",
          }}>×</button>
        )}
      </div>
    </div>
  );

  // ── Session item renderer (VPS) ──
  const renderSessionItem = (s) => (
    <div key={s.id} style={{ position: "relative" }}>
      {renamingId === s.id ? (
        <div style={{ padding: "8px 14px", display: "flex", gap: 6, alignItems: "center" }}>
          <input
            autoFocus value={renameValue} onChange={e => setRenameValue(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") confirmRename(); if (e.key === "Escape") setRenamingId(null); }}
            style={{ flex: 1, padding: "5px 8px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13, background: "var(--bg-card)", outline: "none", color: "var(--text-primary)", fontFamily: "inherit" }}
            placeholder="自定义名称…"
          />
          <button onClick={confirmRename} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>确定</button>
          <button onClick={() => setRenamingId(null)} style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>取消</button>
        </div>
      ) : (
        <button
          onClick={() => handleTouchClick(s.id)}
          onTouchStart={e => handleTouchStart(s.id, e)}
          onTouchEnd={handleTouchEnd}
          onTouchMove={handleTouchEnd}
          style={{
            display: "block", width: "100%", padding: "10px 14px", borderRadius: 10, cursor: "pointer",
            border: "none", textAlign: "left", marginBottom: 2, fontFamily: "inherit",
            background: activeSessionId === s.id ? "var(--border)" : "transparent",
            transition: ".15s", WebkitUserSelect: "none", userSelect: "none",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {isFav(s.id) && <span style={{ fontSize: 11, color: "var(--accent)" }}>★</span>}
            <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--text-primary)", flex: 1 }}>
              {getSessionName(s)}
            </span>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 3, display: "flex", gap: 8, alignItems: "center" }}>
            <span>{fmtDate(s.mtime)}</span>
            <span>{(s.size / 1024).toFixed(0)}KB</span>
            {vpsMatchCounts[s.id] > 0 && <span style={{ color: "var(--accent)", fontWeight: 500 }}>{vpsMatchCounts[s.id]} 条匹配</span>}
          </div>
        </button>
      )}
    </div>
  );

  // ── VPS tab content ──
  const vpsTabContent = (
    <>
      <div style={{ display: "flex", alignItems: "center", padding: "6px 14px 0", gap: 6 }}>
        <span style={{ fontSize: 12, color: "var(--text-secondary)", flex: 1 }}>
          {vpsLoading ? "加载中…" : vpsError ? "连接失败" : `${vpsSessions.length} 个`}
        </span>
        <select
          value={sortMode} onChange={e => setSortMode(e.target.value)}
          style={{ fontSize: 11, border: "1px solid var(--border)", borderRadius: 6, padding: "3px 6px", background: "var(--bg-card)", color: "var(--text-secondary)", fontFamily: "inherit", outline: "none" }}
        >
          <option value="time">按时间</option>
          <option value="size">按大小</option>
        </select>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
        {vpsLoading && <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--text-secondary)", fontSize: 13 }}>加载 session 列表…</div>}
        {vpsError && <div style={{ textAlign: "center", padding: "20px", color: "var(--text-secondary)", fontSize: 12 }}>加载失败: {vpsError}</div>}
        {favSessions.length > 0 && (
          <div>
            <div style={{ padding: "6px 12px", fontSize: 11, fontWeight: 600, color: "var(--accent)", marginTop: 4 }}>收藏</div>
            {favSessions.map(s => renderSessionItem(s))}
          </div>
        )}
        {normalSessions.length > 0 && (
          <div>
            {favSessions.length > 0 && <div style={{ padding: "6px 12px", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginTop: 6 }}>全部</div>}
            {normalSessions.map(s => renderSessionItem(s))}
          </div>
        )}
        {!vpsLoading && !vpsError && vpsFiltered.length === 0 && (
          <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--text-secondary)", fontSize: 13 }}>没有找到匹配的 session</div>
        )}
      </div>
    </>
  );

  // ── Import tab content ──
  // 导入 tab 的收藏+排序列表
  const importSorted = useMemo(() => {
    const favSet = new Set(favorites);
    const favItems = filtered.filter(c => favSet.has(c.uuid));
    favItems.sort((a, b) => {
      const ai = favOrder.indexOf(a.uuid);
      const bi = favOrder.indexOf(b.uuid);
      return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
    });
    const normalItems = filtered.filter(c => !favSet.has(c.uuid));
    return { importFav: favItems, importNormal: normalItems };
  }, [filtered, favorites, favOrder]);

  const renderImportItem = (c) => {
    const id = c.uuid;
    const displayName = renames[id] || c.name;
    if (renamingId === id) {
      return (
        <div key={id} style={{ padding: "8px 14px", display: "flex", gap: 6, alignItems: "center" }}>
          <input
            autoFocus value={renameValue} onChange={e => setRenameValue(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") confirmRename(); if (e.key === "Escape") setRenamingId(null); }}
            style={{ flex: 1, padding: "5px 8px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13, background: "var(--bg-card)", outline: "none", color: "var(--text-primary)", fontFamily: "inherit" }}
            placeholder="自定义名称…"
          />
          <button onClick={confirmRename} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>确定</button>
          <button onClick={() => setRenamingId(null)} style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>取消</button>
        </div>
      );
    }
    return (
      <button key={id}
        onClick={() => { if (longPressRef.current === "fired") { longPressRef.current = null; return; } selectConv(c); setActiveSessionId(null); }}
        onTouchStart={e => handleTouchStart(id, e)}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchEnd}
        style={{
          display: "block", width: "100%", padding: "10px 14px", borderRadius: 10, cursor: "pointer",
          border: "none", textAlign: "left", marginBottom: 2, fontFamily: "inherit",
          background: currentConv?.uuid === id && !activeSessionId ? "var(--border)" : "transparent",
          transition: ".15s", WebkitUserSelect: "none", userSelect: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {isFav(id) && <span style={{ fontSize: 11, color: "var(--accent)" }}>★</span>}
          <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--text-primary)", flex: 1 }}>
            {displayName}
          </span>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 3, display: "flex", gap: 8, alignItems: "center" }}>
          <span>{fmtDate(c.updated_at || c.created_at)}</span>
          <span>{c.messages.length} 条</span>
          {c.model && <span style={{ background: "rgba(107,127,212,.15)", color: "var(--accent)", padding: "1px 6px", borderRadius: 4, fontSize: 10 }}>{shortModel(c.model)}</span>}
          {matchCounts[c.uuid] > 0 && <span style={{ color: "var(--accent)", fontWeight: 500 }}>{matchCounts[c.uuid]} 条匹配</span>}
        </div>
      </button>
    );
  };

  const importTabContent = (
    <div style={{ flex: 1, overflowY: "auto", padding: 8, display: "flex", flexDirection: "column" }}>
      {conversations.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 20px" }}>
          <div style={{ color: "var(--text-secondary)", fontSize: 13, marginBottom: 16 }}>还没有导入对话</div>
          <button
            onClick={() => fileRef.current?.click()}
            style={{
              padding: "10px 24px", border: "1px solid var(--border)", borderRadius: 10,
              background: "var(--bg-card)", cursor: "pointer", fontSize: 13, fontFamily: "inherit",
              color: "var(--text-primary)",
            }}
          >导入 JSON 文件</button>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", padding: "2px 12px 6px", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--text-secondary)", flex: 1 }}>{filtered.length} 个对话</span>
            <button onClick={() => { setConversations([]); setCurrentConv(null); setActiveSessionId(null); }} style={{
              background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "var(--text-secondary)", fontFamily: "inherit",
            }}>清除</button>
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {importSorted.importFav.length > 0 && (
              <div>
                <div style={{ padding: "6px 12px", fontSize: 11, fontWeight: 600, color: "var(--accent)", marginTop: 4 }}>收藏</div>
                {importSorted.importFav.map(c => renderImportItem(c))}
              </div>
            )}
            {importSorted.importNormal.length > 0 && (
              <div>
                {importSorted.importFav.length > 0 && <div style={{ padding: "6px 12px", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginTop: 6 }}>全部</div>}
                {importSorted.importNormal.map(c => renderImportItem(c))}
              </div>
            )}
            {filtered.length === 0 && query && (
              <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--text-secondary)", fontSize: 13 }}>没有找到匹配的对话</div>
            )}
          </div>
        </>
      )}
    </div>
  );

  // ── Desktop sidebar ──
  const sidebarContent = (
    <div style={{
      width: 300, minWidth: 300, borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column",
      background: "var(--bg-page)", height: "100%",
    }}>
      {tabBar}
      {searchBar}
      {sidebarTab === "vps" ? vpsTabContent : importTabContent}
    </div>
  );

  // ── Mobile list ──
  const mobileList = (
    <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
      {tabBar}
      {searchBar}
      {sidebarTab === "vps" ? vpsTabContent : importTabContent}
    </div>
  );

  // ── Message area ──
  const messageArea = currentConv ? (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{
        padding: "10px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center",
        background: "var(--bg-card)", flexShrink: 0, gap: 10,
      }}>
        <button onClick={() => setMobileShowList(true)} className="cv-mobile-back" style={{
          background: "none", border: "none", color: "var(--text-secondary)", fontSize: 18, cursor: "pointer", padding: 0, lineHeight: 1, fontFamily: "inherit",
          display: "none",
        }}>←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{currentConv.name}</div>
          <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
            {currentConv.created_at ? fmtDateTime(currentConv.created_at) + " · " : ""}{currentConv.messages.length} 条消息 · {(() => { const c = countConvChars(currentConv.messages); return `正文 ${fmtNum(c.text)} 字` + (c.thinking > 0 ? ` · 思绪 ${fmtNum(c.thinking)} 字` : ""); })()} · ~{fmtTokens(countConvTokens(currentConv.messages))} tokens
            {currentConv.branchedCount > 0 && ` · 已过滤 ${currentConv.branchedCount} 条分支消息`}
          </div>
        </div>
        <div style={{ position: "relative", flexShrink: 0 }}>
          <button onClick={() => setShowExport(o => !o)} style={{
            padding: "5px 12px", border: "1px solid var(--border)", borderRadius: 8,
            background: "var(--bg-card)", cursor: "pointer", fontSize: 12, fontFamily: "inherit",
            color: "var(--text-primary)",
          }}>导出</button>
          {showExport && (
            <div style={{
              position: "absolute", right: 0, top: "100%", marginTop: 4, background: "var(--bg-card)",
              border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 4px 16px rgba(0,0,0,.12)",
              zIndex: 10, minWidth: 140, overflow: "hidden",
            }}>
              <button onClick={exportJSON} style={{ display: "block", width: "100%", padding: "10px 16px", border: "none", background: "none", cursor: "pointer", textAlign: "left", fontSize: 13, fontFamily: "inherit", color: "var(--text-primary)" }}>导出为 JSON</button>
              <button onClick={exportMarkdown} style={{ display: "block", width: "100%", padding: "10px 16px", border: "none", background: "none", cursor: "pointer", textAlign: "left", fontSize: 13, fontFamily: "inherit", color: "var(--text-primary)" }}>导出为 Markdown</button>
            </div>
          )}
        </div>
      </div>
      <div ref={msgRef} style={{ flex: 1, overflowY: "auto", padding: "20px 0" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 16px" }}>
          {sessionLoading ? (
            <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--text-secondary)", fontSize: 13 }}>加载中…</div>
          ) : (
            currentConv.messages.map((m, idx, arr) => {
              const prevSender = idx > 0 ? getSender(arr[idx - 1]) : null;
              const nextSender = idx < arr.length - 1 ? getSender(arr[idx + 1]) : null;
              const showSender = getSender(m) !== prevSender;
              const showTime = getSender(m) !== nextSender;
              return <Message key={m.uuid || idx} m={m} searchQuery={query} id={`msg-${idx}`} idx={idx} showSender={showSender} showTime={showTime}
                onFav={openDiyu} onStartSel={enterSel} selMode={selMode} selected={selIds.has(m.uuid)} onToggleSel={toggleSel} faved={favedUuids.has(m.uuid)} />;
            })
          )}
        </div>
      </div>
      {searchNav && (
        <div style={{
          position: "fixed", bottom: 30, left: "50%", transform: "translateX(-50%)",
          zIndex: 900, display: "flex", alignItems: "center", gap: 6,
          background: "var(--bg-card)", border: "1px solid var(--border)",
          borderRadius: 20, padding: "5px 10px", boxShadow: "0 2px 12px rgba(0,0,0,0.18)",
          fontFamily: "Georgia, 'Noto Serif SC', serif", fontSize: 12,
          color: "var(--text-primary)", whiteSpace: "nowrap",
        }}>
          <button onClick={() => searchNavGo(-1)} style={{
            background: "none", border: "none", color: "var(--text-secondary)",
            cursor: "pointer", padding: "2px 6px", fontSize: 15, lineHeight: 1,
            fontFamily: "inherit", borderRadius: 4,
          }} title="上一个">▲</button>
          <span style={{ fontSize: 11, color: "var(--text-secondary)", letterSpacing: "0.05em", minWidth: 40, textAlign: "center" }}>
            {searchNav.idx + 1} / {searchNav.matchIds.length}
          </span>
          <button onClick={() => searchNavGo(1)} style={{
            background: "none", border: "none", color: "var(--text-secondary)",
            cursor: "pointer", padding: "2px 6px", fontSize: 15, lineHeight: 1,
            fontFamily: "inherit", borderRadius: 4,
          }} title="下一个">▼</button>
          <span style={{ fontSize: 11, color: "var(--text-secondary)", margin: "0 2px" }}>·</span>
          <span style={{ fontSize: 10, color: "var(--text-secondary)", maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis" }}>
            {searchNav.keyword}
          </span>
          <button onClick={() => setSearchNav(null)} style={{
            background: "none", border: "none", color: "var(--text-secondary)",
            cursor: "pointer", padding: "2px 6px", fontSize: 13, lineHeight: 1,
            fontFamily: "inherit",
          }} title="关闭">×</button>
        </div>
      )}
    </div>
  ) : (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, color: "var(--text-secondary)" }}>
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: .4 }}>
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      </svg>
      <span style={{ fontSize: 14 }}>选择一个 session 查看</span>
    </div>
  );

  // ── Context menu (long-press) ──
  const ctxMenu = contextMenu && (
    <div
      onClick={() => setContextMenu(null)}
      style={{ position: "fixed", inset: 0, zIndex: 1000 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: "fixed",
          left: Math.min(contextMenu.x, window.innerWidth - 160),
          top: Math.min(contextMenu.y, window.innerHeight - 200),
          background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10,
          boxShadow: "0 4px 16px rgba(0,0,0,.15)", overflow: "hidden", minWidth: 140, zIndex: 1001,
        }}
      >
        <button onClick={() => { startRename(contextMenu.id); }} style={{
          display: "block", width: "100%", padding: "11px 16px", border: "none", background: "none",
          cursor: "pointer", textAlign: "left", fontSize: 14, fontFamily: "inherit", color: "var(--text-primary)",
        }}>改名</button>
        <button onClick={() => { toggleFav(contextMenu.id); setContextMenu(null); }} style={{
          display: "block", width: "100%", padding: "11px 16px", border: "none", background: "none",
          cursor: "pointer", textAlign: "left", fontSize: 14, fontFamily: "inherit", color: "var(--text-primary)",
        }}>{isFav(contextMenu.id) ? "取消收藏" : "收藏"}</button>
        {isFav(contextMenu.id) && (
          <>
            <div style={{ height: 1, background: "var(--border)", margin: "2px 0" }} />
            <button onClick={() => { moveFav(contextMenu.id, -1); setContextMenu(null); }} style={{
              display: "block", width: "100%", padding: "11px 16px", border: "none", background: "none",
              cursor: "pointer", textAlign: "left", fontSize: 14, fontFamily: "inherit", color: "var(--text-primary)",
            }}>上移</button>
            <button onClick={() => { moveFav(contextMenu.id, 1); setContextMenu(null); }} style={{
              display: "block", width: "100%", padding: "11px 16px", border: "none", background: "none",
              cursor: "pointer", textAlign: "left", fontSize: 14, fontFamily: "inherit", color: "var(--text-primary)",
            }}>下移</button>
          </>
        )}
      </div>
    </div>
  );

  // ── Responsive CSS ──
  const responsiveStyle = (
    <style>{`
      @media(max-width:680px) {
        .cv-sidebar { display: none !important; }
        .cv-mobile-back { display: block !important; }
      }
      @media(min-width:681px) {
        .cv-mobile-list { display: none !important; }
      }
    `}</style>
  );

  // ── 悬浮导入按钮 ──
  const floatingImport = (
    <button
      onClick={() => fileRef.current?.click()}
      title="导入 JSON 文件"
      style={{
        position: "fixed", bottom: 24, right: 24, zIndex: 800,
        width: 44, height: 44, borderRadius: "50%",
        background: "var(--accent)", color: "#fff", border: "none",
        cursor: "pointer", boxShadow: "0 2px 12px rgba(0,0,0,.2)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 20, fontFamily: "inherit",
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 16V4m0 0L8 8m4-4l4 4M4 14v4a2 2 0 002 2h12a2 2 0 002-2v-4" />
      </svg>
    </button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {responsiveStyle}
      {header}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <div className="cv-sidebar" style={{ display: "flex" }}>
          {sidebarContent}
        </div>
        <div className="cv-mobile-list" style={{ flex: 1, display: mobileShowList ? "flex" : "none", flexDirection: "column", minHeight: 0, minWidth: 0 }}>
          {mobileList}
        </div>
        <div style={{ flex: 1, display: mobileShowList ? "none" : "flex", flexDirection: "column", minHeight: 0, minWidth: 0, overflow: "hidden" }}>
          {messageArea}
        </div>
      </div>
      {floatingImport}
      {ctxMenu}
      {toast && (
        <div style={{ position: "fixed", bottom: 90, left: "50%", transform: "translateX(-50%)", zIndex: 1200, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 16px", fontSize: 13, color: "var(--text-primary)", boxShadow: "0 4px 16px rgba(0,0,0,.18)" }}>{toast}</div>
      )}
      {selMode && !diyuPending && (
        <div style={{ position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: "calc(16px + env(safe-area-inset-bottom,0px))", zIndex: 1050, display: "flex", alignItems: "center", gap: 10, width: "min(92%,430px)", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 14px", boxShadow: "0 6px 24px rgba(0,0,0,0.18)", color: "var(--text-primary)", fontSize: 13 }}>
          <span>{selIds.size ? `已选 ${selIds.size} 条` : "点第一条和最后一条"}</span>
          <div style={{ flex: 1 }} />
          <button onClick={exitSel} style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer", fontSize: 13, padding: "6px 10px" }}>取消</button>
          <button disabled={!selIds.size} onClick={diyuFromSel} style={segBtn(!!selIds.size)}>收藏为故事</button>
        </div>
      )}
      {diyuPending && (
        <CVCollectionPicker pending={diyuPending} convUuid={currentConv?.uuid} toast={cvToast}
          onClose={() => setDiyuPending(null)}
          onDone={() => {
            const keys = (diyuPending?.items || []).map(i => i.uuid).filter(Boolean);
            setFavedUuids(s => new Set([...s, ...keys]));
            setDiyuPending(null); exitSel();
          }} />
      )}
      <input ref={fileRef} type="file" accept=".json" style={{ display: "none" }}
        onChange={e => { if (e.target.files[0]) handleFile(e.target.files[0]); }} />
    </div>
  );
}
