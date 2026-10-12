#!/usr/bin/env node
/**
 * 消息渲染回归测试 —— 改了 js/ 下的渲染逻辑后跑这个。
 *
 *   npm test            （等价于 node test/render.test.js）
 *
 * 原理：先在 globalThis 上装好最小 DOM stub 和 KaTeX 桩，再用 Node 原生 ESM
 * 把 js/ 里的模块 import 进来，然后调用真实的 renderMessageBody() 渲染用例，
 * 把手搓出来的 DOM 树序列化成字符串做断言。
 * 好处是不用起浏览器、不用装 jsdom、也不用打包，跑一次几百毫秒，适合改完随手跑。
 *
 * 注意：测试覆盖的是「解析 + 建节点」这段逻辑；KaTeX 用桩替代（只断言 tex 有没有
 * 被正确抽出来），真实排版效果要用 test/preview.js 起页面肉眼看。
 */
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');

/* ---------- 最小 DOM stub ---------- */
function makeEl(tag) {
  const el = {
    tagName: tag, className: '', title: '', type: '', value: '', src: '', alt: '',
    style: {}, children: [], _text: null, onclick: null, onerror: null,
    parentElement: null, selectionStart: 0, selectionEnd: 0,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); }
    },
    appendChild(c) { c.parentElement = el; el.children.push(c); return c; },
    remove() {
      if (!el.parentElement) return;
      const i = el.parentElement.children.indexOf(el);
      if (i >= 0) el.parentElement.children.splice(i, 1);
    },
    replaceWith(n) {
      if (!el.parentElement) return;
      const i = el.parentElement.children.indexOf(el);
      if (i >= 0) { el.parentElement.children[i] = n; n.parentElement = el.parentElement; }
    },
    removeAttribute() {},
    querySelector() { return makeEl('div'); },
    setSelectionRange(a, b) { el.selectionStart = a; el.selectionEnd = b; },
    focus() {}, select() {}, addEventListener() {}, setAttribute() {}
  };
  Object.defineProperty(el, 'textContent', {
    get() { return el._text != null ? el._text : el.children.map(c => c.textContent).join(''); },
    set(v) { el._text = String(v); el.children.length = 0; }
  });
  return el;
}

const documentStub = {
  createElement: makeEl,
  createTextNode: (t) => ({ textContent: String(t), _text: String(t), isText: true }),
  createDocumentFragment: () => makeEl('#fragment'),
  getElementById: () => makeEl('div'),
  querySelector: () => makeEl('div'),
  addEventListener: () => {},
  body: makeEl('body'),
  documentElement: makeEl('html')
};

// 模块里是当作全局变量用这些的，所以得先挂到 globalThis 上，再 import 模块。
// navigator 在 Node 22 里已经是只读的 getter，得用 defineProperty 覆盖。
const define = (name, value) => Object.defineProperty(globalThis, name, {
  value, configurable: true, writable: true
});
define('document', documentStub);
define('window', { isSecureContext: false });
define('navigator', {});
define('io', () => ({ on() {}, emit() {} }));
// KaTeX 桩：把传进来的 tex 写进元素，便于断言「公式内容抽取是否正确」
define('katex', {
  render(tex, el, opts) {
    el.textContent = 'MATH{' + tex + '}' + (opts.displayMode ? '@display' : '@inline');
  }
});
define('RTCPeerConnection', function () {});
define('RTCIceCandidate', function () {});
define('FileReader', function () {});
if (!globalThis.URL.createObjectURL) globalThis.URL.createObjectURL = () => '';

const mod = (rel) => import(pathToFileURL(path.join(ROOT, 'js', rel)).href);

