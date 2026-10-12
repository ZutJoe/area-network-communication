/**
 * 代码块语法高亮（轻量自研，不依赖 highlight.js 之类的库，也不走 CDN）。
 *
 * 思路：每种语言由一个「规则表」描述 —— 哪种注释、哪种字符串、数字、语言特色标记、
 * 单词，五类拼成一个正则；命中之后再判断这个词是关键字 / 内置 / 函数 / 属性。
 * 全程只创建 DOM 节点、不拼 HTML，所以代码内容天然免疫 XSS。
 */

// 语言规则表：comment / string / number / accent(语言特色标记) / word
const R = {
  none: /(?!)/,
  cmtJs: /\/\/[^\n]*|\/\*[\s\S]*?\*\//,
  cmtHash: /#[^\n]*/,
  cmtSql: /--[^\n]*|\/\*[\s\S]*?\*\//,
  cmtHtml: /<!--[\s\S]*?-->/,
  cmtCss: /\/\*[\s\S]*?\*\//,
  strJs: /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/,
  strPy: /[rbfu]{0,2}(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')/,
  strSh: /"(?:\\.|[^"\\\n])*"|'[^'\n]*'/,
  num: /\b(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/,
  numCss: /(?:\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|ch|deg|s|ms|fr|pt)?)/,
  word: /[A-Za-z_$][\w$]*/,
  wordDash: /[-\w]+/,
  wordHtml: /[A-Za-z_][\w:-]*/,
  accVar: /\$\{[^}\n]*\}|\$[A-Za-z_]\w*|\$\d|\$[@#?*!-]/,
  accDeco: /@[A-Za-z_][\w.]*/,
  accTag: /<\/?[A-Za-z][\w:-]*|\/?>/,
  accSel: /[.#$][-\w]+|::?[-\w]+/
};

const KW = {
  js: 'var let const function return if else for while do switch case default break continue new delete typeof instanceof in of void this null undefined true false class extends super try catch finally throw await async yield import export from as static get set'.split(' '),
  py: 'def class return if elif else for while break continue import from as pass try except finally raise with lambda global nonlocal del assert yield await async in is not and or None True False self match case walrus'.split(' '),
  sh: 'if then elif else fi for while until do done case esac function return exit export local readonly source echo printf cd pwd set unset trap in'.split(' '),
  sql: 'select from where group by order having insert into values update set delete create table alter drop index join left right inner outer on as and or not null distinct limit offset union all case when then else end primary key foreign references begin commit'.split(' '),
  go: 'package import func var const type struct interface map chan go defer return if else for range break continue switch case default select nil true false string int int64 float64 bool byte rune error'.split(' '),
  java: 'public private protected class interface extends implements static final void int long double float boolean char byte short new return if else for while do switch case default break continue try catch finally throw throws import package this super null true false abstract synchronized volatile transient enum record'.split(' ')
};
const BI = {
  js: 'console Math JSON Object Array String Number Boolean Promise Date RegExp Error window document require module exports process setTimeout setInterval fetch'.split(' '),
  py: 'print len range str int float list dict set tuple open type isinstance enumerate zip map filter sum min max abs sorted format'.split(' '),
  go: 'make new len cap append panic recover fmt'.split(' '),
  java: 'System String Integer Double Math List Map Set ArrayList HashMap'.split(' ')
};

// 语言 profile 缓存：同一种语言只编译一次正则
const profileCache = {};

function profileOf(lang) {
  const key = String(lang || '').toLowerCase().replace(/^language-/, '').trim();
  const mk = (comment, string, number, accent, word, accentType, opts) => {
    const o = opts || {};
    return {
      re: new RegExp([comment, string, number, accent, word]
        .map(r => '(' + r.source + ')').join('|'), 'g'),
      keywords: new Set(o.keywords || []),
      builtins: new Set(o.builtins || []),
      accentType: accentType || null,
      colonProp: !!o.colonProp,
      htmlAttr: !!o.htmlAttr
    };
  };
  let p;
  if (/^(text|plain|txt|none)$/.test(key)) p = { plain: true };
  else if (key === 'json') p = mk(R.none, R.strJs, R.num, R.none, R.word, null, { keywords: ['true', 'false', 'null'] });
  else if (/^(py|python|python3|py3)$/.test(key)) p = mk(R.cmtHash, R.strPy, R.num, R.accDeco, R.word, 'meta', { keywords: KW.py, builtins: BI.py });
  else if (/^(sh|bash|zsh|shell|shellscript|console|terminal|fish)$/.test(key)) p = mk(R.cmtHash, R.strSh, R.num, R.accVar, R.word, 'var', { keywords: KW.sh });
  else if (/^(sql|mysql|postgres|psql|sqlite)$/.test(key)) p = mk(R.cmtSql, R.strSh, R.num, R.none, R.word, null, { keywords: KW.sql });
  else if (/^(html|xml|svg|vue|htm)$/.test(key)) p = mk(R.cmtHtml, R.strJs, R.num, R.accTag, R.wordHtml, 'tag', { htmlAttr: true });
  else if (/^(css|scss|less|sass)$/.test(key)) p = mk(R.cmtCss, R.strJs, R.numCss, R.accSel, R.wordDash, 'selector', { colonProp: true });
  else if (/^(c|cpp|c\+\+|cxx|h|hpp|objc)$/.test(key)) p = mk(R.cmtJs, R.strJs, R.num, R.none, R.word, null, { keywords: KW.java, builtins: ['include', 'define', 'ifdef', 'endif', 'pragma', 'printf', 'malloc', 'free', 'sizeof', 'NULL', 'std'] });
  else if (/^(rs|rust)$/.test(key)) p = mk(R.cmtJs, R.strJs, R.num, R.accDeco, R.word, 'meta', { keywords: (KW.js.concat(['fn', 'let', 'mut', 'impl', 'trait', 'pub', 'use', 'mod', 'match', 'loop', 'unsafe', 'where', 'dyn', 'Some', 'None', 'Ok', 'Err'])), builtins: BI.go });
  else if (/^(go|golang)$/.test(key)) p = mk(R.cmtJs, R.strJs, R.num, R.none, R.word, null, { keywords: KW.go, builtins: BI.go });
  else if (/^(java|kotlin|kt|scala|cs|csharp|php)$/.test(key)) p = mk(R.cmtJs, R.strJs, R.num, R.accDeco, R.word, 'meta', { keywords: KW.java, builtins: BI.java });
  else if (/^(yaml|yml|toml|ini|conf|env|properties)$/.test(key)) p = mk(R.cmtHash, R.strSh, R.num, R.none, R.wordDash, null, { colonProp: true, keywords: ['true', 'false', 'null'] });
  else p = mk(R.cmtJs, R.strJs, R.num, R.none, R.word, null, { keywords: KW.js, builtins: BI.js });
  profileCache[key] = p;
  return p;
}

function cachedProfile(lang) {
  const key = String(lang || '').toLowerCase().replace(/^language-/, '').trim();
  return profileCache[key] || profileOf(key);
}

// 按语言给 token 归类：注释 / 字符串 / 数字 / 关键字 / 内置 / 函数 / 属性
function classifyToken(m, src, end, p) {
  if (m[1]) return 'comment';
  if (m[2]) return 'string';
  if (m[3]) return 'number';
  if (m[4]) return p.accentType;
  const word = m[5];
  if (p.keywords.has(word)) return 'keyword';
  if (p.builtins.has(word)) return 'builtin';
  if (/^\s*\(/.test(src.slice(end, end + 8))) return 'func';
  if (src[end - word.length - 1] === '.') return 'prop';
  if (p.htmlAttr && /^\s*[=:]/.test(src.slice(end, end + 8))) return 'attr';
  if (p.colonProp && /^\s*:/.test(src.slice(end, end + 8))) return 'prop';
  return null;
}

/** 高亮一段代码。返回 DocumentFragment，逐 token 建节点（天然免疫 XSS） */
export function highlightCode(src, lang) {
  const frag = document.createDocumentFragment();
  const p = cachedProfile(lang);
  if (p.plain) { frag.appendChild(document.createTextNode(src)); return frag; }
  const re = p.re;
  re.lastIndex = 0;
  let last = 0, m;
  while ((m = re.exec(src))) {
    if (!m[0]) { re.lastIndex++; continue; }
    if (m.index > last) frag.appendChild(document.createTextNode(src.slice(last, m.index)));
    const type = classifyToken(m, src, re.lastIndex, p);
    if (type) {
      const span = document.createElement('span');
      span.className = 'tok-' + type;
      span.textContent = m[0];
      frag.appendChild(span);
    } else {
      frag.appendChild(document.createTextNode(m[0]));
    }
    last = re.lastIndex;
  }
  if (last < src.length) frag.appendChild(document.createTextNode(src.slice(last)));
  return frag;
}

/** 没写语言标注时，按内容猜一个 */
export function guessLang(code) {
  const s = String(code).trim();
  if (/^[{[]/.test(s) && /"\s*:/.test(s)) return 'json';
  if (/^\s*(?:import|from)\s+[\w.]+|^\s*def\s+\w+\s*\(|^\s*class\s+\w+.*:\s*$|__\w+__\s*=|self\.\w/m.test(s)) return 'python';
  if (/<\/?[a-z!][\w:-]*[^>]*>/i.test(s) && /<\/[a-z]/i.test(s)) return 'html';
  if (/^[.#]?[\w-]+\s*\{[^}]*:[^}]*\}/m.test(s)) return 'css';
  if (/\b(?:SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+SET|CREATE\s+TABLE)\b/i.test(s)) return 'sql';
  if (/^\s*(?:\$|sudo|npm|npx|pnpm|yarn|pip|git|docker|curl|cd|ls|mkdir|rm|cp|mv|chmod|export)\s/m.test(s) || /^#!\/.*(?:sh|bash|python|node)/m.test(s)) return 'bash';
  if (/\bfunc\s+\w+\(|^\s*package\s+\w+\s*$|:=|err\s*!=\s*nil/m.test(s)) return 'go';
  if (/\b(?:public|private|protected)\s+(?:static\s+)?(?:final\s+)?(?:void|class|int|String)\b/.test(s)) return 'java';
  if (/\b(?:const|let|var|function|=>|===|!==)\b/.test(s) || /\bconsole\.\w+\(/.test(s)) return 'js';
  return 'code';
}

/** 判断一段自然语言消息是不是其实是代码（中文占比高就当人话） */
export function looksLikeCode(text) {
  const s = String(text).trim();
  if (s.length < 12) return false;
  const cjk = (s.match(/[\u4e00-\u9fff]/g) || []).length;
  if (cjk / s.length > 0.12) return false;   // 中文占比高 → 当人话
  const lines = s.split('\n');
  let score = 0;
  const bump = (cond, n) => { if (cond) score += n; };
  bump(/^\s*(?:import|from|def|class|function|const|let|var|public|private|package|using|#include|require)\b/m.test(s), 2);
  bump(/^\s*(?:npm|npx|pnpm|yarn|pip3?|git|sudo|docker|curl|cd|ls|mkdir|rm|cp|mv|chmod)\s/m.test(s), 2);
  bump(/^#!\/|^\s*\/\/|^\s*\/\*/m.test(s), 1);
  bump(/=>|->|===|!==|:=|\+\+|&&|\|\||\?\?|::|<\/?\w+>/.test(s), 1.5);
  bump(/[{}]\s*$|;\s*$/m.test(s), 1);
  bump(/\w+(?:\.\w+)*\s*\([^)]*\)/.test(s), 1);   // 函数调用
  bump(/\b\w+\s*=\s*(?!=)/.test(s), 0.5);          // 赋值
  bump(/^\s{2,}\S/m.test(s), 1);                    // 缩进
  bump(/\w+\.\w+\(/.test(s), 0.5);                  // 方法调用
  bump(/:\s*$/m.test(s) && lines.length > 1, 1);    // 以冒号结尾的多行块
  return score >= 3;
}
