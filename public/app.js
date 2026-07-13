// FriendTalk client v2 — accounts, friends, rooms with voice/video

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  }
];

const API_BASE = location.origin;

// Registering the service worker is what makes the browser offer "Install app".
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => { /* not critical */ });
  });
}

// ---------- Screens ----------
const authScreen = document.getElementById('auth-screen');
const friendsScreen = document.getElementById('friends-screen');
const chatScreen = document.getElementById('chat-screen');

// ---------- Auth elements ----------
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const authError = document.getElementById('auth-error');
const tabBtns = document.querySelectorAll('.tab-btn');

// ---------- Friends elements ----------
const myUsernameLabel = document.getElementById('my-username-label');
const logoutBtn = document.getElementById('logout-btn');
const notifBtn = document.getElementById('notif-btn');
const themeBtn = document.getElementById('theme-btn');
const themeBtnChat = document.getElementById('theme-btn-chat');
const supportBtn = document.getElementById('support-btn');
const savedBtn = document.getElementById('saved-btn');
const adminBtn = document.getElementById('admin-btn');
const adminPanel = document.getElementById('admin-panel');
const adminUserList = document.getElementById('admin-user-list');
const adminPanelClose = document.getElementById('admin-panel-close');
const profileBtn = document.getElementById('profile-btn');
const myAvatarSlot = document.getElementById('my-avatar-slot');
const avatarPicker = document.getElementById('avatar-picker');
const avatarGrid = document.getElementById('avatar-grid');
const avatarPickerClose = document.getElementById('avatar-picker-close');
const addFriendForm = document.getElementById('add-friend-form');
const addFriendInput = document.getElementById('add-friend-input');
const addFriendMsg = document.getElementById('add-friend-msg');
const incomingBlock = document.getElementById('incoming-block');
const incomingList = document.getElementById('incoming-list');
const outgoingBlock = document.getElementById('outgoing-block');
const outgoingList = document.getElementById('outgoing-list');
const friendsList = document.getElementById('friends-list');
const noFriendsMsg = document.getElementById('no-friends-msg');
const groupRoomForm = document.getElementById('group-room-form');
const groupRoomInput = document.getElementById('group-room-input');

// ---------- Call banner ----------
const callBanner = document.getElementById('call-banner');
const callBannerText = document.getElementById('call-banner-text');
const callAcceptBtn = document.getElementById('call-accept-btn');
const callDeclineBtn = document.getElementById('call-decline-btn');

// ---------- Chat elements ----------
const roomNameLabel = document.getElementById('room-name-label');
const callTimerEl = document.getElementById('call-timer');
const videoGrid = document.getElementById('video-grid');
const peopleUl = document.getElementById('people-ul');
const messagesEl = document.getElementById('messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const toggleMicBtn = document.getElementById('toggle-mic');
const toggleCamBtn = document.getElementById('toggle-cam');
const toggleScreenBtn = document.getElementById('toggle-screen');
const attachBtn = document.getElementById('attach-btn');
const fileInput = document.getElementById('file-input');
const voiceBtn = document.getElementById('voice-btn');
const leaveBtn = document.getElementById('leave-btn');

let authToken = null;
let myUserId = null;
let myUsername = '';
let myAvatar = 1;
let isAdmin = false;

let socket = null;
let localStream = null;
let micOn = true;
let camOn = false;
let myRoom = '';
let activeRoomId = null; // room currently open in the chat screen, or null when on friends screen
const peers = new Map();
const unreadCounts = new Map(); // friendId -> count
let friendsCache = []; // last loaded friends list, used to resolve notifications to names

// ---------- Avatars ----------
// 15 hand-picked options: a friendly emoji over a soft gradient, no external images needed.
const AVATARS = [
  { emoji: '🐱', from: '#ff9a56', to: '#ff6b6b' },
  { emoji: '🐶', from: '#4facfe', to: '#00f2fe' },
  { emoji: '🦊', from: '#f6d365', to: '#fda085' },
  { emoji: '🐼', from: '#a1c4fd', to: '#c2e9fb' },
  { emoji: '🐨', from: '#84fab0', to: '#8fd3f4' },
  { emoji: '🦁', from: '#fbc2eb', to: '#a18cd1' },
  { emoji: '🐸', from: '#96e6a1', to: '#4fd1c5' },
  { emoji: '🐙', from: '#f77062', to: '#fe5196' },
  { emoji: '🦄', from: '#c471f5', to: '#fa71cd' },
  { emoji: '🐰', from: '#fddb92', to: '#a8d8e8' },
  { emoji: '🐻', from: '#e0c3fc', to: '#8ec5fc' },
  { emoji: '🐷', from: '#ffd1dc', to: '#ee9ca7' },
  { emoji: '🐯', from: '#f7b733', to: '#fc4a1a' },
  { emoji: '🐵', from: '#30cfd0', to: '#7c4dff' },
  { emoji: '🐔', from: '#ff9a9e', to: '#fecfef' }
];

function avatarInfo(avatarId) {
  const idx = ((parseInt(avatarId, 10) || 1) - 1 + AVATARS.length) % AVATARS.length;
  return AVATARS[idx];
}

function avatarCircleHtml(avatarId, extraClass) {
  const a = avatarInfo(avatarId);
  const cls = 'avatar-circle' + (extraClass ? ' ' + extraClass : '');
  return `<span class="${cls}" style="background:linear-gradient(150deg, ${a.from}, ${a.to})">${a.emoji}</span>`;
}

function avatarCircleEl(avatarId, extraClass) {
  const a = avatarInfo(avatarId);
  const span = document.createElement('span');
  span.className = 'avatar-circle' + (extraClass ? ' ' + extraClass : '');
  span.style.background = `linear-gradient(150deg, ${a.from}, ${a.to})`;
  span.textContent = a.emoji;
  return span;
}

// ---------- Theme ----------
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const icon = theme === 'light' ? '☀️' : '🌙';
  if (themeBtn) themeBtn.textContent = icon;
  if (themeBtnChat) themeBtnChat.textContent = icon;
}

