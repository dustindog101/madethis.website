import type { APIRoute } from "astro";
import { json, error, rateLimited } from "../../../lib/http";
import { cliUploadEnabled, verifyCliApiKey } from "../../../lib/auth";
import { isAdminSession } from "../../../lib/session";
import { extractClientContext, hashIp } from "../../../lib/ip";
import { checkCliUploadLimits, rateLimitHeaders } from "../../../lib/ratelimit";
import { parseTtlSeconds, prepareCliUpload } from "../../../lib/cli-upload";
import { publishSiteFromZip } from "../../../lib/publish";
import {
  DEFAULT_TTL_SECONDS,
  OWNER_MAX_SITE_ZIP_BYTES,
  UPLOAD_TTL_OPTIONS,
} from "../../../lib/limits";
import { validSlug } from "../../../lib/ids";
import { storageReady } from "../../../lib/storage";

export const prerender = false;

export const POST: APIRoute = async ({ request, url }) => {
  if (!storageReady()) {
    return error(503, "storage_unavailable", "Blob storage is not configured.");
  }

  const hasSession = await isAdminSession(request);
  const hasKey = await verifyCliApiKey(request);
  if (!hasSession && !hasKey) {
    const enabled = await cliUploadEnabled();
    if (!enabled) {
      return error(
        503,
        "cli_disabled",
        "CLI uploads are not configured. Log in at /admin to generate an API key.",
      );
    }
    return error(
      401,
      "unauthorized",
      "Use Authorization: Bearer <api-key> or log in at /admin first.",
    );
  }

  const context = extractClientContext(request, "cli");
  const ipHash = hashIp(context.ip);
  const rate = await checkCliUploadLimits(ipHash);
  if (!rate.ok) {
    return rateLimited(rate.resetAt, "Too many CLI uploads. Try again later.");
  }

  // Owner tier: this route requires API key or admin session, so every
  // caller here is the owner. Reject absurd bodies before buffering them
  // into serverless memory (zip bombs / oversized mp4+pdf).
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > OWNER_MAX_SITE_ZIP_BYTES + 1024 * 1024
  ) {
    return error(
      413,
      "site_too_large",
      `Upload must be at most ${OWNER_MAX_SITE_ZIP_BYTES} bytes.`,
    );
  }

  const contentType = request.headers.get("content-type") ?? "";
  const ttlRaw = url.searchParams.get("ttl");
  let ttlSeconds = parseTtlSeconds(ttlRaw) ?? DEFAULT_TTL_SECONDS;
  if (!UPLOAD_TTL_OPTIONS.includes(ttlSeconds as (typeof UPLOAD_TTL_OPTIONS)[number])) {
    return error(400, "invalid_ttl", "ttl must be 3600, 86400, 1h, or 24h.");
  }

  let bytes: Uint8Array;
  let filename = request.headers.get("x-filename");

  if (contentType.includes("application/json")) {
    let body: { content?: string; html?: string; filename?: string; ttl?: number };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return error(400, "invalid_json");
    }
    const text = body.content ?? body.html;
    if (typeof text !== "string" || text.length === 0) {
      return error(400, "missing_content", "JSON body must include content or html.");
    }
    bytes = new TextEncoder().encode(text);
    if (body.filename) filename = body.filename;
    if (body.ttl && UPLOAD_TTL_OPTIONS.includes(body.ttl as (typeof UPLOAD_TTL_OPTIONS)[number])) {
      ttlSeconds = body.ttl;
    }
  } else {
    bytes = new Uint8Array(await request.arrayBuffer());
  }

  // Belt-and-suspenders: header can be spoofed or absent (chunked).
  if (bytes.byteLength > OWNER_MAX_SITE_ZIP_BYTES + 1024 * 1024) {
    return error(
      413,
      "site_too_large",
      `Upload must be at most ${OWNER_MAX_SITE_ZIP_BYTES} bytes.`,
    );
  }

  const prepared = prepareCliUpload(bytes, filename, contentType, { isOwner: true });
  if (!prepared.ok) return error(400, prepared.code, prepared.message);

  const requestedSlug = request.headers.get("x-slug") || url.searchParams.get("slug") || undefined;
  const safeSlug = requestedSlug && validSlug(requestedSlug) ? requestedSlug : undefined;

  try {
    const published = await publishSiteFromZip(prepared.zipBytes, ttlSeconds, {
      slug: safeSlug,
      ip: context.ip,
      source: context.source,
      country: context.country,
      city: context.city,
      region: context.region,
      userAgent: context.userAgent,
      maxZipBytes: OWNER_MAX_SITE_ZIP_BYTES,
    });
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
    if (message === "not_a_zip") {
      return error(422, "not_a_zip", "That file isn't a readable ZIP archive.");
    }
    return error(503, "publish_failed", "Could not publish the site.");
  }
};
