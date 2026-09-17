/**
 * Interactive HTML shell for single-video sites on madethis.website.
 * Darkroom aesthetic, HTML5 video player, live countdown timer,
 * one-click copy embed (Markdown, HTML), download action, and OpenGraph/Twitter card tags.
 */

export interface VideoViewerOptions {
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

export function videoViewerHtml(options: VideoViewerOptions): string {
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

<meta property="og:type" content="video.other"/>
<meta property="og:title" content="${safeFilename} · madethis.website"/>
<meta property="og:description" content="Temporary video hosted on madethis.website · Ephemeral static hosting."/>
<meta property="og:video" content="${safeFullRawUrl}"/>
<meta property="og:video:type" content="${safeContentType}"/>
<meta name="twitter:card" content="player"/>
<meta name="twitter:title" content="${safeFilename} · madethis.website"/>
<meta name="twitter:player" content="${safeFullRawUrl}"/>
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

  .video-stage {
    position: relative;
    max-width: 100%;
    max-height: 100%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .video-wrapper {
    position: relative;
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 20px 60px -15px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(232, 228, 212, 0.12);
    background-color: #000;
    display: flex;
    align-items: center;
    justify-content: center;
    max-width: min(100%, 1280px);
  }

  .main-video {
    display: block;
    max-width: 100%;
    max-height: calc(100dvh - 160px);
    width: auto;
    height: auto;
    background: #000;
    outline: none;
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
    <a class="btn" id="raw-btn" href="${safeRawUrl}" target="_blank" rel="noopener" title="Direct raw video (R)">
      <svg viewBox="0 0 24 24"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
      Raw
    </a>
    <button class="btn btn--primary" id="copy-btn" type="button" title="Copy link (C)">
      <svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
      Copy Link
    </button>
    <a class="btn" id="download-btn" href="${safeRawUrl}" download="${safeFilename}" title="Download video (D)">
      <svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
      Download
    </a>
  </div>
</header>

<main class="viewport" id="viewport">
  <div class="video-stage" id="video-stage">
    <div class="video-wrapper">
      <video class="main-video" id="main-video" controls playsinline preload="metadata" src="${safeRawUrl}">
        <source src="${safeRawUrl}" type="${safeContentType}"/>
        Your browser does not support HTML5 video.
      </video>
    </div>
  </div>
</main>

<footer class="statusbar">
  <div class="statusbar__meta">
    <span class="statusbar__item" id="meta-dims">-- × -- px</span>
    <span class="statusbar__item">•</span>
    <span class="statusbar__item" id="meta-dur">--:--</span>
    <span class="statusbar__item">•</span>
    <span class="statusbar__item">${formattedSize}</span>
    <span class="statusbar__item">•</span>
    <span class="statusbar__item">${safeContentType}</span>
  </div>
  <div class="statusbar__hints">
    <span><kbd>Space</kbd> play/pause</span>
    <span><kbd>←/→</kbd> ±5s</span>
    <span><kbd>M</kbd> mute</span>
    <span><kbd>C</kbd> copy link</span>
    <span><kbd>D</kbd> download</span>
    <span><kbd>R</kbd> raw</span>
  </div>
</footer>

<div class="toast" id="toast">Copied to clipboard</div>

<script>
(function() {
  const expiresAt = ${options.expiresAt};
  const video = document.getElementById("main-video");
  const copyBtn = document.getElementById("copy-btn");
  const toast = document.getElementById("toast");
  const countdownEl = document.getElementById("countdown-timer");
  const metaDims = document.getElementById("meta-dims");
  const metaDur = document.getElementById("meta-dur");

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

  function formatDuration(sec) {
    if (!sec || isNaN(sec)) return "--:--";
    const s = Math.floor(sec);
    const m = Math.floor(s / 60);
    const remSec = s % 60;
    if (m < 60) {
      return m + ":" + String(remSec).padStart(2, "0");
    }
    const h = Math.floor(m / 60);
    const remMin = m % 60;
    return h + ":" + String(remMin).padStart(2, "0") + ":" + String(remSec).padStart(2, "0");
  }

  function updateVideoMeta() {
    if (video.videoWidth && video.videoHeight) {
      metaDims.textContent = video.videoWidth + " × " + video.videoHeight + " px";
    }
    if (video.duration) {
      metaDur.textContent = formatDuration(video.duration);
    }
  }

  if (video) {
    video.addEventListener("loadedmetadata", updateVideoMeta);
    if (video.readyState >= 1) updateVideoMeta();
  }

  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      copyText(window.location.href.split("?")[0], "Page link copied ✓");
    });
  }

  // Countdown timer
  function tickCountdown() {
    const diff = expiresAt - Date.now();
    if (diff <= 0) {
      countdownEl.textContent = "Expired";
      return;
    }
    const totalSec = Math.floor(diff / 1000);
    const d = Math.floor(totalSec / 86400);
    const h = String(Math.floor((totalSec % 86400) / 3600)).padStart(2, "0");
    const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
    const s = String(totalSec % 60).padStart(2, "0");
    countdownEl.textContent = d > 0 ? (d + "d " + h + ":" + m + ":" + s) : (h + ":" + m + ":" + s);
  }
  tickCountdown();
  setInterval(tickCountdown, 1000);

  // Keyboard shortcuts
  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    const k = e.key.toLowerCase();
    if (e.key === " " || k === "k") {
      e.preventDefault();
      if (video.paused) video.play(); else video.pause();
    } else if (k === "m") {
      video.muted = !video.muted;
      showToast(video.muted ? "Muted" : "Unmuted");
    } else if (k === "c") {
      copyBtn?.click();
    } else if (k === "d") {
      document.getElementById("download-btn")?.click();
    } else if (k === "r") {
      window.open(document.getElementById("raw-btn")?.href, "_blank");
    }
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
