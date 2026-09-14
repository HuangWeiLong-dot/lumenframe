# LUMENFRAME 部署手册

本文档介绍 LUMENFRAME（电影卡片生成器）在服务器上的完整部署方式。
本地开发启动方式见 [manual.md](./manual.md)；FilmGrab 截图服务的接口与实现细节见
[filmgrab-service.md](./filmgrab-service.md)。

## 1. 架构概览

应用由三个服务组成：

| 服务 | 技术栈 | 默认端口 | 职责 |
| --- | --- | --- | --- |
| `server/` | Node.js + Express | 3001 | TMDB 数据代理、图片代理、第三方评分（IMDb/Metacritic）、技术参数（ShotOnWhat?） |
| `web/` | React 19 + Vite | 开发态 5173 | 前端；生产环境构建为 `web/dist/` 纯静态文件 |
| `filmgrab-service/` | Python + FastAPI | 8000 | FilmGrab 高清剧照抓取与图片代理 |

开发环境下由 Vite 做开发代理（见 `web/vite.config.js`）：

- `/api/*` → `http://localhost:3001`
- `/filmgrab/*` → `http://localhost:8000/api/*`（前缀重写）

生产环境没有 Vite，这三条路由改由 Nginx（或任意反向代理）承担，最终用户只访问
80/443 一个端口，3001 与 8000 只监听 `127.0.0.1`，不对外暴露。

```text
浏览器 ──HTTP(S)──> Nginx :80/:443
                     ├── /            -> web/dist 静态文件
                     ├── /api/        -> Node   127.0.0.1:3001
                     └── /filmgrab/   -> Python 127.0.0.1:8000/api/
```

> ⚠️ **版权与合规边界**：FilmGrab 明确表示不接受爬取，`filmgrab-service`
> **仅供个人学习使用，请勿对公众开放部署**。公网正式上线时应停用该服务
> （前端的 “Film Stills” 区块会自动静默隐藏），或仅在可信内网中运行。

## 2. 环境要求

- Node.js **20+**（代码使用原生 `fetch`、`--env-file`、`import.meta.dirname`）
- Python **3.8+**（Windows + Python 3.14 实测通过）
- Nginx（或 Caddy / 其他反向代理）
- 能访问 `api.themoviedb.org` 与 `image.tmdb.org` 的网络；受限网络需要一个
  HTTP 代理（如本机 Clash 的 `http://127.0.0.1:7890`）

## 3. 环境变量

### 3.1 Node 后端：`server/.env`

启动脚本 `npm start` 会通过 `node --env-file=.env` 自动加载该文件。

```ini
# 必填：TMDB API Key，申请地址 https://www.themoviedb.org/settings/api
TMDB_API_KEY=your_tmdb_v3_api_key

# 可选：访问 TMDB 需要的 HTTP 代理（仅受限网络填写；海外服务器留空即直连）
TMDB_PROXY=http://127.0.0.1:7890

# 可选：监听端口，默认 3001
PORT=3001
```

`.env` 已在 `.gitignore` 中，不要提交到仓库。

### 3.2 Python 剧照服务

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8000` | 服务端口 |
| `HTTP_PROXY` / `HTTPS_PROXY` | 无 | 受限网络访问 FilmGrab 时设置，如 `http://127.0.0.1:7890` |
| `PROXY_CONCURRENCY` | `8` | 同时向上游下载图片的并发上限 |

前端无需任何环境变量，构建后不区分环境。

## 4. 生产部署（Linux + Nginx + systemd）

以下示例假设部署目录为 `/opt/lumenframe`、运行用户为 `lumenframe`、域名为
`example.com`，请按实际情况替换。

### 4.1 获取代码与安装依赖

