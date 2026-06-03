/*
 * DeskPet —— 澄的桌宠（clawd 小螃蟹）。行为照 clawd-on-desk 原版，外加自定义「沿页面四边巡逻」。
 *
 * 美术：clawd 官方 SVG（public/pet/*.svg，见 ART-LICENSE.txt 署名）。
 *   ⚠️ 仅本人个人·非商用·密码门内使用，勿公开宣传/商用。SVG 自带 CSS 动画、矢量、体积小。
 * 机制：澄的活动从 ChatPanel 现成 WS 信号推导；睡眠/醒靠"用户鼠标静止/活动"计时。纯前端、不碰后端。
 *
 * 原版行为（照 tick.js/state.js/theme.json）：
 *  · 状态(澄)：idle/thinking/typing/building/carrying/juggling/conducting/error/notification/sweeping/happy
 *      happy=4s error=5s notification=5s sweeping=5.5s 最短显示
 *  · 睡眠(鼠标静止)：20s随机播一次idle动作(张望/冒泡/看书)·60s哈欠(3s)→犯困·10min深睡；鼠标动→醒(wake 1.5s)
 *  · 点击彩蛋(仅idle)：戳2~3下→不耐烦/歪头(2.5s)；连戳4下→蹦跳(3.5s)；拖→被拎起
 *  · 极简：拖到屏幕边→贴边藏(藏半身~原版 offsetRatio0.486)；探头→举太阳花打招呼(mini-happy)；
 *      进场→正面左右扭(crabwalk)→贴边；点一下探头/再点收回；手机点叫醒。
 * 自定义(clawd 无)：**沿四边佛系巡逻**——偶尔沿当前边走一段，到角拐到相邻边(左→下那种)，竖边爬墙。
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
const ONESHOT_DUR = { happy: 4000, error: 5000, notification: 5000, sweeping: 5500 };
const ONESHOT = new Set(Object.keys(ONESHOT_DUR));
const WORKING = new Set(["thinking", "typing", "building", "carrying", "juggling", "conducting", "sweeping"]);
const EDGES = new Set(["left", "right", "top", "bottom"]);

const MOUSE_IDLE = 20_000, MOUSE_SLEEP = 60_000, YAWN_MS = 3000, DEEP_SLEEP = 600_000, WAKE_MS = 1500;
const SIZE = 150;
const SNAP = 26, TUCK = 50, PEEK = 33, MINI_SCALE = 1, ENTER_MS = 520, CRABWALK_MS = 850;
// 佛系巡逻：隔久才走、走得慢
const PATROL_EVERY = 12000, PATROL_CHANCE = 0.55, PATROL_SPEED = 0.085, PATROL_MIN = 70, PATROL_RANGE = 110;
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
const isVert = (e) => e === "left" || e === "right";
// 拐角：edge 当前边，end 0=低端(竖边的上/横边的左) 1=高端 → 返回 [新边, x, y]
function cornerTurn(edge, end, W, H) {
  const M = W - SIZE, N = H - SIZE;
  if (edge === "left") return end === 0 ? ["top", 0, 0] : ["bottom", 0, N];
  if (edge === "right") return end === 0 ? ["top", M, 0] : ["bottom", M, N];
  if (edge === "top") return end === 0 ? ["left", 0, 0] : ["right", M, 0];
  return end === 0 ? ["left", 0, N] : ["right", M, N]; // bottom
}
function miniArt({ state, hovering, crabwalking, walking, entering }) {
  if (crabwalking || walking) return "/pet/mini-crabwalk.svg";  // 进场螃蟹步 / 巡逻
  if (entering) return "/pet/mini-enter.svg";
  if (hovering) return "/pet/mini-happy.svg";                    // 探头打招呼：^^笑眼+举太阳花(照原版图)
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
    const v = localStorage.getItem(MINI_KEY); return EDGES.has(v) ? v : "";
  });
  const [peeking, setPeeking] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [crabwalking, setCrabwalking] = useState(false);
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

  const mouseStillRef = useRef(Date.now());
  const idleAnimPlayedRef = useRef(false);
  const idleAnimTimerRef = useRef(null);
  const wasAsleepRef = useRef(false);
  const wakingUntilRef = useRef(0);
  const oneshotUntilRef = useRef(0);
  const oneshotStateRef = useRef(null);
  const prevGenRef = useRef(false);
  const peekTimerRef = useRef(null);
  const enterSeqRef = useRef([]);
  const dragRef = useRef(null);
  const posRef = useRef(pos);
  const stateRef = useRef(state);
  const miniRef = useRef(mini);
  const reactingRef = useRef(false);
  const reactTimerRef = useRef(null);
  const clickCountRef = useRef(0);
  const clickTimerRef = useRef(null);
  const firstDirRef = useRef(null);
  const hoveringRef = useRef(false);
  const wasPeekingRef = useRef(false);
  const miniTapTimerRef = useRef(null);
  const walkFlipRef = useRef(false);   // 巡逻横走朝左时镜像
  const walkDurRef = useRef(0);        // 当前这段巡逻的滑动时长(ms)
  const walkTimerRef = useRef(null);
  useEffect(() => { posRef.current = pos; }, [pos]);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { miniRef.current = mini; }, [mini]);
  useEffect(() => { hoveringRef.current = hovering; }, [hovering]);

  const persistMini = useCallback((m) => { setMini(m); localStorage.setItem(MINI_KEY, m || ""); }, []);
  const setMiniPersist = useCallback((m) => {
    persistMini(m);
    enterSeqRef.current.forEach(clearTimeout); enterSeqRef.current = [];
    if (m) {
      setCrabwalking(true); setEntering(false);
      enterSeqRef.current.push(setTimeout(() => {
        setCrabwalking(false); setEntering(true);
        enterSeqRef.current.push(setTimeout(() => setEntering(false), ENTER_MS));
      }, CRABWALK_MS));
    } else { setCrabwalking(false); setEntering(false); }
  }, [persistMini]);
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
  const bumpActivity = useCallback(() => {
    mouseStillRef.current = Date.now();
    idleAnimPlayedRef.current = false;
  }, []);

  useEffect(() => {
    if (pos) return;
    setPos(clampPos((window.innerWidth || 360) - SIZE - 14, (window.innerHeight || 640) - SIZE - 88));
  }, [pos]);

  useEffect(() => {
    window.addEventListener("pointermove", bumpActivity, { passive: true });
    window.addEventListener("pointerdown", bumpActivity, { passive: true });
    return () => {
      window.removeEventListener("pointermove", bumpActivity);
      window.removeEventListener("pointerdown", bumpActivity);
    };
  }, [bumpActivity]);

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
    if (active && active !== "offline") mouseStillRef.current = now;
    if (mini && active && active !== "offline") {
      setPeeking(true);
      clearTimeout(peekTimerRef.current);
      peekTimerRef.current = setTimeout(() => setPeeking(false), 2600);
    }
  }, [signals, mini]);

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      if (now < oneshotUntilRef.current && oneshotStateRef.current) { setState(oneshotStateRef.current); return; }
      if (signals.ccStatus === "down") { setState("offline"); return; }
      const active = deriveActive(signals);
      if (active) { setState(active); return; }

      const still = now - mouseStillRef.current;
      const asleep = still >= MOUSE_SLEEP + YAWN_MS;
      if (!asleep && wasAsleepRef.current) wakingUntilRef.current = now + WAKE_MS;
      wasAsleepRef.current = asleep;
      if (now < wakingUntilRef.current) { setState("waking"); return; }

      if (still < MOUSE_IDLE) { if (idleAnim) setIdleAnim(null); setState("idle"); return; }
      if (still < MOUSE_SLEEP) {
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

  /* 沿四边佛系巡逻：偶尔沿当前边走一段，到角拐到相邻边 */
  useEffect(() => {
    if (!mini) return;
    const id = setInterval(() => {
      if (hovering || peeking || walking || crabwalking || entering || dragRef.current) return;
      const st = stateRef.current;
      if (st !== "idle" && st !== "yawning") return;
      if (Math.random() > PATROL_CHANCE) return;
      const W = window.innerWidth || 360, H = window.innerHeight || 640;
      const cur = posRef.current; if (!cur) return;
      const e = miniRef.current; const vert = isVert(e);
      const coord = vert ? cur.y : cur.x;
      const max = vert ? (H - SIZE) : (W - SIZE);
      const dir = Math.random() < 0.5 ? -1 : 1;
      const target = coord + dir * (PATROL_MIN + Math.random() * PATROL_RANGE);
      let ne = e, np;
      if (target < 0 || target > max) {                       // 到角 → 拐弯
        const [te, tx, ty] = cornerTurn(e, target < 0 ? 0 : 1, W, H);
        ne = te; np = { x: tx, y: ty }; walkFlipRef.current = false;
      } else {
        np = vert ? { x: cur.x, y: target } : { x: target, y: cur.y };
        walkFlipRef.current = (!vert && dir < 0);             // 横走朝左 → 镜像
      }
      const dist = Math.hypot(np.x - cur.x, np.y - cur.y);
      if (dist < 2) return;
      walkDurRef.current = Math.max(500, Math.round(dist / PATROL_SPEED));
      setWalking(true);
      if (ne !== e) persistMini(ne);
      setPosPersist(np);
      clearTimeout(walkTimerRef.current);
      walkTimerRef.current = setTimeout(() => setWalking(false), walkDurRef.current);
    }, PATROL_EVERY);
    return () => clearInterval(id);
  }, [mini, hovering, peeking, walking, crabwalking, entering, persistMini, setPosPersist]);

  const handleTap = useCallback((clientX) => {
    if (mini) {
      if (wasPeekingRef.current) { clearTimeout(miniTapTimerRef.current); setHovering(false); setMiniPersist(""); }
      else {
        setHovering(true);
        clearTimeout(miniTapTimerRef.current);
        miniTapTimerRef.current = setTimeout(() => setHovering(false), 2800);
      }
      return;
    }
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
    wasPeekingRef.current = hoveringRef.current;
  }, [pos]);

  const onPointerMove = useCallback((e) => {
    const d = dragRef.current; if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 9) return;
    if (!d.moved) { d.moved = true; setDragging(true); if (mini) setHovering(true); }
    setPos(clampPos(d.ox + dx, d.oy + dy));
  }, [mini]);

  const onPointerUp = useCallback((e) => {
    const d = dragRef.current; dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (!d) return;
    if (!d.moved) { handleTap(e.clientX); return; }
    setDragging(false);
    const W = window.innerWidth || 360, H = window.innerHeight || 640;
    const fin = clampPos(d.ox + (e.clientX - d.sx), d.oy + (e.clientY - d.sy));
    // 离哪条边最近且够近 → 贴那条边（四边都可）
    const dL = fin.x, dR = W - SIZE - fin.x, dT = fin.y, dB = H - SIZE - fin.y;
    const md = Math.min(dL, dR, dT, dB);
    let m = "";
    if (md <= SNAP) {
      if (md === dL) { m = "left"; fin.x = 0; }
      else if (md === dR) { m = "right"; fin.x = W - SIZE; }
      else if (md === dT) { m = "top"; fin.y = 0; }
      else { m = "bottom"; fin.y = H - SIZE; }
    }
    setHovering(false);
    if (m !== mini) setMiniPersist(m);  // 只在进/出极简或换边时播进场
    setPosPersist(fin);
  }, [mini, handleTap, setMiniPersist, setPosPersist]);

  if (hidden || !pos) return null;

  const offline = state === "offline";
  const out = !!mini && (hovering || peeking || crabwalking || walking || entering);
  const src = mini ? miniArt({ state, hovering, crabwalking, walking, entering }) : (dragging ? REACT.drag
    : reaction ? reaction : (idleAnim && state === "idle") ? idleAnim : (ART[state] || ART.idle));

  const cls = ["deskpet", mini ? "mini" : "", out ? "out" : "", offline ? "offline" : ""]
    .filter(Boolean).join(" ");

  // transform：极简贴边/探头/巡逻
  let transform = "";
  if (mini && crabwalking) {
    transform = `scale(${MINI_SCALE})`;                          // 进场原地扭(居中)
  } else if (mini) {
    const amt = out ? PEEK : TUCK;
    let t = "";
    if (mini === "left") t = `translateX(${-amt}%)`;
    else if (mini === "right") t = `translateX(${amt}%)`;
    else if (mini === "top") t = `translateY(${-amt}%)`;
    else t = `translateY(${amt}%)`;                              // bottom
    let flip = "";
    if (walking) flip = walkFlipRef.current ? " scaleX(-1)" : "";
    else if (mini === "left") flip = " scaleX(-1)";              // 贴左边脸朝右(朝屏内)
    transform = `${t} scale(${MINI_SCALE})${flip}`;
  }
  // 巡逻时给 left/top 加线性过渡，让它平滑走过去；非巡逻用默认(拖动即时)
  const trans = walking
    ? `left ${walkDurRef.current}ms linear, top ${walkDurRef.current}ms linear, transform .3s ease, opacity .25s`
    : undefined;

  return (
    <div
      className={cls}
      style={{ left: pos.x + "px", top: pos.y + "px", transform, transition: trans }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerEnter={(e) => { if (mini && e.pointerType === "mouse") setHovering(true); }}
      onPointerLeave={(e) => { if (mini && e.pointerType === "mouse" && !dragRef.current) setHovering(false); }}
      title={offline ? "澄断线了…" : "拖动移动 · 拖到屏幕边贴边藏(会沿边溜达) · 戳两下有彩蛋"}
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
  position: fixed; width: ${SIZE}px; height: ${SIZE}px; z-index: 50;
  cursor: grab; user-select: none; -webkit-user-select: none; touch-action: none;
  transition: transform .3s cubic-bezier(.34,1.56,.64,1), opacity .25s;
  transform-origin: center center;
}
.deskpet:active { cursor: grabbing; }
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
