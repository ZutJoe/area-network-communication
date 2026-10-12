/**
 * 输入区：发文本、发文件/图片、粘贴截图、拖拽文件、输入框自动增高。
 */
import { socket } from './socket.js';
import { msgInputEl, fileInputEl } from './dom.js';
import { MAX_IMAGE_B64, sendImage } from './image.js';
import { sendP2PFile } from './p2p.js';

const sendBtn = document.getElementById('send-btn');
const fileBtn = document.getElementById('file-btn');

export function sendMessage() {
  const text = msgInputEl.value.trim();
  if (text) {
    socket.emit('message', { type: 'text', content: text });
    msgInputEl.value = '';
    autoGrowInput();
  }
}

function sendFile() { fileInputEl.click(); }

export function sendFiles(fileList) {
  Array.from(fileList).forEach(file => {
    // 小图片 base64 直发（服务器不存），大图片和其他文件走 P2P
    if (file.type && file.type.startsWith('image/') && file.size <= MAX_IMAGE_B64) sendImage(file);
    else sendP2PFile(file);
  });
}

function autoGrowInput() {
  msgInputEl.style.height = 'auto';
  msgInputEl.style.height = Math.min(msgInputEl.scrollHeight, 180) + 'px';
}

export function initCompose() {
  sendBtn.onclick = sendMessage;
  fileBtn.onclick = sendFile;
  fileInputEl.onchange = () => { sendFiles(fileInputEl.files); fileInputEl.value = ''; };

  msgInputEl.addEventListener('keydown', (e) => {
    // 中文输入法候选框上的回车不发送
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      sendMessage();
    }
  });
  msgInputEl.addEventListener('input', autoGrowInput);

  /* ---------- 粘贴图片 ---------- */
  document.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    let found = false;
    for (const item of items) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (!f) continue;
        found = true;
        let name = f.name;
        if (!name || (f.type.startsWith('image/') && /\.png$/i.test(name))) {
          const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
          name = `剪贴板图片_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.${ext}`;
        }
        sendFiles([new File([f], name, { type: f.type })]);
      }
    }
    if (found) e.preventDefault();
  });

  /* ---------- 拖拽文件 ---------- */
  ['dragover', 'dragenter'].forEach(ev =>
    document.addEventListener(ev, (e) => {
      e.preventDefault();
      document.body.classList.add('dragging');
    })
  );
  document.addEventListener('dragleave', (e) => {
    if (e.target === document.documentElement) document.body.classList.remove('dragging');
  });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    document.body.classList.remove('dragging');
    if (e.dataTransfer && e.dataTransfer.files.length) sendFiles(e.dataTransfer.files);
  });
}
