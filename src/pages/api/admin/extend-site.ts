import type { APIRoute } from "astro";
import { json, error } from "../../../lib/http.js";
import { isAdminSession } from "../../../lib/session.js";
import { extendSiteTtl } from "../../../lib/site.js";
import { validSlug } from "../../../lib/ids.js";
import { UPLOAD_TTL_OPTIONS } from "../../../lib/limits.js";

export const prerender = false;

interface ExtendBody {
  slug?: unknown;
  ttl?: unknown;
}

export const POST: APIRoute = async ({ request }) => {
  if (!(await isAdminSession(request))) {
    return error(401, "unauthorized", "Admin session required.");
  }
  const ct = request.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    return error(415, "invalid_content_type", "Content-Type must be application/json.");
  }

  let body: ExtendBody;
  try {
    body = (await request.json()) as ExtendBody;
  } catch {
    return error(400, "invalid_json");
  }

  if (typeof body.slug !== "string" || !validSlug(body.slug)) {
    return error(400, "invalid_slug", "A valid site slug is required.");
  }
  const ttl = typeof body.ttl === "string" ? parseInt(body.ttl, 10) : body.ttl;
  if (typeof ttl !== "number" || !UPLOAD_TTL_OPTIONS.includes(ttl as (typeof UPLOAD_TTL_OPTIONS)[number])) {
    return error(400, "invalid_ttl", "ttl must be one of 3600, 86400, 604800.");
  }

  try {
    const meta = await extendSiteTtl(body.slug, ttl);
    return json({ ok: true, slug: meta.slug, expiresAt: meta.expiresAt, ttlSeconds: meta.ttlSeconds });
  } catch (err) {
    const code = err instanceof Error ? err.message : "extend_failed";
    if (code === "not_found") return error(404, "not_found", "No such site (it may already be cleaned up).");
    if (code === "invalid_slug" || code === "invalid_ttl") return error(400, code);
    return error(500, "extend_failed", "Failed to extend site.");
  }
};
