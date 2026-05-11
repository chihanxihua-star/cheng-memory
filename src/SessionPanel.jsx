import { useEffect, useState, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { supabase } from "./lib/supabase";

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
/* 头部右侧统计：turn 数 + toggle */
.sp-head-stats {
  margin-left: auto;
  display: flex; align-items: center; gap: 10px;
  flex-shrink: 0;
}
.sp-head-turn {
  font-size: 12px; color: var(--text-tertiary, #999);
}
.sp-toggle {
  font-size: 13px;
  color: var(--text-tertiary, #999);
  display: inline-block;
  width: 14px; text-align: center;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.sp-card-head:hover .sp-toggle { color: var(--text-secondary, #6b6358); }

.sp-delete {
  background: none; border: none;
  color: var(--text-tertiary, #999);
  font-size: 11px; cursor: pointer;
  padding: 2px 6px; margin-left: 8px;
  border-radius: 4px;
  transition: color 0.15s ease, background 0.15s ease;
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
`;

export default function SessionPanel({ onClose, theme = "light" }) {
  const [sessions, setSessions] = useState([]);
  const [expanded, setExpanded] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [editingSid, setEditingSid] = useState(null);
  const [nameDraft, setNameDraft] = useState("");

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
                  <span className="sp-head-stats">
                    <span className="sp-head-turn">{activeSession?.turn_count || 0} turn</span>
                    <span className="sp-toggle">{isOpen ? "v" : ">"}</span>
                  </span>
                )}
              </div>
              {sid && isOpen && (
                <div className="sp-detail">
                  <div className="sp-detail-row">
                    <span className="sp-detail-range">
                      {fmtSessionTime(activeSession.started_at)} - 当前
                    </span>
                    <span className="sp-detail-turn">
                      <span className="sp-status-active">活跃中</span>
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
                <span className="sp-head-stats">
                  <span className="sp-head-turn">{s.turn_count || 0} turn</span>
                  <span className="sp-toggle">{isOpen ? "v" : ">"}</span>
                </span>
              </div>
              {isOpen && (
                <div className="sp-detail">
                  <div className="sp-detail-row">
                    <span className="sp-detail-range">
                      {fmtSessionTime(s.started_at)} - {fmtSessionTime(s.ended_at)}
                    </span>
                    <button
                      className="sp-delete"
                      onClick={(e) => { e.stopPropagation(); deleteSession(s.session_id); }}
                      title="删除这条 session"
                    >删除</button>
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
