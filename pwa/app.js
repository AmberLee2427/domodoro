import { AutoProcessor, env, Gemma4ForConditionalGeneration } from "../transformers.js";

const MODEL_ID = "onnx-community/gemma-4-E2B-it-ONNX";
const MODEL_DTYPE = {
  audio_encoder: "fp16",
  vision_encoder: "fp16",
  embed_tokens: "q4f16",
  decoder_model_merged: "q4f16",
};
const FALLBACK_DEVICE = "wasm";
const IS_MOBILE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
const HAS_WEBGPU = "gpu" in navigator;
const DEFAULT_MODEL_DEVICE = HAS_WEBGPU && window.isSecureContext ? "webgpu" : FALLBACK_DEVICE;
const MODEL_DOWNLOAD_BYTES = 3.3 * 1024 * 1024 * 1024;
const MODEL_STORAGE_HEADROOM = 1.35;
const STORAGE_KEY = "domodoro-pwa-state";
const BACKEND_KEY = "domodoro-model-backend";
const FRESH_FETCH_KEY = "domodoro-force-fresh-model-fetch";
const FRESH_FETCH_TOKEN_KEY = "domodoro-force-fresh-model-token";
const CHAT_LOG_KEY = "chatLog";
const CHAT_LOG_LIMIT = 20;
const POSES = ["default", "thinking", "stern", "pointing", "approval", "beckon"];

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useWasmCache = false;
env.useBrowserCache = false;
function cacheBustedModelUrl(url) {
  const freshToken = localStorage.getItem(FRESH_FETCH_TOKEN_KEY) || String(Date.now());
  const parsedUrl = new URL(url);
  parsedUrl.searchParams.set("domodoro_fresh", freshToken);
  return parsedUrl.href;
}

env.fetch = (resource, options = {}) => {
  const url = typeof resource === "string" ? resource : resource?.url || "";
  const shouldForceFresh = localStorage.getItem(FRESH_FETCH_KEY) === "true"
    && /huggingface\.co|hf\.co|xethub|onnx-community|gemma/i.test(url);

  if (!shouldForceFresh) {
    return fetch(resource, options);
  }

  const requestInit = resource instanceof Request
    ? {
        method: resource.method,
        headers: resource.headers,
        mode: resource.mode,
        credentials: resource.credentials,
        redirect: resource.redirect,
        referrer: resource.referrer,
        integrity: resource.integrity,
        signal: resource.signal,
        ...options,
      }
    : options;

  const freshUrl = cacheBustedModelUrl(url);
  setLoadingStatus("Fetching fresh model files...");

  return fetch(freshUrl, {
    ...requestInit,
    cache: "reload",
  });
};
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.wasmPaths = {
    mjs: new URL("../vendor/onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs", import.meta.url).href,
    wasm: new URL("../vendor/onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm", import.meta.url).href,
  };
  env.backends.onnx.wasm.proxy = false;
}

const activeLabel = document.getElementById("active-label");
const startBtn = document.getElementById("start-btn");
const pauseBtn = document.getElementById("pause-btn");
const resetBtn = document.getElementById("reset-btn");
const workMinutesInput = document.getElementById("work-minutes");
const breakMinutesInput = document.getElementById("break-minutes");
const modeLabel = document.getElementById("mode-label");
const timerDisplay = document.getElementById("timer-display");
const personaInput = document.getElementById("persona-input");
const characterSelect = document.getElementById("character-select");
const todoNote = document.getElementById("todo-note");
const domPortrait = document.getElementById("dom-portrait");
const avatarImg = document.getElementById("avatar-img");
const characterProgressBar = document.getElementById("character-progress-bar");
const sessionCount = document.getElementById("session-count");
const nextUnlock = document.getElementById("next-unlock");
const warmBtn = document.getElementById("warm-btn");
const purgeCacheBtn = document.getElementById("purge-cache-btn");
const backendSelect = document.getElementById("backend-select");
const sendBtn = document.getElementById("send-btn");
const chatInput = document.getElementById("chat-input");
const chatBox = document.getElementById("chat-box");
const modelStatus = document.getElementById("model-status");

