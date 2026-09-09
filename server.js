const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// Serve static assets
app.use(express.static(PUBLIC_DIR));

// Fallback routes
app.get('/join', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'join.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Find Local IP for Wi-Fi / LAN
function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

const localIp = getLocalIp();

// Socket.io Real-time rooms
io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('host_init', ({ room }) => {
    currentRoom = room;
    socket.join(room);
  });

  socket.on('participant_join', (data) => {
    if (data && data.room) {
      socket.to(data.room).emit('participant_joined', data);
    }
  });

  socket.on('lottery_winners', ({ room, winners }) => {
    if (room) {
      socket.to(room).emit('lottery_winners', { winners });
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('====================================================');
  console.log('🎉 Сервер QR-Лотереи запущен!');
  console.log('----------------------------------------------------');
  console.log(`🖥️  Экран для проектора (ноутбук):`);
  console.log(`    http://localhost:${PORT}`);
  console.log(`    http://${localIp}:${PORT}`);
  console.log(`📱 Ссылка для участников (Wi-Fi):`);
  console.log(`    http://${localIp}:${PORT}/join.html`);
  console.log('----------------------------------------------------');
  console.log('💡 Для работы через GitHub Pages просто выложите');
  console.log('   файлы на GitHub — всё работает прямо из браузера!');
  console.log('====================================================');
});
