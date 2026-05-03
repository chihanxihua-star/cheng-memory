import { useState, useEffect, useCallback, useRef } from "react";

// ── 配置层 ──────────────────────────────────────────────
const SB_URL = "https://fgfyvyztjyqvxijfppgm.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZnZnl2eXp0anlxdnhpamZwcGdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4ODMxNzMsImV4cCI6MjA5MDQ1OTE3M30.APTLMLcdY5lsxxXjHeZ3WQvFbYUINjsCUZImECI-pVk";

const LEVEL_META = {
  1: { label: "浮沫", color: "#7fb3c8", desc: "短期" },
  2: { label: "长潮", color: "#5e9e8a", desc: "长期" },
  3: { label: "深海", color: "#6b7fd4", desc: "核心" },
};

const AUTHOR_COLORS = {
  Claude: "#a89fd8", 昼: "#a89fd8", 澄: "#a89fd8",
  小狐狸: "#d89fa8",
  default: "#8aab9e",
};

const SORT_OPTIONS = [
  { key: "created_at.desc", label: "最新" },
  { key: "created_at.asc", label: "最旧" },
  { key: "strength.desc", label: "强度↓" },
  { key: "strength.asc", label: "强度↑" },
  { key: "arousal.desc", label: "唤醒度↓" },
  { key: "valence.desc", label: "效价↓" },
  { key: "ref_count.desc", label: "引用↓" },
];

const EMPTY_MEMORY = {
  content: "", summary: "", level: 1, valence: 0.5, arousal: 0.5,
  tags: [], resolved: false, flashbulb: false, pinned: false,
  strength: 1.0, author: "小狐狸", context: null,
};

// ── API 层 ──────────────────────────────────────────────
function hdr() {
  return {
    "Content-Type": "application/json",
    apikey: SB_KEY,
    Authorization: `Bearer ${SB_KEY}`,
    Prefer: "return=representation",
  };
}