let generator;
let generatorPromise;
let processor;
let notificationTimer;
let loadingProgress = 0;
let loadingStatusText = "";
let loadingStatusLastPaint = 0;
let loadingFiles = new Map();
let preferredBackend = localStorage.getItem(BACKEND_KEY) || "auto";
let activeModelDevice = resolveModelDevice();
let compileStartedAt = 0;
let compileStatusTimer;
let compileTransitionTimer;
let state = loadState();

const CHARACTERS = {
  default: {
    label: "Default",
    subtitle: "Sleek Office Demon",
    folder: "default",
    unlockAt: 0,
  },
  silk: {
    label: "Silk & Surrender",
    subtitle: "Soft Dom Edition",
    folder: "silk",
    unlockAt: 25,
  },
  director: {
    label: "Obsidian Director",
    subtitle: "Gothic Authority",
    folder: "director",
    unlockAt: 50,
  },
  chrome: {
    label: "Chrome Protocol",
    subtitle: "Cyber Efficiency",
    folder: "chrome",
    unlockAt: 75,
  },
  king: {
    label: "Productivity King",
    subtitle: "Too Powerful",
    folder: "king",
    unlockAt: 100,
  },
};

function loadState() {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  return {
    mode: saved.mode || "work",
    running: false,
    workMinutes: clampMinutes(saved.workMinutes, 25),
    breakMinutes: clampMinutes(saved.breakMinutes, 5),
    persona: saved.persona || "An overbearing, possessive shadow daddy who calls me trouble.",
    character: saved.character || "default",
    pose: normalizePose(saved.pose),
    todo: saved.todo || "",
    completedSessions: Number.isFinite(saved.completedSessions) ? saved.completedSessions : 0,
    chatLog: Array.isArray(saved.chatLog) ? saved.chatLog.slice(-CHAT_LOG_LIMIT) : [],
    endAt: null,
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    mode: state.mode,
    workMinutes: state.workMinutes,
    breakMinutes: state.breakMinutes,
    persona: state.persona,
    character: state.character,
    pose: state.pose,
    todo: state.todo,
    completedSessions: state.completedSessions,
    chatLog: state.chatLog,
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

function normalizePose(value) {
  return POSES.includes(value) ? value : "default";
}

function resolveModelDevice() {
  if (preferredBackend === "wasm") return "wasm";
  if (preferredBackend === "webgpu") return "webgpu";
  return DEFAULT_MODEL_DEVICE;
}

function posePath(characterKey = state.character, pose = state.pose) {
  const character = CHARACTERS[characterKey] || CHARACTERS.default;
  return `../assets/characters/${character.folder}/${normalizePose(pose)}.png`;
}

function headshotPath(characterKey = state.character) {
  const character = CHARACTERS[characterKey] || CHARACTERS.default;
  return `../assets/characters/${character.folder}/headshot.png`;
}

function setPose(pose) {
  state.pose = normalizePose(pose);
  domPortrait.src = posePath(state.character, state.pose);
  saveState();
}

function normalizeChatEntry(entry) {
  return {
    role: ["user", "assistant", "tool", "system"].includes(entry?.role) ? entry.role : "system",
    name: entry?.name || "",
    pose: entry?.pose !== undefined && entry?.pose !== null ? normalizePose(entry.pose) : undefined,
    content: String(entry?.content || "").trim(),
    timestamp: Number.isFinite(entry?.timestamp) ? entry.timestamp : Date.now(),
  };
}

function formatChatEntry(entry) {
  if (entry.role === "user") return `You: ${entry.content}`;
  if (entry.role === "assistant") return `Dom: ${entry.content}`;
  if (entry.role === "tool") return `Tool ${entry.name || "tool"}: ${entry.content}`;
  return `System: ${entry.content}`;
}

function renderChatEntry(entry) {
  if (entry.role === "user") {
    return `<div class="chat-line user"><b>You:</b> ${escapeHtml(entry.content || "")}</div>`;
  }

  if (entry.role === "assistant") {
    return `<div class="chat-line dom"><b>Dom:</b> ${escapeHtml(entry.content || "")}</div>`;
  }

  return "";
}

function renderChatLog() {
  chatBox.innerHTML = state.chatLog.map(renderChatEntry).filter(Boolean).join("");
  chatBox.scrollTop = chatBox.scrollHeight;
}

function appendChatEntry(entry) {
  state.chatLog = state.chatLog.concat(normalizeChatEntry(entry)).slice(-CHAT_LOG_LIMIT);
  saveState();
  renderChatLog();
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
  const character = CHARACTERS[state.character] || CHARACTERS.default;
  if (character.unlockAt > state.completedSessions) {
    state.character = "default";
    saveState();
  }
  const activeCharacter = CHARACTERS[state.character] || CHARACTERS.default;
  const upcomingUnlock = Object.values(CHARACTERS)
    .filter((item) => item.unlockAt > state.completedSessions)
    .sort((a, b) => a.unlockAt - b.unlockAt)[0];
  const previousUnlockAt = Object.values(CHARACTERS)
    .filter((item) => item.unlockAt <= state.completedSessions)
    .reduce((max, item) => Math.max(max, item.unlockAt), 0);
  const targetUnlockAt = (upcomingUnlock?.unlockAt ?? state.completedSessions) || 1;
  const progressRange = Math.max(1, targetUnlockAt - previousUnlockAt);
  const progress = upcomingUnlock
    ? ((state.completedSessions - previousUnlockAt) / progressRange) * 100
    : 100;

  timerDisplay.textContent = formatTime(remaining);
  modeLabel.textContent = state.mode === "break" ? "Break Session" : "Focus Session";
  activeLabel.textContent = state.running ? "Running" : "Ready";
  startBtn.textContent = state.running ? "Restart" : "Start";
  pauseBtn.disabled = !state.running;
  if (backendSelect) backendSelect.value = preferredBackend;
  workMinutesInput.value = state.workMinutes;
  breakMinutesInput.value = state.breakMinutes;
  personaInput.value = state.persona;
  characterSelect.value = state.character;
  todoNote.value = state.todo;
  domPortrait.src = posePath(state.character, state.pose);
  avatarImg.src = headshotPath(state.character);
  characterProgressBar.style.width = `${Math.max(0, Math.min(100, progress))}%`;
  sessionCount.textContent = `${state.completedSessions} sessions`;
  nextUnlock.textContent = upcomingUnlock
    ? `Next: ${upcomingUnlock.label} at ${upcomingUnlock.unlockAt}`
    : "All outfits unlocked";

  for (const option of characterSelect.options) {
    const optionCharacter = CHARACTERS[option.value];
    const locked = optionCharacter.unlockAt > state.completedSessions;
    option.disabled = locked;
    option.textContent = locked
      ? `${optionCharacter.label} (${optionCharacter.unlockAt})`
      : optionCharacter.label;
  }
}

function renderTimerTick() {
  timerDisplay.textContent = formatTime(remainingMs());
  activeLabel.textContent = state.running ? "Running" : "Ready";
}

function appendChat(speaker, text) {
  const kind = speaker.toLowerCase() === "dom"
    ? "dom"
    : speaker.toLowerCase() === "system"
      ? "system"
      : "user";
  chatBox.innerHTML += `<div class="chat-line ${kind}"><b>${escapeHtml(speaker)}:</b> ${escapeHtml(text)}</div>`;
  chatBox.scrollTop = chatBox.scrollHeight;
}

function setModelStatus(text, loading = false) {
  modelStatus.textContent = text;
  warmBtn.disabled = loading || Boolean(generator);
  if (purgeCacheBtn) purgeCacheBtn.disabled = loading;
  sendBtn.disabled = loading;
}

function setLoadingStatus(text, { force = false } = {}) {
  const now = Date.now();
  if (!force && text === loadingStatusText) return;
  if (!force && now - loadingStatusLastPaint < 500) return;

  loadingStatusText = text;
  loadingStatusLastPaint = now;
  setModelStatus(text, true);
}

function stopCompileStatus() {
  clearTimeout(compileTransitionTimer);
  compileTransitionTimer = undefined;
  clearInterval(compileStatusTimer);
  compileStatusTimer = undefined;
  compileStartedAt = 0;
}

function scheduleCompileStatus(device) {
  if (compileStatusTimer || compileTransitionTimer) return;

  compileTransitionTimer = setTimeout(() => {
    compileTransitionTimer = undefined;
    startCompileStatus(device);
  }, 3000);
}

function startCompileStatus(device) {
  stopCompileStatus();
  compileStartedAt = Date.now();
  setLoadingStatus(`Compiling ${device.toUpperCase()} session...`, { force: true });
  compileStatusTimer = setInterval(() => {
    const seconds = Math.floor((Date.now() - compileStartedAt) / 1000);
    const warning = seconds >= 120
      ? " If this does not finish, the phone likely has enough storage but not enough GPU/RAM headroom for this local Gemma 4 session."
      : "";
    setLoadingStatus(`Compiling ${device.toUpperCase()} session... ${seconds}s elapsed.${warning}`, { force: true });
  }, 1000);
}

function resetLoadingTelemetry() {
  loadingProgress = 0;
  loadingStatusText = "";
  loadingStatusLastPaint = 0;
  loadingFiles = new Map();
  stopCompileStatus();
}

function bundleProgressFromFiles() {
  let loaded = 0;
  let total = 0;

  for (const file of loadingFiles.values()) {
    if (!Number.isFinite(file.total) || file.total <= 0) continue;
    loaded += Math.min(file.loaded || 0, file.total);
    total += file.total;
  }

  if (total <= 0) return loadingProgress;
  return Math.floor((loaded / total) * 100);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "unknown";
  const gib = bytes / 1024 / 1024 / 1024;
  if (gib >= 1) return `${gib.toFixed(1)} GB`;
  return `${Math.ceil(bytes / 1024 / 1024)} MB`;
}

function quotaErrorMessage(available, needed, quota, usage, persisted) {
  const prefix = IS_MOBILE
    ? "Dom is too powerful for this phone browser."
    : "Dom needs more browser storage.";

  return [
    prefix,
    `Need about ${formatBytes(needed)} free for ${MODEL_ID}.`,
    `Browser quota: ${formatBytes(quota)}.`,
    `Already used: ${formatBytes(usage)}.`,
    `Available: ${formatBytes(available)}.`,
    `Persistent storage: ${persisted ? "granted" : "not granted"}.`,
  ].join(" ");
}

function updateLoadingProgress(info, device) {
  if (info.status === "progress_total") {
    const percent = Number.isFinite(info.progress) ? Math.floor(info.progress) : loadingProgress;
    loadingProgress = Math.max(loadingProgress, Math.min(99, percent));
    setLoadingStatus(`Downloading model bundle ${loadingProgress}%`);

    if (percent >= 100) {
      loadingProgress = 100;
      setLoadingStatus("Download complete. Preparing model session...", { force: true });
      scheduleCompileStatus(device);
    }

    return;
  }

  if (info.status === "ready") {
    setLoadingStatus("Preparing model files...");
    return;
  }

  if (info.status !== "progress") {
    if (info.status) {
      setLoadingStatus(`${info.status}: ${info.file || info.name || MODEL_ID}`);
    }
    return;
  }

  if (info.file) {
    loadingFiles.set(info.file, {
      loaded: Number(info.loaded) || 0,
      total: Number(info.total) || 0,
    });
  }

  const aggregatePercent = bundleProgressFromFiles();
  const steppedPercent = Math.min(99, Math.max(loadingProgress, Math.floor(aggregatePercent / 5) * 5));

  if (steppedPercent > loadingProgress) {
    loadingProgress = steppedPercent;
  }

  setLoadingStatus(`Downloading model bundle ${loadingProgress}%`);
}

function describeError(error) {
  return error?.message || String(error || "Unknown model error");
}

function webGpuProblem(device = resolveModelDevice()) {
  if (!env.backends?.onnx?.wasm) {
    return "Model backend did not initialize.";
  }

  if (device === "webgpu" && !window.isSecureContext) {
    return "Model needs HTTPS or localhost for WebGPU.";
  }

  if (device === "webgpu" && !("gpu" in navigator)) {
    return "WebGPU is not available in this browser.";
  }

  return "";
}

async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

async function ensureStorageRoom() {
  const needed = MODEL_DOWNLOAD_BYTES * MODEL_STORAGE_HEADROOM;

  if (!navigator.storage?.estimate) {
    if (IS_MOBILE) {
      throw new Error(
        "Dom is too powerful for this phone browser. " +
        `It cannot report storage quota, and ${MODEL_ID} needs about ${formatBytes(needed)} free.`,
      );
    }
    return;
  }

  const estimate = await navigator.storage.estimate();
  const quota = estimate.quota || 0;
  const usage = estimate.usage || 0;
  const available = quota ? quota - usage : 0;
  const persistedBefore = navigator.storage.persisted
    ? await navigator.storage.persisted().catch(() => false)
    : false;

  if (!quota || available >= needed) return;

  const persistedAfterRequest = await requestPersistentStorage();
  const refreshed = await navigator.storage.estimate();
  const refreshedQuota = refreshed.quota || 0;
  const refreshedUsage = refreshed.usage || 0;
  const refreshedAvailable = refreshedQuota - refreshedUsage;
  const persistedAfter = navigator.storage.persisted
    ? await navigator.storage.persisted().catch(() => persistedAfterRequest)
    : persistedAfterRequest || persistedBefore;

  if (refreshedAvailable < needed) {
    throw new Error(quotaErrorMessage(
      refreshedAvailable,
      needed,
      refreshedQuota,
      refreshedUsage,
      persistedAfter,
    ));
  }
}

async function showStorageDiagnostics() {
  const needed = MODEL_DOWNLOAD_BYTES * MODEL_STORAGE_HEADROOM;

  if (!navigator.storage?.estimate) {
    setModelStatus(
      `Storage quota unavailable. ${MODEL_ID} needs about ${formatBytes(needed)} free.`,
    );
    return;
  }

  const estimate = await navigator.storage.estimate();
  const persisted = navigator.storage.persisted
    ? await navigator.storage.persisted().catch(() => false)
    : false;
  const quota = estimate.quota || 0;
  const usage = estimate.usage || 0;
  const available = quota ? quota - usage : 0;

  if (available < needed) {
    setModelStatus(quotaErrorMessage(available, needed, quota, usage, persisted));
  } else {
    setModelStatus(
      `Browser storage looks plausible. Need about ${formatBytes(needed)} free; available ${formatBytes(available)}.`,
    );
  }
}

async function purgeModelCache() {
  stopCompileStatus();
  generator = undefined;
  generatorPromise = undefined;
  processor = undefined;
  loadingProgress = 0;
  localStorage.setItem(FRESH_FETCH_KEY, "true");
  localStorage.setItem(FRESH_FETCH_TOKEN_KEY, String(Date.now()));

  let deletedEntries = 0;
  let deletedCaches = 0;
  let checkedEntries = 0;
  const cacheDetails = [];

  if ("caches" in window) {
    const cacheNames = await caches.keys();
    for (const cacheName of cacheNames) {
      if (/transformers|huggingface|hf-|onnx/i.test(cacheName)) {
        if (await caches.delete(cacheName)) deletedCaches += 1;
        cacheDetails.push(`${cacheName}: deleted bucket`);
        continue;
      }

      const cache = await caches.open(cacheName);
      const requests = await cache.keys();
      for (const request of requests) {
        checkedEntries += 1;
        if (/huggingface\.co|hf\.co|xethub|onnx-community|gemma/i.test(request.url)) {
          if (await cache.delete(request)) deletedEntries += 1;
        }
      }
    }
  }

  setModelStatus(
    `Model cache purged. Removed ${deletedCaches} cache bucket(s) and ${deletedEntries} model request(s). Checked ${checkedEntries} app cache request(s). ${cacheDetails.join(" ")} The next summon will bypass the browser HTTP cache with cache-busted model URLs.`,
  );
}

async function getGenerator() {
  if (generator) return generator;
  const device = resolveModelDevice();
  activeModelDevice = device;
  const problem = webGpuProblem(device);
  if (problem) {
    throw new Error(problem);
  }

  if (!generatorPromise) {
    loadingProgress = 0;
    loadingStatusText = "";
    loadingStatusLastPaint = 0;
    stopCompileStatus();
    const loadWithDevice = async (device, statusLabel) => {
      activeModelDevice = device;
      setModelStatus(statusLabel, true);
      await ensureStorageRoom();
      const progress_callback = (info) => updateLoadingProgress(info, device);
      const [loadedProcessor, loadedModel] = await Promise.all([
        AutoProcessor.from_pretrained(MODEL_ID, { progress_callback }),
        Gemma4ForConditionalGeneration.from_pretrained(MODEL_ID, {
          dtype: MODEL_DTYPE,
          device,
          progress_callback,
        }),
      ]);
      processor = loadedProcessor;
      return loadedModel;
    };

    generatorPromise = loadWithDevice(device, `Summoning Dom (${device.toUpperCase()})...`)
      .catch(async (error) => {
        if (/Dom is too powerful|storage/i.test(String(error.message || error))) {
          throw error;
        }

        console.warn("WebGPU model load failed, trying WASM fallback", error);
        if (device !== "webgpu") {
          throw error;
        }

        setModelStatus("WebGPU failed, switching to WASM fallback...", true);
        return loadWithDevice(FALLBACK_DEVICE, "Summoning Dom in WASM mode...");
      })
      .then((loadedGenerator) => {
        generator = loadedGenerator;
        localStorage.removeItem(FRESH_FETCH_KEY);
        localStorage.removeItem(FRESH_FETCH_TOKEN_KEY);
        stopCompileStatus();
        setModelStatus(`${MODEL_ID} is ready (${activeModelDevice})`);
        return loadedGenerator;
      })
      .catch((error) => {
        console.error("Domodoro model load failed", error);
        generatorPromise = undefined;
        loadingProgress = 0;
        stopCompileStatus();
        setModelStatus(describeError(error));
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
        "Keep responses short, theatrical, possessive, and commanding, but stay PG-13. " +
        "You will receive the full chat log and latest request in the user message. " +
        `You must choose one pose from: ${POSES.join(", ")}. ` +
        "Respond with compact JSON only, exactly like {\"pose\":\"stern\",\"text\":\"Back to work, trouble.\"}. " +
        "No markdown and no extra keys.",
    },
    { role: "user", content: userMessage },
  ];
}

function cleanGeneratedText(output) {
  if (typeof output === "string") {
    return output
      .replace(/<\|channel\>thought[\s\S]*?<channel\|>/g, "")
      .replace(/<\|[^>]+?\|>/g, "")
      .replace(/<turn\|>|<channel\|>|<tool_response\|>/g, "")
      .trim();
  }

  const generated = output?.[0]?.generated_text ?? output?.generated_text ?? "";
  const text = Array.isArray(generated)
    ? generated.at(-1)?.content || ""
    : String(generated);

  return text
    .replace(/<\|channel\>thought[\s\S]*?<channel\|>/g, "")
    .replace(/<\|[^>]+?\|>/g, "")
    .replace(/<turn\|>|<channel\|>|<tool_response\|>/g, "")
    .trim();
}

function parseDomResponse(rawText) {
  const raw = cleanGeneratedText(rawText)
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);

  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const text = parsed.text || parsed.response || parsed.message || "";
      return {
        text: String(text).trim() || "Break time, trouble. Up.",
        pose: normalizePose(parsed.pose),
      };
    } catch {
      // Fall through to the forgiving parser below.
    }
  }

  const poseMatch = raw.match(/^\s*pose\s*[:=-]\s*([a-z-]+)/im);
  const text = raw
    .replace(/^\s*pose\s*[:=-]\s*[a-z-]+\s*$/im, "")
    .replace(/^\s*text\s*[:=-]\s*/im, "")
    .trim();

  return {
    text: text || "Break time, trouble. Up.",
    pose: normalizePose(poseMatch?.[1]),
  };
}

