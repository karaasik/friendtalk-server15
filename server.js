// FriendTalk server v2
// Adds: user accounts, friend requests/list, plus existing room chat + WebRTC signaling.

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;

if (!process.env.DATABASE_URL) {
  console.warn('ВНИМАНИЕ: переменная окружения DATABASE_URL не задана. Аккаунты и друзья работать не будут.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDb() {
  if (!process.env.DATABASE_URL) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS friend_requests (
      id SERIAL PRIMARY KEY,
      from_user INTEGER REFERENCES users(id) ON DELETE CASCADE,
      to_user INTEGER REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(from_user, to_user)
    );
  `);
  console.log('База данных готова.');
}
initDb().catch(err => console.error('Ошибка инициализации БД:', err));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function makeToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Не авторизован' });

    const result = await pool.query(
      `SELECT s.user_id, u.username FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = $1`,
      [token]
    );
    if (result.rows.length === 0) return res.status(401).json({ error: 'Сессия недействительна' });

    req.userId = result.rows[0].user_id;
    req.username = result.rows[0].username;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

// ---------- Auth endpoints ----------
app.post('/api/register', async (req, res) => {
  try {
    let { username, password } = req.body || {};
    username = String(username || '').trim().slice(0, 32);
    password = String(password || '');

    if (username.length < 3) return res.status(400).json({ error: 'Имя пользователя должно быть не короче 3 символов' });
    if (password.length < 4) return res.status(400).json({ error: 'Пароль должен быть не короче 4 символов' });

    const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Это имя уже занято' });

    const hash = await bcrypt.hash(password, 10);
    const inserted = await pool.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
      [username, hash]
    );
    const user = inserted.rows[0];

    const token = makeToken();
    await pool.query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, user.id]);

    res.json({ token, username: user.username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось зарегистрироваться' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    let { username, password } = req.body || {};
    username = String(username || '').trim().slice(0, 32);
    password = String(password || '');

    const result = await pool.query('SELECT id, username, password_hash FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) return res.status(400).json({ error: 'Неверное имя или пароль' });

    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(400).json({ error: 'Неверное имя или пароль' });

    const token = makeToken();
    await pool.query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, user.id]);

    res.json({ token, username: user.username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось войти' });
  }
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ id: req.userId, username: req.username });
});

// ---------- Friends endpoints ----------
app.get('/api/users/search', requireAuth, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 32);
    if (!q) return res.json({ users: [] });
    const result = await pool.query(
      `SELECT id, username FROM users
       WHERE username ILIKE $1 AND id != $2
       ORDER BY username LIMIT 10`,
      [`%${q}%`, req.userId]
    );
    res.json({ users: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка поиска' });
  }
});

app.post('/api/friends/request', requireAuth, async (req, res) => {
  try {
    const targetUsername = String((req.body || {}).username || '').trim().slice(0, 32);
    const targetResult = await pool.query('SELECT id FROM users WHERE username = $1', [targetUsername]);
    if (targetResult.rows.length === 0) return res.status(404).json({ error: 'Пользователь не найден' });

    const toUser = targetResult.rows[0].id;
    if (toUser === req.userId) return res.status(400).json({ error: 'Нельзя добавить самого себя' });

    const reverse = await pool.query(
      `SELECT id, status FROM friend_requests WHERE from_user = $1 AND to_user = $2`,
      [toUser, req.userId]
    );
    if (reverse.rows.length > 0) {
      await pool.query(`UPDATE friend_requests SET status = 'accepted' WHERE id = $1`, [reverse.rows[0].id]);
      return res.json({ status: 'accepted' });
    }

    await pool.query(
      `INSERT INTO friend_requests (from_user, to_user, status) VALUES ($1, $2, 'pending')
       ON CONFLICT (from_user, to_user) DO UPDATE SET status = 'pending'`,
      [req.userId, toUser]
    );
    res.json({ status: 'pending' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось отправить заявку' });
  }
});

app.post('/api/friends/respond', requireAuth, async (req, res) => {
  try {
    const { requestId, action } = req.body || {};
    if (!['accept', 'decline'].includes(action)) return res.status(400).json({ error: 'Некорректное действие' });

    const reqResult = await pool.query(
      'SELECT id, from_user, to_user FROM friend_requests WHERE id = $1 AND to_user = $2',
      [requestId, req.userId]
    );
    if (reqResult.rows.length === 0) return res.status(404).json({ error: 'Заявка не найдена' });

    const status = action === 'accept' ? 'accepted' : 'declined';
    await pool.query('UPDATE friend_requests SET status = $1 WHERE id = $2', [status, requestId]);
    res.json({ status });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось ответить на заявку' });
  }
});

app.get('/api/friends', requireAuth, async (req, res) => {
  try {
    const friends = await pool.query(
      `SELECT u.id, u.username FROM friend_requests fr
       JOIN users u ON u.id = CASE WHEN fr.from_user = $1 THEN fr.to_user ELSE fr.from_user END
       WHERE fr.status = 'accepted' AND (fr.from_user = $1 OR fr.to_user = $1)
       ORDER BY u.username`,
      [req.userId]
    );

    const incoming = await pool.query(
      `SELECT fr.id, u.username FROM friend_requests fr
       JOIN users u ON u.id = fr.from_user
       WHERE fr.to_user = $1 AND fr.status = 'pending'
       ORDER BY fr.created_at DESC`,
      [req.userId]
    );

    const outgoing = await pool.query(
      `SELECT fr.id, u.username FROM friend_requests fr
       JOIN users u ON u.id = fr.to_user
       WHERE fr.from_user = $1 AND fr.status = 'pending'
       ORDER BY fr.created_at DESC`,
      [req.userId]
    );

    res.json({
      friends: friends.rows,
      incoming: incoming.rows,
      outgoing: outgoing.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось загрузить друзей' });
  }
});

// ---------- Rooms: text chat + WebRTC signaling ----------
const rooms = new Map();

function getRoomUsers(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  return Array.from(room.entries()).map(([id, data]) => ({ id, username: data.username }));
}

async function usernameFromToken(token) {
  if (!token) return null;
  const result = await pool.query(
    `SELECT u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1`,
    [token]
  );
  return result.rows.length ? result.rows[0].username : null;
}

io.on('connection', (socket) => {
  let currentRoom = null;
  let currentUsername = null;

  socket.on('join-room', async ({ roomId, token, username: fallbackUsername }) => {
    if (!roomId) return;
    roomId = String(roomId).trim().slice(0, 128);
    if (!roomId) return;

    let username = null;
    try { username = await usernameFromToken(token); } catch (e) { }
    if (!username) username = String(fallbackUsername || 'Гость').trim().slice(0, 32);

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

  socket.on('leave-room', () => handleLeave());
  socket.on('disconnect', () => handleLeave());

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
