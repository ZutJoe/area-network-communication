/**
 * 公式渲染：把 LaTeX 源码交给 KaTeX。
 *
 * KaTeX 是本地 npm 依赖，由 index.html 的 <script src="/node_modules/katex/dist/katex.min.js">
 * 引入（不走 CDN，纯局域网/断网也能用）。
 * KaTeX 没加载成功、或者渲染抛错，都降级成显示 LaTeX 源码，绝不白屏。
 */

export function buildMath(tex, display) {
  const el = document.createElement(display ? 'div' : 'span');
  el.className = display ? 'math-block' : 'math-inline';
  const raw = (display ? '$$' : '$') + tex + (display ? '$$' : '$');
  const fallback = () => {
    el.textContent = raw;
    el.classList.add('math-raw');
    el.removeAttribute('aria-hidden');
  };
  // eslint-disable-next-line no-undef
  if (typeof katex === 'undefined' || typeof katex.render !== 'function') { fallback(); return el; }
  try {
    // trust:false —— 禁止 \href / \includegraphics 等可外链或注入的宏；
    // maxExpand 限制 \def 展开，避免一条消息把浏览器卡死。
    katex.render(tex, el, {
      displayMode: !!display,
      throwOnError: false,
      strict: 'ignore',
      trust: false,
      maxSize: 20,
      maxExpand: 1000
    });
  } catch (e) {
    fallback();
  }
  return el;
}
