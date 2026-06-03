/*
 * DeskPet —— 澄的桌宠（clawd 小螃蟹）。照 clawd-on-desk 原版行为做。
 *
 * 美术：clawd 官方 SVG（public/pet/*.svg，见 ART-LICENSE.txt 署名）。
 *   ⚠️ 仅本人个人·非商用·密码门内使用，勿公开宣传/商用。SVG 自带 CSS 动画、矢量、体积小。
 * 机制：澄的活动从 ChatPanel 现成 WS 信号推导；睡眠/醒靠"用户鼠标静止/活动"计时。纯前端、不碰后端。
 *
 * 原版逻辑（照 tick.js / state.js / theme.json）：
 *  · 状态(澄): idle/thinking/typing/building/carrying/juggling/conducting/error/notification/sweeping/happy
 *      其中 happy=4s, error=5s, notification=5s, sweeping=5.5s, carrying=3s 最短显示后自动回落
 *  · 睡眠(鼠标静止计时，动一下重置)：20s→随机播一次 idle动作(张望/冒泡/看书) · 60s→哈欠(3s)→犯困 · 10min→深睡
 *      鼠标一动 → 醒(wake 1.5s)→idle
 *  · 点击彩蛋(仅 idle)：戳2~3下→50%不耐烦/否则朝戳侧歪头(2.5s)；连戳4下+→蹦跳(3.5s)；拖→被拎起
 *  · 极简：拖到屏幕边→贴边；hover→探头招手；按澄状态变(干活/完成/睡/提醒/进场)；闲着随机沿边溜达
 *  · 眼球追踪未做：平面 <img> 无法追鼠标(原版靠分层 SVG + JS)，与"直接用原版图"二选一。
 *
 * 接入：<DeskPet signals={{ isGenerating, streamSnap, ccStatus }} />
 */
import { useEffect, useRef, useState, useCallback } from "react";

const ART = {
  idle: "/pet/idle.svg", thinking: "/pet/thinking.svg", typing: "/pet/typing.svg",
  building: "/pet/building.svg", carrying: "/pet/carrying.svg", juggling: "/pet/juggling.svg",
  conducting: "/pet/conducting.svg", error: "/pet/error.svg", notification: "/pet/notification.svg",
  sweeping: "/pet/sweeping.svg", happy: "/pet/happy.svg", sleeping: "/pet/sleeping.svg",
  yawning: "/pet/yawning.svg", dozing: "/pet/dozing.svg", waking: "/pet/wake.svg", offline: "/pet/sleeping.svg",
};
const REACT = {
  drag: "/pet/react-drag.svg",
  left: { src: "/pet/react-left.svg", dur: 2500 },
  right: { src: "/pet/react-right.svg", dur: 2500 },
  annoyed: { src: "/pet/react-annoyed.svg", dur: 3500 },
  double: { srcs: ["/pet/react-double.svg", "/pet/react-double-jump.svg"], dur: 3500 },
};
const IDLE_ANIMS = [
  { src: "/pet/idle-look.svg", dur: 6500 },
  { src: "/pet/idle-bubble.svg", dur: 13500 },
  { src: "/pet/idle-reading.svg", dur: 14000 },
];

const TOOL_STATE = {
  Bash: "building",
  Read: "carrying", Glob: "carrying", Grep: "carrying", LS: "carrying",
  NotebookRead: "carrying", WebFetch: "carrying", WebSearch: "carrying",
  Edit: "typing", Write: "typing", MultiEdit: "typing", NotebookEdit: "typing",
  Task: "juggling",
};
// 一次性状态 → 最短显示/自动回落时长（照 theme.json autoReturn）
const ONESHOT_DUR = { happy: 4000, error: 5000, notification: 5000, sweeping: 5500 };
const ONESHOT = new Set(Object.keys(ONESHOT_DUR));
const WORKING = new Set(["thinking", "typing", "building", "carrying", "juggling", "conducting", "sweeping"]);

// 睡眠计时（照 theme.json timings：mouseIdle 20s / mouseSleep 60s / yawn 3s / deepSleep 10min / wake 1.5s）
const MOUSE_IDLE = 20_000, MOUSE_SLEEP = 60_000, YAWN_MS = 3000, DEEP_SLEEP = 600_000, WAKE_MS = 1500;
const SIZE = 128;
const SNAP = 26, TUCK = 58, MINI_SCALE = 1.25, ENTER_MS = 520;
const WALK_EVERY = 5200, WALK_CHANCE = 0.45, WALK_MS = 2600;
const CLICK_WINDOW = 400;
const POS_KEY = "deskpet-pos", MINI_KEY = "deskpet-mini";

