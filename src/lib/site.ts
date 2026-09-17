import { storage } from "./storage.js";
import { siteZipPath, siteMetaPath, SITE_PREFIX, ONE_HOUR_TTL_SECONDS, SEVEN_DAYS_TTL_SECONDS, UPLOAD_TTL_OPTIONS } from "./limits";
import { validSlug } from "./ids";
import type { ZipEntry } from "./zip";
import { deleteUploadLogEntry, updateUploadLogExpiry, updateUploadLogVisit } from "./logs";
import {
  internalExpiresAt,
  isStandard24hTtl,
  normalizeSiteMetaFields,
  type UploadTtlSeconds,
} from "./grace.js";

/** Minimum gap between visit-counter blob writes per slug (free-tier safe). */
export const VISIT_WRITE_THROTTLE_MS = 5 * 60 * 1000;

export interface SiteMeta {
  slug: string;
  createdAt: number;
  expiresAt: number;
  ttlSeconds: UploadTtlSeconds;
  graceActive: boolean;
  bytes: number;
  files: number;
  homepage: string | null;
  ip?: string;
  source?: "website" | "cli" | "api";
  userAgent?: string;
  country?: string;
  city?: string;
  region?: string;
  /** Best-effort view counter (throttled writes, see recordSiteVisit). */
  visits?: number;
  lastVisitAt?: number | null;
}

export function resolveHomepage(entries: ZipEntry[]): string | null {
  if (entries.length === 0) return null;
  if (entries.length === 1) return entries[0].pathname;
  const roots = entries.filter((e) => !e.pathname.includes("/"));
  const byName = (name: string) => roots.find((e) => e.pathname === name);
  if (byName("index.html")) return "index.html";
  if (byName("index.htm")) return "index.htm";
  if (byName("index.md")) return "index.md";
  if (roots.length > 0) return roots[0].pathname;
  return entries[0].pathname;
}

export interface CreateSiteOptions {
  ip?: string;
  source?: "website" | "cli" | "api";
  userAgent?: string;
  country?: string;
  city?: string;
  region?: string;
}

function asUploadTtl(ttlSeconds: number): UploadTtlSeconds {
  if (ttlSeconds === ONE_HOUR_TTL_SECONDS) return ONE_HOUR_TTL_SECONDS;
  if (ttlSeconds === SEVEN_DAYS_TTL_SECONDS) return SEVEN_DAYS_TTL_SECONDS;
  return 86400;
}

export async function createSite(
  slug: string,
  zipBytes: Uint8Array,
  ttlSeconds: number,
  files: number,
  homepage: string | null,
  options?: CreateSiteOptions,
): Promise<SiteMeta> {
  if (!validSlug(slug)) throw new Error("invalid slug");
  const now = Date.now();
  const ttl = asUploadTtl(ttlSeconds);
  const graceActive = isStandard24hTtl(ttl);
  const meta: SiteMeta = {
    slug,
    createdAt: now,
    expiresAt: internalExpiresAt(now, ttl),
    ttlSeconds: ttl,
    graceActive,
    bytes: zipBytes.length,
    files,
    homepage,
    ip: options?.ip,
    source: options?.source ?? "website",
    userAgent: options?.userAgent,
    country: options?.country,
    city: options?.city,
    region: options?.region,
    visits: 0,
    lastVisitAt: null,
  };
  const metaBytes = new TextEncoder().encode(JSON.stringify(meta));
  await storage.put(siteMetaPath(slug), metaBytes, "application/json");
  await storage.put(siteZipPath(slug), zipBytes, "application/zip");
  return meta;
}

export async function readSiteMeta(slug: string): Promise<SiteMeta | null> {
  if (!validSlug(slug)) return null;
  const raw = await storage.get(siteMetaPath(slug));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(raw)) as Partial<SiteMeta>;
    if (typeof parsed.expiresAt !== "number" || typeof parsed.createdAt !== "number" || parsed.slug !== slug) {
      return null;
    }
    const fields = normalizeSiteMetaFields({
      slug,
      createdAt: parsed.createdAt,
      expiresAt: parsed.expiresAt,
      ttlSeconds: parsed.ttlSeconds,
      graceActive: parsed.graceActive,
    });
    const visits = typeof parsed.visits === "number" && parsed.visits >= 0 ? Math.floor(parsed.visits) : 0;
    const lastVisitAt = typeof parsed.lastVisitAt === "number" ? parsed.lastVisitAt : null;
    return { ...parsed, slug, createdAt: parsed.createdAt, expiresAt: parsed.expiresAt, ...fields, visits, lastVisitAt } as SiteMeta;
  } catch {
    return null;
  }
}

