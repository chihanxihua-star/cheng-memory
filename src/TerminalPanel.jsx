import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";

const WS_URL = "wss://chat.jessaminee.top/terminal";
const AUTH_TOKEN_KEY = "memhome-auth-token";

// 移动端软键盘修复：xterm 的 helper textarea 默认是 ~9×17px 的小点（用来给 IME
// 定位组合框），手机上根本点不到。CSS !important 把它撑满整个屏幕区域，
// 这样 tap 终端任何位置都能 focus 到 textarea、弹出系统键盘。
// 只在触摸设备应用，桌面端保持 IME 定位正常。
const MOBILE_KEYBOARD_STYLE_ID = "xterm-mobile-keyboard-fix";
function ensureMobileKeyboardStyle() {
  if (document.getElementById(MOBILE_KEYBOARD_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = MOBILE_KEYBOARD_STYLE_ID;
  style.textContent = `
    @media (pointer: coarse) {
      .xterm-helper-textarea {
        position: absolute !important;
        top: 0 !important;
        left: 0 !important;
        width: 100% !important;
        height: 100% !important;
        opacity: 0 !important;
        z-index: 10 !important;
        font-size: 16px !important;
        padding: 0 !important;
        border: 0 !important;
        background: transparent !important;
        pointer-events: auto !important;
      }
    }
  `;
  document.head.appendChild(style);
}

export default function TerminalPanel({ onClose }) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const wsRef = useRef(null);

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
    ensureMobileKeyboardStyle();
    term.open(containerRef.current);

    const helper = containerRef.current.querySelector(".xterm-helper-textarea");
    if (helper) {
      helper.setAttribute("autocapitalize", "off");
      helper.setAttribute("autocomplete", "off");
      helper.setAttribute("autocorrect", "off");
      helper.setAttribute("spellcheck", "false");
    }

    requestAnimationFrame(() => {
      try { fit.fit(); } catch {}
      try { term.focus(); } catch {}
    });
    termRef.current = term;
    fitRef.current = fit;

    const token = localStorage.getItem(AUTH_TOKEN_KEY) || "";
    let ws;
    try {
      ws = new WebSocket(WS_URL + (token ? "?token=" + encodeURIComponent(token) : ""));
    } catch (e) {
      term.write("\r\n\x1b[31m[failed to open ws: " + (e?.message || e) + "]\x1b[0m\r\n");
      return;
    }
    wsRef.current = ws;
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      try {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      } catch {}
      term.focus();
    };
    ws.onmessage = (e) => {
      if (typeof e.data === "string") term.write(e.data);
      else if (e.data instanceof ArrayBuffer) term.write(new Uint8Array(e.data));
    };
    ws.onclose = (ev) => {
      if (ev && ev.code === 4001) {
        localStorage.removeItem(AUTH_TOKEN_KEY);
        window.dispatchEvent(new CustomEvent("auth-expired"));
        return;
      }
      try { term.write("\r\n\x1b[33m[disconnected]\x1b[0m\r\n"); } catch {}
    };
    ws.onerror = () => {};

    const dataDispose = term.onData((d) => {
      if (ws.readyState === 1) ws.send(d);
    });

    const handleResize = () => {
      try {
        fit.fit();
        if (ws.readyState === 1) {
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
      try { dataDispose.dispose(); } catch {}
      try { ws.close(); } catch {}
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
        <span style={{ fontSize: 11, color: "#aaa", letterSpacing: "0.22em" }}>TERMINAL · /root</span>
        <button onClick={onClose} aria-label="close" style={{
          background: "none", border: "none", color: "#aaa",
          fontSize: 20, lineHeight: 1, cursor: "pointer", padding: "4px 8px",
        }}>×</button>
      </div>
      <div ref={containerRef}
        onMouseDown={() => { try { termRef.current?.focus(); } catch {} }}
        onTouchStart={() => { try { termRef.current?.focus(); } catch {} }}
        style={{
          flex: 1, minHeight: 0, padding: "8px 10px",
          background: "#1d1d1f", overflow: "hidden",
        }}/>
    </div>,
    document.body
  );
}
