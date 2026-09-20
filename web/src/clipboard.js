// 复制到剪贴板。
//
// 非安全上下文（http、部分内嵌 WebView）下 navigator.clipboard 不可用，所以
// 用 textarea + execCommand 兜底。公网 Pages 构建是 https，但本地开发是
// http://localhost —— 那是安全上下文；真正踩到兜底的是局域网 IP 访问和
// 各家 App 的内嵌浏览器。
//
// 返回是否复制成功，调用方据此决定要不要给「已复制」反馈。
export async function copyToClipboard(text) {
  try {
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 继续走降级路径
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '-9999px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
