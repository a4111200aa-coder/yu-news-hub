import {getJSON, fmtDate, escapeHtml, loadSet, saveSet, toggleSet, translateLink, isEnglish} from "./utils.js";

const KEY_READ = "yuNews.read";
const KEY_STAR = "yuNews.star";
const KEY_AI_ENDPOINT = "yuNews.aiEndpoint"; // optional

const el = (id) => document.getElementById(id);

function getId(){
  const p = new URLSearchParams(location.search);
  return p.get("id");
}

function setBtnState(btn, active){
  btn.classList.toggle("primary", !!active);
}

function translateTextLink(text){
  const t = encodeURIComponent(text || "");
  return `https://translate.google.com/?sl=auto&tl=zh-CN&text=${t}&op=translate`;
}

async function tryAIBullets(item){
  const endpoint = localStorage.getItem(KEY_AI_ENDPOINT);
  if(!endpoint) return null;

  const payload = {
    title: item.title,
    summary: item.summary || "",
    url: item.link,
    lang: item.lang || "en"
  };

  const r = await fetch(endpoint, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify(payload)
  });
  if(!r.ok) throw new Error(`AI endpoint failed (${r.status})`);
  const data = await r.json();
  if(Array.isArray(data.bullets)) return data.bullets;
  if(typeof data.text === "string") return data.text.split("\n").filter(Boolean);
  return null;
}

function render(item){
  document.title = `Article · ${item.title}`;

  const readSet = loadSet(KEY_READ);
  const starSet = loadSet(KEY_STAR);

  const isRead = readSet.has(item.id);
  const isStar = starSet.has(item.id);

  const btnRead = el("btnMarkRead");
  const btnStar = el("btnStar");
  const btnOpen = el("btnOpen");

  setBtnState(btnRead, isRead);
  setBtnState(btnStar, isStar);

  btnOpen.href = item.link;

  btnRead.addEventListener("click", () => {
    const s = toggleSet(KEY_READ, item.id);
    setBtnState(btnRead, s.has(item.id));
  });

  btnStar.addEventListener("click", () => {
    const s = toggleSet(KEY_STAR, item.id);
    setBtnState(btnStar, s.has(item.id));
  });

  const tags = (item.tags || []).map(t => `<span class="chip">${escapeHtml(t)}</span>`).join(" ");
  const lang = isEnglish(item.lang) ? "EN" : "ZH";
  const region = item.region === "CN" ? "中国" : "全球";

  const sum = item.summary ? escapeHtml(item.summary) : "—（该源未提供摘要）";

  const transBtn = isEnglish(item.lang) ? `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">
      <a class="btn" href="${translateLink(item.link)}" target="_blank" rel="noopener">机器翻译打开原文</a>
      ${item.summary ? `<a class="btn" href="${translateTextLink(item.summary)}" target="_blank" rel="noopener">机器翻译摘要</a>` : ""}
      <button class="btn primary" id="btnAIBullets">中文要点（可选）</button>
    </div>
    <div class="note">“中文要点”默认不调用任何外部服务。你可以在浏览器控制台运行：<span class="kbd">localStorage.setItem('yuNews.aiEndpoint','你的API端点')</span> 来启用（README 有示例 Worker）。</div>
  ` : "";

  el("article").innerHTML = `
    <h1>${escapeHtml(item.title)}</h1>
    <div class="metaLine">
      <span>🕒 ${escapeHtml(fmtDate(item.published))}</span>
      <span>📰 ${escapeHtml(item.source)}</span>
      <span>🌍 ${region}</span>
      <span>🔤 ${lang}</span>
      ${tags ? `<span style="display:flex;gap:6px;flex-wrap:wrap">${tags}</span>` : ""}
    </div>

    <div class="block">
      <h2>摘要</h2>
      <p>${sum}</p>
      ${transBtn}
    </div>

    <div class="block" id="aiBlock" style="display:none">
      <h2>中文要点</h2>
      <p id="aiText">生成中…</p>
    </div>
  `;

  const btnAIBullets = document.getElementById("btnAIBullets");
  if(btnAIBullets){
    btnAIBullets.addEventListener("click", async () => {
      const aiBlock = document.getElementById("aiBlock");
      const aiText = document.getElementById("aiText");
      aiBlock.style.display = "block";
      aiText.textContent = "生成中…";
      try{
        const bullets = await tryAIBullets(item);
        if(!bullets){
          aiText.textContent = "未配置 AI 端点，或返回结果为空。请按 README 配置。";
          return;
        }
        aiText.innerHTML = bullets.map(b => `• ${escapeHtml(String(b))}`).join("<br/>");
      }catch(err){
        aiText.textContent = `生成失败：${err}`;
      }
    });
  }
}

async function init(){
  const id = getId();
  if(!id){
    el("article").innerHTML = `<div class="badge">缺少参数 id</div>`;
    return;
  }
  try{
    const it = await getJSON("data/items.json");
    const item = it.find(x => x.id === id);
    if(!item){
      el("article").innerHTML = `<div class="badge">找不到该文章（数据可能已更新）</div>`;
      return;
    }
    render(item);
  }catch(err){
    el("article").innerHTML = `<div class="badge">加载失败：${err}</div>`;
  }
}
init();