function initTheme() {
  let theme = null;
  try { theme = localStorage.getItem('ft_theme'); } catch (e) {}
  if (!theme) {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    theme = prefersDark ? 'dark' : 'light';
  }
  applyTheme(theme);
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  const next = current === 'light' ? 'dark' : 'light';
  applyTheme(next);
  try { localStorage.setItem('ft_theme', next); } catch (e) {}
}

if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
if (themeBtnChat) themeBtnChat.addEventListener('click', toggleTheme);
initTheme();

// ---------- Notifications ----------
function updateNotifBtn() {
  if (!notifBtn) return;
  const granted = 'Notification' in window && Notification.permission === 'granted';
  notifBtn.textContent = granted ? '🔔' : '🔕';
  notifBtn.title = granted ? 'Уведомления включены' : 'Включить уведомления';
}

if (notifBtn) {
  notifBtn.addEventListener('click', async () => {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    updateNotifBtn();
  });
  updateNotifBtn();
}

function showNotification(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification(title, { body, icon: undefined }); } catch (e) { /* ignore */ }
  }
}

// ---------- Boot ----------
(function boot() {
  try {
    authToken = localStorage.getItem('ft_token');
    myUsername = localStorage.getItem('ft_username') || '';
  } catch (e) {}
  if (authToken) {
    verifySession();
  } else {
    showScreen(authScreen);
  }
})();

function showScreen(el) {
  [authScreen, friendsScreen, chatScreen].forEach(s => s.classList.add('hidden'));
  el.classList.remove('hidden');
}

async function apiRequest(pathName, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
  const res = await fetch(API_BASE + pathName, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Ошибка сервера');
  return data;
}

async function verifySession() {
  try {
    const me = await apiRequest('/api/me');
    myUserId = me.id;
    myUsername = me.username;
    myAvatar = me.avatar || 1;
    isAdmin = !!me.isAdmin;
    adminBtn.classList.toggle('hidden', !isAdmin);
    connectPersistentSocket();
    enterFriendsScreen();
  } catch (e) {
    authToken = null;
    try { localStorage.removeItem('ft_token'); } catch (err) {}
    showScreen(authScreen);
  }
}

// A single socket connection lives for the whole session (from login until logout),
// so we can receive call/message notifications even while just browsing the friends screen.
function connectPersistentSocket() {
  if (socket) return;
  socket = io(API_BASE, { transports: ['websocket', 'polling'] });

  socket.on('connect', () => {
    socket.emit('authenticate', { token: authToken });
  });

  socket.on('incoming-call', ({ roomId, fromUsername }) => {
    showIncomingCall(roomId, fromUsername);
    showNotification('Входящий звонок', `${fromUsername} звонит вам`);
  });

  socket.on('notify-message', ({ roomId, fromUsername, preview }) => {
    if (activeRoomId === roomId) return; // already looking at this conversation
    const friendId = friendIdFromRoom(roomId);
    if (friendId != null) {
      unreadCounts.set(friendId, (unreadCounts.get(friendId) || 0) + 1);
      renderFriendsFromCache();
    }
    showNotification(`Сообщение от ${fromUsername}`, preview);
  });

  socket.on('presence-update', ({ userId, online, lastSeen }) => {
    const friend = friendsCache.find(f => f.id === userId);
    if (friend) {
      friend.online = online;
      if (lastSeen) friend.lastSeen = lastSeen;
      renderFriendsFromCache();
    }
  });

  socket.on('message-deleted', ({ id }) => {
    const row = document.querySelector(`[data-msg-id="${id}"]`);
    if (row) row.remove();
  });

  socket.on('force-logout', () => {
    alert('Ваш аккаунт был удалён администратором.');
    authToken = null;
    try { localStorage.removeItem('ft_token'); } catch (e) {}
    socket.disconnect();
    socket = null;
    showScreen(authScreen);
  });

  registerSocketHandlers();
}

function friendIdFromRoom(roomId) {
  if (!roomId.startsWith('dm-')) return null;
  const parts = roomId.slice(3).split('-').map(Number);
  if (parts.length !== 2) return null;
  return parts[0] === myUserId ? parts[1] : parts[0];
}

let pendingCallRoomId = null;

function showIncomingCall(roomId, fromUsername) {
  pendingCallRoomId = roomId;
  callBannerText.textContent = `${fromUsername} звонит вам`;
  callBanner.classList.remove('hidden');
}

callAcceptBtn.addEventListener('click', () => {
  if (!pendingCallRoomId) return;
  const roomId = pendingCallRoomId;
  callBanner.classList.add('hidden');
  pendingCallRoomId = null;
  const friendId = friendIdFromRoom(roomId);
  const friend = friendsCache.find(f => f.id === friendId);
  joinRoom(roomId, friend ? `Звонок с ${friend.username}` : 'Звонок', { textOnly: false });
});

callDeclineBtn.addEventListener('click', () => {
  callBanner.classList.add('hidden');
  pendingCallRoomId = null;
});

// ---------- Auth tabs ----------
tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    tabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    loginForm.classList.toggle('hidden', tab !== 'login');
    registerForm.classList.toggle('hidden', tab !== 'register');
    authError.textContent = '';
  });
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  authError.textContent = '';
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  try {
    const data = await apiRequest('/api/login', { method: 'POST', body: { username, password } });
    onAuthSuccess(data);
  } catch (err) {
    authError.textContent = err.message;
  }
});

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  authError.textContent = '';
  const username = document.getElementById('register-username').value.trim();
  const password = document.getElementById('register-password').value;
  try {
    const data = await apiRequest('/api/register', { method: 'POST', body: { username, password } });
    onAuthSuccess(data);
  } catch (err) {
    authError.textContent = err.message;
  }
});

