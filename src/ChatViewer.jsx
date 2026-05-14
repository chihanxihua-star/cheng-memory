import { useState, useRef, useCallback, useMemo, useEffect } from "react";

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
  if (m.content && Array.isArray(m.content))
    return m.content.filter(b => b.type === "text").map(b => b.text || "").join("\n");
  return m.text || "";
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

function fmtDate(d) {
  if (!d) return "";
  const date = new Date(d);
  const now = new Date();
  if (date.toDateString() === now.toDateString())
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function fmtDateTime(d) {
  if (!d) return "";
  return new Date(d).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
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
  const msgMap = {};
  const childrenMap = {};
  msgs.forEach(m => {
    msgMap[m.uuid] = m;
    const p = m.parent_message_uuid || "__root__";
    if (!childrenMap[p]) childrenMap[p] = [];
    childrenMap[p].push(m);
  });
  let leaf = conv.current_leaf_message_uuid;
  if (!leaf || !msgMap[leaf]) {
    const realLeaves = msgs.filter(m => !childrenMap[m.uuid] || !childrenMap[m.uuid].length);
    const candidates = realLeaves.length ? realLeaves : msgs;
    candidates.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    leaf = candidates[0]?.uuid;
  }
  const active = new Set();
  let cur = leaf;
  while (cur && msgMap[cur]) { active.add(cur); cur = msgMap[cur].parent_message_uuid; }
  return active;
}

function processConversations(data) {
  return data
    .filter(c => (c.chat_messages || c.messages || []).length > 0)
    .map(c => {
      const msgs = c.chat_messages || c.messages || [];
      const activeUuids = getActiveBranch(c, msgs);
      const active = msgs.filter(m => activeUuids.has(m.uuid)).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
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
function Message({ m, searchQuery, id }) {
  const sender = getSender(m);
  const isHuman = sender === "human";
  const time = m.created_at ? new Date(m.created_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "";
  const thinking = getThinking(m);
  const tools = getToolUse(m);
  const atts = getAttachments(m);
  let text = getMsgText(m);

  let rendered = text ? renderMarkdown(text) : "";
  if (searchQuery) rendered = highlightSearch(rendered, searchQuery);

  return (
    <div id={id} style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <div style={{
          width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 13, fontWeight: 600, flexShrink: 0,
          background: isHuman ? "var(--bg-user-bubble)" : "var(--accent)", color: isHuman ? "#7a6f66" : "#fff",
        }}>
          {isHuman ? "H" : "C"}
        </div>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{isHuman ? "You" : "Claude"}</span>
        <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>{time}</span>
      </div>
      <div style={{
        padding: "12px 16px", borderRadius: 12, lineHeight: 1.7, fontSize: 13.5,
        background: isHuman ? "var(--bg-user-bubble)" : "var(--bg-card)",
        boxShadow: isHuman ? "none" : "0 1px 3px rgba(0,0,0,.06)",
        border: isHuman ? "none" : "1px solid var(--border)",
        overflowX: "hidden", wordBreak: "break-word",
      }}>
        {thinking && (
          <Collapsible label="思考过程" badge={thinking.length > 1000 ? `${Math.round(thinking.length / 1000)}k 字符` : `${thinking.length} 字符`}>
            {thinking}
          </Collapsible>
        )}
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
    </div>
  );
}

// ── Main component ───────────────────────────────────────
export default function ChatViewer({ onBack }) {
  const [conversations, setConversations] = useState([]);
  const [currentConv, setCurrentConv] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showExport, setShowExport] = useState(false);
  const [mobileShowList, setMobileShowList] = useState(true);
  const [scrollToMsg, setScrollToMsg] = useState(null);
  const fileRef = useRef(null);
  const msgRef = useRef(null);

  const loaded = conversations.length > 0;

  // ── file load ──
  const handleFile = useCallback((file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        let data = JSON.parse(e.target.result);
        if (!Array.isArray(data)) {
          if (data.conversations) data = data.conversations;
          else if (data.chat_messages || data.messages) data = [data];
          else { alert("无法识别的 JSON 格式"); return; }
        }
        setConversations(processConversations(data));
        setCurrentConv(null);
        setMobileShowList(true);
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
      if (idx >= 0) setScrollToMsg(c.messages[idx].uuid);
    }
  }, [query]);

  useEffect(() => {
    if (!scrollToMsg) return;
    const timer = setTimeout(() => {
      const el = document.getElementById(`msg-${scrollToMsg}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      setScrollToMsg(null);
    }, 100);
    return () => clearTimeout(timer);
  }, [scrollToMsg, currentConv]);

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
      const s = getSender(m) === "human" ? "**You**" : "**Claude**";
      const t = m.created_at ? ` *${new Date(m.created_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}*` : "";
      md += `### ${s}${t}\n\n`;
      const thinking = getThinking(m);
      if (thinking) md += `<details><summary>思考过程</summary>\n\n${thinking}\n\n</details>\n\n`;
      md += getMsgText(m) + "\n\n---\n\n";
    });
    downloadFile(`${sanitizeFn(currentConv.name)}.md`, md, "text/markdown");
    setShowExport(false);
  };

  // ── PanelHeader (reuse pattern) ──
  const header = (
    <div style={{
      flexShrink: 0, display: "flex", alignItems: "center", gap: 14,
      padding: "calc(12px + env(safe-area-inset-top, 0px)) 16px 12px",
      background: "var(--bg-page)", borderBottom: "1px solid var(--border)", touchAction: "none",
    }}>
      <button onClick={onBack} style={{ background: "none", border: "none", color: "var(--text-secondary)", fontSize: 20, cursor: "pointer", padding: 0, lineHeight: 1, width: 24, fontFamily: "inherit" }}>←</button>
      <span style={{ fontSize: 14, color: "var(--text-primary)", letterSpacing: "0.15em", flex: 1 }}>拾光</span>
      {loaded && (
        <button onClick={() => { setConversations([]); setCurrentConv(null); }} style={{
          background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--text-secondary)", fontFamily: "inherit",
        }}>重新导入</button>
      )}
    </div>
  );

  // ── Upload screen ──
  if (!loaded) {
    return (
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        {header}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ textAlign: "center", maxWidth: 420, width: "100%" }}>
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>Claude 对话查看器</div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 28 }}>
              导入从 claude.ai 导出的 JSON 文件
            </div>
            <div
              onClick={() => fileRef.current?.click()}
              onDrop={onDrop}
              onDragOver={onDragOver}
              style={{
                border: "2px dashed var(--border)", borderRadius: 16, padding: "52px 32px", cursor: "pointer",
                transition: ".2s", background: "var(--bg-card)",
              }}
            >
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: "var(--text-secondary)", marginBottom: 14 }}>
                <path d="M12 16V4m0 0L8 8m4-4l4 4M4 14v4a2 2 0 002 2h12a2 2 0 002-2v-4" />
              </svg>
              <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>拖放 JSON 文件到这里</div>
              <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>或点击选择文件</div>
            </div>
            <input ref={fileRef} type="file" accept=".json" style={{ display: "none" }}
              onChange={e => { if (e.target.files[0]) handleFile(e.target.files[0]); }} />
          </div>
        </div>
      </div>
    );
  }

  // ── Sidebar ──
  const sidebar = (
    <div style={{
      width: 300, minWidth: 300, borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column",
      background: "var(--bg-page)", height: "100%",
    }}>
      {/* search */}
      <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>对话</span>
          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            {query ? `${filtered.length}/${conversations.length}` : `${conversations.length} 个`}
          </span>
        </div>
        <div style={{ position: "relative" }}>
          <input
            type="text" placeholder="搜索消息…" value={searchQuery}
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
      {/* list */}
      <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
        {filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--text-secondary)", fontSize: 13 }}>没有找到匹配的对话</div>
        )}
        {Object.entries(grouped).map(([label, items]) => (
          <div key={label}>
            <div style={{ padding: "6px 12px", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginTop: 6 }}>{label}</div>
            {items.map(c => (
              <button key={c.uuid} onClick={() => selectConv(c)} style={{
                display: "block", width: "100%", padding: "10px 14px", borderRadius: 10, cursor: "pointer",
                border: "none", textAlign: "left", marginBottom: 2, fontFamily: "inherit",
                background: currentConv?.uuid === c.uuid ? "var(--border)" : "transparent",
                transition: ".15s",
              }}>
                <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--text-primary)" }}>
                  {c.name}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 3, display: "flex", gap: 8, alignItems: "center" }}>
                  <span>{fmtDate(c.updated_at || c.created_at)}</span>
                  <span>{c.messages.length} 条</span>
                  {c.model && <span style={{ background: "rgba(107,127,212,.15)", color: "var(--accent)", padding: "1px 6px", borderRadius: 4, fontSize: 10 }}>{shortModel(c.model)}</span>}
                  {matchCounts[c.uuid] > 0 && <span style={{ color: "var(--accent)", fontWeight: 500 }}>{matchCounts[c.uuid]} 条匹配</span>}
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );

  // ── Mobile list ──
  const mobileList = (
    <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
      {/* search */}
      <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>对话</span>
          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            {query ? `${filtered.length}/${conversations.length}` : `${conversations.length} 个`}
          </span>
        </div>
        <div style={{ position: "relative" }}>
          <input
            type="text" placeholder="搜索消息…" value={searchQuery}
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
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
        {filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--text-secondary)", fontSize: 13 }}>没有找到匹配的对话</div>
        )}
        {Object.entries(grouped).map(([label, items]) => (
          <div key={label}>
            <div style={{ padding: "6px 12px", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginTop: 6 }}>{label}</div>
            {items.map(c => (
              <button key={c.uuid} onClick={() => selectConv(c)} style={{
                display: "block", width: "100%", padding: "12px 14px", borderRadius: 10, cursor: "pointer",
                border: "none", textAlign: "left", marginBottom: 2, fontFamily: "inherit",
                background: "transparent",
              }}>
                <div style={{ fontSize: 14, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--text-primary)" }}>
                  {c.name}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 3, display: "flex", gap: 8, alignItems: "center" }}>
                  <span>{fmtDate(c.updated_at || c.created_at)}</span>
                  <span>{c.messages.length} 条</span>
                  {c.model && <span style={{ background: "rgba(107,127,212,.15)", color: "var(--accent)", padding: "1px 6px", borderRadius: 4, fontSize: 10 }}>{shortModel(c.model)}</span>}
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );

  // ── Message area ──
  const messageArea = currentConv ? (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* conv header */}
      <div style={{
        padding: "10px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center",
        background: "var(--bg-card)", flexShrink: 0, gap: 10,
      }}>
        {/* mobile back */}
        <button onClick={() => setMobileShowList(true)} className="cv-mobile-back" style={{
          background: "none", border: "none", color: "var(--text-secondary)", fontSize: 18, cursor: "pointer", padding: 0, lineHeight: 1, fontFamily: "inherit",
          display: "none",
        }}>←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{currentConv.name}</div>
          <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
            {fmtDateTime(currentConv.created_at)} · {currentConv.messages.length} 条消息
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
      {/* messages */}
      <div ref={msgRef} style={{ flex: 1, overflowY: "auto", padding: "20px 0" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 16px" }}>
          {currentConv.messages.map(m => (
            <Message key={m.uuid} m={m} searchQuery={query} id={`msg-${m.uuid}`} />
          ))}
        </div>
      </div>
    </div>
  ) : (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, color: "var(--text-secondary)" }}>
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: .4 }}>
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      </svg>
      <span style={{ fontSize: 14 }}>从左侧选择一个对话</span>
    </div>
  );

  // ── Responsive CSS (injected once) ──
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

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {responsiveStyle}
      {header}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* Desktop sidebar */}
        <div className="cv-sidebar" style={{ display: "flex" }}>
          {sidebar}
        </div>
        {/* Mobile: show list or messages */}
        <div className="cv-mobile-list" style={{ flex: 1, display: mobileShowList ? "flex" : "none", flexDirection: "column", minHeight: 0, minWidth: 0 }}>
          {mobileList}
        </div>
        {/* Main content area */}
        <div style={{ flex: 1, display: mobileShowList ? "none" : "flex", flexDirection: "column", minHeight: 0, minWidth: 0, overflow: "hidden" }}>
          {messageArea}
        </div>
        {/* Desktop: always show message area */}
      </div>
    </div>
  );
}
