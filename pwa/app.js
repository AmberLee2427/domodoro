import { env, pipeline } from "../transformers.js";

const MODEL_ID = "onnx-community/gemma-4-E2B-it-ONNX";
const MODEL_DTYPE = "q4f16";
const MODEL_DEVICE = "webgpu";
const STORAGE_KEY = "domodoro-pwa-state";

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useWasmCache = false;
env.backends.onnx.wasm.wasmPaths = {
  mjs: new URL("../vendor/onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs", import.meta.url).href,
  wasm: new URL("../vendor/onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm", import.meta.url).href,
};
env.backends.onnx.wasm.proxy = false;

const activeLabel = document.getElementById("active-label");
const startBtn = document.getElementById("start-btn");
const pauseBtn = document.getElementById("pause-btn");
const resetBtn = document.getElementById("reset-btn");
const workMinutesInput = document.getElementById("work-minutes");
const breakMinutesInput = document.getElementById("break-minutes");
const modeLabel = document.getElementById("mode-label");
const timerDisplay = document.getElementById("timer-display");
const personaInput = document.getElementById("persona-input");
const warmBtn = document.getElementById("warm-btn");
const sendBtn = document.getElementById("send-btn");
const chatInput = document.getElementById("chat-input");
const chatBox = document.getElementById("chat-box");
const modelStatus = document.getElementById("model-status");

let generator;
let generatorPromise;
let notificationTimer;
let state = loadState();

function loadState() {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  return {
    mode: saved.mode || "work",
    running: false,
    workMinutes: clampMinutes(saved.workMinutes, 25),
    breakMinutes: clampMinutes(saved.breakMinutes, 5),
    persona: saved.persona || "An overbearing, possessive mafia boss who calls me trouble.",
    endAt: null,
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    mode: state.mode,
    workMinutes: state.workMinutes,
    breakMinutes: state.breakMinutes,
    persona: state.persona,
  }));
}

function clampMinutes(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.round(number), 1), 180);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;",
  })[char]);
}

function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function durationMs(mode = state.mode) {
  return (mode === "break" ? state.breakMinutes : state.workMinutes) * 60 * 1000;
}

function remainingMs() {
  return state.running && state.endAt ? state.endAt - Date.now() : durationMs();
}

function render() {
  const remaining = remainingMs();
  timerDisplay.textContent = formatTime(remaining);
  modeLabel.textContent = state.mode === "break" ? "Break Session" : "Focus Session";
  activeLabel.textContent = state.running ? "Running" : "Ready";
  startBtn.textContent = state.running ? "Restart" : "Start";
  pauseBtn.disabled = !state.running;
  workMinutesInput.value = state.workMinutes;
  breakMinutesInput.value = state.breakMinutes;
  personaInput.value = state.persona;
}

function appendChat(speaker, text) {
  chatBox.innerHTML += `<div><b>${escapeHtml(speaker)}:</b> ${escapeHtml(text)}</div>`;
  chatBox.scrollTop = chatBox.scrollHeight;
}

function setModelStatus(text, loading = false) {
  modelStatus.textContent = text;
  warmBtn.disabled = loading || Boolean(generator);
  sendBtn.disabled = loading;
}

async function getGenerator() {
  if (generator) return generator;
  if (!("gpu" in navigator)) {
    throw new Error("WebGPU is not available in this browser.");
  }

  if (!generatorPromise) {
    setModelStatus("Loading Gemma 4...", true);
    generatorPromise = pipeline("text-generation", MODEL_ID, {
      dtype: MODEL_DTYPE,
      device: MODEL_DEVICE,
      progress_callback: (info) => {
        if (info.status === "progress") {
          const percent = info.total ? Math.round((info.loaded / info.total) * 100) : 0;
          setModelStatus(percent >= 100 ? "Compiling WebGPU session..." : `Downloading ${percent}%`, true);
        }
      },
    })
      .then((loadedGenerator) => {
        generator = loadedGenerator;
        setModelStatus(`${MODEL_ID} is ready`);
        return loadedGenerator;
      })
      .catch((error) => {
        generatorPromise = undefined;
        setModelStatus(error.message || String(error));
        throw error;
      });
  }

  return generatorPromise;
}

