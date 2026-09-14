// Vercel Serverless 统一入口：把所有 /api/* 请求交给同一个 Express app 处理
// （配合 vercel.json 的 rewrites；Express 收到的仍是原始路径）。
// 环境变量在 Vercel 项目 Settings → Environment Variables 中配置（TMDB_API_KEY 等），
// 不要依赖本地 .env 文件。
import app from '../index.js'

export default app
