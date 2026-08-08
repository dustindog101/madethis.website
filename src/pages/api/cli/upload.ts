import type { APIRoute } from "astro";
import { json, error, rateLimited } from "../../../lib/http";
import { verifyCliApiKey, cliApiKeyConfigured } from "../../../lib/auth";
import { clientIp, hashIp } from "../../../lib/ip";
import { checkCliUploadLimits, rateLimitHeaders } from "../../../lib/ratelimit";
import {
  htmlToZip,
  parseTtlSeconds,
  sanitizeHtmlFilename,
  validateHtmlBody,
} from "../../../lib/html";
import { publishSiteFromZip } from "../../../lib/publish";
import { DEFAULT_TTL_SECONDS, UPLOAD_TTL_OPTIONS } from "../../../lib/limits";
import { storageReady } from "../../../lib/storage";

export const prerender = false;

export const POST: APIRoute = async ({ request, url }) => {
  if (!cliApiKeyConfigured()) {
    return error(503, "cli_disabled", "CLI uploads are not configured on this deployment.");
  }
  if (!verifyCliApiKey(request)) {
    return error(401, "unauthorized", "Invalid or missing API key. Use Authorization: Bearer <CLI_API_KEY>.");
  }
  if (!storageReady()) {
    return error(503, "storage_unavailable", "Blob storage is not configured.");
  }

  const ipHash = hashIp(clientIp(request));
  const rate = await checkCliUploadLimits(ipHash);
  if (!rate.ok) {
    return rateLimited(rate.resetAt, "Too many CLI uploads. Try again later.");
  }

  const contentType = request.headers.get("content-type") ?? "";
  const ttlRaw = url.searchParams.get("ttl");
  if (!UPLOAD_TTL_OPTIONS.includes(ttlSeconds)) {
    return error(400, "invalid_ttl", "ttl must be 3600, 86400, 1h, or 24h.");
  }

  let htmlBytes: Uint8Array;
  let filename = sanitizeHtmlFilename(request.headers.get("x-filename"));
  let ttlSeconds = parseTtlSeconds(ttlRaw) ?? DEFAULT_TTL_SECONDS;

  if (contentType.includes("application/json")) {
    let body: { html?: string; filename?: string; ttl?: number };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return error(400, "invalid_json");
    }
    if (typeof body.html !== "string" || body.html.length === 0) {
      return error(400, "missing_html", "JSON body must include a non-empty html string.");
    }
    htmlBytes = new TextEncoder().encode(body.html);
    if (body.filename) filename = sanitizeHtmlFilename(body.filename);
    if (body.ttl && UPLOAD_TTL_OPTIONS.includes(body.ttl as (typeof UPLOAD_TTL_OPTIONS)[number])) {
      ttlSeconds = body.ttl;
    }
  } else if (
    contentType.includes("text/html") ||
    contentType.includes("application/octet-stream") ||
    contentType === ""
  ) {
    const buf = await request.arrayBuffer();
    htmlBytes = new Uint8Array(buf);
  } else {
    return error(415, "unsupported_media_type", "Use Content-Type: text/html or application/json.");
  }

  const validated = validateHtmlBody(htmlBytes);
  if (!validated.ok) return error(400, validated.code, validated.message);

  const zipBytes = htmlToZip(validated.bytes, filename);

  try {
    const published = await publishSiteFromZip(zipBytes, ttlSeconds);
    return json(
      {
        ok: true,
        slug: published.slug,
        url: published.url,
        fullUrl: new URL(published.url, url.origin).href,
        expiresAt: published.expiresAt,
        files: published.files,
        homepage: published.homepage,
      },
      201,
      rateLimitHeaders(rate),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "publish_failed";
    if (message === "site_too_large" || message === "too_many_files" || message === "empty_site") {
      return error(422, message);
    }
    return error(503, "publish_failed", "Could not publish the site.");
  }
};
