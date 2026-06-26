import { useState, useEffect, useCallback } from "react";

const API_BASE = "https://chat.jessaminee.top";

async function apiFetch(path, opts = {}) {
  const token = localStorage.getItem("memhome-auth-token") || "";
  const r = await fetch(API_BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, ...(opts.headers || {}) },
  });
  return r.json();
}

export default function IntimateToolbar() {
  const [open, setOpen] = useState(false);
  const [toys, setToys] = useState([]);
  const [positions, setPositions] = useState([]);
  const [activeToys, setActiveToys] = useState([]);
  const [activePos, setActivePos] = useState("");
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, p, s] = await Promise.all([
        apiFetch("/api/pulse/toys"),
        apiFetch("/api/pulse/positions"),
        apiFetch("/api/pulse/intimate/state"),
      ]);
      setToys(Array.isArray(t) ? t : []);
      setPositions(Array.isArray(p) ? p : []);
      setState(s);
      if (s?.activeToys) setActiveToys(s.activeToys);
      if (s?.activePosition) setActivePos(s.activePosition);
    } catch {}
  }, []);

  useEffect(() => { if (open) load(); }, [open, load]);

  const toggleToy = async (key) => {
    const next = activeToys.includes(key) ? activeToys.filter(k => k !== key) : [...activeToys, key];
    setActiveToys(next);
    setBusy(true);
    await apiFetch("/api/pulse/intimate/toys", { method: "POST", body: JSON.stringify({ toys: next }) });
    setBusy(false);
  };

  const pickPos = async (key) => {
    const next = activePos === key ? "" : key;
    setActivePos(next);
    setBusy(true);
    await apiFetch("/api/pulse/intimate/position", { method: "POST", body: JSON.stringify({ position: next || null }) });
    setBusy(false);
  };

  const endIntimate = async () => {
    setBusy(true);
    try {
      await apiFetch("/api/pulse/intimate/exit", { method: "POST", body: JSON.stringify({ manual: true }) });
      setActiveToys([]);
      setActivePos("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={toggleBtn} title="亲密设置">
        <span style={{ fontSize: 14 }}>♡</span>
      </button>
    );
  }

  const isActive = state?.active;

  return (
    <div style={panel}>
      <div style={header}>
        <span style={titleStyle}>
          {isActive ? `♡ ${state.stage !== undefined ? ['前戏','挑逗','兴奋','强烈','高潮前','高潮','余韵','平复'][state.stage] || '' : ''} · 体力 ${Math.round(state.stamina || 0)}` : '♡ 亲密设置'}
        </span>
        <button onClick={() => setOpen(false)} style={closeBtn}>✕</button>
      </div>

      <div style={section}>
        <div style={label}>道具 <span style={hint}>(点击选用)</span></div>
        <div style={chipRow}>
          {toys.map(t => (
            <button key={t.toy_key} onClick={() => toggleToy(t.toy_key)} disabled={busy}
              style={activeToys.includes(t.toy_key) ? chipActive : chip}>
              {t.label}
            </button>
          ))}
          {toys.length === 0 && <span style={hint}>无道具</span>}
        </div>
      </div>

      <div style={section}>
        <div style={label}>体位 <span style={hint}>(点击切换)</span></div>
        <div style={chipRow}>
          {positions.map(p => (
            <button key={p.position_key} onClick={() => pickPos(p.position_key)} disabled={busy}
              style={activePos === p.position_key ? chipActive : chip}>
              {p.label}
            </button>
          ))}
          {positions.length === 0 && <span style={hint}>无体位</span>}
        </div>
      </div>
      {isActive && (
        <div style={footer}>
          <button onClick={endIntimate} disabled={busy} style={endingBtn}>ending</button>
        </div>
      )}
    </div>
  );
}

const toggleBtn = {
  position: "absolute", right: 8, top: -28, zIndex: 10,
  width: 26, height: 26, borderRadius: 13,
  border: "1px solid rgba(180,140,150,0.3)", background: "rgba(255,255,255,0.8)",
  cursor: "pointer", display: "grid", placeItems: "center",
  color: "#a06b72", fontSize: 12, fontFamily: "inherit",
};
const panel = {
  background: "rgba(255,250,248,0.95)", borderRadius: "12px 12px 0 0",
  border: "1px solid rgba(180,140,150,0.2)", borderBottom: "none",
  padding: "8px 12px 6px", marginBottom: 0,
  backdropFilter: "blur(8px)",
};
const header = { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 };
const titleStyle = { fontSize: 12, fontWeight: 500, color: "#a06b72", letterSpacing: "0.04em" };
const closeBtn = { border: "none", background: "transparent", fontSize: 14, color: "#a06b72", cursor: "pointer", padding: "0 2px" };
const section = { marginBottom: 6 };
const label = { fontSize: 11, color: "#8a7a7e", marginBottom: 4 };
const hint = { fontSize: 10, color: "#bbb" };
const chipRow = { display: "flex", gap: 5, flexWrap: "wrap" };
const chip = {
  fontSize: 11, padding: "3px 10px", borderRadius: 12,
  border: "1px solid rgba(180,140,150,0.25)", background: "rgba(255,255,255,0.6)",
  color: "#8a7a7e", cursor: "pointer", fontFamily: "inherit",
};
const chipActive = {
  ...chip,
  background: "rgba(180,140,150,0.15)", borderColor: "#a06b72", color: "#a06b72", fontWeight: 500,
};
const footer = { display: "flex", justifyContent: "flex-end", marginTop: 2 };
const endingBtn = {
  fontSize: 10,
  padding: "2px 9px",
  borderRadius: 10,
  border: "1px solid rgba(160,107,114,0.22)",
  background: "rgba(255,255,255,0.55)",
  color: "#a06b72",
  cursor: "pointer",
  fontFamily: "inherit",
};
