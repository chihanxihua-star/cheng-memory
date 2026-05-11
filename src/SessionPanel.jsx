import { useEffect, useState, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { supabase } from "./lib/supabase";

// 与 ChatPanel 一致：所有 /api/* 带 Bearer token
const API_BASE = "https://chat.jessaminee.top";
const AUTH_TOKEN_KEY = "memhome-auth-token";
function authedFetch(url, opts = {}) {
  const t = localStorage.getItem(AUTH_TOKEN_KEY) || "";
  const headers = { ...(opts.headers || {}) };
  if (t) headers.Authorization = "Bearer " + t;
  return fetch(url, { ...opts, headers });
}
function fmtK(n) {
  n = Number(n) || 0;
  if (n < 1000) return String(n);
  const k = n / 1000;
  return (k === Math.floor(k) ? k : Math.round(k * 10) / 10) + "k";
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

/* forge 配置卡：和 session 卡同样的边框与背景，标题加图标占位 */
.sp-forge-card {
  border: 1px solid var(--border-primary, #E0D8CE);
  background: var(--bg-secondary, #fff);
  padding: 14px 16px;
  margin: 0 0 16px;
}
.sp-root[data-theme="dark"] .sp-forge-card {
  background: #2a2a2c; border-color: #3a3a3c;
}
.sp-forge-title {
  font-size: 13px; letter-spacing: 0.1em;
  color: var(--text-secondary, #6b6358);
  margin-bottom: 12px;
  display: flex; align-items: center; gap: 6px;
}
.sp-forge-hint {
  font-size: 11.5px; color: var(--text-tertiary, #999);
  margin-bottom: 12px; line-height: 1.55;
}
.sp-forge-row {
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 10px;
  font-size: 13px;
}
.sp-forge-row label {
  flex: 0 0 96px;
  color: var(--text-primary, #2B2925);
}
.sp-forge-row input {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px; font-family: inherit;
  color: var(--text-primary, #2B2925);
  background: var(--bg-primary, #FAF6F0);
  border: 1px solid var(--border-primary, #E0D8CE);
  border-radius: 0;
  padding: 5px 8px;
  outline: none;
}
.sp-root[data-theme="dark"] .sp-forge-row input {
  background: #1c1c1e; border-color: #3a3a3c; color: #f0ece6;
}
.sp-forge-row .sp-forge-k {
  flex: 0 0 auto;
  font-size: 11.5px; color: var(--text-tertiary, #999);
  min-width: 44px; text-align: right;
}
.sp-forge-actions {
  display: flex; justify-content: flex-end; align-items: center; gap: 10px;
  margin-top: 6px;
}
.sp-forge-msg {
  flex: 1 1 auto;
  font-size: 11.5px;
  color: var(--text-tertiary, #999);
}
.sp-forge-msg.err { color: #d87878; }
.sp-forge-msg.ok { color: var(--sp-pink); }
.sp-forge-save {
  background: var(--sp-pink);
  color: #fff;
  border: none;
  padding: 6px 14px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  border-radius: 0;
  letter-spacing: 0.05em;
}
.sp-forge-save:disabled {
  opacity: 0.5; cursor: not-allowed;
}
`;

export default function SessionPanel({ onClose, theme = "light" }) {
  const [sessions, setSessions] = useState([]);
  const [expanded, setExpanded] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [editingSid, setEditingSid] = useState(null);
  const [nameDraft, setNameDraft] = useState("");

  // forge 配置：retain_tokens / trigger_threshold
  const [forgeCfg, setForgeCfg] = useState(null); // {retain_tokens, trigger_threshold}
  const [forgeDraft, setForgeDraft] = useState({ retain_tokens: "", trigger_threshold: "" });
  const [forgeSaving, setForgeSaving] = useState(false);
  const [forgeMsg, setForgeMsg] = useState({ text: "", level: "" }); // level: ok / err / ""

  const fetchForgeCfg = useCallback(async () => {
    try {
      const r = await authedFetch(API_BASE + "/api/forge/config");
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      setForgeCfg(d);
      setForgeDraft({
        retain_tokens: String(d.retain_tokens ?? ""),
        trigger_threshold: String(d.trigger_threshold ?? ""),
      });
    } catch (e) {
      setForgeMsg({ text: "读取配置失败：" + (e?.message || e), level: "err" });
    }
  }, []);

  useEffect(() => { fetchForgeCfg(); }, [fetchForgeCfg]);

  const forgeDirty = useMemo(() => {
    if (!forgeCfg) return false;
    return String(forgeCfg.retain_tokens) !== forgeDraft.retain_tokens
      || String(forgeCfg.trigger_threshold) !== forgeDraft.trigger_threshold;
  }, [forgeCfg, forgeDraft]);

  const saveForgeCfg = useCallback(async () => {
    const retain = Number(forgeDraft.retain_tokens);
    const trigger = Number(forgeDraft.trigger_threshold);
    if (!Number.isFinite(retain) || retain <= 0 || !Number.isFinite(trigger) || trigger <= 0) {
      setForgeMsg({ text: "请输入正整数", level: "err" });
      return;
    }
    if (trigger <= retain) {
      setForgeMsg({ text: "触发阈值必须大于保留 tokens", level: "err" });
      return;
    }
    setForgeSaving(true);
    setForgeMsg({ text: "", level: "" });
    try {
      const r = await authedFetch(API_BASE + "/api/forge/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retain_tokens: retain, trigger_threshold: trigger }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "HTTP " + r.status);
      setForgeCfg({ retain_tokens: d.retain_tokens, trigger_threshold: d.trigger_threshold });
      setForgeDraft({
        retain_tokens: String(d.retain_tokens),
        trigger_threshold: String(d.trigger_threshold),
      });
      setForgeMsg({ text: "已保存（daemon 下个轮询周期生效）", level: "ok" });
    } catch (e) {
      setForgeMsg({ text: "保存失败：" + (e?.message || e), level: "err" });
    } finally {
      setForgeSaving(false);
    }
  }, [forgeDraft]);

  const fetchSessions = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("sessions_cheng")
        .select("session_id, name, started_at, ended_at, turn_count, status, summary, forged_from_session")
        .order("created_at", { ascending: false })
        .limit(20);
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

  return createPortal(
    <div className="sp-root" data-theme={theme}>
      <style>{STYLES}</style>
      <div className="sp-header">
        <span className="sp-title">SESSIONS</span>
        <button className="sp-close" onClick={onClose} aria-label="close">×</button>
      </div>

      <div className="sp-body">
        {/* forge 配置卡：触发阈值（daemon 监控）+ 保留 tokens（forge 截断点 / 重选模型时整段保留 if ≤ retain） */}
        <div className="sp-forge-card">
          <div className="sp-forge-title">♥ FORGE 配置</div>
          <div className="sp-forge-hint">
            选模型即触发锻造重启。当前 tokens 大于「保留」时截尾保留最后 N tokens，否则全部保留不截断。
            自动锻造在 tokens 超过「触发阈值」时由 daemon 触发，逻辑不变。
          </div>
          <div className="sp-forge-row">
            <label>保留 tokens</label>
            <input
              type="number" min="1" step="1000"
              value={forgeDraft.retain_tokens}
              onChange={e => setForgeDraft(d => ({ ...d, retain_tokens: e.target.value }))}
              placeholder="100000"
            />
            <span className="sp-forge-k">{fmtK(forgeDraft.retain_tokens)}</span>
          </div>
          <div className="sp-forge-row">
            <label>触发阈值</label>
            <input
              type="number" min="1" step="1000"
              value={forgeDraft.trigger_threshold}
              onChange={e => setForgeDraft(d => ({ ...d, trigger_threshold: e.target.value }))}
              placeholder="200000"
            />
            <span className="sp-forge-k">{fmtK(forgeDraft.trigger_threshold)}</span>
          </div>
          <div className="sp-forge-actions">
            <span className={"sp-forge-msg " + forgeMsg.level}>{forgeMsg.text}</span>
            <button
              className="sp-forge-save"
              disabled={!forgeDirty || forgeSaving || !forgeCfg}
              onClick={saveForgeCfg}
            >{forgeSaving ? "保存中…" : "保存"}</button>
          </div>
        </div>

        {loading && sessions.length === 0 && (
          <div className="sp-loading">加载中…</div>
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
                      <span className="sp-head-turn">{activeSession?.turn_count || 0} turn</span>
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
                      {activeSession.turn_count || 0} turn
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
                  <span className="sp-head-turn">{s.turn_count || 0} turn</span>
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
                    <span className="sp-detail-turn">{s.turn_count || 0} turn</span>
                  </div>
                  <div className="sp-detail-summary">
                    {s.summary || <span className="sp-detail-empty">无总结</span>}
                  </div>
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
