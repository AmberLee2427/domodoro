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

1. Start a local static server from the `domodoro/` folder, not just `pwa/`, so the sibling `assets/` and `vendor/` folders resolve correctly. A simple option is:

	```bash
	cd domodoro
	python3 -m http.server 8000
	```

	Then open `http://localhost:8000/pwa/` in a Chromium-based browser. The PWA needs a secure browser context so the service worker can register and the app can use WebGPU-backed model loading. Opening the files directly with `file://` will skip those browser features and the install flow will not work correctly.
2. Wait for the app to load, then use the browser’s install button or menu item.
3. Confirm the install when the browser prompts you.

## Install On Phone

The phone-friendly version is the PWA, not the browser extension.

### Android

Recommended for Android phones.

1. In one terminal, run:

	```bash
	cd domodoro
	python3 -m http.server 8000
	```

2. In a second terminal, run:

	```bash
	ngrok http 8000
	```

3. Open the `https://` forwarding URL that ngrok prints, then add `/pwa/` to the end.
4. Open that URL in Chrome on your Android phone.
5. Wait for the app to finish loading, then use Chrome’s install prompt or the browser menu’s install/add-to-home-screen option.
6. Launch it from the home screen like a normal app.

### iPhone

For iPhone, use Safari instead of Chrome.

1. Open the PWA URL in Safari.
2. Tap the Share button.
3. Choose **Add to Home Screen**.
4. Open it from the home screen icon.

### From Your Computer

To expose the PWA over HTTPS from your computer, use ngrok.

1. In a terminal, run:

	```bash
	cd domodoro
	python3 -m http.server 8000
	```

2. In another terminal, run:

	```bash
	ngrok http 8000
	```

3. Copy the `https://` forwarding URL ngrok gives you.
4. On your phone, open `https://YOUR-NGROK-URL/pwa/` in the browser.
5. Install the app from the browser prompt or menu.

## What gets installed

- The extension adds Domodoro to the browser toolbar and runs the content/background scripts from this folder.
- The PWA installs as a standalone app window with offline caching from `pwa/service-worker.js`.

## Notes

- The PWA uses local assets from `assets/` and `vendor/`, so keep those folders alongside `pwa/` when serving it.
- The app is designed for Chromium browsers with WebGPU support.