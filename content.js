chrome.runtime.onMessage.addListener((request) => {
  if (request.action === "display_clippy") {
    const clippy = document.createElement("div");
    clippy.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 300px;
      background: #111;
      border: 2px solid #500;
      color: #fff;
      padding: 15px;
      font-family: serif;
      z-index: 999999;
      box-shadow: 0 0 15px rgba(255, 0, 0, 0.3);
      border-radius: 8px;
    `;

    const title = document.createElement("strong");
    title.textContent = "Domodoro";
    title.style.cssText = "color: #f55; font-size: 1.2em;";

    const message = document.createElement("p");
    message.textContent = `"${request.message}"`;
    message.style.cssText = "margin-top: 10px; font-style: italic;";

    const dismiss = document.createElement("button");
    dismiss.textContent = "Yes, sir.";
    dismiss.style.cssText = "margin-top: 10px; background: #500; color: white; border: none; padding: 5px 10px; cursor: pointer;";

    clippy.append(title, message, dismiss);
    document.body.appendChild(clippy);

    dismiss.addEventListener("click", () => {
      clippy.remove();
    });
  }
});
