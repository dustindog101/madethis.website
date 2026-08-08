import { randomBytes } from "node:crypto";
import { storage } from "./storage.js";

const CONFIG_PATH = "config/cli-api-key.json";

interface ApiKeyRecord {
  key: string;
  createdAt: number;
}

export async function getStoredApiKey(): Promise<string | null> {
  const raw = await storage.get(CONFIG_PATH);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(raw)) as Partial<ApiKeyRecord>;
    if (typeof parsed.key !== "string" || parsed.key.length < 32) return null;
    return parsed.key;
  } catch {
    return null;
  }
}

export async function getApiKeyMeta(): Promise<ApiKeyRecord | null> {
  const raw = await storage.get(CONFIG_PATH);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(raw)) as Partial<ApiKeyRecord>;
    if (typeof parsed.key !== "string" || typeof parsed.createdAt !== "number") return null;
    return parsed as ApiKeyRecord;
  } catch {
    return null;
  }
}

export async function rotateApiKey(): Promise<ApiKeyRecord> {
  const record: ApiKeyRecord = {
    key: randomBytes(32).toString("hex"),
    createdAt: Date.now(),
  };
  await storage.put(CONFIG_PATH, new TextEncoder().encode(JSON.stringify(record)), "application/json", {
    allowOverwrite: true,
  });
  return record;
}

export async function ensureApiKey(): Promise<ApiKeyRecord> {
  const existing = await getApiKeyMeta();
  if (existing) return existing;
  return rotateApiKey();
}

export function maskApiKey(key: string): string {
  if (key.length <= 12) return "••••••••";
  return `${key.slice(0, 6)}••••••••${key.slice(-4)}`;
}