async function fetchMemories(filters, sort) {
  const [col, dir] = sort.split(".");
  let q = `${SB_URL}/rest/v1/memories_cheng?select=*&order=${col}.${dir}`;
  if (filters.level) q += `&level=eq.${filters.level}`;
  if (filters.pinned) q += `&pinned=eq.true`;
  if (filters.flashbulb) q += `&flashbulb=eq.true`;
  if (filters.unresolved) q += `&resolved=eq.false`;
  if (filters.search) q += `&content=ilike.*${encodeURIComponent(filters.search)}*`;
  const r = await fetch(q, { headers: hdr() });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function createMemory(data) {
  const r = await fetch(`${SB_URL}/rest/v1/memories_cheng`, {
    method: "POST", headers: hdr(), body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function updateMemory(id, patch) {
  const r = await fetch(`${SB_URL}/rest/v1/memories_cheng?id=eq.${id}`, {
    method: "PATCH", headers: hdr(), body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function deleteMemory(id) {
  const r = await fetch(`${SB_URL}/rest/v1/memories_cheng?id=eq.${id}`, {
    method: "DELETE", headers: { ...hdr(), Prefer: "return=minimal" },
  });
  if (!r.ok) throw new Error(await r.text());
}

// ── 情绪坐标可视化 ────────────────────────────────────────
function EmotionDot({ valence = 0.5, arousal = 0.5, size = 48 }) {
  const x = valence * (size - 8) + 4;
  const y = (1 - arousal) * (size - 8) + 4;
  const hue = Math.round(valence * 200 + 160);
  const sat = 40 + arousal * 50;
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <rect x={0} y={0} width={size} height={size} rx={4} fill="rgba(255,255,255,0.04)" />
      <line x1={size / 2} y1={2} x2={size / 2} y2={size - 2} stroke="rgba(255,255,255,0.08)" strokeWidth={0.5} />
      <line x1={2} y1={size / 2} x2={size - 2} y2={size / 2} stroke="rgba(255,255,255,0.08)" strokeWidth={0.5} />
      <circle cx={x} cy={y} r={3.5} fill={`hsl(${hue},${sat}%,65%)`} opacity={0.9} />
    </svg>
  );
}

// ── 强度条 ────────────────────────────────────────────────
function StrengthBar({ value = 0, levelColor }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ flex: 1, height: 3, background: "rgba(255,255,255,0.08)", borderRadius: 99 }}>
        <div style={{
          width: `${(value * 100).toFixed(0)}%`, height: "100%",
          background: levelColor, borderRadius: 99,
          boxShadow: `0 0 6px ${levelColor}88`,
          transition: "width 0.4s ease",
        }} />
      </div>
      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", minWidth: 28, textAlign: "right" }}>
        {(value * 100).toFixed(0)}%
      </span>
    </div>
  );
}

// ── 标签徽章 ──────────────────────────────────────────────
function Badge({ children, color = "#ffffff22", text = "#ffffffaa" }) {
  return (
    <span style={{
      background: color, color: text, fontSize: 10, padding: "1px 7px",
      borderRadius: 99, letterSpacing: "0.04em", fontFamily: "inherit",
    }}>
      {children}
    </span>
  );
}

// ── 感官锚点 ──────────────────────────────────────────────
function SensoryAnchors({ context }) {
  if (!context) return null;
  let senses = null;
  try {
    const parsed = typeof context === "string" ? JSON.parse(context) : context;
    senses = parsed?.senses;
  } catch { return null; }
  if (!senses || !senses.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
      {senses.map((s, i) => (
        <span key={i} style={{
          fontSize: 10.5, color: "rgba(255,255,255,0.4)",
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 4, padding: "1px 6px",
          fontStyle: "italic",
        }}>
          {s}
        </span>
      ))}
    </div>
  );
}

// ── 编辑/新建抽屉 ─────────────────────────────────────────
function MemoryDrawer({ memory, isNew, onSave, onClose }) {
  const [form, setForm] = useState({
    content: memory.content || "",
    summary: memory.summary || "",
    level: memory.level ?? 1,
    valence: memory.valence ?? 0.5,
    arousal: memory.arousal ?? 0.5,
    tags: Array.isArray(memory.tags) ? memory.tags.join(", ") : "",
    resolved: memory.resolved ?? false,
    pinned: memory.pinned ?? false,
    flashbulb: memory.flashbulb ?? false,
    strength: memory.strength ?? 1,
    author: memory.author || "小狐狸",
    senses: "",
  });

  useEffect(() => {
    if (memory.context) {
      try {
        const parsed = typeof memory.context === "string" ? JSON.parse(memory.context) : memory.context;
        if (parsed?.senses) setForm(f => ({ ...f, senses: parsed.senses.join(", ") }));
      } catch {}
    }
  }, [memory.context]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = () => {
    const sensesArr = form.senses.split(",").map(s => s.trim()).filter(Boolean);
    const patch = {
      content: form.content,
      summary: form.summary || null,
      level: Number(form.level),
      valence: Number(form.valence),
      arousal: Number(form.arousal),
      strength: Number(form.strength),
      tags: form.tags.split(",").map(t => t.trim()).filter(Boolean),
      resolved: form.resolved,
      pinned: form.pinned,
      flashbulb: form.flashbulb,
      author: form.author,
      context: sensesArr.length ? JSON.stringify({ senses: sensesArr }) : null,
    };
    onSave(patch);
  };

  const inputStyle = {
    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 6, color: "#e8e2da", padding: "8px 10px", fontSize: 13,
    width: "100%", fontFamily: "inherit", resize: "vertical",
    outline: "none", transition: "border-color 0.2s", boxSizing: "border-box",
  };
  const labelStyle = { fontSize: 11, color: "rgba(255,255,255,0.4)", letterSpacing: "0.06em", marginBottom: 4, display: "block" };
  const sliderStyle = { width: "100%", accentColor: LEVEL_META[form.level]?.color };
  const accent = LEVEL_META[form.level]?.color || "#6b7fd4";

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={onClose} style={{ flex: 1, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }} />
      <div style={{
        width: 380, maxWidth: "90vw", background: "#14161c",
        borderLeft: "1px solid rgba(255,255,255,0.08)",
        display: "flex", flexDirection: "column", overflow: "hidden",
        animation: "slideIn 0.22s ease",
      }}>
        <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", letterSpacing: "0.1em" }}>
            {isNew ? "写入记忆" : "编辑记忆"}
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>

          <div><label style={labelStyle}>内容</label>
            <textarea rows={5} style={inputStyle} value={form.content}
              onChange={e => set("content", e.target.value)} placeholder="写下这条记忆…" />
          </div>

          <div><label style={labelStyle}>摘要</label>
            <textarea rows={2} style={{ ...inputStyle, resize: "none" }} value={form.summary}
              onChange={e => set("summary", e.target.value)} placeholder="可选" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><label style={labelStyle}>层级</label>
              <select style={{ ...inputStyle, resize: "none" }} value={form.level}
                onChange={e => set("level", e.target.value)}>
                <option value={1}>1 · 浮沫</option>
                <option value={2}>2 · 长潮</option>
                <option value={3}>3 · 深海</option>
              </select>
            </div>
            <div><label style={labelStyle}>作者</label>
              <input style={inputStyle} value={form.author}
                onChange={e => set("author", e.target.value)} />
            </div>
          </div>

          <div>
            <label style={labelStyle}>效价 valence — {Number(form.valence).toFixed(2)}</label>
            <input type="range" min={0} max={1} step={0.01} style={sliderStyle} value={form.valence}
              onChange={e => set("valence", e.target.value)} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 2 }}>
              <span>极负面</span><span>中性</span><span>极正面</span>
            </div>
          </div>

          <div>
            <label style={labelStyle}>唤醒度 arousal — {Number(form.arousal).toFixed(2)}</label>
            <input type="range" min={0} max={1} step={0.01} style={sliderStyle} value={form.arousal}
              onChange={e => set("arousal", e.target.value)} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 2 }}>
              <span>平静</span><span>——</span><span>激烈</span>
            </div>
          </div>

          {!isNew && (
            <div>
              <label style={labelStyle}>强度 strength — {Number(form.strength).toFixed(2)}</label>
              <input type="range" min={0} max={1} step={0.01} style={sliderStyle} value={form.strength}
                onChange={e => set("strength", e.target.value)} />
            </div>
          )}

          <div><label style={labelStyle}>标签（逗号分隔）</label>
            <input style={inputStyle} value={form.tags}
              onChange={e => set("tags", e.target.value)} placeholder="起源, 调试, 日常" />
          </div>

          <div><label style={labelStyle}>感官锚点（逗号分隔）</label>
            <input style={inputStyle} value={form.senses}
              onChange={e => set("senses", e.target.value)} placeholder="窗外下雨, 咖啡的味道" />
          </div>

          <div style={{ display: "flex", gap: 16 }}>
            {[["pinned", "📌 钉选"], ["flashbulb", "⚡ 闪光灯"], ["resolved", "✓ 已解决"]].map(([k, label]) => (
              <label key={k} style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 12, color: form[k] ? "#e8e2da" : "rgba(255,255,255,0.35)" }}>
                <input type="checkbox" checked={form[k]} onChange={e => set(k, e.target.checked)}
                  style={{ accentColor: accent }} />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div style={{ padding: "12px 20px", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", gap: 8 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: "9px", background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6,
            color: "rgba(255,255,255,0.5)", cursor: "pointer", fontSize: 13, fontFamily: "inherit",
          }}>取消</button>
          <button onClick={handleSave} disabled={!form.content.trim()} style={{
            flex: 2, padding: "9px", background: accent + "22",
            border: `1px solid ${accent}66`, borderRadius: 6,
            color: !form.content.trim() ? "rgba(255,255,255,0.2)" : accent,
            cursor: form.content.trim() ? "pointer" : "not-allowed",
            fontSize: 13, fontFamily: "inherit",
            boxShadow: `0 0 12px ${accent}33`,
          }}>{isNew ? "写入" : "保存"}</button>
        </div>
      </div>
    </div>
  );
}

