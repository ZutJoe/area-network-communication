/**
 * 消息列表渲染：系统提示和地方消息气泡。
 *
 * 图片消息在 image.js、文件分享卡片在 p2p.js，各自的卡片形状差别大，
 * 就跟着各自的功能走；这里只管「谁说了什么」这类通用消息。
 */
import { messagesEl, scrollBottom } from './dom.js';
import { renderMessageBody } from './markdown.js';

export function appendMessage(data) {
  const div = document.createElement('div');
  if (data.type === 'system') {
    div.className = 'msg msg-system';
    div.textContent = data.content;
    messagesEl.appendChild(div);
    scrollBottom();
    return;
  }
  div.className = 'msg';
  const ip = document.createElement('div');
  ip.className = 'msg-ip';
  ip.textContent = data.ip;
  div.appendChild(ip);
  if (data.type === 'text') {
    div.appendChild(renderMessageBody(data.content));
  }
  messagesEl.appendChild(div);
  scrollBottom();
}
