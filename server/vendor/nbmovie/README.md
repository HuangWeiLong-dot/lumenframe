# vendor/nbmovie —— 4kvms 的签名 wasm（第三方代码，勿改）

这个目录放的**不是本项目的代码**，是从 4kvms.com 原样取下来的两个文件。用途只有一个：
算出它家 `/video/play` 接口需要的签名参数（见 `../../sources.js` 的 `nb` 源类型）。

| 文件 | 来源 | 字节数 |
| --- | --- | --- |
| `nbmovie_wasm.js` | `https://www.4kvms.com/static/wasm/nbmovie_wasm.426511b7.js` | 10,965 |
| `nbmovie_wasm_bg.wasm` | `https://www.4kvms.com/static/wasm/nbmovie_wasm_bg.d5d51939.wasm` | 57,856 |

两个 hash 文件名可从播放页 `<link id="wasm-cfg" data-js=… data-bg=…>` 里读到，站点发版会换。

**不要改这两个文件，也不要"整理"它们。** `nbmovie_wasm.js` 是 rustc/wasm-bindgen 生成的胶水
代码，唯一的手工改动需求是把它当 ES module 用——它本来就是。

## 为什么必须用它，而不是自己实现签名

签名算法编译进了 `.wasm`，不在 JS 里。试过反推：拿一组已知样本
`(dataid=30556, secret=ch3uymf4i, q=1080, k=0, t=1789818457896) → 7eefab8b6ea1bac168684e6881be4f16`，
对 87,920 种 token 排列 × 10 种分隔符 × md5/sha1/sha256 全部穷举，无一命中。
不是朴素拼接哈希（大概率是 HMAC 或自定义算法）。所以按原样运行是唯一通路。

## 它有没有网络能力：没有

对 `.wasm` 的 **import 段**（只读字节，不编译不实例化）做静态解析，全部 14 个导入都来自
`./nbmovie_wasm_bg.js`，逐条枚举如下：

```
__wbindgen_is_undefined          __wbg_static_accessor_GLOBAL
__wbindgen_object_drop_ref       __wbg_static_accessor_GLOBAL_THIS
__wbindgen_object_clone_ref      __wbg_static_accessor_WINDOW
__wbindgen_throw                 __wbg_static_accessor_SELF
__wbg_instanceof_Window          __wbg_document
__wbg_instanceof_HtmlMetaElement __wbg_getElementById
__wbg_content                    __wbg_now
```

**无 fetch / XMLHttpRequest / WebSocket / localStorage / 定时器 / eval。** 它读 DOM 只有两处：
`document.getElementById('nb-st').content` 和 `nb-plt` 的 `.content`；取时间只有 `Date.now()`。
全部副作用就是返回一个字符串。

## 在 Node 里跑

站点是在浏览器里 `await import()` 它、用 `fetch()` 加载 wasm 的；Node 里两样都不需要：

```js
const { initSync, build_play_url } = await import('./nbmovie_wasm.js')
initSync({ module: readFileSync(new URL('./nbmovie_wasm_bg.wasm', import.meta.url)) })
```

`initSync` 收字节，**不要**用默认导出的那个异步 `init()`——它默认走
`new URL('nbmovie_wasm_bg.wasm', import.meta.url)` 再交给 `fetch()`，而 Node 的 `fetch` 不认 `file://`。

另外要给全局补一个 `document` 桩 —— wasm 里那两处 DOM 读取是硬性的，没有就会抛
`__wbindgen_throw`。放在 `initSync` 之前最保险：

```js
globalThis.document = { getElementById: () => null }
```

`nb-st` / `nb-plt` 读不到时 wasm 自己会退回 `Date.now()`，**这正是我们要的**——
`nb-st` 是站点每次渲染播放页时签发的毫秒随机数，我们手上那份必然已经过期。

## 法务

那两个文件是 4kvms.com 的产物，不是我们的。`.gitignore` 只忽略了它们
（`nbmovie_wasm.js` / `nbmovie_wasm_bg.wasm`），**不随仓库分发**——线上那台要放一份得手工拷
（同 `sources.json`）；本 README 是我们自己写的，留在版本控制里。同样地，这个源类型只在
`PLAY_SOURCES=1` 且 `sources.json` 里有 `kind:"nb"` 时才启用，线上那份 sources.json 也是手工维护的。
