const SESSION_ALARM = "domodoro-session";
const OFFSCREEN_URL = "offscreen.html";
const CHAT_LOG_KEY = "domodoro-chat-log";
const LAST_POSE_KEY = "domodoro-last-pose";
const CHAT_LOG_LIMIT = 20;
const DEFAULT_WORK_MINUTES = 25;
const DEFAULT_BREAK_MINUTES = 5;
const DEFAULT_VOICE_ENABLED = true;
const DEFAULT_BLACKLIST = [
  "youtube.com",
  "reddit.com",
  "x.com",
  "twitter.com",
  "tiktok.com",
  "instagram.com",
];
const POSES = ["default", "thinking", "stern", "pointing", "approval", "beckon"];
const CHARACTERS = {
  default: {
    label: "Default",
    subtitle: "Sleek Office Demon",
    folder: "default",
  },
  silk: {
    label: "Silk & Surrender",
    subtitle: "Soft Dom Edition",
    folder: "silk",
  },
  director: {
    label: "Obsidian Director",
    subtitle: "Gothic Authority",
    folder: "director",
  },
  chrome: {
    label: "Chrome Protocol",
    subtitle: "Cyber Efficiency",
    folder: "chrome",
  },
  king: {
    label: "Productivity King",
    subtitle: "Too Powerful",
    folder: "king",
  },
};

let creatingOffscreenDocument;

async function ensureOffscreenDocument() {
  if (!chrome.offscreen) {
    throw new Error("Chrome offscreen documents are unavailable in this browser.");
  }

  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_URL);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl],
  });

  if (contexts.length > 0) return;
  if (creatingOffscreenDocument) {
    await creatingOffscreenDocument;
    return;
  }

  creatingOffscreenDocument = chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["BLOBS"],
    justification: "Run Transformers.js WebGPU/WASM in a document context with browser APIs unavailable to the MV3 service worker.",
  });

  try {
    await creatingOffscreenDocument;
  } finally {
    creatingOffscreenDocument = undefined;
  }
}

