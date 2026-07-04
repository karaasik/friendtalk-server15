// FriendTalk server
// Handles: room membership, text chat, and WebRTC signaling relay

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();

function getRoomUsers(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  return Array.from(room.entries()).map(([id, data]) => ({ id, username: data.username }));
}

io.on('connection', (socket) => {
  let currentRoom = null;
  let currentUsername = null;

  socket.on('join-room', ({ roomId, username }) => {
    if (!roomId || !username) return;
    roomId = String(roomId).trim().slice(0, 64);
    username = String(username).trim().slice(0, 32);
    if (!roomId || !username) return;

    currentRoom = roomId;
    currentUsername = username;

    if (!rooms.has(roomId)) rooms.set(roomId, new Map());
    const room = rooms.get(roomId);

    const existingUsers = getRoomUsers(roomId);
    room.set(socket.id, { username });
    socket.join(roomId);

    socket.emit('room-users', existingUsers);
    socket.to(roomId).emit('user-joined', { id: socket.id, username });

    socket.to(roomId).emit('chat-message', {
      system: true,
      text: `${username} присоединился(ась) к комнате`,
      time: Date.now()
    });
  });

  socket.on('chat-message', (text) => {
    if (!currentRoom || !currentUsername) return;
    text = String(text || '').slice(0, 2000);
    if (!text.trim()) return;
    io.to(currentRoom).emit('chat-message', {
      system: false,
      username: currentUsername,
      text,
      time: Date.now()
    });
  });

  socket.on('webrtc-signal', ({ to, signal }) => {
    if (!to || !signal) return;
    io.to(to).emit('webrtc-signal', { from: socket.id, signal });
  });

  socket.on('leave-room', () => {
    handleLeave();
  });

  socket.on('disconnect', () => {
    handleLeave();
  });

  function handleLeave() {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (room) {
      room.delete(socket.id);
      if (room.size === 0) rooms.delete(currentRoom);
    }
    socket.to(currentRoom).emit('user-left', { id: socket.id });
    if (currentUsername) {
      socket.to(currentRoom).emit('chat-message', {
        system: true,
        text: `${currentUsername} вышел(ла) из комнаты`,
        time: Date.now()
      });
    }
    socket.leave(currentRoom);
    currentRoom = null;
    currentUsername = null;
  }
});

server.listen(PORT, () => {
  console.log(`FriendTalk server running on port ${PORT}`);
});
