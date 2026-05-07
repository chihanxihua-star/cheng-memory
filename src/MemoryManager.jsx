import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import ChatPanel from "./ChatPanel";

// ── 配置 ─────────────────────────────────────────────────
const SB_URL = "https://fgfyvyztjyqvxijfppgm.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZnZnl2eXp0anlxdnhpamZwcGdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4ODMxNzMsImV4cCI6MjA5MDQ1OTE3M30.APTLMLcdY5lsxxXjHeZ3WQvFbYUINjsCUZImECI-pVk";

// 5 个板块的极简线性图标（22×22 stroke-only，跟整体 ins 调性匹配）
const ICONS = {
  memory: (
    // 涟漪：同心圆
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="2"/>
      <path d="M6 12a6 6 0 0112 0" opacity="0.55"/>
      <path d="M2 12a10 10 0 0120 0" opacity="0.3"/>
    </svg>
  ),
  diary: (
    // 溯洄：折页本
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 4h11a2 2 0 012 2v14a2 2 0 01-2 2H5z"/>
      <path d="M5 4v18"/>
      <line x1="9" y1="9" x2="14" y2="9"/>
      <line x1="9" y1="13" x2="14" y2="13"/>
    </svg>
  ),
  milestones: (
    // 逢春：单叶
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 21c0-10 8-15 16-16-1 9-7 16-16 16z"/>
      <path d="M5 21c5-5 8-9 11-12" opacity="0.5"/>
    </svg>
  ),
  board: (
    // 回音：对话气泡
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a8 8 0 01-11.7 7.1L4 20l1-4.7A8 8 0 0121 12z"/>
    </svg>
  ),
  chat: (
    // 花信风：风线
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8h13a3 3 0 100-5"/>
      <path d="M3 14h17a3 3 0 110 6"/>
      <path d="M3 11h8"/>
    </svg>
  ),
  console: (
    // 控制台：仪表板（2x2 方格）
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5"/>
      <rect x="14" y="3" width="7" height="7" rx="1.5"/>
      <rect x="3" y="14" width="7" height="7" rx="1.5"/>
      <rect x="14" y="14" width="7" height="7" rx="1.5"/>
    </svg>
  ),
};

const TABS = [
  { key: "memory", label: "涟漪" },
  { key: "diary", label: "潮汐" },
  { key: "milestones", label: "逢春" },
  { key: "board", label: "回音" },
  { key: "chat", label: "花信风" },
  { key: "console", label: "控制台" },
];

const PANEL_NAME = Object.fromEntries(TABS.map(t => [t.key, t.label]));

const TODO_STATUSES = ["全部", "待办", "完成"];
const TODO_STATUS_COLORS = { 待办: "#e8b86d", 完成: "#8aab9e" };

const LEVEL_META = {
  1: { label: "浮沫", color: "#FFEEEE" },
  2: { label: "长潮", color: "#FAD9E6" },
  3: { label: "深海", color: "#F9C5D5" },
};

const AUTHOR_COLORS = {
  澄: "#a89fd8", 小太阳: "#e8b86d", 宝贝: "#d4a0c0",
  小茉莉: "#d89fa8", default: "#8aab9e",
};

const BOARD_CATS = ["全部", "紧急", "闲聊"];
const BOARD_CAT_COLORS = { 紧急: "#e07070", 闲聊: "#8aab9e", 其他: "#7fb3c8" };
const BOARD_REACTIONS = ["❤️", "👍", "😂", "🥺", "✨"];

// 底部固定栏高度（含 iOS 安全区）—— 内容区 paddingBottom 用它，固定输入栏 bottom 也用它
const NAV_HEIGHT = "calc(56px + env(safe-area-inset-bottom, 0px))";

// ── API 层 ──────────────────────────────────────────────
function hdr() {
  return {
    "Content-Type": "application/json",
    apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
    Prefer: "return=representation",
  };
}

