import type { APIRoute } from "astro";
import { readSiteMeta, isExpired, readSiteZip } from "../../../lib/site";
import { validSlug } from "../../../lib/ids";
import { safeSitePath, contentTypeFor } from "../../../lib/mime";
import { readZipEntries } from "../../../lib/zip";
import { MAX_FILES_PER_SITE } from "../../../lib/limits";
import { resolveEntry, maybeMarkdownViewerResponse, maybeImageViewerResponse, maybeTrailingSlashRedirect, injectSiteBaseTag, siteBaseHref, isSiteHtmlPath } from "../../../lib/serve";

export const prerender = false;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function brandedPage(title: string, message: string, status: number, extra?: string): Response {
  const stamp = status === 410 ? "expired" : status === 404 ? "offline" : "broken";
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex,nofollow"/>
<title>${escapeHtml(title)} — madethis.website</title>
<meta name="color-scheme" content="dark"/>
<style>
  body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#0d0e13;color:#e6e3d8;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;padding:24px;box-sizing:border-box}
  .card{max-width:420px;background:#17181f;border:1px solid #2a2b36;border-radius:14px;padding:36px 32px;text-align:center}
  .stamp{display:inline-block;border:2px solid #ffb23e;color:#ffb23e;font-size:11px;letter-spacing:.18em;text-transform:uppercase;padding:6px 10px;border-radius:6px;margin-bottom:18px}
  h1{font-size:20px;margin:0 0 12px}
  p{font-size:14px;line-height:1.6;color:#9d9aa8;margin:0 0 22px}
  a{color:#ffb23e;text-decoration:none;font-size:14px}
  a:hover{text-decoration:underline}
  .ticker{font-size:11px;color:#6f6c78;letter-spacing:.12em;margin-top:24px;text-transform:uppercase}
</style>
</head>
<body>
<div class="card">
  <span class="stamp">${stamp}</span>
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(message)}</p>
  <a href="/">Drop a new site — back to madethis.website</a>
  ${extra ? `<div class="ticker">${escapeHtml(extra)}</div>` : ""}
</div>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const GET: APIRoute = async ({ request, params }) => {
  const slug = params.token ?? "";
  const rawPath = (params.file ?? "").toString();
  const url = new URL(request.url);
  const wantsRaw = url.searchParams.get("raw") === "1";

  const slashRedirect = maybeTrailingSlashRedirect(url, rawPath);
  if (slashRedirect) return slashRedirect;

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  }

  if (!slug || !validSlug(slug)) {
    return brandedPage("Not Found.", "That URL slug doesn't match any site — classic broken link.", 404);
  }

  const meta = await readSiteMeta(slug);
  if (!meta) {
    return brandedPage("Dead link territory.", "A site with this address either never existed or was already scrubbed. No print here.", 404);
  }
  if (isExpired(meta)) {
    return brandedPage(
      "This link expired.",
      "Like a good print, this one had a shelf life. It reached its expiration and was deleted — that's the whole point.",
      410,
      `Expired ${new Date(meta.expiresAt).toISOString()}`,
    );
  }

  const zipBytes = await readSiteZip(slug);
  const entries = zipBytes ? readZipEntries(zipBytes, MAX_FILES_PER_SITE) : null;
  if (!entries) {
    return brandedPage("Site is damaged.", "The archive behind this site can't be read. It was likely corrupted in transit.", 500);
  }
  if (entries.length === 0) {
    return brandedPage("Empty envelope.", "This site has no readable files in its archive.", 500);
  }

  const requestPath = rawPath && rawPath !== "" ? safeSitePath(rawPath) : null;
  if (rawPath && rawPath !== "" && !requestPath) {
    return brandedPage("Safety, first.", "That path contains characters we won't serve (traversal, backslashes, control chars).", 400);
  }

  const target = requestPath ?? meta.homepage ?? "";
  const wantedPath = resolveEntry(entries.map((e) => e.pathname), target);
  const wanted = wantedPath ? entries.find((e) => e.pathname === wantedPath) : null;

  if (!wanted) {
    return brandedPage("Nothing at that path.", "The site exists, but this page doesn't. Custom 404.html pages are on the roadmap.", 404);
  }

  const mdView = maybeMarkdownViewerResponse(slug, wanted.pathname, wantsRaw, request.method);
  if (mdView) return mdView;

  const imgView = maybeImageViewerResponse(slug, wanted.pathname, meta, wanted.data.byteLength, wantsRaw, request);
  if (imgView) return imgView;

  const contentType = contentTypeFor(wanted.pathname);
  const remainingSeconds = Math.max(0, Math.floor((meta.expiresAt - Date.now()) / 1000));
  const cacheSeconds = Math.min(3600, remainingSeconds);

  let body: Uint8Array = wanted.data;
  if (isSiteHtmlPath(wanted.pathname)) {
    body = injectSiteBaseTag(body, siteBaseHref(slug));
  }

  return new Response(body as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(body.length),
      "Cache-Control": `public, max-age=0, s-maxage=${cacheSeconds}`,
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
      "Last-Modified": new Date(meta.createdAt).toUTCString(),
    },
  });
};