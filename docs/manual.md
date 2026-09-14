# LUMENFRAME 启动手册（本地开发）

在项目根目录 `lumenframe/` 下分别启动以下三个服务（各开一个终端）。
生产环境部署请见 [deploy.md](./deploy.md)；FilmGrab 服务的接口细节见
[filmgrab-service.md](./filmgrab-service.md)。

## 1. Node 后端（TMDB 数据，端口 3001）

```bash
npm run dev --prefix server
```

## 2. 前端 Vite（端口 5173）

```bash
npm run dev --prefix web
```

## 3. FilmGrab 截图代理（Python FastAPI，端口 8000）

**最简单的方式：直接双击** `filmgrab-service/start.bat`。

或在 PowerShell 中运行（首次会自动创建虚拟环境并安装依赖）：

```powershell
.\filmgrab-service\start.ps1
```

脚本会自动探测本地代理 `127.0.0.1:7890`：检测到则走代理，未检测到则直连，无需手动设置环境变量。

### 手动启动方式（备用）

注意 PowerShell 的环境变量语法必须带 `$` 前缀（写成 `$env:`，不是 `env:`）：

```powershell
cd filmgrab-service
python -m venv .venv                      # 仅首次
.\.venv\Scripts\python.exe -m pip install -r requirements.txt   # 仅首次
$env:HTTPS_PROXY="http://127.0.0.1:7890"  # 仅国内网络需要；海外服务器省略这两行
$env:HTTP_PROXY="http://127.0.0.1:7890"
.\.venv\Scripts\python.exe main.py
```

启动成功标志：终端输出 `Uvicorn running on http://0.0.0.0:8000`，
接口文档见 http://localhost:8000/docs 。
