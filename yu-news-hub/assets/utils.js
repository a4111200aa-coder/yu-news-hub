export const TZ = "Asia/Singapore";

export async function getJSON(url){
  const r = await fetch(url, {cache: "no-store"});
  if(!r.ok) throw new Error(`Fetch failed: ${url} (${r.status})`);
  return await r.json();
}

export function fmtDate(iso){
  if(!iso) return "—";
  try{
    const dt = new Date(iso);
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: TZ,
      year: "numeric", month:"2-digit", day:"2-digit",
      hour:"2-digit", minute:"2-digit"
    }).format(dt);
  }catch{
    return iso;
  }
}

export function escapeHtml(s){
  return (s ?? "").replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

export function loadSet(key){
  try{
    const raw = localStorage.getItem(key);
    if(!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  }catch{
    return new Set();
  }
}

export function saveSet(key, set){
  localStorage.setItem(key, JSON.stringify([...set]));
}

export function toggleSet(key, id){
  const s = loadSet(key);
  if(s.has(id)) s.delete(id); else s.add(id);
  saveSet(key, s);
  return s;
}

export function parseTags(tags){
  return Array.isArray(tags) ? tags : [];
}

export function isEnglish(lang){
  return (lang || "").toLowerCase().startsWith("en");
}

export function translateLink(url){
  // Uses Google Translate web UI for an optional machine-translation view.
  const u = encodeURIComponent(url);
  return `https://translate.google.com/translate?sl=auto&tl=zh-CN&u=${u}`;
}

export function clamp(s, n){
  if(!s) return "";
  return s.length <= n ? s : (s.slice(0, n-1) + "…");
}