function buildMessages(userMessage) {
  return [
    {
      role: "system",
      content:
        "You are Domodoro, a dramatic productivity coach for a Pomodoro timer. " +
        "Keep responses short, theatrical, possessive, and commanding, but stay PG-13.",
    },
    { role: "user", content: userMessage },
  ];
}

function cleanGeneratedText(output) {
  const generated = output?.[0]?.generated_text ?? output?.generated_text ?? "";
  const text = Array.isArray(generated)
    ? generated.at(-1)?.content || ""
    : String(generated);

  return text
    .replace(/<\|channel\>thought[\s\S]*?<channel\|>/g, "")
    .replace(/<\|[^>]+?\|>/g, "")
    .trim();
}

async function generateLine(prompt) {
  const model = await getGenerator();
  const output = await model(buildMessages(prompt), {
    max_new_tokens: 70,
    do_sample: true,
    temperature: 0.9,
    top_p: 0.95,
    top_k: 64,
  });

  return cleanGeneratedText(output) || "Break time, trouble. Up.";
}

function notify(text) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("Domodoro", {
      body: text,
      icon: "../suit.png",
    });
  }
}

async function handleSessionComplete() {
  const completedMode = state.mode;
  const prompt = completedMode === "work"
    ? `Persona: ${state.persona}. The user finished a ${state.workMinutes} minute focus session. Tell them to take a ${state.breakMinutes} minute break now.`
    : `Persona: ${state.persona}. The user's ${state.breakMinutes} minute break is over. Tell them to get back to work now.`;

  let line = completedMode === "work" ? "Break time, trouble." : "Back to work, trouble.";
  try {
    line = await generateLine(prompt);
  } catch (error) {
    setModelStatus(error.message || String(error));
  }

  appendChat("Dom", line);
  notify(line);
  startTimer(completedMode === "work" ? "break" : "work");
}

function scheduleCompletion() {
  clearTimeout(notificationTimer);
  notificationTimer = setTimeout(handleSessionComplete, Math.max(0, remainingMs()));
}

function startTimer(mode = state.mode) {
  state.mode = mode;
  state.running = true;
  state.endAt = Date.now() + durationMs(mode);
  scheduleCompletion();
  saveState();
  render();
}

function pauseTimer() {
  state.running = false;
  state.endAt = null;
  clearTimeout(notificationTimer);
  render();
}

function resetTimer() {
  state.mode = "work";
  pauseTimer();
  saveState();
}

function saveSettings() {
  state.workMinutes = clampMinutes(workMinutesInput.value, state.workMinutes);
  state.breakMinutes = clampMinutes(breakMinutesInput.value, state.breakMinutes);
  state.persona = personaInput.value.trim() || state.persona;
  if (state.running) startTimer(state.mode);
  saveState();
  render();
}

async function sendChat() {
  const text = chatInput.value.trim();
  if (!text) return;

  appendChat("You", text);
  chatInput.value = "";
  sendBtn.disabled = true;

  try {
    const line = await generateLine(`Persona: ${state.persona}. Reply to this user message: ${text}`);
    appendChat("Dom", line);
  } catch (error) {
    appendChat("System", error.message || String(error));
  } finally {
    sendBtn.disabled = false;
  }
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("service-worker.js").catch(() => {});
}

startBtn.addEventListener("click", () => startTimer(state.mode));
pauseBtn.addEventListener("click", pauseTimer);
resetBtn.addEventListener("click", resetTimer);
workMinutesInput.addEventListener("change", saveSettings);
breakMinutesInput.addEventListener("change", saveSettings);
personaInput.addEventListener("input", saveSettings);
warmBtn.addEventListener("click", () => getGenerator().catch((error) => appendChat("System", error.message || String(error))));
sendBtn.addEventListener("click", sendChat);
chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") sendChat();
});

if ("Notification" in window && Notification.permission === "default") {
  document.addEventListener("click", () => Notification.requestPermission(), { once: true });
}

render();
