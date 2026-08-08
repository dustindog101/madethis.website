import type { APIRoute } from "astro";
import { json, error } from "../../../lib/http";
import { hasAdminAuth, verifyAdminLogin } from "../../../lib/admin-auth";
import { createSessionToken, sessionCookieHeader } from "../../../lib/session";
import { ensureApiKey } from "../../../lib/apikey";

export const prerender = false;

interface LoginBody {
  username?: string;
  password?: string;
}

export const POST: APIRoute = async ({ request }) => {
  if (!(await hasAdminAuth())) {
    return error(503, "admin_disabled", "Create an admin account first.");
  }

  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return error(400, "invalid_json");
  }

  const auth = await verifyAdminLogin(body.username ?? "", body.password ?? "");
  if (!auth) {
    return error(401, "invalid_credentials", "Invalid username or password.");
  }

  const token = auth.kind === "blob" ? createSessionToken(auth.record) : createSessionToken(null);
  await ensureApiKey();

  return json({ ok: true }, 200, { "Set-Cookie": sessionCookieHeader(token) });
};
