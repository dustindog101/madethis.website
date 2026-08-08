import type { APIRoute } from "astro";
import { json } from "../../../lib/http";
import { clearSessionCookieHeader } from "../../../lib/session";

export const prerender = false;

export const POST: APIRoute = async () => {
  return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookieHeader() });
};