function onAuthSuccess(data) {
  authToken = data.token;
  myUsername = data.username;
  try {
    localStorage.setItem('ft_token', authToken);
    localStorage.setItem('ft_username', myUsername);
  } catch (e) {}
  verifySession();
}

logoutBtn.addEventListener('click', () => {
  authToken = null;
  try { localStorage.removeItem('ft_token'); } catch (e) {}
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  unreadCounts.clear();
  showScreen(authScreen);
});

// ---------- Friends screen ----------
function enterFriendsScreen() {
  myUsernameLabel.textContent = myUsername;
  myAvatarSlot.innerHTML = '';
  myAvatarSlot.appendChild(avatarCircleEl(myAvatar, 'small'));
  showScreen(friendsScreen);
  loadFriends();
}

profileBtn.addEventListener('click', () => {
  renderAvatarGrid();
  avatarPicker.classList.remove('hidden');
});

avatarPickerClose.addEventListener('click', () => {
  avatarPicker.classList.add('hidden');
});

function renderAvatarGrid() {
  avatarGrid.innerHTML = '';
  AVATARS.forEach((a, idx) => {
    const id = idx + 1;
    const btn = document.createElement('button');
    btn.className = 'avatar-option' + (id === myAvatar ? ' selected' : '');
    btn.style.background = `linear-gradient(150deg, ${a.from}, ${a.to})`;
    btn.textContent = a.emoji;
    btn.addEventListener('click', async () => {
      try {
        await apiRequest('/api/me/avatar', { method: 'PATCH', body: { avatar: id } });
        myAvatar = id;
        myAvatarSlot.innerHTML = '';
        myAvatarSlot.appendChild(avatarCircleEl(myAvatar, 'small'));
        renderAvatarGrid();
      } catch (e) {
        console.error(e);
      }
    });
    avatarGrid.appendChild(btn);
  });
}

adminBtn.addEventListener('click', () => {
  loadAdminUsers();
  adminPanel.classList.remove('hidden');
});

adminPanelClose.addEventListener('click', () => {
  adminPanel.classList.add('hidden');
});

async function loadAdminUsers() {
  adminUserList.innerHTML = '<p class="hint">Загрузка…</p>';
  try {
    const data = await apiRequest('/api/admin/users');
    renderAdminUsers(data.users);
  } catch (e) {
    adminUserList.innerHTML = '<p class="hint">Не удалось загрузить список.</p>';
  }
}

function renderAdminUsers(users) {
  adminUserList.innerHTML = '';
  users.forEach(u => {
    const row = document.createElement('div');
    row.className = 'admin-user-row';
    const status = u.online ? 'в сети' : (u.lastSeen ? formatLastSeen(u.lastSeen) : 'не в сети');
    row.innerHTML = `
      <span>${escapeHtml(u.username)}${u.username === myUsername ? ' (вы)' : ''} <span class="friend-status">${status}</span></span>
      <button class="pill-btn decline" data-id="${u.id}">Удалить</button>`;
    const delBtn = row.querySelector('button');
    if (u.username === myUsername) {
      delBtn.disabled = true;
      delBtn.style.opacity = 0.4;
    } else {
      delBtn.addEventListener('click', async () => {
        if (!confirm(`Полностью удалить пользователя ${u.username}? Это действие необратимо.`)) return;
        try {
          await apiRequest('/api/admin/users/' + u.id, { method: 'DELETE' });
          loadAdminUsers();
        } catch (e) {
          alert(e.message);
        }
      });
    }
    adminUserList.appendChild(row);
  });
}

