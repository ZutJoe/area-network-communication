/**
 * 文件传输：WebRTC DataChannel 点对点直传，不经过服务器、不占服务器磁盘。
 *
 * 收发双方都在这一个文件里，因为它们本来就靠同一套信令（socket 的 'signal' 事件）配对：
 *   1. 发送方 broadcast 一条 file-offer，把 token→File 存在 fileMap 里；
 *   2. 接收方点卡片 → 建 RTCPeerConnection、createOffer，经服务器转发信令；
 *   3. 发送方应答 answer，双方把 mDNS 候选改写成真实局域网 IP；
 *   4. 通道打开后接收方发 { req: token }，发送方按 256KB 分片推流，完了发 { done: true }。
 *
 * 注意：P2P 要求收发双方同时在线，发送方刷新页面会让未接收的分享失效。
 */
import { socket } from './socket.js';
import { messagesEl, escapeHtml, formatSize, scrollBottom, saveBlob, makeToken } from './dom.js';
import { appendMessage } from './messages.js';
import { showLightbox } from './lightbox.js';

const fileMap = new Map();    // token -> 发送方条目 {file, name, size, mime, sent, noteEl}
const senderPCs = new Map();  // `${from}:${token}` -> RTCPeerConnection（发送方）
const receiving = new Map();  // token -> 接收方状态 {pc, dc, chunks, received, total, meta, fill, card, timer}

// STUN 辅助打洞：绕开 mDNS 候选解析失败等局域网环境问题
const ICE_SERVERS = [{
  urls: ['stun:stun.qq.com:3478', 'stun:stun.miwifi.com:3478', 'stun:stun.l.google.com:19302']
}];
const P2P_TIMEOUT = 20000; // P2P 连接时限，超时报失败

// mDNS 候选改写：浏览器会把本机地址伪装成 xxx.local，
// 局域网内常无法解析导致直连失败。对端真实 IP 已随信令附上，
// 这里直接把 .local 替换成真实 IP，强制走 192.168.0.x 直连。
const MDNS_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.local/gi;

/* ---------- 发送方：广播文件邀请，等待对方点接收 ---------- */

export function sendP2PFile(file) {
  const token = makeToken();
  const entry = {
    file, name: file.name, size: file.size,
    mime: file.type || 'application/octet-stream', sent: 0
  };
  const div = document.createElement('div');
  div.className = 'msg';
  const ip = document.createElement('div');
  ip.className = 'msg-ip';
  ip.textContent = '我（分享文件）';
  const card = document.createElement('div');
  card.className = 'msg-file';
  card.innerHTML = `📄 ${escapeHtml(file.name)}<span class="file-size">${formatSize(file.size)}</span><span class="file-note">等待接收</span>`;
  div.appendChild(ip);
  div.appendChild(card);
  messagesEl.appendChild(div);
  scrollBottom();
  entry.noteEl = card.querySelector('.file-note');
  fileMap.set(token, entry);
  socket.emit('message', {
    type: 'file-offer', token,
    name: file.name, size: file.size, mime: entry.mime
  });
}

function updateSenderNote(entry) {
  if (entry.noteEl) entry.noteEl.textContent = `已发送 ${entry.sent} 人`;
}

/* ---------- 接收方：点击卡片发起 P2P 接收 ---------- */

/** 收到别人的 file-offer（自己发的邀请会被 fileMap 过滤掉） */
export function handleFileOffer(data) {
  if (fileMap.has(data.token)) return; // 自己发的邀请
  appendOfferCard(data);
}

function appendOfferCard(data) {
  const div = document.createElement('div');
  div.className = 'msg';
  const ip = document.createElement('div');
  ip.className = 'msg-ip';
  ip.textContent = data.ip;
  const card = document.createElement('div');
  card.className = 'msg-file';
  card.innerHTML = `📄 ${escapeHtml(data.name)}<span class="file-size">${formatSize(data.size)}</span><span class="file-note">点击接收</span>`;
  const bar = document.createElement('div');
  bar.className = 'progress';
  const fill = document.createElement('div');
  fill.className = 'progress-fill';
  bar.appendChild(fill);
  card.appendChild(bar);
  div.appendChild(ip);
  div.appendChild(card);
  messagesEl.appendChild(div);
  scrollBottom();
  card.onclick = () => requestFile(data, card, card.querySelector('.file-note'), fill);
}

