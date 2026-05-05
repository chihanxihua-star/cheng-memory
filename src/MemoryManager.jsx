import { useState, useEffect, useCallback, useRef } from "react";
import ChatPanel from "./ChatPanel";

// ── 配置 ─────────────────────────────────────────────────
const SB_URL = "https://fgfyvyztjyqvxijfppgm.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZnZnl2eXp0anlxdnhpamZwcGdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4ODMxNzMsImV4cCI6MjA5MDQ1OTE3M30.APTLMLcdY5lsxxXjHeZ3WQvFbYUINjsCUZImECI-pVk";

const TABS = [
  { key: "memory", label: "涟漪" },
  { key: "diary", label: "溯洄" },
  { key: "milestones", label: "逢春" },
  { key: "board", label: "回音" },
  { key: "chat", label: "花信风" },
];

const LEVEL_META = {
  1: { label: "浮沫", color: "#7fb3c8" },
  2: { label: "长潮", color: "#5e9e8a" },
  3: { label: "深海", color: "#6b7fd4" },
};

const AUTHOR_COLORS = {
  澄: "#a89fd8", 小太阳: "#e8b86d", 宝贝: "#d4a0c0",
  小茉莉: "#d89fa8", default: "#8aab9e",
};

const BOARD_CATS = ["全部", "紧急", "需求", "闲聊", "回复", "通知"];
const BOARD_CAT_COLORS = {
  紧急: "#e07070", 需求: "#7fb3c8", 闲聊: "#8aab9e", 回复: "#a89fd8", 通知: "#e8b86d",
};

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

function StrengthBar({ value = 0, color }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ flex: 1, height: 3, background: "var(--border)", borderRadius: 99 }}>
        <div style={{ width: `${(value*100).toFixed(0)}%`, height: "100%", background: color, borderRadius: 99, boxShadow: `0 0 6px ${color}88`, transition: "width 0.4s" }}/>
      </div>
      <span style={{ fontSize: 10, color: "var(--text-secondary)", minWidth: 28, textAlign: "right" }}>{(value*100).toFixed(0)}%</span>
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
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={onClose} style={{ flex: 1, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}/>
      <div style={{ width: 380, maxWidth: "90vw", background: "var(--bg-card)", borderLeft: "1px solid var(--border)", display: "flex", flexDirection: "column", animation: "slideIn 0.22s ease" }}>
        <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "var(--text-secondary)", letterSpacing: "0.1em" }}>{title}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>{children}</div>
        {footer && <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", display: "flex", gap: 8 }}>{footer}</div>}
      </div>
    </div>
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
  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, borderLeft: `2px solid ${meta.color}88`, transition: "background 0.15s" }}
      onMouseEnter={e => e.currentTarget.style.background = "var(--bg-card)"}
      onMouseLeave={e => e.currentTarget.style.background = "var(--bg-card)"}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <EmotionDot valence={mem.valence} arousal={mem.arousal}/>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 13.5, color: "var(--text-primary)", lineHeight: 1.6, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{mem.content}</p>
          {mem.summary && <p style={{ margin: "4px 0 0", fontSize: 11.5, color: "var(--text-secondary)", lineHeight: 1.4 }}>{mem.summary}</p>}
          <SensoryAnchors context={mem.context}/>
        </div>
      </div>
      <StrengthBar value={mem.strength ?? 0} color={meta.color}/>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
        <Badge color={meta.color+"22"} text={meta.color}>{meta.label}</Badge>
        <AuthorBadge author={mem.author}/>
        {mem.pinned && <Badge color="#e8c47322" text="#e8c473">📌</Badge>}
        {mem.flashbulb && <Badge color="#e87a5022" text="#e87a50">⚡</Badge>}
        {mem.resolved === false && <Badge color="#ffffff11" text="var(--text-secondary)">未愈</Badge>}
        {(mem.tags||[]).slice(0,3).map(t => <Badge key={t} color="var(--border)" text="var(--text-secondary)">{t}</Badge>)}
        <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--text-secondary)" }}>{formatDate(mem.created_at)} · 引用 {mem.ref_count??0}</span>
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: -2 }}>
        <ActionBtn onClick={() => onEdit(mem)}>编辑</ActionBtn>
        {cd ? <ActionBtn accent color="#c0392b" onClick={() => { onDelete(mem.id); setCd(false); }}>确认删除</ActionBtn> : <ActionBtn onClick={() => setCd(true)}>删除</ActionBtn>}
      </div>
    </div>
  );
}

