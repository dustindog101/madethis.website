import { zipSync } from "fflate";

const HTML_MARKERS = [/<!doctype\s+html/i, /<html[\s>]/i];

export const MAX_CLI_HTML_BYTES = 512 * 1024;

export interface HtmlValidation {
  ok: true;
  bytes: Uint8Array;
  filename: string;
}

export interface HtmlValidationError {
  ok: false;
  code: string;
  message: string;
}

export function sanitizeHtmlFilename(raw: string | null): string {
  const fallback = "index.html";
  if (!raw) return fallback;
  const trimmed = raw.trim().slice(0, 120);
  if (!trimmed || trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("\0")) {
    return fallback;
  }
  const lower = trimmed.toLowerCase();
  if (!lower.endsWith(".html") && !lower.endsWith(".htm")) return fallback;
  if (!/^[\w.\-]+$/.test(trimmed)) return fallback;
  return trimmed;
}

export function validateHtmlBody(bytes: Uint8Array): HtmlValidation | HtmlValidationError {
  if (bytes.byteLength === 0) {
    return { ok: false, code: "empty_body", message: "HTML body is empty." };
  }
  if (bytes.byteLength > MAX_CLI_HTML_BYTES) {
    return {
      ok: false,
      code: "html_too_large",
      message: `HTML must be at most ${MAX_CLI_HTML_BYTES} bytes for CLI uploads.`,
    };
  }
  if (bytes.includes(0)) {
    return { ok: false, code: "invalid_html", message: "HTML contains null bytes." };
  }

  let text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const sample = text.slice(0, 8192);
  if (!HTML_MARKERS.some((re) => re.test(sample))) {
    return {
      ok: false,
      code: "not_html",
      message: "Body must look like HTML (<!DOCTYPE html> or <html>).",
    };
  }

  return { ok: true, bytes, filename: "index.html" };
}

export function htmlToZip(bytes: Uint8Array, filename: string): Uint8Array {
  const safeName = sanitizeHtmlFilename(filename);
  return zipSync({ [safeName]: bytes });
}

export function parseTtlSeconds(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (n === 3600 || n === 86400) return n;
  if (raw === "1h" || raw === "1hour") return 3600;
  if (raw === "24h" || raw === "24hours" || raw === "1d") return 86400;
  return null;
}
