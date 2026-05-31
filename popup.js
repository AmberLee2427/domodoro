const activeToggle = document.getElementById('active-toggle');
const activeLabel = document.getElementById('active-label');
const startBtn = document.getElementById('start-btn');
const pauseBtn = document.getElementById('pause-btn');
const resetBtn = document.getElementById('reset-btn');
const workMinutesInput = document.getElementById('work-minutes');
const breakMinutesInput = document.getElementById('break-minutes');
const modeLabel = document.getElementById('mode-label');
const timerDisplay = document.getElementById('timer-display');
const sendBtn = document.getElementById('send-btn');
const warmBtn = document.getElementById('warm-btn');
const chatInput = document.getElementById('chat-input');
const chatBox = document.getElementById('chat-box');
const modelStatus = document.getElementById('model-status');
const outfitSelect = document.getElementById('outfit-select');
const avatarImg = document.getElementById('avatar-img');
const characterStandee = document.getElementById('character-standee');
const blacklistToggle = document.getElementById('blacklist-toggle');
const blacklistInput = document.getElementById('blacklist-input');
const POSES = ['default', 'thinking', 'stern', 'pointing', 'approval', 'beckon'];
const DEFAULT_BLACKLIST = [
  'youtube.com',
  'reddit.com',
  'x.com',
  'twitter.com',
  'tiktok.com',
  'instagram.com',
];

const CHARACTERS = {
  default: {
    label: 'Default',
    subtitle: 'Sleek Office Demon',
    folder: 'default',
    unlockAt: 0,
  },
  silk: {
    label: 'Silk & Surrender',
    subtitle: 'Soft Dom Edition',
    folder: 'silk',
    unlockAt: 25,
  },
  director: {
    label: 'Obsidian Director',
    subtitle: 'Gothic Authority',
    folder: 'director',
    unlockAt: 50,
  },
  chrome: {
    label: 'Chrome Protocol',
    subtitle: 'Cyber Efficiency',
    folder: 'chrome',
    unlockAt: 75,
  },
  king: {
    label: 'Productivity King',
    subtitle: 'Too Powerful',
    folder: 'king',
    unlockAt: 100,
  },
};

let currentPose = 'default';

function normalizePose(value) {
  return POSES.includes(value) ? value : 'default';
}

function posePath(characterKey = outfitSelect.value, pose = currentPose) {
  const character = CHARACTERS[characterKey] || CHARACTERS.default;
  return `assets/characters/${character.folder}/${normalizePose(pose)}.png`;
}

function headshotPath(characterKey = outfitSelect.value) {
  const character = CHARACTERS[characterKey] || CHARACTERS.default;
  return `assets/characters/${character.folder}/headshot.png`;
}

function setPose(pose) {
  currentPose = normalizePose(pose);
  characterStandee.src = posePath(outfitSelect.value, currentPose);
}

let timerState = {
  isActive: true,
  mode: 'work',
  running: false,
  workMinutes: 25,
  breakMinutes: 5,
  completedSessions: 0,
  endAt: null,
};

function renderCharacters() {
  const completedSessions = timerState.completedSessions || 0;
  const selected = CHARACTERS[outfitSelect.value] || CHARACTERS.default;

  for (const option of outfitSelect.options) {
    const character = CHARACTERS[option.value];
    const locked = character.unlockAt > completedSessions;
    option.disabled = locked;
    option.textContent = locked
      ? `${character.label} (${character.unlockAt})`
      : character.label;
  }

  if (selected.unlockAt > completedSessions) {
    outfitSelect.value = 'default';
    chrome.storage.local.set({ outfit: 'default' });
  }

  avatarImg.src = headshotPath(outfitSelect.value);
  characterStandee.src = posePath(outfitSelect.value, currentPose);
}

avatarImg.addEventListener('error', () => {
  avatarImg.src = 'assets/characters/default/headshot.png';
});

characterStandee.addEventListener('error', () => {
  characterStandee.src = 'assets/characters/default/default.png';
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  })[char]);
}

function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function clampMinutes(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.round(number), 1), 180);
}

function renderTimer() {
  const duration = timerState.mode === 'break'
    ? timerState.breakMinutes
    : timerState.workMinutes;
  const remainingMs = timerState.running && timerState.endAt
    ? timerState.endAt - Date.now()
    : duration * 60 * 1000;

  timerDisplay.textContent = formatTime(remainingMs);
  modeLabel.textContent = timerState.mode === 'break' ? 'Break Session' : 'Focus Session';
  startBtn.textContent = timerState.running ? 'Restart' : 'Start';
  activeLabel.textContent = timerState.isActive ? 'Active' : 'Paused';
  activeToggle.checked = timerState.isActive;
  pauseBtn.disabled = !timerState.running;
}

