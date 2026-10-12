/**
 * DOM 元素引用 + 通用小工具。
 *
 * 这是所有模块共用的底座：它不 import 任何其他模块，谁都可以放心引它。
 * 注意用的是 type="module"，脚本默认 defer，所以这里取元素时 DOM 已经解析完了。
 */

export const messagesEl = document.getElementById('messages');
export const userListEl = document.getElementById('user-list');
export const msgInputEl = document.getElementById('msg-input');
export const fileInputEl = document.getElementById('file-input');

/** HTML 转义。只有少数不方便用 textContent 的地方（拼卡片文字）才需要它 */
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/** 体积格式化：1024 进制，1024 B 以下按字节显示 */
export function formatSize(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return n + ' B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < units.length - 1);
  return n.toFixed(n >= 100 ? 0 : 1) + ' ' + units[i];
}

/** 滚到消息列表底部 */
export function scrollBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

/** 触发浏览器下载 */
export function saveBlob(url, name) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
}

/** 随机 token：用来给「发送中」的图片/文件占位卡片和后来的消息配对 */
export function makeToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
