import { zipSync, type Zippable } from "fflate";
import {
  MAX_FILES_PER_SITE,
  MAX_SITE_ZIP_BYTES,
  OWNER_MAX_SINGLE_FILE_BYTES,
  OWNER_MAX_SITE_ZIP_BYTES,
  PUBLIC_MAX_SINGLE_FILE_BYTES,
  PUBLIC_MAX_SITE_ZIP_BYTES,
  PUBLIC_MAX_TEXT_BYTES,
} from "./limits.js";
import { readZipEntries } from "./zip.js";
import { fflateEntryLevel } from "./zip-compression.js";

const HTML_MARKERS = [/<!doctype\s+html/i, /<html[\s>]/i];
const ZIP_MAGIC = [0x50, 0x4b];
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF

export const MAX_CLI_TEXT_BYTES = 2 * 1024 * 1024;

export interface CliUploadOptions {
  /** Owner (API key / admin session) gets higher caps + pdf/mp4. Defaults true for backward compat. */
  isOwner?: boolean;
}

const ALLOWED_SINGLE_EXT = new Set([
  "html",
  "htm",
  "md",
  "markdown",
  "js",
  "mjs",
  "css",
  "svg",
  "json",
  "txt",
  "webmanifest",
]);

export interface CliUploadReady {
  ok: true;
  zipBytes: Uint8Array;
}

export interface CliUploadError {
  ok: false;
  code: string;
  message: string;
}

export function parseTtlSeconds(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (n === 3600 || n === 86400 || n === 604800) return n;
  if (raw === "1h" || raw === "1hour") return 3600;
  if (raw === "24h" || raw === "24hours" || raw === "1d") return 86400;
  if (raw === "7d" || raw === "7days" || raw === "7day" || raw === "1w" || raw === "1week") return 604800;
  return null;
}

export function sanitizeCliFilename(raw: string | null, fallback = "index.html"): string {
  if (!raw) return fallback;
  const trimmed = raw.trim().slice(0, 120);
  if (!trimmed || trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("\0")) {
    return fallback;
  }
  if (!/^[\w.\-]+$/.test(trimmed)) return fallback;
  return trimmed;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function isZip(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4 && bytes[0] === ZIP_MAGIC[0] && bytes[1] === ZIP_MAGIC[1];
}

function isPdf(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 5 &&
    bytes[0] === PDF_MAGIC[0] &&
    bytes[1] === PDF_MAGIC[1] &&
    bytes[2] === PDF_MAGIC[2] &&
    bytes[3] === PDF_MAGIC[3]
  );
}

function validateText(bytes: Uint8Array, maxBytes: number): CliUploadError | null {
  if (bytes.byteLength === 0) {
    return { ok: false, code: "empty_body", message: "Upload body is empty." };
  }
  if (bytes.byteLength > maxBytes) {
    return {
      ok: false,
      code: "file_too_large",
      message: `Single-file CLI uploads must be at most ${maxBytes} bytes.`,
    };
  }
  if (bytes.includes(0)) {
    return { ok: false, code: "invalid_content", message: "Text uploads cannot contain null bytes." };
  }
  return null;
}

function validateHtml(bytes: Uint8Array, maxBytes: number = MAX_CLI_TEXT_BYTES): CliUploadError | null {
  const base = validateText(bytes, maxBytes);
  if (base) return base;
  let text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (!HTML_MARKERS.some((re) => re.test(text.slice(0, 8192)))) {
    return {
      ok: false,
      code: "not_html",
      message: "HTML must include <!DOCTYPE html> or <html>.",
    };
  }
  return null;
}

function validateMarkdown(bytes: Uint8Array, maxBytes: number = MAX_CLI_TEXT_BYTES): CliUploadError | null {
  const base = validateText(bytes, maxBytes);
  if (base) return base;
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).trim();
  if (text.length < 3) {
    return { ok: false, code: "not_markdown", message: "Markdown file is too short." };
  }
  return null;
}

function validateZip(bytes: Uint8Array, maxBytes: number = MAX_SITE_ZIP_BYTES): CliUploadError | null {
  if (bytes.byteLength === 0) {
    return { ok: false, code: "empty_body", message: "ZIP is empty." };
  }
  if (bytes.byteLength > maxBytes) {
    return {
      ok: false,
      code: "site_too_large",
      message: `ZIP must be at most ${maxBytes} bytes.`,
    };
  }
  const entries = readZipEntries(bytes, MAX_FILES_PER_SITE);
  if (!entries || entries.length === 0) {
    return { ok: false, code: "not_a_zip", message: "Not a readable ZIP archive." };
  }
  return null;
}