export async function readSiteZip(slug: string): Promise<Uint8Array | null> {
  if (!validSlug(slug)) return null;
  return storage.get(siteZipPath(slug));
}

export function isExpired(meta: SiteMeta, now = Date.now()): boolean {
  return now > meta.expiresAt;
}

export async function listLive24hSiteMetas(now = Date.now()): Promise<SiteMeta[]> {
  const siteRows = await storage.list(SITE_PREFIX);
  const slugs: string[] = [];
  for (const pathname of siteRows) {
    const match = /^sites\/([a-z2-9]{6,16})\.meta\.json$/.exec(pathname);
    if (match) slugs.push(match[1]);
  }

  const metas: SiteMeta[] = [];
  await Promise.all(
    slugs.map(async (slug) => {
      const meta = await readSiteMeta(slug);
      if (!meta) return;
      if (!isStandard24hTtl(meta.ttlSeconds)) return;
      if (isExpired(meta, now)) return;
      metas.push(meta);
    }),
  );
  return metas;
}

export async function updateSiteExpiry(slug: string, expiresAt: number, graceActive: boolean): Promise<void> {
  const meta = await readSiteMeta(slug);
  if (!meta) return;
  const next: SiteMeta = { ...meta, expiresAt, graceActive };
  await storage.put(siteMetaPath(slug), new TextEncoder().encode(JSON.stringify(next)), "application/json", {
    allowOverwrite: true,
  });
}

/**
 * Best-effort visit counter. Throttled to ≤1 blob write per 5 min per slug
 * so popular sites don't burn free-tier write ops. Never throws.
 * Returns the (possibly updated) visit count, or null when the site is gone.
 */
export async function recordSiteVisit(slug: string, now = Date.now()): Promise<number | null> {
  try {
    const meta = await readSiteMeta(slug);
    if (!meta || isExpired(meta, now)) return meta ? (meta.visits ?? 0) : null;
    const visits = meta.visits ?? 0;
    if (meta.lastVisitAt !== null && meta.lastVisitAt !== undefined && now - meta.lastVisitAt < VISIT_WRITE_THROTTLE_MS && visits > 0) {
      return visits;
    }
    const nextVisits = visits + 1;
    const next: SiteMeta = { ...meta, visits: nextVisits, lastVisitAt: now };
    await storage.put(siteMetaPath(slug), new TextEncoder().encode(JSON.stringify(next)), "application/json", {
      allowOverwrite: true,
    });
    // Mirror into the admin log index on the same throttled window (best-effort).
    await updateUploadLogVisit(slug, nextVisits, now).catch(() => {});
    return nextVisits;
  } catch {
    return null;
  }
}

/**
 * Extend (or shorten) a site's lifetime from *now*. Validates TTL against
 * UPLOAD_TTL_OPTIONS. Revives an expired-but-not-yet-cleaned site.
 * Updates both the site meta and the admin log index. Throws on bad input.
 */
export async function extendSiteTtl(slug: string, ttlSeconds: number, now = Date.now()): Promise<SiteMeta> {
  if (!validSlug(slug)) throw new Error("invalid_slug");
  if (!UPLOAD_TTL_OPTIONS.includes(ttlSeconds as (typeof UPLOAD_TTL_OPTIONS)[number])) {
    throw new Error("invalid_ttl");
  }
  const meta = await readSiteMeta(slug);
  if (!meta) throw new Error("not_found");
  const ttl = ttlSeconds as UploadTtlSeconds;
  const expiresAt = internalExpiresAt(now, ttl);
  const graceActive = isStandard24hTtl(ttl);
  const next: SiteMeta = { ...meta, ttlSeconds: ttl, expiresAt, graceActive };
  await storage.put(siteMetaPath(slug), new TextEncoder().encode(JSON.stringify(next)), "application/json", {
    allowOverwrite: true,
  });
  await updateUploadLogExpiry(slug, expiresAt, graceActive).catch(() => {});
  return next;
}

/**
 * Deletes the zip first, then the meta. Removing the zip frees the storage space
 * immediately, while the lightweight log record remains in config/upload-logs.json
 * so admin upload history is preserved.
 */
export async function deleteSite(slug: string, removeLog = false): Promise<void> {
  await storage.delete(siteZipPath(slug));
  await storage.delete(siteMetaPath(slug));
  if (removeLog) {
    await deleteUploadLogEntry(slug).catch(() => {});
  }
}
