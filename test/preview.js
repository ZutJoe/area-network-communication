#!/usr/bin/env node
/**
 * 生成离线预览页 —— 用来肉眼验收消息渲染效果（Markdown / 代码块 / 公式）。
 *
 *   npm run preview          （等价于 node test/preview.js）
 *   npm start                （另开一个终端，预览页要经服务器访问）
 *
 * 做法：拿真实的 index.html，只做一处替换 —— 把 socket.io 换成桩（页面离线也能渲染），
 * 然后在末尾追加一段 module 脚本，用真实的 appendMessage() 灌一批演示消息，
 * 输出到 test/preview.html。
 *
 * 为什么要经服务器访问：页面逻辑已经拆成 js/ 下的 ES 模块，
 * 浏览器不允许用 file:// 加载模块（CORS），所以预览页也走 http。
 * 打开 http://localhost:3000/test/preview.html 即可；改完重跑 npm run preview 刷新就行。
 *
 * 它验证的是「样式和排版」；纯逻辑回归交给 test/render.test.js。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'index.html');
const OUT = path.join(__dirname, 'preview.html');

let html = fs.readFileSync(SRC, 'utf8');

// 0) 页面结构变了就先报出来，免得生成一个假的预览页
const REQUIRED = [
  '<script src="/socket.io/socket.io.js"></script>',
  '<script type="module" src="/js/main.js"></script>'
];
const missing = REQUIRED.filter(tag => !html.includes(tag));
if (missing.length) {
  console.error('✗ index.html 里没找到：\n  ' + missing.join('\n  '));
  console.error('  （页面结构可能变了，preview.js 需要跟着调整）');
  process.exit(1);
}

// 1) 把 socket.io 换成桩，让页面离线也能渲染
const ioStub = '<script>window.io = () => ({ on() {}, emit() {} });</script>';
html = html.replace(
  '<script src="/socket.io/socket.io.js"></script>',
  // 用函数式替换：替换串里出现 $$ 会被 String.replace 折叠成一个 $，会把演示数据改坏
  () => ioStub
);

// 2) 演示消息
const PY = `import json, time, websocket

URL = "ws://192.168.0.184:3000/stock-analysis-api/ws/index-realtime"

def on_message(ws, message):
    msg = json.loads(message)
    if msg["type"] == "quote":
        print(msg["data"]["tradeDate"], msg["data"]["latest_price"])
    elif msg["type"] == "ping":
        ws.send("ping")

while True:
    ws = websocket.WebSocketApp(URL, on_message=on_message)
    ws.run_forever(ping_interval=30)
    time.sleep(5)  # 断线重连`;

const PY_ONE_LINE =
  'import json, time, websocket # pip install websocket-client ' +
  'URL = "ws://1.2.3.4:31000/ws" def on_message(ws, message): ' +
  'msg = json.loads(message) if msg["type"] == "quote": print(msg["data"]) ' +
  'elif msg["type"] == "ping": ws.send("ping") time.sleep(5)';

const msgs = [
  ['192.168.0.184', '# 部署说明\n\n今天要做的三件事：\n\n1. 先 `npm install` 装依赖\n2. 改 **config.json** 里的地址\n3. 跑 `npm start`\n\n> 注意：改完配置要重启服务，否则不生效。\n\n| 环境 | 地址 | 备注 |\n|:---|:---|:---|\n| 测试 | 192.168.0.184:3000 | 常开 |\n| 生产 | 10.0.0.9:8080 | 仅内网 |\n\n参考 [官方文档](https://example.com/docs) 或直接看 https://github.com/x/y，斜体 *这样*，删除线 ~~这样~~。\n\n---\n\n以上。'],
  ['192.168.0.184', '代码块（写了语言就没有「文本」按钮）：\n\n```python\n' + PY + '\n```'],
  ['192.168.0.21', '没写语言的围栏 + 直接粘贴的裸代码，都走自动识别：\n\n```\nnpm install\nnpm start\n```\n\n下面这段没写围栏：\n\n' + PY_ONE_LINE],
  ['192.168.0.21', '行内公式 $E=mc^2$、勾股定理 $a^2+b^2=c^2$。\n\n块级单行：\n\n$$E=mc^2$$\n\n块级跨行：\n\n$$\nr_t = \\frac{P_t - P_{t-1}}{P_{t-1}}, \\quad \\sigma = \\sqrt{\\frac{1}{n}\\sum_{i=1}^{n}(x_i-\\bar{x})^2}\n$$'],
  ['192.168.0.33', '矩阵和极限：\n\n$$\nA = \\begin{pmatrix} a_{11} & a_{12} \\\\ a_{21} & a_{22} \\end{pmatrix}, \\quad \\lim_{n \\to \\infty} \\left(1 + \\frac{1}{n}\\right)^n = e\n$$\n\n金额不该被当成公式：这个 $5 到 $10 之间，总价 $100 元。转义 \\$x+y\\$ 也还是文字。'],
  ['192.168.0.33', '表格里放公式：\n\n| 指标 | 定义 |\n|:---|:---|\n| 均值 | $\\mu = \\frac{1}{n}\\sum_{i=1}^{n} x_i$ |\n| 方差 | $\\sigma^2 = \\frac{1}{n}\\sum (x_i - \\mu)^2$ |\n\n- 列表里也可以：$\\alpha + \\beta$\n- 列表第二项\n\n  缩进两格就是嵌套列表'],
  ['192.168.0.9', '注入测试：正文里写 <b>标签</b> 和 <scr' + 'ipt>alert(document.cookie)<\/scr' + 'ipt>，还有 [点我](javascript:alert(1))，都只会当文字显示。\n\n代码块里的 $ 也不渲染：\n\n```bash\necho $HOME\n```\n\n坏公式不会崩：$\\frac{1}{$ 就这样。'],
  ['192.168.0.9', '普通一句话，带个换行\n第二行。行内提到 ``` 三个反引号也不会出问题。'],
];

// 灌数据的是真实的模块，不是复制一份逻辑过来 —— 所以预览页看到的就是线上那套代码
const data = JSON.stringify(msgs).replace(/<\//g, '<\\/');   // 防止 </script> 提前截断
const demo = `
<script type="module">
  import { appendMessage } from '/js/messages.js';
  import { scrollBottom } from '/js/dom.js';
  ${data}.forEach(([ip, content]) => appendMessage({ type: 'text', ip, content }));
  scrollBottom();
</script>
`;

html = html.replace('</body>', () => demo + '</body>');

fs.writeFileSync(OUT, html);
console.log('✓ 已生成 ' + OUT);
console.log('  打开方式（页面逻辑是 ES 模块，不能用 file:// 直接打开）：');
console.log('    1. 另开一个终端跑 npm start');
console.log('    2. 浏览器访问 http://localhost:3000/test/preview.html');
console.log('  改完 js/ 下的代码重跑 npm run preview，然后刷新页面即可。');
if (!fs.existsSync(path.join(ROOT, 'node_modules', 'katex'))) {
  console.log('  ⚠ 没找到 node_modules/katex，公式会降级成显示 LaTeX 源码。先跑 npm install。');
}
