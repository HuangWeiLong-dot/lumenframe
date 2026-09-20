// 描述归一：把各站**自己手填的** type_name / vod_remarks 收进一套固定说法。
//
// 为什么需要：采集站的这两个字段是每站各写各的。同一部片在 A 站是「科幻片 / HD」、
// B 站是「科幻 / 正片」、C 站是「科幻剧 / HD中字|国语」—— 并排成列表时，用户看到的是
// 三种说法在描述同一件事，而真正该拿来比的东西（有几条线路、是不是完整版）被噪声盖住了。
//
// 三条原则，改这个文件之前先读：
//
//   1. **只归写法，不归事实。** 「更新至 39 集」和「完结」归一之后仍然不同 —— 一条还差
//      一集，抹平了才是骗人。归一只负责让**同一个事实**在不同站上读起来一样
//      （更新39集 / 更新至第39集 / 第39集 → 更新至 39 集）。
//
//   2. **remarks 挤在两个轴上**：状态（正片 / 完结 / 更新至 N 集）与画质语言
//      （HD 国语中字）。源站把它们写在同一个字段里，这里拆成两段给前端分开显示。
//      电影的「HD」等价于正片（都表示「完整片子，没有额外说明」），所以只认出画质、
//      没认出状态时，**电影**补一个正片；**剧集不补** —— 剧集的 HD 只是画质标注，
//      补成「正片」会把「更新至 12 集」说成完整版。
//
//   3. **认不出来就原样留着。** 「AI漫剧」「穿越年代」这类站点自造的分类照原样显示，
//      猜错比不归更糟。这也是本模块不拿 TMDB 类型兜底的原因：那需要详情页的上下文，
//      而这里是搜索层，一部片的全部信息就是源站回给我们的这一行。
//
// 纯函数，无 IO，可离线验证（风格同 nbparse.js）。

// ---------- 类型 ----------

// 剧集类的统一说法。判「是不是剧」要用到它（见文件头第 2 条）。
const SERIES_TYPES = new Set([
  '国产剧',
  '港台剧',
  '日韩剧',
  '欧美剧',
  '其他剧',
  '电视剧',
  '综艺',
  '动漫',
])

// 顺序即优先级，而且**必须先剧后影**：站点里「动画片」是电影分类、「动漫 / 国产动漫」
// 是剧集分类，两者都含一个「动」字 —— 动漫|漫剧 排在 动画 后面的话，
// 「国产动漫」会先被动画那条吃掉，变成「动画片」。
const TYPE_RULES = [
  // —— 剧集 ——
  [/国产剧|大陆剧|内地剧|大陆电视剧/, '国产剧'],
  [/港台剧|港剧|台剧|香港剧|台湾剧/, '港台剧'],
  [/日韩剧|日剧|韩剧|日本剧|韩国剧/, '日韩剧'],
  [/欧美剧|美剧|英剧|海外剧/, '欧美剧'],
  [/泰剧|新马剧|其他剧|其它剧/, '其他剧'],
  [/连续剧|电视剧|短剧/, '电视剧'],
  [/综艺|真人秀|脱口秀|晚会/, '综艺'],
  [/动漫|番剧|漫剧/, '动漫'],
  // —— 电影 ——
  [/动画|卡通/, '动画片'],
  [/动作|枪战|武侠|功夫|格斗|警匪/, '动作片'],
  [/喜剧|搞笑/, '喜剧片'],
  [/爱情|浪漫|言情|情感/, '爱情片'],
  [/科幻/, '科幻片'],
  [/奇幻|魔幻|玄幻/, '奇幻片'],
  [/恐怖|惊悚|灵异|僵尸|丧尸/, '恐怖片'],
  [/悬疑|推理|罪案|破案/, '悬疑片'],
  [/犯罪/, '犯罪片'],
  [/战争|军事|抗战/, '战争片'],
  [/历史|传记|古装|年代/, '历史片'],
  [/冒险|探险|寻宝/, '冒险片'],
  [/灾难/, '灾难片'],
  [/纪录|纪实/, '纪录片'],
  [/运动|体育/, '运动片'],
  [/音乐|歌舞/, '音乐片'],
  [/儿童|亲子|家庭/, '家庭片'],
  [/剧情|文艺|伦理/, '剧情片'],
]

// 这几个值本身不携带信息（各站的「未分类」桶）。归成空串比原样显示干净：
// 卡片上宁可少一个词，也不要「其他」这种说了等于没说的东西。
const TYPE_BLANK = /^(?:电影|影片|片|视频|剧集|其他|其它|全部|未知|未分类|未录入)$/

export function normType(raw) {
  const s = String(raw || '').trim()
  if (!s || TYPE_BLANK.test(s)) return ''
  for (const [re, label] of TYPE_RULES) if (re.test(s)) return label
  return s // 见文件头第 3 条
}

// ---------- 状态：正片 / 完结 / 更新至 N 集 ----------

