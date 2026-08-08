import { isAdminSession } from "./session.js";

export async function requireAdmin(request: Request): Promise<boolean> {
  return isAdminSession(request);
}
