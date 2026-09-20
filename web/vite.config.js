import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 首页数据预取（内联进 <head>，见下面 homePrefetch）：
// 为什么必须内联、必须在这个位置 ——
//   首页的海报网格要等 /api/trending，而它原先由 React 挂载后的 effect 发起，
//   得先等 200+ KB 主包下载并执行完。Lighthouse 实测这段「资源发现延迟」占 LCP 的 1,720ms，
//   是 LCP 10.1s 里最大的一块。
//   内联脚本在解析 <head> 时同步执行，比任何外部资源都早；写成独立 module 入口则要么多一个
//   请求，要么被 Rollup 内联进主包（失去意义），所以直接在构建期注入代码。
// API_BASE 在构建期解析成字面量：本地开发为空（同源，走 server.proxy 转发），
// 生产由 CI 注入 VITE_API_BASE=https://api.lumenframe.cc。
function homePrefetch(apiBase) {
  const code = `
;(function () {
  var BASE = ${JSON.stringify(apiBase)};
  // 跨域部署时 API 与站点不同源，首个请求要付 DNS + TCP + TLS（实测 380ms），提前建连。
  if (BASE) {
    var l = document.createElement('link');
    l.rel = 'preconnect';
    l.href = BASE;
    l.crossOrigin = '';
    document.head.appendChild(l);
  }
  // 失败解析为 null（而非 []）：useTrending 只在拿到数组时才写模块级缓存，
  // null 表示这次没成功，之后再挂载还能重试一次。
  window.__lfTrending = fetch(BASE + '/api/trending')
    .then(function (r) { return r.json() })
    .then(function (d) { return d.posters || [] })
    .catch(function () { return null });
})();
`
  return {
    name: 'lumenframe-home-prefetch',
    transformIndexHtml: {
      // 'head' = 追加到 </head> 之前。不能放 body：要在主包被发现前就发出请求。
      order: 'pre',
      handler: (html) => ({
        html,
        tags: [{ tag: 'script', injectTo: 'head', children: code }],
      }),
    },
  }
}

export default defineConfig(({ mode }) => {
  // 第三个参数传 '' 才会读到非 VITE_ 前缀的变量（这里顺便把 process.env 一并纳入，
  // 因为 CI 是直接把这些变量放在构建步骤的 env: 里的）。
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }

  return {
    // CI 构建时通过 BASE_PATH 注入，**必须是绝对路径**：
    //   '/'        顶点自定义域名（当前线上就是它）
    //   '/<repo>/' GitHub Pages 项目子路径
    // 不能用相对 './' —— 深链会白屏（首页却正常，所以极易漏掉）。机理写在
    // deploy-pages.yml 的 BASE_PATH 那段：index.html 的 <head> 内联脚本会在
    // body 解析前把 URL replaceState 回深链，相对 src 便按新文档 URL 解析。
    // 运行时真正的根由 src/spaUrl.js 的 getBasePath() 从 location 反推，不依赖这里。
    // 本地开发不传，落到 '/'。
    base: env.BASE_PATH || '/',
    plugins: [react(), tailwindcss(), homePrefetch(env.VITE_API_BASE || '')],
    server: {
      proxy: {
        // 前端开发时把 /api 转发到 Node 后端（TMDB 数据）
        '/api': 'http://localhost:3002',
        // FilmGrab 截图服务（Python FastAPI，8000）：/filmgrab/* -> :8000/api/*
        '/filmgrab': {
          target: 'http://localhost:8000',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/filmgrab/, '/api'),
        },
      },
    },
  }
})
