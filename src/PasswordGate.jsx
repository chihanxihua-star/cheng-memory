import { useState, useEffect } from "react";

// 网关鉴权门（主壳 + 聊天独立页共用）。无 token 时显示密码框，登录后存 token、放行 children。
// token 存 localStorage（key 与各页 authedFetch 一致），同域名下主壳/聊天共享同一份。
const AUTH_TOKEN_KEY = "memhome-auth-token";
const AUTH_API_BASE = "https://chat.jessaminee.top";
function getAuthToken() { return localStorage.getItem(AUTH_TOKEN_KEY) || ""; }

export default function PasswordGate({ children }) {
  const [token, setToken] = useState(() => getAuthToken());
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    const onExpired = () => { localStorage.removeItem(AUTH_TOKEN_KEY); setToken(""); };
    window.addEventListener("auth-expired", onExpired);
    return () => window.removeEventListener("auth-expired", onExpired);
  }, []);

  const submit = async (e) => {
    e?.preventDefault();
    if (!pw.trim() || busy) return;
    setBusy(true); setErr("");
    try {
      const r = await fetch(AUTH_API_BASE + "/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (!r.ok) throw new Error("密码错误");
      const d = await r.json();
      localStorage.setItem(AUTH_TOKEN_KEY, d.token);
      setToken(d.token);
      setPw("");
    } catch (e) {
      setErr(e.message || "登录失败");
    } finally {
      setBusy(false);
    }
  };

  if (token) return children;

  return (
    <div style={{
      minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "var(--bg-page)", padding: 20,
    }}>
      <form onSubmit={submit} style={{
        width: "100%", maxWidth: 320, display: "flex", flexDirection: "column", gap: 16,
      }}>
        <div style={{ textAlign: "center", fontSize: 15, color: "var(--text-primary)", letterSpacing: "0.1em" }}>请输入访问密码</div>
        <input
          type={showKey ? "text" : "password"}
          value={pw}
          onChange={e => setPw(e.target.value)}
          placeholder="密码"
          autoFocus
          style={{
            width: "100%", padding: "12px 14px", borderRadius: 10,
            border: "1px solid var(--border)", background: "var(--bg-card)",
            color: "var(--text-primary)", fontSize: 15, fontFamily: "inherit",
            outline: "none",
          }}
        />
        <button type="button" onClick={() => setShowKey(s => !s)} style={{
          background: "none", border: "none", color: "var(--text-tertiary)",
          fontSize: 12, cursor: "pointer", alignSelf: "flex-end", fontFamily: "inherit",
        }}>{showKey ? "隐藏" : "显示"}</button>
        {err && <div style={{ color: "#d87878", fontSize: 13, textAlign: "center" }}>{err}</div>}
        <button type="submit" disabled={busy} style={{
          background: "var(--accent, #6b7fd4)", color: "#fff", border: "none",
          borderRadius: 10, padding: "12px", fontSize: 15, cursor: "pointer",
          fontFamily: "inherit", fontWeight: 500,
        }}>{busy ? "验证中…" : "进入"}</button>
      </form>
    </div>
  );
}