// ── 记忆卡片 ──────────────────────────────────────────────
function MemoryCard({ mem, onEdit, onDelete }) {
  const meta = LEVEL_META[mem.level] || LEVEL_META[1];
  const authorColor = AUTHOR_COLORS[mem.author] || AUTHOR_COLORS.default;
  const dateStr = mem.created_at
    ? new Date(mem.created_at).toLocaleDateString("zh-CN", { month: "short", day: "numeric" })
    : "";
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div style={{
      background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)",
      borderRadius: 10, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10,
      borderLeft: `2px solid ${meta.color}88`,
      transition: "background 0.15s",
    }}
      onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.04)"}
      onMouseLeave={e => e.currentTarget.style.background = "rgba(255,255,255,0.025)"}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <EmotionDot valence={mem.valence} arousal={mem.arousal} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{
            margin: 0, fontSize: 13.5, color: "#e0d9d0", lineHeight: 1.6,
            display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden",
          }}>{mem.content}</p>
          {mem.summary && (
            <p style={{ margin: "4px 0 0", fontSize: 11.5, color: "rgba(255,255,255,0.35)", lineHeight: 1.4 }}>{mem.summary}</p>
          )}
          <SensoryAnchors context={mem.context} />
        </div>
      </div>

      <StrengthBar value={mem.strength ?? 0} levelColor={meta.color} />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
        <Badge color={meta.color + "22"} text={meta.color}>{meta.label}</Badge>
        <Badge color={authorColor + "22"} text={authorColor}>{mem.author || "Claude"}</Badge>
        {mem.pinned && <Badge color="#e8c47322" text="#e8c473">📌</Badge>}
        {mem.flashbulb && <Badge color="#e87a5022" text="#e87a50">⚡</Badge>}
        {mem.resolved === false && <Badge color="#ffffff11" text="rgba(255,255,255,0.3)">未愈</Badge>}
        {(mem.tags || []).slice(0, 3).map(t => (
          <Badge key={t} color="rgba(255,255,255,0.06)" text="rgba(255,255,255,0.4)">{t}</Badge>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 10.5, color: "rgba(255,255,255,0.25)" }}>
          {dateStr} · 引用 {mem.ref_count ?? 0}
        </span>
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: -2 }}>
        <button onClick={() => onEdit(mem)} style={{
          flex: 1, padding: "5px 0", background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)", borderRadius: 5,
          color: "rgba(255,255,255,0.45)", cursor: "pointer", fontSize: 11.5, fontFamily: "inherit",
        }}>编辑</button>
        {confirmDelete
          ? <button onClick={() => { onDelete(mem.id); setConfirmDelete(false); }} style={{
              flex: 1, padding: "5px 0", background: "#c0392b22",
              border: "1px solid #c0392b66", borderRadius: 5,
              color: "#e07070", cursor: "pointer", fontSize: 11.5, fontFamily: "inherit",
            }}>确认删除</button>
          : <button onClick={() => setConfirmDelete(true)} style={{
              flex: 1, padding: "5px 0", background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.06)", borderRadius: 5,
              color: "rgba(255,255,255,0.25)", cursor: "pointer", fontSize: 11.5, fontFamily: "inherit",
            }}>删除</button>
        }
      </div>
    </div>
  );
}

