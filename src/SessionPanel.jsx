import { useEffect, useState, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { supabase } from "./lib/supabase";

function fmtSessionTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

const STYLES = `
.sp-root {
  position: fixed; inset: 0; z-index: 200;
  background: var(--bg-primary, #FAF6F0);
  display: flex; flex-direction: column;
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
  color: var(--text-primary, #2B2925);
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

/* Session 卡片：统一格式，活跃和已结束只是颜色/标记不同 */
.sp-card {
  border: 1px solid var(--border-primary, #E0D8CE);
  border-radius: 12px;
  padding: 14px 16px;
  margin: 0 0 12px;
  background: var(--bg-secondary, #fff);
  transition: border-color 0.15s ease;
}
.sp-root[data-theme="dark"] .sp-card {
  background: #2a2a2c; border-color: #3a3a3c;
}
.sp-card.active {
  border-color: var(--border-input-focus, #C9A8AD);
  background: var(--bg-bubble-user, #F2DCE0);
}
.sp-root[data-theme="dark"] .sp-card.active {
  background: rgba(201, 168, 173, 0.15);
  border-color: rgba(201, 168, 173, 0.5);
}
.sp-card-head {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  font-size: 13px;
}
.sp-card.ended .sp-card-head { cursor: pointer; user-select: none; }
.sp-dot { font-size: 13px; line-height: 1; flex-shrink: 0; }
.sp-card.active .sp-dot { color: var(--border-input-focus, #C9A8AD); }
.sp-card.ended .sp-dot { color: var(--text-tertiary, #999); }
.sp-range {
  color: var(--text-primary, #2B2925);
  font-weight: 500;
}
.sp-meta {
  color: var(--text-tertiary, #999);
  font-size: 12px;
}
.sp-status-active {
  color: var(--border-input-focus, #C9A8AD);
  font-weight: 500;
}
.sp-toggle {
  margin-left: auto; font-size: 11.5px;
  color: var(--text-tertiary, #999);
}
.sp-card-head:hover .sp-toggle { color: var(--text-secondary, #6b6358); }

.sp-card-body {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--border-primary, #E0D8CE);
  font-size: 12.5px;
  color: var(--text-secondary, #6b6358);
}
.sp-card.active .sp-card-body {
  border-top-color: rgba(201, 168, 173, 0.4);
}
.sp-card-body-hint {
  font-style: italic;
  color: var(--text-tertiary, #999);
}

.sp-summary {
  margin-top: 8px;
  padding: 12px 14px;
  background: var(--bg-bubble-bot, #fff);
  border: 1px solid var(--border-primary, #E0D8CE);
  border-radius: 8px;
}
.sp-root[data-theme="dark"] .sp-summary {
  background: #1c1c1e; border-color: #3a3a3c;
}
.sp-summary-head {
  font-size: 11.5px; color: var(--text-tertiary, #999);
  margin-bottom: 6px; letter-spacing: 0.05em;
}
.sp-summary-body {
  font-size: 13px; line-height: 1.65;
  color: var(--text-primary, #2B2925);
  white-space: pre-wrap; word-break: break-word;
}
.sp-summary-empty {
  font-size: 12px; color: var(--text-tertiary, #999); font-style: italic;
}
`;

export default function SessionPanel({ onClose, theme = "light" }) {
  const [sessions, setSessions] = useState([]);
  const [expanded, setExpanded] = useState(() => new Set());
  const [loading, setLoading] = useState(true);

  const fetchSessions = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("sessions_cheng")
        .select("session_id, started_at, ended_at, turn_count, status, summary, forged_from_session")
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

        {/* 当前 session 卡（始终显示，无 active 行时降级展示） */}
        <div className="sp-card active">
          <div className="sp-card-head">
            <span className="sp-dot">●</span>
            <span className="sp-range">
              {activeSession ? `${fmtSessionTime(activeSession.started_at)} - 当前` : "— · 当前"}
            </span>
            <span className="sp-meta">
              {activeSession?.turn_count ? `${activeSession.turn_count} turn` : "0 turn"}
              {" · "}
              <span className="sp-status-active">活跃</span>
            </span>
          </div>
          <div className="sp-card-body">
            <span className="sp-card-body-hint">实时聊天消息在主界面，此处不重复显示</span>
          </div>
        </div>

        {/* 历史 sessions */}
        {endedSessions.map(s => {
          const isOpen = expanded.has(s.session_id);
          return (
            <div key={s.session_id} className="sp-card ended">
              <div className="sp-card-head" onClick={() => toggle(s.session_id)}>
                <span className="sp-dot">○</span>
                <span className="sp-range">
                  {fmtSessionTime(s.started_at)} - {fmtSessionTime(s.ended_at)}
                </span>
                <span className="sp-meta">
                  {s.turn_count || 0} turn · 已结束
                </span>
                <span className="sp-toggle">
                  {isOpen ? "▼ 收起" : "▶ 展开查看总结"}
                </span>
              </div>
              {isOpen && (
                <div className="sp-summary">
                  {s.summary ? (
                    <>
                      <div className="sp-summary-head">本段对话总结 · {fmtSessionTime(s.ended_at)}</div>
                      <div className="sp-summary-body">{s.summary}</div>
                    </>
                  ) : (
                    <div className="sp-summary-empty">无总结</div>
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
