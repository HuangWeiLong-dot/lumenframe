import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // GitHub Pages 项目站点部署在 https://<user>.github.io/<repo>/ 子路径下，
  // CI 构建时通过 BASE_PATH=/<repo>/ 注入；本地开发与独立域名部署保持 '/'。
  base: process.env.BASE_PATH || '/',
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // 前端开发时把 /api 转发到 Node 后端（TMDB 数据）
      '/api': 'http://localhost:3001',
      // FilmGrab 截图服务（Python FastAPI，8000）：/filmgrab/* -> :8000/api/*
      '/filmgrab': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/filmgrab/, '/api'),
      },
    },
  },
})