supportBtn.addEventListener('click', async () => {
  try {
    const data = await apiRequest('/api/support');
    if (!data.available) {
      alert('Поддержка пока недоступна. Попробуйте позже.');
      return;
    }
    startFriendChat(data.id, 'Поддержка');
  } catch (e) {
    console.error(e);
  }
});

savedBtn.addEventListener('click', () => {
  joinRoom('self-' + myUserId, 'Избранное', { textOnly: true });
});

async function forwardToSelf(msg) {
  try {
    await apiRequest('/api/forward-to-self', {
      method: 'POST',
      body: {
        username: msg.username,
        text: msg.text || '',
        attachment: msg.attachment || null
      }
    });
  } catch (e) {
    console.error(e);
  }
}

async function loadFriends() {
  try {
    const data = await apiRequest('/api/friends');
    friendsCache = data.friends;
    renderFriends(data);
  } catch (e) {
    console.error(e);
  }
}

function renderFriendsFromCache() {
  renderFriendsList(friendsCache);
}

function renderFriends({ friends, incoming, outgoing }) {
  // Incoming requests
  incomingBlock.classList.toggle('hidden', incoming.length === 0);
  incomingList.innerHTML = '';
  incoming.forEach(r => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="friend-name">${avatarCircleHtml(r.avatar)}${escapeHtml(r.username)}</span>
      <span class="row-actions">
        <button class="pill-btn accept" data-id="${r.id}">Принять</button>
        <button class="pill-btn decline" data-id="${r.id}">Отклонить</button>
      </span>`;
    li.querySelector('.accept').addEventListener('click', () => respondRequest(r.id, 'accept'));
    li.querySelector('.decline').addEventListener('click', () => respondRequest(r.id, 'decline'));
    incomingList.appendChild(li);
  });

  // Outgoing requests
  outgoingBlock.classList.toggle('hidden', outgoing.length === 0);
  outgoingList.innerHTML = '';
  outgoing.forEach(r => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="friend-name">${avatarCircleHtml(r.avatar)}${escapeHtml(r.username)}</span>
      <span class="pill-btn pending">Ожидание…</span>`;
    outgoingList.appendChild(li);
  });

  renderFriendsList(friends);
}

function renderFriendsList(friends) {
  friendsList.innerHTML = '';
  noFriendsMsg.classList.toggle('hidden', friends.length > 0);
  friends.forEach(f => {
    const li = document.createElement('li');
    const unread = unreadCounts.get(f.id) || 0;
    const badge = unread > 0 ? `<span class="unread-badge">${unread}</span>` : '';
    const statusText = f.online ? 'В сети' : formatLastSeen(f.lastSeen);
    const statusClass = f.online ? 'friend-status online' : 'friend-status';
    li.innerHTML = `
      <span class="friend-name">
        <span class="avatar-wrap">
          ${avatarCircleHtml(f.avatar)}
          <span class="presence-dot ${f.online ? 'online' : ''}"></span>
        </span>
        <span class="friend-meta">
          <span>${escapeHtml(f.username)}${badge}</span>
          <span class="${statusClass}">${statusText}</span>
        </span>
      </span>
      <span class="row-actions">
        <button class="pill-btn message" data-id="${f.id}">Написать</button>
        <button class="pill-btn call" data-id="${f.id}">Позвонить</button>
        <button class="pill-btn remove" data-id="${f.id}" title="Удалить из друзей">✕</button>
      </span>`;
    li.querySelector('.message').addEventListener('click', () => startFriendChat(f.id, f.username));
    li.querySelector('.call').addEventListener('click', () => startFriendCall(f.id, f.username));
    li.querySelector('.remove').addEventListener('click', () => removeFriend(f.id, f.username));
    friendsList.appendChild(li);
  });
}

function formatLastSeen(ts) {
  if (!ts) return 'не в сети';
  const diffMs = Date.now() - ts;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'был(а) только что';
  if (mins < 60) return `был(а) ${mins} мин. назад`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `был(а) ${hours} ч. назад`;
  const date = new Date(ts);
  return 'был(а) ' + date.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
}

async function removeFriend(friendId, friendUsername) {
  if (!confirm(`Удалить ${friendUsername} из друзей?`)) return;
  try {
    await apiRequest('/api/friends/' + friendId, { method: 'DELETE' });
    loadFriends();
  } catch (e) {
    console.error(e);
  }
}

function initial(name) {
  return (name && name[0] ? name[0] : '?').toUpperCase();
}

addFriendForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  addFriendMsg.textContent = '';
  const username = addFriendInput.value.trim();
  if (!username) return;
  try {
    const data = await apiRequest('/api/friends/request', { method: 'POST', body: { username } });
    addFriendMsg.textContent = data.status === 'accepted'
      ? `Вы теперь друзья с ${username}!`
      : `Заявка отправлена пользователю ${username}.`;
    addFriendInput.value = '';
    loadFriends();
  } catch (err) {
    addFriendMsg.textContent = err.message;
  }
});

