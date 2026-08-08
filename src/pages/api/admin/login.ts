import type { APIRoute } from "astro";
import { json, error } from "../../../lib/http";
import { verifyAdminPassword } from "../../../lib/admin";
import { adminConfigured, createSessionToken, sessionCookieHeader } from "../../../lib/session";
import { ensureApiKey } from "../../../lib/apikey";

export const prerender = false;

interface LoginBody {
  username?: string;
  password?: string;
}

export const POST: APIRoute = async ({ request }) => {
  if (!adminConfigured()) {
    return error(503, "admin_disabled", "Admin login is not configured.");
  }

  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return error(400, "invalid_json");
  }

  const username = body.username ?? "";
  const password = body.password ?? "";
  if (!verifyAdminPassword(username, password)) {
    return error(401, "invalid_credentials", "Invalid username or password.");
  }

  const token = createSessionToken();
  if (!token) return error(503, "session_unavailable");

  await ensureApiKey();

  return json(
    { ok: true },
    200,
    { "Set-Cookie": sessionCookieHeader(token) },
  );
};
