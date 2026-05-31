const DEFAULT_BLACKLIST = [
  "youtube.com",
  "reddit.com",
  "x.com",
  "twitter.com",
  "tiktok.com",
  "instagram.com",
];

const BLACKLIST_LINES = [
  "Forbidden site detected.",
  "Close the tab, trouble. You know why I am here.",
  "This tab is not on your little productivity contract.",
  "Cute detour. Return to the task.",
];
const BLACKLIST_POSES = ["stern", "pointing", "thinking"];
const BLACKLIST_COOLDOWN_MS = 2 * 60 * 1000;

let lastCheckedHref = "";

function normalizeSite(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0];
}

function siteMatches(hostname, entry) {
  const host = normalizeSite(hostname);
  const site = normalizeSite(entry).replace(/^\*\./, "");
  return Boolean(site) && (host === site || host.endsWith(`.${site}`));
}

function blacklistMessage() {
  return BLACKLIST_LINES[Math.floor(Math.random() * BLACKLIST_LINES.length)];
}

function blacklistPose() {
  return BLACKLIST_POSES[Math.floor(Math.random() * BLACKLIST_POSES.length)];
}

function showDomodoroPopup(request) {
    document.querySelectorAll("[data-domodoro-popup='true']").forEach((element) => element.remove());

    const clippy = document.createElement("div");
    clippy.dataset.domodoroPopup = "true";
    clippy.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 340px;
      min-height: 164px;
      background: #fffafc;
      border: 1px solid #bcaacb;
      color: #3f3846;
      padding: 34px 112px 14px 14px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      z-index: 999999;
      box-shadow: 4px 5px 0 rgba(140, 114, 173, 0.18), 0 18px 44px rgba(55, 42, 66, 0.18);
      border-radius: 2px;
      box-sizing: border-box;
    `;

    const titleBar = document.createElement("div");
    titleBar.textContent = "Domodoro";
    titleBar.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 22px;
      padding: 4px 8px;
      border-bottom: 1px solid #bcaacb;
      background: #cdb8df;
      color: #3f3846;
      font-weight: 700;
      box-sizing: border-box;
    `;

    const close = document.createElement("span");
    close.textContent = "×";
    close.style.cssText = `
      position: absolute;
      top: 3px;
      right: 6px;
      width: 14px;
      height: 14px;
      border: 1px solid #8c72ad;
      line-height: 12px;
      text-align: center;
      background: #fffafc;
      color: #3f3846;
    `;
    titleBar.append(close);

    const character = document.createElement("img");
    const pose = request.pose || "default";
    const characterName = request.character || "default";
    character.src = chrome.runtime.getURL(`assets/characters/${characterName}/${pose}.png`);
    character.onerror = () => {
      character.src = chrome.runtime.getURL("assets/characters/default/default.png");
    };
    character.alt = "";
    character.style.cssText = `
      position: absolute;
      right: -10px;
      bottom: -10px;
      width: 132px;
      height: 162px;
      object-fit: contain;
      object-position: bottom right;
      filter: drop-shadow(0 10px 10px rgba(52, 38, 65, 0.2));
      pointer-events: none;
    `;

    const paperclip = document.createElement("span");
    paperclip.style.cssText = `
      display: inline-block;
      position: relative;
      width: 13px;
      height: 28px;
      margin-right: 8px;
      border: 3px solid #8c72ad;
      border-radius: 999px;
      transform: rotate(3deg) translateY(6px);
    `;
    const innerClip = document.createElement("span");
    innerClip.style.cssText = `
      position: absolute;
      left: 3px;
      top: 4px;
      width: 7px;
      height: 19px;
      border: 2px solid #cdb8df;
      border-radius: 999px;
      box-sizing: border-box;
    `;
    paperclip.append(innerClip);

    const title = document.createElement("strong");
    title.textContent = "Domodoro";
    title.style.cssText = "color: #3f3846; font-family: Georgia, 'Times New Roman', serif; font-size: 20px; font-weight: 500;";

    const message = document.createElement("p");
    message.textContent = `"${request.message}"`;
    message.style.cssText = "margin: 10px 0 12px; font-style: italic; line-height: 1.45;";

    const dismiss = document.createElement("button");
    dismiss.textContent = "Yes, sir.";
    dismiss.style.cssText = `
      background: linear-gradient(#fffafd, #e7d8ec);
      color: #3f3846;
      border: 1px solid #bcaacb;
      border-radius: 2px;
      padding: 6px 12px;
      cursor: pointer;
      font: inherit;
      font-weight: 700;
      box-shadow: 1px 1px 0 #fff inset, 1px 1px 0 rgba(83, 62, 103, 0.2);
    `;

    clippy.append(titleBar, character, paperclip, title, message, dismiss);
    document.body.appendChild(clippy);

    const remove = () => {
      clippy.remove();
    };

    close.addEventListener("click", remove);
    dismiss.addEventListener("click", remove);
}

async function maybeInterruptBlacklistedSite(force = false) {
  if (!force && lastCheckedHref === location.href) return;
  lastCheckedHref = location.href;

  const data = await chrome.storage.local.get([
    "isActive",
    "outfit",
    "blacklistEnabled",
    "blacklistedSites",
  ]);

  if (data.isActive === false || data.blacklistEnabled === false) return;

  const entries = Array.isArray(data.blacklistedSites) && data.blacklistedSites.length
    ? data.blacklistedSites
    : DEFAULT_BLACKLIST;

  if (!entries.some((entry) => siteMatches(location.hostname, entry))) return;

  const key = `domodoro-blacklist-${location.hostname}`;
  const lastSeen = Number(sessionStorage.getItem(key) || 0);
  if (lastSeen && Date.now() - lastSeen < BLACKLIST_COOLDOWN_MS) return;
  sessionStorage.setItem(key, String(Date.now()));

  showDomodoroPopup({
    message: blacklistMessage(),
    pose: blacklistPose(),
    character: data.outfit || "default",
  });
}

chrome.runtime.onMessage.addListener((request) => {
  if (request.action === "domodoro_ping") {
    return;
  }

  if (request.action === "display_clippy") {
    showDomodoroPopup(request);
  }
});

maybeInterruptBlacklistedSite();

setInterval(() => {
  maybeInterruptBlacklistedSite().catch(() => {});
}, 2000);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes.blacklistEnabled || changes.blacklistedSites || changes.isActive || changes.outfit) {
    maybeInterruptBlacklistedSite(true).catch(() => {});
  }
});
