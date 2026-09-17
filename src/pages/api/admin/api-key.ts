import type { APIRoute } from "astro";
import { json, error } from "../../../lib/http";
import { requireAdmin } from "../../../lib/admin";
import { createApiKey, listApiKeys, revokeApiKey } from "../../../lib/apikey";

export const prerender = false;

function requiresJson(request: Request): boolean {
  const ct = request.headers.get("content-type") ?? "";
  return ct.includes("application/json");
}

export const GET: APIRoute = async ({ request }) => {
  if (!(await requireAdmin(request))) {
    return error(401, "unauthorized");
  }
  const keys = await listApiKeys();
  return json({ ok: true, keys });
};

export const POST: APIRoute = async ({ request }) => {
  if (!(await requireAdmin(request))) {
    return error(401, "unauthorized");
  }
  // Require JSON content-type so cross-origin form posts can't mint keys
  // (SameSite=Strict cookies + preflighted content-type = CSRF mitigation).
  if (!requiresJson(request)) {
    return error(415, "invalid_content_type", "Content-Type must be application/json.");
  }
  let body: { name?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, "invalid_json");
  }
  try {
    const { entry, rawKey } = await createApiKey(body.name);
    return json({ ok: true, key: entry, rawKey }, 201);
  } catch (err) {
    const code = err instanceof Error ? err.message : "create_failed";
    if (code === "invalid_name") return error(400, "invalid_name", "Name must be 2–40 chars: letters, numbers, spaces, . _ -");
    if (code === "name_taken") return error(409, "name_taken", "A key with that name already exists.");
    if (code === "key_limit_reached") return error(409, "key_limit_reached", "Maximum 10 keys. Revoke an old one first.");
    return error(500, "create_failed", "Could not create API key.");
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  if (!(await requireAdmin(request))) {
    return error(401, "unauthorized");
  }
  if (!requiresJson(request)) {
    return error(415, "invalid_content_type", "Content-Type must be application/json.");
  }
  let body: { id?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, "invalid_json");
  }
  if (typeof body.id !== "string" || !body.id.trim()) {
    return error(400, "invalid_id", "A key id is required.");
  }
  try {
    const revoked = await revokeApiKey(body.id);
    if (!revoked) return error(404, "not_found", "No such API key.");
    return json({ ok: true, revoked: body.id.trim() });
  } catch {
    return error(500, "revoke_failed", "Could not revoke API key.");
  }
};
