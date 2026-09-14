// 卡片渲染：Canvas 直接绘制，预览与导出完全一致
import { forwardRef, useEffect, useRef } from 'react'
import {
  fillRoundRect, drawText, drawImageCover,
  linearGradient, drawRatings, isDark, mcColor, personalColor, wrapText,
} from './canvas-utils'
import { posterUrl } from '../api'

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
      if (!measureOnly) drawText(ctx, label, x + maxWidth / 2, labelBaseline, maxWidth, { fontSize: labelFontSize, color: labelColor, fontFamily, opacity: labelOpacity, letterSpacing: 0.22 * labelFontSize, transform: 'uppercase', align: 'center', baseline: 'alphabetic' })
      const valueStartY = cy + labelFontSize * 1.25
      const { lines, lineHeight } = wrapTextLines(ctx, value, maxWidth, valueFontSize, 1.25, 2)
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
      if (!measureOnly) drawText(ctx, label, x, baseline, labelW, { fontSize: labelFontSize, color: labelColor, fontFamily, opacity: labelOpacity, letterSpacing: 0.22 * labelFontSize, transform: 'uppercase', baseline: 'alphabetic' })
      const { lines, lineHeight } = wrapTextLines(ctx, value, maxWidth - labelW - 22, valueFontSize, 1.25, 2)
      let by = baseline
      for (const ln of lines) {
        if (by > maxY) break
        if (!measureOnly) {
          ctx.save()
          ctx.font = `600 ${valueFontSize}px ${fontFamily}`
          ctx.fillStyle = valueColor
          ctx.globalAlpha = valueOpacity
          ctx.textAlign = 'left'
          ctx.textBaseline = 'alphabetic'
          ctx.fillText(ln, x + labelW + 22, by)
          ctx.restore()
        }
        by += lineHeight
      }
      cy = by + rowGap * fs
    }
  }
  return cy - y
}

