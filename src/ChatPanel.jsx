/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { supabase } from "./lib/supabase";

/* ════════════════════════════════════════════════════════════
   配置
   ════════════════════════════════════════════════════════════ */
const WS_URL = "wss://chat.jessaminee.top/ws";
const API_BASE = "https://chat.jessaminee.top";
const API = API_BASE + "/api";
const PROJECT_ID = "b5e5d83a-0c17-4421-a0e2-217519ed62fb";
const CONV_KEY = "memhome-conv-id";
const TOOL_RESULT_MAX_CHARS = 2000;
const TYPING_DELAY_MS = 1000;
const TIME_SEP_GAP_MS = 10 * 60 * 1000;

const EMOJI_OPTIONS = ["🦊","🐙","🐱","🐰","🐻","🐼","🦝","🐨","🐯","🦁","🐸","🐧","🦉","🐝","🌸","🌙","⭐","🔥","💎","🎭","🎵","👻","🤖","🧸"];
const DEFAULT_PROFILE = { userNick: "宝", userEmoji: "🦊", userImg: null, botNick: "Claude", botEmoji: "🐙", botImg: null };
const MODEL_OPTIONS = [
  { value: "", name: "默认", desc: "跟随 CC 配置" },
  { value: "opus", name: "Opus 4.7", desc: "Extended · 思考不可见" },
  { value: "claude-opus-4-6", name: "Opus 4.6", desc: "Extended" },
  { value: "sonnet", name: "Sonnet 4.6", desc: "Fast & Smart · 可见思考" },
  { value: "haiku", name: "Haiku 4.5", desc: "Ultra Fast" },
  { value: "claude-sonnet-4-5-20250929", name: "Sonnet 4.5", desc: "Classic" },
];

/* ════════════════════════════════════════════════════════════
   工具函数
   ════════════════════════════════════════════════════════════ */
function escHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// 较完整的 markdown 渲染（替代 marked）
function md(text) {
  if (!text) return "";
  // 抽出代码块
  const blocks = [];
  const TOKEN = "CB"; // 私有区字符做哨兵，避免与正文冲突
  const TOKEN_END = "";
  let work = String(text).replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const i = blocks.length;
    blocks.push({ kind: "code", lang, code: code.replace(/\n$/, "") });
    return TOKEN + i + TOKEN_END;
  });
  let h = escHtml(work);
  // 标题
  h = h.replace(/^###### (.+)$/gm, '<h6 class="cp-h6">$1</h6>');
  h = h.replace(/^##### (.+)$/gm, '<h5 class="cp-h5">$1</h5>');
  h = h.replace(/^#### (.+)$/gm, '<h4 class="cp-h4">$1</h4>');
  h = h.replace(/^### (.+)$/gm, '<h3 class="cp-h3">$1</h3>');
  h = h.replace(/^## (.+)$/gm, '<h2 class="cp-h2">$1</h2>');
  h = h.replace(/^# (.+)$/gm, '<h1 class="cp-h1">$1</h1>');
  // 引用
  h = h.replace(/^&gt; (.+)$/gm, '<blockquote class="cp-bq">$1</blockquote>');
  // 水平线
  h = h.replace(/^---+$/gm, '<hr class="cp-hr"/>');
  // 列表
  h = h.replace(/^[-*] (.+)$/gm, '<div class="cp-li">$1</div>');
  h = h.replace(/^\d+\. (.+)$/gm, '<div class="cp-li cp-oli">$1</div>');
  // 行内
  h = h.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  h = h.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>");
  h = h.replace(/`([^`\n]+)`/g, '<code class="cp-ic">$1</code>');
  h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="cp-a">$1</a>');
  // 段落与换行
  h = h.split(/\n{2,}/).map(p => /^<(h\d|blockquote|div|hr|ul|ol|pre)/.test(p.trim()) ? p : ('<p>' + p.replace(/\n/g, "<br/>") + '</p>')).join("\n");
  // 还原代码块
  h = h.replace(new RegExp(TOKEN + "(\\d+)" + TOKEN_END, "g"), (_, i) => {
    const b = blocks[+i];
    return `<pre class="cp-pre"><code>${escHtml(b.code)}</code></pre>`;
  });
  return h;
}

function formatTime(d) { return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }); }
function formatDateTime(d) {
  return d.getFullYear() + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" + String(d.getDate()).padStart(2, "0")
    + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}
function formatK(n) {
  n = n || 0;
  if (n < 1000) return String(n);
  const k = n / 1000;
  return (k === Math.floor(k) ? k : (Math.round(k * 10) / 10)) + "k";
}
function prettyJSON(v) { try { return JSON.stringify(v, null, 2); } catch { return String(v); } }

function getSettings(projectId) {
  try {
    const key = "chat-settings-" + (projectId || "global");
    const s = JSON.parse(localStorage.getItem(key) || "{}");
    return {
      bufferTime: s.bufferTime || 10,
      shortMsgCount: s.shortMsgCount || 5,
      compressThreshold: s.compressThreshold || 50000,
      summaryLength: s.summaryLength || 500,
      defaultModel: s.defaultModel || "",
    };
  } catch {
    return { bufferTime: 10, shortMsgCount: 5, compressThreshold: 50000, summaryLength: 500, defaultModel: "" };
  }
}
function saveSettingsValues(projectId, values) {
  const key = "chat-settings-" + (projectId || "global");
  localStorage.setItem(key, JSON.stringify(values));
}

const DEFAULT_API_SETTINGS = {
  apiKey: "",
  model: "claude-opus-4-7",
  maxTokens: 4096,
  temperature: 1.0,
  thinkingBudget: 0,
  cacheEnabled: true,
  cacheTTL: "5m",
};
function getAPISettings(projectId) {
  try {
    const key = "chat-api-settings-" + (projectId || "global");
    const s = JSON.parse(localStorage.getItem(key) || "{}");
    return { ...DEFAULT_API_SETTINGS, ...s };
  } catch { return { ...DEFAULT_API_SETTINGS }; }
}
function saveAPISettingsValues(projectId, values) {
  const key = "chat-api-settings-" + (projectId || "global");
  localStorage.setItem(key, JSON.stringify(values));
}

function compressImageDataUrl(dataUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const max = 1024;
      let w = img.width, h = img.height;
      if (w > h && w > max) { h = (h * max) / w; w = max; }
      else if (h > max) { w = (w * max) / h; h = max; }
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function squareAvatarDataUrl(file) {
  return new Promise(resolve => {
    const fr = new FileReader();
    fr.onload = e => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas"); c.width = 80; c.height = 80;
        const ctx = c.getContext("2d");
        const s = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 80, 80);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => resolve(null);
      img.src = e.target.result;
    };
    fr.readAsDataURL(file);
  });
}

function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).catch(() => {});
  } else {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed"; ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    try { document.execCommand("copy"); } catch {}
    document.body.removeChild(ta);
  }
}

/* ════════════════════════════════════════════════════════════
   样式（CSS 变量 + 类 - 全部在 .cp-root 作用域下）
   ════════════════════════════════════════════════════════════ */
const CSS = `
.cp-root {
  --bg-primary: #FBFAF6; --bg-sidebar: #FAFAF8;
  --msg-icon-color: #888; --bg-sidebar-hover: #F5F0EA; --bg-sidebar-active: #E6D2D5;
  --bg-bubble-user: #F2DCE0; --bg-bubble-bot: #FFFFFF; --bg-input: #FFFFFF;
  --bg-search: #EFEBE4; --bg-thinking-toggle: #EFEBE4; --bg-thinking-content: #F5F0EA;
  --bg-panel: #FFFFFF; --bg-card: #F8F5F0; --bg-button: #E6D2D5; --bg-button-hover: #D5C1C4;
  --text-primary: #333; --text-secondary: #666; --text-tertiary: #999; --text-placeholder: #BBB;
  --text-bubble-user: #333; --text-bubble-bot: #333; --text-thinking: #888; --text-button: #333;
  --border-primary: #E0D8CE; --border-input: #DDD6CC; --border-input-focus: #C9A8AD;
  --border-bubble: #E8E2DA; --border-card: #E8E2DA; --border-thinking: #DDD6CC; --border-search: #DDD6CC;
  --bg-bar-translucent: rgba(251, 250, 246, 0.38);
  position: relative; display: flex; flex-direction: column;
  width: 100%; flex: 1; min-height: 0; height: 100%;
  background: var(--bg-primary); color: var(--text-primary);
  font-family: 'Noto Serif SC', Georgia, serif;
  overflow: hidden;
}
.cp-root[data-theme="dark"] {
  --bg-primary: #2A2A2C; --bg-sidebar: #232325;
  --msg-icon-color: #CCC; --bg-sidebar-hover: #2E2E30; --bg-sidebar-active: #3A3035;
  --bg-bubble-user: #F8F5F0; --bg-bubble-bot: #3A3A3C; --bg-input: #333335;
  --bg-search: #333335; --bg-thinking-toggle: #333335; --bg-thinking-content: #2E2E30;
  --bg-panel: #2E2E30; --bg-card: #3A3A3C; --bg-button: #3A3035; --bg-button-hover: #4A3F45;
  --text-primary: #CCC; --text-secondary: #999; --text-tertiary: #777; --text-placeholder: #666;
  --text-bubble-user: #333; --text-bubble-bot: #E8E4E0; --text-thinking: #888; --text-button: #E0D0D5;
  --border-primary: #3A3A3C; --border-input: #444; --border-input-focus: #8A6A70;
  --border-bubble: #4A4A4C; --border-card: #4A4A4C; --border-thinking: #555; --border-search: #444;
  --bg-bar-translucent: rgba(42, 42, 44, 0.38);
}
.cp-root *, .cp-root *::before, .cp-root *::after { box-sizing: border-box; }
.cp-root button, .cp-root input, .cp-root textarea, .cp-root select { font-family: inherit; }

/* TOP BAR */
.cp-top {
  display: flex; align-items: center; justify-content: space-between;
  padding: calc(2px + env(safe-area-inset-top)) calc(12px + env(safe-area-inset-right)) 2px calc(12px + env(safe-area-inset-left));
  background: var(--bg-primary); flex-shrink: 0;
}
.cp-top .left, .cp-top .center, .cp-top .right {
  flex: 1 1 0; min-width: 0; display: flex; align-items: center;
}
.cp-top .center { justify-content: center; }
.cp-top .right { gap: 8px; justify-content: flex-end; }
.cp-hamburger {
  background: none; border: none; color: var(--text-secondary); cursor: pointer;
  padding: 4px 8px; border-radius: 4px; display: flex; align-items: center;
}
.cp-hamburger:hover { color: var(--text-primary); background: var(--bg-sidebar-hover); }
.cp-claude-name {
  font-size: 16px; font-weight: 500; color: var(--text-primary);
  letter-spacing: 1px; cursor: pointer; padding: 4px 10px; border-radius: 4px;
  user-select: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cp-claude-name:hover { background: var(--bg-sidebar-hover); }
.cp-model-wrap { position: relative; }
.cp-model-btn {
  background: none; border: none; cursor: pointer; padding: 4px 8px;
  display: flex; flex-direction: column; align-items: flex-end; gap: 1px;
  border-radius: 6px;
}
.cp-model-btn:hover { background: var(--bg-sidebar-hover); }
.cp-model-name { font-size: 12px; font-weight: 500; color: var(--text-primary); }
.cp-model-status { font-size: 10px; color: var(--text-tertiary); }
.cp-model-dropdown {
  position: absolute; top: 100%; right: 0; margin-top: 4px;
  background: var(--bg-panel); border: 1px solid var(--border-card);
  border-radius: 8px; padding: 4px; min-width: 180px; z-index: 80;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}
.cp-model-opt {
  padding: 7px 11px; border-radius: 6px; cursor: pointer;
  display: flex; flex-direction: column; gap: 1px;
}
.cp-model-opt:hover { background: var(--bg-sidebar-hover); }
.cp-model-opt.active { background: var(--bg-sidebar-active); }
.cp-model-opt .nm { font-size: 12px; font-weight: 500; color: var(--text-primary); }
.cp-model-opt .ds { font-size: 9px; color: var(--text-tertiary); }
.cp-conn-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.cp-conn-dot.ok { background: #C9A8AD; }
.cp-conn-dot.err { background: #ccc; }

/* MESSAGES */
.cp-messages {
  flex: 1; overflow-y: auto; padding: 14px 12px 14px;
}
.cp-empty {
  height: 100%; display: flex; align-items: center; justify-content: center;
  color: var(--text-tertiary); font-size: 14px;
}
.cp-date-sep { text-align: center; color: var(--text-tertiary); font-size: 11px; margin: 14px 0 8px; }

.cp-msg-wrap { display: flex; gap: 9px; margin-bottom: 8px; max-width: 92%; align-items: flex-start; animation: cp-msgIn 0.22s ease-out; }
.cp-msg-wrap.user { margin-left: auto; flex-direction: row-reverse; }
.cp-msg-wrap.continuation { margin-left: 45px; max-width: calc(92% - 45px); margin-bottom: 6px; }
.cp-msg-wrap.continuation .cp-avatar, .cp-msg-wrap.continuation .cp-msg-nick { display: none; }
.cp-msg-wrap.continuation .cp-msg-bubble.assistant { border-radius: 4px 12px 12px 4px; }

.cp-avatar {
  width: 34px; height: 34px; border-radius: 6px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 17px; margin-top: 1px; overflow: hidden;
}
.cp-avatar.u { background: var(--bg-bubble-user); }
.cp-avatar.b { background: var(--bg-bubble-bot); border: 1px solid var(--border-bubble); cursor: pointer; }
.cp-avatar img { width: 100%; height: 100%; object-fit: cover; }

.cp-msg-body { min-width: 0; display: flex; flex-direction: column; align-items: flex-start; flex: 1; }
.cp-msg-wrap.user .cp-msg-body { align-items: flex-end; }
.cp-msg-nick { font-size: 11px; color: var(--text-tertiary); margin-bottom: 3px; }
.cp-msg-wrap.user .cp-msg-nick { text-align: right; }

.cp-msg-bubble { line-height: 1.6; font-size: 13px; cursor: pointer; word-break: break-word; }
.cp-msg-bubble.user {
  background: rgba(242, 220, 224, 0.78); color: var(--text-bubble-user);
  padding: 9px 13px; border-radius: 12px 12px 4px 12px; white-space: pre-wrap;
}
.cp-msg-bubble.assistant {
  background: rgba(255, 255, 255, 0.68); color: var(--text-bubble-bot);
  padding: 9px 13px; border-radius: 12px 12px 12px 4px; border: 1px solid var(--border-bubble);
}
.cp-root[data-theme="dark"] .cp-msg-bubble.user { background: rgba(248, 245, 240, 0.82); }
.cp-root[data-theme="dark"] .cp-msg-bubble.assistant { background: rgba(58, 58, 60, 0.72); }

.cp-msg-images { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 6px; margin-bottom: 8px; }
.cp-msg-images img { width: 100%; border-radius: 8px; cursor: pointer; object-fit: cover; aspect-ratio: 1; }

.cp-md p { margin: 0 0 7px; }
.cp-md p:last-child { margin: 0; }
.cp-md .cp-h1 { font-size: 18px; font-weight: 600; margin: 12px 0 6px; }
.cp-md .cp-h2 { font-size: 16px; font-weight: 600; margin: 11px 0 6px; }
.cp-md .cp-h3 { font-size: 14.5px; font-weight: 600; margin: 10px 0 5px; }
.cp-md .cp-h4 { font-size: 13.5px; font-weight: 600; margin: 9px 0 4px; }
.cp-md .cp-li { padding-left: 14px; position: relative; margin: 2px 0; }
.cp-md .cp-li::before { content: "·"; position: absolute; left: 2px; color: var(--text-tertiary); }
.cp-md .cp-li.cp-oli::before { display: none; content: ""; }
.cp-md strong { font-weight: 600; }
.cp-md em { font-style: italic; }
.cp-md a { color: var(--border-input-focus); text-decoration: underline; }
.cp-md .cp-bq { border-left: 2px solid var(--border-thinking); padding-left: 8px; color: var(--text-secondary); margin: 4px 0; }
.cp-md .cp-hr { border: none; border-top: 1px solid var(--border-primary); margin: 10px 0; }
.cp-pre { background: var(--bg-thinking-content); padding: 9px 11px; border-radius: 6px; overflow-x: auto; margin: 6px 0; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
.cp-ic { background: var(--bg-thinking-toggle); padding: 1px 5px; border-radius: 3px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.88em; }

/* MSG ACTIONS */
.cp-msg-actions { display: none; gap: 5px; margin-top: 5px; align-items: center; }
.cp-msg-wrap.user .cp-msg-actions { justify-content: flex-end; }
.cp-msg-wrap.show-actions .cp-msg-actions { display: flex; }
@media (hover: hover) {
  .cp-msg-bubble:hover ~ .cp-msg-actions, .cp-msg-actions:hover { display: flex; }
}
.cp-action-time { font-size: 11px; color: var(--msg-icon-color); margin-right: 4px; }
.cp-action-btn {
  background: none; border: none; color: var(--msg-icon-color); cursor: pointer;
  font-size: 11px; padding: 3px 6px; border-radius: 4px; display: flex; align-items: center; gap: 3px;
}
.cp-action-btn:hover { background: var(--bg-sidebar-hover); }
.cp-action-btn svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.cp-edit-area { width: 100%; background: var(--bg-input); border: 1px solid var(--border-input-focus); border-radius: 6px; padding: 7px 9px; color: var(--text-primary); font-size: 13px; outline: none; resize: vertical; min-height: 60px; margin-top: 6px; }
.cp-edit-actions { display: flex; gap: 6px; margin-top: 6px; }
.cp-edit-save, .cp-edit-cancel { padding: 6px 14px; border: none; border-radius: 5px; font-size: 12px; cursor: pointer; }
.cp-edit-save { background: var(--bg-button); color: var(--text-button); }
.cp-edit-save:hover { background: var(--bg-button-hover); }
.cp-edit-cancel { background: var(--bg-sidebar-hover); color: var(--text-secondary); }

/* THINKING */
.cp-thinking-block { margin-bottom: 7px; max-width: 100%; animation: cp-fadeIn 0.2s ease; }
.cp-thinking-toggle {
  font-size: 11px; color: var(--text-tertiary); cursor: pointer;
  padding: 2px 4px 2px 0; background: transparent; border: none;
  display: inline-flex; align-items: center; gap: 4px; user-select: none;
}
.cp-thinking-toggle::before {
  content: '›'; display: inline-block; font-size: 13px; line-height: 1;
  transition: transform 0.18s ease;
}
.cp-thinking-block.open .cp-thinking-toggle::before { transform: rotate(90deg); }
.cp-thinking-toggle:hover { color: var(--text-secondary); }
.cp-thinking-content {
  display: none; border-left: 2px solid var(--border-thinking); padding: 7px 11px;
  font-size: 12px; color: var(--text-thinking); white-space: pre-wrap;
  line-height: 1.45; margin-top: 4px; max-height: 200px; overflow-y: auto;
}
.cp-thinking-block.open .cp-thinking-content { display: block; }
@keyframes cp-shimmer {
  0% { background-position: -200% center; }
  100% { background-position: 200% center; }
}
.cp-thinking-toggle.thinking {
  background: linear-gradient(90deg, var(--text-tertiary) 25%, var(--text-primary) 50%, var(--text-tertiary) 75%);
  background-size: 200% auto;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  animation: cp-shimmer 1.8s linear infinite;
}

/* TOOL CALLS — card-style，类似 Claude app */
.cp-tool-block {
  margin: 6px 0; max-width: 100%;
  background: var(--bg-card); border: 1px solid var(--border-card);
  border-radius: 8px; overflow: hidden;
  animation: cp-fadeIn 0.2s ease;
}
.cp-tool-toggle {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 7px 11px; background: transparent; border: none; cursor: pointer;
  color: var(--text-primary); font-family: inherit; font-size: 11.5px;
  text-align: left; user-select: none;
}
.cp-tool-toggle:hover { background: var(--bg-sidebar-hover); }
.cp-tool-icon {
  width: 16px; height: 16px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border-radius: 50%; font-size: 10px; font-weight: 600; line-height: 1;
}
.cp-tool-icon.ok { background: rgba(74, 157, 108, 0.18); color: #4a9d6c; }
.cp-tool-icon.error { background: rgba(192, 57, 43, 0.18); color: #c0392b; }
.cp-tool-icon.running { background: rgba(122, 169, 200, 0.12); color: #7aa9c8; }
.cp-tool-spinner {
  width: 11px; height: 11px;
  border: 2px solid currentColor; border-top-color: transparent;
  border-radius: 50%; animation: cp-spin 0.8s linear infinite;
}
.cp-tool-name {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px; color: var(--text-primary); font-weight: 500; flex-shrink: 0;
}
.cp-tool-preview {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px; color: var(--text-tertiary);
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.cp-tool-chevron {
  color: var(--text-tertiary); font-size: 14px; flex-shrink: 0;
  transition: transform 0.18s ease; margin-left: auto;
}
.cp-tool-block.open .cp-tool-chevron { transform: rotate(90deg); }
.cp-tool-content {
  border-top: 1px solid var(--border-card);
  padding: 10px 12px; background: var(--bg-panel);
  animation: cp-fadeIn 0.18s ease;
}
.cp-tool-section + .cp-tool-section { margin-top: 10px; }
.cp-tool-label {
  font-size: 10px; color: var(--text-tertiary); letter-spacing: 0.04em;
  margin-bottom: 4px; text-transform: uppercase;
}
.cp-tool-section pre {
  margin: 0; padding: 7px 9px; background: var(--bg-card); border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11.5px; line-height: 1.5; white-space: pre-wrap; word-break: break-word;
  max-height: 280px; overflow-y: auto;
  color: var(--text-primary);
}
.cp-tool-truncated { font-size: 10.5px; color: var(--text-tertiary); margin-top: 4px; font-style: italic; }
.cp-tool-pending { font-size: 11.5px; color: var(--text-tertiary); padding: 4px 0; }
@keyframes cp-spin { to { transform: rotate(360deg); } }


/* INPUT */
.cp-input-container {
  background: var(--bg-primary); border-top: 1px solid var(--border-primary);
  flex-shrink: 0;
}
.cp-image-preview {
  display: none; gap: 6px; flex-wrap: wrap;
  padding: 8px 12px; background: var(--bg-sidebar); border-bottom: 1px solid var(--border-primary);
}
.cp-image-preview.show { display: flex; }
.cp-image-preview-item { position: relative; width: 64px; height: 64px; border-radius: 6px; overflow: hidden; border: 1px solid var(--border-primary); }
.cp-image-preview-item img { width: 100%; height: 100%; object-fit: cover; }
.cp-image-preview-rm {
  position: absolute; top: 2px; right: 2px; width: 18px; height: 18px;
  background: rgba(0,0,0,0.7); border: none; border-radius: 50%; color: #fff;
  font-size: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center; line-height: 1;
}
.cp-input-area {
  padding: 10px 14px 12px; display: flex; gap: 8px; align-items: center;
}
.cp-inline-btn {
  background: none; border: none; color: var(--text-placeholder); cursor: pointer;
  padding: 0; border-radius: 4px; flex-shrink: 0;
  width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;
}
.cp-inline-btn:hover { color: var(--text-secondary); }
.cp-inline-btn svg { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.cp-inline-btn.connected { color: var(--bg-bubble-user); }
.cp-inline-btn.connected:hover { color: var(--bg-bubble-user); opacity: 0.8; }
.cp-inline-btn.error { color: var(--text-placeholder); }
.cp-input-wrapper {
  flex: 1; min-width: 0; background: var(--bg-input); border: 1px solid var(--border-input);
  border-radius: 22px; padding: 4px 5px 4px 16px;
  min-height: 44px; max-height: 140px; box-sizing: border-box;
  display: flex; align-items: center; gap: 6px;
}
.cp-input {
  flex: 1; min-width: 0; width: 100%; background: transparent; border: none;
  color: var(--text-primary); font-size: 14px; outline: none; resize: none;
  font-family: inherit; line-height: 1.5; max-height: 120px; overflow-y: auto; padding: 6px 0;
}
.cp-input::placeholder { color: var(--text-placeholder); }
.cp-send-btn {
  background: var(--bg-bubble-user); color: #fff; border: none; border-radius: 50%;
  padding: 0; cursor: pointer; flex-shrink: 0;
  height: 34px; width: 34px; display: flex; align-items: center; justify-content: center;
}
.cp-send-btn:hover { opacity: 0.88; }
.cp-send-btn svg { width: 18px; height: 18px; fill: currentColor; }
.cp-send-btn.voice {
  background: transparent; color: var(--text-tertiary);
}
.cp-send-btn.voice:hover { background: var(--bg-sidebar-hover); color: var(--text-primary); }
.cp-send-btn.voice svg { fill: none; stroke: var(--text-secondary); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.cp-send-btn.voice:hover svg { stroke: var(--text-primary); }

/* SIDEBAR (drawer) */
.cp-sidebar-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.45);
  z-index: 600; animation: cp-fadeIn 0.2s ease;
}
.cp-sidebar {
  position: fixed; top: 0; left: 0; bottom: 0; width: 290px;
  background: var(--bg-sidebar); border-right: 1px solid var(--border-primary);
  z-index: 601; display: flex; flex-direction: column;
  animation: cp-slideRight 0.25s cubic-bezier(.4,0,.2,1);
}
.cp-sidebar-header {
  padding: 14px 16px; display: flex; align-items: center; justify-content: space-between;
  border-bottom: 1px solid var(--border-primary); flex-shrink: 0;
}
.cp-sidebar-title { font-size: 15px; font-weight: 500; color: var(--text-primary); }
.cp-sidebar-close { background: none; border: none; color: var(--text-secondary); font-size: 18px; cursor: pointer; padding: 4px 8px; border-radius: 4px; }
.cp-sidebar-close:hover { color: var(--text-primary); background: var(--bg-sidebar-hover); }
.cp-sidebar-scroll { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 8px 12px 24px; }

.cp-ps-section-title { font-size: 11px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 1px; margin: 18px 0 9px; }
.cp-ps-list { display: flex; flex-direction: column; }
.cp-ps-item {
  background: var(--bg-panel); border-bottom: 1px solid var(--border-card);
  padding: 11px 12px; cursor: pointer;
  display: flex; align-items: center; justify-content: space-between;
}
.cp-ps-item:first-child { border-top: 1px solid var(--border-card); }
.cp-ps-item:hover { background: var(--bg-sidebar-hover); }
.cp-ps-item-title { font-size: 13px; color: var(--text-primary); }
.cp-ps-item-arrow { font-size: 15px; color: var(--text-tertiary); }
.cp-ps-sub-title { font-size: 13px; color: var(--text-primary); font-weight: 500; padding: 8px 0 12px; display: flex; align-items: center; gap: 8px; }
.cp-ps-back {
  background: none; border: none; color: var(--text-secondary);
  cursor: pointer; font-size: 12px; padding: 2px 6px; border-radius: 4px;
}
.cp-ps-back:hover { color: var(--text-primary); background: var(--bg-sidebar-hover); }

.cp-ps-form { margin-bottom: 14px; }
.cp-ps-form label { display: block; font-size: 12px; color: var(--text-secondary); margin-bottom: 6px; }
.cp-ps-form input, .cp-ps-form textarea, .cp-ps-form select {
  width: 100%; background: transparent; border: none; border-bottom: 1px solid var(--border-input); border-radius: 0;
  padding: 8px 0; color: var(--text-primary); font-size: 13px; outline: none; font-family: inherit;
}
.cp-ps-form textarea { min-height: 100px; resize: vertical; line-height: 1.5; }
.cp-ps-form input:focus, .cp-ps-form textarea:focus, .cp-ps-form select:focus { border-bottom-color: var(--border-input-focus); }
.cp-ps-form small { font-size: 10px; color: var(--text-tertiary); display: block; margin-top: 4px; }

.cp-ps-btn {
  width: 100%; padding: 10px; background: var(--bg-button); color: var(--text-button);
  border: none; border-radius: 8px; font-size: 13px; cursor: pointer; margin-top: 8px;
}
.cp-ps-btn:hover { background: var(--bg-button-hover); }

.cp-ps-tabs { display: flex; gap: 14px; margin-bottom: 12px; overflow-x: auto; }
.cp-ps-tab {
  background: transparent; border: none; border-bottom: 1px solid transparent; color: var(--text-secondary);
  padding: 6px 2px; font-size: 11px; border-radius: 0; cursor: pointer; white-space: nowrap;
}
.cp-ps-tab.active { background: transparent; color: var(--text-primary); border-bottom-color: var(--border-input-focus); }
.cp-ps-mem-list { max-height: 320px; overflow-y: auto; }
.cp-ps-mem-item {
  background: transparent; border: none; border-bottom: 1px solid var(--border-card); border-radius: 0;
  padding: 10px 0; margin-bottom: 0; font-size: 12px;
}
.cp-ps-mem-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; }
.cp-ps-mem-layer { color: var(--border-input-focus); font-size: 10px; text-transform: uppercase; }
.cp-ps-mem-author { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; color: var(--text-tertiary); }
.cp-ps-author-badge { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
.cp-ps-author-badge.app { background: #A8D5BA; }
.cp-ps-author-badge.web { background: #FFB6C1; }
.cp-ps-mem-actions button { background: none; border: none; color: var(--text-tertiary); cursor: pointer; font-size: 11px; padding: 2px 6px; }
.cp-ps-mem-actions button:hover { color: var(--text-primary); }
.cp-ps-mem-content { color: var(--text-secondary); line-height: 1.4; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }

.cp-ps-stats { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 18px; }
.cp-ps-stat-card {
  background: transparent; border: none; border-bottom: 1px solid var(--border-card); border-radius: 0;
  padding: 12px 4px; text-align: center;
}
.cp-ps-stat-label { font-size: 11px; color: var(--text-tertiary); margin-bottom: 6px; }
.cp-ps-stat-value { font-size: 19px; color: var(--border-input-focus); font-weight: 500; }
.cp-ps-stat-unit { font-size: 11px; color: var(--text-secondary); margin-left: 4px; }
.cp-ps-chart { margin-top: 16px; }
.cp-ps-chart-title { font-size: 12px; color: var(--text-secondary); margin-bottom: 10px; }
.cp-ps-chart-bars { display: flex; align-items: flex-end; gap: 6px; height: 120px; }
.cp-ps-chart-bar-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; }
.cp-ps-chart-bar {
  width: 100%; background: var(--bg-sidebar-active); border-radius: 4px 4px 0 0;
  transition: background 0.2s;
}
.cp-ps-chart-bar:hover { background: var(--border-input-focus); }
.cp-ps-chart-label { font-size: 10px; color: var(--text-tertiary); margin-top: 4px; }

/* MODAL: SETTINGS / RENAME / IMAGE VIEWER */
.cp-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.5);
  z-index: 700; display: flex; align-items: center; justify-content: center;
  animation: cp-fadeIn 0.2s ease;
}
.cp-overlay.bottom { align-items: flex-end; }
.cp-modal {
  background: var(--bg-panel); border-radius: 12px; padding: 18px 22px;
  width: 90%; max-width: 380px; border: 1px solid var(--border-card);
  color: var(--text-primary);
}
.cp-modal.bottom {
  border-radius: 14px 14px 0 0; padding: 20px 22px 30px;
  width: 100%; max-width: 430px; max-height: 80vh; overflow-y: auto;
  animation: cp-slideUp 0.25s ease;
}
.cp-modal h3 { margin: 0 0 14px; font-size: 15px; font-weight: 500; display: flex; align-items: center; justify-content: space-between; }
.cp-modal h3 button { background: none; border: none; color: var(--text-tertiary); cursor: pointer; font-size: 18px; padding: 4px 8px; }
.cp-modal h3 button:hover { color: var(--text-secondary); }
.cp-section { margin-bottom: 16px; }
.cp-section-title { font-size: 11px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
.cp-row { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.cp-row input[type="text"], .cp-modal input[type="text"] {
  flex: 1; background: transparent; border: none; border-bottom: 1px solid var(--border-input); border-radius: 0;
  padding: 7px 0; color: var(--text-primary); font-size: 13px; outline: none;
}
.cp-row input[type="text"]:focus, .cp-modal input[type="text"]:focus { border-bottom-color: var(--border-input-focus); }
.cp-avatar-preview {
  width: 44px; height: 44px; border-radius: 6px; display: flex; align-items: center; justify-content: center;
  font-size: 22px; overflow: hidden; cursor: pointer; position: relative; flex-shrink: 0;
}
.cp-avatar-preview.u { background: var(--bg-bubble-user); }
.cp-avatar-preview.b { background: var(--bg-bubble-bot); border: 1px solid var(--border-bubble); }
.cp-avatar-preview img { width: 100%; height: 100%; object-fit: cover; }
.cp-avatar-preview:hover::after {
  content: '✎'; position: absolute; inset: 0; background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center; font-size: 14px; color: #fff;
}
.cp-emoji-grid {
  display: grid; grid-template-columns: repeat(8, 1fr); gap: 4px;
  margin-top: 6px; padding: 6px 0; background: transparent; border-radius: 0; border: none; border-bottom: 1px solid var(--border-card);
}
.cp-emoji-grid span { text-align: center; font-size: 18px; padding: 4px; cursor: pointer; border-radius: 4px; }
.cp-emoji-grid span:hover { background: var(--bg-sidebar-hover); }
.cp-emoji-grid span.active { background: var(--bg-sidebar-active); outline: 1px solid var(--border-input-focus); }
.cp-upload-row { display: flex; gap: 8px; margin-top: 6px; align-items: center; }
.cp-upload-btn {
  background: transparent; border: none; border-bottom: 1px solid var(--border-input);
  color: var(--text-secondary); border-radius: 0; padding: 5px 2px; font-size: 11px; cursor: pointer;
}
.cp-upload-btn:hover { color: var(--text-primary); border-bottom-color: var(--border-input-focus); }
.cp-clear-btn { background: none; border: none; color: var(--text-tertiary); font-size: 11px; cursor: pointer; }
.cp-clear-btn:hover { color: #ef4444; }
.cp-save-btn {
  width: 100%; padding: 11px; background: var(--bg-button); color: var(--text-button);
  border: none; border-radius: 8px; font-size: 13px; cursor: pointer; margin-top: 6px;
}
.cp-save-btn:hover { background: var(--bg-button-hover); }
.cp-hint { font-size: 11px; color: var(--text-tertiary); margin-top: 4px; margin-bottom: 4px; }
.cp-rename-btns { display: flex; gap: 8px; margin-top: 14px; justify-content: flex-end; }
.cp-rename-btns button { padding: 7px 16px; border-radius: 6px; font-size: 12px; cursor: pointer; border: none; }
.cp-rename-cancel { background: var(--bg-sidebar-hover); color: var(--text-secondary); }
.cp-rename-ok { background: var(--bg-button); color: var(--text-button); }

.cp-img-viewer { position: fixed; inset: 0; background: rgba(0,0,0,0.92); z-index: 800; display: flex; align-items: center; justify-content: center; }
.cp-img-viewer img { max-width: 92%; max-height: 92%; border-radius: 8px; }
.cp-img-viewer-close {
  position: absolute; top: 18px; right: 18px;
  background: rgba(0,0,0,0.5); border: none; color: #fff;
  font-size: 24px; width: 42px; height: 42px; border-radius: 50%;
  cursor: pointer; display: flex; align-items: center; justify-content: center; line-height: 1;
}

/* TOAST */
.cp-toast-container {
  position: fixed; left: 50%; bottom: 90px; transform: translateX(-50%);
  z-index: 900; display: flex; flex-direction: column; gap: 8px;
  pointer-events: none; max-width: 90%;
}
.cp-toast {
  background: var(--bg-panel); color: var(--text-primary);
  border: 1px solid var(--border-card); border-radius: 8px;
  padding: 10px 14px; font-size: 13px; line-height: 1.5;
  box-shadow: 0 4px 14px rgba(0,0,0,0.18);
  display: flex; align-items: center; gap: 10px; pointer-events: auto;
  animation: cp-toastIn 0.2s ease;
}
.cp-toast .msg { flex: 1; }
.cp-toast .action {
  background: var(--bg-button); color: var(--text-button);
  border: 1px solid var(--border-primary); border-radius: 6px;
  padding: 5px 10px; font-size: 12px; cursor: pointer; white-space: nowrap;
}
.cp-toast .close { background: none; border: none; color: var(--text-tertiary); cursor: pointer; font-size: 16px; padding: 0 2px; line-height: 1; }

/* ANIMATIONS */
@keyframes cp-fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes cp-slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
@keyframes cp-slideRight { from { transform: translateX(-100%); } to { transform: translateX(0); } }
@keyframes cp-msgIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@keyframes cp-toastIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
`;

/* ════════════════════════════════════════════════════════════
   Hooks
   ════════════════════════════════════════════════════════════ */
function useTheme() {
  const get = () => localStorage.getItem("chat-theme") || "light";
  const compute = (p) => p === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : p;
  const [pref, setPref] = useState(get);
  const [resolved, setResolved] = useState(() => compute(get()));
  useEffect(() => {
    const r = compute(pref);
    setResolved(r);
    document.documentElement.setAttribute("data-theme", r);
  }, [pref]);
  useEffect(() => {
    const obs = new MutationObserver(() => {
      const t = document.documentElement.getAttribute("data-theme");
      if (t === "light" || t === "dark") setResolved(t);
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  useEffect(() => {
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setResolved(compute("system"));
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);
  const setTheme = useCallback(t => {
    localStorage.setItem("chat-theme", t);
    setPref(t);
  }, []);
  return { theme: pref, resolved, setTheme };
}

function profileKey(projectId) { return "chat-profile-" + (projectId || "default"); }
function useProfile(projectId) {
  const load = () => {
    try {
      const r = localStorage.getItem(profileKey(projectId));
      if (r) return Object.assign({}, DEFAULT_PROFILE, JSON.parse(r));
    } catch {}
    return Object.assign({}, DEFAULT_PROFILE);
  };
  const [profile, setProfile] = useState(load);
  useEffect(() => { setProfile(load()); }, [projectId]); // eslint-disable-line
  const save = useCallback(p => {
    localStorage.setItem(profileKey(projectId), JSON.stringify(p));
    setProfile(p);
  }, [projectId]);
  return [profile, save];
}

/* ════════════════════════════════════════════════════════════
   主组件
   ════════════════════════════════════════════════════════════ */
export default function ChatPanel({ onBack }) {
  const { theme, resolved, setTheme } = useTheme();
  const [profile, saveProfile] = useProfile(PROJECT_ID);

  const [convId, setConvId] = useState(() => localStorage.getItem(CONV_KEY) || null);
  const [messages, setMessages] = useState([]); // 已落库消息
  const [input, setInput] = useState("");
  const [images, setImages] = useState([]); // dataURL 数组
  const [streamSnap, setStreamSnap] = useState(null); // 流式快照（null/对象）
  const [isGenerating, setIsGenerating] = useState(false);
  const [showTyping, setShowTyping] = useState(false);
  const [ccStatus, setCcStatus] = useState("unknown"); // ready / down / unknown
  const [currentModel, setCurrentModel] = useState("");
  const [charCount, setCharCount] = useState(0);

  // UI 开关
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [psScreen, setPsScreen] = useState("main");
  const [showSettings, setShowSettings] = useState(false);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [renameTarget, setRenameTarget] = useState(null); // {id, title}
  const [imageViewer, setImageViewer] = useState(null);
  const [toasts, setToasts] = useState([]);

  // refs
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);
  const streamRef = useRef(null); // 累积器
  const typingTimerRef = useRef(null);
  const messagesScrollRef = useRef(null);
  const fileInputRef = useRef(null);
  const inputRef = useRef(null);
  const lastDateRef = useRef(null);

  /* ─────── Toast ─────── */
  const showToast = useCallback((message, opts = {}) => {
    const id = Math.random().toString(36).slice(2);
    const item = { id, message, ...opts };
    setToasts(t => [...t, item]);
    const ttl = opts.duration == null ? 8000 : opts.duration;
    if (ttl > 0) setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), ttl);
  }, []);
  const closeToast = useCallback(id => setToasts(t => t.filter(x => x.id !== id)), []);

  /* ─────── 滚动 ─────── */
  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = messagesScrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);
  const isNearBottom = useCallback(() => {
    const el = messagesScrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  }, []);

  /* ─────── Health ─────── */
  const checkHealth = useCallback(async () => {
    try {
      const r = await fetch(API + "/health");
      const d = await r.json();
      setCcStatus(d.cc_running ? "ready" : "down");
      if (d.model && currentModel === "") setCurrentModel(d.model);
    } catch {
      setCcStatus("down");
    }
  }, [currentModel]);

  /* ─────── 加载历史 ─────── */
  const loadCurrentConversation = useCallback(async () => {
    const saved = localStorage.getItem(CONV_KEY);
    if (!saved) { setConvId(null); setMessages([]); return; }
    try {
      const r = await fetch(API + "/conversations/" + saved + "/messages");
      if (!r.ok) {
        localStorage.removeItem(CONV_KEY);
        setConvId(null); setMessages([]);
        return;
      }
      const ms = await r.json();
      if (!Array.isArray(ms)) return;
      setConvId(saved);
      const total = ms.reduce((s, m) => s + ((m.content || "").length || 0), 0);
      setCharCount(total);
      setMessages(ms.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content || "",
        thinking: m.thinking || null,
        tool_calls: m.tool_calls || null,
        images: m.images || [],
        created_at: m.created_at || null,
        token_output: m.token_output || 0,
      })));
      setTimeout(scrollToBottom, 50);
    } catch (e) {
      console.warn("加载历史失败", e);
    }
  }, [scrollToBottom]);

  /* ─────── WebSocket ─────── */
  const handleWsMsg = useCallback((msg) => {
    switch (msg.type) {
      case "start":
        streamRef.current = {
          thinking: "",
          delta: "",
          tools: [],
          bubbles: null, // 多气泡模式时为 [text, ...]
          clean: null,
        };
        setIsGenerating(true);
        setStreamSnap({ thinking: "", delta: "", tools: [], bubbles: null });
        setShowTyping(true);
        break;
      case "thinking": {
        if (typingTimerRef.current) { clearTimeout(typingTimerRef.current); typingTimerRef.current = null; }
        setShowTyping(false);
        const s = streamRef.current; if (!s) break;
        s.thinking += (msg.text || "");
        const wasNear = isNearBottom();
        setStreamSnap(snap => snap ? { ...snap, thinking: s.thinking } : snap);
        if (wasNear) scrollToBottom();
        break;
      }
      case "tool_use": {
        if (typingTimerRef.current) { clearTimeout(typingTimerRef.current); typingTimerRef.current = null; }
        setShowTyping(false);
        const s = streamRef.current; if (!s) break;
        const wasNear = isNearBottom();
        s.tools.push({ id: msg.id, name: msg.name, input: msg.input, result: undefined, isError: false });
        setStreamSnap(snap => snap ? { ...snap, tools: [...s.tools] } : snap);
        if (wasNear) scrollToBottom();
        break;
      }
      case "tool_result": {
        const s = streamRef.current; if (!s) break;
        const idx = s.tools.findIndex(t => t.id === msg.tool_use_id);
        if (idx >= 0) {
          s.tools[idx].result = msg.content;
          s.tools[idx].isError = !!msg.is_error;
          setStreamSnap(snap => snap ? { ...snap, tools: [...s.tools] } : snap);
        }
        break;
      }
      case "delta": {
        const s = streamRef.current; if (!s) break;
        s.delta += (msg.text || "");
        // 流式过程中不渲染主气泡，避免 ---bubble--- 切分时闪烁
        break;
      }
      case "clear": {
        const s = streamRef.current; if (!s) break;
        s.bubbles = []; s.delta = "";
        setStreamSnap(snap => snap ? { ...snap, bubbles: [], delta: "" } : snap);
        break;
      }
      case "bubble": {
        const s = streamRef.current; if (!s) break;
        if (!Array.isArray(s.bubbles)) s.bubbles = [];
        s.bubbles.push(msg.text || "");
        setStreamSnap(snap => snap ? { ...snap, bubbles: [...s.bubbles] } : snap);
        scrollToBottom();
        break;
      }
      case "clean": {
        const s = streamRef.current; if (!s) break;
        s.clean = msg.text || "";
        break;
      }
      case "done": {
        if (typingTimerRef.current) { clearTimeout(typingTimerRef.current); typingTimerRef.current = null; }
        setShowTyping(false);
        const s = streamRef.current;
        if (!s) { setIsGenerating(false); setStreamSnap(null); break; }
        const finalText = s.clean ?? s.delta ?? "";
        const outTokens = (msg.usage && (msg.usage.output_tokens || msg.usage.output)) || 0;
        const useBubbles = Array.isArray(s.bubbles) && s.bubbles.length > 0
          ? s.bubbles
          : (finalText.indexOf("---bubble---") !== -1
              ? finalText.split("---bubble---").map(x => x.trim()).filter(Boolean)
              : (finalText ? [finalText] : []));
        if (useBubbles.length > 0) {
          const created = new Date().toISOString();
          const baseId = msg.message_id || ("local-" + Date.now());
          // 先提交首个气泡（与原版一致：第一个气泡立即出现）
          const baseMsg = {
            id: baseId,
            role: "assistant",
            content: useBubbles[0],
            thinking: s.thinking || null,
            tool_calls: s.tools.length ? s.tools.map(t => ({ ...t })) : null,
            images: [],
            created_at: created,
            token_output: outTokens,
          };
          setMessages(prev => [...prev, baseMsg]);
          // 多气泡按 1500ms 节拍依次追加（每条气泡触发 cp-msgIn 进场动画）
          for (let i = 1; i < useBubbles.length; i++) {
            const partsSoFar = useBubbles.slice(0, i + 1);
            const newContent = partsSoFar.join("\n---bubble---\n");
            setTimeout(() => {
              setMessages(prev => prev.map(m => m.id === baseId ? { ...m, content: newContent } : m));
            }, i * 1500);
          }
        }
        setStreamSnap(null);
        setIsGenerating(false);
        streamRef.current = null;
        scrollToBottom();
        break;
      }
      case "stopped": {
        if (typingTimerRef.current) { clearTimeout(typingTimerRef.current); typingTimerRef.current = null; }
        setShowTyping(false);
        const s = streamRef.current;
        if (s && (s.delta || s.thinking || s.tools.length)) {
          const stopped = {
            id: "local-" + Date.now(),
            role: "assistant",
            content: (s.clean ?? s.delta) + " [已停止]",
            thinking: s.thinking || null,
            tool_calls: s.tools.length ? s.tools.map(t => ({ ...t })) : null,
            images: [],
            created_at: new Date().toISOString(),
            token_output: 0,
          };
          setMessages(prev => [...prev, stopped]);
        }
        setIsGenerating(false);
        setStreamSnap(null);
        streamRef.current = null;
        loadCurrentConversation();
        break;
      }
      case "error": {
        if (typingTimerRef.current) { clearTimeout(typingTimerRef.current); typingTimerRef.current = null; }
        setShowTyping(false);
        setIsGenerating(false);
        setStreamSnap(null);
        streamRef.current = null;
        setMessages(prev => [...prev, {
          id: "local-" + Date.now(),
          role: "assistant",
          content: "错误: " + (msg.message || "未知错误"),
          thinking: null,
          tool_calls: null,
          images: [],
          created_at: new Date().toISOString(),
          token_output: 0,
        }]);
        break;
      }
      case "system": {
        // 显示系统消息为分隔符
        const sys = { id: "sys-" + Date.now(), role: "system", content: msg.message };
        setMessages(prev => [...prev, sys]);
        scrollToBottom();
        break;
      }
      case "char_count":
        if (!convId || msg.conversation_id === convId) {
          setCharCount(msg.total || 0);
        }
        break;
      case "cc_status":
        setCcStatus(msg.status === "ready" ? "ready" : msg.status === "down" ? "down" : "unknown");
        break;
      case "toast": {
        const opts = { duration: 15000 };
        if (msg.action === "restart_cc") {
          opts.action = { label: "立即重启", onClick: () => restartCCRef.current && restartCCRef.current() };
        }
        showToast(msg.message || "", opts);
        break;
      }
      default:
        break;
    }
  }, [convId, isNearBottom, scrollToBottom, showToast, loadCurrentConversation]);

  const connectWSRef = useRef(null);
  const connectWS = useCallback(() => {
    if (wsRef.current && (wsRef.current.readyState === 0 || wsRef.current.readyState === 1)) return;
    try {
      const ws = new WebSocket(WS_URL);
      ws.onopen = () => {
        clearTimeout(reconnectTimer.current);
        setCcStatus(s => s === "down" ? "unknown" : s);
      };
      ws.onclose = () => {
        setCcStatus("down");
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = setTimeout(() => connectWSRef.current && connectWSRef.current(), 3000);
      };
      ws.onerror = () => { /* noop */ };
      ws.onmessage = (evt) => {
        try { handleWsMsg(JSON.parse(evt.data)); } catch { /* ignore */ }
      };
      wsRef.current = ws;
    } catch { /* ignore */ }
  }, [handleWsMsg]);
  useEffect(() => { connectWSRef.current = connectWS; }, [connectWS]);

  /* ─────── 生命周期 ─────── */
  useEffect(() => {
    connectWS();
    checkHealth();
    loadCurrentConversation();
    const t = setInterval(checkHealth, 30000);
    return () => {
      clearInterval(t);
      clearTimeout(reconnectTimer.current);
      if (wsRef.current) try { wsRef.current.close(); } catch {}
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    };
    // eslint-disable-next-line
  }, []);

  /* ─────── 发送 ─────── */
  const send = useCallback(async () => {
    const text = input.trim();
    const imgs = images.slice();
    if (!text && imgs.length === 0) return;
    if (isGenerating) return;

    let cid = convId;
    if (!cid) {
      try {
        const r = await fetch(API + "/conversations", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: (text || "对话").slice(0, 40), project_id: PROJECT_ID }),
        });
        const conv = await r.json();
        cid = conv.id;
        if (cid) {
          setConvId(cid);
          localStorage.setItem(CONV_KEY, cid);
        }
      } catch {
        showToast("创建对话失败");
        return;
      }
    }

    const userMsg = {
      id: "local-u-" + Date.now(),
      role: "user",
      content: text,
      thinking: null,
      tool_calls: null,
      images: imgs,
      created_at: new Date().toISOString(),
      token_output: 0,
    };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setImages([]);
    if (inputRef.current) inputRef.current.style.height = "auto";

    const payload = {
      type: "chat",
      content: text,
      conversation_id: cid,
      settings: getSettings(PROJECT_ID),
      api_settings: getAPISettings(PROJECT_ID),
    };
    if (imgs.length > 0) payload.images = imgs;
    if (currentModel) payload.model = currentModel;

    const ws = wsRef.current;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(payload));
    } else {
      showToast("连接断开，正在重连…");
      connectWS();
    }

    scrollToBottom();
  }, [input, images, isGenerating, convId, currentModel, connectWS, showToast, scrollToBottom]);

  const stop = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "stop" }));
  }, []);

  /* ─────── CC restart / new chat ─────── */
  const restartCCRef = useRef(null);
  const newChat = useCallback(async () => {
    if (isGenerating) stop();
    try {
      const r = await fetch(API + "/conversations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "新对话", project_id: PROJECT_ID }),
      });
      const conv = await r.json();
      if (conv.id) {
        setConvId(conv.id);
        localStorage.setItem(CONV_KEY, conv.id);
      }
    } catch {}
    setMessages([]);
    setStreamSnap(null);
    setShowTyping(false);
    setCharCount(0);
    lastDateRef.current = null;
    setSidebarOpen(false);
  }, [isGenerating, stop]);

  const restartCC = useCallback(async (opts = {}) => {
    if (isGenerating && !opts.silent) {
      if (!window.confirm("CC 正在回复，强制重启会中断当前回复。继续？")) return;
    }
    try {
      const body = {};
      if (opts.model !== undefined) body.model = opts.model;
      const r = await fetch(API + "/cc/restart", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      setIsGenerating(false);
      setStreamSnap(null);
      streamRef.current = null;
      await newChat();
      if (opts.toastMessage) showToast(opts.toastMessage);
      else if (!opts.silent) showToast("CC 已重启");
      return d;
    } catch (e) {
      showToast("重启失败: " + e.message);
    }
  }, [isGenerating, newChat, showToast]);
  useEffect(() => { restartCCRef.current = restartCC; }, [restartCC]);

  /* ─────── 编辑 / 重生成 ─────── */
  const editMessage = useCallback(async (messageId, newText) => {
    if (!messageId || !convId) return;
    if (!newText.trim()) return;
    try {
      await fetch(API + "/messages/" + messageId, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newText }),
      });
      const r = await fetch(API + "/conversations/" + convId + "/messages");
      const all = await r.json();
      const editedIdx = all.findIndex(m => m.id === messageId);
      if (editedIdx !== -1) {
        for (let i = editedIdx + 1; i < all.length; i++) {
          await fetch(API + "/messages/" + all[i].id, { method: "DELETE" });
        }
      }
      await loadCurrentConversation();
      const ws = wsRef.current;
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: "chat", content: newText, conversation_id: convId,
          model: currentModel, settings: getSettings(PROJECT_ID),
          api_settings: getAPISettings(PROJECT_ID),
        }));
      }
      showToast("已重新发送，建议重启 CC", { action: { label: "立即重启", onClick: () => restartCC() }, duration: 10000 });
    } catch (e) { showToast("编辑失败: " + e.message); }
  }, [convId, currentModel, loadCurrentConversation, showToast, restartCC]);

  const regenerateMessage = useCallback(async (messageId) => {
    if (!convId || !messageId) return;
    try {
      const r = await fetch(API + "/conversations/" + convId + "/messages");
      const ms = await r.json();
      const idx = ms.findIndex(m => m.id === messageId);
      if (idx === -1) return;
      let prevUser = null;
      for (let j = idx - 1; j >= 0; j--) if (ms[j].role === "user") { prevUser = ms[j]; break; }
      if (!prevUser) { showToast("无法重新生成"); return; }
      await fetch(API + "/messages/" + messageId, { method: "DELETE" });
      await loadCurrentConversation();
      const ws = wsRef.current;
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: "chat", content: prevUser.content, conversation_id: convId,
          model: currentModel, settings: getSettings(PROJECT_ID),
          api_settings: getAPISettings(PROJECT_ID),
        }));
      }
      showToast("正在重新生成…");
    } catch (e) { showToast("重新生成失败: " + e.message); }
  }, [convId, currentModel, loadCurrentConversation, showToast]);

  /* ─────── 输入框 ─────── */
  const handleInputChange = (e) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  };
  const handleInputKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  /* ─────── 图片上传 ─────── */
  const onPickImages = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const remaining = 4 - images.length;
    const accepted = files.slice(0, remaining).filter(f => f.type.startsWith("image/"));
    if (files.length > remaining) showToast("最多只能选择 4 张图片");
    Promise.all(accepted.map(file => new Promise(res => {
      const fr = new FileReader();
      fr.onload = ev => compressImageDataUrl(ev.target.result).then(res);
      fr.readAsDataURL(file);
    }))).then(urls => {
      setImages(prev => [...prev, ...urls]);
    });
    e.target.value = "";
  };

  /* ─────── 模型选择 ─────── */
  useEffect(() => {
    if (!showModelDropdown) return;
    const onDoc = (e) => {
      if (!e.target.closest || !e.target.closest(".cp-model-wrap")) setShowModelDropdown(false);
    };
    setTimeout(() => document.addEventListener("click", onDoc), 0);
    return () => document.removeEventListener("click", onDoc);
  }, [showModelDropdown]);

  const selectModel = useCallback(async (value, name) => {
    setShowModelDropdown(false);
    if (value === currentModel) return;
    setCurrentModel(value);
    const label = name || value || "默认";
    await restartCC({ model: value || null, silent: true, toastMessage: "CC 已重启，当前模型：" + label });
  }, [currentModel, restartCC]);

  /* ─────── 重命名 ─────── */
  const confirmRename = useCallback(async (id, title) => {
    if (!title || !id) return;
    try {
      await fetch(API + "/conversations/" + id, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      showToast("已重命名");
    } catch (e) { showToast("重命名失败: " + e.message); }
    setRenameTarget(null);
  }, [showToast]);

  /* ─────── 渲染辅助：日期分隔 ─────── */
  const renderItems = useMemo(() => {
    const items = [];
    let lastTs = null;
    for (const m of messages) {
      if (m.role === "system") {
        items.push({ kind: "system", id: m.id, content: m.content });
        continue;
      }
      const ts = m.created_at ? new Date(m.created_at).getTime() : null;
      if (ts != null) {
        if (!lastTs || (ts - lastTs) >= TIME_SEP_GAP_MS) {
          items.push({ kind: "date-sep", id: "ds-" + ts, label: formatDateTime(new Date(ts)) });
        }
        lastTs = ts;
      }
      // 拆分 ---bubble--- 多气泡
      if (m.role === "assistant" && m.content && m.content.indexOf("---bubble---") !== -1) {
        const parts = m.content.split("---bubble---").map(x => x.trim()).filter(Boolean);
        parts.forEach((text, i) => {
          items.push({
            kind: "msg", id: m.id + "-" + i, msg: m, partText: text, partIndex: i,
            isHead: i === 0, isTail: i === parts.length - 1,
            continuation: i > 0,
          });
        });
      } else {
        items.push({ kind: "msg", id: m.id, msg: m, partText: m.content, partIndex: 0, isHead: true, isTail: true });
      }
    }
    return items;
  }, [messages]);

  /* ─────── 自动滚动 ─────── */
  useEffect(() => {
    if (isNearBottom()) scrollToBottom();
  }, [messages, streamSnap, showTyping, scrollToBottom, isNearBottom]);

  /* ─────── 渲染 ─────── */
  const statusColor = ccStatus === "ready" ? "ok" : ccStatus === "down" ? "err" : "err";
  const currentModelInfo = MODEL_OPTIONS.find(m => m.value === currentModel) || MODEL_OPTIONS[0];

  return (
    <div className="cp-root" data-theme={resolved}>
      <style>{CSS}</style>

      {/* TOP BAR */}
      <div className="cp-top">
        <div className="left">
          {onBack && (
            <button className="cp-hamburger" onClick={onBack} aria-label="返回" title="返回">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>
          )}
          <button className="cp-hamburger" onClick={() => setSidebarOpen(true)} aria-label="菜单">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6"/>
              <line x1="3" y1="12" x2="21" y2="12"/>
              <line x1="3" y1="18" x2="13" y2="18"/>
            </svg>
          </button>
        </div>
        <div className="center">
          <span className="cp-claude-name" onClick={() => setShowSettings(true)} title="点击编辑">
            {profile.botNick || "Claude"}
          </span>
        </div>
        <div className="right">
          <div className="cp-model-wrap">
            <button className="cp-model-btn" onClick={(e) => { e.stopPropagation(); setShowModelDropdown(s => !s); }}>
              <span className="cp-model-name">{currentModelInfo.name}</span>
              <span className="cp-model-status">{formatK(charCount)} / {formatK(getSettings(PROJECT_ID).compressThreshold)}</span>
            </button>
            {showModelDropdown && (
              <div className="cp-model-dropdown" onClick={e => e.stopPropagation()}>
                {MODEL_OPTIONS.map(m => (
                  <div key={m.value || "default"}
                    className={"cp-model-opt" + (currentModel === m.value ? " active" : "")}
                    onClick={() => selectModel(m.value, m.name)}>
                    <span className="nm">{m.name}</span>
                    <span className="ds">{m.desc}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* MESSAGES */}
      <div className="cp-messages" ref={messagesScrollRef} onClick={(e) => { if (e.target.closest(".cp-avatar.b")) setTerminalOpen(true); }}>
        {renderItems.length === 0 && !streamSnap && !showTyping && (
          <div className="cp-empty">开始一段新对话</div>
        )}

        {renderItems.map(it => {
          if (it.kind === "date-sep") {
            return <div key={it.id} className="cp-date-sep">{it.label}</div>;
          }
          if (it.kind === "system") {
            return <div key={it.id} className="cp-date-sep" style={{ color: "#888" }}>{it.content}</div>;
          }
          return (
            <MessageBubble key={it.id} item={it} profile={profile}
              onCopy={copyText}
              onOpenImage={(src) => setImageViewer(src)}
              onEdit={editMessage}
              onRegen={regenerateMessage}
            />
          );
        })}

        {/* 流式（在所有已落库消息之后） */}
        {streamSnap && (
          <StreamingBubble snap={streamSnap} profile={profile} showTyping={showTyping} />
        )}

        {/* typing 单独显示（已落库后等待时） */}
        {showTyping && !streamSnap && (
          <div className="cp-msg-wrap assistant">
            <div className={"cp-avatar b"}>
              {profile.botImg ? <img src={profile.botImg} alt=""/> : profile.botEmoji}
            </div>
            <div className="cp-msg-body">
              <ThinkingBlock text="" isThinking={true} />
            </div>
          </div>
        )}
      </div>

      {/* INPUT BAR */}
      <div className="cp-input-container">
        {images.length > 0 && (
          <div className="cp-image-preview show">
            {images.map((src, i) => (
              <div key={i} className="cp-image-preview-item">
                <img src={src} alt="" />
                <button className="cp-image-preview-rm" onClick={() => setImages(arr => arr.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
          </div>
        )}
        <div className="cp-input-area">
          <button
            className={"cp-inline-btn " + (ccStatus === "ready" ? "connected" : ccStatus === "down" ? "error" : "")}
            onClick={() => fileInputRef.current && fileInputRef.current.click()}
            title="附件">
            <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={onPickImages}/>
          <div className="cp-input-wrapper">
            <textarea ref={inputRef} className="cp-input" rows={1}
              value={input} onChange={handleInputChange} onKeyDown={handleInputKey}
              placeholder="说点什么..." />
            <SendStopButton
              isGenerating={isGenerating}
              hasContent={!!input.trim() || images.length > 0}
              onSend={send}
              onStop={stop}
              onVoice={() => showToast("语音功能开发中")}
            />
          </div>
        </div>
      </div>

      {/* TERMINAL placeholder */}
      {terminalOpen && <TerminalPlaceholder onClose={() => setTerminalOpen(false)} />}

      {/* SIDEBAR */}
      {sidebarOpen && (
        <>
          <div className="cp-sidebar-overlay" onClick={() => setSidebarOpen(false)} />
          <div className="cp-sidebar">
            <div className="cp-sidebar-header">
              <div className="cp-sidebar-title">设置</div>
              <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                {onBack && <button onClick={() => { setSidebarOpen(false); onBack(); }} style={{ background:"none", border:"none", color:"var(--text-secondary)", cursor:"pointer", fontSize:13, padding:"2px 8px" }}>← 返回</button>}
                <button className="cp-sidebar-close" onClick={() => setSidebarOpen(false)}>✕</button>
              </div>
            </div>
            <div className="cp-sidebar-scroll">
              <SidebarScreens
                screen={psScreen}
                setScreen={setPsScreen}
                theme={theme}
                setTheme={setTheme}
                onNewChat={newChat}
                onRestartCC={restartCC}
                showToast={showToast}
                convId={convId}
              />
            </div>
          </div>
        </>
      )}

      {/* SETTINGS MODAL (头像/昵称) */}
      {showSettings && (
        <SettingsModal
          profile={profile}
          onSave={saveProfile}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* RENAME MODAL */}
      {renameTarget && (
        <RenameModal
          initial={renameTarget.title}
          onCancel={() => setRenameTarget(null)}
          onConfirm={(t) => confirmRename(renameTarget.id, t)}
        />
      )}

      {/* IMAGE VIEWER */}
      {imageViewer && (
        <div className="cp-img-viewer" onClick={() => setImageViewer(null)}>
          <img src={imageViewer} alt="" />
          <button className="cp-img-viewer-close">✕</button>
        </div>
      )}

      {/* TOAST */}
      <div className="cp-toast-container">
        {toasts.map(t => (
          <div key={t.id} className="cp-toast">
            <span className="msg">{t.message}</span>
            {t.action && (
              <button className="action" onClick={() => { try { t.action.onClick(); } catch {} closeToast(t.id); }}>
                {t.action.label}
              </button>
            )}
            <button className="close" onClick={() => closeToast(t.id)}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   子组件
   ════════════════════════════════════════════════════════════ */

function SendStopButton({ isGenerating, hasContent, onSend, onStop, onVoice }) {
  if (isGenerating) {
    return (
      <button className="cp-send-btn" onClick={onStop} title="停止">
        <svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
      </button>
    );
  }
  if (hasContent) {
    return (
      <button className="cp-send-btn" onClick={onSend} title="发送">
        <svg viewBox="0 0 24 24"><path d="M3.4 20.4 20.85 12.9c.81-.35.81-1.45 0-1.8L3.4 3.6c-.66-.29-1.39.2-1.39.92L2 9.12c0 .5.37.93.87 1l10.13 1.38-10.13 1.38c-.5.07-.87.5-.87 1l.01 4.6c0 .72.73 1.21 1.39.92z"/></svg>
      </button>
    );
  }
  return (
    <button className="cp-send-btn voice" onClick={onVoice} title="语音">
      <svg viewBox="0 0 24 24">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
        <line x1="12" y1="19" x2="12" y2="23"/>
        <line x1="8" y1="23" x2="16" y2="23"/>
      </svg>
    </button>
  );
}

function MessageBubble({ item, profile, onCopy, onOpenImage, onEdit, onRegen }) {
  const { msg, partText, isHead, isTail, continuation } = item;
  const role = msg.role;
  const [showActions, setShowActions] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(partText);

  const isUser = role === "user";
  const wrap = "cp-msg-wrap " + role + (continuation ? " continuation" : "") + (showActions ? " show-actions" : "");

  const ts = msg.created_at ? new Date(msg.created_at) : new Date();

  const startEdit = () => { setEditing(true); setEditText(partText); };
  const saveEdit = () => {
    setEditing(false);
    if (editText.trim() && editText !== partText) onEdit(msg.id, editText);
  };
  const cancelEdit = () => { setEditing(false); setEditText(partText); };

  return (
    <div className={wrap}>
      {!continuation && (
        <div className={"cp-avatar " + (isUser ? "u" : "b")}>
          {(isUser ? profile.userImg : profile.botImg)
            ? <img src={isUser ? profile.userImg : profile.botImg} alt="" />
            : (isUser ? profile.userEmoji : profile.botEmoji)}
        </div>
      )}
      <div className="cp-msg-body">
        {/* thinking 块（仅 head 显示） */}
        {isHead && msg.thinking && <ThinkingBlock text={msg.thinking} />}
        {/* tool calls 块 */}
        {isHead && msg.tool_calls && msg.tool_calls.length > 0 && (
          <ToolCallsBlock calls={msg.tool_calls} />
        )}
        <div className={"cp-msg-bubble " + role} onClick={(e) => {
          if (e.target.tagName === "IMG" || e.target.tagName === "A") return;
          setShowActions(s => !s);
        }}>
          {isHead && msg.images && msg.images.length > 0 && (
            <div className="cp-msg-images">
              {msg.images.map((src, i) => (
                <img key={i} src={src} alt="" onClick={(e) => { e.stopPropagation(); onOpenImage(src); }} />
              ))}
            </div>
          )}
          {isUser ? (
            !editing ? (partText || "")
            : (
              <>
                <textarea className="cp-edit-area" value={editText}
                  onChange={e => setEditText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEdit(); }
                    else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
                  }}
                  autoFocus
                />
                <div className="cp-edit-actions">
                  <button className="cp-edit-save" onClick={(e) => { e.stopPropagation(); saveEdit(); }}>✓ 保存</button>
                  <button className="cp-edit-cancel" onClick={(e) => { e.stopPropagation(); cancelEdit(); }}>✕ 取消</button>
                </div>
              </>
            )
          ) : (
            <div className="cp-md" dangerouslySetInnerHTML={{ __html: md(partText || "") }} />
          )}
        </div>
        {!editing && (
          <div className="cp-msg-actions">
            <span className="cp-action-time">
              {formatTime(ts)}
              {isTail && msg.token_output ? " · " + msg.token_output + " tokens" : ""}
            </span>
            <button className="cp-action-btn" title="复制" onClick={(e) => { e.stopPropagation(); onCopy(partText || ""); }}>
              <svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            {isUser && msg.id && !String(msg.id).startsWith("local-") && (
              <button className="cp-action-btn" title="编辑" onClick={(e) => { e.stopPropagation(); startEdit(); }}>
                <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
            )}
            {!isUser && isTail && msg.id && !String(msg.id).startsWith("local-") && (
              <button className="cp-action-btn" title="重新生成" onClick={(e) => { e.stopPropagation(); onRegen(msg.id); }}>
                <svg viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// 思绪展开状态按 text 持久化：StreamingBubble unmount 后历史块重新挂载也能保留 open
const thinkingOpenStore = new Map();
function TerminalPlaceholder({ onClose }) {
  return createPortal(
    <div style={{
      position: "fixed", inset: 0, zIndex: 70,
      background: "rgba(0, 0, 0, 0.72)",
      backdropFilter: "blur(8px)",
      WebkitBackdropFilter: "blur(8px)",
      display: "flex", flexDirection: "column",
      paddingTop: "env(safe-area-inset-top, 0px)",
      paddingBottom: "env(safe-area-inset-bottom, 0px)",
    }}>
      <div style={{
        display: "flex", alignItems: "center",
        padding: "14px 20px",
        color: "rgba(255,255,255,0.7)", fontSize: 13, letterSpacing: "0.1em",
      }}>
        <span>终端</span>
        <button onClick={onClose} style={{
          marginLeft: "auto", background: "none", border: "none",
          color: "rgba(255,255,255,0.7)", fontSize: 22, lineHeight: 1, cursor: "pointer",
        }}>×</button>
      </div>
      <div style={{
        flex: 1, margin: "0 20px 20px",
        background: "#0d0d0d",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 8,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#888",
        fontFamily: "Menlo, Monaco, 'Courier New', monospace", fontSize: 13,
        textAlign: "center", padding: "0 20px",
      }}>
        终端（xterm.js 待接入）
      </div>
    </div>,
    document.body
  );
}

function ThinkingBlock({ text, isThinking }) {
  const [open, setOpen] = useState(() => thinkingOpenStore.get(text) === true);
  useEffect(() => { thinkingOpenStore.set(text, open); }, [text, open]);
  const contentRef = useRef(null);
  useEffect(() => {
    if (open && isThinking && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [text, open, isThinking]);
  return (
    <div className={"cp-thinking-block" + (open ? " open" : "")}>
      <button className={"cp-thinking-toggle" + (isThinking ? " thinking" : "")} onClick={() => setOpen(o => !o)}>
        思绪
      </button>
      {text && <div ref={contentRef} className="cp-thinking-content">{text}</div>}
    </div>
  );
}

function ToolCallsBlock({ calls }) {
  return (
    <>
      {calls.map((c, i) => (
        <ToolCallBlock key={c.id || i} call={c} />
      ))}
    </>
  );
}

// 提取常见工具的关键参数做行内预览（折叠时显示）
function getToolPreview(input) {
  if (!input || typeof input !== "object") return null;
  const trim = (s, n = 80) => {
    const v = String(s);
    return v.length > n ? v.slice(0, n) + "…" : v;
  };
  if (input.file_path) return trim(input.file_path, 90);
  if (input.path) return trim(input.path, 90);
  if (input.command) return trim(input.command);
  if (input.pattern) return trim(input.pattern);
  if (input.query) return trim(input.query);
  if (input.url) return trim(input.url, 90);
  if (input.description) return trim(input.description);
  if (input.prompt) return trim(input.prompt);
  return null;
}

function ToolCallBlock({ call }) {
  const [open, setOpen] = useState(false);
  const hasResult = call.result !== undefined;
  const status = !hasResult ? "running" : (call.isError ? "error" : "ok");
  const preview = getToolPreview(call.input);

  // 参数：JSON 美化
  const paramsText = call.input ? prettyJSON(call.input) : "";
  const showParams = paramsText && paramsText !== "{}" && paramsText !== "null";

  // 结果：识别 JSON 自动美化
  let rawResult = "";
  let resultIsJson = false;
  if (hasResult) {
    rawResult = call.result == null ? "" : String(call.result);
    const trimmed = rawResult.trim();
    if (trimmed && (trimmed[0] === "{" || trimmed[0] === "[")) {
      try {
        rawResult = JSON.stringify(JSON.parse(trimmed), null, 2);
        resultIsJson = true;
      } catch { /* keep raw text */ }
    }
  }
  const truncated = rawResult.length > TOOL_RESULT_MAX_CHARS;
  const resultText = truncated ? rawResult.slice(0, TOOL_RESULT_MAX_CHARS) : rawResult;

  return (
    <div className={"cp-tool-block" + (open ? " open" : "")}>
      <button type="button" className="cp-tool-toggle" onClick={() => setOpen(o => !o)}>
        <span className={"cp-tool-icon " + status} aria-hidden="true">
          {status === "running" ? <span className="cp-tool-spinner"/>
            : status === "error" ? "✕" : "✓"}
        </span>
        <span className="cp-tool-name">{call.name || "tool"}</span>
        {preview && <span className="cp-tool-preview">{preview}</span>}
        <span className="cp-tool-chevron" aria-hidden="true">›</span>
      </button>
      {open && (
        <div className="cp-tool-content">
          {showParams && (
            <div className="cp-tool-section">
              <div className="cp-tool-label">参数</div>
              <pre>{paramsText}</pre>
            </div>
          )}
          <div className="cp-tool-section">
            <div className="cp-tool-label">{resultIsJson ? "结果（JSON）" : "结果"}</div>
            {!hasResult ? (
              <div className="cp-tool-pending">⋯ 等待结果</div>
            ) : (
              <>
                <pre>{resultText || "（空）"}</pre>
                {truncated && (
                  <div className="cp-tool-truncated">…已截断，省略 {rawResult.length - TOOL_RESULT_MAX_CHARS} 字符</div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StreamingBubble({ snap, profile, showTyping }) {
  // 与 test-chat.html 行为一致：流式阶段不渲染 delta 到可见气泡，
  // 只展示 thinking / tool 调用，或后端显式发来的 bubble 事件。
  // 真正的气泡由 done 事件携 cp-msgIn 进场动画弹出。
  const bubbles = Array.isArray(snap.bubbles) && snap.bubbles.length > 0 ? snap.bubbles : [];
  const hasInner = !!snap.thinking || (snap.tools && snap.tools.length > 0) || bubbles.length > 0;

  return (
    <>
      <div className="cp-msg-wrap assistant">
        <div className="cp-avatar b">
          {profile.botImg ? <img src={profile.botImg} alt="" /> : profile.botEmoji}
        </div>
        <div className="cp-msg-body">
          <ThinkingBlock text={snap.thinking || ""} isThinking={true} />
          {snap.tools && snap.tools.length > 0 && <ToolCallsBlock calls={snap.tools} />}
          {bubbles.length > 0 && (
            <div className="cp-msg-bubble assistant">
              <div className="cp-md" dangerouslySetInnerHTML={{ __html: md(bubbles[0]) }} />
            </div>
          )}
        </div>
      </div>
      {bubbles.slice(1).map((t, i) => (
        <div key={i} className="cp-msg-wrap assistant continuation">
          <div className="cp-msg-body">
            <div className="cp-msg-bubble assistant">
              <div className="cp-md" dangerouslySetInnerHTML={{ __html: md(t) }} />
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

/* ─────── Sidebar 多屏 ─────── */
function SidebarScreens({ screen, setScreen, theme, setTheme, onNewChat, onRestartCC, showToast, convId }) {
  if (screen === "main") {
    return (
      <>
        <div className="cp-ps-section-title">通用</div>
        <div className="cp-ps-list">
          <SidebarItem onClick={() => setScreen("window")}>窗口设置</SidebarItem>
          <SidebarItem onClick={() => setScreen("voice")}>语音服务</SidebarItem>
        </div>
        <div className="cp-ps-section-title">管理</div>
        <div className="cp-ps-list">
          <SidebarItem onClick={() => setScreen("history")}>聊天记录</SidebarItem>
          <SidebarItem onClick={() => setScreen("documents")}>文档管理</SidebarItem>
          <SidebarItem onClick={() => setScreen("params")}>参数设置</SidebarItem>
          <SidebarItem onClick={() => setScreen("api")}>API 设置</SidebarItem>
        </div>
        <div className="cp-ps-section-title">统计</div>
        <div className="cp-ps-list">
          <SidebarItem onClick={() => setScreen("stats-menu")}>统计</SidebarItem>
        </div>
      </>
    );
  }
  if (screen === "stats-menu") {
    return (
      <>
        <div className="cp-ps-sub-title"><button className="cp-ps-back" onClick={() => setScreen("main")}>← 返回</button>统计</div>
        <div className="cp-ps-list">
          <SidebarItem onClick={() => setScreen("stats")}>用量统计</SidebarItem>
          <SidebarItem onClick={() => setScreen("stats-chars")}>字数统计</SidebarItem>
        </div>
      </>
    );
  }
  if (screen === "window") {
    return (
      <>
        <div className="cp-ps-sub-title"><button className="cp-ps-back" onClick={() => setScreen("main")}>← 返回</button>窗口设置</div>
        <div className="cp-ps-list">
          <SidebarItem onClick={onNewChat}>新对话（清屏）</SidebarItem>
          <SidebarItem onClick={() => onRestartCC()}>重启 CC 进程</SidebarItem>
        </div>
      </>
    );
  }
  if (screen === "voice") {
    return (
      <>
        <div className="cp-ps-sub-title"><button className="cp-ps-back" onClick={() => setScreen("main")}>← 返回</button>语音服务</div>
        <div className="cp-ps-form">
          <p style={{ color: "var(--text-tertiary)", fontSize: 12, lineHeight: 1.6 }}>语音输入和语音合成功能正在开发中，敬请期待。</p>
        </div>
      </>
    );
  }
  if (screen === "history") return <HistoryScreen onBack={() => setScreen("main")} showToast={showToast} />;
  if (screen === "documents") return <DocumentsScreen onBack={() => setScreen("main")} onRestartCC={onRestartCC} showToast={showToast} />;
  if (screen === "params") return <ParamsScreen onBack={() => setScreen("main")} showToast={showToast} />;
  if (screen === "api") return <APISettingsScreen onBack={() => setScreen("main")} showToast={showToast} />;
  if (screen === "stats") return <StatsScreen onBack={() => setScreen("stats-menu")} />;
  if (screen === "stats-chars") return <CharStatsScreen onBack={() => setScreen("stats-menu")} convId={convId} />;
  return null;
}

function SidebarItem({ onClick, children }) {
  return (
    <div className="cp-ps-item" onClick={onClick}>
      <div className="cp-ps-item-title">{children}</div>
      <div className="cp-ps-item-arrow">›</div>
    </div>
  );
}

function ParamsScreen({ onBack, showToast }) {
  const [s, setS] = useState(() => getSettings(PROJECT_ID));
  const update = (k, v) => setS(prev => ({ ...prev, [k]: v }));
  const save = () => {
    saveSettingsValues(PROJECT_ID, {
      bufferTime: parseInt(s.bufferTime) || 10,
      shortMsgCount: parseInt(s.shortMsgCount) || 5,
      compressThreshold: parseInt(s.compressThreshold) || 50000,
      summaryLength: parseInt(s.summaryLength) || 500,
      defaultModel: s.defaultModel || "",
    });
    showToast("参数已保存");
  };
  return (
    <>
      <div className="cp-ps-sub-title"><button className="cp-ps-back" onClick={onBack}>← 返回</button>参数设置</div>
      <div className="cp-ps-section-title">短消息模式</div>
      <div className="cp-ps-form">
        <label>缓冲时间（秒）</label>
        <input type="number" value={s.bufferTime} min={0} onChange={e => update("bufferTime", e.target.value)} />
      </div>
      <div className="cp-ps-form">
        <label>短消息条数</label>
        <input type="number" value={s.shortMsgCount} min={1} onChange={e => update("shortMsgCount", e.target.value)} />
      </div>
      <div className="cp-ps-section-title">对话自动压缩</div>
      <div className="cp-ps-form">
        <label>压缩阈值（字数）</label>
        <input type="number" value={s.compressThreshold} min={10000} step={5000} onChange={e => update("compressThreshold", e.target.value)} />
        <small>对话超过此字数时提示重启并生成摘要</small>
      </div>
      <div className="cp-ps-form">
        <label>摘要长度（字）</label>
        <input type="number" value={s.summaryLength} min={200} max={2000} step={100} onChange={e => update("summaryLength", e.target.value)} />
        <small>自动生成的摘要目标字数</small>
      </div>
      <div className="cp-ps-section-title">模型预设</div>
      <div className="cp-ps-form">
        <label>默认模型</label>
        <select value={s.defaultModel} onChange={e => update("defaultModel", e.target.value)}>
          <option value="">默认（跟随 CC 配置）</option>
          {MODEL_OPTIONS.filter(m => m.value).map(m => (
            <option key={m.value} value={m.value}>{m.name}</option>
          ))}
        </select>
      </div>
      <button className="cp-ps-btn" onClick={save}>保存设置</button>
    </>
  );
}

/* ─────── API 设置：API key / 模型 / 缓存 ─────── */
const API_MODEL_OPTIONS = [
  { value: "claude-opus-4-7", label: "Opus 4.7" },
  { value: "claude-opus-4-6", label: "Opus 4.6" },
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { value: "claude-sonnet-4-5-20250929", label: "Sonnet 4.5" },
  { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
];

function APISettingsScreen({ onBack, showToast }) {
  const [s, setS] = useState(() => getAPISettings(PROJECT_ID));
  const [showKey, setShowKey] = useState(false);
  const update = (k, v) => setS(prev => ({ ...prev, [k]: v }));
  const save = () => {
    saveAPISettingsValues(PROJECT_ID, {
      apiKey: (s.apiKey || "").trim(),
      model: s.model || DEFAULT_API_SETTINGS.model,
      maxTokens: parseInt(s.maxTokens) || DEFAULT_API_SETTINGS.maxTokens,
      temperature: Math.max(0, Math.min(2, parseFloat(s.temperature) || 0)),
      thinkingBudget: Math.max(0, parseInt(s.thinkingBudget) || 0),
      cacheEnabled: !!s.cacheEnabled,
      cacheTTL: s.cacheTTL || DEFAULT_API_SETTINGS.cacheTTL,
    });
    showToast("API 设置已保存");
  };

  const inputStyle = {
    width: "100%", background: "transparent", border: "none", borderBottom: "1px solid var(--border-input)",
    borderRadius: 0, padding: "8px 0", color: "var(--text-primary)", fontSize: 13,
    outline: "none", fontFamily: "inherit",
  };

  return (
    <>
      <div className="cp-ps-sub-title"><button className="cp-ps-back" onClick={onBack}>← 返回</button>API 设置</div>

      <div className="cp-ps-section-title">认证</div>
      <div className="cp-ps-form">
        <label>API Key</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type={showKey ? "text" : "password"}
            value={s.apiKey || ""}
            onChange={e => update("apiKey", e.target.value)}
            placeholder="sk-ant-..."
            style={{ ...inputStyle, flex: 1 }}
            autoComplete="off"
          />
          <button type="button" className="cp-upload-btn"
            style={{ flexShrink: 0 }}
            onClick={() => setShowKey(v => !v)}>
            {showKey ? "隐藏" : "显示"}
          </button>
        </div>
        <small>留空则使用后端默认 key（环境变量）。仅保存在本地浏览器，每轮通过 WS 传给后端。</small>
      </div>

      <div className="cp-ps-section-title">模型</div>
      <div className="cp-ps-form">
        <label>API 模式默认模型</label>
        <select value={s.model || ""} onChange={e => update("model", e.target.value)}>
          {API_MODEL_OPTIONS.map(m => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>

      <div className="cp-ps-form">
        <label>Max Tokens</label>
        <input type="number" min={256} max={64000} step={256}
          value={s.maxTokens} onChange={e => update("maxTokens", e.target.value)} />
        <small>单次回复最多生成的 token 数</small>
      </div>

      <div className="cp-ps-form">
        <label>Temperature</label>
        <input type="number" min={0} max={2} step={0.1}
          value={s.temperature} onChange={e => update("temperature", e.target.value)} />
        <small>0 ~ 2，越高越发散；启用 thinking 时建议设为 1</small>
      </div>

      <div className="cp-ps-form">
        <label>Extended Thinking 预算（tokens，0 关闭）</label>
        <input type="number" min={0} max={64000} step={1024}
          value={s.thinkingBudget} onChange={e => update("thinkingBudget", e.target.value)} />
        <small>非 0 时开启思考链；预算需小于 max_tokens</small>
      </div>

      <div className="cp-ps-section-title">缓存</div>
      <div className="cp-ps-form">
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 0 }}>
          <input type="checkbox" checked={!!s.cacheEnabled}
            onChange={e => update("cacheEnabled", e.target.checked)}
            style={{ margin: 0, width: 16, height: 16 }} />
          <span style={{ fontSize: 13, color: "var(--text-primary)" }}>启用 Prompt Caching</span>
        </label>
        <small>对 system prompt + 文件 + 历史消息打缓存断点，命中时大幅减少 input token 计费</small>
      </div>

      <div className="cp-ps-form">
        <label>缓存 TTL</label>
        <select value={s.cacheTTL || "5m"} disabled={!s.cacheEnabled}
          onChange={e => update("cacheTTL", e.target.value)}>
          <option value="5m">5 分钟（默认，无额外费用）</option>
          <option value="1h">1 小时（额外费用，长会话推荐）</option>
        </select>
      </div>

      <button className="cp-ps-btn" onClick={save}>保存</button>
      <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 10, lineHeight: 1.6 }}>
        仅在 API 模式（每轮直接调用 Anthropic API）下生效。CC 模式由 CC 进程自己管理 key 与模型；
        切换模式见「文档管理 → CC / API 文档」。
      </div>
    </>
  );
}

function StatsScreen({ onBack }) {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    fetch(API + "/stats/tokens").then(r => r.json()).then(setStats).catch(e => setError(e.message));
  }, []);
  if (error) {
    return (
      <>
        <div className="cp-ps-sub-title"><button className="cp-ps-back" onClick={onBack}>← 返回</button>用量统计</div>
        <div style={{ color: "var(--text-tertiary)", fontSize: 12, padding: "20px 0" }}>加载失败: {error}</div>
      </>
    );
  }
  if (!stats) {
    return (
      <>
        <div className="cp-ps-sub-title"><button className="cp-ps-back" onClick={onBack}>← 返回</button>用量统计</div>
        <div style={{ color: "var(--text-tertiary)", fontSize: 12, padding: "20px 0" }}>加载中…</div>
      </>
    );
  }
  const daily = stats.daily || [];
  const maxValue = Math.max(1, ...daily.map(d => d.output || 0));
  return (
    <>
      <div className="cp-ps-sub-title"><button className="cp-ps-back" onClick={onBack}>← 返回</button>用量统计</div>
      <div className="cp-ps-stats">
        <div className="cp-ps-stat-card">
          <div className="cp-ps-stat-label">今日</div>
          <div className="cp-ps-stat-value">{(stats.today || 0).toLocaleString()}<span className="cp-ps-stat-unit">tokens</span></div>
        </div>
        <div className="cp-ps-stat-card">
          <div className="cp-ps-stat-label">本周</div>
          <div className="cp-ps-stat-value">{(stats.week || 0).toLocaleString()}<span className="cp-ps-stat-unit">tokens</span></div>
        </div>
        <div className="cp-ps-stat-card">
          <div className="cp-ps-stat-label">本月</div>
          <div className="cp-ps-stat-value">{(stats.month || 0).toLocaleString()}<span className="cp-ps-stat-unit">tokens</span></div>
        </div>
      </div>
      <div className="cp-ps-chart">
        <div className="cp-ps-chart-title">最近 7 天</div>
        <div className="cp-ps-chart-bars">
          {daily.map((d, i) => {
            const heightPercent = d.output === 0 ? 0 : Math.max(12, (d.output / maxValue) * 100);
            const isToday = i === daily.length - 1;
            const valueLabel = d.output > 999 ? (d.output / 1000).toFixed(1) + "k" : (d.output || 0);
            const dateLabel = new Date(d.date).getDate() + "日";
            return (
              <div key={i} className="cp-ps-chart-bar-wrap">
                {d.output > 0 && (
                  <div style={{ fontSize: 9, color: "var(--text-tertiary)", marginBottom: 2, minHeight: 12 }}>{valueLabel}</div>
                )}
                {d.output === 0 ? (
                  <div className="cp-ps-chart-bar" style={{ height: 2, opacity: 0.3 }} />
                ) : (
                  <div className="cp-ps-chart-bar" style={{ height: heightPercent + "%", background: isToday ? "var(--border-input-focus)" : undefined }} />
                )}
                <div className="cp-ps-chart-label">{dateLabel}{isToday ? " (今)" : ""}</div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

/* ─────── 文件管理：上传 / 下载 / 删除 ─────── */
function formatFileSize(n) {
  if (!n && n !== 0) return "?";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}

const TEXT_MIME_RE = /^text\/|^application\/(json|xml|javascript|x-yaml|x-yml|x-sh|graphql)/i;
const TEXT_EXT_RE = /\.(md|markdown|txt|csv|tsv|json|jsonc|yaml|yml|toml|ini|env|log|xml|html|htm|css|scss|less|js|jsx|mjs|cjs|ts|tsx|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cc|sh|bash|zsh|sql|graphql|gql)$/i;
const FILE_MAX_BYTES = 5 * 1024 * 1024;

function isProbablyText(file) {
  if (file.type && TEXT_MIME_RE.test(file.type)) return true;
  if (TEXT_EXT_RE.test(file.name)) return true;
  return false;
}

async function readBinaryAsBase64(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // 分块拼接，避免栈溢出
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// 通用文件列表面板：支持任意 *_cheng 表（filterEq 提供等值过滤的列，
// 这些列同时也会作为 INSERT 时的固定字段）。
function FileListPanel({ tableName, filterEq, hint, showToast, onChange }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  const filterKey = useMemo(() => JSON.stringify(filterEq || {}), [filterEq]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let q = supabase.from(tableName)
        .select("id, name, mime_type, size_bytes, is_binary, created_at");
      const f = JSON.parse(filterKey);
      for (const [k, v] of Object.entries(f)) q = q.eq(k, v);
      q = q.order("created_at", { ascending: false });
      const { data, error: err } = await q;
      if (err) throw err;
      setFiles(data || []);
    } catch (e) {
      setError(e.message || String(e));
    } finally { setLoading(false); }
  }, [tableName, filterKey]);

  useEffect(() => { load(); }, [load]);

  const onPick = async (file) => {
    if (!file) return;
    if (file.size > FILE_MAX_BYTES) { showToast("文件过大（>5MB）"); return; }
    setUploading(true);
    try {
      const isText = isProbablyText(file);
      const content = isText ? await file.text() : await readBinaryAsBase64(file);
      const f = JSON.parse(filterKey);
      const { error: err } = await supabase.from(tableName).insert({
        ...f,
        name: file.name,
        mime_type: file.type || "application/octet-stream",
        size_bytes: file.size,
        content,
        is_binary: !isText,
      });
      if (err) throw err;
      showToast("已上传 " + file.name);
      load();
      if (onChange) onChange();
    } catch (e) {
      showToast("上传失败: " + (e.message || e));
    } finally { setUploading(false); }
  };

  const download = async (f) => {
    try {
      const { data, error: err } = await supabase.from(tableName)
        .select("name, mime_type, content, is_binary")
        .eq("id", f.id).single();
      if (err) throw err;
      let blob;
      if (data.is_binary) {
        const bin = atob(data.content || "");
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        blob = new Blob([bytes], { type: data.mime_type || "application/octet-stream" });
      } else {
        blob = new Blob([data.content || ""], { type: data.mime_type || "text/plain;charset=utf-8" });
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = data.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { showToast("下载失败: " + (e.message || e)); }
  };

  const remove = async (f) => {
    if (!window.confirm("删除文件「" + f.name + "」？")) return;
    try {
      const { error: err } = await supabase.from(tableName).delete().eq("id", f.id);
      if (err) throw err;
      load();
      if (onChange) onChange();
    } catch (e) { showToast("删除失败: " + (e.message || e)); }
  };

  return (
    <>
      <input ref={fileRef} type="file" style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files && e.target.files[0];
          e.target.value = "";
          if (f) onPick(f);
        }} />
      <button className="cp-ps-btn" disabled={uploading}
        onClick={() => fileRef.current && fileRef.current.click()}>
        {uploading ? "上传中…" : "+ 上传文件"}
      </button>
      {hint && (
        <div style={{ fontSize: 11, color: "var(--text-tertiary)", margin: "8px 0 14px" }}>{hint}</div>
      )}
      {error && (
        <div style={{ fontSize: 12, color: "#c0392b", padding: "10px 0", background: "transparent", border: "none", borderBottom: "1px solid var(--border-card)", borderRadius: 0, marginBottom: 12 }}>
          加载失败：{error}
        </div>
      )}
      <div className="cp-ps-mem-list">
        {loading ? (
          <div style={{ textAlign: "center", color: "var(--text-tertiary)", padding: "24px 0" }}>加载中…</div>
        ) : files.length === 0 ? (
          <div style={{ textAlign: "center", color: "var(--text-tertiary)", padding: "24px 0" }}>暂无文件</div>
        ) : files.map(f => (
          <div key={f.id} className="cp-ps-mem-item">
            <div className="cp-ps-mem-header">
              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1 }}>
                <span style={{ fontSize: 12.5, color: "var(--text-primary)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {f.name}
                </span>
              </div>
              <span className="cp-ps-mem-actions" style={{ flexShrink: 0 }}>
                <button onClick={() => download(f)}>下载</button>
                <button onClick={() => remove(f)}>删除</button>
              </span>
            </div>
            <div style={{ fontSize: 10, color: "var(--text-tertiary)" }}>
              {f.mime_type || "?"} · {formatFileSize(f.size_bytes)}
              {f.created_at && " · " + new Date(f.created_at).toLocaleString("zh-CN")}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/* ─────── 文档管理：CC / API 两个 tab ─────── */
// 单例文档（claude_md / system_prompt）：每个 (project, mode, doc_type) 至多一条
function DocSingleton({ mode, docType, label, placeholder, needsRestart, onRestartCC, showToast, minHeight = 140 }) {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    supabase.from("documents_cheng")
      .select("content")
      .eq("project_id", PROJECT_ID).eq("mode", mode).eq("doc_type", docType)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return;
        if (error && error.code !== "PGRST116") showToast("加载失败：" + error.message);
        setContent((data && data.content) || "");
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [mode, docType, showToast]);

  const save = async () => {
    setSaving(true);
    try {
      const { data: existing } = await supabase.from("documents_cheng")
        .select("id")
        .eq("project_id", PROJECT_ID).eq("mode", mode).eq("doc_type", docType)
        .maybeSingle();
      if (existing && existing.id) {
        const { error: err } = await supabase.from("documents_cheng")
          .update({ content, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
        if (err) throw err;
      } else {
        const { error: err } = await supabase.from("documents_cheng").insert({
          project_id: PROJECT_ID, mode, doc_type: docType, content,
        });
        if (err) throw err;
      }
      if (needsRestart) {
        showToast("已保存，重启 CC 后生效", {
          action: { label: "立即重启", onClick: () => onRestartCC && onRestartCC() },
          duration: 10000,
        });
      } else {
        showToast(label + " 已保存");
      }
    } catch (e) {
      showToast("保存失败：" + (e.message || e));
    } finally { setSaving(false); }
  };

  return (
    <div style={{ marginBottom: 18 }}>
      <div className="cp-ps-section-title">{label}</div>
      <textarea value={content} onChange={e => setContent(e.target.value)}
        placeholder={loading ? "加载中…" : placeholder}
        disabled={loading}
        style={{
          width: "100%", minHeight, background: "transparent",
          border: "none", borderBottom: "1px solid var(--border-input)", borderRadius: 0,
          padding: "8px 0", color: "var(--text-primary)", fontSize: 13,
          outline: "none", fontFamily: "inherit", resize: "vertical", lineHeight: 1.5,
        }}/>
      <button className="cp-ps-btn" disabled={saving || loading} onClick={save}>
        {saving ? "保存中…" : "保存"}
      </button>
    </div>
  );
}

// 单例文档的 upsert 工具：选 select-then-update/insert，避免 partial-unique-index 与 ON CONFLICT 的兼容问题
async function upsertDocSingleton(mode, docType, content) {
  const { data: existing, error: selErr } = await supabase
    .from("documents_cheng")
    .select("id")
    .eq("project_id", PROJECT_ID).eq("mode", mode).eq("doc_type", docType)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing && existing.id) {
    const { error } = await supabase.from("documents_cheng")
      .update({ content, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("documents_cheng").insert({
      project_id: PROJECT_ID, mode, doc_type: docType, content,
    });
    if (error) throw error;
  }
}

const TEXTAREA_STYLE = {
  width: "100%",
  background: "transparent",
  border: "none",
  borderBottom: "1px solid var(--border-input)",
  borderRadius: 0,
  padding: "8px 0",
  color: "var(--text-primary)",
  fontSize: 13,
  outline: "none",
  fontFamily: "inherit",
  resize: "vertical",
  lineHeight: 1.5,
};

// CC 文档：CLAUDE.md + system_prompt + 文件 共用一个底部保存按钮
function CCDocumentsTab({ onRestartCC, showToast }) {
  const [claudeMd, setClaudeMd] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const filterEq = useMemo(
    () => ({ project_id: PROJECT_ID, mode: "cc", doc_type: "file" }),
    []
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      supabase.from("documents_cheng")
        .select("content")
        .eq("project_id", PROJECT_ID).eq("mode", "cc").eq("doc_type", "claude_md")
        .maybeSingle(),
      supabase.from("documents_cheng")
        .select("content")
        .eq("project_id", PROJECT_ID).eq("mode", "cc").eq("doc_type", "system_prompt")
        .maybeSingle(),
    ]).then(([a, b]) => {
      if (!alive) return;
      if (a.error && a.error.code !== "PGRST116") showToast("加载 CLAUDE.md 失败：" + a.error.message);
      if (b.error && b.error.code !== "PGRST116") showToast("加载 system prompt 失败：" + b.error.message);
      setClaudeMd((a.data && a.data.content) || "");
      setSystemPrompt((b.data && b.data.content) || "");
    }).catch(e => {
      if (alive) showToast("加载失败：" + (e.message || e));
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [showToast]);

  const saveAll = async () => {
    setSaving(true);
    try {
      // 系统提示在前、CLAUDE.md 在后；任一失败立即抛出
      await upsertDocSingleton("cc", "system_prompt", systemPrompt);
      await upsertDocSingleton("cc", "claude_md", claudeMd);
      showToast("已保存，重启 CC 后生效", {
        action: { label: "立即重启", onClick: () => onRestartCC && onRestartCC() },
        duration: 12000,
      });
    } catch (e) {
      showToast("保存失败：" + (e.message || e));
    } finally { setSaving(false); }
  };

  return (
    <>
      <div style={{
        fontSize: 11, color: "var(--text-tertiary)", marginBottom: 14,
        padding: "8px 0", background: "transparent",
        border: "none", borderBottom: "1px solid var(--border-card)", borderRadius: 0,
      }}>
        CC 文档：修改后需重启 CC 才生效，整段内容只在启动时读取一次
      </div>

      <div style={{ marginBottom: 18 }}>
        <div className="cp-ps-section-title">系统提示（System Prompt）</div>
        <textarea
          value={systemPrompt}
          onChange={e => setSystemPrompt(e.target.value)}
          placeholder={loading ? "加载中…" : "输入项目人设 / 系统提示…"}
          disabled={loading}
          style={{ ...TEXTAREA_STYLE, minHeight: 150 }}
        />
      </div>

      <div style={{ marginBottom: 18 }}>
        <div className="cp-ps-section-title">CLAUDE.md</div>
        <textarea
          value={claudeMd}
          onChange={e => setClaudeMd(e.target.value)}
          placeholder={loading ? "加载中…" : "编辑 CLAUDE.md…"}
          disabled={loading}
          style={{ ...TEXTAREA_STYLE, minHeight: 200 }}
        />
      </div>

      <div className="cp-ps-section-title">文件</div>
      <FileListPanel
        tableName="documents_cheng"
        filterEq={filterEq}
        hint="单文件 ≤ 5MB · 重启 CC 后随 CLAUDE.md 一起读取一次"
        showToast={showToast}
      />

      <button className="cp-ps-btn"
        disabled={saving || loading}
        onClick={saveAll}
        style={{ marginTop: 18 }}>
        {saving ? "保存中…" : "保存"}
      </button>
      <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 8, lineHeight: 1.6 }}>
        一次保存系统提示与 CLAUDE.md；保存后会出现「立即重启」按钮，文件区域的增删立即生效。
      </div>
    </>
  );
}

// API 文档：每轮注入，单 system_prompt 仍用 DocSingleton（独立保存按钮）
function APIDocumentsTab({ showToast }) {
  const filterEq = useMemo(
    () => ({ project_id: PROJECT_ID, mode: "api", doc_type: "file" }),
    []
  );
  return (
    <>
      <div style={{
        fontSize: 11, color: "var(--text-tertiary)", marginBottom: 14,
        padding: "8px 0", background: "transparent",
        border: "none", borderBottom: "1px solid var(--border-card)", borderRadius: 0,
      }}>
        API 文档：每轮对话都会自动注入
      </div>

      <DocSingleton
        mode="api" docType="system_prompt" label="System Prompt"
        placeholder="输入项目人设 / 系统提示…" minHeight={150}
        needsRestart={false} showToast={showToast}
      />

      <div className="cp-ps-section-title">文件</div>
      <FileListPanel
        tableName="documents_cheng"
        filterEq={filterEq}
        hint="单文件 ≤ 5MB · 每轮注入到上下文"
        showToast={showToast}
      />
    </>
  );
}

function DocumentsTab({ mode, onRestartCC, showToast }) {
  if (mode === "cc") return <CCDocumentsTab onRestartCC={onRestartCC} showToast={showToast} />;
  return <APIDocumentsTab showToast={showToast} />;
}

function DocumentsScreen({ onBack, onRestartCC, showToast }) {
  const [tab, setTab] = useState("cc");
  return (
    <>
      <div className="cp-ps-sub-title"><button className="cp-ps-back" onClick={onBack}>← 返回</button>文档管理</div>
      <div className="cp-ps-tabs">
        <div className={"cp-ps-tab" + (tab === "cc" ? " active" : "")} onClick={() => setTab("cc")}>CC 文档</div>
        <div className={"cp-ps-tab" + (tab === "api" ? " active" : "")} onClick={() => setTab("api")}>API 文档</div>
      </div>
      <DocumentsTab mode={tab} onRestartCC={onRestartCC} showToast={showToast} />
    </>
  );
}

/* ─────── 聊天记录：日期范围 + 关键词搜索 + 一键导出 md ─────── */
function ymd(d) {
  const z = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate());
}
function startOfDayISO(s) { return new Date(s + "T00:00:00").toISOString(); }
function endOfDayISO(s) { return new Date(s + "T23:59:59.999").toISOString(); }

const EXPORT_RANGES = [
  { value: "1", label: "今天" },
  { value: "3", label: "最近 3 天" },
  { value: "7", label: "最近 7 天" },
  { value: "30", label: "最近 30 天" },
  { value: "90", label: "最近 90 天" },
  { value: "all", label: "全部" },
];

// 角色 → 显示名（聊天记录 + 导出统一使用）
function chatDisplayName(role) {
  if (role === "assistant") return "小太阳";
  if (role === "user") return "小茉莉";
  if (role === "system") return "系统";
  return role || "—";
}

// 微信风格的时间戳：2026/02/03 18:38
function formatChatTime(iso) {
  const d = new Date(iso);
  const z = n => String(n).padStart(2, "0");
  return d.getFullYear() + "/" + z(d.getMonth() + 1) + "/" + z(d.getDate())
    + " " + z(d.getHours()) + ":" + z(d.getMinutes());
}

function buildExportMarkdown(rows, rangeLabel) {
  let out = "# 聊天记录导出\n\n";
  out += "导出时间：" + new Date().toLocaleString("zh-CN") + "\n\n";
  out += "范围：" + rangeLabel + "\n\n";
  out += "共 " + rows.length + " 条消息\n\n---\n\n";
  // 时间正序
  const sorted = rows.slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  for (const m of sorted) {
    const ts = formatChatTime(m.created_at);
    out += chatDisplayName(m.role) + "  " + ts + "\n\n";
    out += (m.content || "") + "\n\n";
  }
  return out;
}

// 拉取本 project（含历史 null project_id 的会话）的消息：先取 conv 列表，再按 IN 过滤
async function fetchProjectMessages({ start, end, keyword, ascending = true, limit = 500 }) {
  const { data: convs, error: convErr } = await supabase
    .from("conversations")
    .select("id, title, project_id")
    .or("project_id.eq." + PROJECT_ID + ",project_id.is.null");
  if (convErr) throw convErr;
  const convIds = (convs || []).map(c => c.id);
  if (convIds.length === 0) return { rows: [], titleMap: {} };
  const titleMap = {};
  for (const c of convs) titleMap[c.id] = c.title || "未命名对话";

  let q = supabase
    .from("messages")
    .select("id, role, content, created_at, conversation_id")
    .in("conversation_id", convIds)
    .order("created_at", { ascending })
    .limit(limit);
  if (start) q = q.gte("created_at", startOfDayISO(start));
  if (end) q = q.lte("created_at", endOfDayISO(end));
  if (keyword && keyword.trim()) q = q.ilike("content", "%" + keyword.trim() + "%");
  const { data, error: err } = await q;
  if (err) throw err;
  return { rows: data || [], titleMap };
}

function HistoryScreen({ onBack, showToast }) {
  const today = useMemo(() => ymd(new Date()), []);
  const weekAgo = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 6); return ymd(d); }, []);
  const [start, setStart] = useState(weekAgo);
  const [end, setEnd] = useState(today);
  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [exportRange, setExportRange] = useState("7");
  const [exporting, setExporting] = useState(false);

  const search = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { rows } = await fetchProjectMessages({
        start, end, keyword,
        ascending: true,   // 微信风格：旧 → 新
        limit: 500,
      });
      setResults(rows);
    } catch (e) {
      setError(e.message || String(e));
      setResults([]);
    } finally { setLoading(false); }
  }, [start, end, keyword]);

  useEffect(() => { search(); /* 默认加载最近 7 天 */ }, []); // eslint-disable-line

  const doExport = async () => {
    setExporting(true);
    try {
      let exportStart = null;
      let label;
      if (exportRange !== "all") {
        const days = parseInt(exportRange, 10);
        const since = new Date();
        since.setDate(since.getDate() - (days - 1));
        since.setHours(0, 0, 0, 0);
        exportStart = ymd(since);
        label = "最近 " + days + " 天（" + exportStart + " 至 " + ymd(new Date()) + "）";
      } else {
        label = "全部";
      }
      const { rows } = await fetchProjectMessages({
        start: exportStart, end: null, keyword: "",
        ascending: true,
        limit: 5000,
      });
      if (rows.length === 0) {
        showToast("范围内没有消息");
        return;
      }
      const md = buildExportMarkdown(rows, label);
      const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "chat-export-" + ymd(new Date())
        + (exportRange === "all" ? "-all" : "-" + exportRange + "d") + ".md";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast("已导出 " + rows.length + " 条消息");
    } catch (e) {
      showToast("导出失败：" + (e.message || e));
    } finally { setExporting(false); }
  };

  return (
    <>
      <div className="cp-ps-sub-title"><button className="cp-ps-back" onClick={onBack}>← 返回</button>聊天记录</div>

      <div className="cp-ps-section-title">日期范围</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input type="date" value={start} max={end || undefined} onChange={e => setStart(e.target.value)}
          style={{ flex: 1, background: "transparent", border: "none", borderBottom: "1px solid var(--border-input)", borderRadius: 0, padding: "7px 0", color: "var(--text-primary)", fontSize: 12, outline: "none", fontFamily: "inherit" }}/>
        <span style={{ alignSelf: "center", color: "var(--text-tertiary)", fontSize: 12 }}>至</span>
        <input type="date" value={end} min={start || undefined} onChange={e => setEnd(e.target.value)}
          style={{ flex: 1, background: "transparent", border: "none", borderBottom: "1px solid var(--border-input)", borderRadius: 0, padding: "7px 0", color: "var(--text-primary)", fontSize: 12, outline: "none", fontFamily: "inherit" }}/>
      </div>

      <div className="cp-ps-section-title">关键词</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input type="text" value={keyword} onChange={e => setKeyword(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") search(); }}
          placeholder="搜索消息内容…"
          style={{ flex: 1, background: "transparent", border: "none", borderBottom: "1px solid var(--border-input)", borderRadius: 0, padding: "7px 0", color: "var(--text-primary)", fontSize: 13, outline: "none", fontFamily: "inherit" }}/>
        <button className="cp-ps-btn" style={{ width: 80, marginTop: 0 }} disabled={loading} onClick={search}>
          {loading ? "…" : "搜索"}
        </button>
      </div>

      <div className="cp-ps-section-title">结果 {!loading && results.length > 0 ? "(" + results.length + ")" : ""}</div>
      {error && (
        <div style={{ fontSize: 12, color: "#c0392b", padding: "8px 0", background: "transparent", border: "none", borderBottom: "1px solid var(--border-card)", borderRadius: 0, marginBottom: 8 }}>
          {error}
        </div>
      )}
      <div style={{
        maxHeight: 360, overflowY: "auto",
        background: "transparent", border: "none", borderBottom: "1px solid var(--border-card)",
        borderRadius: 0, padding: results.length === 0 ? 0 : "12px 0",
      }}>
        {loading ? (
          <div style={{ textAlign: "center", color: "var(--text-tertiary)", padding: "24px 0" }}>加载中…</div>
        ) : results.length === 0 ? (
          <div style={{ textAlign: "center", color: "var(--text-tertiary)", padding: "24px 0" }}>无结果</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {results.map(r => (
              <div key={r.id}>
                <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 4 }}>
                  <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>
                    {chatDisplayName(r.role)}
                  </span>
                  {"  "}{formatChatTime(r.created_at)}
                </div>
                <div style={{
                  fontSize: 13, color: "var(--text-primary)", lineHeight: 1.55,
                  whiteSpace: "pre-wrap", wordBreak: "break-word",
                }}>
                  {r.content || ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="cp-ps-section-title" style={{ marginTop: 18 }}>导出</div>
      <div style={{ display: "flex", gap: 8 }}>
        <select value={exportRange} onChange={e => setExportRange(e.target.value)}
          style={{ flex: 1, background: "transparent", border: "none", borderBottom: "1px solid var(--border-input)", borderRadius: 0, padding: "7px 0", color: "var(--text-primary)", fontSize: 13, outline: "none", fontFamily: "inherit" }}>
          {EXPORT_RANGES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <button className="cp-ps-btn" style={{ width: 110, marginTop: 0 }} disabled={exporting} onClick={doExport}>
          {exporting ? "导出中…" : "导出 .md"}
        </button>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 6 }}>
        按时间正序导出，每条消息独立一段
      </div>
    </>
  );
}

/* ─────── 字数统计：当前对话字数 vs 压缩阈值 ─────── */
function CharStatsScreen({ onBack, convId }) {
  const [stats, setStats] = useState({ totalChars: 0, msgCount: 0, byRole: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    if (!convId) {
      setStats({ totalChars: 0, msgCount: 0, byRole: {} });
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error: err } = await supabase
        .from("messages")
        .select("role, content")
        .eq("conversation_id", convId)
        .limit(5000);
      if (err) throw err;
      const arr = data || [];
      const byRole = {};
      let totalChars = 0;
      for (const m of arr) {
        const len = (m.content || "").length;
        totalChars += len;
        const r = m.role || "其他";
        byRole[r] = (byRole[r] || 0) + len;
      }
      setStats({ totalChars, msgCount: arr.length, byRole });
    } catch (e) {
      setError(e.message || String(e));
    } finally { setLoading(false); }
  }, [convId]);

  useEffect(() => { load(); }, [load]);

  const roleLabel = (r) =>
    r === "user" ? "用户" : r === "assistant" ? "助手" : r === "system" ? "系统" : r;

  return (
    <>
      <div className="cp-ps-sub-title"><button className="cp-ps-back" onClick={onBack}>← 返回</button>字数统计</div>

      {!convId ? (
        <div style={{ color: "var(--text-tertiary)", fontSize: 13, padding: "30px 0", textAlign: "center" }}>
          还没有对话
        </div>
      ) : loading ? (
        <div style={{ color: "var(--text-tertiary)", fontSize: 13, padding: "30px 0", textAlign: "center" }}>
          加载中…
        </div>
      ) : error ? (
        <div style={{ fontSize: 12, color: "#c0392b", padding: "10px 0", background: "transparent", border: "none", borderBottom: "1px solid var(--border-card)", borderRadius: 0, marginBottom: 12 }}>
          加载失败：{error}
        </div>
      ) : (
        <>
          <div className="cp-ps-stat-card" style={{ padding: "16px 14px", marginBottom: 14 }}>
            <div className="cp-ps-stat-label">当前对话总字数</div>
            <div className="cp-ps-stat-value" style={{ fontSize: 26 }}>
              {stats.totalChars.toLocaleString()}<span className="cp-ps-stat-unit">字</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>
              共 {stats.msgCount} 条消息
            </div>
          </div>

          {Object.keys(stats.byRole).length > 0 && (
            <>
              <div className="cp-ps-section-title">分角色</div>
              <div className="cp-ps-list">
                {Object.entries(stats.byRole)
                  .sort((a, b) => b[1] - a[1])
                  .map(([r, n]) => (
                    <div key={r} className="cp-ps-item" style={{ cursor: "default" }}>
                      <div className="cp-ps-item-title">{roleLabel(r)}</div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                        {n.toLocaleString()} 字
                      </div>
                    </div>
                  ))}
              </div>
            </>
          )}
        </>
      )}

      <button className="cp-ps-btn" disabled={loading || !convId} onClick={load} style={{ marginTop: 14 }}>
        {loading ? "刷新中…" : "刷新"}
      </button>

      <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 10, lineHeight: 1.6 }}>
        从 Supabase 直接查询当前对话所有消息的 content 字段，按字符数累加。
      </div>
    </>
  );
}

/* ─────── Settings Modal: 头像 + 昵称 ─────── */
function SettingsModal({ profile, onSave, onClose }) {
  const [temp, setTemp] = useState(() => ({ ...profile }));
  const [showEmoji, setShowEmoji] = useState({ user: false, bot: false });

  const renderAvatar = (who) => {
    const img = who === "user" ? temp.userImg : temp.botImg;
    const emoji = who === "user" ? temp.userEmoji : temp.botEmoji;
    return img ? <img src={img} alt="" /> : emoji;
  };
  const pickEmoji = (who, e) => {
    if (who === "user") setTemp(t => ({ ...t, userEmoji: e, userImg: null }));
    else setTemp(t => ({ ...t, botEmoji: e, botImg: null }));
    setShowEmoji(s => ({ ...s, [who]: false }));
  };
  const onUpload = async (who, file) => {
    if (!file) return;
    const dataUrl = await squareAvatarDataUrl(file);
    if (!dataUrl) return;
    if (who === "user") setTemp(t => ({ ...t, userImg: dataUrl }));
    else setTemp(t => ({ ...t, botImg: dataUrl }));
  };
  const clearAvatar = (who) => {
    if (who === "user") setTemp(t => ({ ...t, userImg: null }));
    else setTemp(t => ({ ...t, botImg: null }));
  };
  const save = () => {
    const next = {
      ...temp,
      userNick: (temp.userNick || "").trim() || DEFAULT_PROFILE.userNick,
      botNick: (temp.botNick || "").trim() || DEFAULT_PROFILE.botNick,
    };
    onSave(next);
    onClose();
  };

  return (
    <div className="cp-overlay bottom" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cp-modal bottom" onClick={e => e.stopPropagation()}>
        <h3>头像与昵称 <button onClick={onClose}>✕</button></h3>
        <div className="cp-hint" style={{ marginBottom: 12 }}>当前项目: 澄</div>
        <AvatarSection
          who="user" label="你"
          temp={temp} setTemp={setTemp}
          showEmoji={showEmoji.user}
          toggleEmoji={() => setShowEmoji(s => ({ ...s, user: !s.user }))}
          pickEmoji={pickEmoji}
          onUpload={onUpload}
          clearAvatar={clearAvatar}
          renderAvatar={renderAvatar}
        />
        <AvatarSection
          who="bot" label="AI"
          temp={temp} setTemp={setTemp}
          showEmoji={showEmoji.bot}
          toggleEmoji={() => setShowEmoji(s => ({ ...s, bot: !s.bot }))}
          pickEmoji={pickEmoji}
          onUpload={onUpload}
          clearAvatar={clearAvatar}
          renderAvatar={renderAvatar}
        />
        <div className="cp-hint">配置按项目保存，切换项目自动加载对应设置</div>
        <button className="cp-save-btn" onClick={save}>保存</button>
      </div>
    </div>
  );
}

function AvatarSection({ who, label, temp, setTemp, showEmoji, toggleEmoji, pickEmoji, onUpload, clearAvatar, renderAvatar }) {
  const fileRef = useRef(null);
  const nickKey = who === "user" ? "userNick" : "botNick";
  const emojiKey = who === "user" ? "userEmoji" : "botEmoji";
  const imgKey = who === "user" ? "userImg" : "botImg";
  return (
    <div className="cp-section">
      <div className="cp-section-title">{label}</div>
      <div className="cp-row">
        <div className={"cp-avatar-preview " + (who === "user" ? "u" : "b")} onClick={toggleEmoji}>
          {renderAvatar(who)}
        </div>
        <input type="text" value={temp[nickKey] || ""}
          onChange={e => setTemp(t => ({ ...t, [nickKey]: e.target.value }))}
          placeholder="昵称" />
      </div>
      {showEmoji && (
        <div className="cp-emoji-grid">
          {EMOJI_OPTIONS.map(e => (
            <span key={e}
              className={temp[emojiKey] === e ? "active" : ""}
              onClick={() => pickEmoji(who, e)}>{e}</span>
          ))}
        </div>
      )}
      <div className="cp-upload-row">
        <button className="cp-upload-btn" onClick={() => fileRef.current && fileRef.current.click()}>上传图片</button>
        {temp[imgKey] && (
          <button className="cp-clear-btn" onClick={() => clearAvatar(who)}>清除图片</button>
        )}
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
          onChange={(e) => { onUpload(who, e.target.files && e.target.files[0]); e.target.value = ""; }} />
      </div>
    </div>
  );
}

/* ─────── Rename Modal ─────── */
function RenameModal({ initial, onCancel, onConfirm }) {
  const [text, setText] = useState(initial || "");
  return (
    <div className="cp-overlay" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="cp-modal" onClick={e => e.stopPropagation()}>
        <h3>重命名对话</h3>
        <input type="text" value={text} autoFocus
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") onConfirm(text.trim()); }}
          placeholder="对话名称"/>
        <div className="cp-rename-btns">
          <button className="cp-rename-cancel" onClick={onCancel}>取消</button>
          <button className="cp-rename-ok" onClick={() => onConfirm(text.trim())}>确定</button>
        </div>
      </div>
    </div>
  );
}

/* eslint-disable no-unused-vars */
// 仅为通过 lint 保留 supabase 引用（项目要求）
const _ = supabase;


// reconnect trigger
// post-reconnect trigger