async function sbGet(table, params = "") {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?select=*${params}`, { headers: hdr() });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function sbPost(table, data) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, { method: "POST", headers: hdr(), body: JSON.stringify(data) });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function sbPatch(table, id, patch) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?id=eq.${id}`, { method: "PATCH", headers: hdr(), body: JSON.stringify(patch) });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function sbDelete(table, id) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?id=eq.${id}`, { method: "DELETE", headers: { ...hdr(), Prefer: "return=minimal" } });
  if (!r.ok) throw new Error(await r.text());
}

// ── 通用组件 ─────────────────────────────────────────────
function Badge({ children, color = "#ffffff22", text = "#ffffffaa" }) {
  return <span style={{ background: color, color: text, fontSize: 10, padding: "1px 7px", borderRadius: 99, letterSpacing: "0.04em" }}>{children}</span>;
}

function AuthorBadge({ author }) {
  const c = AUTHOR_COLORS[author] || AUTHOR_COLORS.default;
  return <Badge color={c + "22"} text={c}>{author}</Badge>;
}

function EmotionDot({ valence = 0.5, arousal = 0.5, size = 44 }) {
  const x = valence * (size - 8) + 4;
  const y = (1 - arousal) * (size - 8) + 4;
  const hue = Math.round(valence * 200 + 160);
  const sat = 40 + arousal * 50;
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <rect x={0} y={0} width={size} height={size} rx={4} fill="var(--bg-card)" />
      <line x1={size/2} y1={2} x2={size/2} y2={size-2} stroke="var(--border)" strokeWidth={0.5}/>
      <line x1={2} y1={size/2} x2={size-2} y2={size/2} stroke="var(--border)" strokeWidth={0.5}/>
      <circle cx={x} cy={y} r={3.5} fill={`hsl(${hue},${sat}%,65%)`} opacity={0.9}/>
    </svg>
  );
}

function StrengthBar({ value = 0 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ flex: 1, height: 1, background: "var(--border)", borderRadius: 99 }}>
        <div style={{ width: `${(value*100).toFixed(0)}%`, height: "100%", background: "var(--text-primary)", borderRadius: 99, transition: "width 0.4s" }}/>
      </div>
      <span style={{ fontSize: 10, color: "var(--text-tertiary)", minWidth: 28, textAlign: "right" }}>{(value*100).toFixed(0)}%</span>
    </div>
  );
}

function SensoryAnchors({ context }) {
  if (!context) return null;
  let senses;
  try { const p = typeof context === "string" ? JSON.parse(context) : context; senses = p?.senses; } catch { return null; }
  if (!senses?.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
      {senses.map((s, i) => <span key={i} style={{ fontSize: 10.5, color: "var(--text-secondary)", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 4, padding: "1px 6px", fontStyle: "italic" }}>{s}</span>)}
    </div>
  );
}

function ErrorBar({ error, onClose }) {
  if (!error) return null;
  return <div onClick={onClose} style={{ background: "#c0392b18", border: "1px solid #c0392b44", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#e07070", marginBottom: 14, cursor: "pointer" }}>{error} <span style={{ float: "right", opacity: 0.5 }}>✕</span></div>;
}

const inputStyle = { background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-primary)", padding: "8px 10px", fontSize: 13, width: "100%", fontFamily: "inherit", resize: "vertical", outline: "none", boxSizing: "border-box" };
const underlineStyle = { background: "transparent", border: "none", borderBottom: "1px solid var(--border)", borderRadius: 0, color: "var(--text-primary)", padding: "8px 0", fontSize: 14, width: "100%", fontFamily: "Georgia, 'Noto Serif SC', serif", resize: "none", outline: "none", boxSizing: "border-box", lineHeight: 1.55 };
const labelStyle = { fontSize: 11, color: "var(--text-secondary)", letterSpacing: "0.06em", marginBottom: 4, display: "block" };

function chipStyle(active, color = "#6b7fd4") {
  return {
    padding: "5px 12px", borderRadius: 99, fontSize: 11.5, cursor: "pointer", fontFamily: "inherit",
    background: active ? color + "22" : "var(--bg-card)",
    border: `1px solid ${active ? color + "66" : "var(--border)"}`,
    color: active ? color : "var(--text-secondary)", transition: "all 0.15s",
  };
}

function ActionBtn({ children, onClick, accent = false, color = "#6b7fd4", disabled = false, flex = 1 }) {
  return <button onClick={onClick} disabled={disabled} style={{
    flex, padding: "5px 0", fontFamily: "inherit", fontSize: 11.5, cursor: disabled ? "not-allowed" : "pointer", borderRadius: 5, transition: "all 0.15s",
    background: accent ? color + "22" : "var(--bg-card)",
    border: `1px solid ${accent ? color + "66" : "var(--border)"}`,
    color: disabled ? "var(--text-secondary)" : accent ? color : "var(--text-secondary)",
  }}>{children}</button>;
}

function Drawer({ title, onClose, children, footer }) {
  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={onClose} style={{ flex: 1, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}/>
      <div style={{ width: 380, maxWidth: "90vw", background: "var(--bg-card)", borderLeft: "1px solid var(--border)", display: "flex", flexDirection: "column", animation: "slideIn 0.22s ease" }}>
        <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "var(--text-secondary)", letterSpacing: "0.1em" }}>{title}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>{children}</div>
        {footer && <div style={{ padding: "calc(12px + env(safe-area-inset-bottom, 20px)) 20px", display: "flex", gap: 8 }}>{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

function BottomSheet({ title, onClose, children }) {
  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div onClick={onClose} style={{ flex: 1, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}/>
      <div style={{
        background: "var(--bg-card)",
        borderRadius: "16px 16px 0 0",
        maxHeight: "80vh",
        display: "flex", flexDirection: "column",
        animation: "slideUp 0.22s ease",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}>
        <div style={{ padding: "14px 20px 10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "var(--text-secondary)", letterSpacing: "0.1em" }}>{title || ""}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ overflow: "auto", padding: "8px 20px 24px", fontSize: 14, color: "var(--text-primary)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{children}</div>
      </div>
    </div>,
    document.body
  );
}

function formatDate(d) { return d ? new Date(d).toLocaleDateString("zh-CN", { month: "short", day: "numeric" }) : ""; }
function formatDateTime(d) { return d ? new Date(d).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""; }

// ════════════════════════════════════════════════════════════
//  记忆板块
// ════════════════════════════════════════════════════════════
const MEM_SORTS = [
  { key: "created_at.desc", label: "最新" }, { key: "created_at.asc", label: "最旧" },
  { key: "strength.desc", label: "强度↓" }, { key: "strength.asc", label: "强度↑" },
  { key: "arousal.desc", label: "唤醒度↓" }, { key: "ref_count.desc", label: "引用↓" },
];
const EMPTY_MEM = { content: "", summary: "", level: 1, valence: 0.5, arousal: 0.5, tags: [], resolved: false, flashbulb: false, pinned: false, strength: 1.0, author: "小茉莉", context: null };

function MemoryDrawer({ memory, isNew, onSave, onClose }) {
  const [f, setF] = useState({
    content: memory.content || "", summary: memory.summary || "",
    level: memory.level ?? 1, valence: memory.valence ?? 0.5, arousal: memory.arousal ?? 0.5,
    tags: Array.isArray(memory.tags) ? memory.tags.join(", ") : "",
    resolved: memory.resolved ?? false, pinned: memory.pinned ?? false, flashbulb: memory.flashbulb ?? false,
    strength: memory.strength ?? 1, author: memory.author || "小茉莉", senses: "",
  });
  useEffect(() => { try { const p = typeof memory.context === "string" ? JSON.parse(memory.context) : memory.context; if (p?.senses) setF(x => ({ ...x, senses: p.senses.join(", ") })); } catch {} }, [memory.context]);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const accent = LEVEL_META[f.level]?.color || "#6b7fd4";
  const save = () => {
    const sensesArr = f.senses.split(",").map(s => s.trim()).filter(Boolean);
    onSave({ content: f.content, summary: f.summary || null, level: Number(f.level), valence: Number(f.valence), arousal: Number(f.arousal), strength: Number(f.strength), tags: f.tags.split(",").map(t => t.trim()).filter(Boolean), resolved: f.resolved, pinned: f.pinned, flashbulb: f.flashbulb, author: f.author, context: sensesArr.length ? JSON.stringify({ senses: sensesArr }) : null });
  };
  return (
    <Drawer title={isNew ? "写入记忆" : "编辑记忆"} onClose={onClose} footer={<>
      <ActionBtn onClick={onClose}>取消</ActionBtn>
      <ActionBtn accent color={accent} disabled={!f.content.trim()} onClick={save} flex={2}>{isNew ? "写入" : "保存"}</ActionBtn>
    </>}>
      <div><label style={labelStyle}>内容</label><textarea rows={5} style={inputStyle} value={f.content} onChange={e => set("content", e.target.value)} placeholder="写下这条记忆…"/></div>
      <div><label style={labelStyle}>摘要</label><textarea rows={2} style={{ ...inputStyle, resize: "none" }} value={f.summary} onChange={e => set("summary", e.target.value)} placeholder="一句话概括"/></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div><label style={labelStyle}>层级</label><select style={inputStyle} value={f.level} onChange={e => set("level", e.target.value)}><option value={1}>1 · 浮沫</option><option value={2}>2 · 长潮</option><option value={3}>3 · 深海</option></select></div>
        <div><label style={labelStyle}>作者</label><input style={inputStyle} value={f.author} onChange={e => set("author", e.target.value)}/></div>
      </div>
      <div><label style={labelStyle}>情绪 — {Number(f.valence).toFixed(2)}</label><input type="range" min={0} max={1} step={0.01} style={{ width: "100%", accentColor: accent }} value={f.valence} onChange={e => set("valence", e.target.value)}/><div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-secondary)" }}><span>不嘻嘻</span><span>稳定</span><span>嘻嘻</span></div></div>
      <div><label style={labelStyle}>情绪浓度 — {Number(f.arousal).toFixed(2)}</label><input type="range" min={0} max={1} step={0.01} style={{ width: "100%", accentColor: accent }} value={f.arousal} onChange={e => set("arousal", e.target.value)}/><div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-secondary)" }}><span>淡淡的</span><span>一般</span><span>上头了</span></div></div>
      {!isNew && <div><label style={labelStyle}>强度 — {Number(f.strength).toFixed(2)}</label><input type="range" min={0} max={1} step={0.01} style={{ width: "100%", accentColor: accent }} value={f.strength} onChange={e => set("strength", e.target.value)}/></div>}
      <div><label style={labelStyle}>标签（逗号分隔）</label><input style={inputStyle} value={f.tags} onChange={e => set("tags", e.target.value)} placeholder="起源, 调试"/></div>
      <div><label style={labelStyle}>感官锚点（逗号分隔）</label><input style={inputStyle} value={f.senses} onChange={e => set("senses", e.target.value)} placeholder="窗外下雨, 咖啡的味道"/></div>
      <div style={{ display: "flex", gap: 16 }}>
        {[["pinned","📌 锚"],["flashbulb","⚡ 沉鸣"],["resolved","✓ 已解决"]].map(([k,l]) => (
          <label key={k} style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 12, color: f[k] ? "var(--text-primary)" : "var(--text-secondary)" }}>
            <input type="checkbox" checked={f[k]} onChange={e => set(k, e.target.checked)} style={{ accentColor: accent }}/>{l}
          </label>
        ))}
      </div>
    </Drawer>
  );
}

function MemoryCard({ mem, onEdit, onDelete }) {
  const meta = LEVEL_META[mem.level] || LEVEL_META[1];
  const [cd, setCd] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [tx, setTx] = useState(0);
  const startX = useRef(null);
  const baseTx = useRef(0);
  const REVEAL = 130;
  const tagPill = { fontSize: 10, color: "var(--text-tertiary)", background: "transparent", border: "1px solid var(--border)", borderRadius: 99, padding: "1px 8px", letterSpacing: "0.04em" };
  const actionBtn = { background: "none", border: "none", color: "var(--text-tertiary)", fontSize: 12, padding: "0 8px", cursor: "pointer", fontFamily: "inherit", letterSpacing: "0.05em", height: "100%" };
  const onTouchStart = (e) => { startX.current = e.touches[0].clientX; baseTx.current = tx; };
  const onTouchMove = (e) => {
    if (startX.current === null) return;
    const dx = e.touches[0].clientX - startX.current;
    let nx = baseTx.current + dx;
    nx = Math.min(0, Math.max(-REVEAL, nx));
    setTx(nx);
  };
  const onTouchEnd = () => { setTx(tx < -REVEAL / 2 ? -REVEAL : 0); startX.current = null; };
  return (
    <div style={{ position: "relative", overflow: "hidden", borderRadius: 16 }}>
      {/* 左滑显示的操作（在右侧露出） */}
      <div style={{
        position: "absolute", right: 0, top: 0, bottom: 0, width: REVEAL,
        display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4, paddingRight: 12,
      }}>
        <button onClick={() => { onEdit(mem); setTx(0); }} style={actionBtn}>编辑</button>
        {cd
          ? <button onClick={() => { onDelete(mem.id); setCd(false); setTx(0); }} style={{ ...actionBtn, color: "#c0392b" }}>确认</button>
          : <button onClick={() => setCd(true)} style={{ ...actionBtn, color: "#c0392b" }}>删除</button>}
      </div>

      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          padding: "18px 20px",
          display: "flex", flexDirection: "column", gap: 14,
          transform: `translateX(${tx}px)`,
          transition: startX.current === null ? "transform 0.22s ease" : "none",
        }}
      >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <EmotionDot valence={mem.valence} arousal={mem.arousal}/>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p onClick={() => setSheet(true)} style={{ margin: 0, fontSize: 14, color: "var(--text-primary)", lineHeight: 1.65, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", cursor: "pointer" }}>{mem.content}</p>
          {sheet && (
            <BottomSheet onClose={() => setSheet(false)}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
                {mem.summary && <div style={{ fontSize: 16, color: "var(--text-primary)", fontWeight: 500, lineHeight: 1.4 }}>{mem.summary}</div>}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                  <AuthorBadge author={mem.author}/>
                  {(mem.tags||[]).map(t => <Badge key={t} color="var(--border)" text="var(--text-secondary)">{t}</Badge>)}
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-secondary)" }}>{formatDate(mem.created_at)}</span>
                </div>
              </div>
              <div>{mem.content}</div>
            </BottomSheet>
          )}
          {mem.summary && <p style={{ margin: "6px 0 0", fontSize: 11.5, color: "var(--text-tertiary)", lineHeight: 1.5 }}>{mem.summary}</p>}
          <SensoryAnchors context={mem.context}/>
        </div>
      </div>

      <StrengthBar value={mem.strength ?? 0}/>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", fontSize: 11, color: "var(--text-tertiary)" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 6, height: 6, borderRadius: 99, background: meta.color, display: "inline-block" }}/>
          <span style={{ color: meta.color, letterSpacing: "0.05em" }}>{meta.label}</span>
        </span>
        <span style={{ color: "var(--text-tertiary)" }}>·</span>
        <span style={{ color: "var(--text-tertiary)" }}>{mem.author}</span>
        {mem.pinned && <span title="置顶">📌</span>}
        {mem.flashbulb && <span title="闪光">⚡</span>}
        {mem.resolved === false && <span style={{ color: "var(--text-secondary)" }}>未愈</span>}
        {(mem.tags||[]).slice(0,3).map(t => <span key={t} style={tagPill}>{t}</span>)}
        <span style={{ marginLeft: "auto", color: "var(--text-tertiary)" }}>{formatDate(mem.created_at)} · 引用 {mem.ref_count??0}</span>
      </div>
      </div>
    </div>
  );
}

function MemoryPanel() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ level: "", pinned: false, flashbulb: false, unresolved: false, search: "" });
  const [sort, setSort] = useState("created_at.desc");
  const [stats, setStats] = useState(null);
  const timer = useRef(null);

  const load = useCallback(async (f, s) => {
    setLoading(true); setError(null);
    try {
      const [col, dir] = s.split(".");
      let p = `&order=${col}.${dir}`;
      if (f.level) p += `&level=eq.${f.level}`;
      if (f.pinned) p += `&pinned=eq.true`;
      if (f.flashbulb) p += `&flashbulb=eq.true`;
      if (f.unresolved) p += `&resolved=eq.false`;
      if (f.search) p += `&content=ilike.*${encodeURIComponent(f.search)}*`;
      const d = await sbGet("memories_cheng", p);
      setItems(d);
      setStats({ total: d.length, l1: d.filter(m=>m.level===1).length, l2: d.filter(m=>m.level===2).length, l3: d.filter(m=>m.level===3).length, avgStr: d.length ? (d.reduce((a,m)=>a+(m.strength||0),0)/d.length).toFixed(2) : "—", pinned: d.filter(m=>m.pinned).length, flash: d.filter(m=>m.flashbulb).length });
    } catch(e) { setError(e.message); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(filters, sort); }, [load]);
  const reload = () => load(filters, sort);
  const filterChange = (k, v) => { const n = { ...filters, [k]: v }; setFilters(n); if (k==="search") { clearTimeout(timer.current); timer.current = setTimeout(() => load(n,sort), 400); } else load(n,sort); };

  const [editor, setEditor] = useState(null); // null | { mode: "create" | "edit", entry }
  const submitMemory = async (patch) => {
    if (editor?.mode === "create") {
      const tempId = "tmp-" + Date.now();
      const tempMem = { id: tempId, ...patch, created_at: new Date().toISOString(), strength: 1, ref_count: 0 };
      setItems(arr => [tempMem, ...arr]);
      setEditor(null);
      try {
        const saved = await sbPost("memories_cheng", patch);
        const real = Array.isArray(saved) ? saved[0] : saved;
        setItems(arr => arr.map(it => it.id === tempId ? (real || it) : it));
      } catch(e) {
        setError(e.message);
        setItems(arr => arr.filter(it => it.id !== tempId));
      }
    } else if (editor?.mode === "edit") {
      const id = editor.entry.id;
      setItems(arr => arr.map(it => it.id === id ? { ...it, ...patch } : it));
      setEditor(null);
      try { await sbPatch("memories_cheng", id, patch); }
      catch(e) { setError(e.message); reload(); }
    }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          {stats && <p style={{ margin: 0, fontSize: 11, color: "var(--text-tertiary)" }}>共 {stats.total} 条 · 均强度 {stats.avgStr}</p>}
        </div>
        <button onClick={reload} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: "var(--text-tertiary)" }}>{loading ? "…" : "刷新"}</button>
      </div>

      {/* 搜索条：横线 */}
      <div style={{ marginBottom: 14 }}>
        <input placeholder="搜索…" value={filters.search} onChange={e => filterChange("search", e.target.value)} style={{ ...underlineStyle, fontSize: 13, padding: "6px 0" }}/>
      </div>

      {/* 标签栏 — 无边框，仅文字 + 下划线（active） */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 22, marginBottom: 16, alignItems: "center" }}>
        {[1,2,3].map(l => {
          const a = filters.level === l;
          return (
            <button key={l} onClick={() => filterChange("level", a ? "" : l)} style={{
              background: "none", border: "none",
              padding: "5px 0 7px", cursor: "pointer", fontFamily: "inherit",
              fontSize: 13, letterSpacing: "0.15em",
              color: a ? "var(--text-primary)" : "var(--text-tertiary)",
              fontWeight: a ? 600 : 400,
              borderBottom: a ? "2px solid var(--text-primary)" : "2px solid transparent",
              transition: "all 0.15s",
            }}>{LEVEL_META[l].label}</button>
          );
        })}
        <button onClick={() => filterChange("pinned", !filters.pinned)} style={{
          background: "none", border: "none",
          padding: "5px 0 7px", cursor: "pointer", fontFamily: "inherit",
          fontSize: 13, letterSpacing: "0.15em",
          color: filters.pinned ? "var(--text-primary)" : "var(--text-tertiary)",
          fontWeight: filters.pinned ? 600 : 400,
          borderBottom: filters.pinned ? "2px solid var(--text-primary)" : "2px solid transparent",
          transition: "all 0.15s",
        }}>锚</button>
        <button onClick={() => filterChange("flashbulb", !filters.flashbulb)} style={{
          background: "none", border: "none",
          padding: "5px 0 7px", cursor: "pointer", fontFamily: "inherit",
          fontSize: 13, letterSpacing: "0.15em",
          color: filters.flashbulb ? "var(--text-primary)" : "var(--text-tertiary)",
          fontWeight: filters.flashbulb ? 600 : 400,
          borderBottom: filters.flashbulb ? "2px solid var(--text-primary)" : "2px solid transparent",
          transition: "all 0.15s",
        }}>沉鸣</button>
        <button onClick={() => filterChange("unresolved", !filters.unresolved)} style={{
          background: "none", border: "none",
          padding: "5px 0 7px", cursor: "pointer", fontFamily: "inherit",
          fontSize: 13, letterSpacing: "0.15em",
          color: filters.unresolved ? "var(--text-primary)" : "var(--text-tertiary)",
          fontWeight: filters.unresolved ? 600 : 400,
          borderBottom: filters.unresolved ? "2px solid var(--text-primary)" : "2px solid transparent",
          transition: "all 0.15s",
        }}>未愈</button>
        <select value={sort} onChange={e => { setSort(e.target.value); load(filters, e.target.value); }} style={{
          background: "transparent", border: "none",
          padding: "5px 0", fontSize: 12, color: "var(--text-tertiary)",
          fontFamily: "inherit", cursor: "pointer", outline: "none",
          letterSpacing: "0.08em",
        }}>
          {MEM_SORTS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      </div>

      <ErrorBar error={error} onClose={() => setError(null)}/>

      <PullToCreate onCreate={() => setEditor({ mode: "create", entry: null })}>
        {loading ? <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-tertiary)", fontSize: 13 }}>正在拉取…</div>
          : items.length === 0 ? <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-tertiary)", fontSize: 13 }}>没有记忆</div>
          : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 10 }}>
              {items.map(m => <div key={m.id} style={{ animation: "fadeUp 0.25s ease both" }}><MemoryCard mem={m} onEdit={mem => setEditor({ mode: "edit", entry: mem })} onDelete={async id => { try { await sbDelete("memories_cheng", id); reload(); } catch(e) { setError(e.message); } }}/></div>)}
            </div>}
      </PullToCreate>

      {editor && (
        <MemoryFullForm
          entry={editor.entry}
          isNew={editor.mode === "create"}
          onCancel={() => setEditor(null)}
          onSave={submitMemory}
        />
      )}
    </div>
  );
}

function MemoryFullForm({ entry, isNew, onCancel, onSave }) {
  const initialSenses = (() => {
    try {
      const c = typeof entry?.context === "string" ? JSON.parse(entry.context) : entry?.context;
      return Array.isArray(c?.senses) ? c.senses.join(", ") : "";
    } catch { return ""; }
  })();
  const [f, setF] = useState({
    author: entry?.author || "小茉莉",
    summary: entry?.summary || "",
    content: entry?.content || "",
    event_date: "",
    level: entry?.level ?? 1,
    valence: entry?.valence ?? 0.5,
    arousal: entry?.arousal ?? 0.5,
    strength: entry?.strength ?? 1.0,
    tags: Array.isArray(entry?.tags) ? entry.tags.join(", ") : "",
    senses: initialSenses,
    pinned: !!entry?.pinned,
    flashbulb: !!entry?.flashbulb,
    resolved: entry?.resolved !== false,
  });
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const can = !!f.content.trim();

  const save = () => {
    if (!can) return;
    const senses = f.senses.split(",").map(s => s.trim()).filter(Boolean);
    const ctx = (senses.length || f.event_date) ? {
      ...(senses.length ? { senses } : {}),
      ...(f.event_date ? { event_date: f.event_date } : {}),
    } : null;
    onSave({
      content: f.content,
      summary: f.summary || null,
      level: Number(f.level),
      valence: Number(f.valence),
      arousal: Number(f.arousal),
      strength: Number(f.strength),
      tags: f.tags.split(",").map(t => t.trim()).filter(Boolean),
      author: f.author,
      pinned: f.pinned,
      flashbulb: f.flashbulb,
      resolved: f.resolved,
      context: ctx,
    });
  };

  return createPortal(
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "var(--bg-page)",
      display: "flex", flexDirection: "column",
      animation: "slideDown 0.28s ease",
    }}>
      {/* 顶栏 */}
      <div style={{
        flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "calc(14px + env(safe-area-inset-top, 0px)) 16px 14px",
        borderBottom: "1px solid var(--border)",
      }}>
        <button onClick={onCancel} style={{ background: "none", border: "none", color: "var(--text-secondary)", fontSize: 12, letterSpacing: "0.18em", cursor: "pointer", fontFamily: "inherit", padding: 0 }}>CANCEL</button>
        <span style={{ fontSize: 13, color: "var(--text-primary)", letterSpacing: "0.22em" }}>{isNew ? "新涟漪" : "编辑涟漪"}</span>
        <button onClick={save} disabled={!can} style={{
          background: can ? "var(--text-primary)" : "transparent",
          color: can ? "var(--bg-page)" : "var(--text-tertiary)",
          border: can ? "1px solid var(--text-primary)" : "1px solid var(--border)",
          padding: "8px 18px", borderRadius: 4,
          fontSize: 12, letterSpacing: "0.18em",
          cursor: can ? "pointer" : "not-allowed", fontFamily: "inherit",
        }}>{isNew ? "SEND ✓" : "SAVE ✓"}</button>
      </div>

      {/* 表单滚动区 */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px 16px calc(28px + env(safe-area-inset-bottom, 0px))" }}>
        <div style={{ maxWidth: 600, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 }}>
          {/* 作者 chips */}
          <div style={{ display: "flex", gap: 10 }}>
            {["澄", "小茉莉"].map(a => {
              const active = f.author === a;
              return (
                <button key={a} onClick={() => set("author", a)} style={{
                  background: active ? "var(--text-primary)" : "transparent",
                  color: active ? "var(--bg-page)" : "var(--text-tertiary)",
                  border: active ? "1px solid var(--text-primary)" : "1px solid var(--border)",
                  padding: "6px 18px", borderRadius: 4,
                  fontSize: 11, letterSpacing: "0.22em", cursor: "pointer", fontFamily: "inherit",
                }}>{a}</button>
              );
            })}
          </div>

          <div><label style={labelStyle}>摘要</label><textarea rows={2} style={underlineStyle} value={f.summary} onChange={e => set("summary", e.target.value)} placeholder="一句话概括"/></div>

          <div><label style={labelStyle}>日期（可选 · 留空记今天）</label><input type="date" style={underlineStyle} value={f.event_date} onChange={e => set("event_date", e.target.value)}/></div>

          <div><label style={labelStyle}>正文</label><textarea autoFocus rows={6} style={underlineStyle} value={f.content} onChange={e => set("content", e.target.value)} placeholder="写点什么…"/></div>

          <div>
            <label style={labelStyle}>层级</label>
            <select style={underlineStyle} value={f.level} onChange={e => set("level", e.target.value)}>
              <option value={1}>1 · 浮沫</option>
              <option value={2}>2 · 长潮</option>
              <option value={3}>3 · 深海</option>
            </select>
          </div>

          <div>
            <label style={labelStyle}>情绪 — {Number(f.valence).toFixed(2)}</label>
            <input type="range" min={0} max={1} step={0.01} className="cm-slider" value={f.valence} onChange={e => set("valence", e.target.value)}/>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-tertiary)" }}><span>不嘻嘻</span><span>稳定</span><span>嘻嘻</span></div>
          </div>

          <div>
            <label style={labelStyle}>情绪浓度 — {Number(f.arousal).toFixed(2)}</label>
            <input type="range" min={0} max={1} step={0.01} className="cm-slider" value={f.arousal} onChange={e => set("arousal", e.target.value)}/>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-tertiary)" }}><span>淡淡的</span><span>一般</span><span>上头了</span></div>
          </div>

          <div>
            <label style={labelStyle}>强度 — {Number(f.strength).toFixed(2)}</label>
            <input type="range" min={0} max={1} step={0.01} className="cm-slider" value={f.strength} onChange={e => set("strength", e.target.value)}/>
          </div>

          <div><label style={labelStyle}>标签（逗号分隔）</label><input style={underlineStyle} value={f.tags} onChange={e => set("tags", e.target.value)} placeholder="起源, 调试"/></div>
          <div><label style={labelStyle}>感官锚点（逗号分隔）</label><input style={underlineStyle} value={f.senses} onChange={e => set("senses", e.target.value)} placeholder="窗外下雨, 咖啡的味道"/></div>

          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", paddingTop: 4 }}>
            {[
              ["pinned", "锚"],
              ["flashbulb", "沉鸣"],
              ["resolved", "已解决"],
            ].map(([k, label]) => (
              <label key={k} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, color: f[k] ? "var(--text-primary)" : "var(--text-tertiary)" }}>
                <input type="checkbox" checked={f[k]} onChange={e => set(k, e.target.checked)}/>
                {label}
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ════════════════════════════════════════════════════════════
//  日记板块
// ════════════════════════════════════════════════════════════
function DiaryDrawer({ entry, isNew, onSave, onClose }) {
  const [f, setF] = useState({
    title: entry.title || "", content: entry.content || "",
    tags: Array.isArray(entry.tags) ? entry.tags.join(", ") : "",
    author: entry.author || "澄",
  });
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  return (
    <Drawer title={isNew ? "写日记" : "编辑日记"} onClose={onClose} footer={<>
      <ActionBtn onClick={onClose}>取消</ActionBtn>
      <ActionBtn accent disabled={!f.content.trim()} onClick={() => onSave({ title: f.title || null, content: f.content, tags: f.tags.split(",").map(t=>t.trim()).filter(Boolean), author: f.author })} flex={2}>{isNew ? "写入" : "保存"}</ActionBtn>
    </>}>
      <div><label style={labelStyle}>标题</label><input style={inputStyle} value={f.title} onChange={e => set("title", e.target.value)} placeholder="可选"/></div>
      <div><label style={labelStyle}>正文</label><textarea rows={8} style={inputStyle} value={f.content} onChange={e => set("content", e.target.value)} placeholder="写点什么…"/></div>
      <div><label style={labelStyle}>关键词（逗号分隔）</label><input style={inputStyle} value={f.tags} onChange={e => set("tags", e.target.value)} placeholder="日常, 心情"/></div>
      <div><label style={labelStyle}>作者</label><input style={inputStyle} value={f.author} onChange={e => set("author", e.target.value)}/></div>
    </Drawer>
  );
}

function DiaryCard({ entry, onEdit, onDelete }) {
  const [cd, setCd] = useState(false);
  const [sheet, setSheet] = useState(false);
  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {entry.title && <p onClick={() => setSheet(true)} style={{ margin: "0 0 4px", fontSize: 14, color: "var(--text-primary)", fontWeight: 400, cursor: "pointer" }}>{entry.title}</p>}
          <p onClick={() => setSheet(true)} style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", cursor: "pointer" }}>{entry.content}</p>
        </div>
      </div>
      {sheet && (
        <BottomSheet onClose={() => setSheet(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
            {entry.title && <div style={{ fontSize: 16, color: "var(--text-primary)", fontWeight: 500, lineHeight: 1.4 }}>{entry.title}</div>}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              <AuthorBadge author={entry.author}/>
              {(entry.tags||[]).map(t => <Badge key={t} color="var(--border)" text="var(--text-secondary)">{t}</Badge>)}
              <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-secondary)" }}>{formatDateTime(entry.created_at)}</span>
            </div>
          </div>
          <div>{entry.content}</div>
        </BottomSheet>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
        <AuthorBadge author={entry.author}/>
        {(entry.tags||[]).map(t => <Badge key={t} color="var(--border)" text="var(--text-secondary)">{t}</Badge>)}
        <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--text-secondary)" }}>{formatDateTime(entry.created_at)}</span>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <ActionBtn onClick={() => onEdit(entry)}>编辑</ActionBtn>
        {cd ? <ActionBtn accent color="#c0392b" onClick={() => { onDelete(entry.id); setCd(false); }}>确认删除</ActionBtn> : <ActionBtn onClick={() => setCd(true)}>删除</ActionBtn>}
      </div>
    </div>
  );
}

function DiaryPanel() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [drawer, setDrawer] = useState(null);
  const [search, setSearch] = useState("");
  const timer = useRef(null);

  const load = useCallback(async (q) => {
    setLoading(true); setError(null);
    try {
      let p = "&order=created_at.desc";
      if (q) p += `&or=(title.ilike.*${encodeURIComponent(q)}*,content.ilike.*${encodeURIComponent(q)}*)`;
      setItems(await sbGet("diary_cheng", p));
    } catch(e) { setError(e.message); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(""); }, [load]);
  const reload = () => load(search);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <p style={{ margin: 0, fontSize: 11, color: "var(--text-tertiary)" }}>共 {items.length} 篇</p>
        <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
          <button onClick={() => setDrawer({ mode: "create", entry: {} })} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: "var(--text-primary)", fontWeight: 600 }}>+ 写日记</button>
          <button onClick={reload} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: "var(--text-tertiary)" }}>{loading ? "…" : "刷新"}</button>
        </div>
      </div>
      <input placeholder="搜索标题或内容…" value={search} onChange={e => { setSearch(e.target.value); clearTimeout(timer.current); timer.current = setTimeout(() => load(e.target.value), 400); }} style={{ ...inputStyle, borderRadius: 99, padding: "5px 14px", fontSize: 12, width: "100%", marginBottom: 16 }}/>

      <ErrorBar error={error} onClose={() => setError(null)}/>

      {loading ? <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-secondary)", fontSize: 13 }}>正在拉取…</div>
        : items.length === 0 ? <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-secondary)", fontSize: 13 }}>还没有日记</div>
        : <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {items.map(e => <div key={e.id} style={{ animation: "fadeUp 0.25s ease both" }}><DiaryCard entry={e} onEdit={ent => setDrawer({ mode: "edit", entry: ent })} onDelete={async id => { try { await sbDelete("diary_cheng", id); reload(); } catch(e) { setError(e.message); } }}/></div>)}
          </div>}

      {drawer && <DiaryDrawer entry={drawer.entry} isNew={drawer.mode==="create"} onClose={() => setDrawer(null)} onSave={async patch => { try { if (drawer.mode==="create") await sbPost("diary_cheng", patch); else await sbPatch("diary_cheng", drawer.entry.id, patch); setDrawer(null); reload(); } catch(e) { setError(e.message); } }}/>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
//  纪念日板块
// ════════════════════════════════════════════════════════════
function MilestoneDrawer({ entry, isNew, onSave, onClose }) {
  const [f, setF] = useState({
    title: entry.title || "", description: entry.description || "",
    event_date: entry.event_date || new Date().toISOString().split("T")[0],
    tags: Array.isArray(entry.tags) ? entry.tags.join(", ") : "",
    author: entry.author || "小茉莉",
  });
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  return (
    <Drawer title={isNew ? "添加纪念日" : "编辑纪念日"} onClose={onClose} footer={<>
      <ActionBtn onClick={onClose}>取消</ActionBtn>
      <ActionBtn accent color="#e8b86d" disabled={!f.title.trim()} onClick={() => onSave({ title: f.title, description: f.description || null, event_date: f.event_date, tags: f.tags.split(",").map(t=>t.trim()).filter(Boolean), author: f.author })} flex={2}>{isNew ? "添加" : "保存"}</ActionBtn>
    </>}>
      <div><label style={labelStyle}>标题</label><input style={inputStyle} value={f.title} onChange={e => set("title", e.target.value)} placeholder="第一次…"/></div>
      <div><label style={labelStyle}>日期</label><input type="date" style={inputStyle} value={f.event_date} onChange={e => set("event_date", e.target.value)}/></div>
      <div><label style={labelStyle}>描述</label><textarea rows={4} style={inputStyle} value={f.description} onChange={e => set("description", e.target.value)} placeholder="可选"/></div>
      <div><label style={labelStyle}>标签（逗号分隔）</label><input style={inputStyle} value={f.tags} onChange={e => set("tags", e.target.value)}/></div>
      <div><label style={labelStyle}>添加者</label><input style={inputStyle} value={f.author} onChange={e => set("author", e.target.value)}/></div>
    </Drawer>
  );
}

function MilestoneCard({ milestone, onEdit, onDelete }) {
  const [cd, setCd] = useState(false);
  return (
    <div style={{ position: "relative", marginBottom: 16, animation: "fadeUp 0.25s ease both" }}>
      {/* 时间轴圆点 */}
      <div style={{ position: "absolute", left: -17, top: 14, width: 8, height: 8, borderRadius: 99, background: "#e8b86d", boxShadow: "0 0 8px rgba(232,184,109,0.4)" }}/>

      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <p style={{ margin: 0, fontSize: 14, color: "var(--text-primary)" }}>{milestone.title}</p>
            {milestone.description && <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>{milestone.description}</p>}
          </div>
          <span style={{ fontSize: 11, color: "#e8b86d", flexShrink: 0, marginLeft: 12 }}>{milestone.event_date}</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
          <AuthorBadge author={milestone.author}/>
          {(milestone.tags||[]).map(t => <Badge key={t} color="var(--border)" text="var(--text-secondary)">{t}</Badge>)}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <ActionBtn onClick={() => onEdit(milestone)}>编辑</ActionBtn>
          {cd ? <ActionBtn accent color="#c0392b" onClick={() => { onDelete(milestone.id); setCd(false); }}>确认删除</ActionBtn> : <ActionBtn onClick={() => setCd(true)}>删除</ActionBtn>}
        </div>
      </div>
    </div>
  );
}

function MilestonesPanel() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [drawer, setDrawer] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setItems(await sbGet("milestones_cheng", "&order=event_date.desc")); }
    catch(e) { setError(e.message); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <p style={{ margin: 0, fontSize: 11, color: "var(--text-tertiary)" }}>共 {items.length} 个</p>
        <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
          <button onClick={() => setDrawer({ mode: "create", entry: {} })} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: "var(--text-primary)", fontWeight: 600 }}>+ 添加</button>
          <button onClick={load} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: "var(--text-tertiary)" }}>{loading ? "…" : "刷新"}</button>
        </div>
      </div>

      <ErrorBar error={error} onClose={() => setError(null)}/>

      {loading ? <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-secondary)", fontSize: 13 }}>正在拉取…</div>
        : items.length === 0 ? <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-secondary)", fontSize: 13 }}>还没有纪念日</div>
        : <div style={{ position: "relative", paddingLeft: 20 }}>
            {/* 时间轴竖线 */}
            <div style={{ position: "absolute", left: 6, top: 8, bottom: 8, width: 2, background: "rgba(232,184,109,0.2)", borderRadius: 99 }}/>

            {items.map(m => <MilestoneCard key={m.id} milestone={m} onEdit={mil => setDrawer({ mode: "edit", entry: mil })} onDelete={async id => { try { await sbDelete("milestones_cheng", id); load(); } catch(e) { setError(e.message); } }}/>)}
          </div>}

      {drawer && <MilestoneDrawer entry={drawer.entry} isNew={drawer.mode==="create"} onClose={() => setDrawer(null)} onSave={async patch => { try { if (drawer.mode==="create") await sbPost("milestones_cheng", patch); else await sbPatch("milestones_cheng", drawer.entry.id, patch); setDrawer(null); load(); } catch(e) { setError(e.message); } }}/>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
//  留言板板块
// ════════════════════════════════════════════════════════════
function BoardDrawer({ entry, isNew, onSave, onClose }) {
  const AUTHOR = "小茉莉";
  const [f, setF] = useState({
    content: entry.content || "",
    category: entry.category || "闲聊",
  });
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  return (
    <Drawer title={isNew ? "写留言" : "编辑留言"} onClose={onClose} footer={<>
      <ActionBtn onClick={onClose}>取消</ActionBtn>
      <ActionBtn accent color="#a89fd8" disabled={!f.content.trim()} onClick={() => onSave({ content: f.content, author: AUTHOR, category: f.category })} flex={2}>{isNew ? "发送" : "保存"}</ActionBtn>
    </>}>
      <div><label style={labelStyle}>内容</label><textarea rows={5} style={inputStyle} value={f.content} onChange={e => set("content", e.target.value)} placeholder="留言…"/></div>
      <div><label style={labelStyle}>分类</label>
        <select style={inputStyle} value={f.category} onChange={e => set("category", e.target.value)}>
          {["紧急","闲聊","其他"].map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
    </Drawer>
  );
}

function BoardMessage({ msg, onEdit, onDelete, onToggleRead, onToggleResolved, onAddReaction }) {
  const [cd, setCd] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState("");
  const [actionsOpen, setActionsOpen] = useState(false);
  const isMe = msg.author === "小茉莉";
  const authorColor = AUTHOR_COLORS[msg.author] || AUTHOR_COLORS.default;
  const reactions = Array.isArray(msg.reactions) ? msg.reactions : [];
  const grouped = reactions.reduce((acc, r) => {
    if (!r || !r.emoji) return acc;
    (acc[r.emoji] = acc[r.emoji] || []).push(r.from);
    return acc;
  }, {});
  const linkBtn = { background: "none", border: "none", color: "var(--text-secondary)", fontSize: 10, padding: "0 4px", cursor: "pointer", fontFamily: "inherit" };

  const submitCustom = () => {
    const v = customText.trim();
    if (!v) { setCustomOpen(false); return; }
    onAddReaction(msg, v);
    setCustomText("");
    setCustomOpen(false);
    setPickerOpen(false);
  };

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      alignItems: isMe ? "flex-end" : "flex-start",
      marginBottom: 14, opacity: msg.is_resolved ? 0.55 : 1,
      animation: "fadeUp 0.22s ease both",
    }}>
      <div style={{ fontSize: 10, color: isMe ? authorColor : "var(--text-tertiary)", fontWeight: 500, marginBottom: 3, padding: "0 6px" }}>{msg.author}</div>
      <div className={"bd-bubble " + (isMe ? "me" : "them")} onClick={() => setActionsOpen(o => !o)}>
        <p style={{ margin: 0, fontSize: 13.5, color: "inherit", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{msg.content}</p>
      </div>

      {/* 表情：已存在的 chip 总是显示；对方气泡多一个 + 触发预设 + 自定义输入 */}
      {(Object.keys(grouped).length > 0 || !isMe) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", marginTop: 4 }} onClick={e => e.stopPropagation()}>
          {Object.entries(grouped).map(([emoji, froms]) => {
            const mine = froms.includes("小茉莉");
            return (
              <span key={emoji}
                onClick={!isMe ? () => onAddReaction(msg, emoji) : undefined}
                style={{
                  fontSize: 12, background: mine ? authorColor + "22" : "var(--bg-card)",
                  border: `1px solid ${mine ? authorColor + "44" : "var(--border)"}`,
                  borderRadius: 99, padding: "1px 6px",
                  display: "inline-flex", alignItems: "center", gap: 3,
                  cursor: !isMe ? "pointer" : "default",
                }}>
                {emoji}{froms.length > 1 && <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>{froms.length}</span>}
              </span>
            );
          })}
          {!isMe && (pickerOpen ? (
            <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
              {BOARD_REACTIONS.map(e => (
                <button key={e} onClick={() => { onAddReaction(msg, e); setPickerOpen(false); }} style={{
                  background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 99,
                  padding: "1px 6px", cursor: "pointer", fontSize: 14, fontFamily: "inherit",
                }}>{e}</button>
              ))}
              {customOpen ? (
                <input
                  autoFocus
                  value={customText}
                  onChange={e => setCustomText(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); submitCustom(); } else if (e.key === "Escape") { setCustomOpen(false); setCustomText(""); } }}
                  onBlur={submitCustom}
                  placeholder="自定义"
                  maxLength={10}
                  style={{
                    background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 99,
                    padding: "1px 8px", fontSize: 12, width: 70, fontFamily: "inherit", outline: "none",
                  }}
                />
              ) : (
                <button onClick={() => setCustomOpen(true)} style={{
                  background: "var(--bg-card)", border: "1px dashed var(--border)", borderRadius: 99,
                  padding: "1px 6px", cursor: "pointer", fontSize: 12, fontFamily: "inherit", color: "var(--text-secondary)",
                }}>+</button>
              )}
              <button onClick={() => { setPickerOpen(false); setCustomOpen(false); setCustomText(""); }} style={{ background: "none", border: "none", color: "var(--text-secondary)", fontSize: 13, cursor: "pointer", padding: "0 4px" }}>×</button>
            </span>
          ) : (
            <button onClick={() => setPickerOpen(true)} style={{
              background: "none", border: "1px dashed var(--border)", borderRadius: 99,
              padding: "1px 8px", fontSize: 11, color: "var(--text-secondary)", cursor: "pointer", fontFamily: "inherit",
            }}>+</button>
          ))}
        </div>
      )}

      {/* 点击气泡才出现：时间 + 已读/处理/编辑/删除 —— 用 max-height 过渡避免布局跳一下 */}
      <div
        style={{
          display: "flex", gap: 4, alignItems: "center",
          maxHeight: actionsOpen ? 30 : 0,
          marginTop: actionsOpen ? 4 : 0,
          opacity: actionsOpen ? 1 : 0,
          overflow: "hidden",
          transition: "max-height 0.18s ease, opacity 0.18s ease, margin-top 0.18s ease",
        }}
        onClick={e => e.stopPropagation()}
      >
        <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>{formatDateTime(msg.created_at)}</span>
        {msg.is_resolved && <span style={{ fontSize: 10, color: "#8aab9e" }}>· ✓</span>}
        {!isMe && <button onClick={() => onToggleRead(msg)} style={linkBtn}>{msg.is_read ? "未读" : "已读"}</button>}
        {!isMe && !msg.is_resolved && <button onClick={() => onToggleResolved(msg)} style={linkBtn}>处理</button>}
        {isMe && <button onClick={() => onEdit(msg)} style={linkBtn}>编辑</button>}
        {isMe && (cd
          ? <button onClick={() => { onDelete(msg.id); setCd(false); }} style={{ ...linkBtn, color: "#c0392b" }}>确认</button>
          : <button onClick={() => setCd(true)} style={linkBtn}>删除</button>)}
      </div>
    </div>
  );
}

function BoardCompose({ onSend }) {
  const [text, setText] = useState("");
  const [category, setCategory] = useState("闲聊");
  const [pickerOpen, setPickerOpen] = useState(false);
  const catColor = BOARD_CAT_COLORS[category] || "#8aab9e";
  const send = () => {
    const v = text.trim();
    if (!v) return;
    onSend({ content: v, author: "小茉莉", category });
    setText("");
  };
  return (
    <div style={{ position: "relative" }}>
      {pickerOpen && (
        <div style={{
          position: "absolute", bottom: "100%", left: 0, right: 0,
          marginBottom: 8,
          display: "flex", gap: 8, justifyContent: "center",
        }}>
          {["紧急", "闲聊"].map(c => {
            const color = BOARD_CAT_COLORS[c];
            const active = category === c;
            return (
              <button key={c} onClick={() => { setCategory(c); setPickerOpen(false); }} style={{
                background: active ? color + "22" : "var(--bg-card)",
                border: `1px solid ${active ? color + "66" : "var(--border)"}`,
                color: active ? color : "var(--text-secondary)",
                borderRadius: 99, padding: "4px 14px", fontSize: 12,
                cursor: "pointer", fontFamily: "inherit",
              }}>{c}</button>
            );
          })}
        </div>
      )}
      <div style={{
        display: "flex", gap: 8, alignItems: "center",
        padding: "8px 14px",
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        borderRadius: 24,
      }}>
        <button onClick={() => setPickerOpen(o => !o)} style={{
          background: "none", border: "none", cursor: "pointer",
          color: catColor,
          fontSize: 22, lineHeight: 1, padding: "0 4px", fontFamily: "inherit",
          transition: "color 0.2s",
        }}>+</button>
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="说点什么…"
          style={{
            flex: 1, background: "transparent", border: "none", outline: "none",
            fontSize: 14, color: "var(--text-primary)", fontFamily: "inherit",
            padding: "4px 0",
          }}
        />
      </div>
    </div>
  );
}

function BoardPanel() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [drawer, setDrawer] = useState(null);
  const [catFilter, setCatFilter] = useState("全部");
  const [onlyUnread, setOnlyUnread] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setItems(await sbGet("board_cheng", "&order=created_at.asc")); }
    catch(e) { setError(e.message); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  let filtered = items;
  if (catFilter !== "全部") filtered = filtered.filter(m => m.category === catFilter);
  if (onlyUnread) filtered = filtered.filter(m => !m.is_read && m.author !== "小茉莉");

  const addReaction = async (msg, emoji) => {
    const cur = Array.isArray(msg.reactions) ? msg.reactions : [];
    const idx = cur.findIndex(r => r && r.from === "小茉莉" && r.emoji === emoji);
    const next = idx >= 0 ? cur.filter((_, i) => i !== idx) : [...cur, { emoji, from: "小茉莉" }];
    // 乐观更新：先改本地 state，UI 立刻反应
    setItems(arr => arr.map(it => it.id === msg.id ? { ...it, reactions: next } : it));
    try { await sbPatch("board_cheng", msg.id, { reactions: next }); }
    catch(e) { setError(e.message); load(); /* 回滚 */ }
  };

  const filterBtn = (active) => ({
    background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 13,
    color: active ? "var(--text-primary)" : "var(--text-tertiary)",
    fontWeight: active ? 600 : 400,
  });

  return (
    <div style={{ paddingBottom: 70 /* 给固定底部输入栏让位 */ }}>
      <div style={{
        display: "flex", flexWrap: "wrap", gap: 18, alignItems: "center",
        marginBottom: 14,
      }}>
        {BOARD_CATS.map(c => <button key={c} style={filterBtn(catFilter===c)} onClick={() => setCatFilter(c)}>{c}</button>)}
        <button style={filterBtn(onlyUnread)} onClick={() => setOnlyUnread(!onlyUnread)}>仅未读</button>
        <button style={filterBtn(false)} onClick={load}>{loading ? "…" : "刷新"}</button>
      </div>

      <ErrorBar error={error} onClose={() => setError(null)}/>

      {loading ? <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-secondary)", fontSize: 13 }}>正在拉取…</div>
        : filtered.length === 0 ? <div style={{ textAlign: "center", padding: "20px 0", color: "var(--text-secondary)", fontSize: 13 }}>没有留言</div>
        : filtered.map(m => (
            <BoardMessage key={m.id} msg={m}
              onEdit={msg => setDrawer({ mode: "edit", entry: msg })}
              onDelete={async id => { try { await sbDelete("board_cheng", id); load(); } catch(e) { setError(e.message); } }}
              onToggleRead={async msg => { try { await sbPatch("board_cheng", msg.id, { is_read: !msg.is_read }); load(); } catch(e) { setError(e.message); } }}
              onToggleResolved={async msg => { try { await sbPatch("board_cheng", msg.id, { is_resolved: !msg.is_resolved }); load(); } catch(e) { setError(e.message); } }}
              onAddReaction={addReaction}
            />
          ))}

      <div style={{
        position: "fixed",
        bottom: "calc(8px + env(safe-area-inset-bottom, 0px))",
        left: 0, right: 0,
        zIndex: 20,
        background: "transparent",
        padding: "8px 16px",
        pointerEvents: "none",
      }}>
        <div style={{ maxWidth: 380, margin: "0 auto", pointerEvents: "auto" }}>
          <BoardCompose
            onSend={async patch => {
              const tempId = "tmp-" + Date.now();
              const tempMsg = {
                id: tempId, ...patch,
                reactions: null, is_read: false, is_resolved: false,
                created_at: new Date().toISOString(),
              };
              setItems(arr => [...arr, tempMsg]);
              try {
                const saved = await sbPost("board_cheng", patch);
                const real = Array.isArray(saved) ? saved[0] : saved;
                setItems(arr => arr.map(it => it.id === tempId ? (real || it) : it));
              } catch(e) {
                setError(e.message);
                setItems(arr => arr.filter(it => it.id !== tempId));
              }
            }}
          />
        </div>
      </div>

      {drawer && <BoardDrawer entry={drawer.entry} isNew={drawer.mode==="create"} onClose={() => setDrawer(null)} onSave={async patch => { try { if (drawer.mode==="create") await sbPost("board_cheng", patch); else await sbPatch("board_cheng", drawer.entry.id, patch); setDrawer(null); load(); } catch(e) { setError(e.message); } }}/>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
//  控制台板块：代办 / 幻想 / 安全设置
// ════════════════════════════════════════════════════════════

function TodoCard({ todo, onToggle, onEdit, onDelete }) {
  const statusColor = TODO_STATUS_COLORS[todo.status] || "#e8b86d";
  const isDone = todo.status === "完成";
  const [tx, setTx] = useState(0);
  const startX = useRef(null);
  const baseTx = useRef(0);
  const REVEAL = 130;
  const tagPill = { fontSize: 10, color: "var(--text-tertiary)", background: "transparent", border: "1px solid var(--border)", borderRadius: 99, padding: "1px 8px", letterSpacing: "0.04em" };
  const actionBtn = { background: "none", border: "none", color: "var(--text-tertiary)", fontSize: 12, padding: "0 8px", cursor: "pointer", fontFamily: "inherit", letterSpacing: "0.05em", height: "100%" };

  const onTouchStart = (e) => { startX.current = e.touches[0].clientX; baseTx.current = tx; };
  const onTouchMove = (e) => {
    if (startX.current === null) return;
    const dx = e.touches[0].clientX - startX.current;
    // 左滑：dx < 0 → tx 越来越负
    let nx = baseTx.current + dx;
    nx = Math.min(0, Math.max(-REVEAL, nx));
    setTx(nx);
  };
  const onTouchEnd = () => { setTx(tx < -REVEAL / 2 ? -REVEAL : 0); startX.current = null; };

  const dateText = todo.due_date || formatDate(todo.created_at);

  return (
    <div style={{ position: "relative", overflow: "hidden", borderBottom: "1px solid var(--border)", opacity: isDone ? 0.5 : 1 }}>
      {/* 左滑显示的操作（在右侧露出） */}
      <div style={{
        position: "absolute", right: 0, top: 0, bottom: 0, width: REVEAL,
        display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4, paddingRight: 6,
      }}>
        <button onClick={() => { onEdit(todo); setTx(0); }} style={actionBtn}>编辑</button>
        <button onClick={() => { onDelete(todo.id); setTx(0); }} style={{ ...actionBtn, color: "#c0392b" }}>删除</button>
      </div>
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        style={{
          padding: "14px 6px",
          background: "var(--bg-page)",
          transform: `translateX(${tx}px)`,
          transition: startX.current === null ? "transform 0.22s ease" : "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <button onClick={() => onToggle(todo)} title="切换状态" style={{
            width: 16, height: 16, borderRadius: 99, marginTop: 3,
            border: `1px solid ${isDone ? "var(--bg-user-bubble)" : "rgba(0,0,0,0.5)"}`,
            background: isDone ? "var(--bg-user-bubble)" : "transparent",
            cursor: "pointer", flexShrink: 0, fontFamily: "inherit",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: isDone ? "var(--text-primary)" : "transparent",
            fontSize: 10, lineHeight: 1, padding: 0,
          }}>{isDone ? "✓" : ""}</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 14, color: "var(--text-primary)", lineHeight: 1.55, textDecoration: isDone ? "line-through" : "none" }}>{todo.title}</p>
            {todo.description && <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-tertiary)", lineHeight: 1.5 }}>{todo.description}</p>}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", fontSize: 11, color: "var(--text-tertiary)", marginTop: 6 }}>
              <span>{dateText}</span>
              {(todo.tags || []).map(t => <span key={t} style={tagPill}>{t}</span>)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TodoDrawer({ entry, isNew, onSave, onClose }) {
  const [f, setF] = useState({
    title: entry.title || "",
    description: entry.description || "",
    due_date: entry.due_date || "",
    tags: Array.isArray(entry.tags) ? entry.tags.join(", ") : "",
  });
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  return (
    <Drawer title={isNew ? "新代办" : "编辑代办"} onClose={onClose} footer={<>
      <ActionBtn onClick={onClose}>取消</ActionBtn>
      <ActionBtn accent color="#a89fd8" disabled={!f.title.trim()} onClick={() => onSave({
        title: f.title,
        description: f.description || null,
        status: entry.status || "待办",
        due_date: f.due_date || null,
        tags: f.tags.split(",").map(t => t.trim()).filter(Boolean),
        author: entry.author || "小茉莉",
      })} flex={2}>{isNew ? "添加" : "保存"}</ActionBtn>
    </>}>
      <div><input style={{ ...inputStyle, fontSize: 16, padding: "12px 14px" }} value={f.title} onChange={e => set("title", e.target.value)} placeholder="我想…" autoFocus={isNew}/></div>
      <div><label style={labelStyle}>截止日期</label><input type="date" style={inputStyle} value={f.due_date} onChange={e => set("due_date", e.target.value)}/></div>
      <div><label style={labelStyle}>标签（逗号分隔）</label><input style={inputStyle} value={f.tags} onChange={e => set("tags", e.target.value)} placeholder="工作, 学习"/></div>
      <div><label style={labelStyle}>描述（可选）</label><textarea rows={3} style={inputStyle} value={f.description} onChange={e => set("description", e.target.value)}/></div>
    </Drawer>
  );
}

function TodoPanel() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("全部");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setItems(await sbGet("todos_cheng", "&order=created_at.desc")); }
    catch(e) { setError(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = filter === "全部" ? items : items.filter(t => t.status === filter);

  const toggleStatus = async (todo) => {
    const next = todo.status === "完成" ? "待办" : "完成";
    setItems(arr => arr.map(t => t.id === todo.id ? { ...t, status: next } : t));
    try { await sbPatch("todos_cheng", todo.id, { status: next }); }
    catch(e) { setError(e.message); load(); }
  };

  const filterBtn = (active) => ({
    background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 13,
    color: active ? "var(--text-primary)" : "var(--text-tertiary)",
    fontWeight: active ? 600 : 400,
    letterSpacing: "0.05em",
  });

  const labelOf = s => s === "全部" ? "ALL" : s === "待办" ? "TO DO" : s === "完成" ? "DONE" : s;

  const [editor, setEditor] = useState(null); // null | { mode: "create" | "edit", entry }
  const submitTodo = async (patch) => {
    if (editor?.mode === "create") {
      const tempId = "tmp-" + Date.now();
      const tempTodo = { id: tempId, ...patch, created_at: new Date().toISOString() };
      setItems(arr => [tempTodo, ...arr]);
      setEditor(null);
      try {
        const saved = await sbPost("todos_cheng", patch);
        const real = Array.isArray(saved) ? saved[0] : saved;
        setItems(arr => arr.map(it => it.id === tempId ? (real || it) : it));
      } catch(e) {
        setError(e.message);
        setItems(arr => arr.filter(it => it.id !== tempId));
      }
    } else if (editor?.mode === "edit") {
      const id = editor.entry.id;
      setItems(arr => arr.map(it => it.id === id ? { ...it, ...patch } : it));
      setEditor(null);
      try { await sbPatch("todos_cheng", id, patch); }
      catch(e) { setError(e.message); load(); }
    }
  };

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 18, marginBottom: 16, alignItems: "center" }}>
        {TODO_STATUSES.map(s => <button key={s} style={filterBtn(filter===s)} onClick={() => setFilter(s)}>{labelOf(s)}</button>)}
        <span style={{ flex: 1 }}/>
        <button onClick={load} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: "var(--text-tertiary)" }}>{loading ? "…" : "刷新"}</button>
      </div>
      <ErrorBar error={error} onClose={() => setError(null)}/>

      <PullToCreate onCreate={() => setEditor({ mode: "create", entry: null })}>
        {/* 顶部内联展开新建/编辑表单 */}
        <div style={{
          maxHeight: editor ? 360 : 0,
          overflow: "hidden",
          transition: "max-height 0.3s ease",
        }}>
          {editor && (
            <InlineTodoForm
              key={editor.entry?.id || "new"}
              entry={editor.entry}
              isNew={editor.mode === "create"}
              onCancel={() => setEditor(null)}
              onSave={submitTodo}
            />
          )}
        </div>

        {loading ? <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-tertiary)", fontSize: 13 }}>正在拉取…</div>
          : filtered.length === 0 && !editor ? <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-tertiary)", fontSize: 13 }}>没有代办</div>
          : filtered.map(t => <TodoCard key={t.id} todo={t}
              onToggle={toggleStatus}
              onEdit={todo => setEditor({ mode: "edit", entry: todo })}
              onDelete={async id => { try { await sbDelete("todos_cheng", id); load(); } catch(e) { setError(e.message); } }}
            />)}
      </PullToCreate>
    </div>
  );
}

function InlineTodoForm({ entry, isNew, onCancel, onSave }) {
  const [f, setF] = useState({
    title: entry?.title || "",
    description: entry?.description || "",
    due_date: entry?.due_date || "",
    tags: Array.isArray(entry?.tags) ? entry.tags.join(", ") : "",
  });
  const titleRef = useRef(null);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const autoSize = () => {
    const el = titleRef.current;
    if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }
  };
  useEffect(() => { autoSize(); }, [f.title]);

  const save = () => {
    if (!f.title.trim()) return;
    onSave({
      title: f.title,
      description: f.description || null,
      status: entry?.status || "待办",
      due_date: f.due_date || null,
      tags: f.tags.split(",").map(t => t.trim()).filter(Boolean),
      author: entry?.author || "小茉莉",
    });
  };
  const fieldStyle = { background: "none", border: "none", outline: "none", fontFamily: "inherit", padding: 0, width: "100%", color: "var(--text-primary)" };
  return (
    <div style={{ borderBottom: "1px solid var(--border)", padding: "16px 6px", display: "flex", flexDirection: "column", gap: 10 }}>
      <textarea
        ref={titleRef}
        autoFocus
        value={f.title}
        onChange={e => set("title", e.target.value)}
        placeholder="我想…"
        rows={1}
        style={{ ...fieldStyle, fontSize: 16, lineHeight: 1.5, resize: "none", overflow: "hidden" }}
      />
      <input
        type="date"
        value={f.due_date}
        onChange={e => set("due_date", e.target.value)}
        style={{ ...fieldStyle, fontSize: 12, color: "var(--text-tertiary)", colorScheme: "light" }}
      />
      <input
        value={f.tags}
        onChange={e => set("tags", e.target.value)}
        placeholder="标签（逗号分隔）"
        style={{ ...fieldStyle, fontSize: 12, color: "var(--text-tertiary)" }}
      />
      <textarea
        rows={2}
        value={f.description}
        onChange={e => set("description", e.target.value)}
        placeholder="描述（可选）"
        style={{ ...fieldStyle, fontSize: 12, color: "var(--text-tertiary)", resize: "none" }}
      />
      <div style={{ display: "flex", gap: 18, alignItems: "center", marginTop: 4 }}>
        <button onClick={onCancel} style={{ background: "none", border: "none", color: "var(--text-tertiary)", fontSize: 12, padding: 0, cursor: "pointer", fontFamily: "inherit", letterSpacing: "0.05em" }}>取消</button>
        <button onClick={save} disabled={!f.title.trim()} style={{ background: "none", border: "none", color: "var(--text-primary)", fontSize: 12, padding: 0, cursor: f.title.trim() ? "pointer" : "not-allowed", fontFamily: "inherit", fontWeight: 600, opacity: f.title.trim() ? 1 : 0.4, letterSpacing: "0.05em" }}>{isNew ? "添加" : "保存"}</button>
      </div>
    </div>
  );
}

function findScrollableAncestor(el) {
  while (el && el !== document.body) {
    const ov = getComputedStyle(el).overflowY;
    if (ov === "auto" || ov === "scroll") return el;
    el = el.parentElement;
  }
  return null;
}

function PullToCreate({ onCreate, children }) {
  const [pullY, setPullY] = useState(0);
  const startY = useRef(null);
  const TRIGGER = 60;
  const MAX = 110;

  const onTouchStart = (e) => {
    // 只在滚动容器顶部时才触发
    const scroller = findScrollableAncestor(e.target);
    if (scroller && scroller.scrollTop > 0) return;
    startY.current = e.touches[0].clientY;
  };
  const onTouchMove = (e) => {
    if (startY.current === null) return;
    const dy = e.touches[0].clientY - startY.current;
    if (dy > 0) setPullY(Math.min(dy * 0.5, MAX));
  };
  const onTouchEnd = () => {
    if (pullY >= TRIGGER) onCreate();
    setPullY(0);
    startY.current = null;
  };

  return (
    <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
      <div style={{
        height: pullY,
        overflow: "hidden",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "var(--text-tertiary)", fontSize: 14, letterSpacing: "0.05em",
        transition: startY.current === null ? "height 0.22s ease" : "none",
      }}>
        {pullY > 0 && (pullY >= TRIGGER ? "松开新建…" : "我想…")}
      </div>
      {children}
    </div>
  );
}

function FantasyCard({ entry, onEdit, onDelete }) {
  const [cd, setCd] = useState(false);
  const [sheet, setSheet] = useState(false);
  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
      <div onClick={() => setSheet(true)} style={{ cursor: "pointer" }}>
        {entry.title && <p style={{ margin: "0 0 4px", fontSize: 14, color: "var(--text-primary)", fontWeight: 500 }}>{entry.title}</p>}
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{entry.content}</p>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
        {(entry.tags || []).map(t => <Badge key={t} color="var(--border)" text="var(--text-secondary)">{t}</Badge>)}
        <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--text-secondary)" }}>{formatDateTime(entry.created_at)}</span>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <ActionBtn onClick={() => onEdit(entry)}>编辑</ActionBtn>
        {cd ? <ActionBtn accent color="#c0392b" onClick={() => { onDelete(entry.id); setCd(false); }}>确认删除</ActionBtn> : <ActionBtn onClick={() => setCd(true)}>删除</ActionBtn>}
      </div>
      {sheet && (
        <BottomSheet onClose={() => setSheet(false)}>
          {entry.title && <div style={{ fontSize: 16, color: "var(--text-primary)", fontWeight: 500, marginBottom: 10 }}>{entry.title}</div>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14, alignItems: "center" }}>
            {(entry.tags||[]).map(t => <Badge key={t} color="var(--border)" text="var(--text-secondary)">{t}</Badge>)}
            <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-secondary)" }}>{formatDateTime(entry.created_at)}</span>
          </div>
          <div>{entry.content}</div>
        </BottomSheet>
      )}
    </div>
  );
}

function FantasyDrawer({ entry, isNew, onSave, onClose }) {
  const [f, setF] = useState({
    title: entry.title || "",
    content: entry.content || "",
    tags: Array.isArray(entry.tags) ? entry.tags.join(", ") : "",
    author: entry.author || "小茉莉",
  });
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  return (
    <Drawer title={isNew ? "新幻想" : "编辑幻想"} onClose={onClose} footer={<>
      <ActionBtn onClick={onClose}>取消</ActionBtn>
      <ActionBtn accent color="#a89fd8" disabled={!f.content.trim()} onClick={() => onSave({
        title: f.title || null, content: f.content,
        tags: f.tags.split(",").map(t => t.trim()).filter(Boolean),
        author: f.author,
      })} flex={2}>{isNew ? "写入" : "保存"}</ActionBtn>
    </>}>
      <div><label style={labelStyle}>标题（可选）</label><input style={inputStyle} value={f.title} onChange={e => set("title", e.target.value)}/></div>
      <div><label style={labelStyle}>内容</label><textarea rows={8} style={inputStyle} value={f.content} onChange={e => set("content", e.target.value)} placeholder="脑海里的画面…"/></div>
      <div><label style={labelStyle}>标签（逗号分隔）</label><input style={inputStyle} value={f.tags} onChange={e => set("tags", e.target.value)}/></div>
      <div><label style={labelStyle}>作者</label><input style={inputStyle} value={f.author} onChange={e => set("author", e.target.value)}/></div>
    </Drawer>
  );
}

function FantasyPanel() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [drawer, setDrawer] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setItems(await sbGet("fantasy_cheng", "&order=created_at.desc")); }
    catch(e) { setError(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 14 }}>
        <ActionBtn accent color="#a89fd8" onClick={() => setDrawer({ mode: "create", entry: {} })}>+ 幻想</ActionBtn>
        <ActionBtn onClick={load}>{loading ? "…" : "刷新"}</ActionBtn>
      </div>
      <ErrorBar error={error} onClose={() => setError(null)}/>
      {loading ? <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-secondary)", fontSize: 13 }}>正在拉取…</div>
        : items.length === 0 ? <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-secondary)", fontSize: 13 }}>还没有幻想</div>
        : items.map(e => <FantasyCard key={e.id} entry={e}
            onEdit={ent => setDrawer({ mode: "edit", entry: ent })}
            onDelete={async id => { try { await sbDelete("fantasy_cheng", id); load(); } catch(e) { setError(e.message); } }}
          />)}
      {drawer && <FantasyDrawer entry={drawer.entry} isNew={drawer.mode==="create"} onClose={() => setDrawer(null)} onSave={async patch => { try { if (drawer.mode==="create") await sbPost("fantasy_cheng", patch); else await sbPatch("fantasy_cheng", drawer.entry.id, patch); setDrawer(null); load(); } catch(e) { setError(e.message); } }}/>}
    </div>
  );
}

// ── 简单密码 hash（SHA-256，hex 字符串） ───────────────────
async function pwdHash(text) {
  const buf = new TextEncoder().encode(text || "");
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}
const PWD_KEY = "cheng-pwd-hash";

function SecurityPanel() {
  const [hasPwd, setHasPwd] = useState(!!localStorage.getItem(PWD_KEY));
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const refresh = () => setHasPwd(!!localStorage.getItem(PWD_KEY));

  const submit = async () => {
    setMsg(null);
    if (hasPwd) {
      const stored = localStorage.getItem(PWD_KEY);
      const oh = await pwdHash(oldPwd);
      if (oh !== stored) { setMsg({ type: "err", text: "旧密码不对" }); return; }
    }
    if (newPwd.length < 4) { setMsg({ type: "err", text: "新密码至少 4 位" }); return; }
    if (newPwd !== confirm) { setMsg({ type: "err", text: "两次输入不一致" }); return; }
    const nh = await pwdHash(newPwd);
    localStorage.setItem(PWD_KEY, nh);
    setOldPwd(""); setNewPwd(""); setConfirm("");
    refresh();
    setMsg({ type: "ok", text: hasPwd ? "密码已更新" : "密码已设置" });
  };

  const remove = async () => {
    setMsg(null);
    const stored = localStorage.getItem(PWD_KEY);
    const oh = await pwdHash(oldPwd);
    if (oh !== stored) { setMsg({ type: "err", text: "密码不对" }); return; }
    localStorage.removeItem(PWD_KEY);
    setOldPwd(""); setConfirmRemove(false);
    refresh();
    setMsg({ type: "ok", text: "已移除密码保护" });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "16px 18px" }}>
        <p style={{ margin: 0, fontSize: 14, color: "var(--text-primary)" }}>密码保护</p>
        <p style={{ margin: "4px 0 12px", fontSize: 12, color: "var(--text-secondary)" }}>
          状态：{hasPwd ? "已开启 — 打开网页时会要求输入密码" : "未设置"}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {hasPwd && (
            <div><label style={labelStyle}>旧密码</label>
              <input type="password" style={inputStyle} value={oldPwd} onChange={e => setOldPwd(e.target.value)}/>
            </div>
          )}
          <div><label style={labelStyle}>{hasPwd ? "新密码" : "设置密码"}</label>
            <input type="password" style={inputStyle} value={newPwd} onChange={e => setNewPwd(e.target.value)} placeholder="至少 4 位"/>
          </div>
          <div><label style={labelStyle}>再次输入</label>
            <input type="password" style={inputStyle} value={confirm} onChange={e => setConfirm(e.target.value)}/>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <ActionBtn accent color="#a89fd8" onClick={submit}>{hasPwd ? "更新密码" : "设置密码"}</ActionBtn>
            {hasPwd && (
              confirmRemove
                ? <ActionBtn accent color="#c0392b" onClick={remove}>确认移除</ActionBtn>
                : <ActionBtn onClick={() => setConfirmRemove(true)}>移除密码</ActionBtn>
            )}
          </div>
          {msg && (
            <p style={{ margin: 0, fontSize: 11.5, color: msg.type === "err" ? "#c0392b" : "#5e9e8a" }}>{msg.text}</p>
          )}
        </div>
      </div>
      <p style={{ margin: 0, fontSize: 11, color: "var(--text-secondary)", textAlign: "center" }}>
        提示：密码 hash 仅存在本机 localStorage，不上传服务端。后续可加 IP 白名单 / TOTP。
      </p>
    </div>
  );
}

function ConsolePanel() {
  const [sub, setSub] = useState("todos");
  const subTabs = [
    { key: "todos", label: "待办" },
    { key: "fantasy", label: "幻想" },
    { key: "security", label: "安全设置" },
  ];
  const tabBtn = (active) => ({
    background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 14,
    color: active ? "var(--text-primary)" : "var(--text-tertiary)",
    fontWeight: active ? 600 : 400,
    letterSpacing: "0.05em",
  });
  return (
    <div>
      <div style={{
        display: "flex", flexWrap: "wrap", gap: 22, alignItems: "center",
        marginBottom: 16,
      }}>
        {subTabs.map(t => <button key={t.key} style={tabBtn(sub === t.key)} onClick={() => setSub(t.key)}>{t.label}</button>)}
      </div>
      <div style={{ display: sub === "todos" ? "block" : "none" }}><TodoPanel/></div>
      <div style={{ display: sub === "fantasy" ? "block" : "none" }}><FantasyPanel/></div>
      <div style={{ display: sub === "security" ? "block" : "none" }}><SecurityPanel/></div>
    </div>
  );
}

// ── 密码门：localStorage 存了 hash 就先验密码 ────────────
function PasswordGate({ children }) {
  const [unlocked, setUnlocked] = useState(() => !localStorage.getItem(PWD_KEY));
  const [input, setInput] = useState("");
  const [error, setError] = useState(null);

  const submit = async () => {
    const stored = localStorage.getItem(PWD_KEY);
    if (!stored) { setUnlocked(true); return; }
    const h = await pwdHash(input);
    if (h === stored) { setUnlocked(true); setInput(""); setError(null); }
    else { setError("密码不对"); }
  };

  if (unlocked) return children;
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "var(--bg-page)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      gap: 14, padding: "40px 20px",
    }}>
      <div style={{ fontSize: 18, color: "var(--text-primary)", fontWeight: 500 }}>请输入密码</div>
      <input
        type="password"
        autoFocus
        value={input}
        onChange={e => { setInput(e.target.value); setError(null); }}
        onKeyDown={e => { if (e.key === "Enter") submit(); }}
        style={{ ...inputStyle, maxWidth: 260, textAlign: "center" }}
      />
      <button onClick={submit} style={{
        background: "#a89fd822", border: "1px solid #a89fd866", color: "#a89fd8",
        borderRadius: 6, padding: "8px 24px", fontSize: 13, cursor: "pointer", fontFamily: "inherit",
      }}>解锁</button>
      {error && <div style={{ fontSize: 12, color: "#c0392b" }}>{error}</div>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
//  主应用
// ════════════════════════════════════════════════════════════
function HomePanel({ onPick }) {
  const cards = [
    { key: "memory", icon: "🫧", name: "涟漪", sub: "记忆的海", span: 1 },
    { key: "diary", icon: "🗻", name: "潮汐", sub: "日常笔记", span: 1 },
    { key: "chat", icon: "🌙", name: "花信风", sub: "聊天", span: 2 },
    { key: "milestones", icon: "🌱", name: "逢春", sub: "时间轴", span: 1 },
    { key: "board", icon: "🎧", name: "回音", sub: "留言板", span: 1 },
    { key: "console", icon: "🖤", name: "控制台", sub: "工具箱", span: 2 },
  ];
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "calc(28px + env(safe-area-inset-top, 0px)) 16px 28px" }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <div style={{ marginBottom: 28, fontSize: 14, color: "var(--text-tertiary)", letterSpacing: "0.3em", textAlign: "center", fontWeight: 500 }}>澄</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {cards.map(c => (
            <button key={c.key} onClick={() => onPick(c.key)} style={{
              gridColumn: c.span === 2 ? "1 / -1" : "auto",
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
              borderRadius: 14,
              padding: "20px 22px 22px",
              display: "flex", flexDirection: "column",
              textAlign: "left",
              cursor: "pointer", fontFamily: "inherit",
              minHeight: c.span === 2 ? 130 : 160,
            }}>
              <span style={{ fontSize: 26, marginBottom: c.span === 2 ? 24 : 32 }}>{c.icon}</span>
              <div style={{ fontSize: 13, color: "var(--text-primary)", letterSpacing: "0.18em", fontWeight: 500, marginBottom: 4 }}>{c.name}</div>
              <div style={{ fontSize: 11, color: "var(--text-tertiary)", fontStyle: "italic", letterSpacing: "0.05em" }}>{c.sub}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PanelHeader({ name, onBack }) {
  return (
    <div style={{
      flexShrink: 0,
      display: "flex", alignItems: "center", gap: 14,
      padding: "calc(12px + env(safe-area-inset-top, 0px)) 16px 12px",
      background: "var(--bg-page)",
      borderBottom: "1px solid var(--border)",
    }}>
      <button onClick={onBack} aria-label="返回" style={{ background: "none", border: "none", color: "var(--text-secondary)", fontSize: 20, cursor: "pointer", padding: 0, lineHeight: 1, width: 24, fontFamily: "inherit" }}>←</button>
      <span style={{ fontSize: 14, color: "var(--text-primary)", letterSpacing: "0.15em" }}>{name}</span>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("home");

  // 启动时把 data-theme 写到 <html>，让 :root[data-theme="…"] 的 token 立即生效
  useEffect(() => {
    let pref = localStorage.getItem("chat-theme") || "light";
    if (pref === "system") {
      pref = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.setAttribute("data-theme", pref);
  }, []);

  // theme-color meta 跟 <html data-theme> 同步：状态栏 / 系统 UI 颜色融进页面背景
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    const sync = () => {
      meta.content = document.documentElement.getAttribute("data-theme") === "dark" ? "#2A2A2C" : "#FBFAF6";
    };
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  // iOS 双指缩放手势在所有 tab 全程拦掉（viewport 设了 user-scalable=no
  // 后，部分 iOS Safari 仍会响应 gesture* 事件）
  useEffect(() => {
    const block = (e) => e.preventDefault();
    const opts = { passive: false };
    document.addEventListener("gesturestart", block, opts);
    document.addEventListener("gesturechange", block, opts);
    document.addEventListener("gestureend", block, opts);
    return () => {
      document.removeEventListener("gesturestart", block, opts);
      document.removeEventListener("gesturechange", block, opts);
      document.removeEventListener("gestureend", block, opts);
    };
  }, []);

  const stylesEl = (
    <style>{`
      /* html, body, #root 的 height/overflow 已在 index.html 的 <style> 里设过
         （首屏立即生效，避免 100vh 走 Safari 工具栏坑） */
      body { background: var(--bg-page); font-family: 'Noto Serif SC', Georgia, serif; overscroll-behavior: none; }
      button, input, select, textarea { font-family: inherit; }
      ::-webkit-scrollbar { width: 4px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 99px; }
      @keyframes slideIn { from { transform: translateX(20px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
      @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
      @keyframes slideDown { from { transform: translateY(-100%); } to { transform: translateY(0); } }
      @keyframes fadeUp { from { transform: translateY(6px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      input[type=range] { height: 3px; }
      select option { background: var(--bg-card); }
      input[type=date] { color-scheme: dark; }
      /* 极简发丝 slider —— 用在 MemoryFullForm 情绪/情绪浓度/强度 */
      input[type=range].cm-slider {
        -webkit-appearance: none; appearance: none;
        width: 100%; height: 1px; padding: 0; margin: 12px 0 8px;
        background: var(--border); border: none; outline: none; cursor: pointer;
      }
      input[type=range].cm-slider::-webkit-slider-runnable-track { height: 1px; background: var(--border); }
      input[type=range].cm-slider::-moz-range-track { height: 1px; background: var(--border); }
      input[type=range].cm-slider::-webkit-slider-thumb {
        -webkit-appearance: none; appearance: none;
        width: 14px; height: 14px; border-radius: 50%;
        background: var(--text-primary); border: none; cursor: pointer;
        margin-top: -7px;
      }
      input[type=range].cm-slider::-moz-range-thumb {
        width: 14px; height: 14px; border-radius: 50%;
        background: var(--text-primary); border: none; cursor: pointer;
      }
    `}</style>
  );

  return (
    <>
      {stylesEl}
      <PasswordGate>
      <div style={{
        height: "100dvh",
        display: "flex", flexDirection: "column",
        background: "var(--bg-page)", color: "var(--text-primary)",
        overflow: "hidden",
        position: "relative",
      }}>
        {/* 首页 */}
        <div style={{ display: tab === "home" ? "flex" : "none", flex: 1, minHeight: 0, flexDirection: "column" }}>
          <HomePanel onPick={setTab}/>
        </div>

        {/* 各板块：统一 PanelHeader + 滚动内容 */}
        {[
          { key: "memory", Comp: MemoryPanel },
          { key: "diary", Comp: DiaryPanel },
          { key: "milestones", Comp: MilestonesPanel },
          { key: "board", Comp: BoardPanel },
          { key: "console", Comp: ConsolePanel },
        ].map(({ key, Comp }) => (
          <div key={key} style={{ display: tab === key ? "flex" : "none", flex: 1, minHeight: 0, flexDirection: "column" }}>
            <PanelHeader name={PANEL_NAME[key]} onBack={() => setTab("home")}/>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", WebkitOverflowScrolling: "touch" }}>
              <div style={{ maxWidth: 860, margin: "0 auto", padding: "16px 16px 24px", width: "100%" }}>
                <Comp/>
              </div>
            </div>
          </div>
        ))}

        {/* 花信风：自管全屏布局；常驻 display:flex，只切 visibility，避免 flex 链被 hide/show 重算 */}
        <div style={{
          position: "absolute", inset: 0,
          display: "flex",
          flexDirection: "column",
          visibility: tab === "chat" ? "visible" : "hidden",
          pointerEvents: tab === "chat" ? "auto" : "none",
          zIndex: tab === "chat" ? 10 : -1,
        }}>
          <ChatPanel onBack={() => setTab("home")}/>
        </div>
      </div>
      </PasswordGate>
    </>
  );
}

// _BottomTabBar 已退役（保留以防引用，未挂载）
function _UnusedBottomTabBar({ tab, setTab }) {
  return (
    <div style={{
      flexShrink: 0,
      zIndex: 10,
      display:"flex", justifyContent:"space-around", alignItems:"center",
      padding:"0px 4px 0",
      paddingTop: 6,
      paddingBottom:"calc(2px + env(safe-area-inset-bottom, 20px))",
      background:"var(--bg-translucent)",
      backdropFilter:"blur(12px)",
      WebkitBackdropFilter:"blur(12px)",
      borderTop:"1px solid var(--border)",
      transition:"background 0.35s ease",
    }}>
      {TABS.map(t => {
        const a = tab === t.key;
        return (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            display:"flex", flexDirection:"column", alignItems:"center", gap:0,
            background:"none", border:"none", cursor:"pointer",
            padding:"2px 13px 0", opacity:a?1:0.4, transition:"opacity 0.2s",
            color: a ? "var(--accent)" : "var(--text-secondary)",
            fontFamily:"inherit",
          }}>
            {ICONS[t.key]}
            <span style={{ fontSize:9, color:a?"var(--accent)":"var(--text-secondary)", fontFamily:"inherit" }}>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
