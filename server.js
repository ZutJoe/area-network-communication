const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const os = require('os');

const app = express();
const httpServer = createServer(app);
// 允许较大的消息（图片以 base64 直发，约可传 18MB 原图）
const io = new Server(httpServer, { maxHttpBufferSize: 25e6 });

app.use(express.static('.'));

const clients = new Map();

// 服务器自身的局域网 IP：本机打开的页面经 localhost 连入时，
// socket 地址是 127.0.0.1，对端拿到它会把候选改写成自己的回环地址，
// 导致直连失败。这里统一把回环地址解析为服务器的真实局域网 IP。
const SERVER_IP = (() => {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
})();

function normalizeClientIp(raw) {
  let ip = String(raw || '').replace('::ffff:', '');
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') ip = SERVER_IP;
  return ip;
}

io.on('connection', (socket) => {
  const rawIp = socket.handshake.headers['x-forwarded-for']?.split(',')[0] ||
                socket.handshake.address;
  const ip = normalizeClientIp(rawIp);

  clients.set(socket.id, ip);

  io.emit('user-list', Array.from(clients, ([id, ip]) => ({ id, ip })));
  io.emit('message', { type: 'system', content: `${ip} 加入了` });

  socket.on('message', (data) => {
    io.emit('message', { ...data, ip, sid: socket.id });
  });

  // WebRTC 信令转发：只转发连接信息，附上发送方真实局域网 IP，供对端改写 mDNS 候选
  socket.on('signal', ({ to, data }) => {
    const target = io.sockets.sockets.get(to);
    if (target) target.emit('signal', { from: socket.id, fromIp: clients.get(socket.id), data });
  });

  socket.on('disconnect', () => {
    clients.delete(socket.id);
    io.emit('user-list', Array.from(clients, ([id, ip]) => ({ id, ip })));
    io.emit('message', { type: 'system', content: `${ip} 离开了` });
  });
});

const PORT = 3000;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('\n局域网通信服务已启动:');
  Object.values(os.networkInterfaces()).flat().forEach((net) => {
    if (net.family === 'IPv4' && !net.internal) {
      console.log(`  http://${net.address}:${PORT}`);
    }
  });
});