// 辅助：仅计算换行结果（不绘制），返回 lines 和 lineHeight
function wrapTextLines(ctx, text, maxWidth, fontSize, lineHeight, maxLines) {
  ctx.font = `600 ${fontSize}px sans-serif`
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
  const { W, H, movie, cfg, theme, landscape, fs, specs, ratings, personal, posterImg } = p
  const fontFamily = FONTS[theme.font]
  const ink = theme.ink
  const contentBottom = H - P - 50

  if (landscape) {
    const pw = W * 0.38
    drawImageCover(ctx, posterImg, P, P, pw, H - P * 2, false)
    const tx = P + pw + 44
    const tw = W - tx - P
    let cy = P
    const { height: th } = drawTitle(ctx, movie.title, tx, cy, tw, { fontSize: 74 * fs, color: ink, fontFamily, fontWeight: 900, lineHeight: 1.02, maxLines: 2, maxY: contentBottom, letterSpacing: -0.02 * 74 * fs })
    cy += th + 16
    if (cfg.showYear && movie.year) {
      const { height: yh } = drawText(ctx, movie.year, tx, cy, tw, { fontSize: 22 * fs, color: ink, fontFamily, opacity: 0.55 })
      cy += yh + 16
    }
    cy += drawRatings(ctx, tx, cy, tw, { movie, cfg, ratings, personal, theme, fs: fs * 0.9 }) + 16
    if (cfg.showOverview && movie.overview) {
      const { height: oh } = drawText(ctx, movie.overview, tx, cy, tw, { fontSize: 20 * fs, color: ink, fontFamily, lineHeight: 1.55, maxLines: 3, maxY: contentBottom, opacity: 0.78 })
      cy += oh + 16
    }
    const creditsRows = buildCreditsRows(movie, cfg)
    cy += drawInfoList(ctx, tx, cy, tw, creditsRows, { maxY: contentBottom,  fs: fs * 0.92, labelColor: ink, valueColor: ink, fontFamily }) + 12
    const specsRows = buildSpecsRows(specs, cfg)
    drawInfoList(ctx, tx, cy, tw, specsRows, { maxY: contentBottom,  fs: fs * 0.86, labelColor: ink, valueColor: ink, fontFamily })
    // 底部水印
    const fy = H - P - 20
    ctx.strokeStyle = 'rgba(128,128,128,0.35)'
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(tx, fy); ctx.lineTo(W - P, fy); ctx.stroke()
    drawText(ctx, 'lumenframe', tx, fy + 8, tw, { fontSize: 16, color: ink, fontFamily, opacity: 0.5, letterSpacing: 0.34 * 16, transform: 'uppercase' })
  } else {
    const ph = (H - P * 3) * 0.52
    drawImageCover(ctx, posterImg, P, P, W - P * 2, ph, false)
    let cy = P + ph + 28
    const tw = W - P * 2
    const { height: th } = drawTitle(ctx, movie.title, P, cy, tw, { fontSize: 60 * fs, color: ink, fontFamily, fontWeight: 900, lineHeight: 1.02, maxLines: 2, maxY: contentBottom, letterSpacing: -0.02 * 60 * fs })
    cy += th + 16
    if (cfg.showYear && movie.year) {
      const { height: yh } = drawText(ctx, movie.year, P, cy, tw, { fontSize: 22 * fs, color: ink, fontFamily, opacity: 0.55 })
      cy += yh + 16
    }
    cy += drawRatings(ctx, P, cy, tw, { movie, cfg, ratings, personal, theme, fs: fs * 0.92 }) + 16
    if (cfg.showOverview && movie.overview) {
      const { height: oh } = drawText(ctx, movie.overview, P, cy, tw, { fontSize: 22 * fs, color: ink, fontFamily, lineHeight: 1.55, maxLines: 3, maxY: contentBottom, opacity: 0.78 })
      cy += oh + 16
    }
    const creditsRows = buildCreditsRows(movie, cfg)
    cy += drawInfoList(ctx, P, cy, tw, creditsRows, { maxY: contentBottom,  fs: fs * 0.95, labelColor: ink, valueColor: ink, fontFamily }) + 12
    const specsRows = buildSpecsRows(specs, cfg)
    drawInfoList(ctx, P, cy, tw, specsRows, { maxY: contentBottom,  fs: fs * 0.9, labelColor: ink, valueColor: ink, fontFamily })
    const fy = H - P - 20
    ctx.strokeStyle = 'rgba(128,128,128,0.35)'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(P, fy); ctx.lineTo(W - P, fy); ctx.stroke()
    drawText(ctx, 'lumenframe', P, fy + 8, tw, { fontSize: 16, color: ink, fontFamily, opacity: 0.5, letterSpacing: 0.34 * 16, transform: 'uppercase' })
  }
}

