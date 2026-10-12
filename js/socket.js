/**
 * 与服务端的实时连接。
 *
 * 全项目只有这一个模块持有 socket 实例，其他模块 import 使用，
 * 事件的路由（收到 message / signal 之后分给谁）统一放在 main.js 里，
 * 这样各功能模块之间不会互相引用成环。
 *
 * socket.io 客户端由 index.html 的 <script src="/socket.io/socket.io.js"> 提供；
 * 万一没加载成功（比如离线预览页忘了打桩），退化成空实现，页面不至于直接报错。
 */
export const socket = (typeof io === 'function') ? io() : { on() {}, emit() {} };
