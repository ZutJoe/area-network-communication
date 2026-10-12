/**
 * 图片大图预览（lightbox）：点击消息里的图放大看，可下载，Esc 或点背景关闭。
 */
import { formatSize, saveBlob } from './dom.js';

const lightbox = document.getElementById('lightbox');
const lbImg = lightbox.querySelector('.lb-img');
const lbName = lightbox.querySelector('.lb-name');
const lbDownload = lightbox.querySelector('.lb-download');

export function showLightbox(url, name, size, downloadUrl) {
  lbName.textContent = `${name}（${formatSize(size)}）`;
  lbDownload.onclick = () => saveBlob(downloadUrl, name);
  lbImg.src = url;
  lightbox.classList.remove('hidden');
}

export function closeLightbox() {
  lightbox.classList.add('hidden');
  lbImg.src = '';
}

export function initLightbox() {
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) closeLightbox();
  });
  lightbox.querySelector('.lb-close').onclick = closeLightbox;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !lightbox.classList.contains('hidden')) closeLightbox();
  });
}