function deriveActive(signals) {
  const { isGenerating, streamSnap, ccStatus } = signals;
  if (ccStatus === "down") return "offline";
  if (!isGenerating || !streamSnap) return null;
  const tools = streamSnap.tools || [];
  const running = tools.filter(t => t.result === undefined);
  if (tools.some(t => t.isError)) return "error";
  if (running.length > 1) return "conducting";
  if (running.length === 1) return TOOL_STATE[running[0].name] || "building";
  const hasText = (streamSnap.delta && streamSnap.delta.length) ||
                  (Array.isArray(streamSnap.bubbles) && streamSnap.bubbles.length);
  if (hasText) return "typing";
  if (streamSnap.thinking && streamSnap.thinking.length) return "thinking";
  return "thinking";
}
function clampPos(x, y) {
  const W = window.innerWidth || 360, H = window.innerHeight || 640;
  return { x: Math.max(0, Math.min(W - SIZE, x)), y: Math.max(0, Math.min(H - SIZE, y)) };
}
function nearestEdge(x) { return (x + SIZE / 2 > (window.innerWidth || 360) / 2) ? "right" : "left"; }
function miniArt({ state, hovering, walking, entering }) {
  if (entering) return "/pet/mini-enter.svg";
  if (hovering) return "/pet/mini-peek.svg";
  if (walking) return "/pet/mini-crabwalk.svg";
  if (state === "sleeping" || state === "offline") return "/pet/mini-sleep.svg";
  if (state === "dozing") return "/pet/mini-enter-sleep.svg";
  if (state === "notification" || state === "error") return "/pet/mini-alert.svg";
  if (state === "happy") return "/pet/mini-happy.svg";
  if (WORKING.has(state)) return "/pet/mini-typing.svg";
  return "/pet/mini-idle.svg";
}

