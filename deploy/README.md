# 后端自动部署（服务器主动拉）

服务器每 2 分钟检查一次 `origin/main`，有新 commit 就 `git reset --hard`、装依赖、
重启两个 systemd 服务，并轮询端口确认起来了；没变化就静默退出。

**不用开任何入站端口，也不用 GitHub Secrets。** 之所以不用 SSH 推送：本机安全组
从未放行 22，为了部署开一个 root SSH 到公网不划算；而且国内服务器主动连 GitHub
比让海外 runner 连进来更稳。

## 安装（在服务器上执行一次）

```bash
cd /root/lumenframe
git pull                                   # 先拿到 deploy/ 目录

install -m 0644 deploy/lumenframe-deploy.service /etc/systemd/system/
install -m 0644 deploy/lumenframe-deploy.timer   /etc/systemd/system/
mkdir -p /var/lib/lumenframe-deploy         # 存「最后成功部署的 commit」

systemctl daemon-reload
systemctl enable --now lumenframe-deploy.timer
```

装之前先确认两件事：

```bash
git -C /root/lumenframe status             # 有手工改过的被跟踪文件吗？reset --hard 会覆盖
git -C /root/lumenframe ls-remote origin HEAD   # 能连上 GitHub 吗？卡住/超时就是网络问题
which node npm curl                        # 三个都应有输出（node 不在 /usr/bin 时见下）
```

依赖：`git`、`node`/`npm`、`curl`。**若 node 是 nvm 装的**，`lumenframe-deploy.service`
里那行注释掉的 `Environment=PATH=...` 要按实际路径填上并在 `systemctl daemon-reload` 后生效——
systemd 不会加载你的 shell profile，PATH 里没有 nvm 的目录。

## 查看 / 手动触发

```bash
systemctl start lumenframe-deploy.service      # 立即跑一次（首次安装后建议手动跑，看输出）
systemctl list-timers lumenframe-deploy.timer  # 下次触发时间
journalctl -u lumenframe-deploy -n 50 --no-pager
```

带 `-f` 就是实时跟随。第一次运行时状态文件还不存在，所以会完整走一遍部署流程
（装依赖 + 重启服务），这是预期行为。

## 行为说明

- **失败会自动重试**：状态文件只在依赖安装、服务重启、端口探测全部通过后才更新。
  某次部署失败（比如依赖装不上）不会写入状态，2 分钟后自动重试，而不是把坏版本留在服务器上。
- **失败时服务仍是旧版本**：`systemctl restart` 之前就中断的话，跑着的还是原来的进程；
  但工作区已经是新代码——此时 `git log --oneline -1` 与 `journalctl` 能看出来。
- **`.env` 不会被覆盖**：`server/.env`、`server/.cache/`、`docs/` 都在 `.gitignore` 里，
  `git reset --hard` 不碰它们。**但手工改过的被跟踪文件会丢**——要改代码请在本地改完推上来。
- **不再需要 SSH Secrets**：仓库里 `SERVER_IP` / `SERVER_USER` / `SSH_PRIVATE_KEY` 可以删掉了。
