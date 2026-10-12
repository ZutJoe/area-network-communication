/**
 * 左侧在线用户列表。
 */
import { userListEl } from './dom.js';

/** users: [{ id, ip }] */
export function renderUserList(users) {
  userListEl.innerHTML = '';
  users.forEach(u => {
    const div = document.createElement('div');
    div.className = 'user-item';
    div.textContent = u.ip;
    userListEl.appendChild(div);
  });
}
