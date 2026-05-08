import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";

const WS_URL = "wss://chat.jessaminee.top/terminal";
const AUTH_TOKEN_KEY = "memhome-auth-token";

export default function TerminalPanel({ onClose }) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const wsRef = useRef(null);
  const inputRef = useRef(null);
  const pingTimerRef = useRef(null);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("connecting"); // connecting | connected | disconnected
  const [statusDetail, setStatusDetail] = useState("初始化");

  const stopPing = () => {
    if (pingTimerRef.current) {
      clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
  };

  // 在 xterm 里写一行带时间戳的调试日志（colorCode: 33黄/32绿/31红/90灰）
  const logTerm = (msg, colorCode = "90") => {
    const term = termRef.current;
    if (!term) return;
    const ts = new Date().toLocaleTimeString();
    try { term.write(`\r\n\x1b[${colorCode}m[${ts}] ${msg}\x1b[0m\r\n`); } catch {}
  };

  const connectWs = () => {
    const term = termRef.current;
    if (!term) return;

    // 关掉旧连接（如果还在）
    stopPing();
    try {
      const old = wsRef.current;
      if (old && old.readyState <= 1) old.close();
    } catch {}

    setStatus("connecting");
    setStatusDetail("connecting…");
    logTerm(`connecting → ${WS_URL}`, "33");
    const token = localStorage.getItem(AUTH_TOKEN_KEY) || "";
    let ws;
    try {
      ws = new WebSocket(WS_URL + (token ? "?token=" + encodeURIComponent(token) : ""));
    } catch (e) {
      const reason = e?.message || String(e);
      term.write("\r\n\x1b[31m[failed to open ws: " + reason + "]\x1b[0m\r\n");
      setStatus("disconnected");
      setStatusDetail("ctor 抛错: " + reason);
      return;
    }
    wsRef.current = ws;
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      setStatus("connected");
      setStatusDetail(`connected (${term.cols}×${term.rows})`);
      logTerm(`connected, resize cols=${term.cols} rows=${term.rows}`, "32");
      try {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      } catch {}
      try { term.focus(); } catch {}
      // 心跳：Cloudflare WS 默认 100s 空闲就断，每 30s 发个 ping 把它撑住
      stopPing();
      pingTimerRef.current = setInterval(() => {
        if (ws.readyState !== 1) return;
        try { ws.send(JSON.stringify({ type: "ping" })); } catch {}
      }, 30000);
    };
    ws.onmessage = (e) => {
      if (typeof e.data === "string") term.write(e.data);
      else if (e.data instanceof ArrayBuffer) term.write(new Uint8Array(e.data));
    };
    ws.onerror = () => {
      // 浏览器规范不暴露具体错误，只能记 readyState
      logTerm(`error event (readyState=${ws.readyState})`, "31");
      setStatusDetail(`error (readyState=${ws.readyState})`);
    };
    ws.onclose = (ev) => {
      stopPing();
      if (ev && ev.code === 4001) {
        localStorage.removeItem(AUTH_TOKEN_KEY);
        window.dispatchEvent(new CustomEvent("auth-expired"));
        return;
      }
      const detail = `code=${ev?.code ?? "?"} reason="${ev?.reason ?? ""}" wasClean=${ev?.wasClean ?? "?"}`;
      logTerm(`closed: ${detail}`, "33");
      setStatus("disconnected");
      setStatusDetail(`closed code=${ev?.code ?? "?"}${ev?.reason ? " " + ev.reason : ""}`);
    };
  };

  const send = () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) return;
    ws.send(input + "\n");
    setInput("");
    // 保持输入框聚焦，手机键盘不会收回
    try { inputRef.current?.focus(); } catch {}
  };

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace",
      fontSize: 13,
      lineHeight: 1.25,
      cursorBlink: true,
      scrollback: 5000,
      theme: {
        background: "#1d1d1f",
        foreground: "#e6e0d8",
        cursor: "#e0d0d5",
        cursorAccent: "#1d1d1f",
        selectionBackground: "rgba(230,208,213,0.3)",
        black: "#1d1d1f",
        red: "#e07070",
        green: "#a8c498",
        yellow: "#e8c878",
        blue: "#7fb3c8",
        magenta: "#c0a0d0",
        cyan: "#88c0c8",
        white: "#e6e0d8",
        brightBlack: "#5a5a5c",
        brightRed: "#f08888",
        brightGreen: "#bcd8ac",
        brightYellow: "#f0d088",
        brightBlue: "#90c0d8",
        brightMagenta: "#d0b0e0",
        brightCyan: "#a0d0d8",
        brightWhite: "#f5f0e8",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);

    requestAnimationFrame(() => {
      try { fit.fit(); } catch {}
      try { term.focus(); } catch {}
    });
    termRef.current = term;
    fitRef.current = fit;

    connectWs();

    // 桌面端：xterm helper textarea 直接捕获按键时也走当前的 ws
    const dataDispose = term.onData((d) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === 1) ws.send(d);
    });

    const handleResize = () => {
      try {
        fit.fit();
        const ws = wsRef.current;
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      } catch {}
    };
    window.addEventListener("resize", handleResize);

    let ro;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(handleResize);
      ro.observe(containerRef.current);
    }

    return () => {
      window.removeEventListener("resize", handleResize);
      if (ro) try { ro.disconnect(); } catch {}
      stopPing();
      try { dataDispose.dispose(); } catch {}
      try { wsRef.current?.close(); } catch {}
      try { term.dispose(); } catch {}
    };
  }, []);

  return createPortal(
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      background: "#1d1d1f",
      display: "flex", flexDirection: "column",
      paddingTop: "env(safe-area-inset-top, 0px)",
      paddingBottom: "env(safe-area-inset-bottom, 0px)",
    }}>
      <div style={{
        flexShrink: 0,
        padding: "12px 16px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "#252527", borderBottom: "1px solid #3a3a3c",
        touchAction: "none",
      }}>
        <span style={{ fontSize: 11, color: "#aaa", letterSpacing: "0.22em", display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
          <span style={{
            width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
            background: status === "connected" ? "#a8c498" : status === "connecting" ? "#e8c878" : "#e07070",
          }}/>
          <span style={{ flexShrink: 0 }}>TERMINAL</span>
          <span style={{
            letterSpacing: 0, fontSize: 10, color: "#888",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>· {statusDetail}</span>
        </span>
        <button onClick={onClose} aria-label="close" style={{
          background: "none", border: "none", color: "#aaa",
          fontSize: 20, lineHeight: 1, cursor: "pointer", padding: "4px 8px",
        }}>×</button>
      </div>
      <div ref={containerRef}
        onMouseDown={() => { try { termRef.current?.focus(); } catch {} }}
        style={{
          flex: 1, minHeight: 0, padding: "8px 10px",
          background: "#1d1d1f", overflow: "hidden",
        }}/>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (status === "disconnected") connectWs();
          else send();
        }}
        style={{
          flexShrink: 0,
          display: "flex", gap: 8, padding: "8px",
          background: "#1d1d1f",
          borderTop: "1px solid rgba(255,255,255,0.1)",
        }}>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={status === "disconnected" ? "已断开，点击右侧重连" : "输入命令…"}
          enterKeyHint="send"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          disabled={status !== "connected"}
          style={{
            flex: 1,
            background: "#2a2a2c", color: "#e6e0d8",
            border: "none", borderRadius: 6,
            padding: "8px 12px",
            fontSize: 16, // ≥16px 防 iOS 自动放大
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            outline: "none",
            opacity: status === "connected" ? 1 : 0.6,
          }}
        />
        <button
          type="submit"
          style={{
            flexShrink: 0,
            background: status === "disconnected" ? "#7fb3c8" : "#3a3a3c",
            color: status === "disconnected" ? "#1d1d1f" : "#e6e0d8",
            border: "none", borderRadius: 6,
            padding: "8px 16px",
            fontSize: 14, fontWeight: 500,
            cursor: "pointer",
          }}>{status === "disconnected" ? "重连" : status === "connecting" ? "…" : "发送"}</button>
      </form>
    </div>,
    document.body
  );
}
