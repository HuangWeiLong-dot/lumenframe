// Canvas 绘制工具：圆角矩形、文字换行截断、图片 cover 绘制、评分徽章

// 圆角矩形路径（模块内部使用）
function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

// 填充圆角矩形
export function fillRoundRect(ctx, x, y, w, h, r, fill) {
  roundRectPath(ctx, x, y, w, h, r)
  ctx.fillStyle = fill
  ctx.fill()
}

// 描边圆角矩形（仅 drawChip 内部使用）
function strokeRoundRect(ctx, x, y, w, h, r, stroke, lineWidth = 1) {
  roundRectPath(ctx, x, y, w, h, r)
  ctx.strokeStyle = stroke
  ctx.lineWidth = lineWidth
  ctx.stroke()
}

// 文字换行，返回 { lines: string[], height: number }
// maxLines = 0 表示不限制行数
export function wrapText(ctx, text, maxWidth, fontSize, lineHeight = 1.25, maxLines = 0, ellipsis = true) {
  const words = String(text).split(/\s+/)
  const lines = []
  let line = ''
  for (const word of words) {
    const test = line ? line + ' ' + word : word
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line)
      line = word
      if (maxLines && lines.length >= maxLines) break
    } else {
      line = test
    }
  }
  if (!maxLines || lines.length < maxLines) {
    if (line) lines.push(line)
  }
  // 最后一行截断：加省略号或直接截断
  if (maxLines && lines.length === maxLines) {
    let last = lines[maxLines - 1]
    const suffix = ellipsis ? '…' : ''
    const targetWidth = maxWidth - (ellipsis ? ctx.measureText('…').width : 0)
    while (last && ctx.measureText(last).width > targetWidth) {
      last = last.slice(0, -1)
    }
    lines[maxLines - 1] = last + suffix
  }
  const lh = fontSize * lineHeight
  return { lines, height: lines.length * lh, lineHeight: lh }
}

