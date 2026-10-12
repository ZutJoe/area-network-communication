# test/ —— 改渲染逻辑时的保障

改 `js/` 下的消息渲染（Markdown、代码块、公式、安全过滤）**之前先跑一下测试**，
改完再跑一次。

```bash
npm test          # 回归测试：37 项断言，失败会以非 0 退出
npm run preview   # 生成 test/preview.html，浏览器打开肉眼验收样式
```

## npm test（test/render.test.js）

不需要浏览器、不需要 jsdom、也不用打包，跑的是 Node 原生 ESM + 一套手写的最小 DOM stub：

1. 先在 `globalThis` 上装好 DOM stub、KaTeX 桩、`io` 桩（模块里是当全局变量用的）；
2. 用 `await import()` 把 `js/` 下的模块**按线上那套真实模块图**加载进来
   （先 import `main.js`，路径或导出写错会在这步直接炸）；
3. 用真实的 `renderMessageBody()` 渲染用例，再把 DOM 树序列化成字符串做断言；
4. 全部通过退出码 0，有失败打印具体差异并退出码 1。

**覆盖范围**：标题/列表/引用/表格/链接/图片/转义、围栏与裸代码识别、公式（行内、块级、跨行、
金额不误判、代码块内 `$` 不渲染）、安全边界（`javascript:` 链接不给可点、正文 HTML 不建元素节点）、
以及 `appendMessage` 有没有挂到 `dom.js` 里那个 `#messages` 上。
KaTeX 用桩替代，只断言「tex 有没有被正确抽出来」，不验证排版。

## npm run preview（test/preview.js）

拿真实的 `index.html`，只做一处替换（socket.io 换桩），然后在末尾追加一段 module 脚本、
用真实的 `appendMessage()` 灌一批演示消息，输出 `test/preview.html`。

**要经服务器打开**（逻辑是 ES 模块，`file://` 下浏览器不给加载）：

```bash
npm start                                        # 另开一个终端
# 访问 http://localhost:3000/test/preview.html
```

改完 `js/` 里的代码重跑 `npm run preview`，刷新浏览器即可。
`test/preview.html` 是生成物，删了重新跑就行。

## 几个坑，改的时候注意

- **KaTeX 必须 `npm install`**，它是本地依赖、不走 CDN，页面引的是
  `/node_modules/katex/dist/…`。装不上时公式会降级成显示 LaTeX 源码，不会白屏。
- **`js/package.json` 只有 `{"type":"module"}`**，作用是让 Node 把 `js/*.js` 当 ES 模块
  （否则跑测试会报 `MODULE_TYPELESS_PACKAGE_JSON` 警告）。它**不是**独立的 npm 包，别删。
- **`renderInline()` 是递归的**（粗体里还能有斜体），必须每次用独立的正则实例
  `new RegExp(INLINE_RE.source, 'g')`。共用全局正则会被内层递归重置 `lastIndex`，
  外层死循环 → 直接 OOM。
- **`String.prototype.replace` 的替换串里 `$$` 会被折叠成一个 `$`**（`$&`、`$1` 同理）。
  演示页注入数据时踩过：所有 `$$公式$$` 都被改成了 `$公式$`。替换串里含用户数据时
  一律用函数式替换 `replace(x, () => y)`。
- **生成演示页/测试数据时，字符串里出现 `</script>` 会把外层 `<script>` 提前截断**，
  要写 `<\/script>`。
- **有公式的消息要让开「裸代码识别」**（`HAS_MATH_RE`）。否则像
  `$$\sum x_i$$` + `const total = 0` 这种混合内容会被整段贴成代码块、公式就不渲染了。
- **金额误判**靠 `$…$` 的边界规则挡：起始 `$` 后不能是空白、收尾 `$` 前不能是空白、
  收尾 `$` 后不能紧跟数字。
- **改了 `index.html` 的脚本标签结构**（比如换掉 `main.js` 的引入方式），
  `test/preview.js` 开头的 `REQUIRED` 检查会报错——它是故意的，免得生成一个假预览页。
