// 4kvms（下称 nb）的请求签名。
//
// 它家 /video/play 要四个参数 p(片集 id) v(secret) q(清晰度) k(访问令牌)，
// 外加一对 s(签名) t(毫秒时间戳)。签名算法**编译在它自己的 wasm 里**，不在 JS 里，
// 反推已排除（见 vendor/nbmovie/README.md），所以这里只负责把它加载起来并调用。
//
// 本模块只干签名这一件事；抓页面、拼请求都在 sources.js 里，为的是复用那边的
// httpGet —— 它走 node:http 而不是 fetch，能绕开 index.js 给 TMDB 设的全局
// ProxyAgent，并强制 IPv4。用 fetch 会把国内站拽进 TMDB 代理绕一圈。

import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const DIR = path.join(import.meta.dirname, 'vendor', 'nbmovie')
const GLUE = path.join(DIR, 'nbmovie_wasm.js')
const BIN = path.join(DIR, 'nbmovie_wasm_bg.wasm')

// 4k/720/480 都要门禁：4k 只有客户端能播（code 403），720/480 要 VIP（code 401）。
// 实测只有 1080 在 Web 上直接可用 —— 这也是站点自己的默认值。
export const QUALITY = '1080'

// vendor 里那两个文件是**随仓库分发**的（2026-09-20 起，理由见 .gitignore），
// 所以正常情况下它们一定在位。但检查不能省：手工搭的环境、或有人清理过 vendor，
// 这里必须是「缺席」而不是「报错」——与 sources.json 缺失时整个区块自隐藏同一个约定。
export function available() {
  return existsSync(GLUE) && existsSync(BIN)
}

let ready = null // Promise<module|null>，只初始化一次

function load() {
  if (ready) return ready
  ready = (async () => {
    if (!available()) return null
    // wasm 里有两处硬性的 DOM 读取：document.getElementById('nb-st'/'nb-plt')。
    // 读不到会抛 __wbindgen_throw，所以要给个桩。
    //
    // 返回 null 而不是伪造一个 {content}：那两个值**不进签名**（实测改它们 s 不变，
    // 见 vendor/nbmovie/README.md），wasm 拿不到就退回 Date.now()，而 Date.now()
    // 正是我们要的。伪造对象反而可能过不了 glue 里的 instanceof HTMLMetaElement 判定。
    //
    // 这是给**服务进程**装全局桩，注意副作用：此后进程里 typeof document 不再是
    // 'undefined'。本仓库没有别处靠这个判断环境（web/ 是另一套进程）。
    if (globalThis.document === undefined) {
      globalThis.document = { getElementById: () => null }
    }
    const mod = await import(pathToFileURL(GLUE).href)
    // initSync 收字节，不能用默认导出的异步 init()：那个默认走
    // new URL('nbmovie_wasm_bg.wasm', import.meta.url) 再交给 fetch()，
    // 而 Node 的 fetch 不认 file:// 。
    mod.initSync({ module: readFileSync(BIN) })
    return mod
  })().catch(() => null)
  return ready
}

// 返回形如 /video/play?p=…&v=…&q=…&s=…&t=…&k=… 的**相对路径**，调用方补站点前缀。
//
// usertoken 必须是**刚从播放页抓下来的** userlink（#navbar 的 Alpine x-data 里，
// 匿名访客也有）。它不进签名，但服务端会单独校验：传 '0' 会得到 401「请提供访问令牌」。
//
// t 由 wasm 每次调用现取 Date.now()，不会缓存 —— 所以长驻进程 init 一次就够，
// 不存在「跑久了签名过期」的问题。
export async function sign(dataid, secret, usertoken) {
  const mod = await load()
  if (!mod) return null
  try {
    return mod.build_play_url(String(dataid), String(secret), QUALITY, String(usertoken || '0'))
  } catch {
    return null
  }
}