// ── 主应用 ────────────────────────────────────────────────
export default function App() {
  const [memories, setMemories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [drawerState, setDrawerState] = useState(null);
  const [filters, setFilters] = useState({ level: "", pinned: false, flashbulb: false, unresolved: false, search: "" });
  const [sort, setSort] = useState("created_at.desc");
  const [stats, setStats] = useState(null);
  const searchTimer = useRef(null);

  const load = useCallback(async (f, s) => {
    setLoading(true); setError(null);
    try {
      const data = await fetchMemories(f, s);
      setMemories(data);
      setStats({
        total: data.length,
        l1: data.filter(m => m.level === 1).length,
        l2: data.filter(m => m.level === 2).length,
        l3: data.filter(m => m.level === 3).length,
        avgStrength: data.length ? (data.reduce((a, m) => a + (m.strength || 0), 0) / data.length).toFixed(2) : "—",
        pinned: data.filter(m => m.pinned).length,
        flashbulb: data.filter(m => m.flashbulb).length,
      });
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(filters, sort); }, [load]);

  const reload = () => load(filters, sort);

  const handleFilterChange = (key, val) => {
    const next = { ...filters, [key]: val };
    setFilters(next);
    if (key === "search") {
      clearTimeout(searchTimer.current);
      searchTimer.current = setTimeout(() => load(next, sort), 400);
    } else {
      load(next, sort);
    }
  };

  const handleSortChange = (s) => { setSort(s); load(filters, s); };

  const handleSave = async (patch) => {
    try {
      if (drawerState.mode === "create") {
        await createMemory(patch);
      } else {
        await updateMemory(drawerState.memory.id, patch);
      }
      setDrawerState(null);
      reload();
    } catch (e) { setError(e.message); }
  };

  const handleDelete = async (id) => {
    try { await deleteMemory(id); reload(); }
    catch (e) { setError(e.message); }
  };

  const chipStyle = (active, color = "#6b7fd4") => ({
    padding: "5px 12px", borderRadius: 99, fontSize: 11.5, cursor: "pointer", fontFamily: "inherit",
    background: active ? color + "22" : "rgba(255,255,255,0.04)",
    border: `1px solid ${active ? color + "66" : "rgba(255,255,255,0.08)"}`,
    color: active ? color : "rgba(255,255,255,0.4)",
    transition: "all 0.15s",
  });

  return (
    <>
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; background: #0e1014; font-family: 'Noto Serif SC', 'Georgia', serif; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 99px; }
        @keyframes slideIn { from { transform: translateX(20px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes fadeUp { from { transform: translateY(6px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        input[type=range] { height: 3px; }
        select option { background: #14161c; }
      `}</style>

      <div style={{ minHeight: "100vh", background: "#0e1014", color: "#e8e2da" }}>
        <div style={{ maxWidth: 860, margin: "0 auto", padding: "24px 16px" }}>

          {/* 顶部 */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
            <div>
              <h1 style={{ margin: 0, fontWeight: 300, letterSpacing: "0.2em", fontSize: 20, color: "#e8e2da" }}>
                澄 · 记忆
              </h1>
              {stats && (
                <p style={{ margin: "4px 0 0", fontSize: 11, color: "rgba(255,255,255,0.3)", letterSpacing: "0.05em" }}>
                  共 {stats.total} 条 · 均强度 {stats.avgStrength} · 📌{stats.pinned} ⚡{stats.flashbulb}
                </p>
              )}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setDrawerState({ mode: "create", memory: EMPTY_MEMORY })} style={{
                background: "rgba(107, 127, 212, 0.15)", border: "1px solid rgba(107, 127, 212, 0.4)",
                borderRadius: 6, color: "#a0adec", padding: "6px 14px", cursor: "pointer",
                fontSize: 12, fontFamily: "inherit", letterSpacing: "0.05em",
              }}>+ 写入</button>
              <button onClick={reload} style={{
                background: "none", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6,
                color: "rgba(255,255,255,0.4)", padding: "6px 14px", cursor: "pointer",
                fontSize: 12, fontFamily: "inherit",
              }}>{loading ? "…" : "刷新"}</button>
            </div>
          </div>

          {/* 统计条 */}
          {stats && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 20 }}>
              {[
                { label: "浮沫", count: stats.l1, color: LEVEL_META[1].color },
                { label: "长潮", count: stats.l2, color: LEVEL_META[2].color },
                { label: "深海", count: stats.l3, color: LEVEL_META[3].color },
              ].map(s => (
                <div key={s.label} style={{
                  background: s.color + "0d", border: `1px solid ${s.color}33`,
                  borderRadius: 8, padding: "10px 14px", textAlign: "center",
                }}>
                  <div style={{ fontSize: 18, fontWeight: 300, color: s.color }}>{s.count}</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* 筛选 + 排序 */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16, alignItems: "center" }}>
            <input
              placeholder="搜索内容…"
              value={filters.search}
              onChange={e => handleFilterChange("search", e.target.value)}
              style={{
                background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 99, color: "#e8e2da", padding: "5px 14px", fontSize: 12,
                fontFamily: "inherit", outline: "none", width: 160,
              }}
            />
            {[1, 2, 3].map(l => (
              <button key={l} style={chipStyle(filters.level === l, LEVEL_META[l].color)}
                onClick={() => handleFilterChange("level", filters.level === l ? "" : l)}>
                {LEVEL_META[l].label}
              </button>
            ))}
            <button style={chipStyle(filters.pinned, "#e8c473")}
              onClick={() => handleFilterChange("pinned", !filters.pinned)}>📌</button>
            <button style={chipStyle(filters.flashbulb, "#e87a50")}
              onClick={() => handleFilterChange("flashbulb", !filters.flashbulb)}>⚡</button>
            <button style={chipStyle(filters.unresolved, "#a0c4a0")}
              onClick={() => handleFilterChange("unresolved", !filters.unresolved)}>未愈</button>

            <span style={{ marginLeft: "auto" }} />
            <select
              value={sort}
              onChange={e => handleSortChange(e.target.value)}
              style={{
                background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 6, color: "rgba(255,255,255,0.5)", padding: "4px 8px",
                fontSize: 11, fontFamily: "inherit", outline: "none", cursor: "pointer",
              }}
            >
              {SORT_OPTIONS.map(o => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* 错误 */}
          {error && (
            <div style={{
              background: "#c0392b18", border: "1px solid #c0392b44", borderRadius: 8,
              padding: "10px 14px", fontSize: 12, color: "#e07070", marginBottom: 14, cursor: "pointer",
            }} onClick={() => setError(null)}>
              {error} <span style={{ float: "right", opacity: 0.5 }}>✕</span>
            </div>
          )}

          {/* 列表 */}
          {loading ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: "rgba(255,255,255,0.2)", fontSize: 13 }}>
              正在拉取…
            </div>
          ) : memories.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 0" }}>
              <div style={{ color: "rgba(255,255,255,0.15)", fontSize: 13, marginBottom: 12 }}>没有记忆</div>
              <button
                onClick={() => setDrawerState({ mode: "create", memory: EMPTY_MEMORY })}
                style={{
                  background: "rgba(107,127,212,0.1)", border: "1px solid rgba(107,127,212,0.3)",
                  borderRadius: 6, color: "#a0adec", padding: "8px 20px", cursor: "pointer",
                  fontSize: 12, fontFamily: "inherit",
                }}>写下第一条</button>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 10 }}>
              {memories.map(m => (
                <div key={m.id} style={{ animation: "fadeUp 0.25s ease both" }}>
                  <MemoryCard
                    mem={m}
                    onEdit={(mem) => setDrawerState({ mode: "edit", memory: mem })}
                    onDelete={handleDelete}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {drawerState && (
          <MemoryDrawer
            memory={drawerState.memory}
            isNew={drawerState.mode === "create"}
            onSave={handleSave}
            onClose={() => setDrawerState(null)}
          />
        )}
      </div>
    </>
  );
}