function applyTimerState(state) {
  if (!state) return;
  timerState = { ...timerState, ...state };
  workMinutesInput.value = timerState.workMinutes;
  breakMinutesInput.value = timerState.breakMinutes;
  renderCharacters();
  renderTimer();
}

async function sendRuntimeMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  applyTimerState(response?.state);
  return response;
}

function renderStatus(status) {
  if (!status) return;

  const suffix = status.state === 'loading' && status.progress
    ? ` (${status.progress}%)`
    : '';
  modelStatus.textContent = `${status.detail || status.state}${suffix}`;
  sendBtn.disabled = status.state === 'loading';
  warmBtn.disabled = status.state === 'loading' || status.state === 'ready';
}

chrome.runtime.sendMessage({ action: 'get_model_status' }).then((response) => {
  renderStatus(response?.status);
}).catch(() => {});

chrome.runtime.sendMessage({ action: 'get_timer_state' }).then((response) => {
  applyTimerState(response?.state);
}).catch(() => {});

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'model_status') {
    renderStatus(message.status);
  }

  if (message.action === 'timer_state') {
    applyTimerState(message.state);
  }
});

setInterval(renderTimer, 500);

warmBtn.addEventListener('click', async () => {
  renderStatus({ state: 'loading', detail: 'Summoning Dom', progress: 0 });
  const response = await chrome.runtime.sendMessage({ action: 'warm_model' });
  renderStatus(response?.status);
});

startBtn.addEventListener('click', () => {
  sendRuntimeMessage({ action: 'start_timer', mode: timerState.mode });
});

pauseBtn.addEventListener('click', () => {
  sendRuntimeMessage({ action: 'pause_timer' });
});

resetBtn.addEventListener('click', () => {
  sendRuntimeMessage({ action: 'reset_timer', mode: 'work' });
});

function saveTimerSettings() {
  sendRuntimeMessage({
    action: 'update_timer_settings',
    workMinutes: clampMinutes(workMinutesInput.value, timerState.workMinutes),
    breakMinutes: clampMinutes(breakMinutesInput.value, timerState.breakMinutes),
  });
}

workMinutesInput.addEventListener('change', saveTimerSettings);
breakMinutesInput.addEventListener('change', saveTimerSettings);

// Load saved user preferences
chrome.storage.local.get([
  'isActive',
  'outfit',
  'persona',
  'completedSessions',
  'blacklistEnabled',
  'blacklistedSites',
], (data) => {
  if (data.isActive !== undefined) activeToggle.checked = data.isActive;
  if (data.completedSessions !== undefined) timerState.completedSessions = data.completedSessions;
  if (data.outfit) outfitSelect.value = data.outfit;
  if (data.persona) document.getElementById('persona-input').value = data.persona;
  blacklistToggle.checked = data.blacklistEnabled !== false;
  blacklistInput.value = Array.isArray(data.blacklistedSites) && data.blacklistedSites.length
    ? data.blacklistedSites.join('\n')
    : DEFAULT_BLACKLIST.join('\n');
  renderCharacters();
});

activeToggle.addEventListener('change', async (event) => {
  const isActive = event.target.checked;
  await chrome.storage.local.set({ isActive });
  activeLabel.textContent = isActive ? 'Active' : 'Paused';

  if (isActive) {
    await sendRuntimeMessage({ action: 'start_timer', mode: timerState.mode });
  } else {
    await sendRuntimeMessage({ action: 'pause_timer' });
  }
});

outfitSelect.addEventListener('change', (event) => {
  chrome.storage.local.set({ outfit: event.target.value });
  renderCharacters();
});

document.getElementById('persona-input').addEventListener('input', (event) => {
  chrome.storage.local.set({ persona: event.target.value });
});

blacklistToggle.addEventListener('change', (event) => {
  chrome.storage.local.set({ blacklistEnabled: event.target.checked });
});

blacklistInput.addEventListener('input', (event) => {
  const blacklistedSites = event.target.value
    .split(/\n+/)
    .map((site) => site.trim())
    .filter(Boolean);
  chrome.storage.local.set({ blacklistedSites });
});

async function sendChat() {
  if (!chatInput.value.trim()) return;

  chatBox.innerHTML += `<div class="chat-line user"><b>You:</b> ${escapeHtml(chatInput.value)}</div>`;
  const userMsg = chatInput.value;
  chatInput.value = '';
  sendBtn.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'route_chat',
      text: userMsg,
    });

    setPose(response.pose);
    chatBox.innerHTML += `<div class="chat-line dom"><b>Dom:</b> ${escapeHtml(response.text)}</div>`;
    chatBox.scrollTop = chatBox.scrollHeight;
  } catch (error) {
    chatBox.innerHTML += `<div class="chat-line system"><b>System:</b> ${escapeHtml(error.message || String(error))}</div>`;
  } finally {
    sendBtn.disabled = false;
  }
}

sendBtn.addEventListener('click', sendChat);
chatInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    sendChat();
  }
});