// 2. Magazine：海报铺底
function drawMagazine(ctx, p) {
  const { W, H, movie, cfg, theme, landscape, fs, specs, ratings, personal, posterImg } = p
  const fontFamily = FONTS[theme.font]
  const ink = theme.ink
  const contentBottom = H - P - 50

  drawImageCover(ctx, posterImg, 0, 0, W, H, false)
  // 渐变遮罩
  let scrim
  if (landscape) {
    scrim = linearGradient(ctx, 0, 0, W, 0, [[0, 'rgba(0,0,0,0.95)'], [0.36, 'rgba(0,0,0,0.8)'], [0.7, 'rgba(0,0,0,0.3)'], [1, 'rgba(0,0,0,0.2)']])
  } else {
    scrim = linearGradient(ctx, 0, 0, 0, H, [[0, 'rgba(0,0,0,0.4)'], [0.28, 'rgba(0,0,0,0.2)'], [0.58, 'rgba(0,0,0,0.75)'], [1, 'rgba(0,0,0,0.96)']])
  }
  ctx.fillStyle = scrim
  ctx.fillRect(0, 0, W, H)

  const tw = landscape ? W * 0.54 : W - P * 2
  const tx = landscape ? P : P
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
        // 估算高度
        heights[i] = 50 * fs * 0.8
      } else if (item.type === 'credits') {
        heights[i] = buildCreditsRows(movie, cfg).length * (21 * fs * 0.8 * 1.25 + 11 * fs * 0.8)
      } else if (item.type === 'specs') {
        heights[i] = buildSpecsRows(specs, cfg).length * (19 * fs * 0.72 * 1.25 + 9 * fs * 0.72) + 30
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
    drawText(ctx, 'Now Showing', tx, cy, tw, { fontSize: 14 * fs, color: theme.accent, fontFamily, letterSpacing: 0.45 * 14 * fs, transform: 'uppercase' })
    cy += 14 * fs * 1.25 + 8
    const { height: th } = drawTitle(ctx, movie.title, tx, cy, tw, { fontSize: 80 * fs, color: ink, fontFamily, fontWeight: 900, lineHeight: 0.98, maxLines: 2, maxY: contentBottom, letterSpacing: -0.02 * 80 * fs, transform: 'uppercase' })
    cy += th + 8
    if (cfg.showYear && movie.year) {
      const { height: yh } = drawText(ctx, movie.year, tx, cy, tw, { fontSize: 22 * fs, color: ink, fontFamily, opacity: 0.7 })
      cy += yh + 12
    }
    cy += drawRatings(ctx, tx, cy, tw, { movie, cfg, ratings, personal, theme, fs: fs * 0.8 }) + 12
    if (cfg.showOverview && movie.overview) {
      cy += drawText(ctx, movie.overview, tx, cy, tw, { fontSize: 18 * fs, color: ink, fontFamily, lineHeight: 1.5, maxLines: 3, maxY: contentBottom, opacity: 0.88 }).height + 12
    }
    const cRows = buildCreditsRows(movie, cfg)
    cy += drawInfoList(ctx, tx, cy, tw, cRows, { maxY: contentBottom,  fs: fs * 0.8, labelColor: ink, valueColor: ink, fontFamily }) + 10
    const sRows = buildSpecsRows(specs, cfg)
    drawInfoList(ctx, tx, cy, tw, sRows, { maxY: contentBottom,  fs: fs * 0.72, labelColor: ink, valueColor: ink, fontFamily })
  } else {
    drawText(ctx, 'Now Showing', tx, cy, tw, { fontSize: 14 * fs, color: theme.accent, fontFamily, letterSpacing: 0.45 * 14 * fs, transform: 'uppercase' })
    cy += 14 * fs * 1.25 + 8
    cy += drawTitle(ctx, movie.title, tx, cy, tw, { fontSize: 72 * fs, color: ink, fontFamily, fontWeight: 900, lineHeight: 0.98, maxLines: 2, maxY: contentBottom, letterSpacing: -0.02 * 72 * fs, transform: 'uppercase' }).height + 8
    if (cfg.showYear && movie.year) cy += drawText(ctx, movie.year, tx, cy, tw, { fontSize: 22 * fs, color: ink, fontFamily, opacity: 0.7 }).height + 12
    cy += drawRatings(ctx, tx, cy, tw, { movie, cfg, ratings, personal, theme, fs: fs * 0.8 }) + 12
    if (cfg.showOverview && movie.overview) cy += drawText(ctx, movie.overview, tx, cy, tw, { fontSize: 18 * fs, color: ink, fontFamily, lineHeight: 1.5, maxLines: 3, maxY: contentBottom, opacity: 0.88 }).height + 12
    const cRows = buildCreditsRows(movie, cfg)
    cy += drawInfoList(ctx, tx, cy, tw, cRows, { maxY: contentBottom,  fs: fs * 0.8, labelColor: ink, valueColor: ink, fontFamily }) + 10
    const sRows = buildSpecsRows(specs, cfg)
    drawInfoList(ctx, tx, cy, tw, sRows, { maxY: contentBottom,  fs: fs * 0.72, labelColor: ink, valueColor: ink, fontFamily })
  }
}

