import { timingSafeEqual } from "node:crypto";

const MIN_KEY_LENGTH = 32;

export function cliApiKeyConfigured(): boolean {
  const key = process.env.CLI_API_KEY;
  return typeof key === "string" && key.length >= MIN_KEY_LENGTH;
}

/** Constant-time Bearer token check. Returns false when CLI_API_KEY is unset or too short. */
export function verifyCliApiKey(request: Request): boolean {
  const expected = process.env.CLI_API_KEY;
  if (!expected || expected.length < MIN_KEY_LENGTH) return false;

  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;

  const provided = header.slice(7);
  if (provided.length !== expected.length) return false;

  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}
