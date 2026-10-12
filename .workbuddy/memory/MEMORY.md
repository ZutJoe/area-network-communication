# 局域网通信工具 —— 项目约定（长期）

## 结构

```
server.js          # Express 静态服务 + Socket.IO + WebRTC 信令转发（CommonJS）
index.html         # 页面骨架：DOM + CSS，【无内联脚本】
js/                # 前端逻辑，ES Modules，入口 main.js
  main.js          # 只做装配 + socket 事件路由，不放业务逻辑
  socket.js        # 全项目唯一持有 socket 实例的地方
  dom.js           # 元素引用 + 通用工具（escapeHtml/formatSize/scrollBottom/saveBlob/makeToken）
  markdown.js highlight.js code-block.js math.js clipboard.js   # 渲染管线
  compose.js users.js messages.js image.js p2p.js lightbox.js   # 功能模块
  package.json     # 只有 {"type":"module"}，标记 ESM 目录，不是独立 npm 包
test/              # render.test.js（npm test）+ preview.js（npm run preview）
```

## 硬性规则

- **不要往 HTML 里加内联脚本**，也不要加 `onclick="..."` 这类内联事件属性（模块化后函数不是全局的，会静默失效）。新按钮给 id，在对应模块的 `initXxx()` 里绑。
- **顶层不要有副作用**：模块顶层只声明，事件监听放 `initXxx()`，由 `main.js` 调用。
- **依赖保持单向**：底座（dom/highlight/math）→ 功能模块 → main。功能模块之间靠 `socket.js` 和 main 的事件路由协作，不互相 import。新卡片/新消息类型的路由加在 `main.js` 的 `socket.on('message')` 分支里。
- **页面必须经服务器访问**。`file://` 打开会因浏览器对 ES 模块的 CORS 限制而功能全死——排版还在，很容易误判成"没生效"。预览页同理，走 `http://localhost:3000/test/preview.html`。
- 新增/修改渲染逻辑后：`npm test`（37 项断言）必须全绿，再 `npm run preview` 肉眼验收。
- 保持**不依赖 CDN**：KaTeX 是本地 npm 依赖，由 `server.js` 的静态服务提供 `/node_modules/katex/dist/…`。

## 已知的非问题

- 控制台会有一条 `favicon.ico` 404（HTML 没有 `<link rel="icon">`，浏览器自动请求）。改造前就有，别当回归。
- `test/preview.html` 是生成物，删了重跑 `npm run preview` 即可。

## 相关技能

`~/.workbuddy/skills/inline-js-to-esm/` —— 拆内联脚本的流程 + 两个校验脚本
（`diff-moved-functions.js` 验搬运无损、`cdp-check.mjs` 不装 Playwright 实测页面）。
