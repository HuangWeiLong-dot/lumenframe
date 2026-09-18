// 只给 scripts/sim 用的构建配置：把同步层原样打成能在 node 里跑的 ESM。
// 与 vite.config.js 无关（那个是应用构建），产物在 scripts/sim/dist（已 gitignore）。
//
//   npm run sim       --prefix web   访客收藏 → 登录，验证双向并集
//   npm run sim:wipe  --prefix web   四种状态各跑一遍，看谁会把片库删掉
import { defineConfig } from 'vite'
import path from 'node:path'

const simDir = path.resolve(import.meta.dirname, 'scripts/sim')

export default defineConfig({
  plugins: [
    {
      name: 'sim-stub-supabase',
      enforce: 'pre',
      // 把 src/supabase.js 换成内存假客户端，顺带保证真 SDK 不会被 node 加载。
      // 必须返回正斜杠路径：rollup 用 id 字符串判重，Windows 反斜杠会把同一个文件
      // 当成两个模块，于是 run.js 里的假云端和 engine 用的假云端是两份内存表（实测：查出来 0 行）
      resolveId(source) {
        if (/(^|\/)supabase(\.js)?$/.test(source)) {
          return path.join(simDir, 'stub-supabase.js').split(path.sep).join('/')
        }
        return null
      },
    },
  ],
  ssr: {
    // 把 react 一起打进产物：node 直接跑，不依赖运行期的解析规则
    noExternal: true,
  },
  build: {
    ssr: true,
    outDir: path.join(simDir, 'dist'),
    emptyOutDir: true,
    minify: false,
    target: 'node20',
    rollupOptions: {
      input: path.join(simDir, 'run.js'),
      output: { entryFileNames: 'run.mjs', format: 'es' },
    },
  },
})
