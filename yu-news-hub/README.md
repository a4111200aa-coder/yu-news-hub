# Yu News Hub（GitHub Pages 静态聚合站）

一个“只存标题/链接/时间/来源/标签/摘要”的个人新闻聚合页：  
- **热点 Top10**（按标题相似度聚类 + 近期加权）  
- **已读 / 收藏 / 搜索**（全部保存在浏览器 localStorage）  
- **中国/全球 60%/40% 混合视图**（可切换仅中国/仅全球）  
- **英文文章可选机器翻译**（“译”按钮）  
- **可选：英文文章中文要点**（需要你配置一个 API 端点，见文末）

> 默认数据文件 `data/items.json` 是示例。启用 GitHub Actions 后会自动覆盖为真实抓取结果。

---

## 1）最短部署步骤（5 分钟）

1. 在 GitHub 新建仓库，例如：`yu-news-hub`
2. 把本目录所有文件上传到仓库根目录（保持目录结构不变）
3. 打开仓库 **Settings → Pages**
   - **Build and deployment** 选择 **Deploy from a branch**
   - Branch 选 `main`（或你的默认分支），Folder 选 `/ (root)`
4. 打开 **Actions**，确认工作流可以运行（第一次可能需要你点一次“Enable workflow”）
5. 触发数据更新：**Actions → Update news data → Run workflow**
6. 等工作流完成后，打开你的 Pages 地址即可

---

## 2）订阅源在哪里改？

编辑：`data/feeds.json`

字段说明（每一条 feed）：
- `url`：RSS 地址（或 Reuters sitemap index）
- `type`：
  - `rss`：普通 RSS
  - `reuters_news_sitemap_index`：Reuters 新闻 sitemap（只取标题/日期/链接）
- `region`：`CN` 或 `Global`
- `tags`：用于筛选/分类（如：`汽车`、`电动化`、`AI`、`宏观经济`、`投资`、`科学`、`大媒体`）
- `weight`：权重（热点计算时会轻微加权）

> build 脚本会自动：抓取 → 按时间过滤（默认近 7 天）→ 去重 → 生成热点聚类。

---

## 3）数据是怎么更新的？

`.github/workflows/update-data.yml`  
- 每 2 小时跑一次（你可以改 cron）
- 运行 `python scripts/build.py`
- 把生成的 `data/items.json`、`data/topics.json`、`data/meta.json` 提交回仓库

---

## 4）可选：英文文章“中文要点”按钮（需要你自己配置一个 API 端点）

### 4.1 你会得到什么体验？
在 `article.html` 里，英文条目会出现 **“中文要点（可选）”** 按钮：  
- **默认不会调用任何外部服务**  
- 你配置好一个端点后，它会把 `{title, summary, url}` POST 给端点，端点返回 `{"bullets":[...]}`
- 页面把 bullets 显示为中文要点

### 4.2 最简单做法：Cloudflare Worker（示例）
下面给一个最小 Worker 示例（伪代码风格，方便你替换成你自己的翻译/LLM 服务）。你也可以用任何其它服务（Vercel/自建服务器均可）。

```js
export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("POST only", { status: 405 });
    const body = await request.json(); // {title, summary, url, lang}
    const prompt = `把下面内容用中文写成 4-6 条要点：\n标题：${body.title}\n摘要：${body.summary}\n`;

    // TODO: 在这里调用你的 LLM / 翻译服务
    // const bullets = await callYourLLM(env.API_KEY, prompt);

    const bullets = [
      "（示例）要点 1：……",
      "（示例）要点 2：……"
    ];

    return new Response(JSON.stringify({ bullets }), {
      headers: { "Content-Type": "application/json" }
    });
  }
}
```

部署 Worker 后，在浏览器控制台设置端点：
```js
localStorage.setItem("yuNews.aiEndpoint", "https://你的worker域名/"); 
```

---

## 5）本地运行（可选）

你可以用任何静态服务器预览（例如 VSCode Live Server）。  
数据抓取/生成需要网络：本地跑 `python scripts/build.py` 即可更新 `data/*.json`。

---

## 6）版权与合规提示

本项目仅保存并展示：
- 标题 / 链接 / 时间 / 来源 / RSS 自带的短摘要（如有）

不抓取和存储正文内容。点击跳转后在原网站阅读。
