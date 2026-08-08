const MIME_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  xml: "application/xml",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  webmanifest: "application/manifest+json",
  wasm: "application/wasm",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  bmp: "image/bmp",
  pdf: "application/pdf",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  webm: "video/webm",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  eot: "application/vnd.ms-fontobject",
  zip: "application/zip",
  map: "application/json",
  yaml: "text/yaml; charset=utf-8",
  yml: "text/yaml; charset=utf-8",
  toml: "application/toml",
  csv: "text/csv; charset=utf-8",
};

const FALLBACK = "application/octet-stream";

export function contentTypeFor(pathname: string): string {
  const dot = pathname.lastIndexOf(".");
  if (dot < 0) return FALLBACK;
  return MIME_TYPES[pathname.slice(dot + 1).toLowerCase()] ?? FALLBACK;
}

/**
 * Resolves a raw request path segment into a safe, zip-relative pathname.
 * Returns null when the path is unsafe (traversal, absolute, null bytes).
 */
export function safeSitePath(raw: string): string | null {
  if (!raw || raw.length > 2048) return null;
  if (raw.includes("\0") || raw.includes("\\")) return null;

  const segments = raw.split("/").filter((s) => s.length > 0);
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === ".") continue;
    if (segment === "..") return null;
    if (!/^[^\u0000-\u001f\u007f]{1,255}$/.test(segment)) return null;
    out.push(segment);
  }
  return out.join("/");
}

export function isTextualContentType(contentType: string): boolean {
  return contentType.startsWith("text/") || contentType.includes("json") || contentType.includes("xml") || contentType.includes("svg") || contentType.includes("javascript");
}