function shellHtmlForAsset(filename: string): string {
  const ext = extensionOf(filename);
  if (ext === "js" || ext === "mjs") {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>madethis</title><script src="${filename}" defer></script></head><body></body></html>`;
  }
  if (ext === "css") {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>madethis</title><link rel="stylesheet" href="${filename}"></head><body><main></main></body></html>`;
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>madethis</title></head><body></body></html>`;
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "ico", "bmp"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "m4v", "ogg", "ogv"]);
const CLI_DEFLATE_LEVEL = 9 as const;

function zipFiles(files: Record<string, Uint8Array>): Uint8Array {
  const packed: Zippable = {};
  for (const [name, data] of Object.entries(files)) {
    packed[name] = [data, { level: fflateEntryLevel(name, CLI_DEFLATE_LEVEL) }];
  }
  return zipSync(packed, { mem: 12 });
}

function validateBinaryFile(bytes: Uint8Array, maxBytes: number): CliUploadError | null {
  if (bytes.byteLength === 0) {
    return { ok: false, code: "empty_body", message: "Upload body is empty." };
  }
  if (bytes.byteLength > maxBytes) {
    return {
      ok: false,
      code: "file_too_large",
      message: `Single-file uploads must be at most ${maxBytes} bytes.`,
    };
  }
  return null;
}

export function prepareCliUpload(
  bytes: Uint8Array,
  filenameHint: string | null,
  contentType: string,
  opts?: CliUploadOptions,
): CliUploadReady | CliUploadError {
  const isOwner = opts?.isOwner ?? true;
  const maxZipBytes = isOwner ? OWNER_MAX_SITE_ZIP_BYTES : PUBLIC_MAX_SITE_ZIP_BYTES;
  const maxSingleBytes = isOwner ? OWNER_MAX_SINGLE_FILE_BYTES : PUBLIC_MAX_SINGLE_FILE_BYTES;
  const maxTextBytes = isOwner ? MAX_CLI_TEXT_BYTES : PUBLIC_MAX_TEXT_BYTES;
  const hinted = sanitizeCliFilename(filenameHint, "");
  const ext = extensionOf(hinted);
  const ct = contentType.toLowerCase();

  if (
    isZip(bytes) ||
    ct.includes("zip") ||
    ext === "zip"
  ) {
    const zipError = validateZip(bytes, maxZipBytes);
    if (zipError) return zipError;
    return { ok: true, zipBytes: bytes };
  }

  // Owner-only: raw PDF documents (served inline as application/pdf).
  if (ext === "pdf" || ct.includes("application/pdf") || isPdf(bytes)) {
    if (!isOwner) {
      return {
        ok: false,
        code: "unsupported_type",
        message: "PDF uploads require the owner API key.",
      };
    }
    const pdfError = validateBinaryFile(bytes, maxSingleBytes);
    if (pdfError) return pdfError;
    const filename = sanitizeCliFilename(filenameHint, ext === "pdf" ? hinted : "document.pdf");
    const safeName = extensionOf(filename) === "pdf" ? filename : "document.pdf";
    return { ok: true, zipBytes: zipFiles({ [safeName]: bytes }) };
  }

  const filename = sanitizeCliFilename(
    filenameHint,
    ct.includes("markdown") || ext === "md" || ext === "markdown"
      ? "index.md"
      : ct.startsWith("image/") || IMAGE_EXTENSIONS.has(ext)
        ? (ext ? `image.${ext}` : "image.png")
        : ct.startsWith("video/") || VIDEO_EXTENSIONS.has(ext)
          ? (ext ? `video.${ext}` : "video.mp4")
          : "index.html",
  );
  const fileExt = extensionOf(filename);

  if (IMAGE_EXTENSIONS.has(fileExt) || ct.startsWith("image/")) {
    const imgError = validateBinaryFile(bytes, maxSingleBytes);
    if (imgError) return imgError;
    return { ok: true, zipBytes: zipFiles({ [filename]: bytes }) };
  }

  if (VIDEO_EXTENSIONS.has(fileExt) || ct.startsWith("video/")) {
    const vidError = validateBinaryFile(bytes, maxSingleBytes);
    if (vidError) return vidError;
    return { ok: true, zipBytes: zipFiles({ [filename]: bytes }) };
  }

  if (fileExt === "html" || fileExt === "htm" || ct.includes("text/html")) {
    const htmlError = validateHtml(bytes, maxTextBytes);
    if (htmlError) return htmlError;
    return { ok: true, zipBytes: zipFiles({ [filename]: bytes }) };
  }

  if (fileExt === "md" || fileExt === "markdown" || ct.includes("markdown")) {
    const mdError = validateMarkdown(bytes, maxTextBytes);
    if (mdError) return mdError;
    return { ok: true, zipBytes: zipFiles({ [filename]: bytes }) };
  }

  if (ALLOWED_SINGLE_EXT.has(fileExt) || ct.includes("javascript") || ct.includes("css")) {
    const textError = validateText(bytes, maxTextBytes);
    if (textError) return textError;
    if (!ALLOWED_SINGLE_EXT.has(fileExt) && !ct.includes("javascript") && !ct.includes("css")) {
      return {
        ok: false,
        code: "unsupported_type",
        message: "Unsupported file type. Use .html, .md, .js, .css, images, videos, PDFs (owner), or .zip.",
      };
    }
    const needsShell = fileExt === "js" || fileExt === "mjs" || fileExt === "css";
    const files: Record<string, Uint8Array> = { [filename]: bytes };
    if (needsShell) {
      files["index.html"] = new TextEncoder().encode(shellHtmlForAsset(filename));
    }
    return { ok: true, zipBytes: zipFiles(files) };
  }

  return {
    ok: false,
    code: "unsupported_type",
    message: "Unsupported upload. Send .html, .md, .js, .css, images, videos, PDFs (owner), static assets, or a .zip site.",
  };
}
