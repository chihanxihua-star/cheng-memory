import { useEffect, useState, useCallback, useRef } from "react";

const API = "https://chat.jessaminee.top/api";
function wpFetch(url, opts = {}) {
  const t = localStorage.getItem("memhome-auth-token") || "";
  const headers = { ...(opts.headers || {}) };
  if (t) headers.Authorization = "Bearer " + t;
  return fetch(url, { ...opts, headers });
}

function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const u = new Date(d.getTime() + 8 * 3600000);
  const mm = String(u.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(u.getUTCDate()).padStart(2, "0");
  const hh = String(u.getUTCHours()).padStart(2, "0");
  const mi = String(u.getUTCMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

function fmtHours(h) {
  if (h == null) return "—";
  if (h < 1) return `${Math.round(h * 60)}分钟`;
  return `${h.toFixed(1)}小时`;
}

const STYLES = `
.wp-root {
  position: fixed; inset: 0; z-index: 200;
  background: var(--bg-primary, #FAF6F0);
  display: flex; flex-direction: column;
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
  font-family: 'Noto Serif SC', Georgia, serif;
  color: var(--text-primary, #2B2925);
}
.wp-root[data-theme="dark"] {
  background: #1c1c1e;
  color: #f0ece6;
}
.wp-header {
  flex-shrink: 0;
  padding: 14px 16px;
  display: grid; grid-template-columns: 1fr auto 1fr; align-items: center;
  background: transparent;
  border-bottom: none;
}
/* 涟漪式三段导航：CANCEL / 居中标题 / 深色 SAVE✓ */
.wp-cancel {
  background: none; border: none; color: var(--text-secondary, #6b6358);
  font-size: 12px; letter-spacing: 0.18em; cursor: pointer;
  font-family: inherit; padding: 0; justify-self: start;
  transition: color .15s;
}
.wp-cancel:hover { color: var(--text-primary, #2B2925); }
.wp-navtitle {
  font-size: 13px; color: var(--text-primary, #2B2925);
  letter-spacing: 0.22em; white-space: nowrap; justify-self: center;
}
.wp-send {
  justify-self: end;
  background: var(--text-primary, #2B2925); color: var(--bg-page, #FAF6F0);
  border: 1px solid var(--text-primary, #2B2925);
  padding: 8px 18px; border-radius: 4px;
  font-size: 12px; letter-spacing: 0.18em;
  cursor: pointer; font-family: inherit;
}
.wp-send:active { opacity: 0.85; }
.wp-send-placeholder { justify-self: end; }
.wp-tabsrow {
  display: flex; justify-content: center;
  padding: 6px 0 10px; flex-shrink: 0;
  background: transparent;
}
.wp-tabs {
  display: inline-flex; gap: 4px;
  padding: 4px; border: none;
  background: var(--bg-card, #fff);
  border-radius: 12px;
}
.wp-tab {
  flex: none; text-align: center;
  padding: 7px 22px; font-size: 13px;
  cursor: pointer; border: none; background: transparent;
  color: var(--text-secondary, #6b6358);
  font-family: inherit; letter-spacing: 0.08em;
  border-radius: 9px; white-space: nowrap;
  transition: color .15s, background .15s;
}
.wp-tab.active {
  color: var(--text-primary, #2B2925);
  background: var(--bg-card-solid, #fff);
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}
.wp-body {
  flex: 1; min-height: 0; overflow-y: auto;
  -webkit-overflow-scrolling: touch; overscroll-behavior: contain;
  padding: 14px 14px 24px;
  width: 100%; max-width: 600px; margin: 0 auto;
}
.wp-loading, .wp-empty {
  text-align: center;
  color: var(--text-tertiary, #999);
  font-size: 13px;
  padding: 40px 0;
}

/* 叹息日志条目 */
.wp-log-item {
  padding: 10px 12px;
  margin: 0 0 8px;
  border-radius: 6px;
  font-size: 12.5px;
  line-height: 1.7;
  background: var(--bg-secondary, #fff);
  border: 1px solid var(--border-primary, #E0D8CE);
}
.wp-root[data-theme="dark"] .wp-log-item {
  background: #252527; border-color: #3a3a3c;
}
.wp-log-time {
  color: var(--text-tertiary, #999);
  font-size: 11px;
  margin-right: 6px;
}
.wp-log-dice {
  margin-right: 4px;
}
.wp-log-miss {
  opacity: 0.45;
}
.wp-log-skip {
  color: var(--text-tertiary, #999);
}
.wp-log-skip .wp-log-sigh {
  font-style: italic;
  opacity: 0.7;
}
.wp-log-send {
  color: #4a9e6d;
}
.wp-root[data-theme="dark"] .wp-log-send {
  color: #6dc98f;
}
.wp-log-msg {
  display: block;
  margin-top: 4px;
  padding: 6px 10px;
  border-radius: 4px;
  background: rgba(74, 158, 109, 0.08);
  font-size: 12px;
  color: var(--text-primary, #2B2925);
}
.wp-root[data-theme="dark"] .wp-log-msg {
  background: rgba(109, 201, 143, 0.1);
  color: #f0ece6;
}
.wp-log-prob {
  font-size: 11px;
  color: var(--text-tertiary, #999);
  margin-left: 4px;
}
.wp-log-thinking-toggle {
  display: inline-block;
  margin-left: 6px;
  font-size: 11px;
  color: var(--text-tertiary, #999);
  cursor: pointer;
  user-select: none;
}
.wp-log-thinking {
  display: block;
  margin-top: 4px;
  padding: 6px 10px;
  border-radius: 4px;
  background: rgba(120, 120, 140, 0.08);
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--text-secondary, #6b6358);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow-y: auto;
}
.wp-root[data-theme="dark"] .wp-log-thinking {
  background: rgba(200, 200, 220, 0.08);
  color: #b0aca4;
}

/* 渴望度 tab */
.wp-desire {
  padding: 20px 4px;
}
.wp-desire-label {
  font-size: 12px;
  color: var(--text-secondary, #6b6358);
  margin-bottom: 6px;
  display: flex; justify-content: space-between; align-items: baseline;
}
.wp-desire-value {
  font-size: 18px;
  font-weight: 500;
  color: var(--text-primary, #2B2925);
}
.wp-root[data-theme="dark"] .wp-desire-value {
  color: #f0ece6;
}
.wp-slider-wrap {
  margin: 24px 0 30px;
}
.wp-field-label {
  display: block; font-size: 11px;
  color: var(--text-secondary, #6b6358);
  letter-spacing: 0.06em;
}
.wp-slider-labels {
  display: flex; justify-content: space-between;
  font-size: 10px;
  color: var(--text-tertiary, #999);
  margin-top: 6px;
}
/* 极简发丝 slider —— 对齐涟漪「新涟漪」的 .cm-slider */
.wp-slider {
  -webkit-appearance: none; appearance: none;
  width: 100%; height: 1px; padding: 0; margin: 10px 0 0;
  background: var(--border, #E0D8CE); border: none; outline: none; cursor: pointer;
}
.wp-slider::-webkit-slider-runnable-track { height: 1px; background: var(--border, #E0D8CE); }
.wp-slider::-moz-range-track { height: 1px; background: var(--border, #E0D8CE); }
.wp-slider::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 14px; height: 14px; border-radius: 50%;
  background: var(--text-primary, #2B2925); border: none; cursor: pointer;
  margin-top: -7px;
}
.wp-slider::-moz-range-thumb {
  width: 14px; height: 14px; border-radius: 50%;
  background: var(--text-primary, #2B2925); border: none; cursor: pointer;
}
.wp-stat-row {
  display: flex; justify-content: space-between;
  padding: 12px 0;
  font-size: 13px;
}
.wp-stat-key {
  color: var(--text-secondary, #6b6358);
}
.wp-stat-val {
  color: var(--text-primary, #2B2925);
  font-variant-numeric: tabular-nums;
}
.wp-root[data-theme="dark"] .wp-stat-val {
  color: #f0ece6;
}
.wp-load-more {
  text-align: center; padding: 12px 0;
}
.wp-load-more button {
  background: none; border: 1px solid var(--border-primary, #E0D8CE);
  color: var(--text-tertiary, #999); font-size: 12px;
  padding: 6px 16px; border-radius: 4px; cursor: pointer;
  font-family: inherit;
}
.wp-root[data-theme="dark"] .wp-load-more button {
  border-color: #3a3a3c;
}
`;

function ThinkingBlock({ text }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <>
      <span className="wp-log-thinking-toggle" onClick={() => setOpen(v => !v)}>
        {open ? '▾ 收起思绪' : '▸ 思绪'}
      </span>
      {open && <span className="wp-log-thinking">{text}</span>}
    </>
  );
}

function LogItem({ row }) {
  const time = fmtTime(row.created_at);
  const prob = `t=${fmtHours(row.t_hours)}, P=${row.probability != null ? (row.probability * 100).toFixed(0) + '%' : '—'}, roll=${row.roll != null ? row.roll.toFixed(2) : '—'}`;

  if (!row.hit) {
    return (
      <div className="wp-log-item wp-log-miss">
        <span className="wp-log-time">{time}</span>
        <span className="wp-log-dice">🎲</span>
        未命中
        <span className="wp-log-prob">({prob})</span>
      </div>
    );
  }

  if (row.judgment === 'send') {
    return (
      <div className="wp-log-item wp-log-send">
        <span className="wp-log-time">{time}</span>
        <span className="wp-log-dice">🎲</span>
        命中 → 发消息
        <span className="wp-log-prob">({prob})</span>
        {row.message_sent && <span className="wp-log-msg">{row.message_sent}</span>}
        <ThinkingBlock text={row.thinking} />
      </div>
    );
  }

  const reasonText = row.judgment === 'skip_night' ? '她应该在睡觉'
    : row.judgment === 'skip_busy' ? `她在忙`
    : row.judgment === 'skip_cc' ? '决定不说'
    : row.judgment === 'skip_busy_cc' ? 'CC 正忙'
    : row.reason || '跳过';

  return (
    <div className="wp-log-item wp-log-skip">
      <span className="wp-log-time">{time}</span>
      <span className="wp-log-dice">🎲</span>
      命中 → {reasonText}
      <span className="wp-log-sigh"> (叹气)</span>
      <span className="wp-log-prob">({prob})</span>
      <ThinkingBlock text={row.thinking} />
    </div>
  );
}

function SighLogTab() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);

  const load = useCallback(async (before) => {
    try {
      let url = API + "/dice/log?limit=50";
      if (before) url += "&before=" + encodeURIComponent(before);
      const r = await wpFetch(url);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const data = await r.json();
      if (!before) setLogs(data);
      else setLogs(prev => [...prev, ...data]);
      setHasMore(data.length >= 50);
    } catch (e) {
      console.error("加载叹息日志失败:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="wp-loading">加载中…</div>;
  if (!logs.length) return <div className="wp-empty">还没有记录</div>;

  return (
    <>
      {logs.map(row => <LogItem key={row.id} row={row} />)}
      {hasMore && (
        <div className="wp-load-more">
          <button onClick={() => load(logs[logs.length - 1].created_at)}>加载更多</button>
        </div>
      )}
    </>
  );
}

function DesireTab({ showToast, saveRef }) {
  const [status, setStatus] = useState(null);
  const [lambda, setLambda] = useState(0.15);
  const [intMin, setIntMin] = useState(30);
  const [intMax, setIntMax] = useState(50);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [rc, rs] = await Promise.all([
          wpFetch(API + "/dice/config"),
          wpFetch(API + "/dice/status"),
        ]);
        const cfg = await rc.json();
        const st = await rs.json();
        if (alive) {
          setLambda(cfg.lambda || 0.15);
          setIntMin(cfg.dice_interval_min ?? 30);
          setIntMax(cfg.dice_interval_max ?? 50);
          setStatus(st);
        }
      } catch (e) {
        console.error("加载渴望度失败:", e);
      }
    })();
    return () => { alive = false; };
  }, []);

  const currentP = status?.t_hours != null
    ? 1 - Math.exp(-lambda * status.t_hours)
    : null;

  const save = async () => {
    setSaving(true);
    try {
      const finalMin = Math.min(intMin, intMax);
      const finalMax = Math.max(intMin, intMax);
      const r = await wpFetch(API + "/dice/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lambda, dice_interval_min: finalMin, dice_interval_max: finalMax }),
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      showToast("已保存");
    } catch (e) {
      showToast("保存失败: " + e.message);
    } finally {
      setSaving(false);
    }
  };
  if (saveRef) saveRef.current = save;

  return (
    <div className="wp-desire">
      <div className="wp-slider-wrap">
        <label className="wp-field-label">渴望度</label>
        <input
          type="range"
          className="wp-slider"
          min={0.15} max={1.0} step={0.01}
          value={lambda}
          onChange={e => setLambda(parseFloat(e.target.value))}
        />
        <div className="wp-slider-labels">
          <span>佛系</span>
          <span>主动</span>
        </div>
      </div>

      <div className="wp-stat-row">
        <span className="wp-stat-key">λ</span>
        <span className="wp-stat-val">{lambda.toFixed(2)}</span>
      </div>
      <div className="wp-stat-row">
        <span className="wp-stat-key">距上次消息</span>
        <span className="wp-stat-val">{fmtHours(status?.t_hours)}</span>
      </div>
      <div className="wp-stat-row">
        <span className="wp-stat-key">当前命中概率</span>
        <span className="wp-stat-val">{currentP != null ? (currentP * 100).toFixed(1) + '%' : '—'}</span>
      </div>

      <div className="wp-slider-wrap" style={{ marginTop: 24 }}>
        <label className="wp-field-label">轮询下限 — {intMin} 分钟</label>
        <input type="range" className="wp-slider" min={5} max={120} step={5}
          value={intMin} onChange={e => setIntMin(parseInt(e.target.value))} />
      </div>
      <div className="wp-slider-wrap">
        <label className="wp-field-label">轮询上限 — {intMax} 分钟</label>
        <input type="range" className="wp-slider" min={5} max={120} step={5}
          value={intMax} onChange={e => setIntMax(parseInt(e.target.value))} />
      </div>
    </div>
  );
}

export default function WakePanel({ onClose, theme, showToast }) {
  const [tab, setTab] = useState("log");
  const saveRef = useRef(null);

  return (
    <>
      <style>{STYLES}</style>
      <div className="wp-root" data-theme={theme}>
        <div className="wp-header">
          <button className="wp-cancel" onClick={onClose}>CANCEL</button>
          <span className="wp-navtitle">唤醒</span>
          {tab === "desire"
            ? <button className="wp-send" onClick={() => saveRef.current?.()}>SAVE ✓</button>
            : <span className="wp-send-placeholder" />}
        </div>
        <div className="wp-tabsrow">
          <div className="wp-tabs">
            <button className={"wp-tab" + (tab === "log" ? " active" : "")} onClick={() => setTab("log")}>
              叹息日志
            </button>
            <button className={"wp-tab" + (tab === "desire" ? " active" : "")} onClick={() => setTab("desire")}>
              渴望度
            </button>
          </div>
        </div>
        <div className="wp-body">
          {tab === "log" ? <SighLogTab /> : <DesireTab showToast={showToast} saveRef={saveRef} />}
        </div>
      </div>
    </>
  );
}
