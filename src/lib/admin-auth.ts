import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { storage } from "./storage.js";

const CONFIG_PATH = "config/admin-auth.json";

export interface AdminAuthRecord {
  username: string;
  passwordHash: string;
  salt: string;
  sessionPepper: string;
  createdAt: number;
}

export type AdminLoginResult = { kind: "blob"; record: AdminAuthRecord } | { kind: "env" };

function envPassword(): string | undefined {
  const password = process.env["ADMIN_PASSWORD"];
  return typeof password === "string" && password.length >= 8 ? password : undefined;
}

function envUsername(): string {
  const username = process.env["ADMIN_USERNAME"];
  return typeof username === "string" && username.trim() ? username.trim() : "admin";
}

function hashPassword(password: string, salt: Buffer): string {
  return scryptSync(password, salt, 64).toString("hex");
}

/** Stable signing secret when blob/env peppers are unavailable (Vercel always has blob store). */
export function deploymentSessionPepper(): string {
  const material =
    process.env["BLOB_STORE_ID"] ??
    process.env["BLOB_READ_WRITE_TOKEN"]?.slice(0, 48) ??
    process.env["VERCEL_URL"] ??
    "madethis.website";
  return createHmac("sha256", "madethis-deploy-session-v1").update(material).digest("hex");
}

export function pepperFromEnvPassword(): string {
  const envPw = envPassword();
  if (envPw) {
    return createHmac("sha256", "madethis-session-v1").update(envPw).digest("hex");
  }
  const explicit = process.env["SESSION_SECRET"];
  if (typeof explicit === "string" && explicit.length >= 32) return explicit;
  return deploymentSessionPepper();
}

export function resolveSessionPepper(record?: AdminAuthRecord | null): string {
  const explicit = process.env["SESSION_SECRET"];
  if (typeof explicit === "string" && explicit.length >= 32) return explicit;
  if (record?.sessionPepper) return record.sessionPepper;
  const envPw = envPassword();
  if (envPw) {
    return createHmac("sha256", "madethis-session-v1").update(envPw).digest("hex");
  }
  return deploymentSessionPepper();
}

export async function getAdminAuth(): Promise<AdminAuthRecord | null> {
  const raw = await storage.get(CONFIG_PATH);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(raw)) as Partial<AdminAuthRecord>;
    if (
      typeof parsed.username !== "string" ||
      typeof parsed.passwordHash !== "string" ||
      typeof parsed.salt !== "string" ||
      typeof parsed.sessionPepper !== "string" ||
      typeof parsed.createdAt !== "number"
    ) {
      return null;
    }
    return parsed as AdminAuthRecord;
  } catch {
    return null;
  }
}

export async function hasAdminAuth(): Promise<boolean> {
  const blob = await getAdminAuth();
  if (blob) return true;
  return !!envPassword();
}

export async function createAdminAuth(username: string, password: string): Promise<AdminAuthRecord> {
  const existing = await getAdminAuth();
  if (existing) throw new Error("already_configured");
  if (password.length < 8) throw new Error("password_too_short");

  const cleanUser = username.trim() || "admin";
  if (!/^[\w.\-]{2,40}$/.test(cleanUser)) throw new Error("invalid_username");

  const salt = randomBytes(16);
  const record: AdminAuthRecord = {
    username: cleanUser,
    passwordHash: hashPassword(password, salt),
    salt: salt.toString("hex"),
    sessionPepper: randomBytes(32).toString("hex"),
    createdAt: Date.now(),
  };

  await storage.put(CONFIG_PATH, new TextEncoder().encode(JSON.stringify(record)), "application/json", {
    allowOverwrite: true,
  });
  return record;
}

export async function verifyAdminLogin(username: string, password: string): Promise<AdminLoginResult | null> {
  const blob = await getAdminAuth();
  if (blob) {
    if (username.trim() !== blob.username) return null;
    const salt = Buffer.from(blob.salt, "hex");
    const hash = hashPassword(password, salt);
    if (hash.length !== blob.passwordHash.length) return null;
    try {
      if (timingSafeEqual(Buffer.from(hash), Buffer.from(blob.passwordHash))) {
        return { kind: "blob", record: blob };
      }
    } catch {
      return null;
    }
    return null;
  }

  const envPw = envPassword();
  if (!envPw) return null;
  if (username.trim() !== envUsername()) return null;
  if (password.length !== envPw.length) return null;
  try {
    if (timingSafeEqual(Buffer.from(password), Buffer.from(envPw))) {
      return { kind: "env" };
    }
  } catch {
    return null;
  }
  return null;
}

export async function getSessionPepper(): Promise<string> {
  const record = await getAdminAuth();
  return resolveSessionPepper(record);
}
