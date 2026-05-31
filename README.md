[![pages-build-deployment](https://github.com/AmberLee2427/domodoro/actions/workflows/pages/pages-build-deployment/badge.svg?branch=main)](https://github.com/AmberLee2427/domodoro/actions/workflows/pages/pages-build-deployment)

# Domodoro

Domodoro ships in two forms:

- a Chrome/Chromium extension in the repository root
- a standalone PWA in `pwa/`

## Install the Chrome extension

Use this when you want Domodoro to run as a browser extension.

1. Open Chrome, Brave, Edge, or another Chromium-based browser.
2. Go to `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select the `domodoro/` folder in this repository.
6. Pin the extension if you want quick access from the toolbar.

The extension uses the manifest at `domodoro/manifest.json` and the popup at `domodoro/popup.html`.

## Install the PWA

Use this when you want the standalone app experience.

1. Open the Domodoro PWA URL at [https://amberlee2427.github.io/domodoro/pwa/](https://amberlee2427.github.io/domodoro/pwa/) in Chrome on Android or Safari on iPhone.
2. Wait for the app to load.
3. Use the browser’s install prompt or menu item to add it to the home screen.

### iPhone

For iPhone, use Safari instead of Chrome.

1. Open [https://amberlee2427.github.io/domodoro/pwa/](https://amberlee2427.github.io/domodoro/pwa/) in Safari.
2. Tap the Share button.
3. Choose **Add to Home Screen**.
4. Open it from the home screen icon.

### Notes

- The phone install is for the PWA only. The Chrome extension still only installs on desktop browsers.
- The PWA uses `onnx-community/gemma-4-E2B-it-ONNX` locally. The Gemma 4 ONNX bundle is over 3 GB in-browser and can exceed mobile browser storage or memory limits.
- Before summoning Dom, the PWA checks browser storage quota and reports the exact quota/usage/available numbers when a phone browser cannot fit the model.
- Chromium browsers with WebGPU support will run the model faster. Other browsers fall back to WASM when possible.

## What gets installed

- The extension adds Domodoro to the browser toolbar and runs the content/background scripts from this folder.
- The PWA installs as a standalone app window with offline caching from `pwa/service-worker.js`.
