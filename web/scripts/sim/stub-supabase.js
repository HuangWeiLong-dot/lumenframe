// 假 supabase 客户端：只实现 engine 用到的那点 PostgREST 链式查询 + auth 事件。
// 内存表就是「云端」，断言直接读它。vite.sim.config.js 把 src/supabase.js 别名到本文件。

export const SIM_USER_ID = 'user-A'

const tables = { library_items: [] }

const clone = (v) => JSON.parse(JSON.stringify(v))

const dbg = (...a) => { if (process.env.SIM_DEBUG) console.log('   [db]', ...a) }

let upsertCalls = 0 // 推送尝试次数：重试场景靠它证明「退避期间没有密集重试」
let failNextUpserts = 0 // > 0 时接下来的若干次 upsert 直接返回错误（模拟网络/RLS 失败）

class Query {
  constructor(rows) { this.rows = rows }
  select() { return this }
  eq(col, val) {
    this.rows = this.rows.filter((r) => r[col] === val)
    dbg(`eq(${col}, ${val}) -> ${this.rows.length} 行`)
    return this
  }
  order(col, opts = {}) {
    const dir = opts.ascending === false ? -1 : 1
    this.rows = [...this.rows].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * dir)
    return this
  }
  range(from, to) { this.rows = this.rows.slice(from, to + 1); dbg(`range(${from},${to}) -> ${this.rows.length} 行`); return this }
  // 让 await 直接拿到 { data, error }，与 supabase-js 的 thenable 行为一致
  then(resolve, reject) {
    dbg(`await 查询 -> ${this.rows.length} 行`)
    return Promise.resolve({ data: this.rows.map(clone), error: null }).then(resolve, reject)
  }
  upsert(rows, onConflict) {
    upsertCalls++
    if (failNextUpserts > 0) {
      failNextUpserts--
      dbg(`upsert 第 ${upsertCalls} 次：按注入设置失败`)
      return Promise.resolve({ error: { message: 'simulated push failure' } })
    }
    if (process.env.SIM_DEBUG) console.log(`   [db] upsert ${rows.length} 行: ${rows.map((r) => `${r.list_name}:${r.kind}:${r.item_id}`).join(', ')}`)
    // supabase-js 的签名是 upsert(rows, { onConflict: 'a,b,c' })
    const spec = typeof onConflict === 'object' && onConflict ? onConflict.onConflict : onConflict
    const keys = String(spec || '').split(',').map((s) => s.trim()).filter(Boolean)
    if (!keys.length) throw new Error('sim upsert 缺少 onConflict')
    for (const row of rows) {
      const i = tables.library_items.findIndex((r) => keys.every((k) => r[k] === row[k]))
      if (i >= 0) tables.library_items[i] = clone(row)
      else tables.library_items.push(clone(row))
    }
    return Promise.resolve({ error: null })
  }
}

let session = null
const authCallbacks = []

const client = {
  from(name) {
    if (process.env.SIM_DEBUG) console.log(`   [db] from(${name})`)
    return new Query(tables[name] ?? [])
  },
  auth: {
    onAuthStateChange(cb) {
      authCallbacks.push(cb)
      return { data: { subscription: { unsubscribe() {} } } }
    },
    async getSession() { return { data: { session } } },
    async signInWithPassword({ email }) {
      session = { user: { id: SIM_USER_ID, email, user_metadata: {} } }
      // supabase-js 在 auth 锁内通知；store 的 handler 自己 setTimeout 出锁（见 initAuth）
      queueMicrotask(() => authCallbacks.forEach((cb) => cb('SIGNED_IN', session)))
      return { data: { session }, error: null }
    },
    async signUp() { return { data: { session: null }, error: null } },
    async signOut() { session = null; return { error: null } },
    async updateUser() { return { data: {}, error: null } },
    async resetPasswordForEmail() { return { error: null } },
  },
}

export const isSupabaseConfigured = true
export function authRedirectUrl() { return 'https://sim.test/' }
export async function getSupabase() { return client }

export const sim = {
  seed(rows) { tables.library_items = rows.map(clone) },
  all: () => tables.library_items.map(clone),
  live: () => tables.library_items.filter((r) => r.deleted_at == null).map(clone),
  tombstones: () => tables.library_items.filter((r) => r.deleted_at != null).map(clone),
  reset() { tables.library_items = [] },
  // 重试场景用：让接下来 n 次 upsert 失败；查推送尝试过几次
  failNextUpserts(n) { failNextUpserts = n },
  upserts: () => upsertCalls,
  resetUpserts() { upsertCalls = 0 },
}