async function sendOffscreenMessage(message) {
  await ensureOffscreenDocument();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await chrome.runtime.sendMessage({ ...message, target: "offscreen" });
    } catch (error) {
      if (!String(error.message || error).includes("Receiving end does not exist") || attempt === 4) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

async function generateDomodoroLine(userMessage, maxNewTokens = 70) {
  const response = await sendOffscreenMessage({
    action: "generate_text",
    text: userMessage,
    maxNewTokens,
  });

  return response?.text || "Break time, trouble. Up.";
}

function normalizePose(value) {
  return POSES.includes(value) ? value : "default";
}

function characterSummary(key) {
  const character = CHARACTERS[key] || CHARACTERS.default;
  return `${character.label} - ${character.subtitle}`;
}

function characterFolder(key) {
  return (CHARACTERS[key] || CHARACTERS.default).folder;
}

function speechText(value) {
  return String(value || "")
    .replace(/\*\*?|__?|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function speakDomodoro(text, options = {}) {
  const data = await chrome.storage.local.get(["voiceEnabled", "voiceRate", "voicePitch"]);
  if (data.voiceEnabled === false || !chrome.tts?.speak) return;

  const utterance = speechText(text);
  if (!utterance) return;

  chrome.tts.stop?.();
  chrome.tts.speak(utterance, {
    enqueue: false,
    rate: Number.isFinite(data.voiceRate) ? data.voiceRate : 0.9,
    pitch: Number.isFinite(data.voicePitch) ? data.voicePitch : 0.72,
    volume: 1,
    ...options,
  });
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

function buildConversationPrompt(chatLog, requestText, persona, outfit, todo) {
  const transcript = chatLog.length > 0
    ? chatLog.map(formatChatEntry).join("\n")
    : "No prior messages.";
  const taskNote = String(todo || "").trim() || "No written task note. Improvise from the timer.";

  return [
    `Persona: ${persona}. Outfit: ${outfit}.`,
    `User's sticky note: ${taskNote}`,
    "You are continuing a running chat log. Use the full transcript for context and continuity.",
    "The transcript includes user messages, assistant replies, and tool calls.",
    "",
    "Full chat log:",
    transcript,
    "",
    `Latest request: ${requestText}`,
    `Choose one pose from ${POSES.join(", ")} and return JSON only: {\"pose\":\"default\",\"text\":\"...\"}.`,
    "No markdown and no extra keys.",
  ].join("\n");
}

async function getChatLog() {
  const data = await chrome.storage.local.get([CHAT_LOG_KEY]);
  return Array.isArray(data[CHAT_LOG_KEY]) ? data[CHAT_LOG_KEY].map(normalizeChatEntry) : [];
}

async function appendChatEntries(entries) {
  const currentLog = await getChatLog();
  const normalizedEntries = entries.map(normalizeChatEntry);
  const nextLog = currentLog.concat(normalizedEntries).slice(-CHAT_LOG_LIMIT);
  const update = { [CHAT_LOG_KEY]: nextLog };
  const lastPoseEntry = [...normalizedEntries].reverse().find((entry) => entry.pose && entry.role !== "tool");
  if (lastPoseEntry) {
    update[LAST_POSE_KEY] = lastPoseEntry.pose;
  }
  await chrome.storage.local.set(update);
  return nextLog;
}

function canInjectIntoTab(tab) {
  return Boolean(tab?.id && /^https?:\/\//.test(tab.url || ""));
}

function parseDomodoroReply(rawText) {
  const raw = String(rawText || "")
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

async function generateDomodoroReply(userMessage, maxNewTokens = 120) {
  const rawText = await generateDomodoroLine(
    `${userMessage}\nChoose one pose from ${POSES.join(", ")} and return JSON only: {"pose":"default","text":"..."}.`,
    maxNewTokens,
  );
  return parseDomodoroReply(rawText);
}

function normalizeMinutes(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, 1), 180);
}

async function getTimerState() {
  const data = await chrome.storage.local.get([
    "isActive",
    "timerMode",
    "timerRunning",
    "workMinutes",
    "breakMinutes",
    "completedSessions",
    "sessionEndAt",
  ]);

  return {
    isActive: data.isActive !== false,
    mode: data.timerMode || "work",
    running: data.timerRunning === true,
    workMinutes: normalizeMinutes(data.workMinutes, DEFAULT_WORK_MINUTES),
    breakMinutes: normalizeMinutes(data.breakMinutes, DEFAULT_BREAK_MINUTES),
    completedSessions: Number.isFinite(data.completedSessions) ? data.completedSessions : 0,
    endAt: data.sessionEndAt || null,
  };
}

function modeDurationMinutes(state, mode = state.mode) {
  return mode === "break" ? state.breakMinutes : state.workMinutes;
}

async function broadcastTimerState() {
  const state = await getTimerState();
  try {
    const maybePromise = chrome.runtime.sendMessage({ action: "timer_state", state });
    maybePromise?.catch?.(() => {});
  } catch {
    // No popup is listening right now.
  }
  return state;
}

async function scheduleSession(mode, durationMinutes) {
  const endAt = Date.now() + durationMinutes * 60 * 1000;
  await chrome.alarms.clear(SESSION_ALARM);
  chrome.alarms.create(SESSION_ALARM, { when: endAt });
  await chrome.storage.local.set({
    isActive: true,
    timerMode: mode,
    timerRunning: true,
    sessionEndAt: endAt,
  });
  return broadcastTimerState();
}

async function pauseTimer() {
  await chrome.alarms.clear(SESSION_ALARM);
  await chrome.storage.local.set({ timerRunning: false, sessionEndAt: null });
  return broadcastTimerState();
}

async function resetTimer(mode = "work") {
  await chrome.alarms.clear(SESSION_ALARM);
  await chrome.storage.local.set({
    timerMode: mode,
    timerRunning: false,
    sessionEndAt: null,
  });
  return broadcastTimerState();
}

async function notifyActiveTab(message, pose = "default", character = "default") {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!canInjectIntoTab(tab)) return;

  const payload = {
    action: "display_clippy",
    message,
    pose: normalizePose(pose),
    character: characterFolder(character),
  };

  try {
    await chrome.tabs.sendMessage(tab.id, payload);
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
      await chrome.tabs.sendMessage(tab.id, payload);
    } catch {
      // Some pages, like browser-owned pages, cannot receive content scripts.
    }
  }
}

// Set up defaults on install without clobbering existing settings.
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get([
    "isActive",
    "workMinutes",
    "breakMinutes",
    "timerMode",
    "completedSessions",
    "outfit",
    "blacklistEnabled",
    "blacklistedSites",
    "voiceEnabled",
    "voiceRate",
    "voicePitch",
  ]);
  await chrome.storage.local.set({
    isActive: data.isActive ?? true,
    workMinutes: data.workMinutes ?? DEFAULT_WORK_MINUTES,
    breakMinutes: data.breakMinutes ?? DEFAULT_BREAK_MINUTES,
    timerMode: data.timerMode ?? "work",
    completedSessions: data.completedSessions ?? 0,
    outfit: data.outfit ?? "default",
    blacklistEnabled: data.blacklistEnabled ?? true,
    blacklistedSites: Array.isArray(data.blacklistedSites) && data.blacklistedSites.length
      ? data.blacklistedSites
      : DEFAULT_BLACKLIST,
    voiceEnabled: data.voiceEnabled ?? DEFAULT_VOICE_ENABLED,
    voiceRate: data.voiceRate ?? 0.9,
    voicePitch: data.voicePitch ?? 0.72,
    timerRunning: false,
    sessionEndAt: null,
  });
});

