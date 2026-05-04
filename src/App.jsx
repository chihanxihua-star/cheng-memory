# ...import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "./lib/supabase";
import ChatPanel from "./ChatPanel";

/* ===== THEME ===== */
const TH = {
  anchor:      { bg: "#F8F5F0", nav: "#F8F5F0", ac: "#b8a080", name: "锚", dk: false },
  diary:       { bg: "#F8F5F0", nav: "#F8F5F0", ac: "#7b8fb2", name: "枕边", dk: false },
  murmure:     { bg: "#F8F5F0", nav: "#F8F5F0", ac: "#9a8bb0", name: "呢喃", dk: false },
  reef:        { bg: "#2A2A2C", nav: "#F8F5F0", ac: "#6e7175", name: "暗礁", dk: true },
  inspiration: { bg: "#F8F5F0", nav: "#F8F5F0", ac: "#b0a24e", name: "灵感", dk: false },
  chronicle:   { bg: "#F8F5F0", nav: "#F8F5F0", ac: "#5ea899", name: "朝夕录", dk: false },
  tide:        { bg: "#E6D2D5", nav: "#F8F5F0", ac: "#b07e87", name: "潮", dk: false },
  chat:        { bg: "#F8F5F0", nav: "#F8F5F0", ac: "#8b9eb0", name: "澄", dk: false },
};
const AN = { "宝": "小狐狸", "Claude": "小章鱼" };
const TABS1 = ["chat","murmure","diary","reef"];
const TABS_ALL = [
  { k: "chat", l: "澄" },{ k: "anchor", l: "锚" },{ k: "diary", l: "枕边" },{ k: "murmure", l: "呢喃" },
  { k: "reef", l: "暗礁" },{ k: "inspiration", l: "灵感" },{ k: "chronicle", l: "朝夕录" },{ k: "tide", l: "潮" },
];