function requestFile(meta, card, noteEl, fill) {
  if (receiving.has(meta.token)) return;
  const state = {
    pc: null, dc: null, chunks: [], received: 0,
    total: meta.size, meta, card, fill, timer: null,
    noteEl
  };
  receiving.set(meta.token, state);
  noteEl.textContent = '连接中…';

  state.timer = setTimeout(() => {
    failReceive(state, '连接超时，P2P 直连未建立（请检查两台设备是否在同一网络）');
  }, P2P_TIMEOUT);

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  state.pc = pc;
  const dc = pc.createDataChannel('file');
  dc.binaryType = 'arraybuffer';
  state.dc = dc;

  dc.onopen = () => {
    clearTimeout(state.timer);
    noteEl.textContent = '传输中…';
    dc.send(JSON.stringify({ req: meta.token }));
  };
  dc.onmessage = (ev) => {
    if (typeof ev.data === 'string') {
      const msg = JSON.parse(ev.data);
      if (msg.error) return failReceive(state, msg.error);
      if (msg.done) return finishReceive(state);
      if (msg.ok) state.total = msg.size;
    } else {
      state.chunks.push(ev.data);
      state.received += ev.data.byteLength;
      fill.style.width = Math.min(100, state.received / state.total * 100) + '%';
    }
  };
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit('signal', { to: meta.sid, data: { token: meta.token, candidate: e.candidate } });
    }
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') {
      failReceive(state, 'P2P 直连失败（当前网络环境不允许设备直连）');
    }
  };

  pc.createOffer()
    .then(o => pc.setLocalDescription(o))
    .then(() => socket.emit('signal', { to: meta.sid, data: { token: meta.token, sdp: pc.localDescription } }))
    .catch(() => failReceive(state, '创建连接失败'));
}

function failReceive(state, reason) {
  if (!receiving.has(state.meta.token)) return;
  receiving.delete(state.meta.token);
  clearTimeout(state.timer);
  const noteEl = state.card.querySelector('.file-note');
  if (noteEl) noteEl.textContent = '接收失败';
  state.card.classList.add('failed');
  state.card.onclick = null;
  appendMessage({
    type: 'system',
    content: `📄 「${state.meta.name}」接收失败：${reason}，请让对方重新分享`
  });
  // 注意：必须在 pc.close() 之前采集统计，关闭后浏览器会清空
  collectDiag(state).then(detail => {
    try { state.pc && state.pc.close(); } catch (e) {}
    appendMessage({ type: 'system', content: `🔎 诊断: ${detail}` });
  }).catch(() => {
    try { state.pc && state.pc.close(); } catch (e) {}
  });
}

// 连接失败诊断：展示对端 IP、SDP 交换情况、双方候选地址与候选对状态
async function collectDiag(state) {
  const parts = [`对端IP: ${state.peerIp || '未知'}`];
  try {
    const desc = state.pc.remoteDescription;
    parts.push(`对端SDP: ${desc && desc.sdp ? '已收到' : '未收到(信令中断)'}`);
    const stats = await state.pc.getStats();
    const locals = new Set(), remotes = new Set(), pairs = [];
    stats.forEach(r => {
      if (r.type === 'local-candidate' && r.address) locals.add(`${r.address}:${r.port}(${r.candidateType})`);
      if (r.type === 'remote-candidate' && r.address) remotes.add(`${r.address}:${r.port}(${r.candidateType})`);
      if (r.type === 'candidate-pair' && r.state) pairs.push(r.state);
    });
    parts.push(`本机候选: ${[...locals].join(', ') || '无(采集失败/被代理拦截)'}`);
    parts.push(`对端候选: ${[...remotes].join(', ') || '无(对端页面旧版或未刷新)'}`);
    parts.push(`候选对: ${pairs.join(',') || '无'}`);
  } catch (e) {
    parts.push(`getStats失败: ${e.message}`);
  }
  return parts.join(' | ');
}

