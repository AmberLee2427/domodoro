import { env, pipeline } from "./transformers.js";

const MODEL_ID = "onnx-community/gemma-4-E2B-it-ONNX";
const MODEL_DTYPE = "q4f16";
const MODEL_DEVICE = "webgpu";
const POSES = ["default", "thinking", "stern", "pointing", "approval", "beckon"];

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useWasmCache = false;
env.backends.onnx.wasm.wasmPaths = {
  mjs: chrome.runtime.getURL("vendor/onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs"),
  wasm: chrome.runtime.getURL("vendor/onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm"),
};
env.backends.onnx.wasm.proxy = false;

let domodoroPipeline;
let domodoroPipelinePromise;
let modelStatus = {
  state: "idle",
  detail: `Ready to load ${MODEL_ID}`,
  progress: 0,
};

function setModelStatus(update) {
  modelStatus = { ...modelStatus, ...update };
  chrome.runtime.sendMessage({ action: "model_status", status: modelStatus }).catch(() => {});
}

async function getPipeline() {
  if (domodoroPipeline) return domodoroPipeline;

  if (!("gpu" in navigator)) {
    throw new Error("WebGPU is not available in this Chrome context.");
  }

  if (!domodoroPipelinePromise) {
    setModelStatus({ state: "loading", detail: `Loading ${MODEL_ID}`, progress: 0 });

    domodoroPipelinePromise = pipeline(
      "text-generation",
      MODEL_ID,
      {
        dtype: MODEL_DTYPE,
        device: MODEL_DEVICE,
        progress_callback: (info) => {
          if (info.status === "progress") {
            const percent = info.total ? Math.round((info.loaded / info.total) * 100) : 0;
            setModelStatus({
              state: "loading",
              detail: percent >= 100
                ? "Downloaded; compiling WebGPU session"
                : `Downloading ${info.file || MODEL_ID}`,
              progress: percent,
            });
          } else if (info.status === "ready") {
            setModelStatus({
              state: "loading",
              detail: `Preparing ${info.file || MODEL_ID}`,
              progress: 100,
            });
          }
        },
      },
    )
      .then((generator) => {
        domodoroPipeline = generator;
        setModelStatus({ state: "ready", detail: `${MODEL_ID} is ready`, progress: 100 });
        return generator;
      })
      .catch((error) => {
        domodoroPipelinePromise = undefined;
        setModelStatus({
          state: "error",
          detail: error.message || String(error),
          progress: 0,
        });
        throw error;
      });
  }

  return domodoroPipelinePromise;
}

function buildMessages(userMessage) {
  return [
    {
      role: "system",
      content:
        "You are Domodoro, a dramatic productivity coach for a Pomodoro timer. " +
        "Keep responses short, theatrical, possessive, and commanding, but stay PG-13. " +
        `You must choose one pose from: ${POSES.join(", ")}. ` +
        "Respond with compact JSON only, exactly like {\"pose\":\"stern\",\"text\":\"Back to work, trouble.\"}. " +
        "No markdown and no extra keys.",
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

async function generateDomodoroLine(userMessage, maxNewTokens = 70) {
  const generator = await getPipeline();
  const output = await generator(buildMessages(userMessage), {
    max_new_tokens: maxNewTokens,
    do_sample: true,
    temperature: 0.9,
    top_p: 0.95,
    top_k: 64,
  });

  return cleanGeneratedText(output) || "Break time, trouble. Up.";
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.target !== "offscreen") return false;

  if (request.action === "get_model_status") {
    sendResponse({ status: modelStatus });
    return false;
  }

  if (request.action === "warm_model") {
    getPipeline()
      .then(() => sendResponse({ status: modelStatus }))
      .catch((error) => sendResponse({
        status: modelStatus,
        error: error.message || String(error),
      }));
    return true;
  }

  if (request.action === "generate_text") {
    generateDomodoroLine(request.text, request.maxNewTokens)
      .then((text) => sendResponse({ text }))
      .catch((error) => sendResponse({
        text: `*System malfunction:* ${error.message || String(error)}`,
        status: modelStatus,
      }));
    return true;
  }

  return false;
});
