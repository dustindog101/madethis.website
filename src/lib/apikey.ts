import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { storage } from "./storage.js";

const CONFIG_PATH = "config/cli-api-key.json";
const MAX_KEYS = 10;
const LAST_USED_WRITE_THROTTLE_MS = 60 * 60 * 1000; // 1h — free-tier safe

export interface ApiKeyEntry {
  id: string;
  name: string;
  /** sha256 hex of the raw bearer token. Raw is never stored. */
  keyHash: string;
  /** e.g. `mt_ab12…9f3e` — safe to show in admin lists. */
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface ApiKeyPublic {
  id: string;
  name: string;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
}

interface NewStoreShape {
  version: 1;
  keys: ApiKeyEntry[];
}

interface LegacyStoreShape {
  key: string;
  createdAt: number;
}

function sha256Hex(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export function maskApiKey(key: string): string {
  if (key.length <= 12) return "••••••••";
  return `${key.slice(0, 6)}••••••••${key.slice(-4)}`;
}

function prefixFor(raw: string): string {
  if (raw.length <= 12) return "••••••••";
  return `${raw.slice(0, 6)}…${raw.slice(-4)}`;
}

function cleanName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!/^[\w.\- ]{2,40}$/.test(name)) {
    throw new Error("invalid_name");
  }
  return name;
}

function toPublic(entry: ApiKeyEntry): ApiKeyPublic {
  return {
    id: entry.id,
    name: entry.name,
    prefix: entry.prefix,
    createdAt: entry.createdAt,
    lastUsedAt: entry.lastUsedAt,
  };
}

async function readRaw(): Promise<Uint8Array | null> {
  return storage.get(CONFIG_PATH);
}

async function saveStore(keys: ApiKeyEntry[]): Promise<void> {
  const shape: NewStoreShape = { version: 1, keys };
  await storage.put(CONFIG_PATH, new TextEncoder().encode(JSON.stringify(shape)), "application/json", {
    allowOverwrite: true,
  });
}

function migrateLegacy(parsed: unknown): ApiKeyEntry[] | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (Array.isArray((obj as { keys?: unknown }).keys)) return null; // already new
  if (typeof obj["key"] === "string" && typeof obj["createdAt"] === "number") {
    const legacy = obj as unknown as LegacyStoreShape;
    if (legacy.key.length < 32) return [];
    return [
      {
        id: "legacy",
        name: "legacy",
        keyHash: sha256Hex(legacy.key),
        prefix: prefixFor(legacy.key),
        createdAt: legacy.createdAt,
        lastUsedAt: null,
      },
    ];
  }
  return null;
}

async function readStore(): Promise<ApiKeyEntry[]> {
  const raw = await readRaw();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(new TextDecoder().decode(raw)) as unknown;
    if (typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { keys?: unknown }).keys)) {
      const keys = (parsed as NewStoreShape).keys;
      if (!Array.isArray(keys)) return [];
      return keys.filter(
        (k): k is ApiKeyEntry =>
          typeof k?.id === "string" &&
          typeof k?.name === "string" &&
          typeof k?.keyHash === "string" &&
          typeof k?.prefix === "string" &&
          typeof k?.createdAt === "number",
      );
    }
    const migrated = migrateLegacy(parsed);
    if (migrated) {
      // Best-effort one-time migration; ignore write failures (read path stays working).
      await saveStore(migrated).catch(() => {});
      return migrated;
    }
    return [];
  } catch {
    return [];
  }
}

/** Masked list for admin UI. Never includes raw keys or hashes. */
export async function listApiKeys(): Promise<ApiKeyPublic[]> {
  const keys = await readStore();
  return keys
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(toPublic);
}

export async function hasAnyApiKey(): Promise<boolean> {
  const keys = await readStore();
  return keys.length > 0;
}

/**
 * Create a named key. Returns the raw bearer token exactly once —
 * callers must show it to the admin now; it is never retrievable again.
 */
export async function createApiKey(nameRaw: unknown): Promise<{ entry: ApiKeyPublic; rawKey: string }> {
  const name = cleanName(nameRaw);
  const keys = await readStore();
  if (keys.length >= MAX_KEYS) throw new Error("key_limit_reached");
  if (keys.some((k) => k.name.toLowerCase() === name.toLowerCase())) throw new Error("name_taken");

  const rawKey = `mt_${randomBytes(24).toString("hex")}`;
  const entry: ApiKeyEntry = {
    id: randomBytes(8).toString("hex"),
    name,
    keyHash: sha256Hex(rawKey),
    prefix: prefixFor(rawKey),
    createdAt: Date.now(),
    lastUsedAt: null,
  };
  await saveStore([...keys, entry]);
  return { entry: toPublic(entry), rawKey };
}

export async function revokeApiKey(idRaw: unknown): Promise<boolean> {
  const id = typeof idRaw === "string" ? idRaw.trim() : "";
  if (!id) throw new Error("invalid_id");
  const keys = await readStore();
  const next = keys.filter((k) => k.id !== id);
  if (next.length === keys.length) return false;
  await saveStore(next);
  return true;
}

/** Verify a presented bearer token against stored hashes (constant-time). */
export async function verifyStoredApiKey(provided: string): Promise<ApiKeyEntry | null> {
  if (!provided || provided.length < 32) return null;
  const candidate = sha256Hex(provided);
  const keys = await readStore();
  for (const entry of keys) {
    if (safeEqualHex(candidate, entry.keyHash)) return entry;
  }
  return null;
}

/**
 * Throttled last-used touch (≤1 write/hour/key). Fire-and-forget from auth
 * paths — never throws.
 */
export async function touchApiKeyLastUsed(id: string, now = Date.now()): Promise<void> {
  try {
    const keys = await readStore();
    const entry = keys.find((k) => k.id === id);
    if (!entry) return;
    if (entry.lastUsedAt !== null && now - entry.lastUsedAt < LAST_USED_WRITE_THROTTLE_MS) return;
    const next = keys.map((k) => (k.id === id ? { ...k, lastUsedAt: now } : k));
    await saveStore(next);
  } catch {
    // best-effort only
  }
}

// --- Legacy compat (deprecated) -------------------------------------------

/** @deprecated Use listApiKeys()/verifyStoredApiKey(). Returns null on new-shape stores. */
export async function getStoredApiKey(): Promise<string | null> {
  return null;
}

/** @deprecated Use listApiKeys(). */
export async function getApiKeyMeta(): Promise<{ key: string; createdAt: number } | null> {
  return null;
}

/** @deprecated Use createApiKey(name). */
export async function rotateApiKey(): Promise<{ key: string; createdAt: number }> {
  throw new Error("deprecated_use_createApiKey");
}

/**
 * Ensure at least one key exists (called on setup/login). Creates an
 * unrecoverable `default` key only when the store is empty — the admin is
 * expected to create named keys via the UI. Returns masked entries only.
 */
export async function ensureApiKey(): Promise<ApiKeyPublic | null> {
  const keys = await readStore();
  if (keys.length > 0) return toPublic(keys[0]);
  try {
    const { entry } = await createApiKey("default");
    return entry;
  } catch {
    return null;
  }
}