export default function DeskPet({ signals }) {
  const [state, setState] = useState("idle");
  const [mini, setMini] = useState(() => {
    const v = localStorage.getItem(MINI_KEY); return (v === "left" || v === "right") ? v : "";
  });
  const [peeking, setPeeking] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [walking, setWalking] = useState(false);
  const [entering, setEntering] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [reaction, setReaction] = useState(null);
  const [idleAnim, setIdleAnim] = useState(null);
  const [hidden] = useState(() => localStorage.getItem("deskpet-hidden") === "1");
  const [pos, setPos] = useState(() => {
    try { const p = JSON.parse(localStorage.getItem(POS_KEY)); if (p && Number.isFinite(p.x)) return p; } catch { /* */ }
    return null;
  });

  const mouseStillRef = useRef(Date.now());     // 用户鼠标最后活动时刻（睡眠计时基准）
  const idleAnimPlayedRef = useRef(false);      // 本次静止已播过随机 idle 动作
  const idleAnimTimerRef = useRef(null);
  const wasAsleepRef = useRef(false);
  const wakingUntilRef = useRef(0);
  const oneshotUntilRef = useRef(0);
  const oneshotStateRef = useRef(null);
  const prevGenRef = useRef(false);
  const peekTimerRef = useRef(null);
  const enterTimerRef = useRef(null);
  const dragRef = useRef(null);
  const posRef = useRef(pos);
  const stateRef = useRef(state);
  const reactingRef = useRef(false);
  const reactTimerRef = useRef(null);
  const clickCountRef = useRef(0);
  const clickTimerRef = useRef(null);
  const firstDirRef = useRef(null);
  useEffect(() => { posRef.current = pos; }, [pos]);
  useEffect(() => { stateRef.current = state; }, [state]);

  const setMiniPersist = useCallback((m) => {
    setMini(m); localStorage.setItem(MINI_KEY, m || "");
    if (m) {
      setEntering(true);
      clearTimeout(enterTimerRef.current);
      enterTimerRef.current = setTimeout(() => setEntering(false), ENTER_MS);
    } else { setEntering(false); }
  }, []);
  const setPosPersist = useCallback((p) => {
    setPos(p); if (p) localStorage.setItem(POS_KEY, JSON.stringify(p));
  }, []);
  const playReact = useCallback((src, dur) => {
    if (!src) return;
    reactingRef.current = true;
    setReaction(src);
    clearTimeout(reactTimerRef.current);
    reactTimerRef.current = setTimeout(() => { reactingRef.current = false; setReaction(null); }, dur);
  }, []);
  /* 用户鼠标/触摸活动 → 重置睡眠计时（动一下就醒） */
  const bumpActivity = useCallback(() => {
    mouseStillRef.current = Date.now();
    idleAnimPlayedRef.current = false;
  }, []);

  useEffect(() => {
    if (pos) return;
    setPos(clampPos((window.innerWidth || 360) - SIZE - 14, (window.innerHeight || 640) - SIZE - 88));
  }, [pos]);

  /* 全局鼠标活动监听（睡眠计时基准；只写 ref，不触发渲染） */
  useEffect(() => {
    window.addEventListener("pointermove", bumpActivity, { passive: true });
    window.addEventListener("pointerdown", bumpActivity, { passive: true });
    return () => {
      window.removeEventListener("pointermove", bumpActivity);
      window.removeEventListener("pointerdown", bumpActivity);
    };
  }, [bumpActivity]);

  /* 澄的信号 → 活跃状态 + 一次性状态锁定；澄活动也算"清醒" */
  useEffect(() => {
    const now = Date.now();
    const active = deriveActive(signals);
    if (prevGenRef.current && !signals.isGenerating) {
      oneshotStateRef.current = "happy"; oneshotUntilRef.current = now + ONESHOT_DUR.happy;
    }
    prevGenRef.current = signals.isGenerating;
    if (active && ONESHOT.has(active)) {
      oneshotStateRef.current = active; oneshotUntilRef.current = now + (ONESHOT_DUR[active] || 3000);
    }
    if (active && active !== "offline") mouseStillRef.current = now;  // 干活时不睡
    if (mini && active && active !== "offline") {
      setPeeking(true);
      clearTimeout(peekTimerRef.current);
      peekTimerRef.current = setTimeout(() => setPeeking(false), 2600);
    }
  }, [signals, mini]);

  /* 主循环：决定显示状态（一次性 > 澄活跃 > 醒来 > 睡眠序列 > idle） */
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      // 一次性状态（happy/error/...）锁定显示
      if (now < oneshotUntilRef.current && oneshotStateRef.current) { setState(oneshotStateRef.current); return; }
      if (signals.ccStatus === "down") { setState("offline"); return; }
      const active = deriveActive(signals);
      if (active) { setState(active); return; }

      // —— 睡眠序列（鼠标静止计时）——
      const still = now - mouseStillRef.current;
      const asleep = still >= MOUSE_SLEEP + YAWN_MS;   // 犯困/深睡算"睡着"，用于醒来动画
      if (!asleep && wasAsleepRef.current) wakingUntilRef.current = now + WAKE_MS; // 刚被叫醒
      wasAsleepRef.current = asleep;
      if (now < wakingUntilRef.current) { setState("waking"); return; }

      if (still < MOUSE_IDLE) {
        if (idleAnim) setIdleAnim(null);
        setState("idle"); return;
      }
      if (still < MOUSE_SLEEP) {
        // 静止满 20s：随机播一次 idle 动作（张望/冒泡/看书），播完回 idle
        if (!idleAnimPlayedRef.current) {
          idleAnimPlayedRef.current = true;
          const a = IDLE_ANIMS[Math.floor(Math.random() * IDLE_ANIMS.length)];
          setIdleAnim(a.src);
          clearTimeout(idleAnimTimerRef.current);
          idleAnimTimerRef.current = setTimeout(() => setIdleAnim(null), a.dur);
        }
        setState("idle"); return;
      }
      if (idleAnim) setIdleAnim(null);
      if (still < MOUSE_SLEEP + YAWN_MS) { setState("yawning"); return; }
      if (still < DEEP_SLEEP) { setState("dozing"); return; }
      setState("sleeping");
    };
    tick();
    const h = setInterval(tick, 500);
    return () => clearInterval(h);
  }, [signals, idleAnim]);

  /* 极简模式下闲着 → 随机沿边溜达 */
  useEffect(() => {
    if (!mini) return;
    const id = setInterval(() => {
      if (hovering || peeking || walking || dragRef.current) return;
      const st = stateRef.current;
      if (st !== "idle" && st !== "yawning") return;
      if (Math.random() > WALK_CHANCE) return;
      const H = window.innerHeight || 640;
      const cur = posRef.current; if (!cur) return;
      const dir = Math.random() < 0.5 ? -1 : 1;
      const ny = Math.max(0, Math.min(H - SIZE, cur.y + dir * (50 + Math.random() * 90)));
      setWalking(true);
      setPosPersist({ x: cur.x, y: ny });
      setTimeout(() => setWalking(false), WALK_MS);
    }, WALK_EVERY);
    return () => clearInterval(id);
  }, [mini, hovering, peeking, walking, setPosPersist]);

  /* 点击：正常模式=彩蛋累加（仅 idle）；极简模式=弹回正常 */
  const handleTap = useCallback((clientX) => {
    if (mini) { setMiniPersist(""); return; }
    clickCountRef.current++;
    if (clickCountRef.current === 1 && posRef.current) {
      firstDirRef.current = (clientX - posRef.current.x) < SIZE / 2 ? "left" : "right";
    }
    clearTimeout(clickTimerRef.current);
    const canReact = () => stateRef.current === "idle" && !reactingRef.current;
    if (clickCountRef.current >= 4) {
      clickCountRef.current = 0; firstDirRef.current = null;
      if (!canReact()) return;
      const srcs = REACT.double.srcs;
      playReact(srcs[Math.floor(Math.random() * srcs.length)], REACT.double.dur);
    } else {
      clickTimerRef.current = setTimeout(() => {
        const cnt = clickCountRef.current, dir = firstDirRef.current;
        clickCountRef.current = 0; firstDirRef.current = null;
        if (cnt >= 2 && canReact()) {
          if (Math.random() < 0.5) playReact(REACT.annoyed.src, REACT.annoyed.dur);
          else { const r = dir === "left" ? REACT.left : REACT.right; playReact(r.src, r.dur); }
        }
      }, CLICK_WINDOW);
    }
  }, [mini, setMiniPersist, playReact]);

  const onPointerDown = useCallback((e) => {
    if (!pos) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y, moved: false };
    if (mini) setHovering(true);
  }, [pos, mini]);

  const onPointerMove = useCallback((e) => {
    const d = dragRef.current; if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    if (!d.moved) { d.moved = true; setDragging(true); if (walking) setWalking(false); }
    if (mini) setHovering(true);
    setPos(clampPos(d.ox + dx, d.oy + dy));
  }, [mini, walking]);

  const onPointerUp = useCallback((e) => {
    const d = dragRef.current; dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (!d) return;
    if (!d.moved) { handleTap(e.clientX); setHovering(false); return; }
    setDragging(false);
    const W = window.innerWidth || 360;
    const fin = clampPos(d.ox + (e.clientX - d.sx), d.oy + (e.clientY - d.sy));
    let m = "";
    if (fin.x <= SNAP) { m = "left"; fin.x = 0; }
    else if (fin.x >= W - SIZE - SNAP) { m = "right"; fin.x = W - SIZE; }
    setMiniPersist(m);
    setPosPersist(fin);
    setHovering(false);
  }, [handleTap, setMiniPersist, setPosPersist]);

  if (hidden || !pos) return null;

  const offline = state === "offline";
  const out = !!mini && (hovering || peeking || walking || entering);

  let src;
  if (mini) src = miniArt({ state, hovering, walking, entering });
  else if (dragging) src = REACT.drag;
  else if (reaction) src = reaction;
  else if (idleAnim && state === "idle") src = idleAnim;
  else src = ART[state] || ART.idle;

  const cls = ["deskpet", mini ? "mini" : "", out ? "out" : "", walking ? "walking" : "", offline ? "offline" : ""]
    .filter(Boolean).join(" ");
  let transform = "";
  if (mini) {
    const mir = mini === "left" ? " scaleX(-1)" : "";
    const tuck = out ? "" : `translateX(${mini === "right" ? TUCK : -TUCK}%) `;
    transform = `${tuck}scale(${MINI_SCALE})${mir}`;
  }

  return (
    <div
      className={cls}
      style={{ left: pos.x + "px", top: pos.y + "px", transform }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerEnter={() => { if (mini) setHovering(true); }}
      onPointerLeave={() => { if (mini && !dragRef.current) setHovering(false); }}
      title={offline ? "澄断线了…" : "拖动移动 · 拖到屏幕边贴边藏 · 戳两下/连戳有彩蛋 · 鼠标动一下叫醒"}
      role="img"
      aria-label={`桌宠 状态:${state}`}
    >
      <style>{PET_CSS}</style>
      <div className="dp-frame">
        <img className="dp-gif" src={src} alt={state} draggable="false" />
      </div>
    </div>
  );
}

const PET_CSS = `
.deskpet {
  position: fixed; width: 128px; height: 128px; z-index: 50;
  cursor: grab; user-select: none; -webkit-user-select: none; touch-action: none;
  transition: transform .3s cubic-bezier(.34,1.56,.64,1), opacity .25s;
  transform-origin: center center;
}
.deskpet:active { cursor: grabbing; }
.deskpet.walking { transition: top 2.5s ease-in-out, transform .3s cubic-bezier(.34,1.56,.64,1), opacity .25s; }
.deskpet .dp-frame { position: relative; width: 100%; height: 100%; }
.deskpet .dp-gif {
  display: block; width: 100%; height: 100%; object-fit: contain;
  filter: drop-shadow(0 3px 4px rgba(0,0,0,.16));
  pointer-events: none;
}
.deskpet.offline .dp-gif { opacity: .55; filter: grayscale(.55) drop-shadow(0 3px 4px rgba(0,0,0,.12)); }
.deskpet.mini { opacity: .92; }
.deskpet.mini.out { opacity: 1; }
`;
