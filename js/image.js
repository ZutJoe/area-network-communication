/**
 * 图片消息：小图直接转成 base64 随消息广播，所有人立刻能看到，服务器不落盘。
 * 超过 MAX_IMAGE_B64 的大图交给 p2p.js 走点对点直传。
 */
import { socket } from './socket.js';
import { messagesEl, escapeHtml, formatSize, scrollBottom, makeToken } from './dom.js';
import { showLightbox } from './lightbox.js';

export const MAX_IMAGE_B64 = 10 * 1024 * 1024; // 超过 10MB 的图片改走 P2P

// token -> 发送中的本地占位卡片 {div, ipEl}
const pendingMap = new Map();

export function sendImage(file) {
  const token = makeToken();
  const div = document.createElement('div');
  div.className = 'msg';
  const ip = document.createElement('div');
  ip.className = 'msg-ip';
  ip.textContent = '我（发送中…）';
  const card = document.createElement('div');
  card.className = 'msg-file';
  card.innerHTML = `🖼️ ${escapeHtml(file.name)}<span class="file-size">${formatSize(file.size)}</span>`;
  div.appendChild(ip);
  div.appendChild(card);
  messagesEl.appendChild(div);
  scrollBottom();
  pendingMap.set(token, { div, ipEl: ip });

  const reader = new FileReader();
  reader.onload = () => {
    socket.emit('message', {
      type: 'image', token, name: file.name,
      size: file.size, mime: file.type, content: reader.result
    });
  };
  reader.onerror = () => failImageSend(token);
  reader.readAsDataURL(file);
}

function failImageSend(token) {
  const p = pendingMap.get(token);
  if (!p) return;
  pendingMap.delete(token);
  p.ipEl.textContent = '我（发送失败）';
  const card = p.div.querySelector('.msg-file');
  if (card) card.classList.add('failed');
}

/** 自己发的图片绕回服务器时，把占位卡片换成真图 */
function finalizeImage(data) {
  const p = pendingMap.get(data.token);
  if (!p) return;
  pendingMap.delete(data.token);
  p.ipEl.textContent = '我';
  const old = p.div.querySelector('.msg-file');
  if (old) old.remove();
  p.div.appendChild(buildImage(data.content, data.name, data.size));
  scrollBottom();
}

export function buildImage(src, name, size) {
  const img = document.createElement('img');
  img.src = src;
  img.title = name + '（点击预览大图）';
  img.onclick = () => showLightbox(src, name, size, src);
  img.onerror = () => {
    const tip = document.createElement('div');
    tip.className = 'msg-file expired';
    tip.textContent = `🖼️ 「${name}」图片显示失败`;
    img.replaceWith(tip);
  };
  return img;
}

export function appendImageMessage(data) {
  const div = document.createElement('div');
  div.className = 'msg';
  const ip = document.createElement('div');
  ip.className = 'msg-ip';
  ip.textContent = data.ip;
  div.appendChild(ip);
  div.appendChild(buildImage(data.content, data.name, data.size));
  messagesEl.appendChild(div);
  scrollBottom();
}

/** 收到 type:'image' 广播时的分流（自己发的 → 收尾占位卡片） */
export function handleImageMessage(data) {
  if (data.token && pendingMap.has(data.token)) {
    finalizeImage(data);
    return;
  }
  appendImageMessage(data);
}
