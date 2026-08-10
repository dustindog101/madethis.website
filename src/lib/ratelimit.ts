import { storage } from "./storage.js";
import {
  RATE_GLOBAL_PER_HOUR,
  RATE_IP_PER_DAY,
  RATE_IP_PER_HOUR,
  RATE_CLI_PER_HOUR,
} from "./limits.js";

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

function windowKey(scope: string, windowMs: number): string {
  const slot = Math.floor(Date.now() / windowMs);
  return `ratelimit/${scope}/${slot}.json`;
}

async function readBucket(path: string, windowMs: number): Promise<Bucket> {
  const now = Date.now();
  const raw = await storage.get(path);
  if (!raw) return { count: 0, resetAt: now + windowMs };
  try {
    const parsed = JSON.parse(new TextDecoder().decode(raw)) as Partial<Bucket>;
    if (typeof parsed.count !== "number" || typeof parsed.resetAt !== "number") {
      return { count: 0, resetAt: now + windowMs };
    }
    if (now >= parsed.resetAt) return { count: 0, resetAt: now + windowMs };
    return { count: parsed.count, resetAt: parsed.resetAt };
  } catch {
    return { count: 0, resetAt: now + windowMs };
  }
}

async function consume(path: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const bucket = await readBucket(path, windowMs);
  if (bucket.count >= limit) {
    return { ok: false, limit, remaining: 0, resetAt: bucket.resetAt };
  }
  const next: Bucket = { count: bucket.count + 1, resetAt: bucket.resetAt };
  await storage.put(path, new TextEncoder().encode(JSON.stringify(next)), "application/json", {
    allowOverwrite: true,
  });
  return { ok: true, limit, remaining: limit - next.count, resetAt: next.resetAt };
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const RATE_LOGIN_PER_15M = 5;

export async function checkWebUploadLimits(ipHash: string): Promise<RateLimitResult> {
  const global = await consume(windowKey("global-hour", HOUR), RATE_GLOBAL_PER_HOUR, HOUR);
  if (!global.ok) return global;

  const hourly = await consume(windowKey(`ip-hour/${ipHash}`, HOUR), RATE_IP_PER_HOUR, HOUR);
  if (!hourly.ok) return hourly;

  return consume(windowKey(`ip-day/${ipHash}`, DAY), RATE_IP_PER_DAY, DAY);
}

export async function checkCliUploadLimits(ipHash: string): Promise<RateLimitResult> {
  const global = await consume(windowKey("global-hour", HOUR), RATE_GLOBAL_PER_HOUR, HOUR);
  if (!global.ok) return global;

  const cli = await consume(windowKey(`cli-hour/${ipHash}`, HOUR), RATE_CLI_PER_HOUR, HOUR);
  if (!cli.ok) return cli;

  return consume(windowKey(`ip-day/${ipHash}`, DAY), RATE_IP_PER_DAY, DAY);
}

export async function checkAdminLoginLimits(ipHash: string): Promise<RateLimitResult> {
  return consume(windowKey(`login-15m/${ipHash}`, FIFTEEN_MINUTES), RATE_LOGIN_PER_15M, FIFTEEN_MINUTES);
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
  };
}

