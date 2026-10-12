/**
 * 入口：把各功能模块装配起来。
 *
 * 只做两件事 —— 把服务器推来的事件分发给对应的功能模块，再把各模块的初始化跑一遍。
 * 事件路由集中在这里，其他模块之间就不会互相引用成环（谁也不用知道谁在监听什么）。
 */
import { socket } from './socket.js';
import { renderUserList } from './users.js';
import { appendMessage } from './messages.js';
import { handleImageMessage } from './image.js';
import { handleFileOffer, handleSignal } from './p2p.js';
import { initLightbox } from './lightbox.js';
import { initCompose } from './compose.js';

/* ---------- 服务器 → 页面 ---------- */

socket.on('user-list', renderUserList);

socket.on('message', (data) => {
  if (data.type === 'file-offer') return handleFileOffer(data);
  if (data.type === 'image') return handleImageMessage(data);
  appendMessage(data);
});

socket.on('signal', handleSignal);   // WebRTC 信令

/* ---------- 初始化 ---------- */

initLightbox();
initCompose();
