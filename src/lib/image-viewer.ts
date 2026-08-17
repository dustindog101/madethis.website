/**
 * Interactive HTML shell for single-image sites on madethis.website.
 * Darkroom aesthetic, instant zoom/fit toggles, live countdown timer,
 * one-click copy embed (Markdown, HTML), download action, and OpenGraph/Twitter card tags.
 */

export interface ImageViewerOptions {
  slug: string;
  pathname: string;
  rawUrl: string;
  fullRawUrl?: string;
  filename: string;
  expiresAt: number;
  createdAt: number;
  bytes: number;
  contentType: string;
}

export function imageViewerHtml(options: ImageViewerOptions): string {
  const safeFilename = escapeHtml(options.filename);
  const safeRawUrl = escapeHtml(options.rawUrl);
  const safeFullRawUrl = escapeHtml(options.fullRawUrl ?? options.rawUrl);
  const safeContentType = escapeHtml(options.contentType);
  const formattedSize = formatBytes(options.bytes);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<meta name="robots" content="noindex,nofollow"/>
<meta name="color-scheme" content="dark"/>
<title>${safeFilename} · madethis.website</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg"/>

<meta property="og:type" content="article"/>
<meta property="og:title" content="${safeFilename} · madethis.website"/>
<meta property="og:description" content="Temporary image hosted on madethis.website · Ephemeral static hosting."/>
<meta property="og:image" content="${safeFullRawUrl}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${safeFilename} · madethis.website"/>
<meta name="twitter:image" content="${safeFullRawUrl}"/>
<meta name="theme-color" content="#0d0e13"/>

<style>
  :root {
    --ink: #0d0e13;
    --ink-2: #14151c;
    --panel: #1b1c25;
    --panel-2: #22232e;
    --hair: rgba(232, 228, 212, 0.12);
    --hair-strong: rgba(232, 228, 212, 0.22);
    --paper: #f3efe2;
    --amber: #ffb23e;
    --amber-2: #ffd08a;
    --text: #e8e4d6;
    --muted: #9b98a4;
    --faint: #6e6b7a;
    --radius: 10px;
    --font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    --ease: cubic-bezier(0.22, 1, 0.36, 1);
  }

  *, *::before, *::after { box-sizing: border-box; }

  body {
    margin: 0;
    min-height: 100dvh;
    background: var(--ink);
    color: var(--text);
    font-family: var(--font-sans);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    -webkit-font-smoothing: antialiased;
  }

  /* film grain */
  body::before {
    content: "";
    position: fixed;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    opacity: 0.04;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='0.6'/%3E%3C/svg%3E");
  }

  /* top toolbar */
  .toolbar {
    position: relative;
    z-index: 10;
    height: 56px;
    background: rgba(20, 21, 28, 0.88);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--hair);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    gap: 12px;
  }

  .toolbar__left {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    text-decoration: none;
    color: var(--text);
    font-weight: 700;
    font-size: 0.95rem;
    letter-spacing: -0.02em;
    flex-shrink: 0;
  }

  .brand__mark {
    width: 26px;
    height: 26px;
    background: var(--amber);
    color: var(--ink);
    border-radius: 6px;
    display: grid;
    place-items: center;
    font-size: 0.85rem;
    font-weight: 800;
  }

  .brand__accent { color: var(--amber); }

  .sep {
    width: 1px;
    height: 18px;
    background: var(--hair);
    flex-shrink: 0;
  }

  .file-badge {
    font-family: var(--font-mono);
    font-size: 0.82rem;
    color: var(--text);
    background: rgba(232, 228, 212, 0.07);
    border: 1px solid var(--hair);
    padding: 4px 10px;
    border-radius: 6px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: min(280px, 35vw);
  }

  .countdown-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: 0.76rem;
    color: var(--amber);
    background: rgba(255, 178, 62, 0.1);
    border: 1px solid rgba(255, 178, 62, 0.25);
    padding: 4px 10px;
    border-radius: 6px;
    letter-spacing: 0.04em;
    flex-shrink: 0;
  }

  .countdown-badge .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--amber);
    box-shadow: 0 0 8px var(--amber);
    animation: pulse 2s infinite ease-in-out;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }

  .toolbar__right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 32px;
    padding: 0 12px;
    border-radius: 6px;
    font-size: 0.82rem;
    font-weight: 500;
    cursor: pointer;
    text-decoration: none;
    transition: all 0.15s ease;
    border: 1px solid var(--hair);
    background: var(--panel);
    color: var(--text);
    white-space: nowrap;
  }

  .btn:hover {
    border-color: var(--hair-strong);
    background: var(--panel-2);
    color: #fff;
  }

  .btn--primary {
    background: var(--amber);
    color: var(--ink);
    border-color: var(--amber);
    font-weight: 600;
  }

  .btn--primary:hover {
    background: var(--amber-2);
    border-color: var(--amber-2);
    color: var(--ink);
  }

  .btn svg {
    width: 14px;
    height: 14px;
    fill: currentColor;
  }

  /* main viewer viewport */
  .viewport {
    position: relative;
    z-index: 1;
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: auto;
    padding: 24px;
    background:
      radial-gradient(ellipse at center, rgba(34, 35, 46, 0.6) 0%, rgba(13, 14, 19, 0.95) 100%);
  }

  .image-stage {
    position: relative;
    max-width: 100%;
    max-height: 100%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.2s var(--ease);
  }

  /* transparency checkerboard canvas pattern */
  .image-wrapper {
    position: relative;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 16px 48px -12px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(232, 228, 212, 0.1);
    background-image:
      linear-gradient(45deg, #181922 25%, transparent 25%),
      linear-gradient(-45deg, #181922 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #181922 75%),
      linear-gradient(-45deg, transparent 75%, #181922 75%);
    background-size: 16px 16px;
    background-position: 0 0, 0 8px, 8px -8px, -8px 0px;
    background-color: #101117;
  }

  .main-image {
    display: block;
    max-width: 100%;
    max-height: calc(100dvh - 150px);
    width: auto;
    height: auto;
    object-fit: contain;
    cursor: zoom-in;
    transition: opacity 0.2s ease;
    user-select: none;
    -webkit-user-drag: none;
  }

  .main-image.is-zoomed {
    max-width: none;
    max-height: none;
    cursor: zoom-out;
  }

  /* bottom statusbar */
  .statusbar {
    position: relative;
    z-index: 10;
    height: 38px;
    background: rgba(20, 21, 28, 0.88);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-top: 1px solid var(--hair);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    font-family: var(--font-mono);
    font-size: 0.74rem;
    color: var(--muted);
  }

  .statusbar__meta {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .statusbar__item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  .statusbar__hints {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  kbd {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    background: rgba(232, 228, 212, 0.1);
    border: 1px solid var(--hair);
    border-radius: 4px;
    padding: 1px 5px;
    color: var(--text);
  }

  /* embed modal / popover */
  .embed-popover {
    position: fixed;
    top: 64px;
    right: 16px;
    z-index: 100;
    width: 340px;
    background: var(--panel-2);
    border: 1px solid var(--hair-strong);
    border-radius: var(--radius);
    padding: 14px;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
    display: none;
  }

  .embed-popover.is-open {
    display: block;
    animation: fadeIn 0.15s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-6px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .embed-popover__title {
    font-size: 0.82rem;
    font-weight: 600;
    margin: 0 0 10px;
    color: var(--text);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .embed-popover__close {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 2px 6px;
    font-size: 1rem;
  }

  .embed-group {
    margin-bottom: 10px;
  }

  .embed-group:last-child { margin-bottom: 0; }

  .embed-label {
    font-size: 0.72rem;
    color: var(--muted);
    margin-bottom: 4px;
    display: block;
    font-family: var(--font-mono);
  }

  .embed-row {
    display: flex;
    gap: 6px;
  }

  .embed-input {
    flex: 1;
    background: var(--ink);
    border: 1px solid var(--hair);
    border-radius: 5px;
    padding: 5px 8px;
    font-family: var(--font-mono);
    font-size: 0.74rem;
    color: var(--text);
    outline: none;
  }

  .embed-input:focus { border-color: var(--amber); }

  .embed-copy {
    height: 28px;
    padding: 0 8px;
    font-size: 0.72rem;
  }

  /* toast */
  .toast {
    position: fixed;
    bottom: 50px;
    left: 50%;
    transform: translateX(-50%) translateY(20px);
    background: var(--paper);
    color: var(--ink);
    font-family: var(--font-mono);
    font-size: 0.78rem;
    font-weight: 600;
    padding: 8px 16px;
    border-radius: 20px;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
    opacity: 0;
    pointer-events: none;
    transition: all 0.25s var(--ease);
    z-index: 1000;
  }

  .toast.is-shown {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }

  @media (max-width: 768px) {
    .toolbar { height: auto; padding: 10px 12px; flex-wrap: wrap; }
    .toolbar__left { width: 100%; justify-content: space-between; }
    .toolbar__right { width: 100%; justify-content: flex-end; }
    .statusbar__hints { display: none; }
    .file-badge { max-width: 160px; }
  }
</style>
</head>
<body>

<header class="toolbar">
  <div class="toolbar__left">
    <a class="brand" href="/" title="Back to madethis.website">
      <span class="brand__mark" aria-hidden="true">M</span>
      <span>made<span class="brand__accent">this</span></span>
    </a>
    <span class="sep"></span>
    <span class="file-badge" title="${safeFilename}">${safeFilename}</span>
    <span class="countdown-badge" id="countdown-badge" title="Remaining shelf life">
      <span class="dot"></span>
      <span id="countdown-timer">--:--:--</span>
    </span>
  </div>

  <div class="toolbar__right">
    <button class="btn" id="zoom-btn" type="button" title="Toggle zoom (F)">
      <svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
      <span id="zoom-label">Fit</span>
    </button>
    <button class="btn" id="embed-btn" type="button" title="Copy embed code">
      <svg viewBox="0 0 24 24"><path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/></svg>
      Embed
    </button>
    <a class="btn" id="raw-btn" href="${safeRawUrl}" target="_blank" rel="noopener" title="Direct raw image (R)">
      <svg viewBox="0 0 24 24"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
      Raw
    </a>
    <button class="btn btn--primary" id="copy-btn" type="button" title="Copy link (C)">
      <svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
      Copy Link
    </button>
    <a class="btn" id="download-btn" href="${safeRawUrl}" download="${safeFilename}" title="Download image (D)">
      <svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
      Download
    </a>
  </div>
</header>

<main class="viewport" id="viewport">
  <div class="image-stage" id="image-stage">
    <div class="image-wrapper">
      <img class="main-image" id="main-image" src="${safeRawUrl}" alt="${safeFilename}" loading="eager" />
    </div>
  </div>
</main>

<footer class="statusbar">
  <div class="statusbar__meta">
    <span class="statusbar__item" id="meta-dims">-- × -- px</span>
    <span class="statusbar__item">•</span>
    <span class="statusbar__item">${formattedSize}</span>
    <span class="statusbar__item">•</span>
    <span class="statusbar__item">${safeContentType}</span>
  </div>
  <div class="statusbar__hints">
    <span><kbd>F</kbd> zoom/fit</span>
    <span><kbd>C</kbd> copy link</span>
    <span><kbd>D</kbd> download</span>
    <span><kbd>R</kbd> raw</span>
  </div>
</footer>

<div class="embed-popover" id="embed-popover">
  <div class="embed-popover__title">
    <span>Copy Embed Code</span>
    <button class="embed-popover__close" id="embed-close" type="button">&times;</button>
  </div>
  <div class="embed-group">
    <label class="embed-label">Markdown</label>
    <div class="embed-row">
      <input class="embed-input" id="embed-md" readonly value="![${safeFilename}](${safeFullRawUrl})" />
      <button class="btn embed-copy" data-target="embed-md" type="button">Copy</button>
    </div>
  </div>
  <div class="embed-group">
    <label class="embed-label">HTML</label>
    <div class="embed-row">
      <input class="embed-input" id="embed-html" readonly value='&lt;img src="${safeFullRawUrl}" alt="${safeFilename}" /&gt;' />
      <button class="btn embed-copy" data-target="embed-html" type="button">Copy</button>
    </div>
  </div>
  <div class="embed-group">
    <label class="embed-label">Direct URL</label>
    <div class="embed-row">
      <input class="embed-input" id="embed-url" readonly value="${safeFullRawUrl}" />
      <button class="btn embed-copy" data-target="embed-url" type="button">Copy</button>
    </div>
  </div>
</div>

<div class="toast" id="toast">Copied to clipboard</div>

<script>
(function() {
  const expiresAt = ${options.expiresAt};
  const img = document.getElementById("main-image");
  const zoomBtn = document.getElementById("zoom-btn");
  const zoomLabel = document.getElementById("zoom-label");
  const copyBtn = document.getElementById("copy-btn");
  const embedBtn = document.getElementById("embed-btn");
  const embedPopover = document.getElementById("embed-popover");
  const embedClose = document.getElementById("embed-close");
  const toast = document.getElementById("toast");
  const countdownEl = document.getElementById("countdown-timer");
  const metaDims = document.getElementById("meta-dims");

  let isZoomed = false;

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add("is-shown");
    setTimeout(() => toast.classList.remove("is-shown"), 2000);
  }

  async function copyText(str, successMsg) {
    try {
      await navigator.clipboard.writeText(str);
      showToast(successMsg || "Copied to clipboard ✓");
    } catch {
      showToast("Could not copy to clipboard");
    }
  }

  function toggleZoom() {
    isZoomed = !isZoomed;
    img.classList.toggle("is-zoomed", isZoomed);
    zoomLabel.textContent = isZoomed ? "100%" : "Fit";
  }

  if (img) {
    img.addEventListener("click", toggleZoom);
    if (img.complete) {
      metaDims.textContent = img.naturalWidth + " × " + img.naturalHeight + " px";
    } else {
      img.addEventListener("load", () => {
        metaDims.textContent = img.naturalWidth + " × " + img.naturalHeight + " px";
      });
    }
  }

  if (zoomBtn) zoomBtn.addEventListener("click", toggleZoom);

  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      copyText(window.location.href.split("?")[0], "Page link copied ✓");
    });
  }

  if (embedBtn && embedPopover) {
    embedBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      embedPopover.classList.toggle("is-open");
    });
    embedClose?.addEventListener("click", () => embedPopover.classList.remove("is-open"));
    document.addEventListener("click", (e) => {
      if (!embedPopover.contains(e.target) && e.target !== embedBtn) {
        embedPopover.classList.remove("is-open");
      }
    });
  }

  document.querySelectorAll(".embed-copy").forEach(btn => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-target");
      const input = document.getElementById(targetId);
      if (input) copyText(input.value, "Copied snippet ✓");
    });
  });

  // Countdown timer
  function tickCountdown() {
    const diff = expiresAt - Date.now();
    if (diff <= 0) {
      countdownEl.textContent = "Expired";
      return;
    }
    const h = String(Math.floor(diff / 3600000)).padStart(2, "0");
    const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, "0");
    const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, "0");
    countdownEl.textContent = h + ":" + m + ":" + s;
  }
  tickCountdown();
  setInterval(tickCountdown, 1000);

  // Keyboard shortcuts
  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    const k = e.key.toLowerCase();
    if (k === "f") { toggleZoom(); }
    else if (k === "c") { copyBtn?.click(); }
    else if (k === "d") { document.getElementById("download-btn")?.click(); }
    else if (k === "r") { window.open(document.getElementById("raw-btn")?.href, "_blank"); }
    else if (e.key === "Escape") { embedPopover?.classList.remove("is-open"); }
  });
})();
</script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
