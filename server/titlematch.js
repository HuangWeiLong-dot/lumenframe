// TasteDive 只给片名，TMDB 文本搜索会把 "Seven" 匹配到 "7 Dogs" 之类的噪声。
// 用归一化 + 相似度评分筛选候选；评分不足时由调用方走 OMDB 精确匹配兜底。

const DIGIT_WORDS = {
  one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
}

export function normalizeTitle(s) {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // 去重音符号
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map((t) => DIGIT_WORDS[t] || t) // seven → 7，让 "se7en" 与 "seven" 归一一致
    .join(' ')
}

function levRatio(a, b) {
  const m = a.length
  const n = b.length
  if (!m || !n) return 0
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
    }
  }
  return 1 - dp[m][n] / Math.max(m, n)
}

// 返回 0~1：去空格串的编辑距离相似度 与 词元 Jaccard 取大值
export function titleScore(a, b) {
  const na = normalizeTitle(a)
  const nb = normalizeTitle(b)
  if (na === nb) return 1
  const lev = levRatio(na.replace(/ /g, ''), nb.replace(/ /g, ''))
  const ta = new Set(na.split(' ').filter(Boolean))
  const tb = new Set(nb.split(' ').filter(Boolean))
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  const union = ta.size + tb.size - inter
  const jac = union ? inter / union : 0
  return Math.max(lev, jac)
}
