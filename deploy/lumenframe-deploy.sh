#!/usr/bin/env bash
# LUMENFRAME 后端自动部署（服务器主动拉模式）
#
# 由 lumenframe-deploy.timer 定时调用，有变化才动，没变化静默退出。
# 之所以不用 GitHub Actions 的 SSH 推送：本机安全组从未放行 22，
# 为了部署开一个 root SSH 到公网不划算，改用「服务器自己拉」。
#
# 状态文件记录的是「最后一次**成功**部署的 commit」，而不是拿 HEAD 比对：
# 否则一次失败的部署（依赖装不上、服务起不来）会让工作区停在新代码上，
# 下一轮就永远跳过、把坏版本一直留在服务器上。这里失败则不写状态，
# 下一轮自动重试。
set -euo pipefail

REPO=/root/lumenframe
BRANCH=main
STATE=/var/lib/lumenframe-deploy/last-deployed

log() { echo "[$(date '+%F %T')] $*"; }

cd "$REPO"

# 没有 TTY，一旦 git 想提示输入凭据就会挂住并占着这个 unit
export GIT_TERMINAL_PROMPT=0

# 国内连 GitHub 可能很慢；超时就让这一轮失败，下一轮重试，
# 不要卡在半途影响后续的 reset/重启
timeout 180 git fetch --prune origin "$BRANCH"
REMOTE=$(git rev-parse "origin/$BRANCH")
DEPLOYED=$(cat "$STATE" 2>/dev/null || echo none)

if [ "$REMOTE" = "$DEPLOYED" ]; then
  exit 0                     # 已是最新：每 2 分钟一次，不要刷日志
fi

log "发现新版本 ${DEPLOYED:0:7} → ${REMOTE:0:7}"

# 部署检出目录，与远端强制对齐。server/.env、server/.cache/、docs/ 都在
# .gitignore 里不受影响；但**在服务器上手工改过的被跟踪文件会被覆盖**。
git reset --hard "$REMOTE"

log "安装 Node 依赖"
(cd server && npm ci --omit=dev)

if [ -x filmgrab-service/.venv/bin/pip ]; then
  log "安装 Python 依赖"
  filmgrab-service/.venv/bin/pip install -q -r filmgrab-service/requirements.txt
else
  log "!! 未找到 filmgrab-service/.venv，跳过 Python 依赖（剧照服务可能起不来）"
fi

log "重启服务"
systemctl restart lumenframe-server lumenframe-filmgrab

# systemd Type=simple 在 fork 后就返回，此时端口未必已监听，轮询确认。
# curl 不带 -f：拿到任意 HTTP 响应（含 404）即说明端口活了。
wait_http() {
  for _ in $(seq 1 15); do
    if curl -s -o /dev/null --max-time 3 "$1"; then
      log "  ✓ $2 已响应"
      return 0
    fi
    sleep 2
  done
  log "  ✗ $2 在 30 秒内无响应"
  return 1
}
wait_http http://127.0.0.1:3002/ "Node API :3002"
wait_http http://127.0.0.1:8000/ "FilmGrab :8000"

# 健康检查全过了才记账；上面任何一步失败都会中断，状态保持旧值 → 下一轮重试
mkdir -p "$(dirname "$STATE")"
echo "$REMOTE" > "$STATE"
log "部署完成 ${REMOTE:0:7}"
