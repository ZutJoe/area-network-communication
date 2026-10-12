/**
 * 代码块的 DOM 与交互：语言标签栏 + 「复制」+（自动识别时）「文本」逃生口。
 *
 * auto: 整段自动识别出来的代码（语言靠猜），给一个「文本」按钮按纯文本看；
 * 没写语言标注的围栏也归为「靠猜」，同样给逃生口。
 */
import { highlightCode, guessLang } from './highlight.js';
import { copyText } from './clipboard.js';

export function buildCodeBlock(code, lang, auto) {
  const label = (lang || '').trim() || guessLang(code);
  const guessed = auto || !(lang || '').trim();
  const wrap = document.createElement('div');
  wrap.className = 'msg-code';

  const bar = document.createElement('div');
  bar.className = 'code-bar';
  const langEl = document.createElement('span');
  langEl.className = 'code-lang';
  langEl.textContent = (label === 'code' && !lang) ? 'code（自动识别）' : label;
  const btns = document.createElement('span');
  btns.className = 'code-btns';
  const copyBtn = document.createElement('button');
  copyBtn.className = 'code-btn';
  copyBtn.type = 'button';
  copyBtn.textContent = '复制';
  copyBtn.onclick = () => copyText(code, copyBtn);
  if (guessed) {
    const textBtn = document.createElement('button');
    textBtn.className = 'code-btn';
    textBtn.type = 'button';
    textBtn.textContent = '文本';
    textBtn.title = '语言识别有误？点这里在本机按普通文本显示（不影响其他人）';
    textBtn.onclick = () => {
      const t = document.createElement('pre');
      t.className = 'md-plain';
      t.textContent = code;
      wrap.replaceWith(t);
    };
    btns.appendChild(textBtn);
  }
  btns.appendChild(copyBtn);
  bar.appendChild(langEl);
  bar.appendChild(btns);

  const pre = document.createElement('pre');
  const codeEl = document.createElement('code');
  codeEl.appendChild(highlightCode(code, label === 'code' ? '' : label));
  pre.appendChild(codeEl);

  wrap.appendChild(bar);
  wrap.appendChild(pre);
  return wrap;
}
