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

1. Start a local static server from the `domodoro/pwa/` folder. A simple option is:

	```bash
	cd domodoro/pwa
	python3 -m http.server 8000
	```

	Then open `http://localhost:8000/` in a Chromium-based browser. The PWA needs a secure browser context so the service worker can register and the app can use WebGPU-backed model loading. Opening the files directly with `file://` will skip those browser features and the install flow will not work correctly.
2. Wait for the app to load, then use the browser’s install button or menu item.
3. Confirm the install when the browser prompts you.

## What gets installed

- The extension adds Domodoro to the browser toolbar and runs the content/background scripts from this folder.
- The PWA installs as a standalone app window with offline caching from `pwa/service-worker.js`.

## Notes

- The PWA uses local assets from `assets/` and `vendor/`, so keep those folders alongside `pwa/` when serving it.
- The app is designed for Chromium browsers with WebGPU support.