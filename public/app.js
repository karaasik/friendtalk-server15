const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

const loginScreen = document.getElementById('login-screen');
const chatScreen = document.getElementById('chat-screen');
const serverUrlInput = document.getElementById('server-url');
const usernameInput = document.getElementById('username');
const roomIdInput = document.getElementById('room-id');
const joinBtn = document.getElementById('join-btn');
const loginError = document.getElementById('login-error');

const roomNameLabel = document.getElementById('room-name-label');
const videoGrid = document.getElementById('video-grid');
const peopleUl = document.getElementById('people-ul');
const messagesEl = document.getElementById('messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const toggleMicBtn = document.getElementById('toggle-mic');
const toggleCamBtn = document.getElementById('toggle-cam');
const leaveBtn = document.getElementById('leave-btn');

let socket = null;
let localStream = null;
let micOn = true;
let camOn = false;
let myUsername = '';
let myRoom = '';

const peers = new Map();

if (window.friendtalkConfig && window.friendtalkConfig.serverUrl) {
  serverUrlInput.value = window.friendtalkConfig.serverUrl;
}
try {
  serverUrlInput.value = serverUrlInput.value || localStorage.getItem('ft_server') || (location.origin.startsWith('http') && location.origin !== 'null' ? location.origin : '');
  usernameInput.value = localStorage.getItem('ft_username') || '';
  roomIdInput.value = localStorage.getItem('ft_room') || '';
} catch (e) { }

joinBtn.addEventListener('click', joinRoom);
[serverUrlInput, usernameInput, roomIdInput].forEach(el => {
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
});

async function joinRoom() {
  loginError.textContent = '';
  const serverUrl = serverUrlInput.value.trim().replace(/\/$/, '');
  const username = usernameInput.value.trim();
  const roomId = roomIdInput.value.trim();

  if (!serverUrl) return showLoginError('Укажите адрес сервера.');
  if (!username) return showLoginError('Введите имя.');
  if (!roomId) return showLoginError('Введите название комнаты.');

  try { localStorage.setItem('ft_server', serverUrl); localStorage.setItem('ft_username', username); localStorage.setItem('ft_room', roomId); } catch (e) {}

  myUsername = username;
  myRoom = roomId;

  joinBtn.disabled = true;
  joinBtn.textContent = 'Подключение…';

  try {
    localStream = await getLocalMedia();
  } catch (e) {
    console.warn('Не удалось получить микрофон/камеру', e);
    localStream = new MediaStream();
  }

  try {
    socket = io(serverUrl, { transports: ['websocket', 'polling'] });
  } catch (e) {
    joinBtn.disabled = false;
    joinBtn.textContent = 'Войти к костру';
    return showLoginError('Не удалось подключиться к серверу. Проверьте адрес.');
  }

  socket.on('connect_error', () => {
    showLoginError('Не удалось подключиться к серверу. Проверьте адрес и подключение к интернету.');
    joinBtn.disabled = false;
    joinBtn.textContent = 'Войти к костру';
  });

  socket.on('connect', () => {
    socket.emit('join-room', { roomId, username });
    enterChatScreen();
  });

  registerSocketHandlers();
}

function showLoginError(text) {
  loginError.textContent = text;
}

async function getLocalMedia() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  stream.getVideoTracks().forEach(t => t.enabled = false);
  stream.getAudioTracks().forEach(t => t.enabled = true);
  return stream;
}

function enterChatScreen() {
  loginScreen.classList.add('hidden');
  chatScreen.classList.remove('hidden');
  roomNameLabel.textContent = myRoom;
  addLocalVideoTile();
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
      avatar.textContent = (myUsername[0] || '?').toUpperCase();
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
  if (confirm('Выйти из комнаты?')) window.location.reload();
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