// Handle work/break transitions.
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === SESSION_ALARM) {
    const state = await getTimerState();
    if (!state.isActive || !state.running) return;

    try {
      const prefs = await chrome.storage.local.get(['persona', 'outfit', 'todo']);
      const customPersona = prefs.persona || "An overbearing, possessive shadow daddy who calls me trouble.";
      const outfit = characterSummary(prefs.outfit);
      const todo = prefs.todo || "";
      const completedMode = state.mode;
      const nextMode = completedMode === "work" ? "break" : "work";
      const nextDuration = modeDurationMinutes(state, nextMode);
      const transitionRequest = completedMode === "work"
        ? `Timer event: the user finished a ${state.workMinutes} minute focus session and should take a ${state.breakMinutes} minute break now.`
        : `Timer event: the user's ${state.breakMinutes} minute break is over and they should get back to work now.`;
      let reply;

      try {
        await appendChatEntries([
          {
            role: "system",
            content: transitionRequest,
          },
        ]);
        const chatLog = await getChatLog();
        reply = await generateDomodoroReply(
          buildConversationPrompt(chatLog, transitionRequest, customPersona, outfit, todo),
        );
      } catch {
        reply = {
          text: completedMode === "work"
            ? `Focus complete, trouble. Take your ${state.breakMinutes} minute break.`
            : "Break is over. Back to work.",
          pose: completedMode === "work" ? "approval" : "pointing",
        };
      }

      await appendChatEntries([
        {
          role: "assistant",
          content: reply.text,
          pose: reply.pose,
        },
        {
          role: "tool",
          name: "set_pose",
          content: reply.pose,
        },
      ]);
      await notifyActiveTab(reply.text, reply.pose, prefs.outfit);
      await speakDomodoro(reply.text).catch(() => {});
      if (completedMode === "work") {
        await chrome.storage.local.set({
          completedSessions: state.completedSessions + 1,
        });
      }
      await scheduleSession(nextMode, nextDuration);
    } catch (error) {
      console.error("Domodoro panicked:", error);
    }
  }
});