async function generateLine(prompt) {
  const model = await getGenerator();
  if (!processor) throw new Error("Model processor is not loaded.");

  const messages = buildMessages(prompt);
  const promptText = processor.apply_chat_template(messages, {
    add_generation_prompt: true,
    enable_thinking: false,
  });
  const inputs = await processor(promptText, null, null, { add_special_tokens: false });
  const output = await model.generate({
    ...inputs,
    max_new_tokens: 110,
    do_sample: true,
    temperature: 0.9,
    top_p: 0.95,
    top_k: 64,
  });
  const promptLength = inputs.input_ids.dims.at(-1);
  const decoded = processor.batch_decode(
    output.slice(null, [promptLength, null]),
    { skip_special_tokens: false },
  )[0];

  return parseDomResponse(decoded);
}

function contextBlock() {
  const character = CHARACTERS[state.character] || CHARACTERS.default;
  const todo = state.todo.trim() || "No written tasks. Improvise based on the timer.";
  return [
    `Persona: ${state.persona}.`,
    `Current character: ${character.label} - ${character.subtitle}.`,
    `User's todo/context note: ${todo}`,
  ].join("\n");
}

function chatLogBlock() {
  return state.chatLog.length > 0
    ? state.chatLog.map(formatChatEntry).join("\n")
    : "No prior messages.";
}

