import { createHash } from "node:crypto";

export type UploadSource = "website" | "cli" | "api";

/** Robust multi-proxy client IP extraction (Vercel, Cloudflare, Fastly, Reverse Proxies). */
export function clientIp(request: Request): string {
  const headers = request.headers;

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first && first !== "127.0.0.1" && first !== "::1") return first.slice(0, 64);
  }

  const cfIp = headers.get("cf-connecting-ip")?.trim();
  if (cfIp) return cfIp.slice(0, 64);

  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp.slice(0, 64);

  const fastlyIp = headers.get("fastly-client-ip")?.trim();
  if (fastlyIp) return fastlyIp.slice(0, 64);

  const trueClientIp = headers.get("true-client-ip")?.trim();
  if (trueClientIp) return trueClientIp.slice(0, 64);

  const clientIpHeader = headers.get("x-client-ip")?.trim();
  if (clientIpHeader) return clientIpHeader.slice(0, 64);

  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }

  return "127.0.0.1";
}

export function hashIp(ip: string): string {
  const salt =
    process.env.RATE_LIMIT_SALT ??
    process.env.SESSION_SECRET ??
    process.env.ADMIN_PASSWORD ??
    "madethis-default-salt";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

/** Automatically detect upload origin (website dropzone vs CLI tool vs API). */
export function detectUploadSource(request: Request, endpoint: "cli" | "finalize"): UploadSource {
  const auth = request.headers.get("authorization") ?? "";
  const apiKey = request.headers.get("x-api-key") ?? "";
  const ua = (request.headers.get("user-agent") ?? "").toLowerCase();
  const fetchMode = request.headers.get("sec-fetch-mode") ?? "";
  const siteHeader = request.headers.get("sec-fetch-site") ?? "";
  const origin = request.headers.get("origin") ?? "";

  // If endpoint is CLI or has explicit API Bearer authentication
  if (auth.startsWith("Bearer ") || apiKey) {
    if (ua.includes("curl") || ua.includes("madethis") || ua.includes("wget")) {
      return "cli";
    }
    return "api";
  }

  if (ua.includes("curl") || ua.includes("wget") || ua.includes("madethis-cli")) {
    return "cli";
  }

  if (
    ua.includes("python") ||
    ua.includes("go-http-client") ||
    ua.includes("postman") ||
    ua.includes("insomnia") ||
    ua.includes("axios")
  ) {
    return "api";
  }

  if (endpoint === "cli") {
    return "cli";
  }

  // Browser fetch / dropzone requests from website
  if (fetchMode || siteHeader === "same-origin" || siteHeader === "same-site" || origin) {
    return "website";
  }

  return "website";
}
