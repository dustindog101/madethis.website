import type { APIRoute } from "astro";
import { json, error } from "../../../lib/http.js";
import { isAdminSession } from "../../../lib/session.js";
import { getUploadLogs } from "../../../lib/logs.js";

export const prerender = false;

export const GET: APIRoute = async ({ request, url }) => {
  if (!(await isAdminSession(request))) {
    return error(401, "unauthorized", "Admin session required.");
  }

  const page = parseInt(url.searchParams.get("page") ?? "1", 10);
  const limit = parseInt(url.searchParams.get("limit") ?? "10", 10);
  const search = url.searchParams.get("search") ?? undefined;
  const source = url.searchParams.get("source") ?? undefined;

  try {
    const result = await getUploadLogs({
      page: Number.isNaN(page) ? 1 : page,
      limit: Number.isNaN(limit) ? 10 : limit,
      search,
      source,
    });

    return json({ ok: true, ...result });
  } catch {
    return error(500, "fetch_failed", "Failed to load upload logs.");
  }
};
