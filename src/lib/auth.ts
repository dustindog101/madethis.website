import { timingSafeEqual } from "node:crypto";
import { getStoredApiKey } from "./apikey.js";
import { hasAdminAuth } from "./admin-auth.js";

const MIN_KEY_LENGTH = 32;

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

function extractBearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

/** CLI is available when an env key exists, admin exists, or a blob-stored key exists. */
export async function cliUploadEnabled(): Promise<boolean> {
  const envKey = process.env.CLI_API_KEY;
  if (typeof envKey === "string" && envKey.length >= MIN_KEY_LENGTH) return true;
  if (await hasAdminAuth()) return true;
  const stored = await getStoredApiKey();
  return typeof stored === "string" && stored.length >= MIN_KEY_LENGTH;
}

/** Constant-time Bearer token check against env or blob-stored key. */
export async function verifyCliApiKey(request: Request): Promise<boolean> {
  const provided = extractBearer(request);
  if (!provided || provided.length < MIN_KEY_LENGTH) return false;

  const envKey = process.env.CLI_API_KEY;
  if (envKey && envKey.length >= MIN_KEY_LENGTH && safeEqual(provided, envKey)) {
    return true;
  }

  const stored = await getStoredApiKey();
  if (stored && safeEqual(provided, stored)) return true;

  return false;
}
