/**
 * 复制到剪贴板。
 *
 * 局域网里页面走的是 http://192.168.x.x，不是安全上下文，
 * navigator.clipboard 直接用不了，所以必须留一条 execCommand 的兜底路径。
 */

export function copyText(text, btn) {
  const done = () => {
    const old = btn.textContent;
    btn.textContent = '已复制';
    setTimeout(() => { btn.textContent = old; }, 1200);
  };
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(done).catch(() => legacyCopy(text) && done());
  } else if (legacyCopy(text)) {
    done();
  }
}

function legacyCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove();
  return ok;
}
