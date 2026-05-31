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

let timerState = {
  isActive: true,
  mode: 'work',
  running: false,
  workMinutes: 25,
  breakMinutes: 5,
  endAt: null,
};

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
  renderStatus({ state: 'loading', detail: 'Warming up Gemma 4', progress: 0 });
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
chrome.storage.local.get(['isActive', 'outfit', 'persona', 'avatar'], (data) => {
  if (data.isActive !== undefined) activeToggle.checked = data.isActive;
  if (data.outfit) document.getElementById('outfit-select').value = data.outfit;
  if (data.persona) document.getElementById('persona-input').value = data.persona;
  if (data.avatar) document.getElementById('avatar-img').src = data.avatar;
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

document.getElementById('outfit-select').addEventListener('change', (event) => {
  chrome.storage.local.set({ outfit: event.target.value });
});

document.getElementById('persona-input').addEventListener('input', (event) => {
  chrome.storage.local.set({ persona: event.target.value });
});

document.getElementById('avatar-upload').addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = function(readerEvent) {
      const dataUrl = readerEvent.target.result;
      document.getElementById('avatar-img').src = dataUrl;
      chrome.storage.local.set({ avatar: dataUrl });
    };
    reader.readAsDataURL(file);
  }
});

async function sendChat() {
  if (!chatInput.value.trim()) return;

  chatBox.innerHTML += `<div><b>You:</b> ${escapeHtml(chatInput.value)}</div>`;
  const userMsg = chatInput.value;
  chatInput.value = '';
  sendBtn.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'route_chat',
      text: userMsg,
    });

    chatBox.innerHTML += `<div style="color: #e15f72;"><b>Dom:</b> ${escapeHtml(response.text)}</div>`;
    chatBox.scrollTop = chatBox.scrollHeight;
  } catch (error) {
    chatBox.innerHTML += `<div style="color: #e15f72;"><b>System:</b> ${escapeHtml(error.message || String(error))}</div>`;
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