/* ===== ICONS ===== */
const IC = {
  anchor: (c,s=24) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5.5" r="2"/><line x1="12" y1="7.5" x2="12" y2="20"/><path d="M5.5 13a6.5 6.5 0 0 0 13 0"/><line x1="8" y1="11" x2="16" y2="11"/></svg>,
  diary: (c,s=24) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a4 4 0 0 1 0 8c-1.5 0-3-.8-5-3C10 5.8 8.5 5 7 5a4 4 0 0 0 0 8"/><path d="M7 21a4 4 0 0 1 0-8c1.5 0 3 .8 5 3 2-2.2 3.5-3 5-3a4 4 0 0 0 0-8"/></svg>,
  murmure: (c,s=24) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H8l-4 3V8z"/><circle cx="9" cy="11.5" r=".7" fill={c} stroke="none"/><circle cx="12" cy="11.5" r=".7" fill={c} stroke="none"/><circle cx="15" cy="11.5" r=".7" fill={c} stroke="none"/></svg>,
  reef: (c,s=24) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21C12 21 4 15.5 4 10a4 4 0 0 1 8-1.5A4 4 0 0 1 20 10c0 5.5-8 11-8 11z"/></svg>,
  inspiration: (c,s=24) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l1.8 5.2H19l-4.2 3.1 1.6 5.2L12 12.6l-4.4 2.9 1.6-5.2L5 7.2h5.2L12 2z"/></svg>,
  chronicle: (c,s=24) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="4" x2="12" y2="20"/><path d="M8 7c2-1.5 4-1.5 4 0s-2 2-4 3.5"/><path d="M16 12c-2 1.5-4 1.5-4 0"/><path d="M8 15c2 1 4 1 4 0"/></svg>,
  tide: (c,s=24) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><line x1="4" y1="9" x2="20" y2="9"/><line x1="9" y1="4" x2="9" y2="9"/><line x1="15" y1="4" x2="15" y2="9"/><circle cx="12" cy="14.5" r="2" fill={c} opacity=".2" stroke="none"/></svg>,
  chat: (c,s=24) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>,
  search: (c="#bbb",s=16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round"><circle cx="10.5" cy="10.5" r="6"/><line x1="15.5" y1="15.5" x2="20" y2="20"/></svg>,
  edit: (c="#bbb",s=14) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  trash: (c="#ccc",s=14) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>,
  dots: (c="#666",s=20) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none"><circle cx="12" cy="6" r="1.5" fill={c}/><circle cx="12" cy="12" r="1.5" fill={c}/><circle cx="12" cy="18" r="1.5" fill={c}/></svg>,
  x: (c="#bbb",s=14) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>,
};

/* ===== UTILS ===== */
const ft = (s) => { if(!s)return""; const d=new Date(s); return `${String(d.getFullYear()).slice(2)}/${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; };
const fd = (s) => { if(!s)return""; const d=new Date(s); return `${String(d.getFullYear()).slice(2)}/${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}`; };

/* ===== DB HELPERS ===== */
async function fetchLayer(layer, extra = {}) {
  let q = supabase.from("memories").select("*").eq("layer", layer);
  if (extra.tags) q = q.contains("tags", extra.tags);
  if (extra.status) q = q.eq("status", extra.status);
  q = q.order("created_at", { ascending: false });
  const { data, error } = await q;
  if (error) console.error(error);
  return data || [];
}

async function fetchMurmure() {
  const { data: mems } = await supabase.from("memories").select("*").eq("layer", "murmure").order("created_at", { ascending: false });
  if (!mems) return [];
  const ids = mems.map(m => m.id);
  const { data: cmts } = await supabase.from("comments").select("*").in("memory_id", ids.length ? ids : ["_"]).order("created_at", { ascending: true });
  return mems.map(m => ({ ...m, comments: (cmts || []).filter(c => c.memory_id === m.id) }));
}

async function insertMem(obj) {
  const { data, error } = await supabase.from("memories").insert(obj).select().single();
  if (error) { alert("保存失败: " + error.message); return null; }
  return data;
}

async function updateMem(id, obj) {
  const { error } = await supabase.from("memories").update({ ...obj, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) alert("更新失败: " + error.message);
  return !error;
}

async function deleteMem(id) {
  const { error } = await supabase.from("memories").delete().eq("id", id);
  if (error) alert("删除失败: " + error.message);
  return !error;
}

async function insertComment(obj) {
  const { data, error } = await supabase.from("comments").insert(obj).select().single();
  if (error) { alert("回复失败: " + error.message); return null; }
  return data;
}

/* ===== SHARED UI ===== */
const Author = ({ a }) => <span style={{ display:"inline-block", fontSize:11, fontWeight:500, color:"#333", background: a==="宝"?"#f9f4dc":"rgba(208,223,230,0.5)", padding:"1px 8px", borderRadius:3, lineHeight:"18px" }}>{AN[a]||a}</span>;
const AuthorPlain = ({ a }) => <span style={{ fontSize:11, fontWeight:500, color:"#333" }}>{AN[a]||a}</span>;
const Time = ({ t, sx }) => <span style={{ fontSize:10, color:"#aaa", ...sx }}>{t}</span>;

const SearchBar = ({ v, set, dk }) => (
  <div style={{ padding:"0 16px", marginBottom:10 }}>
    <div style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 10px", background:dk?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.03)", borderRadius:7, border:dk?"1px solid rgba(255,255,255,0.06)":"1px solid rgba(0,0,0,0.03)" }}>
      {IC.search(dk?"#666":"#bbb")}
      <input value={v} onChange={e=>set(e.target.value)} placeholder="搜索…" style={{ flex:1, border:"none", background:"none", outline:"none", fontSize:13, color:dk?"#eee":"#333", fontFamily:"inherit" }} />
      {v && <button onClick={()=>set("")} style={{ background:"none", border:"none", padding:0, cursor:"pointer", display:"flex" }}>{IC.x(dk?"#555":"#bbb")}</button>}
    </div>
  </div>
);

const Acts = ({ dk, onEdit, onDel }) => (
  <div style={{ display:"flex", gap:10, marginTop:6 }}>
    <button onClick={onEdit} style={{ background:"none", border:"none", padding:0, cursor:"pointer", display:"flex", alignItems:"center", gap:3, fontSize:10, color:dk?"#666":"#bbb" }}>{IC.edit(dk?"#666":"#bbb")} 编辑</button>
    <button onClick={onDel} style={{ background:"none", border:"none", padding:0, cursor:"pointer", display:"flex", alignItems:"center", gap:3, fontSize:10, color:dk?"#555":"#d4d4d4" }}>{IC.trash(dk?"#555":"#ccc")} 删除</button>
  </div>
);

const AddBtn = ({ label, ac, dk, onClick }) => (
  <button onClick={onClick} style={{ width:"100%", padding:"10px", marginTop:6, background:"transparent", border:`1px dashed ${dk?"rgba(255,255,255,0.12)":ac+"40"}`, borderRadius:7, color:dk?"#666":"#bbb", fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>+ {label}</button>
);

const Box = ({ children, sx, i=0, dk }) => (
  <div style={{ padding:"12px 14px", marginBottom:7, background:dk?"rgba(255,255,255,0.04)":"rgba(255,255,255,0.5)", borderRadius:7, border:dk?"1px solid rgba(255,255,255,0.05)":"1px solid rgba(0,0,0,0.03)", animation:`fi 0.3s ease ${i*0.04}s both`, ...sx }}>{children}</div>
);

/* ===== MODAL ===== */
function Modal({ open, title, onClose, onSave, children }) {
  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.25)", zIndex:100, animation:"fo 0.2s ease" }} />
      <div style={{ position:"fixed", bottom:0, left:0, right:0, maxWidth:430, margin:"0 auto", background:"#fff", borderRadius:"14px 14px 0 0", padding:"24px 30px 40px", zIndex:101, animation:"su 0.25s ease", maxHeight:"80vh", overflow:"auto" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
          <span style={{ fontSize:16, fontWeight:500, color:"#333" }}>{title}</span>
          <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", padding:14, margin:-10 }}>{IC.x("#999",20)}</button>
        </div>
        {children}
        <button onClick={onSave} style={{ width:"100%", padding:"13px", marginTop:18, background:"#333", color:"#F8F5F0", border:"none", borderRadius:8, fontSize:14, cursor:"pointer", fontFamily:"inherit" }}>保存</button>
      </div>
    </>
  );
}

const Field = ({ label, children }) => <div style={{ marginBottom:10 }}><div style={{ fontSize:11, color:"#999", marginBottom:4 }}>{label}</div>{children}</div>;
const TArea = ({ value, set, placeholder, rows=3 }) => <textarea value={value} onChange={e=>set(e.target.value)} placeholder={placeholder} rows={rows} style={{ width:"100%", border:"1px solid rgba(0,0,0,0.08)", borderRadius:6, padding:"8px 10px", fontSize:13, resize:"vertical", outline:"none", fontFamily:"inherit", color:"#333", background:"#fafafa" }} />;
const TInput = ({ value, set, placeholder, type="text" }) => <input type={type} value={value} onChange={e=>set(e.target.value)} placeholder={placeholder} style={{ width:"100%", border:"1px solid rgba(0,0,0,0.08)", borderRadius:6, padding:"7px 10px", fontSize:13, outline:"none", fontFamily:"inherit", color:"#333", background:"#fafafa" }} />;

/* ===== PANELS ===== */

// ---------- ANCHOR ----------
function Anchor({ th, refresh }) {
  const [data, setData] = useState([]);
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(null); // null | 'add' | item
  const [fc, setFc] = useState("");
  const [fi, setFi] = useState("0.8");

  const load = useCallback(async () => { setData(await fetchLayer("anchor")); }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = data.filter(x => !q || x.content.includes(q));

  const save = async () => {
    if (!fc.trim()) return;
    if (modal === "add") {
      await insertMem({ layer:"anchor", content:fc.trim(), importance:parseFloat(fi)||0.8, author:"宝" });
    } else {
      await updateMem(modal.id, { content:fc.trim(), importance:parseFloat(fi)||0.8 });
    }
    setModal(null); setFc(""); setFi("0.8"); load();
  };

  const del = async (id) => { if(confirm("删除这条约定？")) { await deleteMem(id); load(); } };
  const edit = (x) => { setFc(x.content); setFi(String(x.importance)); setModal(x); };

  return (<div>
    <SearchBar v={q} set={setQ} />
    <div style={{ padding:"0 16px" }}>
      <div style={{ fontSize:11, color:"#aaa", marginBottom:10 }}>固定设定与约定</div>
      {filtered.map((x,i) => (
        <Box key={x.id} i={i}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5 }}><Author a={x.author}/><Time t={ft(x.created_at)}/><span style={{ marginLeft:"auto", fontSize:9, color:th.ac, opacity:0.5 }}>●{x.importance}</span></div>
          <div style={{ fontSize:13.5, color:"#333", lineHeight:1.7 }}>{x.content}</div>
          <Acts onEdit={()=>edit(x)} onDel={()=>del(x.id)} />
        </Box>
      ))}
      {!data.length && <div style={{ textAlign:"center", color:"#ccc", fontSize:13, padding:20 }}>还没有约定</div>}
      <AddBtn label="新约定" ac={th.ac} onClick={()=>{ setFc(""); setFi("0.8"); setModal("add"); }} />
    </div>
    <Modal open={!!modal} title={modal==="add"?"新约定":"编辑约定"} onClose={()=>setModal(null)} onSave={save}>
      <Field label="内容"><TArea value={fc} set={setFc} placeholder="写下约定…" /></Field>
      <Field label="重要度 (0~1)"><TInput value={fi} set={setFi} placeholder="0.8" /></Field>
    </Modal>
  </div>);
}

// ---------- DIARY ----------
function Diary({ th }) {
  const [sub, setSub] = useState("diary");
  const [data, setData] = useState([]);
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(null);
  const [fc, setFc] = useState("");
  const [fs, setFs] = useState("进行中");
  const tabs = [["diary","日记"],["summary","小结"],["digest","摘要"],["todo","待办"]];

  const load = useCallback(async () => {
    if (sub === "diary") {
      const all = await fetchLayer("diary");
      setData(all.filter(x => !x.tags?.includes("小结") && !x.tags?.includes("待办") && !x.tags?.includes("摘要")));
    } else if (sub === "summary") {
      setData(await fetchLayer("diary", { tags: ["小结"] }));
    } else if (sub === "digest") {
      setData(await fetchLayer("diary", { tags: ["摘要"] }));
    } else {
      setData(await fetchLayer("diary", { tags: ["待办"] }));
    }
  }, [sub]);
  useEffect(() => { load(); }, [load]);

  const filtered = data.filter(x => !q || x.content.includes(q));

  const save = async () => {
    if (!fc.trim()) return;
    if (sub === "todo") {
      if (modal === "add") {
        await insertMem({ layer:"diary", content:fc.trim(), tags:["待办"], status:"进行中", author:"宝" });
      } else {
        await updateMem(modal.id, { content:fc.trim(), status:fs });
      }
    } else if (sub === "digest") {
      if (modal === "add") {
        await insertMem({ layer:"diary", content:fc.trim(), tags:["摘要"], author:"宝" });
      } else {
        await updateMem(modal.id, { content:fc.trim() });
      }
    } else {
      if (modal === "add") {
        await insertMem({ layer:"diary", content:fc.trim(), author:"宝" });
      } else {
        await updateMem(modal.id, { content:fc.trim() });
      }
    }
    setModal(null); setFc(""); load();
  };

  const del = async (id) => { if(confirm("删除？")) { await deleteMem(id); load(); } };
  const edit = (x) => { setFc(x.content); setFs(x.status||"进行中"); setModal(x); };
  const toggleTodo = async (x) => {
    const ns = x.status === "完成" ? "进行中" : "完成";
    await updateMem(x.id, { status: ns }); load();
  };

  return (<div>
    <div style={{ display:"flex", padding:"0 16px", marginBottom:10 }}>
      {tabs.map(([k,l]) => <button key={k} onClick={()=>setSub(k)} style={{ flex:1, padding:"6px 0", fontSize:13, cursor:"pointer", background:"transparent", border:"none", borderBottom:sub===k?`1.5px solid ${th.ac}`:"1.5px solid transparent", color:sub===k?"#333":"#ccc", fontFamily:"inherit" }}>{l}</button>)}
    </div>
    <SearchBar v={q} set={setQ} />
    <div style={{ padding:"0 16px" }}>
      {sub === "todo" ? filtered.map((x,i) => (
        <div key={x.id} style={{ display:"flex", gap:10, padding:"9px 0", borderBottom:"1px solid rgba(0,0,0,0.03)", animation:`fi 0.3s ease ${i*0.04}s both` }}>
          <div onClick={()=>toggleTodo(x)} style={{ width:16, height:16, borderRadius:3, flexShrink:0, marginTop:2, cursor:"pointer", border:x.status==="完成"?"none":`1.5px solid ${th.ac}77`, background:x.status==="完成"?th.ac:"transparent", display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, color:"#fff" }}>{x.status==="完成"&&"✓"}</div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:13.5, color:x.status==="完成"?"#bbb":"#333", textDecoration:x.status==="完成"?"line-through":"none", lineHeight:1.5 }}>{x.content}</div>
            <div style={{ display:"flex", gap:6, marginTop:3 }}><span style={{ fontSize:10, color:"#bbb" }}>{x.status}</span><Time t={ft(x.created_at)}/></div>
            <Acts onEdit={()=>edit(x)} onDel={()=>del(x.id)} />
          </div>
        </div>
      )) : filtered.map((x,i) => (
        <Box key={x.id} i={i}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5 }}><Author a={x.author}/><Time t={ft(x.created_at)}/></div>
          <div style={{ fontSize:13.5, color:"#333", lineHeight:1.75 }}>{x.content}</div>
          {sub==="diary" && <Acts onEdit={()=>edit(x)} onDel={()=>del(x.id)} />}
          {sub==="digest" && <Acts onEdit={()=>edit(x)} onDel={()=>del(x.id)} />}
        </Box>
      ))}
      {!filtered.length && <div style={{ textAlign:"center", color:"#ccc", fontSize:13, padding:20 }}>空空的</div>}
      {sub==="diary" && <AddBtn label="写日记" ac={th.ac} onClick={()=>{ setFc(""); setModal("add"); }} />}
      {sub==="digest" && <AddBtn label="写摘要" ac={th.ac} onClick={()=>{ setFc(""); setModal("add"); }} />}
      {sub==="todo" && <AddBtn label="新待办" ac={th.ac} onClick={()=>{ setFc(""); setModal("add"); }} />}
    </div>
    <Modal open={!!modal} title={modal==="add"?(sub==="todo"?"新待办":sub==="digest"?"写摘要":"写日记"):"编辑"} onClose={()=>setModal(null)} onSave={save}>
      <Field label="内容"><TArea value={fc} set={setFc} placeholder={sub==="todo"?"待办事项…":sub==="digest"?"记录摘要…":"今天想说的…"} rows={sub==="todo"?2:5} /></Field>
      {sub==="todo" && modal!=="add" && (
        <Field label="状态">
          <div style={{ display:"flex", gap:6 }}>
            {["进行中","完成"].map(s => <button key={s} onClick={()=>setFs(s)} style={{ padding:"4px 12px", fontSize:12, borderRadius:14, cursor:"pointer", background:fs===s?th.ac+"20":"transparent", border:fs===s?`1px solid ${th.ac}40`:"1px solid rgba(0,0,0,0.08)", color:fs===s?"#333":"#aaa", fontFamily:"inherit" }}>{s}</button>)}
          </div>
        </Field>
      )}
    </Modal>
  </div>);
}

// ---------- MURMURE ----------
function Murmure({ th }) {
  const [data, setData] = useState([]);
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(null);
  const [fc, setFc] = useState("");
  const [replyTo, setReplyTo] = useState(null); // { memoryId, parentId? }

  const load = useCallback(async () => { setData(await fetchMurmure()); }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = data.filter(x => !q || x.content.includes(q) || x.comments?.some(c => c.content.includes(q)));

  const save = async () => {
    if (!fc.trim()) return;
    if (replyTo) {
      await insertComment({ memory_id: replyTo.memoryId, author: "宝", content: fc.trim(), parent_id: replyTo.parentId || null });
      setReplyTo(null);
    } else if (modal === "add") {
      await insertMem({ layer:"murmure", content:fc.trim(), author:"宝", need_reply:false });
    } else {
      await updateMem(modal.id, { content:fc.trim() });
    }
    setModal(null); setFc(""); load();
  };

  const del = async (id) => { if(confirm("删除这条动态？")) { await deleteMem(id); load(); } };

  return (<div>
    <SearchBar v={q} set={setQ} />
    <div style={{ padding:"0 16px" }}>
      {filtered.map((x,i) => (
        <Box key={x.id} i={i} sx={{ background:x.need_reply?`${th.ac}08`:"rgba(255,255,255,0.5)", border:x.need_reply?`1px solid ${th.ac}18`:"1px solid rgba(0,0,0,0.03)" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5 }}>
            <Author a={x.author}/><Time t={ft(x.created_at)}/>
            {x.need_reply && <span style={{ marginLeft:"auto", fontSize:9, color:th.ac, background:`${th.ac}12`, padding:"1px 5px", borderRadius:3 }}>待回复</span>}
          </div>
          <div style={{ fontSize:13.5, color:"#333", lineHeight:1.75 }}>{x.content}</div>
          {x.comments?.length > 0 && (
            <div style={{ marginTop:8, paddingTop:7, borderTop:"1px solid rgba(0,0,0,0.04)" }}>
              {x.comments.map(c => (
                <div key={c.id} style={{ marginBottom:5, paddingLeft:c.parent_id?16:0 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:1 }}><AuthorPlain a={c.author}/><Time t={ft(c.created_at)}/></div>
                  <div style={{ fontSize:12.5, color:"#333", lineHeight:1.5, marginTop:1 }}>{c.content}</div>
                </div>
              ))}
            </div>
          )}
          <div style={{ display:"flex", gap:10, marginTop:6 }}>
            <button onClick={()=>{ setReplyTo({ memoryId:x.id }); setFc(""); setModal("reply"); }} style={{ background:"none", border:"none", color:"#bbb", fontSize:10, cursor:"pointer", padding:0 }}>回复</button>
            <button onClick={()=>{ setFc(x.content); setModal(x); }} style={{ background:"none", border:"none", color:"#bbb", fontSize:10, cursor:"pointer", padding:0 }}>编辑</button>
            <button onClick={()=>del(x.id)} style={{ background:"none", border:"none", color:"#d8d8d8", fontSize:10, cursor:"pointer", padding:0 }}>删除</button>
          </div>
        </Box>
      ))}
      {!filtered.length && <div style={{ textAlign:"center", color:"#ccc", fontSize:13, padding:20 }}>还没有呢喃</div>}
      <AddBtn label="发动态" ac={th.ac} onClick={()=>{ setFc(""); setReplyTo(null); setModal("add"); }} />
    </div>
    <Modal open={!!modal} title={replyTo?"回复":modal==="add"?"发动态":"编辑动态"} onClose={()=>{ setModal(null); setReplyTo(null); }} onSave={save}>
      <Field label={replyTo?"回复内容":"内容"}><TArea value={fc} set={setFc} placeholder={replyTo?"写回复…":"想说什么…"} rows={3} /></Field>
    </Modal>
  </div>);
}

// ---------- REEF ----------
function Reef({ th }) {
  const [filter, setFilter] = useState("全部");
  const [data, setData] = useState([]);
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(null);
  const [fc, setFc] = useState("");
  const [fst, setFst] = useState("幻想");
  const [fin, setFin] = useState(3);
  const [fdl, setFdl] = useState("");

  const load = useCallback(async () => {
    if (filter === "全部") setData(await fetchLayer("reef"));
    else setData(await fetchLayer("reef", { status: filter }));
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  const sc = { "幻想":"#a990be", "常驻":"#7ab392", "完成":"#888" };
  const filtered = data.filter(x => !q || x.content.includes(q));

  const save = async () => {
    if (!fc.trim()) return;
    const ctx = fdl ? { deadline: fdl } : {};
    if (modal === "add") {
      await insertMem({ layer:"reef", content:fc.trim(), status:fst, intensity:fin, context:ctx, author:"宝" });
    } else {
      await updateMem(modal.id, { content:fc.trim(), status:fst, intensity:fin, context:ctx });
    }
    setModal(null); setFc(""); load();
  };

  const del = async (id) => { if(confirm("删除？")) { await deleteMem(id); load(); } };
  const edit = (x) => { setFc(x.content); setFst(x.status); setFin(x.intensity||3); setFdl(x.context?.deadline||""); setModal(x); };

  return (<div>
    <div style={{ display:"flex", gap:6, padding:"0 16px", marginBottom:10 }}>
      {["全部","幻想","常驻","完成"].map(v => (
        <button key={v} onClick={()=>setFilter(v)} style={{ padding:"3px 13px", fontSize:12, borderRadius:14, cursor:"pointer", background:filter===v?"#F8F5F0":"transparent", border:filter===v?"1px solid rgba(248,245,240,0.3)":"1px solid rgba(255,255,255,0.1)", color:filter===v?"#2A2A2C":"#F8F5F0", fontWeight:filter===v?500:400, fontFamily:"inherit" }}>{v}</button>
      ))}
    </div>
    <SearchBar v={q} set={setQ} dk />
    <div style={{ padding:"0 16px" }}>
      {filtered.map((x,i) => (
        <Box key={x.id} i={i} dk>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5 }}>
            <span style={{ fontSize:10, padding:"1px 7px", borderRadius:3, background:`${sc[x.status]||"#888"}20`, color:sc[x.status]||"#888", fontWeight:500 }}>{x.status}</span>
            <div style={{ display:"flex", gap:2, marginLeft:"auto" }}>
              {[...Array(5)].map((_,j) => <div key={j} style={{ width:3, height:10, borderRadius:1, background:j<x.intensity?"#F8F5F0":"rgba(255,255,255,0.08)" }} />)}
            </div>
          </div>
          <div style={{ fontSize:13.5, color:"#F8F5F0", lineHeight:1.6 }}>{x.content}</div>
          {x.context?.deadline && <div style={{ fontSize:10, color:"#777", marginTop:3 }}>⏳ {fd(x.context.deadline)}</div>}
          <Acts dk onEdit={()=>edit(x)} onDel={()=>del(x.id)} />
        </Box>
      ))}
      {!filtered.length && <div style={{ textAlign:"center", color:"#666", fontSize:13, padding:20 }}>没有暗礁</div>}
      <AddBtn label="新暗礁" ac={th.ac} dk onClick={()=>{ setFc(""); setFst("幻想"); setFin(3); setFdl(""); setModal("add"); }} />
    </div>
    <Modal open={!!modal} title={modal==="add"?"新暗礁":"编辑暗礁"} onClose={()=>setModal(null)} onSave={save}>
      <Field label="内容"><TArea value={fc} set={setFc} placeholder="想做的事…" rows={2} /></Field>
      <Field label="状态">
        <div style={{ display:"flex", gap:6 }}>
          {["幻想","常驻","完成"].map(s => <button key={s} onClick={()=>setFst(s)} style={{ padding:"4px 12px", fontSize:12, borderRadius:14, cursor:"pointer", background:fst===s?"#33333318":"transparent", border:fst===s?"1px solid #33333330":"1px solid rgba(0,0,0,0.08)", color:fst===s?"#333":"#aaa", fontFamily:"inherit" }}>{s}</button>)}
        </div>
      </Field>
      <Field label={`强度 ${fin}/5`}>
        <div style={{ display:"flex", gap:4 }}>
          {[1,2,3,4,5].map(n => <div key={n} onClick={()=>setFin(n)} style={{ width:24, height:24, borderRadius:4, border:"1px solid rgba(0,0,0,0.08)", background:n<=fin?"#333":"transparent", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", color:n<=fin?"#fff":"#ccc", fontSize:11 }}>{n}</div>)}
        </div>
      </Field>
      <Field label="截止日期（可选）"><TInput value={fdl} set={setFdl} type="date" /></Field>
    </Modal>
  </div>);
}

// ---------- INSPIRATION ----------
function Inspiration({ th }) {
  const [data, setData] = useState([]);
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(null);
  const [fc, setFc] = useState("");
  const [ftags, setFtags] = useState("");

  const load = useCallback(async () => { setData(await fetchLayer("inspiration")); }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = data.filter(x => !q || x.content.includes(q) || x.tags?.some(t => t.includes(q)));

  const save = async () => {
    if (!fc.trim()) return;
    const tags = ftags.split(/[,，\s]+/).filter(Boolean).map(t => t.replace(/^#/,""));
    if (modal === "add") {
      await insertMem({ layer:"inspiration", content:fc.trim(), tags, author:"宝" });
    } else {
      await updateMem(modal.id, { content:fc.trim(), tags });
    }
    setModal(null); setFc(""); setFtags(""); load();
  };

  const del = async (id) => { if(confirm("删除？")) { await deleteMem(id); load(); } };
  const edit = (x) => { setFc(x.content); setFtags((x.tags||[]).join(" ")); setModal(x); };

  return (<div>
    <SearchBar v={q} set={setQ} />
    <div style={{ padding:"0 16px" }}>
      {filtered.map((x,i) => (
        <Box key={x.id} i={i} sx={{ borderLeft:`2px solid ${th.ac}44`, borderRadius:"0 7px 7px 0" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5, flexWrap:"wrap" }}>
            <Author a={x.author}/>
            {x.tags?.map(t => <span key={t} style={{ fontSize:10, color:"#aaa", background:"rgba(0,0,0,0.03)", padding:"1px 5px", borderRadius:3 }}>#{t}</span>)}
            <Time t={ft(x.created_at)} sx={{ marginLeft:"auto" }} />
          </div>
          <div style={{ fontSize:13.5, color:"#444", lineHeight:1.75, fontStyle:"italic" }}>{x.content}</div>
          <Acts onEdit={()=>edit(x)} onDel={()=>del(x.id)} />
        </Box>
      ))}
      {!filtered.length && <div style={{ textAlign:"center", color:"#ccc", fontSize:13, padding:20 }}>还没有灵感</div>}
      <AddBtn label="记录灵感" ac={th.ac} onClick={()=>{ setFc(""); setFtags(""); setModal("add"); }} />
    </div>
    <Modal open={!!modal} title={modal==="add"?"记录灵感":"编辑"} onClose={()=>setModal(null)} onSave={save}>
      <Field label="内容"><TArea value={fc} set={setFc} placeholder="灵感、摘录、金句…" rows={4} /></Field>
      <Field label="标签（空格分隔，如：金句 摘录 深度对话）"><TInput value={ftags} set={setFtags} placeholder="金句 摘录" /></Field>
    </Modal>
  </div>);
}

// ---------- CHRONICLE ----------
function Chronicle({ th }) {
  const [data, setData] = useState([]);
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(null);
  const [fc, setFc] = useState("");
  const [fdate, setFdate] = useState("");

  const load = useCallback(async () => {
    const { data:d } = await supabase.from("memories").select("*").eq("layer","chronicle").order("event_date", { ascending: true });
    setData(d || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = data.filter(x => !q || x.content.includes(q));

  const save = async () => {
    if (!fc.trim() || !fdate) return;
    if (modal === "add") {
      await insertMem({ layer:"chronicle", content:fc.trim(), event_date:fdate, author:"宝" });
    } else {
      await updateMem(modal.id, { content:fc.trim(), event_date:fdate });
    }
    setModal(null); setFc(""); setFdate(""); load();
  };

  const del = async (id) => { if(confirm("删除？")) { await deleteMem(id); load(); } };
  const edit = (x) => { setFc(x.content); setFdate(x.event_date||""); setModal(x); };

  return (<div>
    <SearchBar v={q} set={setQ} />
    <div style={{ padding:"0 16px" }}>
      <div style={{ position:"relative", paddingLeft:18 }}>
        <div style={{ position:"absolute", left:3, top:0, bottom:0, width:1, background:`${th.ac}25` }} />
        {filtered.map((x,i) => (
          <div key={x.id} style={{ position:"relative", paddingBottom:20, paddingLeft:14, animation:`fi 0.3s ease ${i*0.06}s both` }}>
            <div style={{ position:"absolute", left:-1, top:4, width:7, height:7, borderRadius:"50%", background:th.ac, opacity:0.5 }} />
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:2 }}><Time t={fd(x.event_date)} sx={{ fontSize:11, color:"#999" }}/><Author a={x.author}/></div>
            <div style={{ fontSize:13.5, color:"#333", lineHeight:1.6 }}>{x.content}</div>
            <Acts onEdit={()=>edit(x)} onDel={()=>del(x.id)} />
          </div>
        ))}
      </div>
      {!filtered.length && <div style={{ textAlign:"center", color:"#ccc", fontSize:13, padding:20 }}>还没有记录</div>}
      <AddBtn label="记录朝夕" ac={th.ac} onClick={()=>{ setFc(""); setFdate(""); setModal("add"); }} />
    </div>
    <Modal open={!!modal} title={modal==="add"?"记录朝夕":"编辑"} onClose={()=>setModal(null)} onSave={save}>
      <Field label="日期"><TInput value={fdate} set={setFdate} type="date" /></Field>
      <Field label="内容"><TArea value={fc} set={setFc} placeholder="发生了什么…" rows={3} /></Field>
    </Modal>
  </div>);
}

// ---------- TIDE ----------
function Tide({ th }) {
  const now = new Date();
  const [vM, setVM] = useState(now.getMonth());
  const [vY, setVY] = useState(now.getFullYear());
  const [data, setData] = useState([]);
  const [modal, setModal] = useState(null);
  const [fdate, setFdate] = useState("");
  const [ftype, setFtype] = useState("period");
  const [fflow, setFflow] = useState("moderate");
  const [fnotes, setFnotes] = useState("");
  const [editId, setEditId] = useState(null);

  const load = useCallback(async () => {
    const { data:d } = await supabase.from("memories").select("*").eq("layer","tide");
    setData(d || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const dim = new Date(vY, vM+1, 0).getDate();
  const fday = new Date(vY, vM, 1).getDay();
  const mn = ["一月","二月","三月","四月","五月","六月","七月","八月","九月","十月","十一月","十二月"];
  const wk = ["日","一","二","三","四","五","六"];

  const tm = {};
  const tmId = {};
  data.forEach(t => { if(t.event_date) { const dd=new Date(t.event_date+"T00:00:00"); const k=`${dd.getFullYear()}-${dd.getMonth()}-${dd.getDate()}`; tm[k]=t.context; tmId[k]=t; } });

  const mk = (day) => {
    const k = `${vY}-${vM}-${day}`;
    const dd = tm[k];
    if (!dd) return null;
    if (dd.type==="period") return <div style={{ width:5, height:5, borderRadius:"50%", background:"#d4727b", margin:"2px auto 0" }} />;
    if (dd.type==="intimacy") return <div style={{ fontSize:7, textAlign:"center", marginTop:1, color:"#EEE2E2" }}>♥</div>;
    return null;
  };

  const prev = () => { if(vM===0){setVM(11);setVY(y=>y-1);}else setVM(m=>m-1); };
  const next = () => { if(vM===11){setVM(0);setVY(y=>y+1);}else setVM(m=>m+1); };

  const tapDay = (day) => {
    const dateStr = `${vY}-${String(vM+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    const k = `${vY}-${vM}-${day}`;
    const existing = tmId[k];
    if (existing) {
      setFdate(dateStr);
      setFtype(existing.context?.type || "period");
      setFflow(existing.context?.flow || "moderate");
      setFnotes(existing.context?.notes || "");
      setEditId(existing.id);
      setModal("edit");
    } else {
      setFdate(dateStr);
      setFtype("period");
      setFflow("moderate");
      setFnotes("");
      setEditId(null);
      setModal("add");
    }
  };

  const save = async () => {
    if (!fdate) return;
    const ctx = ftype === "period" ? { type:"period", flow:fflow } : { type:"intimacy", notes:fnotes||undefined };
    if (editId) {
      await updateMem(editId, { event_date:fdate, context:ctx });
    } else {
      await insertMem({ layer:"tide", content: ftype==="period"?"经期记录":"亲密记录", event_date:fdate, context:ctx, author:"宝" });
    }
    setModal(null); setFdate(""); setEditId(null); load();
  };

  const del = async () => {
    if (editId && confirm("删除这条记录？")) {
      await deleteMem(editId); setModal(null); setEditId(null); load();
    }
  };

  return (<div style={{ padding:"0 16px" }}>
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
      <button onClick={prev} style={{ background:"none", border:"none", color:"#888", fontSize:18, cursor:"pointer", padding:"4px 10px" }}>‹</button>
      <span style={{ fontSize:14, color:"#555" }}>{vY}年{mn[vM]}</span>
      <button onClick={next} style={{ background:"none", border:"none", color:"#888", fontSize:18, cursor:"pointer", padding:"4px 10px" }}>›</button>
    </div>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(7, 1fr)", gap:2, textAlign:"center" }}>
      {wk.map(w => <div key={w} style={{ fontSize:10, color:"#999", padding:"3px 0" }}>{w}</div>)}
      {[...Array(fday)].map((_,i) => <div key={`b${i}`} />)}
      {[...Array(dim)].map((_,i) => {
        const day=i+1;
        const isT=day===now.getDate()&&vM===now.getMonth()&&vY===now.getFullYear();
        const hasData = !!tm[`${vY}-${vM}-${day}`];
        return (
          <div key={day} onClick={()=>tapDay(day)} style={{ padding:"5px 0", cursor:"pointer", borderRadius:5, background:isT?`${th.ac}18`:"transparent", transition:"background 0.15s" }}>
            <div style={{ fontSize:12, color:isT?th.ac:hasData?"#555":"#999", fontWeight:hasData?500:400 }}>{day}</div>
            {mk(day)}
          </div>
        );
      })}
    </div>
    <div style={{ marginTop:14, display:"flex", gap:14, justifyContent:"center" }}>
      <div style={{ display:"flex", alignItems:"center", gap:4, fontSize:11, color:"#888" }}><div style={{ width:6, height:6, borderRadius:"50%", background:"#d4727b" }} /> 经期</div>
      <div style={{ display:"flex", alignItems:"center", gap:4, fontSize:11, color:"#888" }}><span style={{ fontSize:10, color:"#c48a96" }}>♥</span> 亲密</div>
    </div>
    <div style={{ fontSize:10, color:"#bbb", textAlign:"center", marginTop:8 }}>点击日期可添加或编辑记录</div>
    <Modal open={!!modal} title={editId?"编辑记录":"添加记录"} onClose={()=>{setModal(null);setEditId(null);}} onSave={save}>
      <Field label="日期"><TInput value={fdate} set={setFdate} type="date" /></Field>
      <Field label="类型">
        <div style={{ display:"flex", gap:6 }}>
          {[["period","经期"],["intimacy","亲密"]].map(([k,l]) => <button key={k} onClick={()=>setFtype(k)} style={{ padding:"4px 14px", fontSize:12, borderRadius:14, cursor:"pointer", background:ftype===k?"#33333318":"transparent", border:ftype===k?"1px solid #33333330":"1px solid rgba(0,0,0,0.08)", color:ftype===k?"#333":"#aaa", fontFamily:"inherit" }}>{l}</button>)}
        </div>
      </Field>
      {ftype==="period" && (
        <Field label="流量">
          <div style={{ display:"flex", gap:6 }}>
            {[["light","少"],["moderate","中"],["heavy","多"]].map(([k,l]) => <button key={k} onClick={()=>setFflow(k)} style={{ padding:"4px 14px", fontSize:12, borderRadius:14, cursor:"pointer", background:fflow===k?"#d4727b20":"transparent", border:fflow===k?"1px solid #d4727b40":"1px solid rgba(0,0,0,0.08)", color:fflow===k?"#d4727b":"#aaa", fontFamily:"inherit" }}>{l}</button>)}
          </div>
        </Field>
      )}
      {ftype==="intimacy" && (
        <Field label="备注（可选）"><TInput value={fnotes} set={setFnotes} placeholder="想记点什么…" /></Field>
      )}
      {editId && <button onClick={del} style={{ width:"100%", padding:"10px", marginTop:8, background:"transparent", border:"1px solid rgba(0,0,0,0.06)", borderRadius:8, color:"#ccc", fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>删除记录</button>}
    </Modal>
  </div>);
}

/* ===== MAIN APP ===== */
export default function App() {
  const [tab, setTab] = useState("chat");
  const [drawer, setDrawer] = useState(false);
  const ref = useRef(null);
  const th = TH[tab];

  useEffect(() => { if(ref.current) ref.current.scrollTop=0; }, [tab]);

  const panels = { anchor:Anchor, diary:Diary, murmure:Murmure, reef:Reef, inspiration:Inspiration, chronicle:Chronicle, tide:Tide, chat:ChatPanel };
  const Panel = panels[tab];
  const isChat = tab === "chat";

  return (
    <div style={{
      width:"100%", maxWidth:430, margin:"0 auto", height:"100dvh",
      display:"flex", flexDirection:"column",
      background:th.bg,
      fontFamily:"'Noto Serif SC','Songti SC','STSong',serif",
      color:th.dk?"#F8F5F0":"#333",
      position:"relative", overflow:"hidden",
      transition:"background 0.35s ease",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@300;400;500;600&display=swap');
        @keyframes fi{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
        @keyframes su{from{transform:translateY(100%)}to{transform:translateY(0)}}
        @keyframes fo{from{opacity:0}to{opacity:1}}
        *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
        ::-webkit-scrollbar{width:0}
        input::placeholder{color:#ccc}
        textarea::placeholder{color:#ccc}
        body{margin:0;padding:0;background:#F8F5F0}
      `}</style>

      {/* Header */}
      {!isChat && (
        <div style={{ padding:"50px 16px 8px", display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
          {IC[tab]?.(th.dk?"#F8F5F0":th.ac, 22)}
          <span style={{ fontSize:18, fontWeight:300, color:th.dk?"#F8F5F0":"#333", letterSpacing:2 }}>{th.name}</span>
        </div>
      )}

      {/* Content */}
      {isChat ? (
        <div style={{ flex:1, overflow:"hidden", paddingTop:50, paddingBottom:88 }}>
          <Panel th={th} />
        </div>
      ) : (
        <div ref={ref} style={{ flex:1, overflow:"auto", paddingTop:8, paddingBottom:100 }}>
          <Panel th={th} />
        </div>
      )}

      {/* Bottom Nav */}
      <div style={{
        position:"fixed", bottom:0, left:0, right:0,
        maxWidth:430, margin:"0 auto",
        display:"flex", justifyContent:"space-around", alignItems:"center",
        padding:"6px 4px 34px",
        background:th.nav,
        borderTop:th.dk?"1px solid rgba(248,245,240,0.08)":"1px solid rgba(0,0,0,0.04)",
        transition:"background 0.35s ease",
      }}>
        {TABS1.map(k => {
          const a=tab===k; const t=TH[k];
          return (
            <button key={k} onClick={()=>{setTab(k);setDrawer(false);}} style={{
              display:"flex", flexDirection:"column", alignItems:"center", gap:1,
              background:"none", border:"none", cursor:"pointer",
              padding:"4px 13px", opacity:a?1:0.4, transition:"opacity 0.2s",
            }}>
              {IC[k]?.(a?t.ac:"#888", 20)}
              <span style={{ fontSize:9, color:a?t.ac:"#888", fontFamily:"inherit" }}>{t.name}</span>
            </button>
          );
        })}
        <button onClick={()=>setDrawer(!drawer)} style={{
          display:"flex", flexDirection:"column", alignItems:"center", gap:1,
          background:"none", border:"none", cursor:"pointer", padding:"4px 13px", opacity:0.4,
        }}>
          {IC.dots("#888")}
          <span style={{ fontSize:9, color:"#888", fontFamily:"inherit" }}>更多</span>
        </button>
      </div>

      {/* Drawer */}
      {drawer && <>
        <div onClick={()=>setDrawer(false)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.15)", animation:"fo 0.2s ease", zIndex:10 }} />
        <div style={{
          position:"fixed", bottom:0, left:0, right:0,
          maxWidth:430, margin:"0 auto",
          background:"#fff", borderRadius:"12px 12px 0 0",
          padding:"14px 14px 34px",
          animation:"su 0.25s ease", zIndex:11,
          boxShadow:"0 -4px 16px rgba(0,0,0,0.05)",
        }}>
          <div style={{ width:26, height:3, borderRadius:2, background:"#ddd", margin:"0 auto 12px" }} />
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:5 }}>
            {TABS_ALL.map(t => {
              const a=tab===t.k; const tt=TH[t.k];
              return (
                <button key={t.k} onClick={()=>{setTab(t.k);setDrawer(false);}} style={{
                  display:"flex", flexDirection:"column", alignItems:"center", gap:4,
                  padding:"9px 5px", borderRadius:8, cursor:"pointer",
                  background:a?`${tt.ac}0d`:"transparent",
                  border:a?`1px solid ${tt.ac}20`:"1px solid transparent",
                }}>
                  {IC[t.k]?.(a?tt.ac:"#aaa", 22)}
                  <span style={{ fontSize:11, color:a?tt.ac:"#999", fontFamily:"inherit" }}>{t.l}</span>
                </button>
              );
            })}
          </div>
        </div>
      </>}
    </div>
  );
}...