function finishReceive(state) {
  receiving.delete(state.meta.token);
  const { meta } = state;
  const blob = new Blob(state.chunks, { type: meta.mime });
  const url = URL.createObjectURL(blob);
  state.fill.style.width = '100%';
  const noteEl = state.card.querySelector('.file-note');
  if (noteEl) noteEl.remove();

  const ipDiv = state.card.parentElement.querySelector('.msg-ip');
  if (ipDiv) ipDiv.textContent = `${ipDiv.textContent} · 已接收`;

  if (meta.mime.startsWith('image/')) {
    const img = document.createElement('img');
    img.src = url;
    img.title = meta.name + '（点击预览大图）';
    img.onclick = () => showLightbox(url, meta.name, meta.size, url);
    state.card.replaceWith(img);
  } else {
    state.card.classList.remove('msg-file');
    state.card.classList.add('msg-file');
    state.card.onclick = () => saveBlob(url, meta.name);
    const note = document.createElement('span');
    note.className = 'file-note';
    note.textContent = '点击保存';
    state.card.appendChild(note);
  }
  appendMessage({ type: 'system', content: `✅ 「${meta.name}」接收完成（${formatSize(blob.size)}）` });
}

/* ---------- WebRTC 信令 ---------- */

function normalizeIp(raw) {
  return String(raw || '').replace('::ffff:', '').trim();
}

function rewriteSdp(sdp, peerIp) {
  if (!sdp || !sdp.sdp || !peerIp) return sdp;
  return { type: sdp.type, sdp: sdp.sdp.replace(MDNS_RE, peerIp) };
}

function rewriteCandidate(cand, peerIp) {
  if (!cand || !peerIp || !MDNS_RE.test(cand.candidate)) return cand;
  MDNS_RE.lastIndex = 0;
  return new RTCIceCandidate({
    candidate: cand.candidate.replace(MDNS_RE, peerIp),
    sdpMid: cand.sdpMid,
    sdpMLineIndex: cand.sdpMLineIndex,
    usernameFragment: cand.usernameFragment
  });
}

export async function handleSignal({ from, fromIp, data }) {
  const peerIp = normalizeIp(fromIp);
  // 接收方：收到 answer / 对方候选
  const state = data.token && receiving.get(data.token);
  if (state) state.peerIp = peerIp; // 记录对端 IP，供失败诊断
  if (data.sdp && data.sdp.type === 'answer' && state) {
    await state.pc.setRemoteDescription(rewriteSdp(data.sdp, peerIp)).catch(() => {});
  } else if (data.candidate && state) {
    state.pc.addIceCandidate(rewriteCandidate(data.candidate, peerIp)).catch(() => {});
    return;
  }

  // 发送方：收到接收方的 offer，应答并准备通过 datachannel 发流
  if (data.sdp && data.sdp.type === 'offer' && fileMap.has(data.token)) {
    const key = `${from}:${data.token}`;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    senderPCs.set(key, pc);
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit('signal', { to: from, data: { token: data.token, candidate: e.candidate } });
      }
    };
    pc.ondatachannel = (e) => {
      const dc = e.channel;
      dc.binaryType = 'arraybuffer';
      dc.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return;
        const msg = JSON.parse(ev.data);
        if (msg.req && fileMap.has(msg.req)) {
          streamFile(dc, msg.req);
        } else {
          dc.send(JSON.stringify({ error: '文件已不存在（发送方页面已刷新）' }));
        }
      };
    };
    await pc.setRemoteDescription(rewriteSdp(data.sdp, peerIp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('signal', { to: from, data: { token: data.token, sdp: pc.localDescription } });
  } else if (data.candidate) {
    const key = `${from}:${data.token}`;
    const pc = senderPCs.get(key);
    if (pc) pc.addIceCandidate(rewriteCandidate(data.candidate, peerIp)).catch(() => {});
  }
}

async function streamFile(dc, token) {
  const entry = fileMap.get(token);
  const { file } = entry;
  dc.send(JSON.stringify({ ok: true, size: file.size, name: file.name, mime: entry.mime }));
  const CHUNK = 256 * 1024;
  const HIGH_WATER = 4 * 1024 * 1024;
  dc.bufferedAmountLowThreshold = 512 * 1024;
  let offset = 0;
  while (offset < file.size && dc.readyState === 'open') {
    if (dc.bufferedAmount > HIGH_WATER) {
      await new Promise(r => dc.addEventListener('bufferedamountlow', r, { once: true }));
    }
    const buf = await file.slice(offset, offset + CHUNK).arrayBuffer();
    dc.send(buf);
    offset += buf.byteLength;
  }
  if (dc.readyState === 'open') dc.send(JSON.stringify({ done: true }));
  entry.sent += 1;
  updateSenderNote(entry);
}
