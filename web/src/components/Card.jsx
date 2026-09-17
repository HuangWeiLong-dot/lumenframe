// 卡片渲染：Canvas 直接绘制，预览与导出完全一致
import { forwardRef, useEffect, useRef } from 'react'
import {
  fillRoundRect, drawText, drawImageCover,
  linearGradient, drawRatings, isDark, mcColor, personalColor, rtColor, popcornColor, wrapText,
} from './canvas-utils'
import { posterFor } from '../api'

const FONTS = {
  sans: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"Courier New", Courier, monospace',
}

const P = 56

const ALL_SIZES = ['1:1', '4:5', '4:3', '16:9', '9:16']
const NO_TALL = ['1:1', '4:5', '4:3', '16:9']

const TEMPLATES = {
  minimal: { bg: '#131313', ink: '#FAFAFA', accent: '#FAFAFA', font: 'sans', panelBg: 'rgba(255,255,255,0.05)', panelBorder: 'rgba(255,255,255,0.16)', sizes: ALL_SIZES },
  magazine: { bg: '#0E0E10', ink: '#FFFFFF', accent: '#FFFFFF', font: 'sans', panelBg: 'rgba(255,255,255,0.08)', panelBorder: 'rgba(255,255,255,0.22)', sizes: ALL_SIZES },
  noir: { bg: '#000000', ink: '#FFFFFF', accent: '#FFFFFF', font: 'sans', panelBg: 'rgba(255,255,255,0.06)', panelBorder: 'rgba(255,255,255,0.30)', sizes: NO_TALL },
  ratings: { bg: '#0D0D0F', ink: '#FFFFFF', accent: '#F5C518', font: 'sans', panelBg: 'rgba(255,255,255,0.06)', panelBorder: 'rgba(255,255,255,0.2)', sizes: ALL_SIZES },
  info: { bg: '#0A0A0C', ink: '#FFFFFF', accent: '#F5C518', font: 'sans', panelBg: 'rgba(255,255,255,0.06)', panelBorder: 'rgba(255,255,255,0.2)', sizes: ALL_SIZES },
}

export const TEMPLATE_LIST = Object.entries(TEMPLATES).map(([id, t]) => ({
  id, label: id[0].toUpperCase() + id.slice(1), bg: t.bg, sizes: t.sizes,
}))

// ============ 内容数据构建 ============
function buildCreditsRows(movie, cfg) {
  const c = movie.credits
  if (!c) return []
  const rows = []
  if (cfg.showDirector && c.director) rows.push(['Director', c.director])
  if (cfg.showWriter && c.writers?.length) rows.push(['Writer', c.writers.join(', ')])
  if (cfg.showDop && c.dop) rows.push(['Cinematography', c.dop])
  if (cfg.showCast && c.cast?.length) rows.push(['Starring', c.cast.map((p) => p.name).join(', ')])
  return rows
}

function buildSpecsRows(specs, cfg) {
  if (!cfg.showSpecs || !specs || specs.found === false) return []
  const rows = []
  if (specs.cameras?.length) rows.push(['Camera', specs.cameras.join(', ')])
  if (specs.lenses?.length) rows.push(['Lenses', specs.lenses.slice(0, 4).join(', ')])
  if (specs.aspectRatios?.length) rows.push(['Aspect Ratio', specs.aspectRatios.slice(0, 3).join(', ')])
  if (specs.negativeStocks?.length) rows.push(['Negative', specs.negativeStocks.slice(0, 2).join(', ')])
  if (specs.processes?.length) rows.push(['Process', specs.processes.slice(0, 2).join(', ')])
  return rows
}

// 剧集事实行（替代电影的 tech specs）：年份/状态、季集数、电视网
function buildShowRows(movie, cfg) {
  if (movie?.kind !== 'tv') return null
  const rows = []
  if (cfg.showShowYears && movie.yearRange) rows.push(['Years', movie.yearRange])
  if (cfg.showShowSeasons && movie.seasonsCount != null) {
    const n = movie.seasonsCount
    const eps = movie.episodesCount != null ? ` · ${movie.episodesCount} Episodes` : ''
    rows.push(['Seasons', `${n} Season${n === 1 ? '' : 's'}${eps}`])
  }
  if (cfg.showShowNetwork && movie.network) rows.push(['Network', movie.network])
  if (cfg.showShowStatus && movie.status) rows.push(['Status', movie.status])
  return rows
}

// 信息列表统一入口：剧集走事实行，电影走 tech specs
function buildFactRows(movie, specs, cfg) {
  return buildShowRows(movie, cfg) || buildSpecsRows(specs, cfg)
}

// 根据 cfg.textAlign 计算文本面板与海报的相对位置（横版用，竖版直接取默认值）
// textAlign: 'left' | 'center' | 'right'
//   - landscape 'right': 文字在左，海报在右
//   - landscape 'left'/'center': 默认，文字在右，海报在左
//   - portrait: tx=P, tw=W-P*2；海报位置由各 drawer 自己决定
function resolveLayout(W, H, landscape, textAlign, opts = {}) {
  const { posterFrac = 0.38, gap = 44, PAD = 56 } = opts
  if (!landscape) return { tx: PAD, tw: W - PAD * 2, posterX: PAD, posterW: W * posterFrac }
  const pw = W * posterFrac
  if (textAlign === 'right') {
    const tw = W - pw - gap - PAD * 2
    return { tx: PAD, tw, posterX: W - pw - PAD, posterW: pw }
  }
  const tx = PAD + pw + gap
  const tw = W - tx - PAD
  return { tx, tw, posterX: PAD, posterW: pw }
}

// 根据 align 计算 drawText/drawTitle 的 x 坐标
// drawText 内部用 ctx.textAlign：left 时 x=左边缘，center 时 x=中心，right 时 x=右边缘
function alignX(align, left, width) {
  if (align === 'right') return left + width
  if (align === 'center') return left + width / 2
  return left
}