```bash
sudo mkdir -p /opt/lumenframe
sudo chown -R $USER:$USER /opt/lumenframe
cd /opt/lumenframe
# git clone <your-repo> .   # 或直接上传代码

# 1) Node 后端依赖
cd server
npm ci --omit=dev
cp .env .env.bak 2>/dev/null || true
# 编辑 .env，至少填入 TMDB_API_KEY（见 3.1）
cd ..

# 2) Python 服务依赖
cd filmgrab-service
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cd ..

# 3) 构建前端静态文件
cd web
npm ci
npm run build          # 产物在 web/dist/
cd ..
```

### 4.2 配置常驻进程（systemd）

`/etc/systemd/system/lumenframe-server.service`：

```ini
[Unit]
Description=LUMENFRAME Node API (TMDB proxy)
After=network.target

[Service]
Type=simple
User=lumenframe
WorkingDirectory=/opt/lumenframe/server
ExecStart=/usr/bin/node index.js
EnvironmentFile=/opt/lumenframe/server/.env
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/lumenframe-filmgrab.service`：

```ini
[Unit]
Description=LUMENFRAME FilmGrab screenshot proxy
After=network.target

[Service]
Type=simple
User=lumenframe
WorkingDirectory=/opt/lumenframe/filmgrab-service
ExecStart=/opt/lumenframe/filmgrab-service/.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

> Python 服务仅个人/内网使用时也务必绑定 `127.0.0.1`（如上），不要直接暴露 8000。
> 受限网络在 service 中追加两行：
> `Environment=HTTP_PROXY=http://127.0.0.1:7890` 与 `HTTPS_PROXY=...`。

启用并启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now lumenframe-server lumenframe-filmgrab
sudo systemctl status lumenframe-server lumenframe-filmgrab
```

也可以用 PM2 替代 systemd：

```bash
pm2 start npm --name lumenframe-api --prefix /opt/lumenframe/server -- start
pm2 start /opt/lumenframe/filmgrab-service/.venv/bin/uvicorn --name lumenframe-filmgrab \
  --cwd /opt/lumenframe/filmgrab-service -- main:app --host 127.0.0.1 --port 8000
