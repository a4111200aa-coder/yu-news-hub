import {getJSON, fmtDate, escapeHtml, loadSet, saveSet, toggleSet, parseTags, translateLink, clamp} from "./utils.js";

const KEY_READ = "yuNews.read";
const KEY_STAR = "yuNews.star";
const KEY_PREF = "yuNews.pref";

let items = [];
let topics = [];
let hotMap = new Map(); // itemId -> topicScore

const el = (id) => document.getElementById(id);

const state = {
  q: "",
  category: "all",
  region: "mix",
  sort: "hot",
  onlyUnread: false,
  onlyStar: false
};

function loadPref(){
  try{
    const raw = localStorage.getItem(KEY_PREF);
    if(!raw) return;
    const p = JSON.parse(raw);
    Object.assign(state, p);
  }catch{}
}

function savePref(){
  localStorage.setItem(KEY_PREF, JSON.stringify({
    category: state.category,
    region: state.region,
    sort: state.sort,
    onlyUnread: state.onlyUnread,
    onlyStar: state.onlyStar
  }));
}

function buildHotMap(){
  hotMap = new Map();
  for(const t of topics){
    for(const id of t.items || []){
      const prev = hotMap.get(id) || 0;
      hotMap.set(id, Math.max(prev, t.score || 0));
    }
  }
}

function itemTimeMs(it){
  const p = it.published ? Date.parse(it.published) : 0;
  return isNaN(p) ? 0 : p;
}

function matchesFilters(it){
  const q = state.q.trim().toLowerCase();
  if(q){
    const hay = [
      it.title, it.summary, it.source,
      ...(it.tags || [])
    ].join(" ").toLowerCase();
    if(!hay.includes(q)) return false;
  }
  if(state.category !== "all"){
    const tags = new Set(parseTags(it.tags));
    if(!tags.has(state.category)) return false;
  }
  if(state.region === "CN" && it.region !== "CN") return false;
  if(state.region === "Global" && it.region !== "Global") return false;

  if(state.onlyUnread){
    const read = loadSet(KEY_READ);
    if(read.has(it.id)) return false;
  }
  if(state.onlyStar){
    const star = loadSet(KEY_STAR);
    if(!star.has(it.id)) return false;
  }
  return true;
}

function applyMix(list){
  if(state.region !== "mix") return list;
  const ratio = 0.6;
  const cn = list.filter(x => x.region === "CN");
  const gl = list.filter(x => x.region === "Global");
  const targetCN = Math.round(list.length * ratio);
  const targetGL = list.length - targetCN;
  return [
    ...cn.slice(0, targetCN),
    ...gl.slice(0, targetGL)
  ];
}

function sortList(list){
  if(state.sort === "new"){
    return [...list].sort((a,b) => itemTimeMs(b) - itemTimeMs(a));
  }
  // hot: by topic score then time
  return [...list].sort((a,b) => {
    const ha = hotMap.get(a.id) || 0;
    const hb = hotMap.get(b.id) || 0;
    if(hb !== ha) return hb - ha;
    return itemTimeMs(b) - itemTimeMs(a);
  });
}

function renderTopics(){
  const wrap = el("topics");
  if(!topics.length){
    wrap.innerHTML = `<div class="badge">暂无数据（等待 GitHub Actions 更新 data/topics.json）</div>`;
    return;
  }
  wrap.innerHTML = topics.map(t => {
    const src = (t.sources || []).slice(0,4).map(s => escapeHtml(s)).join(" · ");
    return `
      <div class="topic">
        <div class="headline">${escapeHtml(t.headline)}</div>
        <div class="meta">
          <span>🔥 ${t.count}</span>
          <span>📰 ${escapeHtml(src || "—")}</span>
        </div>
      </div>
    `;
  }).join("");
}

