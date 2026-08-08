import { timingSafeEqual } from "node:crypto";
import { adminConfigured, isAdminSession } from "./session.js";

export function verifyAdminPassword(username: string, password: string): boolean {
  if (!adminConfigured()) return false;
  const expectedUser = process.env.ADMIN_USERNAME?.trim() || "admin";
  const expectedPassword = process.env.ADMIN_PASSWORD ?? "";
  if (username.trim() !== expectedUser) return false;
  if (password.length !== expectedPassword.length) return false;
  try {
    return timingSafeEqual(Buffer.from(password), Buffer.from(expectedPassword));
  } catch {
    return false;
  }
}

export function requireAdmin(request: Request): boolean {
  return isAdminSession(request);
}
