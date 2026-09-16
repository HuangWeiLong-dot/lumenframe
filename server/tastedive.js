// TasteDive 相似推荐 API
// 文档：https://tastedive.com/api/
// 免费：300 次/小时（未认证），有 key 时 25000 次/月
// 注意：TasteDive 被 Cloudflare 保护，Node undici 常因 TLS/JA3 指纹被 403，
// 系统 curl（Windows Schannel / Linux OpenSSL）能直连，所以失败时降级到 curl。

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const TASTEDRIVE_URL = 'https://tastedive.com/api/similar'

export async function tastediveSimilar(title, apiKey, limit = 12, type = 'movie') {
  const url = new URL(TASTEDRIVE_URL)
  url.searchParams.set('q', `${type}:${title}`)
  url.searchParams.set('type', type)
  url.searchParams.set('limit', String(limit))
  if (apiKey) url.searchParams.set('k', apiKey)

  // 1) 先试 Node fetch
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Lumenframe/1.0 (similar recommendations)' },
    })
    if (res.ok) return await res.json()
    // 403 / 429 走 curl 兜底
  } catch {
    // 网络错误，继续 curl
  }

  // 2) 降级到系统 curl（Cloudflare 指纹可过）
  try {
    const { stdout } = await execFileAsync(
      'curl',
      ['-s', '-L', '--max-time', '15', url.toString()],
      { maxBuffer: 1024 * 1024 }
    )
    if (stdout) return JSON.parse(stdout)
  } catch {
    // curl 也失败，抛出让上层处理
  }

  throw new Error('TasteDive request failed')
}