function renderList(){
  const readSet = loadSet(KEY_READ);
  const starSet = loadSet(KEY_STAR);

  let list = items.filter(matchesFilters);

  // If "mix", we apply after initial sorting to keep both sides recent.
  list = sortList(list);
  list = applyMix(list);

  // limit to keep page snappy
  list = list.slice(0, 120);

  const wrap = el("list");
  if(!list.length){
    wrap.innerHTML = `<div class="badge">没有匹配结果</div>`;
    el("footer").textContent = "";
    return;
  }

  wrap.innerHTML = list.map(it => {
    const isRead = readSet.has(it.id);
    const isStar = starSet.has(it.id);
    const tags = (it.tags || []).slice(0,3).map(t => `<span class="chip">${escapeHtml(t)}</span>`).join(" ");
    const time = fmtDate(it.published);
    const sum = clamp(it.summary || "", 220);

    return `
      <div class="card ${isRead ? "read":""}">
        <div class="main">
          <h3><a href="article.html?id=${encodeURIComponent(it.id)}">${escapeHtml(it.title)}</a></h3>
          <div class="meta">
            <span>🕒 ${escapeHtml(time)}</span>
            <span>📰 ${escapeHtml(it.source)}</span>
            <span>🌍 ${it.region === "CN" ? "中国" : "全球"}</span>
            ${tags ? `<span style="display:flex;gap:6px;flex-wrap:wrap">${tags}</span>` : ""}
          </div>
          ${sum ? `<div class="summary">${escapeHtml(sum)}</div>` : ""}
        </div>

        <div style="display:flex;flex-direction:column;gap:8px">
          <button class="iconBtn ${isStar?"active":""}" data-action="star" data-id="${it.id}" title="收藏">
            <span class="icon">★</span>
          </button>
          <button class="iconBtn ${isRead?"active":""}" data-action="read" data-id="${it.id}" title="已读">
            <span class="icon">✓</span>
          </button>
          <a class="iconBtn" href="${translateLink(it.link)}" target="_blank" rel="noopener" title="机器翻译打开">
            <span class="icon">译</span>
          </a>
        </div>
      </div>
    `;
  }).join("");

  el("footer").textContent = `显示 ${list.length} 条（已去重，默认只保留近 7 天）`;
}

function bindCardActions(){
  el("list").addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-action]");
    if(!btn) return;
    ev.preventDefault();
    const action = btn.getAttribute("data-action");
    const id = btn.getAttribute("data-id");

    if(action === "star"){
      const s = toggleSet(KEY_STAR, id);
      btn.classList.toggle("active", s.has(id));
      return;
    }
    if(action === "read"){
      const s = toggleSet(KEY_READ, id);
      btn.classList.toggle("active", s.has(id));
      // also style the card
      btn.closest(".card")?.classList.toggle("read", s.has(id));
      return;
    }
  });
}

function bindControls(){
  // search focus shortcut
  window.addEventListener("keydown", (e) => {
    if(e.key === "/" && document.activeElement?.tagName !== "INPUT"){
      e.preventDefault();
      el("q").focus();
    }
  });

  el("q").addEventListener("input", (e) => { state.q = e.target.value; renderList(); });
  el("category").addEventListener("change", (e) => { state.category = e.target.value; savePref(); renderList(); });
  el("region").addEventListener("change", (e) => { state.region = e.target.value; savePref(); renderList(); });
  el("sort").addEventListener("change", (e) => { state.sort = e.target.value; savePref(); renderList(); });

  el("btnUnread").addEventListener("click", () => {
    state.onlyUnread = !state.onlyUnread;
    savePref();
    el("btnUnread").classList.toggle("primary", state.onlyUnread);
    renderList();
  });

  el("btnStarred").addEventListener("click", () => {
    state.onlyStar = !state.onlyStar;
    savePref();
    el("btnStarred").classList.toggle("primary", state.onlyStar);
    renderList();
  });

  el("btnReset").addEventListener("click", () => {
    state.q = "";
    state.category = "all";
    state.region = "mix";
    state.sort = "hot";
    state.onlyUnread = false;
    state.onlyStar = false;
    savePref();

    el("q").value = "";
    el("category").value = state.category;
    el("region").value = state.region;
    el("sort").value = state.sort;
    el("btnUnread").classList.remove("primary");
    el("btnStarred").classList.remove("primary");
    renderList();
  });

  el("btnRefresh").addEventListener("click", () => location.reload());
}

async function init(){
  loadPref();
  el("category").value = state.category;
  el("region").value = state.region;
  el("sort").value = state.sort;
  el("btnUnread").classList.toggle("primary", state.onlyUnread);
  el("btnStarred").classList.toggle("primary", state.onlyStar);

  bindControls();
  bindCardActions();

  try{
    const [meta, it, tp] = await Promise.all([
      getJSON("data/meta.json").catch(() => null),
      getJSON("data/items.json").catch(() => []),
      getJSON("data/topics.json").catch(() => [])
    ]);
    items = it || [];
    topics = tp || [];
    buildHotMap();

    const gen = meta?.generated_at ? fmtDate(meta.generated_at) : "未生成";
    const cnt = meta?.count_items ?? items.length;
    const fail = meta?.failures?.length ? `，失败源 ${meta.failures.length}` : "";
    el("metaLine").textContent = `数据更新时间：${gen} · ${cnt} 条${fail}`;

    renderTopics();
    renderList();
  }catch(err){
    el("metaLine").textContent = `加载失败：${err}`;
    el("topics").innerHTML = `<div class="badge">请检查 data/items.json 是否存在</div>`;
    el("list").innerHTML = `<div class="badge">请检查 data/items.json 是否存在</div>`;
  }
}

init();
