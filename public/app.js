// FriendTalk client v2 — accounts, friends, rooms with voice/video

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

const API_BASE = location.origin;

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
const videoGrid = document.getElementById('video-grid');
const peopleUl = document.getElementById('people-ul');
const messagesEl = document.getElementById('messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const toggleMicBtn = document.getElementById('toggle-mic');
const toggleCamBtn = document.getElementById('toggle-cam');
const leaveBtn = document.getElementById('leave-btn');

let authToken = null;
let myUserId = null;
let myUsername = '';

let socket = null;
let localStream = null;
let micOn = true;
let camOn = false;
let myRoom = '';
let activeRoomId = null; // room currently open in the chat screen, or null when on friends screen
const peers = new Map();
const unreadCounts = new Map(); // friendId -> count
let friendsCache = []; // last loaded friends list, used to resolve notifications to names

// ---------- Theme ----------
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const icon = theme === 'light' ? '☀️' : '🌙';
  if (themeBtn) themeBtn.textContent = icon;
  if (themeBtnChat) themeBtnChat.textContent = icon;
}

function initTheme() {
  let theme = 'dark';
  try { theme = localStorage.getItem('ft_theme') || 'dark'; } catch (e) {}
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
  showScreen(friendsScreen);
  loadFriends();
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
      <span class="friend-name"><span class="avatar-circle">${initial(r.username)}</span>${escapeHtml(r.username)}</span>
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
      <span class="friend-name"><span class="avatar-circle">${initial(r.username)}</span>${escapeHtml(r.username)}</span>
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
    li.innerHTML = `
      <span class="friend-name"><span class="avatar-circle">${initial(f.username)}</span>${escapeHtml(f.username)}${badge}</span>
      <span class="row-actions">
        <button class="pill-btn message" data-id="${f.id}">Написать</button>
        <button class="pill-btn call" data-id="${f.id}">Позвонить</button>
      </span>`;
    li.querySelector('.message').addEventListener('click', () => startFriendChat(f.id, f.username));
    li.querySelector('.call').addEventListener('click', () => startFriendCall(f.id, f.username));
    friendsList.appendChild(li);
  });
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
  if (!textOnly) addLocalVideoTile();

  // Load persisted history for this room before live messages start arriving.
  try {
    const history = await apiRequest('/api/messages?roomId=' + encodeURIComponent(roomId));
    history.messages.forEach(addMessage);
  } catch (e) {
    console.error('Не удалось загрузить историю сообщений', e);
  }

  socket.emit('join-room', { roomId, token: authToken, username: myUsername, intent: textOnly ? 'text' : 'call' });
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
  chatScreen.classList.remove('text-only');
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
    users.forEach(u => createPeerConnection(u.id, u.username, true));
  });

  socket.on('user-joined', (u) => {
    addPersonToList(u);
    createPeerConnection(u.id, u.username, false);
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

function createPeerConnection(peerId, username, isInitiator) {
  if (peers.has(peerId)) return;

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  peers.set(peerId, { pc, username });

  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit('webrtc-signal', { to: peerId, signal: e.candidate });
  };

  pc.ontrack = (e) => {
    addRemoteVideoTile(peerId, username, e.streams[0]);
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

function removePeer(peerId) {
  const entry = peers.get(peerId);
  if (entry) {
    entry.pc.close();
    peers.delete(peerId);
  }
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
}

function refreshLocalTileMode() {
  const tile = document.getElementById('tile-local');
  if (!tile) return;
  const video = tile.querySelector('video');
  let avatar = tile.querySelector('.no-video-avatar');
  if (camOn) {
    video.style.display = '';
    if (avatar) avatar.remove();
  } else {
    video.style.display = 'none';
    if (!avatar) {
      avatar = document.createElement('div');
      avatar.className = 'no-video-avatar';
      avatar.textContent = initial(myUsername);
      tile.insertBefore(avatar, tile.firstChild);
    }
  }
}

function addRemoteVideoTile(peerId, username, stream) {
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

  const hasVideoTrack = stream.getVideoTracks().some(t => t.enabled);
  video.style.display = hasVideoTrack ? '' : 'none';

  stream.getVideoTracks().forEach(t => {
    t.onmute = () => { video.style.display = 'none'; };
    t.onunmute = () => { video.style.display = ''; };
  });
}

function updatePeopleList(users, replaceAll) {
  if (replaceAll) peopleUl.innerHTML = '';
  addPersonToList({ id: 'me', username: myUsername + ' (вы)' });
  users.forEach(addPersonToList);
}
function addPersonToList(u) {
  if (document.getElementById('person-' + u.id)) return;
  const li = document.createElement('li');
  li.id = 'person-' + u.id;
  li.innerHTML = `<span class="dot"></span><span>${escapeHtml(u.username)}</span>`;
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

function addMessage(msg) {
  const div = document.createElement('div');
  const time = new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (msg.system) {
    div.className = 'msg system';
    div.textContent = msg.text;
  } else {
    div.className = 'msg';
    div.innerHTML = `<span class="author">${escapeHtml(msg.username)}</span>${escapeHtml(msg.text)}<span class="time">${time}</span>`;
  }
  messagesEl.appendChild(div);
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

leaveBtn.addEventListener('click', () => {
  leaveCurrentRoom();
  enterFriendsScreen();
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