// 绘制多行文字，返回实际占用高度
export function drawText(ctx, text, x, y, maxWidth, opts = {}) {
  const {
    fontSize = 16,
    color = '#000',
    fontWeight = 'normal',
    fontFamily = 'sans-serif',
    lineHeight = 1.25,
    maxLines = 0,
    align = 'left',
    opacity = 1,
    letterSpacing = 0,
    transform = 'none', // 'uppercase' | 'lowercase' | 'none'
    shadow = null,
    baseline = 'top',
    maxY = Infinity, // 文字底部不超过此 y，自动缩减行数避免溢出
    ellipsis = true, // 截断时是否加省略号
  } = opts

  let displayText = String(text || '')
  if (transform === 'uppercase') displayText = displayText.toUpperCase()
  if (transform === 'lowercase') displayText = displayText.toLowerCase()

  // 根据 maxY 自动限制行数，避免文字被裁剪显示一半
  const lineH = fontSize * lineHeight
  const availLines = Math.floor((maxY - y) / lineH)
  let effMaxLines = maxLines
  if (maxY !== Infinity) {
    effMaxLines = maxLines ? Math.min(maxLines, availLines) : availLines
    if (effMaxLines <= 0) {
      // 空间不足，不绘制
      return { height: 0, lineHeight: lineH }
    }
  }

  ctx.save()
  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`
  ctx.fillStyle = color
  ctx.globalAlpha = opacity
  ctx.textAlign = align
  ctx.textBaseline = baseline
  if (shadow) {
    ctx.shadowColor = shadow.color
    ctx.shadowBlur = shadow.blur
    ctx.shadowOffsetX = shadow.offsetX || 0
    ctx.shadowOffsetY = shadow.offsetY || 0
  }
  if (letterSpacing) {
    // Canvas 不直接支持 letterSpacing，逐字绘制
    // 注意：空格不应用 letterSpacing，避免负间距导致词粘连
    const charAdvance = (ch) => ctx.measureText(ch).width + (ch === ' ' ? 0 : letterSpacing)
    const { lines, lineHeight: lh } = wrapText(ctx, displayText, maxWidth, fontSize, lineHeight, effMaxLines, ellipsis)
    let cy = y
    for (const line of lines) {
      let cx = x
      if (align === 'center') {
        let totalW = 0
        for (const ch of line) totalW += charAdvance(ch)
        cx = x - totalW / 2
      } else if (align === 'right') {
        let totalW = 0
        for (const ch of line) totalW += charAdvance(ch)
        cx = x - totalW
      }
      for (const ch of line) {
        ctx.fillText(ch, cx, cy)
        cx += charAdvance(ch)
      }
      cy += lh
    }
    ctx.restore()
    return { height: lines.length * lh, lineHeight: lh }
  }
  const { lines, lineHeight: lh } = wrapText(ctx, displayText, maxWidth, fontSize, lineHeight, effMaxLines, ellipsis)
  let cy = y
  for (const line of lines) {
    ctx.fillText(line, x, cy)
    cy += lh
  }
  ctx.restore()
  return { height: lines.length * lh, lineHeight: lh }
}

// 图片 cover 绘制（类似 CSS object-fit: cover）
export function drawImageCover(ctx, img, x, y, w, h, grayscale = false) {
  if (!img || !img.complete || img.naturalWidth === 0) return
  const iw = img.naturalWidth
  const ih = img.naturalHeight
  const imgRatio = iw / ih
  const boxRatio = w / h
  let sx, sy, sw, sh
  if (imgRatio > boxRatio) {
    // 图片更宽，裁剪左右
    sh = ih
    sw = ih * boxRatio
    sx = (iw - sw) / 2
    sy = 0
  } else {
    // 图片更高，裁剪上下
    sw = iw
    sh = iw / boxRatio
    sx = 0
    sy = (ih - sh) / 2
  }
  ctx.save()
  if (grayscale) ctx.filter = 'grayscale(1)'
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h)
  ctx.restore()
}

// 线性渐变
export function linearGradient(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1)
  for (const [offset, color] of stops) g.addColorStop(offset, color)
  return g
}

// Metascore 颜色
export function mcColor(score) {
  if (score >= 61) return { bg: '#66CC33', fg: '#0C2A05' }
  if (score >= 40) return { bg: '#FFCC33', fg: '#332600' }
  return { bg: '#E8402D', fg: '#FFFFFF' }
}

// 个人评分颜色分级：0-3 红，4-6 黄，7-9 绿，10 白
export function personalColor(score) {
  if (score >= 10) return { bg: '#FFFFFF', fg: '#1A1500' }
  if (score >= 7) return { bg: '#66CC33', fg: '#0C2A05' }
  if (score >= 4) return { bg: '#FFCC33', fg: '#332600' }
  return { bg: '#E8402D', fg: '#FFFFFF' }
}

// 绘制评分徽章（Chip，仅 drawRatings 内部使用）
function drawChip(ctx, x, y, opts) {
  const { value, label, bg = 'transparent', fg = '#000', border = null, star = null, valueSize = 25, labelSize = 10 } = opts
  const padX = 14, padY = 8
  const gap = 8
  const starW = star ? 28 : 0
  // 测量内容宽度
  ctx.font = `800 ${valueSize}px sans-serif`
  const valueW = ctx.measureText(String(value)).width
  ctx.font = `${labelSize}px sans-serif`
  const labelW = ctx.measureText(label).width
  const contentW = starW + (star ? gap : 0) + Math.max(valueW, labelW)
  const w = contentW + padX * 2
  const h = valueSize + labelSize * 0.6 + padY * 2
  const r = 12

  // 背景
  if (bg && bg !== 'transparent') {
    fillRoundRect(ctx, x, y, w, h, r, bg)
  }
  if (border) {
    strokeRoundRect(ctx, x, y, w, h, r, border, 1)
  }

  // 内容
  ctx.save()
  ctx.textBaseline = 'top'
  if (star) {
    ctx.font = `24px sans-serif`
    ctx.fillStyle = fg
    ctx.fillText(star, x + padX, y + padY)
  }
  const textX = x + padX + starW + (star ? gap : 0)
  ctx.font = `800 ${valueSize}px sans-serif`
  ctx.fillStyle = fg
  ctx.fillText(String(value), textX, y + padY)
  ctx.font = `${labelSize}px sans-serif`
  ctx.fillStyle = fg
  ctx.globalAlpha = star ? 0.65 : 0.85
  ctx.fillText(label, textX, y + padY + valueSize + 2)
  ctx.restore()

  return { w, h }
}

// 绘制评分行（多个徽章横向排列）
// 测量单个 chip 宽度（与 drawChip 保持一致）
function measureChip(ctx, chip) {
  const { value, label, star = null, valueSize = 25, labelSize = 10 } = chip
  const padX = 14
  const gap = 8
  const starW = star ? 28 : 0
  ctx.font = `800 ${valueSize}px sans-serif`
  const valueW = ctx.measureText(String(value)).width
  ctx.font = `${labelSize}px sans-serif`
  const labelW = ctx.measureText(label).width
  const contentW = starW + (star ? gap : 0) + Math.max(valueW, labelW)
  return contentW + padX * 2
}

export function drawRatings(ctx, x, y, maxWidth, data) {
  const { movie, cfg, ratings, personal, theme, fs = 1, onLight = false, align = 'left' } = data
  if (!cfg.showRatings) return 0
  const chips = []
  if (cfg.showRating && typeof movie.rating === 'number') {
    chips.push({ star: '★', value: movie.rating.toFixed(1), label: 'TMDB · /10', fg: onLight ? '#202023' : theme.ink, border: onLight ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.35)' })
  }
  if (ratings?.imdb != null) chips.push({ value: ratings.imdb.toFixed(1), label: 'IMDb · /10', bg: '#F5C518', fg: '#1A1500' })
  if (ratings?.metacritic != null) {
    const c = mcColor(ratings.metacritic)
    chips.push({ value: ratings.metacritic, label: 'Metascore · /100', bg: c.bg, fg: c.fg })
  }
  if (personal > 0) {
    const accentDark = isDark(theme.accent)
    chips.push({ star: '♥', value: personal, label: 'My score · /10', bg: theme.accent, fg: accentDark ? '#FFFFFF' : '#1A1500' })
  }
  if (chips.length === 0) return 0

  const gap = 10 * fs
  // 测量总宽度用于居中
  const widths = chips.map((c) => measureChip(ctx, c))
  const totalW = widths.reduce((a, b) => a + b, 0) + gap * (chips.length - 1)
  let cx = align === 'center' ? x + (maxWidth - totalW) / 2 : x
  let maxH = 0
  for (let i = 0; i < chips.length; i++) {
    const { w, h } = drawChip(ctx, cx, y, chips[i])
    cx += w + gap
    if (h > maxH) maxH = h
    if (cx > x + maxWidth) break
  }
  return maxH
}

// 简易深色判断
function isDark(hex) {
  if (!hex || !hex.startsWith('#')) return false
  const c = hex.slice(1)
  const r = parseInt(c.slice(0, 2), 16)
  const g = parseInt(c.slice(2, 4), 16)
  const b = parseInt(c.slice(4, 6), 16)
  return (r * 299 + g * 587 + b * 114) / 1000 < 128
}

export { isDark }
