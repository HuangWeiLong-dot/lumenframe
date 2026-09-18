import { absUrl } from '../routes'

// 站内内容链接的统一入口：一律新标签页打开，当前标签页不动。
//
// 用真 <a href target="_blank"> 而不是 window.open：「中键 / Ctrl+点击 /
// 右键『在新标签页打开』/ 键盘 Enter / 悬停看 URL / 复制链接地址」全部由浏览器原生提供，
// 也不会被弹窗拦截。所以**不要在 onClick 里 preventDefault**——那会把新标签页取消掉；
// onClick 只用来做副作用（关搜索下拉、清搜索词）。
//
// 边界：应用壳层的导航（LOGO 回首页、片库按钮、各页的「← 返回」）**不用**这个组件，
// 它们仍旧原地跳转，否则点一下片库就多一个标签页。
export default function NavLink({ to, children, ...rest }) {
  return (
    <a href={absUrl(to)} target="_blank" rel="noopener noreferrer" {...rest}>
      {children}
    </a>
  )
}
