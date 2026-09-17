import type { APIRoute } from "astro";
import { json, error } from "../../../lib/http.js";
import { isAdminSession } from "../../../lib/session.js";
import { deleteSite } from "../../../lib/site.js";
import { readAllLogs } from "../../../lib/logs.js";
import { validSlug } from "../../../lib/ids.js";

export const prerender = false;

/**
 * Bulk delete, bounded for serverless + free-tier safety.
 * - `{ "expiredOnly": true }`: purge up to 50 expired sites (blobs AND log
 *   rows, so the index stays clean). This is the primary cleanup action.
 * - `{ "slugs": [...] }`: delete up to 20 explicit slugs (blobs only;
 *   log rows are kept as history, same as single delete).
 */
interface BulkBody {
  expiredOnly?: unknown;
  slugs?: unknown;
}

const MAX_EXPIRED_PURGE = 50;
const MAX_EXPLICIT_SLUGS = 20;

export const POST: APIRoute = async ({ request }) => {
  if (!(await isAdminSession(request))) {
    return error(401, "unauthorized", "Admin session required.");
  }
  const ct = request.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    return error(415, "invalid_content_type", "Content-Type must be application/json.");
  }

  let body: BulkBody;
  try {
    body = (await request.json()) as BulkBody;
  } catch {
    return error(400, "invalid_json");
  }

  try {
    if (body.expiredOnly === true) {
      const now = Date.now();
      const logs = await readAllLogs();
      const expired = logs.filter((l) => l.expiresAt <= now).slice(0, MAX_EXPIRED_PURGE);
      const deleted: string[] = [];
      for (const log of expired) {
        try {
          await deleteSite(log.slug, true);
          deleted.push(log.slug);
        } catch {
          // per-item best-effort; continue with the rest
        }
      }
      return json({ ok: true, deleted, deletedCount: deleted.length, scanned: expired.length });
    }

    if (Array.isArray(body.slugs)) {
      const slugs = body.slugs
        .filter((s): s is string => typeof s === "string" && validSlug(s))
        .slice(0, MAX_EXPLICIT_SLUGS);
      if (slugs.length === 0) {
        return error(400, "invalid_slugs", "Provide 1–20 valid slugs, or { expiredOnly: true }.");
      }
      const deleted: string[] = [];
      for (const slug of slugs) {
        try {
          await deleteSite(slug);
          deleted.push(slug);
        } catch {
          // best-effort per item
        }
      }
      return json({ ok: true, deleted, deletedCount: deleted.length });
    }

    return error(400, "invalid_request", "Provide { expiredOnly: true } or { slugs: [...] }.");
  } catch {
    return error(500, "bulk_delete_failed", "Bulk delete failed partway; retry to finish.");
  }
};
