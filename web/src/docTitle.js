// 标签页标题（浏览器标签栏 / 窗口标题）。
//
// 站内内容链接现在一律新标签页打开，若不设置 document.title，每个标签页都停在
// index.html 里那句静态标题上 —— 开五个片就是五个一模一样的标签，认不出来。
// 所以约定：**内容名在前 + 站点名后缀**，没有名字时回落到 index.html 的静态标题
// （首页与 React 挂载前的首屏都用它，与静态 HTML 保持一致）。
//
// 语言适配来自数据源本身，这里不做翻译：电影片名/简介走 TMDB 的 ?lang=、类型名走
// /api/genres（按语言缓存），各页面在语言切换后重取数据时标题自然跟着变；剧集名来自
// TVmaze，上游没有中文，任何语言下都是英文原名。

const SITE_NAME = 'LUMENFRAME'

// 与 index.html 的 <title> 一字不差
const DEFAULT_TITLE = 'LUMENFRAME - EVERY FRAME TELLS A STORY'

// 设置标签页标题。name 为空 = 回落到默认标题（首页 / 还在加载 / 取名字失败）
export function setDocTitle(name) {
  const text = String(name || '').trim()
  document.title = text ? `${text} - ${SITE_NAME}` : DEFAULT_TITLE
}

// 把标题写进 preopenTab() 占下的那个空白标签页。
//
// 那段是「先占位、await 查到 id 之后再改地址」，占位期间标签页标题是 about:blank，
// 先把能拿到的名字填进去；导航完成后目标页面会用 setDocTitle 覆盖成正式标题。
//
// about:blank 继承 opener 的源，document 可写；被跨源策略挡住或标签页已关闭时静默放弃
// —— 占位标题只是锦上添花，绝不能因此让跳转本身出错。
export function setTabTitle(tab, name) {
  if (!tab) return
  try {
    tab.document.title = String(name || '').trim()
  } catch { /* 静默：见上 */ }
}