// 辅助：计算文字高度（不绘制）
function wrapTextHeight(ctx, text, maxWidth, fontSize, lineHeight, maxLines) {
  ctx.font = `normal ${fontSize}px sans-serif`
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

// 3. Noir
function drawNoir(ctx, p) {
  const { W, H, movie, cfg, theme, landscape, fs, specs, ratings, personal, posterImg } = p
  const fontFamily = FONTS[theme.font]
  const ink = theme.ink
  const contentBottom = H - P - 50

  if (landscape) {
    const pw = W * 0.52
    drawImageCover(ctx, posterImg, 0, 0, pw, H, true)
    const tx = pw + 48
    const tw = W - tx - 48
    let cy = H / 2 - 130
    cy += drawText(ctx, 'A Film', tx, cy, tw, { fontSize: 16 * fs, color: ink, fontFamily, letterSpacing: 0.4 * 16 * fs, transform: 'uppercase', opacity: 0.5 }).height + 10
    cy += drawTitle(ctx, movie.title, tx, cy, tw, { fontSize: 64 * fs, color: ink, fontFamily, fontWeight: 900, lineHeight: 1, maxLines: 2, maxY: contentBottom }).height + 10
    if (cfg.showYear && movie.year) cy += drawText(ctx, movie.year, tx, cy, tw, { fontSize: 20 * fs, color: ink, fontFamily, opacity: 0.5 }).height + 14
    cy += drawRatings(ctx, tx, cy, tw, { movie, cfg, ratings, personal, theme, fs: fs * 0.82 }) + 14
    if (cfg.showOverview && movie.overview) cy += drawText(ctx, movie.overview, tx, cy, tw, { fontSize: 19 * fs, color: ink, fontFamily, lineHeight: 1.5, maxLines: 3, maxY: contentBottom, opacity: 0.6 }).height + 14
    const cRows = buildCreditsRows(movie, cfg)
    cy += drawInfoList(ctx, tx, cy, tw, cRows, { maxY: contentBottom,  fs: fs * 0.82, labelColor: ink, valueColor: ink, fontFamily }) + 12
    const sRows = buildSpecsRows(specs, cfg)
    drawInfoList(ctx, tx, cy, tw, sRows, { maxY: contentBottom,  fs: fs * 0.76, labelColor: ink, valueColor: ink, fontFamily })
  } else {
    const ph = H * 0.55
    drawImageCover(ctx, posterImg, 0, 0, W, ph, true)
    const tx = P
    const tw = W - P * 2
    let cy = ph + 28
    cy += drawText(ctx, 'A Film', tx, cy, tw, { fontSize: 15 * fs, color: ink, fontFamily, letterSpacing: 0.4 * 15 * fs, transform: 'uppercase', opacity: 0.5 }).height + 10
    cy += drawTitle(ctx, movie.title, tx, cy, tw, { fontSize: 54 * fs, color: ink, fontFamily, fontWeight: 900, lineHeight: 1, maxLines: 2, maxY: contentBottom }).height + 10
    if (cfg.showYear && movie.year) cy += drawText(ctx, movie.year, tx, cy, tw, { fontSize: 20 * fs, color: ink, fontFamily, opacity: 0.5 }).height + 14
    cy += drawRatings(ctx, tx, cy, tw, { movie, cfg, ratings, personal, theme, fs: fs * 0.8 }) + 14
    if (cfg.showOverview && movie.overview) cy += drawText(ctx, movie.overview, tx, cy, tw, { fontSize: 19 * fs, color: ink, fontFamily, lineHeight: 1.5, maxLines: 3, maxY: contentBottom, opacity: 0.6 }).height + 14
    const cRows = buildCreditsRows(movie, cfg)
    cy += drawInfoList(ctx, tx, cy, tw, cRows, { maxY: contentBottom,  fs: fs * 0.8, labelColor: ink, valueColor: ink, fontFamily }) + 12
    const sRows = buildSpecsRows(specs, cfg)
    drawInfoList(ctx, tx, cy, tw, sRows, { maxY: contentBottom,  fs: fs * 0.74, labelColor: ink, valueColor: ink, fontFamily })
  }
}

// ============ Ratings：仅显示评分（含个人评分），大尺寸固定排版 ============
function drawRatingsCard(ctx, p) {
  const { W, H, movie, cfg, theme, landscape, ratings, personal, posterImg } = p
  const fontFamily = FONTS[theme.font]
  const ink = theme.ink

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

  const cx = W / 2

  // 顶部电影名
  const titleSize = landscape ? 30 : 26
  drawText(ctx, movie.title, cx, P, W - P * 2, {
    fontSize: titleSize, color: ink, fontFamily, fontWeight: 700,
    lineHeight: 1.1, maxLines: 1, align: 'center', opacity: 0.9,
    transform: 'uppercase', maxY: H - P - 50, ellipsis: false,
  })

  // 收集评分数据
  const items = []
  if (cfg.showRating && typeof movie.rating === 'number') {
    items.push({ value: movie.rating.toFixed(1), label: 'TMDB', color: '#FFFFFF', bg: 'rgba(255,255,255,0.14)', star: '★' })
  }
  if (ratings?.imdb != null) {
    items.push({ value: ratings.imdb.toFixed(1), label: 'IMDb', color: '#1A1500', bg: '#F5C518' })
  }
  if (ratings?.metacritic != null) {
    const c = mcColor(ratings.metacritic)
    items.push({ value: String(ratings.metacritic), label: 'Metascore', color: c.fg, bg: c.bg })
  }
  if (personal > 0) {
    const pc = personalColor(personal)
    items.push({ value: String(personal), label: 'My Score', color: pc.fg, bg: pc.bg, star: '♥' })
  }
  if (items.length === 0) return

  // 块尺寸（所有块统一）
  const numSize = landscape ? 104 : 88
  const labelSize = landscape ? 15 : 13
  const bw = numSize * 1.85          // 块宽
  const bh = numSize + labelSize * 2 + 28 // 块高
  const gap = landscape ? 24 : 20

  // 计算布局
  const singleRow = landscape || items.length <= 3
  let cols, rows
  if (singleRow) {
    cols = items.length
    rows = 1
  } else {
    cols = 2
    rows = Math.ceil(items.length / 2)
  }
  const gridW = cols * bw + (cols - 1) * gap
  const gridH = rows * bh + (rows - 1) * gap
  const startX = cx - gridW / 2
  const startY = H / 2 - gridH / 2

  // 绘制所有块
  items.forEach((it, i) => {
    const r = Math.floor(i / cols)
    const c = i % cols
    const bx = startX + c * (bw + gap)
    const by = startY + r * (bh + gap)
    drawRatingBlock(ctx, bx, by, bw, bh, numSize, labelSize, it)
  })

  // 底部年份（与标题水平对齐：居中）
  if (cfg.showYear && movie.year) {
    drawText(ctx, String(movie.year), cx, H - P, W - P * 2, {
      fontSize: landscape ? 22 : 18, color: ink, fontFamily, fontWeight: 500,
      align: 'center', opacity: 0.6,
    })
  }
}

// 单个评分块：左上角坐标 (x, y)，固定宽高 bw/bh
function drawRatingBlock(ctx, x, y, bw, bh, numSize, labelSize, b) {
  const r = 14
  // 背景
  fillRoundRect(ctx, x, y, bw, bh, r, b.bg)
  // 数字（水平垂直居中偏上）
  ctx.save()
  ctx.font = `800 ${numSize}px sans-serif`
  ctx.fillStyle = b.color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const numCx = x + bw / 2
  const numCy = y + bh * 0.42
  ctx.fillText(b.value, numCx, numCy)
  ctx.restore()
  // 标签（数字下方居中）
  const labelText = b.star ? `${b.star} ${b.label}` : b.label
  drawText(ctx, labelText, numCx, numCy + numSize * 0.55, bw - 24, {
    fontSize: labelSize, color: b.color, fontFamily: 'sans-serif', fontWeight: 600,
    align: 'center', opacity: 0.85, transform: 'uppercase',
  })
}

// ============ Info：所选图片铺底，所有影片信息（含 tech specs）居中展示 ============
function drawInfoCard(ctx, p) {
  const { W, H, movie, cfg, theme, landscape, specs, ratings, personal, posterImg } = p
  const fontFamily = FONTS[theme.font]
  const ink = theme.ink
  const accent = theme.accent

  // 所选图片铺底 + 整体压暗 + 中心径向暗角，保证居中文字在任何画面上都可读
  drawImageCover(ctx, posterImg, 0, 0, W, H, false)
  ctx.fillStyle = 'rgba(0,0,0,0.45)'
  ctx.fillRect(0, 0, W, H)
  const cx = W / 2
  const cy0 = H / 2
  const rg = ctx.createRadialGradient(cx, cy0, Math.min(W, H) * 0.12, cx, cy0, Math.max(W, H) * 0.72)
  rg.addColorStop(0, 'rgba(0,0,0,0.62)')
  rg.addColorStop(0.55, 'rgba(0,0,0,0.42)')
  rg.addColorStop(1, 'rgba(0,0,0,0.28)')
  ctx.fillStyle = rg
  ctx.fillRect(0, 0, W, H)

  const panelW = landscape ? W * 0.68 : W * 0.88
  const x = cx - panelW / 2
  const availH = H - P * 2

  const creditsRows = buildCreditsRows(movie, cfg)
  const specsRows = buildSpecsRows(specs, cfg)
  const hasRatings = cfg.showRatings && (
    (cfg.showRating && typeof movie.rating === 'number') ||
    ratings?.imdb != null || ratings?.metacritic != null || personal > 0
  )
  const hasLists = creditsRows.length > 0 || specsRows.length > 0

  const listOpts = (rows, fs) => ({
    fs, labelSize: 13, valueSize: 19, rowGap: 12, align: 'center',
    labelColor: accent, valueColor: ink, fontFamily,
  })

  // 两遍布局：先测量整组内容高度，自适应缩放直到纵向放得下，再整体垂直居中
  function measure(s) {
    let h = 0
    h += 13 * s * 1.25 + 14 * s                                      // eyebrow
    const titleFs = (landscape ? 56 : 46) * s
    ctx.save(); ctx.font = `900 ${titleFs}px ${fontFamily}`
    h += wrapText(ctx, movie.title, panelW, titleFs, 1.04, 2, false).height
    ctx.restore()
    if (cfg.showYear && movie.year) h += 14 * s + 20 * s * 1.25
    if (hasRatings) h += 14 * s + 47
    if (cfg.showOverview && movie.overview) {
      const ofs = 18 * s
      ctx.save(); ctx.font = `400 ${ofs}px ${fontFamily}`
      h += 16 * s + wrapText(ctx, movie.overview, panelW, ofs, 1.5, 3).height
      ctx.restore()
    }
    if (hasLists) h += 15 * s + 1 + 15 * s
    if (creditsRows.length > 0) {
      h += drawInfoList(ctx, x, 0, panelW, creditsRows, { ...listOpts(creditsRows, s * 0.92), measureOnly: true })
    }
    if (specsRows.length > 0) {
      h += 18 * s + 13 * s * 1.25 + 8 * s
      h += drawInfoList(ctx, x, 0, panelW, specsRows, { ...listOpts(specsRows, s * 0.86), valueSize: 18, rowGap: 11, measureOnly: true })
    }
    return h
  }
  let s = landscape ? 0.95 : 1
  while (measure(s) > availH && s > 0.6) s -= 0.04
  const totalH = measure(s)

  const textShadow = { color: 'rgba(0,0,0,0.55)', blur: 14, offsetX: 0, offsetY: 2 }
  let cy = cy0 - totalH / 2

  // 眉标
  drawText(ctx, 'Film Info', cx, cy, panelW, {
    fontSize: 13 * s, color: accent, fontFamily, fontWeight: 600,
    letterSpacing: 0.42 * 13 * s, transform: 'uppercase', align: 'center',
  })
  cy += 13 * s * 1.25 + 14 * s

  // 片名
  const titleFs = (landscape ? 56 : 46) * s
  cy += drawText(ctx, movie.title, cx, cy, panelW, {
    fontSize: titleFs, color: ink, fontFamily, fontWeight: 900,
    lineHeight: 1.04, maxLines: 2, align: 'center', shadow: textShadow, ellipsis: false,
  }).height

  if (cfg.showYear && movie.year) {
    cy += 14 * s
    cy += drawText(ctx, String(movie.year), cx, cy, panelW, {
      fontSize: 20 * s, color: ink, fontFamily, fontWeight: 500,
      align: 'center', opacity: 0.78, shadow: textShadow,
    }).height
  }

  if (hasRatings) {
    cy += 14 * s
    cy += drawRatings(ctx, x, cy, panelW, { movie, cfg, ratings, personal, theme, fs: 0.85 * s, align: 'center' })
  }

  if (cfg.showOverview && movie.overview) {
    cy += 16 * s
    cy += drawText(ctx, movie.overview, cx, cy, panelW, {
      fontSize: 18 * s, color: ink, fontFamily, fontWeight: 400,
      lineHeight: 1.5, maxLines: 3, align: 'center', opacity: 0.85, shadow: textShadow,
    }).height
  }

  if (hasLists) {
    cy += 15 * s
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(cx - 60 * s, cy + 0.5); ctx.lineTo(cx + 60 * s, cy + 0.5); ctx.stroke()
    cy += 1 + 15 * s
  }

  if (creditsRows.length > 0) {
    cy += drawInfoList(ctx, x, cy, panelW, creditsRows, listOpts(creditsRows, s * 0.92))
  }

  if (specsRows.length > 0) {
    cy += 18 * s
    drawText(ctx, 'Tech Specs', cx, cy, panelW, {
      fontSize: 13 * s, color: accent, fontFamily, fontWeight: 600,
      letterSpacing: 0.34 * 13 * s, transform: 'uppercase', align: 'center',
    })
    cy += 13 * s * 1.25 + 8 * s
    drawInfoList(ctx, x, cy, panelW, specsRows, { ...listOpts(specsRows, s * 0.86), valueSize: 18, rowGap: 11 })
  }
}

const DRAWERS = {
  minimal: drawMinimal,
  magazine: drawMagazine,
  noir: drawNoir,
  ratings: drawRatingsCard,
  info: drawInfoCard,
}

const Card = forwardRef(function Card({ movie, config, width, height, specs, ratings, personal, customImage }, ref) {
  const canvasRef = useRef(null)
  const posterImgRef = useRef(null)

  // 加载卡片主图：优先使用从 Film Stills 挑选的自定义图，否则用 TMDB 官方海报
  useEffect(() => {
    const src = customImage || (movie?.poster_path ? posterUrl(movie.poster_path, 'w1280') : null)
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
  }, [movie?.poster_path, customImage])

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
    const ink = config.bgColor && config.bgColor.toLowerCase() !== def.bg.toLowerCase()
      ? onLight ? '#1B1B1F' : '#FAFAFA'
      : def.ink
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
    drawer(ctx, { W, H, movie, cfg: config, theme, landscape, fs, specs, ratings, personal, posterImg: posterImgRef.current })

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