pm2 save && pm2 startup
```

### 4.3 配置 Nginx

`/etc/nginx/conf.d/lumenframe.conf`：

```nginx
server {
    listen 80;
    server_name example.com;

    root /opt/lumenframe/web/dist;
    index index.html;

    # Node 后端：/api/* 原样转发到 3001
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    # Python 剧照服务：/filmgrab/* -> 8000/api/*
    # 注意 proxy_pass 末尾的 / 会完成前缀替换
    location /filmgrab/ {
        proxy_pass http://127.0.0.1:8000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 60s;
    }

    # Vite 构建出的带哈希静态资源可永久强缓存
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    # 前端为单页应用，其余路径回退到 index.html
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

生效：`sudo nginx -t && sudo systemctl reload nginx`。

HTTPS 用 certbot 一键签发：`sudo certbot --nginx -d example.com`，证书续期由
certbot 定时器自动处理。

### 4.4 部署后验证

```bash
# Node 后端（应返回 JSON 海报列表）
curl -s http://127.0.0.1:3001/api/trending | head -c 200

# Python 服务（应返回 {"service":"filmgrab-proxy",...}）
curl -s http://127.0.0.1:8000/

# 经 Nginx 的同源链路
curl -s -o /dev/null -w "%{http_code}\n" https://example.com/
curl -s -o /dev/null -w "%{http_code}\n" https://example.com/api/trending
curl -s -o /dev/null -w "%{http_code}\n" "https://example.com/filmgrab/screenshots?movie=Dune&year=2021"
```

浏览器打开站点，打开一部电影的详情页，DevTools Network 中各请求应均为 200，
控制台无红色错误。

## 5. 混合部署：Linux 服务器（后端）+ GitHub Pages（前端）（推荐）

前端静态站免费托管在 GitHub Pages，两个后端服务跑在自己的 Linux 服务器上，
通过一个 HTTPS 子域名（如 `api.example.com`）对外。**功能完整保留**，
包括 FilmGrab 剧照（由你自己的服务器承担抓取，请知悉其禁止公开爬取的条款，
建议仅自用或加访问控制）。

```text
浏览器 ──> GitHub Pages  https://<user>.github.io/<repo>/   （前端静态文件）
            │  VITE_API_BASE / VITE_FILMGRAB_BASE 构建期注入
            ▼
         https://api.example.com  (Nginx + Let's Encrypt)
            ├── /api/      -> Node   127.0.0.1:3001
            └── /filmgrab/ -> Python 127.0.0.1:8000/api/
```

跨域由后端统一输出 `Access-Control-Allow-Origin: *` 处理，图片加载带
`crossOrigin="anonymous"`，Canvas 卡片导出不受污染。

### 5.1 服务器端：安装与常驻进程

依赖安装与两个 systemd 服务与第 4.1、4.2 节完全相同（Node 的 `.env` 必填
`TMDB_API_KEY`；服务器在国内则同时设置 `TMDB_PROXY` 与 Python 服务的
`HTTP_PROXY`/`HTTPS_PROXY`）。区别只有两点：

- 两个服务都只监听 `127.0.0.1`（systemd 示例中 Node 默认监听 3001 即只本机访问；
  确认没有把 3001/8000 加入防火墙放行）。
- 不需要在服务器上构建/托管 `web/dist`，Nginx 只做 API 反代。

### 5.2 Nginx：仅 API 的站点配置

`/etc/nginx/conf.d/lumenframe-api.conf`（把 `api.example.com` 换成你的域名，
该域名需已有 A 记录指向本服务器）：

```nginx
server {
    listen 80;
    server_name api.example.com;

    # Node 后端
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    # Python 剧照服务：/filmgrab/* -> 8000/api/*（末尾斜杠完成前缀替换）
    location /filmgrab/ {
        proxy_pass http://127.0.0.1:8000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 60s;
    }
}
```

`nginx -t && systemctl reload nginx` 后签发证书（certbot 会自动把上面的
80 配置改写为 443 并加跳转）：

```bash
sudo certbot --nginx -d api.example.com
```

> **HTTPS 是硬性要求**：GitHub Pages 只提供 HTTPS，浏览器会阻止 HTTPS 页面
> 访问 HTTP 接口（mixed content）。

本机验证：

```bash
curl -s https://api.example.com/api/trending | head -c 200
curl -s "https://api.example.com/filmgrab/screenshots?movie=Dune&year=2021" | head -c 200
curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: https://example.github.io" \
  https://api.example.com/api/trending   # 响应头应有 access-control-allow-origin: *
```

不打算启用剧照服务时：不启动 `lumenframe-filmgrab.service`、删掉 Nginx 的
`/filmgrab/` 段即可，前端对应区块会自动隐藏。

### 5.3 GitHub Pages：CI 变量与发布

1. 仓库 **Settings → Pages → Source** 选择 **GitHub Actions**。
2. **Settings → Secrets and variables → Actions → Variables** 新建：
   - `API_BASE`（必填）：`https://api.example.com`（末尾不带 `/`）
   - `FILMGRAB_BASE`（启用剧照时）：`https://api.example.com/filmgrab`；
     不启用则不建此变量
   - `BASE_PATH`（一般不建）：默认 `/<仓库名>/`；自定义 Pages 域名时设为 `/`
3. 推送 `main`/`master`，Actions 自动构建发布，地址形如
   `https://<user>.github.io/<repo>/`。

本地模拟该构建（PowerShell）：

```powershell
$env:BASE_PATH='/lumenframe/'
$env:VITE_API_BASE='https://api.example.com'
$env:VITE_FILMGRAB_BASE='https://api.example.com/filmgrab'
cd web; npm run build
```

### 5.4 功能边界与排错

| 功能 | 状态 |
| --- | --- |
| 搜索、详情、海报、评分、技术参数、卡片生成导出 | ✅ 完整可用 |
| Film Stills 剧照 | ✅（部署 Python 服务并配置 `FILMGRAB_BASE`；不配置则自动隐藏） |
| 费用 | 仅服务器费用；Pages 免费 |

常见问题：

- **接口被拦截 / Mixed Content**：API 必须是 HTTPS，且 `API_BASE` 写全 `https://`。
- **剧照请求 404**：Nginx 缺少 `/filmgrab/` 段或 Python 服务未启动；
  注意 `proxy_pass` 末尾的 `/` 不能少。
- **卡片导出空白**：剧照/海报必须经带 CORS 头的代理加载（代码已统一），
  Python 服务默认已开启 `Access-Control-Allow-Origin: *`。
- **子路径刷新 404**：这是 Pages 项目站的正常现象，本项目为单页无路由应用，
  始终从 `/<repo>/` 入口进入即可；资源路径由 `BASE_PATH` 保证正确。

## 6. 备选 Serverless 方案：Vercel + GitHub Pages

没有 Linux 服务器时的零成本替代。**架构变化**：前端与 API 不同源，
跨域由后端 CORS 头 + 图片 `crossOrigin="anonymous"` 处理；FilmGrab 剧照服务
不部署（Python 运行时与 `curl_cffi` 的 TLS 指纹模拟不适合 Vercel，且其本身
不允许公开爬取），前端在未配置该服务时**自动隐藏 Film Stills 区块**，不发任何请求。

### 6.1 已做的适配（无需再改代码）

- `server/index.js`：全局输出 `Access-Control-Allow-Origin: *`（接口均为只读 GET）；
  导出 Express app，检测到 Vercel 环境时不监听端口。
- `server/api/index.js` + `server/vercel.json`：Serverless 统一入口与 `/api/*` 路由重写。
- 评分/技术参数缓存：serverless 文件系统只读，自动改写 `/tmp`（实例回收后失效，
  功能不受影响，只是命中率下降）。
- 前端 `web/src/api.js`：`VITE_API_BASE` 构建期注入后端地址，所有 fetch 与图片
  URL 自动补全；海报 `<img>` 与 Canvas 加载均带 CORS 模式，保证卡片导出不被污染。
- `web/vite.config.js`：`BASE_PATH` 环境变量控制静态资源子路径。
- `.github/workflows/deploy-pages.yml`：推送即自动构建并发布到 GitHub Pages。

### 6.2 部署后端到 Vercel

1. 把仓库推送到 GitHub。
2. 在 [vercel.com](https://vercel.com) 用 GitHub 账号登录 → **Add New → Project** →
   导入该仓库。
3. **Root Directory 必须设置为 `server`**（Project Settings → General → Root Directory）。
   Framework Preset 选 **Other**，无需 Build Command，Output 留空。
4. Settings → Environment Variables 添加：
   - `TMDB_API_KEY` = 你的 TMDB Key（必填）
   - **不要**设置 `TMDB_PROXY`（Vercel 海外节点直连 TMDB）
5. Deploy。成功后得到地址，如 `https://lumenframe-api.vercel.app`。
6. 验证（路径带不带 /api 前缀均可，推荐带前缀的完整地址）：

   ```bash
   curl -s https://lumenframe-api.vercel.app/api/trending | head -c 200
   curl.exe -s -o NUL -D - "https://lumenframe-api.vercel.app/api/image?path=%2Fgaet1xQ2nxrG0V1Ep9T20ZMNEIC.jpg&s=w185" | findstr /i "access-control cache-control"
   ```

   响应头应包含 `Access-Control-Allow-Origin: *` 与 immutable 的 Cache-Control。

> Serverless 的注意事项：函数超时配置为 30 秒（`server/vercel.json`，
> Hobby 计划上限 60 秒），ShotOnWhat?/Metacritic 的首次抓取偶尔较慢，
> 冷启动超时后重试一次即可；评分/参数为空（200 `{found:false}`）是未收录的正常表现。
> Hobby 计划响应体上限 4.5MB，本应用用到的 w1280 以下图片均在范围内，
> 不要在公网版请求 `s=original` 大图。

### 6.3 部署前端到 GitHub Pages

1. 仓库 **Settings → Pages → Build and deployment → Source** 选择
   **GitHub Actions**（不要选 branch 模式）。
2. **Settings → Secrets and variables → Actions → Variables** 新建：
   - `API_BASE`（必填）= 上一步的 Vercel 地址，如 `https://lumenframe-api.vercel.app`
   - `BASE_PATH`（一般不用建）：工作流默认按仓库名推导 `/<仓库名>/`；
     仅当使用 `<用户名>.github.io` 主页仓库或自定义域名时设为 `/`。
   - `FILMGRAB_BASE`：不建即可（Film Stills 区块自动隐藏）。
3. 向 `main`/`master` 推送代码（或在 Actions 页手动触发
   “Deploy web to GitHub Pages”）。工作流自动安装依赖、注入变量、构建
   `web/dist` 并发布。
4. 发布成功后在 Pages 设置页得到地址，如 `https://<user>.github.io/<repo>/`。

本地可用以下命令模拟 CI 构建验证（PowerShell）：

```powershell
$env:BASE_PATH='/lumenframe/'
$env:VITE_API_BASE='https://lumenframe-api.vercel.app'
cd web; npm run build
# 检查 dist/index.html 中的资源路径是否为 /lumenframe/assets/...
```

### 6.4 该方案的功能边界

| 功能 | 是否可用 | 说明 |
| --- | --- | --- |
| 搜索、电影详情、海报/剧照浏览、卡片生成与导出 | ✅ | 全部正常，图片经 Vercel 函数代理，CORS 已配置 |
| IMDb / Metacritic 评分、ShotOnWhat? 技术参数 | ✅ | 冷启动稍慢；缓存随函数实例存活 |
| Film Stills（FilmGrab 剧照） | ❌ 自动隐藏 | 合规要求 + Python 运行时不适配；如需使用请改用第 5 节的 Linux 服务器方案并配置 `FILMGRAB_BASE` |
| 费用 | 0 | Vercel Hobby 与 GitHub Pages 均为免费额度，注意 TMDB 与函数调用频率限制 |

### 6.5 常见问题（Serverless 版）

- **页面打开空白、资源 404**：项目站点漏配子路径。确认仓库名与工作流推导的
  `BASE_PATH` 一致（Actions 构建日志会打印 `Using BASE_PATH=...`）；
  自定义域名则把 `BASE_PATH` 变量设为 `/` 后重新部署。
- **接口 404**：Vercel 的 Root Directory 没有设成 `server`，或没有把
  `vercel.json` 一起提交。
- **控制台 CORS 错误**：确认 Vercel 部署的是最新代码（含 CORS 中间件），
  且 `API_BASE` 末尾不要带 `/`、不要带 `/api` 后缀。
- **卡片导出图片空白/安全报错**：图片必须经带 CORS 头的 `/api/image` 代理加载
  （代码已统一），不要把图片地址改成直连 `image.tmdb.org`。

## 7. Windows 服务器部署

开发机/内网 Windows 环境可用「Nginx for Windows + NSSM 服务」组合：

1. Node 后端：安装 [NSSM](https://nssm.cc/)，将
   `nssm install LUMENFRAME-API "C:\Program Files\nodejs\node.exe" index.js`
   的启动目录设为 `server/`，AppEnvironment 里配置 `TMDB_API_KEY` /
   `TMDB_PROXY`（或直接使用 `npm start` 由其加载 `.env`：
   AppDirectory=`server`，Application=`cmd.exe`，参数 `/c npm start`）。
2. Python 服务：直接复用仓库自带的 `filmgrab-service/start.bat`（自动建虚拟环境、
   装依赖、探测 `127.0.0.1:7890` 代理）；用 NSSM 把
   `.venv\Scripts\python.exe main.py`（启动目录设为 `filmgrab-service/`）
   注册为 Windows 服务，注意它应只在内网监听。
3. Nginx：使用与 4.3 相同的 server 配置，`root` 指向
   `C:/lumenframe/web/dist`（路径用正斜杠），两条 `proxy_pass` 地址改为
   `http://127.0.0.1:3001` 与 `http://127.0.0.1:8000`。
4. Windows 防火墙只放行 80/443，不要放行 3001/8000。

## 8. 缓存策略与更新发布

各层缓存均为「内容不变即可长期缓存」的设计，日常更新无需手动清缓存：

| 缓存 | 位置 | 策略 |
| --- | --- | --- |
| TMDB 接口数据（search/movie/images/trending） | Node 内存 | 30 分钟 TTL，FIFO 上限 200，并发请求单飞去重 |
| 第三方评分 | `server/.cache/ratings/*.json` | 成功结果永久文件缓存；失败 10 分钟内存缓存 |
| ShotOnWhat? 技术参数 | `server/.cache/sow/*.json` | 成功结果永久文件缓存；失败 10 分钟内存缓存 |
| FilmGrab 截图列表 | Python 内存 | 6 小时，空结果不缓存，上限 200 |
| FilmGrab 图片二进制 | Python 内存 | 1 小时 LRU，上限 120 张，不落地磁盘 |
| TMDB 图片 | 浏览器 | `Cache-Control: public, max-age=604800, immutable`（路径为内容哈希） |

发布新版前端/后端的标准流程：

```bash
cd /opt/lumenframe
# git pull 或上传新代码
cd web && npm ci && npm run build && cd ..        # 前端必须重新构建
cd ../server && npm ci --omit=dev                 # 依赖有变化时
sudo systemctl restart lumenframe-server            # 后端代码更新后重启
sudo systemctl restart lumenframe-filmgrab          # 仅 Python 文件更新时需要
sudo nginx -s reload
```

只有在明确抓到错误的评分/参数数据需要强制刷新时，才删除
`server/.cache/ratings/<imdbId>.json` 或 `server/.cache/sow/<imdbId>.json`
对应文件；Python 内存缓存重启服务即清空。`.cache/` 已在 `.gitignore` 中。

## 9. 常见问题（自建部署）

| 现象 | 排查方向 |
| --- | --- |
| `/api/search`、`/api/trending` 返回 502 | 服务器无法访问 TMDB：检查 `server/.env` 的 `TMDB_PROXY`；`curl -I https://api.themoviedb.org/3` 验证网络 |
| 图片裂图、`/api/image` 偶发 502 | 到 `image.tmdb.org` 的链路抖动（服务端已内置一次重试）；检查代理稳定性 |
| Film Stills 区块一直 “Fetching stills…” | 8000 服务未启动，或 Nginx 缺少 `/filmgrab/` 段；`journalctl -u lumenframe-filmgrab -f` 看日志 |
| FilmGrab 返回 403 “Checking your browser” | `curl_cffi` 的 Chrome TLS 指纹模拟失效，升级 `curl_cffi`；或站点结构改版，按 `filmgrab_scraper.py` 顶部注释中的选择器检查 |
| 详情页技术参数/评分长期为空 | 属正常现象（ShotOnWhat?、Metacritic 未收录新片）；接口返回 200 `{found:false}` 即工作正常 |
| 改了前端代码页面没变化 | 生产环境必须重新 `npm run build`；Vite HMR 只存在于开发服务器 |
| 浏览器控制台出现旧 PWA / workbox 报错 | 本机浏览器在 localhost 上残留了**其他项目**的 Service Worker，与本项目无关；在 DevTools → Application → Service Workers 中 Unregister 并清空 Cache Storage |