function buildConversationPrompt(requestText) {
  return [
    contextBlock(),
    "Full chat log:",
    chatLogBlock(),
    "",
    `Latest request: ${requestText}`,
    `Choose one pose from ${POSES.join(", ")} and return JSON only: {\"pose\":\"default\",\"text\":\"...\"}.`,
    "No markdown and no extra keys.",
  ].join("\n");
}

function notify(text) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("Domodoro", {
      body: text,
      icon: "../assets/paperclip-logo-192.png",
    });
  }
}

async function handleSessionComplete() {
  const completedMode = state.mode;
  const requestText = completedMode === "work"
    ? `Timer event: the user finished a ${state.workMinutes} minute focus session and should take a ${state.breakMinutes} minute break now.`
    : `Timer event: the user's ${state.breakMinutes} minute break is over and they should get back to work now.`;

  appendChatEntry({ role: "system", content: requestText });

  let reply = {
    text: completedMode === "work" ? "Break time, trouble." : "Back to work, trouble.",
    pose: "default",
  };
  try {
    reply = await generateLine(buildConversationPrompt(requestText));
  } catch (error) {
    setModelStatus(describeError(error));
  }

  setPose(reply.pose);
  appendChatEntry({ role: "assistant", content: reply.text, pose: reply.pose });
  appendChatEntry({ role: "tool", name: "set_pose", content: reply.pose });
  notify(reply.text);
  if (completedMode === "work") {
    state.completedSessions += 1;
    saveState();
  }
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
  state.todo = todoNote.value;
  state.character = characterSelect.value;
  saveState();
  if (state.running) {
    scheduleCompletion();
  }
  state.pose = normalizePose(state.pose);
  render();
}

