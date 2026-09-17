import type { APIRoute } from "astro";
import { json, error } from "../../../lib/http.js";
import { isAdminSession } from "../../../lib/session.js";
import { getUploadLogs } from "../../../lib/logs.js";

export const prerender = false;

const VALID_STATUS = new Set(["all", "active", "expired"]);

export const GET: APIRoute = async ({ request, url }) => {
  if (!(await isAdminSession(request))) {
    return error(401, "unauthorized", "Admin session required.");
  }

  const page = parseInt(url.searchParams.get("page") ?? "1", 10);
  const limit = parseInt(url.searchParams.get("limit") ?? "10", 10);
  const search = (url.searchParams.get("search") ?? "").slice(0, 100) || undefined;
  const source = url.searchParams.get("source") ?? undefined;
  const statusRaw = (url.searchParams.get("status") ?? "all").toLowerCase();
  const status = VALID_STATUS.has(statusRaw) ? statusRaw : "all";
  const graceParam = url.searchParams.get("grace") ?? "";
  const grace = graceParam === "1" || graceParam.toLowerCase() === "true";

  try {
    const result = await getUploadLogs({
      page: Number.isNaN(page) ? 1 : page,
      limit: Number.isNaN(limit) ? 10 : limit,
      search,
      source,
      grace: grace || undefined,
      status: status === "all" ? undefined : (status as "active" | "expired"),
    });

    return json({ ok: true, ...result });
  } catch {
    return error(500, "fetch_failed", "Failed to load upload logs.");
  }
};