// 绘制 InfoList（label: value 行）—— 标签与值基线对齐，支持 maxY 边界
function drawInfoList(ctx, x, y, maxWidth, rows, opts = {}) {
  const { fs = 1, labelSize = 15, valueSize = 21, rowGap = 11, labelColor, valueColor, fontFamily = 'sans-serif', align = 'left', labelOpacity = 0.5, valueOpacity = 1, maxY = Infinity, measureOnly = false } = opts
  const labelFontSize = labelSize * fs
  const valueFontSize = valueSize * fs
  let cy = y
  for (const [label, value] of rows) {
    if (cy > maxY) break
    const labelW = 14.5 * labelFontSize
    const baseline = cy + Math.max(labelFontSize, valueFontSize) * 0.8
    if (align === 'center') {
      // 居中堆叠：label 在上，value 在下
      const labelBaseline = cy + labelFontSize * 0.8
      const valueStartY = cy + labelFontSize * 1.25
      const firstValueY = valueStartY + valueFontSize * 0.8
      // 值的第一行都放不下时整行跳过，避免只留下一个标签
      if (firstValueY > maxY) break
      if (!measureOnly) drawText(ctx, label, x + maxWidth / 2, labelBaseline, maxWidth, { fontSize: labelFontSize, color: labelColor, fontFamily, opacity: labelOpacity, letterSpacing: 0.22 * labelFontSize, transform: 'uppercase', align: 'center', baseline: 'alphabetic' })
      const { lines, lineHeight } = wrapTextLines(ctx, value, maxWidth, valueFontSize, 1.25, 2, fontFamily)
      let by = valueStartY + valueFontSize * 0.8
      for (const ln of lines) {
        if (by > maxY) break
        if (!measureOnly) {
          ctx.save()
          ctx.font = `600 ${valueFontSize}px ${fontFamily}`
          ctx.fillStyle = valueColor
          ctx.globalAlpha = valueOpacity
          ctx.textAlign = 'center'
          ctx.textBaseline = 'alphabetic'
          ctx.fillText(ln, x + maxWidth / 2, by)
          ctx.restore()
        }
        by += lineHeight
      }
      cy = by + rowGap * fs
    } else {
      const { lines, lineHeight } = wrapTextLines(ctx, value, maxWidth - labelW - 22, valueFontSize, 1.25, 2, fontFamily)
      // 标签与首行值共用基线；放不下就整行跳过，杜绝“有标签无信息”的残行
      if (baseline > maxY) break
      const isRight = align === 'right'
      // 右对齐：标签贴面板右边缘，值在标签左侧
      const labelX = isRight ? x + maxWidth : x
      const valueX = isRight ? x + maxWidth - labelW - 22 : x + labelW + 22
      if (!measureOnly) drawText(ctx, label, labelX, baseline, labelW, { fontSize: labelFontSize, color: labelColor, fontFamily, opacity: labelOpacity, letterSpacing: 0.22 * labelFontSize, transform: 'uppercase', baseline: 'alphabetic', align: isRight ? 'right' : 'left' })
      let by = baseline
      for (const ln of lines) {
        if (by > maxY) break
        if (!measureOnly) {
          ctx.save()
          ctx.font = `600 ${valueFontSize}px ${fontFamily}`
          ctx.fillStyle = valueColor
          ctx.globalAlpha = valueOpacity
          ctx.textAlign = isRight ? 'right' : 'left'
          ctx.textBaseline = 'alphabetic'
          ctx.fillText(ln, valueX, by)
          ctx.restore()
        }
        by += lineHeight
      }
      cy = by + rowGap * fs
    }
  }
  return cy - y
}

// 辅助：仅计算换行结果（不绘制），返回 lines 和 lineHeight（超 maxLines 截断加省略号）
function wrapTextLines(ctx, text, maxWidth, fontSize, lineHeight, maxLines, fontFamily = 'sans-serif') {
  ctx.font = `600 ${fontSize}px ${fontFamily}`
  const words = String(text).split(/\s+/)
  const lines = []
  let line = ''
  for (const word of words) {
    const test = line ? line + ' ' + word : word
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line); line = word
      if (maxLines && lines.length >= maxLines) break
    } else line = test
  }
  if (!maxLines || lines.length < maxLines) if (line) lines.push(line)
  if (maxLines && lines.length === maxLines) {
    let last = lines[maxLines - 1]
    while (last && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1)
    lines[maxLines - 1] = last + '…'
  }
  return { lines, lineHeight: fontSize * lineHeight }
}