// 只认**整条** token 是状态的写法。剩下的（画质、语言、混合）走 peel 去剥。
function normStatus(tok) {
  if (/^(?:已?完结|全集完结|全剧完结|完结篇|剧终|全集)$/.test(tok)) return '完结'
  // 「40集全」和「全40集」是同一个意思：已经出全了
  if (/^\d+集全$/.test(tok) || /^全\d+集$/.test(tok)) return '完结'
  // 更新至第39集 / 更新39集 / 第03集 —— 站点用哪个写法全看站长，数字才是信息。
  // Number() 顺手把「第03集」的前导零去掉。
  const up = /^(?:已?更新至?|更至)?第?(\d+)集$/.exec(tok)
  if (up) return `更新至 ${Number(up[1])} 集`
  if (/^(?:正片|完整版|高清正片|电影版)$/.test(tok)) return '正片'
  if (/^(?:抢先版|抢先|枪版|ts|tc|hdts|cam)$/i.test(tok)) return '抢先版'
  if (/^(?:连载中|更新中|未完结)$/.test(tok)) return '连载中'
  if (/^(?:预告|预告片|花絮|片段)$/.test(tok)) return '预告'
  return ''
}

// ---------- 画质与语言 ----------

// 数组顺序**就是**输出顺序，不是备查表。这一点是归一的必要条件：站点写
// 「HD中字|国语」和「HD国语中字」是同一个事实的两种写法，剥出来必须排成同一串，
// 按出现顺序拼的话两者会不一样 —— 那归一就白做了。
const QUALITY_RULES = [
  [/2160p?|4k|uhd/i, '4K'],
  [/1080p?|fhd/i, '1080P'],
  [/720p?/i, '720P'],
  [/蓝光|blu-?ray|bdrip|bd版/i, '蓝光'],
  [/超清|高清|hd/i, 'HD'],
]

const LANG_RULES = [
  [/国语|普通话|中配/, '国语'],
  [/粤语|广东话|港配/, '粤语'],
  [/双语/, '双语'],
  [/英语|原声|原版/, '原声'],
  [/中字|中文字幕|中英|双字|简中|繁中|简体|繁体/, '中字'],
]

// 和画质挤在同一个 token 里的状态词（「HD正片」「高清完结」）。整条 token 级的判定
// 已经由 normStatus 做过了，这里只负责把它们从 token 里剥掉，好让剩下的部分能对上。
const STATUS_INLINE = [
  [/正片|完整版/, '正片'],
  [/已?完结|全集完结/, '完结'],
  [/抢先版|枪版/, '抢先版'],
]

// 三张表 + 各自落进哪个桶，合成一张待剥表
const PEEL_RULES = [
  ...STATUS_INLINE.map(([re, label]) => [re, label, 'stats']),
  ...QUALITY_RULES.map(([re, label]) => [re, label, 'quals']),
  ...LANG_RULES.map(([re, label]) => [re, label, 'langs']),
]

// 把一个 token 里认识的词全剥下来。rest 为空才说明整条 token 都解释清楚了。
//
// 循环而不是单趟：剥掉一个词可能让另一个词露出来（「中英双字」先剥「中英」、再剥「双字」）。
// 这几条正则都不匹配空串，所以循环一定会停。
function peel(tok) {
  let rest = tok
  const buckets = { stats: new Set(), quals: new Set(), langs: new Set() }
  let changed = true
  while (changed) {
    changed = false
    for (const [re, label, bucket] of PEEL_RULES) {
      if (!re.test(rest)) continue
      rest = rest.replace(re, '') // 非全局正则只删第一处，剩下的交给下一轮
      buckets[bucket].add(label)
      changed = true
    }
  }
  // 剥剩的只可能是分隔符和空格，去掉它们再看还剩没剩东西
  return { ...buckets, rest: rest.replace(/[\s·・\-_+.]+/g, '') }
}

// 站点把两个轴挤在一个字段里，分隔符还很杂（| ｜ / 、 , ， ; + & 空格）
const TOKEN_SEP = /[|｜/、,，;；+&\s]+/

// raw 是 vod_remarks 原文，rawType 是 vod_type_name 原文（只用来判「是不是剧」）。
// 返回 { status, quality }，两段都可能为空串。
export function normRemarks(raw, rawType) {
  const s = String(raw || '').trim()
  if (!s) return { status: '', quality: '' }
  const series = SERIES_TYPES.has(normType(rawType))

  const stats = new Set()
  const quals = new Set()
  const langs = new Set()
  const unknown = []

  for (const tok of s.split(TOKEN_SEP).filter(Boolean)) {
    const whole = normStatus(tok)
    if (whole) {
      stats.add(whole)
      continue
    }
    const { stats: st, quals: q, langs: l, rest } = peel(tok)
    // 剥不干净的整条照原样留着：宁可多显示一个看不懂的词，也不要把它拆成
    // 半截正确半截错误的样子（见文件头第 3 条）
    if (rest) {
      unknown.push(tok)
      continue
    }
    for (const x of st) stats.add(x)
    for (const x of q) quals.add(x)
    for (const x of l) langs.add(x)
  }

  // 顺序由规则表决定，不由出现顺序决定（见 QUALITY_RULES 上方的说明）
  const quality = [
    ...QUALITY_RULES.map((r) => r[1]).filter((x) => quals.has(x)),
    ...LANG_RULES.map((r) => r[1]).filter((x) => langs.has(x)),
    ...unknown,
  ]

  let status = [...stats].join(' ')
  // 电影只认出画质时补「正片」：这些站的 HD/HD中字 说的就是「完整片子」，
  // 不补的话同一部片在这家显示「HD」、在那家显示「正片」，正是要消掉的那种差异。
  if (!status && !series && (quals.size > 0 || langs.size > 0)) status = '正片'

  return { status, quality: quality.join(' ') }
}