// Handle direct chat from the popup UI
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.target === "offscreen") return false;

  if (request.action === "route_chat") {
    (async () => {
      try {
        const prefs = await chrome.storage.local.get(['persona', 'outfit', 'todo']);
        const customPersona = prefs.persona || "An overbearing, possessive shadow daddy who calls me trouble.";
        const outfit = characterSummary(prefs.outfit);
        const todo = prefs.todo || "";
        await appendChatEntries([
          {
            role: "user",
            content: request.text,
          },
        ]);
        const chatLog = await getChatLog();

        const reply = await generateDomodoroReply(
          buildConversationPrompt(chatLog, request.text, customPersona, outfit, todo),
        );

        await appendChatEntries([
          {
            role: "assistant",
            content: reply.text,
            pose: reply.pose,
          },
          {
            role: "tool",
            name: "set_pose",
            content: reply.pose,
          },
        ]);

        sendResponse({ text: reply.text, pose: reply.pose });
      } catch (error) {
        await appendChatEntries([
          {
            role: "system",
            content: `System malfunction: ${error.message || String(error)}`,
          },
        ]).catch(() => {});
        sendResponse({ text: `*System malfunction:* ${error.message || String(error)}` });
      }
    })();
    return true; // Keep channel open for async response
  }

  if (request.action === "generate_interrupt") {
    (async () => {
      try {
        const prefs = await chrome.storage.local.get(['persona', 'outfit', 'todo']);
        const customPersona = prefs.persona || "An overbearing, possessive shadow daddy who calls me trouble.";
        const outfit = characterSummary(prefs.outfit);
        const todo = prefs.todo || "";
        const interruptRequest = `Site interrupt: The user is on ${request.site || request.url || "a blocked site"}. Tell them to close the tab and return to their task.`;

        await appendChatEntries([
          {
            role: "system",
            content: interruptRequest,
          },
        ]);
        const chatLog = await getChatLog();

        const reply = await generateDomodoroReply(
          buildConversationPrompt(chatLog, interruptRequest, customPersona, outfit, todo),
          90,
        );

        await appendChatEntries([
          {
            role: "assistant",
            content: reply.text,
            pose: reply.pose,
          },
          {
            role: "tool",
            name: "set_pose",
            content: reply.pose,
          },
        ]);

        await speakDomodoro(reply.text).catch(() => {});
        sendResponse({ text: reply.text, pose: reply.pose });
      } catch (error) {
        await speakDomodoro("Forbidden site detected. Close the tab, trouble.").catch(() => {});
        sendResponse({
          text: `Forbidden site detected. Close the tab, trouble.`,
          pose: "stern",
          error: error.message || String(error),
        });
      }
    })();
    return true;
  }

  if (request.action === "speak_text") {
    speakDomodoro(request.text, request.options)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (request.action === "get_model_status") {
    sendOffscreenMessage({ action: "get_model_status" })
      .then(sendResponse)
      .catch((error) => sendResponse({
        status: {
          state: "error",
          detail: error.message || String(error),
          progress: 0,
        },
      }));
    return true;
  }

  if (request.action === "warm_model") {
    sendOffscreenMessage({ action: "warm_model" })
      .then(sendResponse)
      .catch((error) => sendResponse({
        status: {
          state: "error",
          detail: error.message || String(error),
          progress: 0,
        },
        error: error.message || String(error),
      }));
    return true;
  }

  if (request.action === "purge_model_cache") {
    sendOffscreenMessage({ action: "purge_model_cache" })
      .then(sendResponse)
      .catch((error) => sendResponse({
        status: {
          state: "error",
          detail: error.message || String(error),
          progress: 0,
        },
        error: error.message || String(error),
      }));
    return true;
  }

  if (request.action === "get_timer_state") {
    getTimerState().then((state) => sendResponse({ state }));
    return true;
  }

  if (request.action === "start_timer") {
    (async () => {
      const state = await getTimerState();
      const mode = request.mode || state.mode;
      const duration = modeDurationMinutes(state, mode);
      const nextState = await scheduleSession(mode, duration);
      sendResponse({ state: nextState });
    })();
    return true;
  }

  if (request.action === "pause_timer") {
    pauseTimer().then((state) => sendResponse({ state }));
    return true;
  }

  if (request.action === "reset_timer") {
    resetTimer(request.mode || "work").then((state) => sendResponse({ state }));
    return true;
  }

  if (request.action === "update_timer_settings") {
    (async () => {
      const state = await getTimerState();
      await chrome.storage.local.set({
        workMinutes: normalizeMinutes(request.workMinutes, state.workMinutes),
        breakMinutes: normalizeMinutes(request.breakMinutes, state.breakMinutes),
      });
      const updatedState = await getTimerState();
      const nextState = state.running
        ? await scheduleSession(updatedState.mode, modeDurationMinutes(updatedState))
        : await broadcastTimerState();
      sendResponse({ state: nextState });
    })();
    return true;
  }
});
