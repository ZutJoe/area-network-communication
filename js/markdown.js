/**
 * Markdown 解析 + 消息正文渲染入口。
 *
 * 只支持聊天里有用的子集：标题 / 粗斜体 / 删除线 / 行内代码 / 围栏代码块 /
 * 有序无序列表（可嵌套）/ 引用 / 表格 / 分割线 / 链接与图片 / 自动链接 / 公式。
 *
 * 全程只建 DOM 节点、不拼 innerHTML，所以消息里的 <script>、onerror= 之类
 * 永远只会原样显示成文字，不会被执行。
 */
import { buildMath } from './math.js';
import { buildCodeBlock } from './code-block.js';
import { looksLikeCode } from './highlight.js';

const HR_RE = /^[ \t]{0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const FENCE_RE = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*(.*)$/;
const HEAD_RE = /^[ \t]{0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const QUOTE_RE = /^[ \t]{0,3}>[ \t]?/;
const UL_RE = /^([ \t]*)([-*+])[ \t]+(.*)$/;
const OL_RE = /^([ \t]*)(\d{1,9}[.)])[ \t]+(.*)$/;
const FENCE_OPEN_RE = /(?:^|\n)[ \t]{0,3}(?:`{3,}|~{3,})/;

const isBlank = (line) => /^[ \t]*$/.test(line);
const expandTabs = (s) => s.replace(/\t/g, '    ');
const indentWidth = (line) => expandTabs(line).match(/^ */)[0].length;

function isFenceClose(line, marker) {
  const t = line.trim();
  return t.length >= 3 && /^(.)\1*$/.test(t) && t[0] === marker;
}

function isTableSep(line) {
  const t = line.trim();
  return t.includes('-') && /^\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?$/.test(t);
}

function splitRow(line) {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').map(s => s.trim());
}

function isBlockStart(line) {
  const t = line.trim();
  if (t.startsWith('$$') || t.startsWith('\\[')) return true;   // 块级公式
  return FENCE_RE.test(line) || HEAD_RE.test(line) || QUOTE_RE.test(line) ||
         HR_RE.test(line) || UL_RE.test(line) || OL_RE.test(line);
}

const SAFE_URL = /^(?:https?|mailto|ftp):/i;
const SAFE_IMG = /^https?:\/\//i;

// 行内公式 $...$：开头不能是空白、结尾不能是空白，且收尾的 $ 后面不跟数字
//（"$5 到 $10" 这种金额不会被误判成公式）。
const MATH_INLINE_RE = /\$(?<math>[^\s$](?:[^$\n]*[^\s$])?)\$(?!\d)/;
// 是否存在公式（用于让「裸代码自动识别」让路）
const HAS_MATH_RE = new RegExp('(?:^|\\n)[ \\t]*\\$\\$|' + MATH_INLINE_RE.source);

// 行内语法。捕获组用命名组，靠哪个组命中来判断类型。
// 注：正则取「最靠左」的匹配（只有同一起点才按分支先后试），所以下面各分支的
// 顺序不影响结果——公式写在前面只是为了读起来顺，不是必须的。
const INLINE_RE = new RegExp([
  /\\[`*_{}\[\]()#+\-.!~|>$]/.source,                                       // 转义
  MATH_INLINE_RE.source,                                                    // 行内公式
  /`(?<code>[^`\n]+)`/.source,                                              // 行内代码
  /!\[(?<imgAlt>[^\]]*)\]\((?<imgUrl>[^)\s]+)(?:[ \t]+"[^"]*")?\)/.source,   // 图片
  /\[(?<linkText>[^\]]*)\]\((?<linkUrl>[^)\s]+)(?:[ \t]+"[^"]*")?\)/.source, // 链接
  /<(?<auto>[\w+.-]+:\/\/[^>\s]+)>/.source,                                 // <自动链接>
  /(?<bare>(?:https?:\/\/|www\.)[A-Za-z0-9\-._~:\/?#\[\]@!$&*+,;=%]+)/.source,  // 裸链接（只吃 ASCII，避免吞掉后面的中文）
  /\*\*(?<strong>\S[\s\S]*?)\*\*/.source,
  /__(?<strong2>\S[\s\S]*?)__/.source,
  /\*(?<em>\S[\s\S]*?)\*/.source,
  /_(?<em2>\S[\s\S]*?)_/.source,
  /~~(?<strike>\S[\s\S]*?)~~/.source
].join('|'), 'g');

function makeLink(href, text, withTitle) {
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = text;
  if (withTitle && text !== href) a.title = href;
  return a;
}

function inlineNode(m) {
  const g = m.groups;
  if (m[0][0] === '\\') return document.createTextNode(m[0].slice(1));
  if (g.math !== undefined) return buildMath(g.math, false);
  if (g.code !== undefined) {
    const c = document.createElement('code');
    c.className = 'inline-code';
    c.textContent = g.code;
    return c;
  }
  if (g.imgUrl !== undefined) {
    if (!SAFE_IMG.test(g.imgUrl)) return document.createTextNode(m[0]);
    const img = document.createElement('img');
    img.className = 'md-img';
    img.src = g.imgUrl;
    img.alt = g.imgAlt || '';
    img.title = g.imgAlt || '';
    // 图挂了就降级成链接，别留个破图标
    img.onerror = () => img.replaceWith(makeLink(g.imgUrl, g.imgAlt || g.imgUrl, false));
    return img;
  }
  if (g.linkUrl !== undefined) {
    const text = g.linkText || g.linkUrl;
    if (!SAFE_URL.test(g.linkUrl)) {           // javascript: 之类只当纯文本，不给可点
      const f = document.createDocumentFragment();
      f.appendChild(document.createTextNode(text + '（' + g.linkUrl + '）'));
      return f;
    }
    return makeLink(g.linkUrl, text, true);
  }
  if (g.auto !== undefined || g.bare !== undefined) {
    const url = g.auto !== undefined ? g.auto : g.bare;
    const trimmed = url.replace(/[.,;:!?、。，；！？]+$/, '');
    const rest = url.slice(trimmed.length);
    const href = /^www\./i.test(trimmed) ? 'http://' + trimmed
               : SAFE_URL.test(trimmed) ? trimmed : null;
    const f = document.createDocumentFragment();
    f.appendChild(href ? makeLink(href, trimmed, false) : document.createTextNode(trimmed));
    if (rest) f.appendChild(document.createTextNode(rest));
    return f;
  }
  const wrap = (tag, body) => {
    const el = document.createElement(tag);
    el.appendChild(renderInline(body));
    return el;
  };
  if (g.strong !== undefined) return wrap('strong', g.strong);
  if (g.strong2 !== undefined) return wrap('strong', g.strong2);
  if (g.em !== undefined) return wrap('em', g.em);
  if (g.em2 !== undefined) return wrap('em', g.em2);
  if (g.strike !== undefined) return wrap('s', g.strike);
  return document.createTextNode(m[0]);
}

function renderInline(text) {
  const frag = document.createDocumentFragment();
  const src = String(text == null ? '' : text);
  // 强调语法要递归解析，必须每次用独立的正则实例，
  // 共用同一个全局正则会被内层递归重置 lastIndex，导致外层死循环。
  const re = new RegExp(INLINE_RE.source, 'g');
  let last = 0, m;
  while ((m = re.exec(src))) {
    if (!m[0]) { re.lastIndex++; continue; }
    const g = m.groups;
    // 词内的下划线不当作强调（foo_bar_baz）；跳过时它会在下次一并按纯文本输出
    if ((g.em2 !== undefined || g.strong2 !== undefined) && src[m.index - 1] && /[\w]/.test(src[m.index - 1])) continue;
    if (m.index > last) frag.appendChild(document.createTextNode(src.slice(last, m.index)));
    frag.appendChild(inlineNode(m, src));
    last = re.lastIndex;
  }
  if (last < src.length) frag.appendChild(document.createTextNode(src.slice(last)));
  return frag;
}

// 段内换行渲染成 <br>（聊天里更符合直觉）
function inlineWithBreaks(text) {
  const frag = document.createDocumentFragment();
  String(text).split('\n').forEach((line, i) => {
    if (i) frag.appendChild(document.createElement('br'));
    frag.appendChild(renderInline(line));
  });
  return frag;
}

function parseList(lines, start) {
  const m0 = lines[start].match(UL_RE) || lines[start].match(OL_RE);
  const ordered = OL_RE.test(lines[start]);
  const baseIndent = expandTabs(m0[1]).length;
  const list = document.createElement(ordered ? 'ol' : 'ul');
  let i = start;
  while (i < lines.length) {
    const m = lines[i].match(UL_RE) || lines[i].match(OL_RE);
    if (!m) break;
    const indent = expandTabs(m[1]).length;
    if (indent !== baseIndent || OL_RE.test(lines[i]) !== ordered) break;
    const markerLen = m[2].length;
    const content = [m[3]];
    i++;
    while (i < lines.length) {                        // 续行 / 更深缩进（交给递归处理嵌套）
      if (isBlank(lines[i])) {
        if (i + 1 < lines.length && !isBlank(lines[i + 1]) && indentWidth(lines[i + 1]) > indent) {
          content.push(''); i++; continue;
        }
        break;
      }
      if (indentWidth(lines[i]) > indent) {
        content.push(expandTabs(lines[i]).slice(Math.min(indent + markerLen + 1, indentWidth(lines[i]))));
        i++;
        continue;
      }
      break;
    }
    const li = document.createElement('li');
    parseBlocks(content).forEach(n => li.appendChild(n));
    list.appendChild(li);
    if (i < lines.length && isBlank(lines[i])) {
      const nm = i + 1 < lines.length ? (lines[i + 1].match(UL_RE) || lines[i + 1].match(OL_RE)) : null;
      if (nm && expandTabs(nm[1]).length === baseIndent) { i++; continue; }
      break;
    }
  }
  return [list, i];
}

// 块级公式：$$...$$ / \[...\]，可跨行
function matchMathBlock(lines, i) {
  const t = lines[i].trim();
  let open, close;
  if (t.startsWith('$$')) { open = '$$'; close = '$$'; }
  else if (t.startsWith('\\[')) { open = '\\['; close = '\\]'; }
  else return null;
  const single = open === '$$'
    ? t.match(/^\$\$([\s\S]*?)\$\$$/)
    : t.match(/^\\\[([\s\S]*?)\\\]$/);
  if (single && !single[1].includes(close)) {          // 同一行内闭合
    return { node: buildMath(single[1].trim(), true), next: i + 1 };
  }
  const body = [t.slice(open.length)];
  let j = i + 1;
  while (j < lines.length) {
    const at = lines[j].indexOf(close);
    if (at >= 0) { body.push(lines[j].slice(0, at)); break; }
    body.push(lines[j]);
    j++;
  }
  return { node: buildMath(body.join('\n').trim(), true), next: j + 1 };  // 没闭合也照收
}

function parseBlocks(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }

    // 围栏代码块
    const fence = line.match(FENCE_RE);
    if (fence) {
      const marker = fence[1][0];
      const info = fence[2].trim();
      const code = [];
      i++;
      while (i < lines.length && !isFenceClose(lines[i], marker)) { code.push(lines[i]); i++; }
      if (i < lines.length) i++;
      out.push(buildCodeBlock(code.join('\n'), info, false));
      continue;
    }

    // 块级公式
    const math = matchMathBlock(lines, i);
    if (math) { out.push(math.node); i = math.next; continue; }

    // 分割线
    if (HR_RE.test(line)) { out.push(document.createElement('hr')); i++; continue; }

    // 标题
    const head = line.match(HEAD_RE);
    if (head) {
      const h = document.createElement('h' + head[1].length);
      h.appendChild(renderInline(head[2]));
      out.push(h);
      i++;
      continue;
    }

    // 引用（内部递归，可多层）
    if (QUOTE_RE.test(line)) {
      const inner = [];
      while (i < lines.length) {
        if (QUOTE_RE.test(lines[i])) { inner.push(lines[i].replace(QUOTE_RE, '')); i++; continue; }
        if (isBlank(lines[i]) && i + 1 < lines.length && QUOTE_RE.test(lines[i + 1])) { inner.push(''); i++; continue; }
        break;
      }
      const bq = document.createElement('blockquote');
      parseBlocks(inner).forEach(n => bq.appendChild(n));
      out.push(bq);
      continue;
    }

    // 表格
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map(s =>
        /^:-+:$/.test(s) ? 'center' : /-+:$/.test(s) ? 'right' : 'left');
      const table = document.createElement('table');
      table.className = 'md-table';
      const thead = document.createElement('thead');
      const htr = document.createElement('tr');
      head.forEach((cell, k) => {
        const th = document.createElement('th');
        if (align[k]) th.style.textAlign = align[k];
        th.appendChild(renderInline(cell));
        htr.appendChild(th);
      });
      thead.appendChild(htr);
      table.appendChild(thead);
      i += 2;
      const tbody = document.createElement('tbody');
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|')) {
        const cells = splitRow(lines[i]);
        const tr = document.createElement('tr');
        head.forEach((_, k) => {
          const td = document.createElement('td');
          if (align[k]) td.style.textAlign = align[k];
          td.appendChild(renderInline(cells[k] || ''));
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
        i++;
      }
      table.appendChild(tbody);
      out.push(table);
      continue;
    }

    // 列表
    if (UL_RE.test(line) || OL_RE.test(line)) {
      const [list, next] = parseList(lines, i);
      out.push(list);
      i = next;
      continue;
    }

    // 段落
    const buf = [line];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !isBlockStart(lines[i])
           && !(lines[i].includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]))) {
      buf.push(lines[i]);
      i++;
    }
    const p = document.createElement('p');
    p.appendChild(inlineWithBreaks(buf.join('\n')));
    out.push(p);
  }
  return out;
}

/** Markdown 源码 → DocumentFragment */
export function renderMarkdown(src) {
  const frag = document.createDocumentFragment();
  const lines = String(src == null ? '' : src).replace(/\r\n?/g, '\n').split('\n');
  parseBlocks(lines).forEach(n => frag.appendChild(n));
  return frag;
}

/**
 * 消息正文入口：有围栏就按 Markdown 渲染；整段没围栏但明显是代码 → 整块当代码
 * （保留「直接粘贴代码」的手感），其余一律走 Markdown。
 */
export function renderMessageBody(content) {
  const src = String(content == null ? '' : content).replace(/\s+$/, '');
  const bubble = document.createElement('div');
  bubble.className = 'msg-text';
  // 带公式的消息不参与「裸代码自动识别」，否则 $$ 会被当成代码
  if (!FENCE_OPEN_RE.test(src) && !HAS_MATH_RE.test(src) && looksLikeCode(src)) {
    bubble.appendChild(buildCodeBlock(src.replace(/^\n+/, ''), '', true));
    return bubble;
  }
  bubble.appendChild(renderMarkdown(src));
  return bubble;
}
