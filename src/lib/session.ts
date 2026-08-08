import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "madethis_session";
const MAX_AGE_SEC = 7 * 24 * 60 * 60;

/**
 * Signs admin session cookies. Uses SESSION_SECRET when set, otherwise derives
 * one from ADMIN_PASSWORD so you only need a single env var to get started.
 */
function sessionSecret(): string | null {
  const explicit = process.env.SESSION_SECRET;
  if (typeof explicit === "string" && explicit.length >= 32) return explicit;

  const password = process.env.ADMIN_PASSWORD;
  if (typeof password === "string" && password.length >= 8) {
    return createHmac("sha256", "madethis-session-v1").update(password).digest("hex");
  }

  return null;
}

export function adminConfigured(): boolean {
  const password = process.env.ADMIN_PASSWORD;
  return typeof password === "string" && password.length >= 8;
}

export function createSessionToken(): string | null {
  const secret = sessionSecret();
  if (!secret) return null;
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SEC;
  const payload = JSON.stringify({ sub: "admin", exp });
  const body = Buffer.from(payload).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySessionToken(token: string): boolean {
  const secret = sessionSecret();
  if (!secret) return false;
  const dot = token.indexOf(".");
  if (dot < 1) return false;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  try {
    if (sig.length !== expected.length) return false;
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  } catch {
    return false;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      sub?: string;
      exp?: number;
    };
    if (payload.sub !== "admin" || typeof payload.exp !== "number") return false;
    return payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function cookieSuffix(): string {
  // Secure cookies only work on HTTPS — skip locally so dev login works.
  return process.env.VERCEL === "1" ? "; Secure" : "";
}

export function sessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${MAX_AGE_SEC}${cookieSuffix()}`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${cookieSuffix()}`;
}

export function isAdminSession(request: Request): boolean {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  if (!match?.[1]) return false;
  return verifySessionToken(match[1]);
}
