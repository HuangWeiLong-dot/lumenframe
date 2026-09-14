# FilmGrab 截图代理服务

一个独立运行的 Python（FastAPI）后端服务：输入电影名，从 [FilmGrab](https://film-grab.com)
抓取该电影的高清截图列表，并以**服务端代理**方式转发图片。前端不直接访问 FilmGrab，
不存在跨域问题。

> ⚠️ **仅供个人学习使用**：FilmGrab 明确表示不接受爬取，请勿公开部署、分发或商业化。
> 抓取节奏已内置 1 秒延迟。图片版权归原电影公司所有，请注意版权边界。

源码位于 `filmgrab-service/`，启动方式见 [manual.md](./manual.md)，
生产部署（systemd / Nginx 反向代理）见 [deploy.md](./deploy.md)。

## 目录结构

```text
filmgrab-service/
├── main.py                # FastAPI 服务：两个接口 + 内存缓存 + 并发限制
├── filmgrab_scraper.py    # FilmGrab 抓取/解析/白名单/图片下载逻辑
├── requirements.txt
├── start.bat / start.ps1  # Windows 一键启动（自动建虚拟环境、装依赖、探测代理）
└── .venv/                 # 本地虚拟环境（不提交）
```

## 安装

需要 Python 3.8+（在 3.14 + Windows 实测通过）。

```bash
cd filmgrab-service
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
# source .venv/bin/activate

pip install -r requirements.txt
```

## 启动

Windows 最简单的方式是双击 `start.bat`（或在 PowerShell 运行 `.\start.ps1`）：
脚本会自动创建虚拟环境、安装依赖，并探测本地代理 `127.0.0.1:7890`（有则走代理，无则直连）。

手动方式：

```bash
python main.py
# 或
uvicorn main:app --host 0.0.0.0 --port 8000
```

启动后：

- 服务地址：<http://localhost:8000>
- 接口文档（Swagger）：<http://localhost:8000/docs>

### 环境变量（可选）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8000` | 服务端口 |
| `HTTPS_PROXY` / `HTTP_PROXY` | 无 | 国内网络访问 FilmGrab 需要时设置本地代理，如 `http://127.0.0.1:7890` |
| `PROXY_CONCURRENCY` | `8` | 同时向 FilmGrab 下载图片的并发上限 |

Windows PowerShell 示例：

```powershell
$env:HTTPS_PROXY="http://127.0.0.1:7890"
python main.py
```

## 接口

### 1. 获取截图列表

```
GET /api/screenshots?movie={电影名}&year={上映年份，可选}
```

示例：

```bash
curl "http://localhost:8000/api/screenshots?movie=The%20Grand%20Budapest%20Hotel"
```

响应（`screenshots` 中每个元素都可直接作为 `<img src>` 使用）：

```json
{
  "movie": "The Grand Budapest Hotel",
  "page_title": "The Grand Budapest Hotel",
  "count": 64,
  "screenshots": [
    "/api/proxy?url=https%3A%2F%2Ffilm-grab.com%2Fwp-content%2Fuploads%2Fphoto-gallery%2F01%20%281072%29.jpg%3Fbwg%3D1547465810"
  ]
}
```

- `year` 参数参与缓存键，用于区分同名翻拍版（如 Dune 1984/2021）。
- 多个搜索结果时：优先**精确匹配**标题，其次相似度匹配（阈值 0.85，含数字/罗马数字
  规格化与年份校验），否则取第一条。
- 无结果时返回 `{"count": 0, "screenshots": []}`（HTTP 200，且不写入缓存）。

### 2. 代理图片

```
GET /api/proxy?url={FilmGrab 图片原始地址，需 URL 编码}
```

- 只允许代理 `film-grab.com` / `www.film-grab.com` 域名下
  `/wp-content/uploads/` 中的图片；其他 URL 返回 **403**。
- 服务端转发时自动伪装浏览器 TLS 指纹、UA 与 `Referer`（防盗链防御）。
- 返回图片二进制流，带 `Content-Type` 与 `Cache-Control: public, max-age=86400`。
- 上游图片拉取失败返回 **502**。
- 响应头 `X-Cache: MISS/HIT` 标识是否命中内存缓存。

前端经 Vite/Nginx 的 `/filmgrab` 前缀使用（开发环境由 Vite 重写到本服务的 `/api`）：

```html
<img src="/filmgrab/proxy?url=https%3A%2F%2Ffilm-grab.com%2F..." />
```

## 工作原理与关键实现

1. **搜索页**：`GET https://film-grab.com/?s=<电影名>`，结果入口为
   `h2.entry-title > a`（无结果时页面出现 “No Posts Found.” 且标题下无链接）。
2. **详情页**：高清原图在 10Web Photo Gallery 画廊的
   `a[href*="/wp-content/uploads/photo-gallery/"]` 中（排除 `/thumb/` 缩略图路径）；
   所有截图同页展示，无分页。`img` 的 `data-original` 是降级兜底来源。
3. **反爬处理**：FilmGrab 的 nginx 按 **TLS/JA3 指纹**拦截普通 Python 客户端
   （返回 403 “Checking your browser” JS 挑战）。页面本身是服务端直出的，
   **不需要 Selenium/Playwright**；使用 [`curl_cffi`](https://github.com/lexiforest/curl_cffi)
   的 `impersonate="chrome"` 模拟浏览器 TLS 指纹即可正常抓取。
4. **礼貌抓取**：搜索页与详情页请求之间至少间隔 1 秒；详情页失败自动重试 2 次。
5. **缓存**：
   - 截图列表：内存缓存 6 小时（空结果不缓存），上限 200 部；
   - 图片二进制：内存缓存 1 小时，LRU 淘汰，最多 120 张；图片不落地磁盘。
6. **并发限制**：`asyncio.Semaphore`（默认 8）防止同时打开过多上游连接。
7. **Content-Type 兜底**：上游类型缺失时按文件头魔数识别 jpg/png/gif/webp。

## 与前端的集成关系

- 开发环境：Vite（5173）将 `/filmgrab/*` 代理重写为 `http://localhost:8000/api/*`；
  服务同时开启了 CORS（仅 `GET` 放行）。
- 生产环境：由 Nginx 把 `/filmgrab/` 反代到 `127.0.0.1:8000/api/`，实现完全同源，
  配置示例见 [deploy.md](./deploy.md)。
- 前端组件 `web/src/components/FilmGrabShots.jsx` 在服务不可达时静默隐藏整个区块，
  不影响卡片生成器其余功能。

## 维护提示

- FilmGrab 改版可能导致选择器失效：解析为空时服务日志会输出
  “页面结构可能已变化” 警告，检查 `filmgrab_scraper.py` 顶部文档中的选择器即可。
- 若日后站点改为前端动态渲染，可引入 Playwright 等待画廊渲染后再取 HTML，
  届时需额外执行 `pip install playwright && playwright install chromium`。
- 匹配逻辑（标题相似度、年份校验）误判时，不要轻易调低阈值或去掉年份校验，
  否则会把同名翻拍版的剧照串到一起；优先检查 year 参数是否正确透传。
