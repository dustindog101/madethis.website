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

function envPassword(): string | undefined {
  const password = process.env.ADMIN_PASSWORD;
  return typeof password === "string" && password.length >= 8 ? password : undefined;
}

function envUsername(): string {
  return process.env.ADMIN_USERNAME?.trim() || "admin";
}

function hashPassword(password: string, salt: Buffer): string {
  return scryptSync(password, salt, 64).toString("hex");
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
  if (envPassword()) return true;
  return (await getAdminAuth()) !== null;
}

export async function createAdminAuth(username: string, password: string): Promise<AdminAuthRecord> {
  if (await hasAdminAuth()) throw new Error("already_configured");
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

  await storage.put(CONFIG_PATH, new TextEncoder().encode(JSON.stringify(record)), "application/json");
  return record;
}

export async function verifyAdminPassword(username: string, password: string): Promise<boolean> {
  const envPw = envPassword();
  if (envPw) {
    if (username.trim() !== envUsername()) return false;
    if (password.length !== envPw.length) return false;
    try {
      return timingSafeEqual(Buffer.from(password), Buffer.from(envPw));
    } catch {
      return false;
    }
  }

  const record = await getAdminAuth();
  if (!record) return false;
  if (username.trim() !== record.username) return false;

  const salt = Buffer.from(record.salt, "hex");
  const hash = hashPassword(password, salt);
  if (hash.length !== record.passwordHash.length) return false;
  try {
    return timingSafeEqual(Buffer.from(hash), Buffer.from(record.passwordHash));
  } catch {
    return false;
  }
}

export async function getSessionPepper(): Promise<string | null> {
  const explicit = process.env.SESSION_SECRET;
  if (typeof explicit === "string" && explicit.length >= 32) return explicit;

  const envPw = envPassword();
  if (envPw) {
    return createHmac("sha256", "madethis-session-v1").update(envPw).digest("hex");
  }

  const record = await getAdminAuth();
  return record?.sessionPepper ?? null;
}
