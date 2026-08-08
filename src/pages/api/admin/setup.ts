import type { APIRoute } from "astro";
import { json, error } from "../../../lib/http";
import { createAdminAuth, hasAdminAuth } from "../../../lib/admin-auth";
import { createSessionToken, sessionCookieHeader } from "../../../lib/session";
import { ensureApiKey } from "../../../lib/apikey";
import { storageReady } from "../../../lib/storage";

export const prerender = false;

interface SetupBody {
  username?: string;
  password?: string;
  confirm?: string;
}

export const POST: APIRoute = async ({ request }) => {
  if (!storageReady()) {
    return error(503, "storage_unavailable", "Blob storage is required before admin can be set up.");
  }

  if (await hasAdminAuth()) {
    return error(409, "already_configured", "Admin already exists. Sign in instead.");
  }

  let body: SetupBody;
  try {
    body = (await request.json()) as SetupBody;
  } catch {
    return error(400, "invalid_json");
  }

  const password = body.password ?? "";
  const confirm = body.confirm ?? password;
  if (password.length < 8) {
    return error(400, "password_too_short", "Password must be at least 8 characters.");
  }
  if (password !== confirm) {
    return error(400, "password_mismatch", "Passwords do not match.");
  }

  try {
    await createAdminAuth(body.username ?? "admin", password);
  } catch (err) {
    const message = err instanceof Error ? err.message : "setup_failed";
    if (message === "invalid_username") {
      return error(400, "invalid_username", "Username must be 2–40 characters: letters, numbers, . _ -");
    }
    return error(503, "setup_failed", "Could not save admin credentials.");
  }

  const token = await createSessionToken();
  if (!token) return error(503, "session_unavailable");

  await ensureApiKey();

  return json({ ok: true }, 201, { "Set-Cookie": sessionCookieHeader(token) });
};
