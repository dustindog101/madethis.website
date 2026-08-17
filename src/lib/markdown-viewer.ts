/** Self-contained HTML shell that fetches raw markdown and renders it client-side (free-tier friendly). */

export function isMarkdownPath(pathname: string): boolean {
  const lower = pathname.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".markdown");
}

export function markdownViewerHtml(title: string, rawUrl: string): string {
  const safeTitle = escapeHtml(title);
  const safeUrl = escapeHtml(rawUrl);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex,nofollow"/>
<meta name="color-scheme" content="light dark"/>
<title>${safeTitle}</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #fbf8ee;
    --ink: #191a21;
    --muted: #5c5966;
    --line: rgba(25, 26, 33, 0.12);
    --code-bg: rgba(25, 26, 33, 0.06);
    --link: #9a5b00;
    --max: 720px;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #12131a;
      --ink: #ece8da;
      --muted: #a8a4b0;
      --line: rgba(236, 232, 218, 0.12);
      --code-bg: rgba(236, 232, 218, 0.08);
      --link: #ffb23e;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font: 1.05rem/1.7 "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
    padding: 48px 20px 80px;
  }
  main {
    max-width: var(--max);
    margin: 0 auto;
  }
  .badge {
    display: inline-block;
    font: 600 0.68rem/1 ui-sans-serif, system-ui, sans-serif;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 18px;
  }
  article :is(h1, h2, h3, h4) {
    font-family: ui-sans-serif, system-ui, sans-serif;
    line-height: 1.25;
    margin: 1.6em 0 0.6em;
    font-weight: 700;
  }
  article h1 { font-size: clamp(1.8rem, 4vw, 2.4rem); margin-top: 0; }
  article h2 { font-size: 1.45rem; border-bottom: 1px solid var(--line); padding-bottom: 0.35em; }
  article h3 { font-size: 1.15rem; }
  article p, article ul, article ol, article pre, article blockquote { margin: 0 0 1em; }
  article a { color: var(--link); }
  article code {
    font: 0.92em ui-monospace, SFMono-Regular, Menlo, monospace;
    background: var(--code-bg);
    padding: 0.15em 0.35em;
    border-radius: 4px;
  }
  article pre {
    overflow-x: auto;
    background: var(--code-bg);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 14px 16px;
  }
  article pre code { background: none; padding: 0; }
  article blockquote {
    border-left: 3px solid var(--link);
    margin-left: 0;
    padding: 0.2em 0 0.2em 1em;
    color: var(--muted);
  }
  article ul, article ol { padding-left: 1.35em; }
  article img { max-width: 100%; height: auto; border-radius: 8px; }
  article hr { border: none; border-top: 1px solid var(--line); margin: 2em 0; }
  .error { color: #c0392b; font-family: ui-sans-serif, system-ui, sans-serif; }
</style>
</head>
<body>
<main>
  <div class="badge">Rendered markdown</div>
  <article id="content" aria-busy="true">Loading…</article>
</main>
<script>
(function () {
  const rawUrl = ${JSON.stringify(rawUrl)};
  const el = document.getElementById("content");

  function esc(s) {
    return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  function inline(s) {
    return esc(s)
      .replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" rel="noopener">$1</a>')
      .replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>")
      .replace(/\\*([^*]+)\\*/g, "<em>$1</em>")
      .replace(/\`([^\`]+)\`/g, "<code>$1</code>");
  }

  function render(md) {
    const lines = md.replace(/\\r\\n/g, "\\n").split("\\n");
    let html = "";
    let inCode = false;
    let code = "";
    let listType = "";

    const closeList = () => {
      if (listType) { html += listType === "ol" ? "</ol>" : "</ul>"; listType = ""; }
    };

    for (const line of lines) {
      if (line.startsWith("\`\`\`")) {
        closeList();
        if (!inCode) { inCode = true; code = ""; }
        else { html += "<pre><code>" + esc(code) + "</code></pre>"; inCode = false; }
        continue;
      }
      if (inCode) { code += (code ? "\\n" : "") + line; continue; }

      if (/^#{1,6}\\s/.test(line)) {
        closeList();
        const level = line.match(/^#+/)[0].length;
        html += "<h" + level + ">" + inline(line.replace(/^#+\\s+/, "")) + "</h" + level + ">";
        continue;
      }
      if (/^>\\s?/.test(line)) {
        closeList();
        html += "<blockquote><p>" + inline(line.replace(/^>\\s?/, "")) + "</p></blockquote>";
        continue;
      }
      if (/^[-*]\\s+/.test(line)) {
        if (listType !== "ul") { closeList(); html += "<ul>"; listType = "ul"; }
        html += "<li>" + inline(line.replace(/^[-*]\\s+/, "")) + "</li>";
        continue;
      }
      if (/^\\d+\\.\\s+/.test(line)) {
        if (listType !== "ol") { closeList(); html += "<ol>"; listType = "ol"; }
        html += "<li>" + inline(line.replace(/^\\d+\\.\\s+/, "")) + "</li>";
        continue;
      }
      if (/^---+$/.test(line.trim()) || /^\\*\\*\\*+$/.test(line.trim())) {
        closeList();
        html += "<hr>";
        continue;
      }
      if (!line.trim()) { closeList(); continue; }
      closeList();
      html += "<p>" + inline(line) + "</p>";
    }
    closeList();
    return html;
  }

  fetch(rawUrl, { credentials: "same-origin" })
    .then((r) => { if (!r.ok) throw new Error("Could not load markdown"); return r.text(); })
    .then((md) => {
      el.innerHTML = render(md);
      el.removeAttribute("aria-busy");
      const h1 = el.querySelector("h1");
      if (h1) document.title = h1.textContent + " · madethis.website";
    })
    .catch(() => {
      el.innerHTML = '<p class="error">Could not render this markdown file.</p>';
      el.removeAttribute("aria-busy");
    });
})();
</script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