async function respondRequest(requestId, action) {
  try {
    await apiRequest('/api/friends/respond', { method: 'POST', body: { requestId, action } });
    loadFriends();
  } catch (err) {
    console.error(err);
  }
}

function friendRoomId(friendId) {
  const a = Math.min(myUserId, friendId);
  const b = Math.max(myUserId, friendId);
  return `dm-${a}-${b}`;
}

function startFriendCall(friendId, friendUsername) {
  joinRoom(friendRoomId(friendId), `Звонок с ${friendUsername}`, { textOnly: false });
}

function startFriendChat(friendId, friendUsername) {
  joinRoom(friendRoomId(friendId), `Переписка с ${friendUsername}`, { textOnly: true });
}

groupRoomForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const roomId = groupRoomInput.value.trim();
  if (!roomId) return;
  joinRoom(roomId, roomId, { textOnly: false });
});

// ---------- Room / chat / WebRTC ----------
async function joinRoom(roomId, displayLabel, { textOnly = false } = {}) {
  myRoom = roomId;
  activeRoomId = roomId;

  const friendId = friendIdFromRoom(roomId);
  if (friendId != null) {
    unreadCounts.delete(friendId);
    renderFriendsFromCache();
  }

  if (textOnly) {
    localStream = new MediaStream();
  } else {
    try {
      localStream = await getLocalMedia();
    } catch (e) {
      console.warn('Не удалось получить микрофон/камеру', e);
      localStream = new MediaStream();
    }
  }

  videoGrid.innerHTML = '';
  peopleUl.innerHTML = '';
  messagesEl.innerHTML = '';
  peers.clear();
  roomNameLabel.textContent = displayLabel;
  chatScreen.classList.toggle('text-only', textOnly);
  showScreen(chatScreen);
  if (!textOnly) {
    addLocalVideoTile();
    startCallTimer();
  } else {
    stopCallTimer();
  }

  // Load persisted history for this room before live messages start arriving.
  try {
    const history = await apiRequest('/api/messages?roomId=' + encodeURIComponent(roomId));
    history.messages.forEach(addMessage);
  } catch (e) {
    console.error('Не удалось загрузить историю сообщений', e);
  }

  socket.emit('join-room', { roomId, token: authToken, username: myUsername, intent: textOnly ? 'text' : 'call' });
}

let callTimerInterval = null;
let callStartTime = null;

