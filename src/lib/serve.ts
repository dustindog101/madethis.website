import { isMarkdownPath, markdownViewerHtml } from "./markdown-viewer.js";

export function resolveEntry(pathnames: string[], urlPath: string): string | null {
  if (pathnames.includes(urlPath)) return urlPath;
  const indexChild = urlPath ? `${urlPath}/index.html` : "index.html";
  if (pathnames.includes(indexChild)) return indexChild;
  const indexHtm = urlPath ? `${urlPath}/index.htm` : "index.htm";
  if (pathnames.includes(indexHtm)) return indexHtm;
  const indexMd = urlPath ? `${urlPath}/index.md` : "index.md";
  if (pathnames.includes(indexMd)) return indexMd;
  const html = `${urlPath}.html`;
  if (pathnames.includes(html)) return html;
  const htm = `${urlPath}.htm`;
  if (pathnames.includes(htm)) return htm;
  const md = `${urlPath}.md`;
  if (pathnames.includes(md)) return md;
  return null;
}

export function buildRawMarkdownUrl(slug: string, pathname: string): string {
  return `/s/${slug}/${pathname}?raw=1`;
}

export function maybeMarkdownViewerResponse(
  slug: string,
  pathname: string,
  wantsRaw: boolean,
  method: string,
): Response | null {
  if (!isMarkdownPath(pathname) || wantsRaw) return null;
  const rawUrl = buildRawMarkdownUrl(slug, pathname);
  const title = pathname.split("/").pop() ?? "Document";
  const html = markdownViewerHtml(title, rawUrl);
  if (method === "HEAD") {
    return new Response(null, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex, nofollow" },
    });
  }
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=300",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
    },
  });
}