(async function main() {
  let messages, markdown, highlight;
  try {
    // 先加载入口：等于把整个模块图走一遍，import 路径或导出写错会在这步就炸出来
    await mod('main.js');
    messages = await mod('messages.js');
    markdown = await mod('markdown.js');
    highlight = await mod('highlight.js');
  } catch (e) {
    console.error('✗ js/ 下的模块加载失败:\n', e);
    process.exit(1);
  }

  /* ---------- 把渲染结果序列化成字符串 ---------- */
  function ser(node) {
    if (!node) return '';
    if (node.isText) return node.textContent;
    if (node.tagName === '#fragment') return node.children.map(ser).join('');
    const cls = node.className ? '.' + node.className : '';
    const inner = node.children.length ? node.children.map(ser).join('') : (node._text || '');
    return `[${node.tagName}${cls}]${inner}[/${node.tagName}]`;
  }
  const render = (md) => ser(markdown.renderMessageBody(md));

  /* ---------- 断言小框架 ---------- */
  let passed = 0;
  const failures = [];

  function check(name, md, { want = [], not = [], eq = null, fn = null } = {}) {
    let out;
    try {
      out = typeof md === 'function' ? md() : render(md);
    } catch (e) {
      failures.push({ name, why: ['抛异常: ' + e.message] });
      return;
    }
    const why = [];
    if (eq !== null && out !== eq) why.push(`期望:\n      ${eq}\n    实际:\n      ${out}`);
    want.forEach(w => { if (!out.includes(w)) why.push(`缺少: ${JSON.stringify(w)}`); });
    not.forEach(n => { if (out.includes(n)) why.push(`不应出现: ${JSON.stringify(n)}`); });
    if (fn) { const r = fn(); if (r !== true) why.push(String(r)); }
    if (why.length) failures.push({ name, why, out });
    else passed++;
  }

  /* ================= Markdown ================= */

  check('标题 / 段落 / 分割线', '# 一级\n\n正文\n\n---\n', {
    want: ['[h1]一级[/h1]', '[p]正文[/p]', '[hr]']
  });

  check('行内：粗体 斜体 删除线 行内代码', '**粗**、*斜*、~~删~~、`码`', {
    want: ['[strong]粗[/strong]', '[em]斜[/em]', '[s]删[/s]', '[code.inline-code]码[/code]']
  });

  check('词内下划线不当作斜体', 'foo_bar_baz', { want: ['foo_bar_baz'], not: ['[em]'] });

  check('无序列表可嵌套', '- a\n  - b\n', {
    want: ['[ul]', '[li][p]a[/p][ul]', '[li][p]b[/p]']
  });

  check('有序列表', '1. a\n2. b\n', { want: ['[ol]', '[li][p]a[/p]', '[li][p]b[/p]'] });

  check('引用可嵌套', '> a\n> > b\n', { want: ['[blockquote][p]a[/p][blockquote]', '[p]b[/p]'] });

  check('表格（含表头）', '| a | b |\n|---|---|\n| 1 | 2 |\n', {
    want: ['[table.md-table]', '[th]a[/th]', '[th]b[/th]', '[td]1[/td]', '[td]2[/td]']
  });

  check('链接', '见 [文档](https://e.com/d)', { want: ['[a]文档[/a]'] });

  check('裸链接不吃后面的中文标点', '见 https://e.com/a，然后 www.qq.com。完', {
    want: ['[a]https://e.com/a[/a]', '[a]www.qq.com[/a]'],
    not: ['e.com/a，']
  });

  check('危险链接不给可点（javascript:/data:）', '[x](javascript:alert(1)) 和 [y](data:text/html,<b>a</b>)', {
    not: ['[a]'],
    want: ['javascript:alert(1']
  });

  check('正文里的 HTML 只当文字（Markdown 路径不建元素节点）', '这句话里写 <b>标签</b> 和 <script>标签</script> 以及 <img src=x>，都只当文字显示。', {
    want: ['[p]', '<b>标签</b>'],
    not: ['[b]', '[script]', '[img]']
  });

  check('HTML + 代码特征 → 走自动识别成代码块，仍然不建元素节点', '有 <b>标签</b> 和 <script>alert(1)</script> 以及 <img src=x onerror=alert(2)>', {
    want: ['[div.msg-code]'],
    not: ['[b]', '[script]', '[img]']
  });

  check('反斜杠转义', '\\*不是斜体\\*', { want: ['*不是斜体*'], not: ['[em]'] });

  check('图片语法（图片加载失败降级成链接）', '![图](https://e.com/a.png)', {
    want: ['[img.md-img]']
  });

  check('空内容不炸', '   ', { eq: '[div.msg-text][/div]' });

  check('图片协议白名单（javascript: 不建 img）', '![坏](javascript:alert(1))', {
    not: ['[img.md-img]']
  });

  /* ================= 代码块 ================= */
  check('围栏代码块：指定语言 → 只给「复制」，不给「文本」', '```python\nimport json\n```', {
    want: ['[span.code-lang]python[/span]', '[span.tok-keyword]import[/span]', '复制'],
    not: ['文本']
  });

  check('围栏代码块：没写语言 → 自动猜 + 给「文本」逃生口', '```\nnpm install\n```', {
    want: ['[span.code-lang]bash[/span]', '文本', '复制']
  });

  check('裸代码自动识别成代码块（原始需求：粘代码要能看）', () => render(
    'import json, time, websocket # pip install websocket-client URL = "ws://1.2.3.4:31000/ws" ' +
    'def on_message(ws, message): msg = json.loads(message) if msg["type"] == "quote": print(msg["data"]) time.sleep(5)'
  ), {
    want: ['[div.msg-code]', '[span.code-lang]python[/span]', '文本'],
    fn: () => highlight.looksLikeCode('import json, time, websocket URL = "ws://x" def on_message(ws, m): print(m)') || 'looksLikeCode 应为 true'
  });

  check('中文闲聊不误判成代码', '今天下午三点开会，麻烦准备一下材料。', {
    want: ['[p]'],
    not: ['[div.msg-code]'],
    fn: () => highlight.looksLikeCode('今天下午三点开会，麻烦准备一下材料。') === false || 'looksLikeCode 应为 false'
  });

  check('英文闲聊不误判成代码', "Let's meet at 3pm, I'll bring the file.", {
    not: ['[div.msg-code]'],
    fn: () => highlight.looksLikeCode("Let's meet at 3pm, I'll bring the file.") === false || 'looksLikeCode 应为 false'
  });

  check('代码块里的 $ 不触发公式', '```bash\necho $HOME\n```', { not: ['MATH{'] });

  /* ================= 数学公式 ================= */
  check('行内公式 $…$', '质能方程 $E=mc^2$ 很简单', {
    want: ['MATH{E=mc^2}@inline']
  });

  check('块级公式 $$…$$（单行）', '$$E=mc^2$$', {
    want: ['MATH{E=mc^2}@display']
  });

  check('块级公式（跨行）', '推导：\n\n$$\n\\frac{a}{b} = c\n$$\n\n完', {
    want: ['MATH{\\frac{a}{b} = c}@display', '[p]推导：[/p]', '[p]完[/p]']
  });

  check('块级公式 \\[…\\]', '\\[\nP_t = P_{t-1}(1+r)\n\\]', {
    want: ['MATH{P_t = P_{t-1}(1+r)}@display']
  });

  check('公式里的 _ 和 * 不被 Markdown 吃掉（正则顺序）', '下标 $a_i * b_j = c_{ij}$ 保留', {
    want: ['MATH{a_i * b_j = c_{ij}}@inline'],
    not: ['[em]', '[strong]']
  });

  check('金额不被误判成公式', '这个 $5 到 $10 之间，总价 $100 元。', {
    want: ['$5 到 $10'],
    not: ['MATH{']
  });

  check('转义美元号 \\$…\\$ 不是公式', '不是公式：\\$x+y\\$ 这样写', {
    want: ['$x+y$'],
    not: ['MATH{']
  });

  check('行内代码里的 $ 不渲染', '用 `$x$` 表示变量', {
    want: ['[code.inline-code]$x$[/code]'],
    not: ['MATH{']
  });

  check('公式出现在列表/表格里也能渲染', '- 收益率 $r = \\frac{P_t}{P_{t-1}}$\n\n| 指标 | 公式 |\n|---|---|\n| 均值 | $\\mu$ |', {
    want: ['MATH{r = \\frac{P_t}{P_{t-1}}}@inline', 'MATH{\\mu}@inline', '[table.md-table]']
  });

  check('未闭合的 $$ 也照收', '$$\nE = mc^2', { want: ['MATH{E = mc^2}@display'] });

  check('坏公式不抛异常（交给 KaTeX 标红）', '$\\frac{1}{$ 就这样', {
    want: ['MATH{']
  });

  // 这条输入同时满足「含公式」和「像代码」（const/npm 开头的行 + 赋值，打分 ≥3）。
  // 没有 HAS_MATH_RE 让路的话，整段会被当成裸代码贴成代码块、公式就不渲染了。
  const MIXED_MATH_CODE = '$$\\sum_{i=1}^{n} x_i$$\n\nconst total = 0;\nnpm run build';

  check('公式让路：同时像代码的消息也不该被整段识别成代码块', MIXED_MATH_CODE, {
    want: ['MATH{\\sum_{i=1}^{n} x_i}@display'],
    not: ['[div.msg-code]'],
    fn: () => highlight.looksLikeCode(MIXED_MATH_CODE) === true
      || '前提不成立：这段输入本应被判为代码，用例失去意义'
  });

  check('带公式的消息不参与裸代码识别', '$$x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$$', {
    want: ['MATH{'],
    not: ['[div.msg-code]'],
    fn: () => highlight.looksLikeCode('$$x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$$') === false || '公式被误判成代码了（HAS_MATH_RE 让路逻辑失效）'
  });

  /* ================= 语言猜测 ================= */
  check('语言猜测抽样', () => JSON.stringify([
    highlight.guessLang('{"a": 1}'), highlight.guessLang('body { color: #fff; }'),
    highlight.guessLang('SELECT id FROM t;'), highlight.guessLang('def f(x):\n    return x'),
    highlight.guessLang('#!/bin/bash\nls -la'), highlight.guessLang('<div class="a">x</div>'),
    highlight.guessLang('const x = () => 1;')
  ]), { eq: '["json","css","sql","python","bash","html","js"]' });

  /* ================= 消息列表 ================= */
  // 顺带验证 messages.js 和 dom.js 的接线：appendMessage 应该挂到 dom.js 里那个 #messages 上
  const dom = await mod('dom.js');
  check('文本消息 / 系统消息都挂到 #messages 里', () => {
    messages.appendMessage({ type: 'text', ip: '192.168.0.9', content: '你好' });
    messages.appendMessage({ type: 'system', content: '甲 加入了' });
    return ser(dom.messagesEl);
  }, {
    want: [
      '[div.msg][div.msg-ip]192.168.0.9[/div][div.msg-text][p]你好[/p][/div][/div]',
      '[div.msg msg-system]甲 加入了[/div]'
    ]
  });

  /* ---------- 汇总 ---------- */
  const total = passed + failures.length;
  console.log(`\n消息渲染回归测试  ${passed}/${total} 通过\n`);
  if (failures.length) {
    failures.forEach(f => {
      console.log(`✗ ${f.name}`);
      f.why.forEach(w => console.log(`    ${w}`));
    });
    console.log(`\n失败 ${failures.length} 项。js/ 下的渲染逻辑可能被改坏了。\n`);
    process.exit(1);
  }
  console.log('✓ 全部通过（Markdown / 代码块 / 公式 / 安全边界）\n');
})();