// 辅助：计算文字高度（不绘制），返回 { height, lineHeight }
function wrapTextHeight(ctx, text, maxWidth, fontSize, lineHeight, maxLines, fontWeight = 'normal', fontFamily = 'sans-serif') {
  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`
  const words = String(text).split(/\s+/)
  const lines = []
  let line = ''
  for (const word of words) {
    const test = line ? line + ' ' + word : word
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line); line = word
      if (maxLines && lines.length >= maxLines) break
    } else line = test
  }
  if (!maxLines || lines.length < maxLines) if (line) lines.push(line)
  return { height: lines.length * fontSize * lineHeight, lineHeight: fontSize * lineHeight }
}

// 自适应标题：自动缩小字号直到 maxLines 内放得下，不加省略号
function drawTitle(ctx, text, x, y, maxWidth, opts = {}) {
  const { fontSize: baseSize, maxLines = 2, fontWeight = 'normal', fontFamily = 'sans-serif', transform = 'none', lineHeight = 1.02, ...rest } = opts
  let displayText = String(text || '')
  if (transform === 'uppercase') displayText = displayText.toUpperCase()
  let fs = baseSize
  const minFs = Math.max(18, Math.floor(baseSize * 0.5))
  ctx.save()
  while (fs > minFs) {
    ctx.font = `${fontWeight} ${fs}px ${fontFamily}`
    const { lines } = wrapText(ctx, displayText, maxWidth, fs, lineHeight, 999, false)
    if (lines.length <= maxLines) break
    fs -= 2
  }
  ctx.restore()
  return drawText(ctx, text, x, y, maxWidth, { ...rest, fontSize: fs, maxLines, fontWeight, fontFamily, transform, lineHeight, ellipsis: false })
}

// ============ 模板绘制函数 ============

// 1. Minimal
function drawMinimal(ctx, p) {
  const { W, H, movie, cfg, theme, landscape, fs, specs, ratings, personal, posterImg, note } = p
  const fontFamily = FONTS[theme.font]
  const ink = theme.ink
  const contentBottom = H - P - 50
  const align = cfg.textAlign || 'left'

  if (landscape) {
    const { tx, tw, posterX, posterW } = resolveLayout(W, H, landscape, align, { posterFrac: 0.38, gap: 44, PAD: P })
    drawImageCover(ctx, posterImg, posterX, P, posterW, H - P * 2, false)
    let cy = P
    const ax = alignX(align, tx, tw)
    const { height: th } = drawTitle(ctx, movie.title, ax, cy, tw, { fontSize: 74 * fs, color: ink, fontFamily, fontWeight: 900, lineHeight: 1.02, maxLines: 2, maxY: contentBottom, letterSpacing: -0.02 * 74 * fs, align })
    cy += th + 16
    if (cfg.showYear && movie.year) {
      const { height: yh } = drawText(ctx, movie.year, ax, cy, tw, { fontSize: 22 * fs, color: ink, fontFamily, opacity: 0.55, align })
      cy += yh + 16
    }
    cy += drawRatings(ctx, tx, cy, tw, { movie, cfg, ratings, personal, theme, fs: fs * 0.9, align }) + 16
    if (cfg.showOverview && movie.overview) {
      const { height: oh } = drawText(ctx, movie.overview, ax, cy, tw, { fontSize: 20 * fs, color: ink, fontFamily, lineHeight: 1.55, maxLines: 3, maxY: contentBottom, opacity: 0.78, align })
      cy += oh + 16
    }
    if (cfg.showNote && note) {
      const { height: nh } = drawText(ctx, `\u201C${note}\u201D`, ax, cy, tw, { fontSize: 18 * fs, color: ink, fontFamily, lineHeight: 1.5, maxLines: 2, maxY: contentBottom, opacity: 0.6, align })
      cy += nh + 16
    }
    const creditsRows = buildCreditsRows(movie, cfg)
    cy += drawInfoList(ctx, tx, cy, tw, creditsRows, { maxY: contentBottom, fs: fs * 0.92, labelColor: ink, valueColor: ink, fontFamily, align }) + 12
    const specsRows = buildFactRows(movie, specs, cfg)
    drawInfoList(ctx, tx, cy, tw, specsRows, { maxY: contentBottom, fs: fs * 0.86, labelColor: ink, valueColor: ink, fontFamily, align })
    // 底部水印线：跨越整个宽度
    const fy = H - P - 20
    ctx.strokeStyle = 'rgba(128,128,128,0.35)'
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(P, fy); ctx.lineTo(W - P, fy); ctx.stroke()
    drawText(ctx, 'lumenframe', alignX(align, P, W - P * 2), fy + 8, W - P * 2, { fontSize: 16, color: ink, fontFamily, opacity: 0.5, letterSpacing: 0.34 * 16, transform: 'uppercase', align })
  } else {
    const tw = W - P * 2
    // 先测量标题以下整个文字栈的高度，再反推图片高度：
    // 4:5 / 1:1 等短比例下图片写死 52% 会把 tech specs 挤出边界，
    // 图片让出空间可保证 credits 与 specs 完整渲染（9:16 等长比例仍取上限 52%）
    const creditsRows = buildCreditsRows(movie, cfg)
    const specsRows = buildFactRows(movie, specs, cfg)
    let textH = wrapTextHeight(ctx, movie.title, tw, 60 * fs, 1.02, 2, 900, fontFamily).height + 16
    if (cfg.showYear && movie.year) textH += 22 * fs * 1.25 + 16
    // 评分徽章固定高约 47px（随 fs 缩放）；无徽章时 drawRatings 返回 0
    if (cfg.showRatings) textH += 47 * fs * 0.92 + 16
    if (cfg.showOverview && movie.overview) {
      textH += wrapTextHeight(ctx, movie.overview, tw, 22 * fs, 1.55, 3, 'normal', fontFamily).height + 16
    }
    if (cfg.showNote && note) {
      textH += wrapTextHeight(ctx, note, tw, 20 * fs, 1.5, 2, 'normal', fontFamily).height + 16
    }
    if (creditsRows.length) {
      textH += drawInfoList(ctx, 0, 0, tw, creditsRows, { fs: fs * 0.95, labelColor: ink, valueColor: ink, fontFamily, align, measureOnly: true }) + 12
    }
    if (specsRows.length) {
      textH += drawInfoList(ctx, 0, 0, tw, specsRows, { fs: fs * 0.9, labelColor: ink, valueColor: ink, fontFamily, align, measureOnly: true })
    }
    const basePh = (H - P * 3) * 0.52
    const ph = Math.min(basePh, Math.max(300, contentBottom - P - 28 - textH))

    drawImageCover(ctx, posterImg, P, P, W - P * 2, ph, false)
    let cy = P + ph + 28
    const ax = alignX(align, P, tw)
    const { height: th } = drawTitle(ctx, movie.title, ax, cy, tw, { fontSize: 60 * fs, color: ink, fontFamily, fontWeight: 900, lineHeight: 1.02, maxLines: 2, maxY: contentBottom, letterSpacing: -0.02 * 60 * fs, align })
    cy += th + 16
    if (cfg.showYear && movie.year) {
      const { height: yh } = drawText(ctx, movie.year, ax, cy, tw, { fontSize: 22 * fs, color: ink, fontFamily, opacity: 0.55, align })
      cy += yh + 16
    }
    cy += drawRatings(ctx, P, cy, tw, { movie, cfg, ratings, personal, theme, fs: fs * 0.92, align }) + 16
    if (cfg.showOverview && movie.overview) {
      const { height: oh } = drawText(ctx, movie.overview, ax, cy, tw, { fontSize: 22 * fs, color: ink, fontFamily, lineHeight: 1.55, maxLines: 3, maxY: contentBottom, opacity: 0.78, align })
      cy += oh + 16
    }
    if (cfg.showNote && note) {
      const { height: nh } = drawText(ctx, `\u201C${note}\u201D`, ax, cy, tw, { fontSize: 20 * fs, color: ink, fontFamily, lineHeight: 1.5, maxLines: 2, maxY: contentBottom, opacity: 0.6, align })
      cy += nh + 16
    }
    cy += drawInfoList(ctx, P, cy, tw, creditsRows, { maxY: contentBottom, fs: fs * 0.95, labelColor: ink, valueColor: ink, fontFamily, align }) + 12
    drawInfoList(ctx, P, cy, tw, specsRows, { maxY: contentBottom, fs: fs * 0.9, labelColor: ink, valueColor: ink, fontFamily, align })
    const fy = H - P - 20
    ctx.strokeStyle = 'rgba(128,128,128,0.35)'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(P, fy); ctx.lineTo(W - P, fy); ctx.stroke()
    drawText(ctx, 'lumenframe', ax, fy + 8, tw, { fontSize: 16, color: ink, fontFamily, opacity: 0.5, letterSpacing: 0.34 * 16, transform: 'uppercase', align })
  }
}

// 2. Magazine：海报铺底
function drawMagazine(ctx, p) {
  const { W, H, movie, cfg, theme, landscape, fs, specs, ratings, personal, posterImg, note } = p
  const fontFamily = FONTS[theme.font]
  const ink = theme.ink
  const contentBottom = H - P - 50
  const align = cfg.textAlign || 'left'

  drawImageCover(ctx, posterImg, 0, 0, W, H, false)
  // 渐变遮罩 — landscape 时根据 textAlign 决定渐变方向（文字所在侧更暗）
  let scrim
  if (landscape) {
    scrim = align === 'right'
      ? linearGradient(ctx, 0, 0, W, 0, [[0, 'rgba(0,0,0,0.2)'], [0.3, 'rgba(0,0,0,0.3)'], [0.64, 'rgba(0,0,0,0.8)'], [1, 'rgba(0,0,0,0.95)']])
      : linearGradient(ctx, 0, 0, W, 0, [[0, 'rgba(0,0,0,0.95)'], [0.36, 'rgba(0,0,0,0.8)'], [0.7, 'rgba(0,0,0,0.3)'], [1, 'rgba(0,0,0,0.2)']])
  } else {
    scrim = linearGradient(ctx, 0, 0, 0, H, [[0, 'rgba(0,0,0,0.4)'], [0.28, 'rgba(0,0,0,0.2)'], [0.58, 'rgba(0,0,0,0.75)'], [1, 'rgba(0,0,0,0.96)']])
  }
  ctx.fillStyle = scrim
  ctx.fillRect(0, 0, W, H)

  // landscape 时文字面板位置/宽度取决于 align
  const tw = landscape ? W * 0.54 : W - P * 2
  const tx = landscape
    ? (align === 'right' ? W - P - tw : P)
    : P
  let cy = landscape ? H / 2 - 100 : H - P
  if (!landscape) {
    // 从底部往上排
    const items = []
    items.push({ type: 'label', text: 'Now Showing', opts: { fontSize: 14 * fs, color: theme.accent, fontFamily, letterSpacing: 0.45 * 14 * fs, transform: 'uppercase' } })
    items.push({ type: 'title', text: movie.title, opts: { fontSize: 72 * fs, color: ink, fontFamily, fontWeight: 900, lineHeight: 0.98, maxLines: 2, letterSpacing: -0.02 * 72 * fs, transform: 'uppercase' } })
    if (cfg.showYear && movie.year) items.push({ type: 'year', text: movie.year, opts: { fontSize: 22 * fs, color: ink, fontFamily, opacity: 0.7 } })
    items.push({ type: 'ratings' })
    if (cfg.showOverview && movie.overview) items.push({ type: 'overview', text: movie.overview, opts: { fontSize: 18 * fs, color: ink, fontFamily, lineHeight: 1.5, maxLines: 3, opacity: 0.88 } })
    items.push({ type: 'credits' })
    items.push({ type: 'specs' })

    // 从底往上布局
    let bottomY = H - P
    const heights = []
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]
      if (item.type === 'ratings') {
        heights[i] = 50 * fs * 0.8
      } else if (item.type === 'credits') {
        heights[i] = buildCreditsRows(movie, cfg).length * (21 * fs * 0.8 * 1.25 + 11 * fs * 0.8)
      } else if (item.type === 'specs') {
        heights[i] = buildFactRows(movie, specs, cfg).length * (19 * fs * 0.72 * 1.25 + 9 * fs * 0.72) + 30
      } else {
        const o = item.opts
        ctx.font = `${o.fontWeight || 'normal'} ${o.fontSize}px ${fontFamily}`
        const { height } = wrapTextHeight(ctx, item.text, tw, o.fontSize, o.lineHeight || 1.25, o.maxLines || 0)
        heights[i] = height
      }
      bottomY -= heights[i] + 10
    }
    cy = Math.max(P, bottomY)
  }

  // 绘制
  if (landscape) {
    const ax = alignX(align, tx, tw)
    drawText(ctx, 'Now Showing', ax, cy, tw, { fontSize: 14 * fs, color: theme.accent, fontFamily, letterSpacing: 0.45 * 14 * fs, transform: 'uppercase', align })
    cy += 14 * fs * 1.25 + 8
    const { height: th } = drawTitle(ctx, movie.title, ax, cy, tw, { fontSize: 80 * fs, color: ink, fontFamily, fontWeight: 900, lineHeight: 0.98, maxLines: 2, maxY: contentBottom, letterSpacing: -0.02 * 80 * fs, transform: 'uppercase', align })
    cy += th + 8
    if (cfg.showYear && movie.year) {
      const { height: yh } = drawText(ctx, movie.year, ax, cy, tw, { fontSize: 22 * fs, color: ink, fontFamily, opacity: 0.7, align })
      cy += yh + 12
    }
    cy += drawRatings(ctx, tx, cy, tw, { movie, cfg, ratings, personal, theme, fs: fs * 0.8, align }) + 12
    if (cfg.showOverview && movie.overview) {
      cy += drawText(ctx, movie.overview, ax, cy, tw, { fontSize: 18 * fs, color: ink, fontFamily, lineHeight: 1.5, maxLines: 3, maxY: contentBottom, opacity: 0.88, align }).height + 12
    }
    const cRows = buildCreditsRows(movie, cfg)
    cy += drawInfoList(ctx, tx, cy, tw, cRows, { maxY: contentBottom, fs: fs * 0.8, labelColor: ink, valueColor: ink, fontFamily, align }) + 10
    const sRows = buildFactRows(movie, specs, cfg)
    drawInfoList(ctx, tx, cy, tw, sRows, { maxY: contentBottom, fs: fs * 0.72, labelColor: ink, valueColor: ink, fontFamily, align })
  } else {
    const ax = alignX(align, tx, tw)
    drawText(ctx, 'Now Showing', ax, cy, tw, { fontSize: 14 * fs, color: theme.accent, fontFamily, letterSpacing: 0.45 * 14 * fs, transform: 'uppercase', align })
    cy += 14 * fs * 1.25 + 8
    cy += drawTitle(ctx, movie.title, ax, cy, tw, { fontSize: 72 * fs, color: ink, fontFamily, fontWeight: 900, lineHeight: 0.98, maxLines: 2, maxY: contentBottom, letterSpacing: -0.02 * 72 * fs, transform: 'uppercase', align }).height + 8
    if (cfg.showYear && movie.year) cy += drawText(ctx, movie.year, ax, cy, tw, { fontSize: 22 * fs, color: ink, fontFamily, opacity: 0.7, align }).height + 12
    cy += drawRatings(ctx, tx, cy, tw, { movie, cfg, ratings, personal, theme, fs: fs * 0.8, align }) + 12
    if (cfg.showOverview && movie.overview) cy += drawText(ctx, movie.overview, ax, cy, tw, { fontSize: 18 * fs, color: ink, fontFamily, lineHeight: 1.5, maxLines: 3, maxY: contentBottom, opacity: 0.88, align }).height + 12
    const cRows = buildCreditsRows(movie, cfg)
    cy += drawInfoList(ctx, tx, cy, tw, cRows, { maxY: contentBottom, fs: fs * 0.8, labelColor: ink, valueColor: ink, fontFamily, align }) + 10
    const sRows = buildFactRows(movie, specs, cfg)
    drawInfoList(ctx, tx, cy, tw, sRows, { maxY: contentBottom, fs: fs * 0.72, labelColor: ink, valueColor: ink, fontFamily, align })
  }
}

// 3. Noir
function drawNoir(ctx, p) {
  const { W, H, movie, cfg, theme, landscape, fs, specs, ratings, personal, posterImg, note } = p
  const fontFamily = FONTS[theme.font]
  const ink = theme.ink
  const contentBottom = H - P - 50
  const eyebrow = movie.kind === 'tv' ? 'A Series' : 'A Film'
  const align = cfg.textAlign || 'left'

  if (landscape) {
    const { tx, tw, posterW } = resolveLayout(W, H, landscape, align, { posterFrac: 0.52, gap: 48, PAD: P })
    // Noir 海报贴边：override resolveLayout 的 posterX
    // align=right → 文字在左 → 海报靠右；align=left → 文字在右 → 海报靠左
    const posterX = align === 'right' ? W - posterW : 0
    drawImageCover(ctx, posterImg, posterX, 0, posterW, H, true)
    let cy = H / 2 - 130
    const ax = alignX(align, tx, tw)
    cy += drawText(ctx, eyebrow, ax, cy, tw, { fontSize: 16 * fs, color: ink, fontFamily, letterSpacing: 0.4 * 16 * fs, transform: 'uppercase', opacity: 0.5, align }).height + 10
    cy += drawTitle(ctx, movie.title, ax, cy, tw, { fontSize: 64 * fs, color: ink, fontFamily, fontWeight: 900, lineHeight: 1, maxLines: 2, maxY: contentBottom, align }).height + 10
    if (cfg.showYear && movie.year) cy += drawText(ctx, movie.year, ax, cy, tw, { fontSize: 20 * fs, color: ink, fontFamily, opacity: 0.5, align }).height + 14
    cy += drawRatings(ctx, tx, cy, tw, { movie, cfg, ratings, personal, theme, fs: fs * 0.82, align }) + 14
    if (cfg.showOverview && movie.overview) cy += drawText(ctx, movie.overview, ax, cy, tw, { fontSize: 19 * fs, color: ink, fontFamily, lineHeight: 1.5, maxLines: 3, maxY: contentBottom, opacity: 0.6, align }).height + 14
    const cRows = buildCreditsRows(movie, cfg)
    cy += drawInfoList(ctx, tx, cy, tw, cRows, { maxY: contentBottom, fs: fs * 0.82, labelColor: ink, valueColor: ink, fontFamily, align }) + 12
    const sRows = buildFactRows(movie, specs, cfg)
    drawInfoList(ctx, tx, cy, tw, sRows, { maxY: contentBottom, fs: fs * 0.76, labelColor: ink, valueColor: ink, fontFamily, align })
  } else {
    const ph = H * 0.55
    drawImageCover(ctx, posterImg, 0, 0, W, ph, true)
    const tx = P
    const tw = W - P * 2
    const ax = alignX(align, tx, tw)
    let cy = ph + 28
    cy += drawText(ctx, eyebrow, ax, cy, tw, { fontSize: 15 * fs, color: ink, fontFamily, letterSpacing: 0.4 * 15 * fs, transform: 'uppercase', opacity: 0.5, align }).height + 10
    cy += drawTitle(ctx, movie.title, ax, cy, tw, { fontSize: 54 * fs, color: ink, fontFamily, fontWeight: 900, lineHeight: 1, maxLines: 2, maxY: contentBottom, align }).height + 10
    if (cfg.showYear && movie.year) cy += drawText(ctx, movie.year, ax, cy, tw, { fontSize: 20 * fs, color: ink, fontFamily, opacity: 0.5, align }).height + 14
    cy += drawRatings(ctx, tx, cy, tw, { movie, cfg, ratings, personal, theme, fs: fs * 0.8, align }) + 14
    if (cfg.showOverview && movie.overview) cy += drawText(ctx, movie.overview, ax, cy, tw, { fontSize: 19 * fs, color: ink, fontFamily, lineHeight: 1.5, maxLines: 3, maxY: contentBottom, opacity: 0.6, align }).height + 14
    const cRows = buildCreditsRows(movie, cfg)
    cy += drawInfoList(ctx, tx, cy, tw, cRows, { maxY: contentBottom, fs: fs * 0.8, labelColor: ink, valueColor: ink, fontFamily, align }) + 12
    const sRows = buildFactRows(movie, specs, cfg)
    drawInfoList(ctx, tx, cy, tw, sRows, { maxY: contentBottom, fs: fs * 0.74, labelColor: ink, valueColor: ink, fontFamily, align })
  }
}

// ============ Ratings：仅显示评分（含个人评分），大尺寸固定排版 ============
function drawRatingsCard(ctx, p) {
  const { W, H, movie, cfg, theme, landscape, ratings, personal, posterImg } = p
  const fontFamily = FONTS[theme.font]
  const ink = theme.ink
  const align = cfg.textAlign || 'left'

  // 海报铺底 + 深色渐变遮罩
  drawImageCover(ctx, posterImg, 0, 0, W, H, false)
  const scrim = linearGradient(ctx, 0, 0, 0, H, [
    [0, 'rgba(0,0,0,0.55)'],
    [0.4, 'rgba(0,0,0,0.3)'],
    [0.7, 'rgba(0,0,0,0.7)'],
    [1, 'rgba(0,0,0,0.94)'],
  ])
  ctx.fillStyle = scrim
  ctx.fillRect(0, 0, W, H)

  const contentLeft = P
  const contentRight = W - P
  const contentCX = W / 2
  const titleX = align === 'center' ? contentCX : (align === 'right' ? contentRight : contentLeft)

  // 顶部电影名
  const titleSize = landscape ? 30 : 26
  drawText(ctx, movie.title, titleX, P, W - P * 2, {
    fontSize: titleSize, color: ink, fontFamily, fontWeight: 700,
    lineHeight: 1.1, maxLines: 1, align, opacity: 0.9,
    transform: 'uppercase', maxY: H - P - 50, ellipsis: false,
  })

  // 收集评分数据
  const items = []
  if (cfg.showRating && typeof movie.rating === 'number') {
    items.push({ value: movie.rating.toFixed(1), label: 'TMDB', color: '#FFFFFF', bg: 'rgba(255,255,255,0.14)', star: '★' })
  }
  if (cfg.showImdb !== false && ratings?.imdb != null) {
    items.push({ value: ratings.imdb.toFixed(1), label: 'IMDb', color: '#1A1500', bg: '#F5C518' })
  }
  if (cfg.showRt !== false && ratings?.rotten_tomatoes != null) {
    const c = rtColor(ratings.rotten_tomatoes)
    items.push({ value: `${ratings.rotten_tomatoes}%`, label: 'Tomato', color: c.fg, bg: c.bg })
  }
  if (cfg.showPop !== false && ratings?.popcornmeter != null) {
    // 观众分：白底深色数字 + 品牌色标签，与红色媒体分块区分
    items.push({
      value: `${ratings.popcornmeter}%`, label: 'Popcorn',
      color: '#1A1500', bg: '#FFFFFF', labelColor: popcornColor(ratings.popcornmeter),
    })
  }
  if (cfg.showMeta !== false && ratings?.metacritic != null) {
    const c = mcColor(ratings.metacritic)
    items.push({ value: String(ratings.metacritic), label: 'Metascore', color: c.fg, bg: c.bg })
  }
  if (cfg.showPersonal !== false && personal > 0) {
    const pc = personalColor(personal)
    items.push({ value: String(personal), label: 'My Score', color: pc.fg, bg: pc.bg, star: '♥' })
  }
  if (items.length === 0) return

  // ---- 响应式网格：按可用区域与评分项数自动选列数，块统一、不溢出、不重叠 ----
  const n = items.length
  const margin = Math.max(P * 1.2, W * 0.07)
  const availW = W - margin * 2
  const topReserve = H * 0.15   // 顶部留给片名
  const bottomReserve = H * 0.11 // 底部留给年份
  const availH = H - topReserve - bottomReserve
  const gap = Math.round(Math.min(W, H) * 0.022)
  const BLOCK_ASPECT = 1.55     // 评分块统一宽高比
  // 评分群整体占计算网格区域的比例：缩小整体展示范围，让海报成为主体、评分为点缀
  const GRID_SCALE = 0.5

  // 枚举 1..n 列，选块面积最大（在不溢出前提下块最大）的方案
  let best = null
  for (let c = 1; c <= n; c++) {
    const r = Math.ceil(n / c)
    const cellW = (availW - (c - 1) * gap) / c
    const cellH = (availH - (r - 1) * gap) / r
    let bw = cellW
    let bh = bw / BLOCK_ASPECT
    if (bh > cellH) { bh = cellH; bw = bh * BLOCK_ASPECT }
    const area = bw * bh
    if (!best || area > best.area) best = { cols: c, rows: r, bw, bh, area }
  }
  // 列/行方案不变，仅整体等比缩小（块内字号按块高推导，自动跟随）
  const cols = best.cols
  const rows = best.rows
  const bw = best.bw * GRID_SCALE
  const bh = best.bh * GRID_SCALE
  const gapS = gap * GRID_SCALE

  const gridH = rows * bh + (rows - 1) * gapS
  const startY = topReserve + (availH - gridH) / 2

  // 逐行水平居中（最后一行不足列数时同样居中）
  items.forEach((it, i) => {
    const r = Math.floor(i / cols)
    const colInRow = i - r * cols
    const itemsInRow = Math.min(cols, n - r * cols)
    const rowW = itemsInRow * bw + (itemsInRow - 1) * gapS
    const bx = W / 2 - rowW / 2 + colInRow * (bw + gapS)
    const by = startY + r * (bh + gapS)
    drawRatingBlock(ctx, bx, by, bw, bh, it)
  })

  // 底部年份（与标题对齐）
  if (cfg.showYear && movie.year) {
    drawText(ctx, String(movie.year), titleX, H - P, W - P * 2, {
      fontSize: landscape ? 22 : 18, color: ink, fontFamily, fontWeight: 500,
      align, opacity: 0.6,
    })
  }
}

// 单个评分块：尺寸自适应；数字按块宽自动缩字号，始终完整落在色块内
function drawRatingBlock(ctx, x, y, bw, bh, b) {
  fillRoundRect(ctx, x, y, bw, bh, bw * 0.12, b.bg)

  const padX = bw * 0.12
  const numCx = x + bw / 2

  // 数字：从块高一半试起，超出块宽就逐级缩小
  let numSize = bh * 0.5
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = b.color
  do {
    ctx.font = `800 ${numSize}px sans-serif`
    if (ctx.measureText(b.value).width <= bw - padX * 2) break
    numSize -= 2
  } while (numSize > bh * 0.26)
  ctx.fillText(b.value, numCx, y + bh * 0.39)
  ctx.restore()

  // 标签：数字下方居中，小号大写字 + 适度字距；含字距实测超宽则缩字号
  const labelText = b.star ? `${b.star} ${b.label}` : b.label
  const upper = String(labelText).toUpperCase()
  let labelSize = Math.max(11, bh * 0.125)
  const labelInnerW = bw - padX * 2
  const labelFits = (size, tracking) => {
    ctx.save()
    ctx.font = `700 ${size}px sans-serif`
    let w = 0
    for (const ch of upper) w += ctx.measureText(ch).width + (ch === ' ' ? 0 : tracking)
    ctx.restore()
    return w <= labelInnerW
  }
  let labelTrack = labelSize * 0.12
  while (labelSize > 11 && !labelFits(labelSize, labelTrack)) {
    labelSize -= 1
    labelTrack = labelSize * 0.12
  }
  drawText(ctx, labelText, numCx, y + bh * 0.74, labelInnerW, {
    fontSize: labelSize, color: b.labelColor || b.color, fontFamily: 'sans-serif', fontWeight: 700,
    align: 'center', opacity: 0.92, transform: 'uppercase', letterSpacing: labelTrack,
    maxLines: 1, ellipsis: false,
  })
}

// ============ Info：所选图片铺底，所有影片信息（含 tech specs）居中展示 ============
function drawInfoCard(ctx, p) {
  const { W, H, movie, cfg, theme, landscape, specs, ratings, personal, posterImg, note } = p
  const fontFamily = FONTS[theme.font]
  const ink = theme.ink
  const accent = theme.accent
  const align = cfg.textAlign || 'left'

  // 所选图片铺底
  drawImageCover(ctx, posterImg, 0, 0, W, H, false)

  // 全屏压暗 + 中心径向暗角：所有内容居中，需整个画面均匀压暗
  ctx.fillStyle = 'rgba(0,0,0,0.38)'
  ctx.fillRect(0, 0, W, H)
  const cx = W / 2
  const cy0 = H / 2
  const rg = ctx.createRadialGradient(cx, cy0, Math.min(W, H) * 0.1, cx, cy0, Math.max(W, H) * 0.68)
  rg.addColorStop(0, 'rgba(0,0,0,0.55)')
  rg.addColorStop(0.5, 'rgba(0,0,0,0.38)')
  rg.addColorStop(1, 'rgba(0,0,0,0.22)')
  ctx.fillStyle = rg
  ctx.fillRect(0, 0, W, H)

  const panelW = landscape ? W * 0.66 : W * 0.86
  const x = align === 'center' ? cx - panelW / 2 : (align === 'right' ? W - P - panelW : P)
  const contentBottom = H - P - 22
  const availH = contentBottom - P

  const creditsRows = buildCreditsRows(movie, cfg)
  const specsRows = buildFactRows(movie, specs, cfg)
  const hasRatings = cfg.showRatings && (
    (cfg.showRating && typeof movie.rating === 'number') ||
    (cfg.showImdb !== false && ratings?.imdb != null) ||
    (cfg.showRt !== false && ratings?.rotten_tomatoes != null) ||
    (cfg.showPop !== false && ratings?.popcornmeter != null) ||
    (cfg.showMeta !== false && ratings?.metacritic != null) ||
    (cfg.showPersonal !== false && personal > 0)
  )
  const hasLists = creditsRows.length > 0 || specsRows.length > 0

  const listOpts = (rows, fs) => ({
    fs, labelSize: 11, valueSize: 17, rowGap: 9, align: align === 'center' ? 'center' : align,
    labelColor: accent, valueColor: ink, fontFamily,
  })

  const textShadow = { color: 'rgba(0,0,0,0.6)', blur: 14, offsetX: 0, offsetY: 1 }

  // 两遍布局：测量 → 自适应缩放 → 垂直居中
  function measure(s) {
    let h = 0
    // eyebrow + gap
    h += 11 * s * 1.2 + 14 * s
    // title
    const titleFs = (landscape ? 58 : 44) * s
    ctx.save(); ctx.font = `900 ${titleFs}px ${fontFamily}`
    h += wrapText(ctx, movie.title, panelW, titleFs, 1.06, 2, false).height
    ctx.restore()
    // year + gap
    if (cfg.showYear && movie.year) h += 6 * s + 16 * s * 1.3
    // ratings
    if (hasRatings) h += 8 * s + 47
    // overview
    if (cfg.showOverview && movie.overview) {
      const ofs = 16 * s
      ctx.save(); ctx.font = `400 ${ofs}px ${fontFamily}`
      h += 14 * s + wrapText(ctx, movie.overview, panelW, ofs, 1.5, 3).height
      ctx.restore()
    }
    // note (quoted)
    if (cfg.showNote && note) {
      const nfs = 15 * s
      ctx.save(); ctx.font = `400 ${nfs}px ${fontFamily}`
      h += 14 * s + wrapText(ctx, note, panelW, nfs, 1.4, 2).height
      ctx.restore()
    }
    // divider
    if (hasLists) h += 14 * s + 1 + 14 * s
    // credits
    if (creditsRows.length > 0) {
      h += drawInfoList(ctx, x, 0, panelW, creditsRows, { ...listOpts(creditsRows, s * 0.92), measureOnly: true })
    }
    // tech specs
    if (specsRows.length > 0) {
      h += 12 * s + 11 * s * 1.3 + 5 * s
      h += drawInfoList(ctx, x, 0, panelW, specsRows, { ...listOpts(specsRows, s * 0.86), valueSize: 16, rowGap: 9, measureOnly: true })
    }
    return h
  }
  let s = landscape ? 0.95 : 1
  while (measure(s) > availH && s > 0.6) s -= 0.04
  const totalH = measure(s)

  // 垂直居中
  let cy = cy0 - totalH / 2

  // 眉标
  const textX = align === 'center' ? cx : (align === 'right' ? x + panelW : x)
  drawText(ctx, movie.kind === 'tv' ? 'Show Info' : 'Film Info', textX, cy, panelW, {
    fontSize: 11 * s, color: accent, fontFamily, fontWeight: 600,
    letterSpacing: 0.5 * 11 * s, transform: 'uppercase', align, shadow: textShadow,
  })
  cy += 11 * s * 1.2 + 14 * s

  // 片名
  const titleFs = (landscape ? 58 : 44) * s
  cy += drawText(ctx, movie.title, textX, cy, panelW, {
    fontSize: titleFs, color: ink, fontFamily, fontWeight: 900,
    lineHeight: 1.06, maxLines: 2, align, shadow: textShadow, ellipsis: false,
    letterSpacing: -0.025 * titleFs,
  }).height

  // 年份
  if (cfg.showYear && movie.year) {
    cy += 6 * s
    cy += drawText(ctx, String(movie.year), textX, cy, panelW, {
      fontSize: 16 * s, color: ink, fontFamily, fontWeight: 400,
      align, opacity: 0.72, shadow: textShadow,
    }).height
  }

  // 评分
  if (hasRatings) {
    cy += 8 * s
    cy += drawRatings(ctx, x, cy, panelW, { movie, cfg, ratings, personal, theme, fs: 0.82 * s, align })
  }

  // 简介
  if (cfg.showOverview && movie.overview) {
    cy += 14 * s
    cy += drawText(ctx, movie.overview, textX, cy, panelW, {
      fontSize: 16 * s, color: ink, fontFamily, fontWeight: 400,
      lineHeight: 1.5, maxLines: 3, align, opacity: 0.8, shadow: textShadow,
    }).height
  }

  // 短评（居中引号样式）
  if (cfg.showNote && note) {
    cy += 14 * s
    cy += drawText(ctx, `\u201C${note}\u201D`, textX, cy, panelW, {
      fontSize: 15 * s, color: ink, fontFamily, fontWeight: 400,
      lineHeight: 1.4, maxLines: 2, align, opacity: 0.62, shadow: textShadow,
    }).height
  }

  // 分隔线
  if (hasLists) {
    cy += 14 * s
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'
    ctx.lineWidth = 1
    const dividerCx = align === 'center' ? cx : textX
    ctx.beginPath(); ctx.moveTo(dividerCx - 50 * s, cy + 0.5); ctx.lineTo(dividerCx + 50 * s, cy + 0.5); ctx.stroke()
    cy += 1 + 14 * s
  }

  // Credits
  if (creditsRows.length > 0) {
    cy += drawInfoList(ctx, x, cy, panelW, creditsRows, listOpts(creditsRows, s * 0.92))
  }

  // Tech Specs
  if (specsRows.length > 0) {
    cy += 12 * s
    drawText(ctx, 'Tech Specs', textX, cy, panelW, {
      fontSize: 11 * s, color: accent, fontFamily, fontWeight: 600,
      letterSpacing: 0.42 * 11 * s, transform: 'uppercase', align, shadow: textShadow,
    })
    cy += 11 * s * 1.3 + 5 * s
    drawInfoList(ctx, x, cy, panelW, specsRows, { ...listOpts(specsRows, s * 0.86), valueSize: 16, rowGap: 9 })
  }

  // 右上角 watermark
  drawText(ctx, 'lumenframe', W - P, P + 8, panelW, {
    fontSize: 13, color: ink, fontFamily, opacity: 0.45,
    letterSpacing: 0.34 * 13, transform: 'uppercase', align: 'right', shadow: textShadow,
  })
}

const DRAWERS = {
  minimal: drawMinimal,
  magazine: drawMagazine,
  noir: drawNoir,
  ratings: drawRatingsCard,
  info: drawInfoCard,
}

// 字体颜色映射：auto=根据背景反色，其余为固定 hex
const TEXT_COLOR_MAP = {
  auto: null,
  white: '#FFFFFF',
  black: '#000000',
  cream: '#F3EFE7',
  gold: '#D4A857',
  red: '#E63946',
  blue: '#4A90D9',
}

const Card = forwardRef(function Card({ movie, config, width, height, specs, ratings, personal, customImage, note }, ref) {
  const canvasRef = useRef(null)
  const posterImgRef = useRef(null)

  // 加载卡片主图：优先使用从 Posters/Stills 挑选的自定义图，否则用官方主海报
  // （电影走 TMDB，剧集走 TVmaze，均经后端图片代理）
  useEffect(() => {
    const src = customImage || posterFor(movie, 'w1280')
    if (!src) {
      posterImgRef.current = null
      render()
      return
    }
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => { posterImgRef.current = img; render() }
    img.onerror = () => { posterImgRef.current = null; render() }
    img.src = src
    return () => { img.onload = null; img.onerror = null }
  }, [movie?.poster_path, movie?.tvPoster, movie?.kind, customImage])

  // 渲染
  function render() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const W = width
    const H = height
    canvas.width = W
    canvas.height = H

    const def = TEMPLATES[config.template] || TEMPLATES.minimal
    const landscape = W >= H
    const onLight = !isDark(config.bgColor || def.bg)
    // 字体颜色：textColor 为 auto 时按背景明暗反色，否则用用户选的 hex
    const textColorHex = config.textColor === 'auto' || !config.textColor
      ? null
      : (TEXT_COLOR_MAP[config.textColor] || config.textColor)
    const ink = textColorHex
      ? textColorHex
      : (config.bgColor && config.bgColor.toLowerCase() !== def.bg.toLowerCase()
        ? onLight ? '#1B1B1F' : '#FAFAFA'
        : def.ink)
    const bg = config.bgColor || def.bg
    const theme = { ...def, id: config.template, ink }
    const fs = 1 // 固定字号，不再缩放

    // 背景
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    // 全局裁剪：确保所有内容不超出卡片边界
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, W, H)
    ctx.clip()

    const drawer = DRAWERS[config.template] || drawMinimal
    drawer(ctx, { W, H, movie, cfg: config, theme, landscape, fs, specs, ratings, personal, posterImg: posterImgRef.current, note: note || '' })

    ctx.restore()
  }

  useEffect(() => { render() }, [config, width, height, specs, ratings, personal, movie])

  // 把内部 canvas 暴露给父组件（用于导出）
  useEffect(() => {
    if (ref && typeof ref === 'object') ref.current = canvasRef.current
  }, [ref])

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
})

export default Card