function startCallTimer() {
  callStartTime = Date.now();
  callTimerEl.textContent = '00:00';
  callTimerEl.classList.remove('hidden');
  if (callTimerInterval) clearInterval(callTimerInterval);
  callTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    callTimerEl.textContent = h > 0
      ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      : `${String(m).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }, 1000);
}

function stopCallTimer() {
  if (callTimerInterval) {
    clearInterval(callTimerInterval);
    callTimerInterval = null;
  }
  callStartTime = null;
  callTimerEl.classList.add('hidden');
}

function leaveCurrentRoom() {
  if (socket) socket.emit('leave-room');
  activeRoomId = null;
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  peers.forEach(({ pc }) => pc.close());
  peers.clear();
  speakingDetectors.forEach((_, tileId) => detachSpeakingDetector(tileId));
  chatScreen.classList.remove('text-only');
  stopCallTimer();
}

async function getLocalMedia() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  stream.getVideoTracks().forEach(t => t.enabled = false);
  stream.getAudioTracks().forEach(t => t.enabled = true);
  camOn = false;
  micOn = true;
  toggleMicBtn.classList.add('active');
  toggleMicBtn.textContent = '🎤';
  toggleCamBtn.classList.remove('active');
  return stream;
}

function registerSocketHandlers() {
  socket.on('room-users', (users) => {
    updatePeopleList(users, true);
    users.forEach(u => createPeerConnection(u.id, u.username, true, u.avatar));
  });

  socket.on('user-joined', (u) => {
    addPersonToList(u);
    createPeerConnection(u.id, u.username, false, u.avatar);
  });

  socket.on('user-left', ({ id }) => {
    removePeer(id);
    removePersonFromList(id);
  });

  socket.on('webrtc-signal', async ({ from, signal }) => {
    const entry = peers.get(from);
    if (!entry) return;
    const { pc } = entry;
    if (signal.type === 'offer') {
      await pc.setRemoteDescription(new RTCSessionDescription(signal));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('webrtc-signal', { to: from, signal: pc.localDescription });
    } else if (signal.type === 'answer') {
      await pc.setRemoteDescription(new RTCSessionDescription(signal));
    } else if (signal.candidate) {
      try { await pc.addIceCandidate(signal); } catch (e) { }
    }
  });

  socket.on('chat-message', (msg) => addMessage(msg));
}

function createPeerConnection(peerId, username, isInitiator, avatar) {
  if (peers.has(peerId)) return;

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, iceCandidatePoolSize: 10 });
  const peerEntry = { pc, username, avatar: avatar || 1, reconnectTimer: null };
  peers.set(peerId, peerEntry);

  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit('webrtc-signal', { to: peerId, signal: e.candidate });
  };

  pc.ontrack = (e) => {
    addRemoteVideoTile(peerId, username, e.streams[0], peerEntry.avatar);
  };

  function attemptReconnect() {
    try { pc.restartIce(); } catch (e) { /* older browsers: fall back to renegotiation below */ }
    if (isInitiator) {
      pc.createOffer({ iceRestart: true })
        .then(offer => pc.setLocalDescription(offer))
        .then(() => socket.emit('webrtc-signal', { to: peerId, signal: pc.localDescription }))
        .catch(err => console.error('Не удалось переподключиться:', err));
    }
  }

  // Free STUN/TURN relays sometimes cause a brief "disconnected" blip rather than an
  // outright "failed" state — waiting a few seconds before restarting avoids fighting
  // a connection that's about to recover on its own, while still catching real drops
  // (this is the fix for calls that quietly go silent after a few minutes).
  pc.oniceconnectionstatechange = () => {
    const state = pc.iceConnectionState;
    if (peerEntry.reconnectTimer) {
      clearTimeout(peerEntry.reconnectTimer);
      peerEntry.reconnectTimer = null;
    }
    if (state === 'failed') {
      attemptReconnect();
    } else if (state === 'disconnected') {
      peerEntry.reconnectTimer = setTimeout(() => {
        if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
          attemptReconnect();
        }
      }, 4000);
    }
  };

  if (isInitiator) {
    pc.onnegotiationneeded = async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('webrtc-signal', { to: peerId, signal: pc.localDescription });
      } catch (e) { console.error(e); }
    };
  }
}

// ---------- Speaking indicator (highlights whoever is currently talking) ----------
let audioCtx = null;
const speakingDetectors = new Map(); // key (tile id) -> { interval, source }

function attachSpeakingDetector(stream, tileId) {
  if (speakingDetectors.has(tileId)) return;
  if (!stream.getAudioTracks().length) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    const interval = setInterval(() => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += Math.abs(data[i] - 128);
      const level = sum / data.length;
      const tile = document.getElementById(tileId);
      if (tile) tile.classList.toggle('speaking', level > 6);
    }, 200);

    speakingDetectors.set(tileId, { interval, source });
  } catch (e) {
    console.warn('Индикатор голоса недоступен:', e);
  }
}

function detachSpeakingDetector(tileId) {
  const entry = speakingDetectors.get(tileId);
  if (!entry) return;
  clearInterval(entry.interval);
  try { entry.source.disconnect(); } catch (e) { /* ignore */ }
  speakingDetectors.delete(tileId);
}

function removePeer(peerId) {
  const entry = peers.get(peerId);
  if (entry) {
    if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
    entry.pc.close();
    peers.delete(peerId);
  }
  detachSpeakingDetector('tile-' + peerId);
  const tile = document.getElementById('tile-' + peerId);
  if (tile) tile.remove();
}

function addLocalVideoTile() {
  const tile = document.createElement('div');
  tile.className = 'video-tile';
  tile.id = 'tile-local';
  tile.innerHTML = `
    <video autoplay muted playsinline></video>
    <div class="name-tag"><span>${escapeHtml(myUsername)} (вы)</span></div>
  `;
  const video = tile.querySelector('video');
  video.srcObject = localStream;
  videoGrid.appendChild(tile);
  refreshLocalTileMode();
  attachSpeakingDetector(localStream, 'tile-local');
}

function refreshLocalTileMode() {
  const tile = document.getElementById('tile-local');
  if (!tile) return;
  const video = tile.querySelector('video');
  let avatarEl = tile.querySelector('.no-video-avatar');
  if (camOn) {
    video.style.display = '';
    if (avatarEl) avatarEl.remove();
  } else {
    video.style.display = 'none';
    if (!avatarEl) {
      avatarEl = document.createElement('div');
      avatarEl.className = 'no-video-avatar';
      avatarEl.appendChild(avatarCircleEl(myAvatar, 'big'));
      tile.insertBefore(avatarEl, tile.firstChild);
    }
  }
}

function addRemoteVideoTile(peerId, username, stream, avatar) {
  let tile = document.getElementById('tile-' + peerId);
  if (!tile) {
    tile = document.createElement('div');
    tile.className = 'video-tile';
    tile.id = 'tile-' + peerId;
    tile.innerHTML = `
      <video autoplay playsinline></video>
      <div class="name-tag"><span>${escapeHtml(username)}</span></div>
    `;
    videoGrid.appendChild(tile);
  }
  const video = tile.querySelector('video');
  video.srcObject = stream;

  // Note: on the receiving end, track.enabled is a local-only flag and does not
  // reflect whether the sender is actually providing video — track.muted does.
  const hasVideoTrack = stream.getVideoTracks().some(t => !t.muted);
  video.style.display = hasVideoTrack ? '' : 'none';
  updateRemoteNoVideoAvatar(tile, !hasVideoTrack, avatar);

  stream.getVideoTracks().forEach(t => {
    t.onmute = () => { video.style.display = 'none'; updateRemoteNoVideoAvatar(tile, true, avatar); };
    t.onunmute = () => { video.style.display = ''; updateRemoteNoVideoAvatar(tile, false, avatar); };
  });

  attachSpeakingDetector(stream, 'tile-' + peerId);
}

function updateRemoteNoVideoAvatar(tile, show, avatar) {
  let avatarEl = tile.querySelector('.no-video-avatar');
  if (show) {
    if (!avatarEl) {
      avatarEl = document.createElement('div');
      avatarEl.className = 'no-video-avatar';
      avatarEl.appendChild(avatarCircleEl(avatar || 1, 'big'));
      tile.insertBefore(avatarEl, tile.firstChild);
    }
  } else if (avatarEl) {
    avatarEl.remove();
  }
}

function updatePeopleList(users, replaceAll) {
  if (replaceAll) peopleUl.innerHTML = '';
  addPersonToList({ id: 'me', username: myUsername + ' (вы)', avatar: myAvatar });
  users.forEach(addPersonToList);
}
function addPersonToList(u) {
  if (document.getElementById('person-' + u.id)) return;
  const li = document.createElement('li');
  li.id = 'person-' + u.id;
  li.innerHTML = `${avatarCircleHtml(u.avatar || 1, 'tiny')}<span>${escapeHtml(u.username)}</span>`;
  peopleUl.appendChild(li);
}
function removePersonFromList(id) {
  const li = document.getElementById('person-' + id);
  if (li) li.remove();
}

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text || !socket) return;
  socket.emit('chat-message', text);
  chatInput.value = '';
});

function renderAttachment(attachment) {
  const wrap = document.createElement('div');
  wrap.className = 'msg-attachment';
  const type = attachment.mimeType || '';
  if (type.startsWith('image/')) {
    const img = document.createElement('img');
    img.src = attachment.dataUrl;
    img.alt = attachment.filename || 'изображение';
    wrap.appendChild(img);
  } else if (type.startsWith('video/')) {
    const video = document.createElement('video');
    video.src = attachment.dataUrl;
    video.controls = true;
    wrap.appendChild(video);
  } else if (type.startsWith('audio/')) {
    const audio = document.createElement('audio');
    audio.src = attachment.dataUrl;
    audio.controls = true;
    wrap.appendChild(audio);
  } else {
    const a = document.createElement('a');
    a.className = 'file-link';
    a.href = attachment.dataUrl;
    a.download = attachment.filename || 'file';
    a.textContent = '📎 ' + (attachment.filename || 'Файл');
    wrap.appendChild(a);
  }
  return wrap;
}

function addMessage(msg) {
  if (msg.system) {
    const div = document.createElement('div');
    div.className = 'msg system';
    div.textContent = msg.text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return;
  }

  const time = new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const isMine = msg.fromUserId != null && msg.fromUserId === myUserId;

  const row = document.createElement('div');
  row.className = 'msg-row' + (isMine ? ' mine' : ' theirs');
  if (msg.id != null) row.dataset.msgId = msg.id;

  if (!isMine) {
    row.appendChild(avatarCircleEl(msg.avatar || 1, 'tiny'));
  }

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (!isMine) {
    const nameLine = document.createElement('div');
    nameLine.className = 'bubble-author';
    nameLine.textContent = msg.username;
    bubble.appendChild(nameLine);
  }
  if (msg.text) {
    const textLine = document.createElement('div');
    textLine.className = 'bubble-text';
    textLine.textContent = msg.text;
    bubble.appendChild(textLine);
  }
  if (msg.attachment) {
    bubble.appendChild(renderAttachment(msg.attachment));
  }
  const timeLine = document.createElement('div');
  timeLine.className = 'bubble-time';
  timeLine.textContent = time;
  bubble.appendChild(timeLine);

  const actions = document.createElement('span');
  actions.className = 'msg-actions';

  const star = document.createElement('button');
  star.className = 'msg-action-btn';
  star.title = 'Сохранить в избранное';
  star.textContent = '⭐';
  star.addEventListener('click', () => forwardToSelf(msg));
  actions.appendChild(star);

  if (isMine && msg.id != null) {
    const del = document.createElement('button');
    del.className = 'msg-action-btn';
    del.title = 'Удалить у всех';
    del.textContent = '🗑';
    del.addEventListener('click', () => {
      if (!confirm('Удалить это сообщение у всех участников чата?')) return;
      socket.emit('delete-message', { id: msg.id });
    });
    actions.appendChild(del);
  }

  row.appendChild(bubble);
  row.appendChild(actions);
  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

toggleMicBtn.addEventListener('click', () => {
  micOn = !micOn;
  localStream.getAudioTracks().forEach(t => t.enabled = micOn);
  toggleMicBtn.classList.toggle('active', micOn);
  toggleMicBtn.textContent = micOn ? '🎤' : '🔇';
});

toggleCamBtn.addEventListener('click', () => {
  camOn = !camOn;
  localStream.getVideoTracks().forEach(t => t.enabled = camOn);
  toggleCamBtn.classList.toggle('active', camOn);
  refreshLocalTileMode();
});

// ---------- Screen sharing ----------
let screenStream = null;
let cameraVideoTrack = null;

toggleScreenBtn.addEventListener('click', async () => {
  if (screenStream) {
    stopScreenShare();
    return;
  }
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
  } catch (e) {
    return; // user cancelled the picker
  }

  const screenTrack = screenStream.getVideoTracks()[0];
  cameraVideoTrack = localStream.getVideoTracks()[0] || null;

  peers.forEach(({ pc }) => {
    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender) sender.replaceTrack(screenTrack);
  });

  if (cameraVideoTrack) localStream.removeTrack(cameraVideoTrack);
  localStream.addTrack(screenTrack);

  camOn = true;
  refreshLocalTileMode();
  toggleScreenBtn.classList.add('active');
  toggleScreenBtn.title = 'Остановить демонстрацию экрана';

  screenTrack.onended = () => stopScreenShare();
});

function stopScreenShare() {
  if (!screenStream) return;
  const screenTrack = screenStream.getVideoTracks()[0];

  localStream.removeTrack(screenTrack);
  screenTrack.stop();

  peers.forEach(({ pc }) => {
    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender) sender.replaceTrack(cameraVideoTrack || null);
  });

  if (cameraVideoTrack) {
    localStream.addTrack(cameraVideoTrack);
    cameraVideoTrack.enabled = camOn;
  } else {
    camOn = false;
  }

  screenStream = null;
  toggleScreenBtn.classList.remove('active');
  toggleScreenBtn.title = 'Демонстрация экрана';
  refreshLocalTileMode();
}

// ---------- File / photo / video attachments ----------
const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024; // 6MB after any compression

attachBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  fileInput.value = '';
  if (!file) return;
  const toSend = file.type.startsWith('image/') ? await compressImage(file) : file;
  sendFileAttachment(toSend);
});

// Phone-camera photos are often 8-15MB — shrinking them client-side means "send photo"
// actually succeeds instead of silently hitting the size limit.
function compressImage(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const MAX_DIM = 1600;
      let { width, height } = img;
      if (width > MAX_DIM || height > MAX_DIM) {
        const scale = MAX_DIM / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (!blob) { resolve(file); return; }
        resolve(new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }));
      }, 'image/jpeg', 0.82);
    };
    img.onerror = () => resolve(file); // not a decodable image — send as-is
    img.src = objectUrl;
  });
}

function sendFileAttachment(file, attempt = 1) {
  if (!socket || !activeRoomId) return;
  if (file.size > MAX_ATTACHMENT_BYTES) {
    alert('Файл слишком большой (максимум 6 МБ после сжатия).');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    let settled = false;
    socket.emit('chat-file', { dataUrl: reader.result, mimeType: file.type, filename: file.name }, (res) => {
      settled = true;
      if (!res || !res.ok) {
        if (attempt < 2) {
          setTimeout(() => sendFileAttachment(file, attempt + 1), 800);
        } else {
          alert('Не удалось отправить файл. Проверьте соединение и попробуйте ещё раз.');
        }
      }
    });
    setTimeout(() => {
      if (!settled && attempt < 2) sendFileAttachment(file, attempt + 1);
    }, 6000);
  };
  reader.onerror = () => alert('Не удалось прочитать файл.');
  reader.readAsDataURL(file);
}

// ---------- Voice messages ----------
let mediaRecorder = null;
let recordedChunks = [];
let recordingStream = null;

function pickVoiceMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  for (const type of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return '';
}

voiceBtn.addEventListener('click', async () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    return;
  }
  if (!window.MediaRecorder) {
    alert('Этот браузер не поддерживает запись голосовых сообщений.');
    return;
  }
  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    alert('Не удалось получить доступ к микрофону.');
    return;
  }
  recordedChunks = [];
  const mimeType = pickVoiceMimeType();
  try {
    mediaRecorder = mimeType ? new MediaRecorder(recordingStream, { mimeType }) : new MediaRecorder(recordingStream);
  } catch (e) {
    mediaRecorder = new MediaRecorder(recordingStream);
  }
  mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
  mediaRecorder.onstop = () => {
    recordingStream.getTracks().forEach(t => t.stop());
    voiceBtn.classList.remove('recording');
    voiceBtn.title = 'Голосовое сообщение';
    const finalType = mediaRecorder.mimeType || 'audio/webm';
    const blob = new Blob(recordedChunks, { type: finalType });
    if (blob.size === 0) return;
    const ext = finalType.includes('mp4') ? 'm4a' : finalType.includes('ogg') ? 'ogg' : 'webm';
    const file = new File([blob], `voice-message.${ext}`, { type: finalType });
    sendFileAttachment(file);
  };
  mediaRecorder.start();
  voiceBtn.classList.add('recording');
  voiceBtn.title = 'Остановить запись';
});

leaveBtn.addEventListener('click', () => {
  if (screenStream) stopScreenShare();
  leaveCurrentRoom();
  enterFriendsScreen();
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