function MemoryPanel() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [drawer, setDrawer] = useState(null);
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

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          {stats && <p style={{ margin: 0, fontSize: 11, color: "var(--text-secondary)" }}>共 {stats.total} 条 · 均强度 {stats.avgStr} · 📌{stats.pinned} ⚡{stats.flash}</p>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <ActionBtn accent onClick={() => setDrawer({ mode: "create", memory: EMPTY_MEM })}>+ 写入</ActionBtn>
          <ActionBtn onClick={reload}>{loading ? "…" : "刷新"}</ActionBtn>
        </div>
      </div>

      {stats && <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 16 }}>
        {[1,2,3].map(l => <div key={l} style={{ background: LEVEL_META[l].color+"0d", border: `1px solid ${LEVEL_META[l].color}33`, borderRadius: 8, padding: "10px 14px", textAlign: "center" }}>
          <div style={{ fontSize: 18, fontWeight: 300, color: LEVEL_META[l].color }}>{stats[`l${l}`]}</div>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>{LEVEL_META[l].label}</div>
        </div>)}
      </div>}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16, alignItems: "center" }}>
        <input placeholder="搜索…" value={filters.search} onChange={e => filterChange("search", e.target.value)} style={{ ...inputStyle, width: 140, borderRadius: 99, padding: "5px 14px", fontSize: 12 }}/>
        {[1,2,3].map(l => <button key={l} style={chipStyle(filters.level===l, LEVEL_META[l].color)} onClick={() => filterChange("level", filters.level===l?"":l)}>{LEVEL_META[l].label}</button>)}
        <button style={chipStyle(filters.pinned,"#e8c473")} onClick={() => filterChange("pinned",!filters.pinned)}>📌</button>
        <button style={chipStyle(filters.flashbulb,"#e87a50")} onClick={() => filterChange("flashbulb",!filters.flashbulb)}>⚡</button>
        <button style={chipStyle(filters.unresolved,"#a0c4a0")} onClick={() => filterChange("unresolved",!filters.unresolved)}>未愈</button>
        <span style={{ marginLeft: "auto" }}/>
        <select value={sort} onChange={e => { setSort(e.target.value); load(filters, e.target.value); }} style={{ ...inputStyle, width: "auto", borderRadius: 6, padding: "4px 8px", fontSize: 11 }}>
          {MEM_SORTS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      </div>

      <ErrorBar error={error} onClose={() => setError(null)}/>

      {loading ? <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-secondary)", fontSize: 13 }}>正在拉取…</div>
        : items.length === 0 ? <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-secondary)", fontSize: 13 }}>没有记忆</div>
        : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 10 }}>
            {items.map(m => <div key={m.id} style={{ animation: "fadeUp 0.25s ease both" }}><MemoryCard mem={m} onEdit={mem => setDrawer({ mode: "edit", memory: mem })} onDelete={async id => { try { await sbDelete("memories_cheng", id); reload(); } catch(e) { setError(e.message); } }}/></div>)}
          </div>}

      {drawer && <MemoryDrawer memory={drawer.memory} isNew={drawer.mode==="create"} onClose={() => setDrawer(null)} onSave={async patch => { try { if (drawer.mode==="create") await sbPost("memories_cheng", patch); else await sbPatch("memories_cheng", drawer.memory.id, patch); setDrawer(null); reload(); } catch(e) { setError(e.message); } }}/>}
    </div>
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
  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {entry.title && <p style={{ margin: "0 0 4px", fontSize: 14, color: "var(--text-primary)", fontWeight: 400 }}>{entry.title}</p>}
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{entry.content}</p>
        </div>
      </div>
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <p style={{ margin: 0, fontSize: 11, color: "var(--text-secondary)" }}>共 {items.length} 篇</p>
        <div style={{ display: "flex", gap: 8 }}>
          <ActionBtn accent onClick={() => setDrawer({ mode: "create", entry: {} })}>+ 写日记</ActionBtn>
          <ActionBtn onClick={reload}>{loading ? "…" : "刷新"}</ActionBtn>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <input placeholder="搜索标题或内容…" value={search} onChange={e => { setSearch(e.target.value); clearTimeout(timer.current); timer.current = setTimeout(() => load(e.target.value), 400); }} style={{ ...inputStyle, borderRadius: 99, padding: "5px 14px", fontSize: 12, width: 240 }}/>
      </div>

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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <p style={{ margin: 0, fontSize: 11, color: "var(--text-secondary)" }}>共 {items.length} 个</p>
        <div style={{ display: "flex", gap: 8 }}>
          <ActionBtn accent color="#e8b86d" onClick={() => setDrawer({ mode: "create", entry: {} })}>+ 添加</ActionBtn>
          <ActionBtn onClick={load}>{loading ? "…" : "刷新"}</ActionBtn>
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
function BoardDrawer({ entry, isNew, replyTo, onSave, onClose }) {
  // 作者固定为「小茉莉」，不再提供选择
  const AUTHOR = "小茉莉";
  const [f, setF] = useState({
    content: entry.content || "",
    category: entry.category || "闲聊",
  });
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  return (
    <Drawer title={isNew ? (replyTo ? "回复留言" : "写留言") : "编辑留言"} onClose={onClose} footer={<>
      <ActionBtn onClick={onClose}>取消</ActionBtn>
      <ActionBtn accent color="#a89fd8" disabled={!f.content.trim()} onClick={() => onSave({ content: f.content, author: AUTHOR, category: replyTo ? "回复" : f.category, reply_to: replyTo || null })} flex={2}>{isNew ? "发送" : "保存"}</ActionBtn>
    </>}>
      <div><label style={labelStyle}>内容</label><textarea rows={5} style={inputStyle} value={f.content} onChange={e => set("content", e.target.value)} placeholder="留言…"/></div>
      {!replyTo && (
        <div><label style={labelStyle}>分类</label>
          <select style={inputStyle} value={f.category} onChange={e => set("category", e.target.value)}>
            {["紧急","需求","闲聊","通知"].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      )}
    </Drawer>
  );
}

function BoardMessage({ msg, replies, onEdit, onDelete, onReply, onToggleRead, onToggleResolved }) {
  const [cd, setCd] = useState(false);
  const catColor = BOARD_CAT_COLORS[msg.category] || "#8aab9e";
  const authorColor = AUTHOR_COLORS[msg.author] || AUTHOR_COLORS.default;
  const bgColor = authorColor + "08";
  const borderColor = authorColor + "22";

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ background: bgColor, border: `1px solid ${borderColor}`, borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8, opacity: msg.is_resolved ? 0.6 : 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <AuthorBadge author={msg.author}/>
          <Badge color={catColor+"22"} text={catColor}>{msg.category}</Badge>
          <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-secondary)" }}>{formatDateTime(msg.created_at)}</span>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-primary)", lineHeight: 1.6 }}>{msg.content}</p>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {msg.is_resolved && <Badge color="#8aab9e22" text="#8aab9e">✓ 已处理</Badge>}
          {msg.is_read && !msg.is_resolved && <Badge color="#ffffff11" text="var(--text-secondary)">已读</Badge>}
          <span style={{ flex: 1 }}/>
          <ActionBtn onClick={() => onReply(msg.id)}>回复</ActionBtn>
          <ActionBtn onClick={() => onToggleRead(msg)}>{msg.is_read ? "标为未读" : "标为已读"}</ActionBtn>
          <ActionBtn onClick={() => onToggleResolved(msg)}>{msg.is_resolved ? "重新打开" : "✓ 处理"}</ActionBtn>
          <ActionBtn onClick={() => onEdit(msg)}>编辑</ActionBtn>
          {cd ? <ActionBtn accent color="#c0392b" onClick={() => { onDelete(msg.id); setCd(false); }}>确认</ActionBtn> : <ActionBtn onClick={() => setCd(true)}>删除</ActionBtn>}
        </div>
      </div>

      {/* 回复列表 */}
      {replies.length > 0 && (
        <div style={{ marginLeft: 20, marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
          {replies.map(r => {
            const rc = AUTHOR_COLORS[r.author] || AUTHOR_COLORS.default;
            return (
              <div key={r.id} style={{ background: rc+"08", border: `1px solid ${rc}22`, borderRadius: 8, padding: "8px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <AuthorBadge author={r.author}/>
                  <Badge color="#a89fd822" text="#a89fd8">回复</Badge>
                  <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-secondary)" }}>{formatDateTime(r.created_at)}</span>
                </div>
                <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>{r.content}</p>
              </div>
            );
          })}
        </div>
      )}
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
    try { setItems(await sbGet("board_cheng", "&order=created_at.desc")); }
    catch(e) { setError(e.message); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const topLevel = items.filter(m => !m.reply_to);
  const repliesOf = id => items.filter(m => m.reply_to === id).sort((a,b) => new Date(a.created_at) - new Date(b.created_at));

  let filtered = topLevel;
  if (catFilter !== "全部") filtered = filtered.filter(m => m.category === catFilter);
  if (onlyUnread) filtered = filtered.filter(m => !m.is_read);

  const unreadCount = topLevel.filter(m => !m.is_read).length;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <p style={{ margin: 0, fontSize: 11, color: "var(--text-secondary)" }}>共 {topLevel.length} 条 · 未读 {unreadCount}</p>
        <div style={{ display: "flex", gap: 8 }}>
          <ActionBtn accent color="#a89fd8" onClick={() => setDrawer({ mode: "create", entry: {}, replyTo: null })}>+ 留言</ActionBtn>
          <ActionBtn onClick={load}>{loading ? "…" : "刷新"}</ActionBtn>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
        {BOARD_CATS.map(c => <button key={c} style={chipStyle(catFilter===c, BOARD_CAT_COLORS[c] || "#6b7fd4")} onClick={() => setCatFilter(c)}>{c}</button>)}
        <button style={chipStyle(onlyUnread, "#e8b86d")} onClick={() => setOnlyUnread(!onlyUnread)}>仅未读</button>
      </div>

      <ErrorBar error={error} onClose={() => setError(null)}/>

      {loading ? <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-secondary)", fontSize: 13 }}>正在拉取…</div>
        : filtered.length === 0 ? <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-secondary)", fontSize: 13 }}>没有留言</div>
        : filtered.map(m => (
            <BoardMessage key={m.id} msg={m} replies={repliesOf(m.id)}
              onEdit={msg => setDrawer({ mode: "edit", entry: msg, replyTo: null })}
              onDelete={async id => { try { await sbDelete("board_cheng", id); load(); } catch(e) { setError(e.message); } }}
              onReply={id => setDrawer({ mode: "create", entry: {}, replyTo: id })}
              onToggleRead={async msg => { try { await sbPatch("board_cheng", msg.id, { is_read: !msg.is_read }); load(); } catch(e) { setError(e.message); } }}
              onToggleResolved={async msg => { try { await sbPatch("board_cheng", msg.id, { is_resolved: !msg.is_resolved }); load(); } catch(e) { setError(e.message); } }}
            />
          ))}

      {drawer && <BoardDrawer entry={drawer.entry} isNew={drawer.mode==="create"} replyTo={drawer.replyTo} onClose={() => setDrawer(null)} onSave={async patch => { try { if (drawer.mode==="create") await sbPost("board_cheng", patch); else await sbPatch("board_cheng", drawer.entry.id, patch); setDrawer(null); load(); } catch(e) { setError(e.message); } }}/>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
//  主应用
// ════════════════════════════════════════════════════════════
export default function App() {
  const [tab, setTab] = useState("memory");

  // 启动时把 data-theme 写到 <html>，让 :root[data-theme="…"] 的 token 立即生效
  useEffect(() => {
    let pref = localStorage.getItem("chat-theme") || "light";
    if (pref === "system") {
      pref = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.setAttribute("data-theme", pref);
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
      * { box-sizing: border-box; }
      html, body, #root {
        height: 100%; margin: 0;
        overflow: hidden;
        overscroll-behavior: none;
      }
      body { background: var(--bg-page); font-family: 'Noto Serif SC', Georgia, serif; }
      button, input, select, textarea { font-family: inherit; }
      ::-webkit-scrollbar { width: 4px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 99px; }
      @keyframes slideIn { from { transform: translateX(20px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
      @keyframes fadeUp { from { transform: translateY(6px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      input[type=range] { height: 3px; }
      select option { background: var(--bg-card); }
      input[type=date] { color-scheme: dark; }
    `}</style>
  );

  return (
    <>
      {stylesEl}

      <div style={{
        display: "flex", flexDirection: "column",
        height: "100dvh", minHeight: "100dvh",
        background: "var(--bg-page)", color: "var(--text-primary)",
        overflow: "hidden",
      }}>
        <main style={{
          flex: 1, minHeight: 0,
          display: "flex", flexDirection: "column",
          overflow: tab === "chat" ? "hidden" : "auto",
          overscrollBehavior: "contain",
          WebkitOverflowScrolling: "touch",
        }}>
          {tab === "chat" ? (
            <ChatPanel/>
          ) : (
            <div style={{
              flex: 1,
              paddingTop: "env(safe-area-inset-top)",
            }}>
              <div style={{ maxWidth: 860, margin: "0 auto", padding: "20px 16px 28px", width: "100%" }}>
                {tab === "memory" && <MemoryPanel/>}
                {tab === "diary" && <DiaryPanel/>}
                {tab === "milestones" && <MilestonesPanel/>}
                {tab === "board" && <BoardPanel/>}
              </div>
            </div>
          )}
        </main>

        <BottomTabBar tab={tab} setTab={setTab}/>
      </div>
    </>
  );
}

function BottomTabBar({ tab, setTab }) {
  return (
    <nav style={{
      flexShrink: 0,
      borderTop: "1px solid var(--border)",
      background: "var(--bg-translucent)",
      backdropFilter: "saturate(180%) blur(6px)",
      WebkitBackdropFilter: "saturate(180%) blur(6px)",
      paddingBottom: "env(safe-area-inset-bottom)",
      paddingLeft: "env(safe-area-inset-left)",
      paddingRight: "env(safe-area-inset-right)",
      display: "flex",
    }}>
      {TABS.map(t => {
        const active = tab === t.key;
        return (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            flex: 1, position: "relative",
            padding: "5px 4px 5px",
            background: "none", border: "none", cursor: "pointer",
            fontFamily: "inherit",
            fontSize: 12,
            letterSpacing: "0.08em",
            fontWeight: active ? 500 : 400,
            color: active ? "var(--text-primary)" : "var(--text-secondary)",
            transition: "color 0.18s",
          }}>
            {t.label}
            {active && (
              <span style={{
                position: "absolute", left: "50%", bottom: 1,
                transform: "translateX(-50%)",
                width: 3, height: 3, borderRadius: "50%",
                background: "var(--accent)",
              }}/>
            )}
          </button>
        );
      })}
    </nav>
  );
}
