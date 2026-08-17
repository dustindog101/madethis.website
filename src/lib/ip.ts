import { createHash } from "node:crypto";

export type UploadSource = "website" | "cli" | "api";

export interface ClientContext {
  ip: string;
  source: UploadSource;
  country?: string;
  city?: string;
  region?: string;
  userAgent?: string;
}

function cleanIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let ip = raw.trim();
  if (!ip) return null;
  // If multiple IPs present (e.g. client, proxy1, proxy2), take the client IP
  if (ip.includes(",")) {
    ip = ip.split(",")[0].trim();
  }
  // Strip IPv6 brackets and port if present: [2001:db8::1]:8080 -> 2001:db8::1
  if (ip.startsWith("[") && ip.includes("]")) {
    const end = ip.indexOf("]");
    ip = ip.slice(1, end);
  } else if (ip.includes(":") && ip.split(":").length === 2 && !ip.includes("::")) {
    // IPv4 with port: 192.168.1.1:8080 -> 192.168.1.1
    ip = ip.split(":")[0].trim();
  }
  if (ip && ip.length <= 64) {
    return ip;
  }
  return null;
}

/** Robust multi-proxy client IP extraction (Vercel, Cloudflare, Fastly, AWS, Nginx, etc.). */
export function clientIp(request: Request): string {
  const headers = request.headers;

  // 1. Direct trusted edge headers
  const cfIp = cleanIp(headers.get("cf-connecting-ip"));
  if (cfIp && cfIp !== "127.0.0.1" && cfIp !== "::1") return cfIp;

  const vercelForwarded = cleanIp(headers.get("x-vercel-forwarded-for"));
  if (vercelForwarded && vercelForwarded !== "127.0.0.1" && vercelForwarded !== "::1") return vercelForwarded;

  const realIp = cleanIp(headers.get("x-real-ip"));
  if (realIp && realIp !== "127.0.0.1" && realIp !== "::1") return realIp;

  const trueClientIp = cleanIp(headers.get("true-client-ip"));
  if (trueClientIp && trueClientIp !== "127.0.0.1" && trueClientIp !== "::1") return trueClientIp;

  const fastlyIp = cleanIp(headers.get("fastly-client-ip"));
  if (fastlyIp && fastlyIp !== "127.0.0.1" && fastlyIp !== "::1") return fastlyIp;

  const clientIpHeader = cleanIp(headers.get("x-client-ip") || headers.get("x-cluster-client-ip"));
  if (clientIpHeader && clientIpHeader !== "127.0.0.1" && clientIpHeader !== "::1") return clientIpHeader;

  // 2. Standard X-Forwarded-For (check for first non-loopback IP)
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((p) => cleanIp(p)).filter(Boolean) as string[];
    for (const part of parts) {
      if (part !== "127.0.0.1" && part !== "::1" && part !== "localhost") {
        return part;
      }
    }
    if (parts.length > 0) return parts[0];
  }

  // 3. RFC 7239 Forwarded header (for=...)
  const rfcForwarded = headers.get("forwarded");
  if (rfcForwarded) {
    const match = /for="?([^";,\s]+)"?/i.exec(rfcForwarded);
    if (match) {
      const ip = cleanIp(match[1]);
      if (ip && ip !== "127.0.0.1" && ip !== "::1") return ip;
    }
  }

  return cfIp || vercelForwarded || realIp || trueClientIp || fastlyIp || clientIpHeader || "127.0.0.1";
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
export function detectUploadSource(request: Request, endpoint: "cli" | "finalize" | "init" = "finalize"): UploadSource {
  const auth = request.headers.get("authorization") ?? "";
  const apiKey = request.headers.get("x-api-key") ?? "";
  const ua = (request.headers.get("user-agent") ?? "").toLowerCase();
  const fetchMode = request.headers.get("sec-fetch-mode") ?? "";
  const siteHeader = request.headers.get("sec-fetch-site") ?? "";
  const origin = request.headers.get("origin") ?? "";

  // If endpoint is CLI or has explicit API Bearer authentication
  if (auth.startsWith("Bearer ") || apiKey) {
    if (ua.includes("curl") || ua.includes("madethis") || ua.includes("wget") || ua.includes("powershell")) {
      return "cli";
    }
    return "api";
  }

  if (ua.includes("curl") || ua.includes("wget") || ua.includes("madethis-cli") || ua.includes("powershell")) {
    return "cli";
  }

  if (
    ua.includes("python") ||
    ua.includes("go-http-client") ||
    ua.includes("postman") ||
    ua.includes("insomnia") ||
    ua.includes("axios") ||
    ua.includes("undici") ||
    ua.includes("node-fetch")
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

/** Extract full IP, origin, and geolocation context for request logging. */
export function extractClientContext(
  request: Request,
  endpoint: "cli" | "finalize" | "init" = "init",
): ClientContext {
  const ip = clientIp(request);
  const source = detectUploadSource(request, endpoint);
  const headers = request.headers;

  const country =
    headers.get("x-vercel-ip-country")?.trim() ||
    headers.get("cf-ipcountry")?.trim() ||
    undefined;

  const city =
    headers.get("x-vercel-ip-city")?.trim() ||
    headers.get("cf-ipcity")?.trim() ||
    undefined;

  const region =
    headers.get("x-vercel-ip-country-region")?.trim() ||
    headers.get("cf-region")?.trim() ||
    undefined;

  const userAgent = headers.get("user-agent")?.trim() || undefined;

  return {
    ip,
    source,
    country,
    city,
    region,
    userAgent,
  };
}

