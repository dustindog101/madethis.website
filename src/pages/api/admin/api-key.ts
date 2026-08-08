import type { APIRoute } from "astro";
import { json, error } from "../../../lib/http";
import { requireAdmin } from "../../../lib/admin";
import { ensureApiKey, getApiKeyMeta, maskApiKey, rotateApiKey } from "../../../lib/apikey";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  if (!requireAdmin(request)) {
    return error(401, "unauthorized");
  }

  const record = await ensureApiKey();
  return json({
    ok: true,
    key: record.key,
    masked: maskApiKey(record.key),
    createdAt: record.createdAt,
  });
};

export const POST: APIRoute = async ({ request }) => {
  if (!requireAdmin(request)) {
    return error(401, "unauthorized");
  }

  const previous = await getApiKeyMeta();
  const record = await rotateApiKey();
  return json({
    ok: true,
    key: record.key,
    masked: maskApiKey(record.key),
    createdAt: record.createdAt,
    rotatedFrom: previous?.createdAt ?? null,
  });
};