async function sendChat() {
  const text = chatInput.value.trim();
  if (!text) return;

  appendChatEntry({ role: "user", content: text });
  chatInput.value = "";
  sendBtn.disabled = true;

  try {
    const reply = await generateLine(buildConversationPrompt(text));
    setPose(reply.pose);
    appendChatEntry({ role: "assistant", content: reply.text, pose: reply.pose });
    appendChatEntry({ role: "tool", name: "set_pose", content: reply.pose });
  } catch (error) {
    setModelStatus(describeError(error));
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
characterSelect.addEventListener("change", saveSettings);
todoNote.addEventListener("input", saveSettings);
if (backendSelect) {
  backendSelect.addEventListener("change", () => {
    preferredBackend = backendSelect.value;
    localStorage.setItem(BACKEND_KEY, preferredBackend);
    generator = undefined;
    generatorPromise = undefined;
    processor = undefined;
    loadingProgress = 0;
    stopCompileStatus();
    setModelStatus(`Backend set to ${resolveModelDevice().toUpperCase()}. Summon Dom to load with this backend.`);
  });
}
domPortrait.addEventListener("error", () => {
  domPortrait.src = "../assets/characters/default/default.png";
});
avatarImg.addEventListener("error", () => {
  avatarImg.src = "../assets/characters/default/headshot.png";
});
warmBtn.addEventListener("click", async () => {
  setModelStatus("Summoning Dom...", true);

  try {
    await getGenerator();
  } catch (error) {
    console.error("Domodoro summon failed", error);
    const message = describeError(error);
    setModelStatus(message);
    appendChat("System", message);
  }
});
if (purgeCacheBtn) {
  purgeCacheBtn.addEventListener("click", async () => {
    setModelStatus("Purging model cache...", true);
    try {
      await purgeModelCache();
    } catch (error) {
      setModelStatus(`Cache purge failed: ${describeError(error)}`);
    }
  });
}
sendBtn.addEventListener("click", sendChat);
chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") sendChat();
});

setInterval(() => {
  if (state.running) renderTimerTick();
}, 250);

if ("Notification" in window && Notification.permission === "default") {
  document.addEventListener("click", () => Notification.requestPermission(), { once: true });
}

render();
renderChatLog();

const startupProblem = webGpuProblem();
if (startupProblem) {
  setModelStatus(startupProblem);
} else if (IS_MOBILE) {
  showStorageDiagnostics().then(() => {
    if (resolveModelDevice() === "webgpu") {
      modelStatus.textContent += " If WebGPU crashes during compile, switch Model Backend to WASM before summoning.";
    }
  }).catch(() => {});
}
