import { storage } from "./storage.js";
import { siteZipPath, siteMetaPath } from "./limits";
import { validSlug } from "./ids";
import type { ZipEntry } from "./zip";
import { deleteUploadLogEntry } from "./logs";

export interface SiteMeta {
  slug: string;
  createdAt: number;
  expiresAt: number;
  bytes: number;
  files: number;
  homepage: string | null;
  ip?: string;
  source?: "website" | "cli" | "api";
  userAgent?: string;
  country?: string;
  city?: string;
  region?: string;
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
  const meta: SiteMeta = {
    slug,
    createdAt: now,
    expiresAt: now + ttlSeconds * 1000,
    bytes: zipBytes.length,
    files,
    homepage,
    ip: options?.ip,
    source: options?.source ?? "website",
    userAgent: options?.userAgent,
    country: options?.country,
    city: options?.city,
    region: options?.region,
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
    if (typeof parsed.expiresAt !== "number" || parsed.slug !== slug) return null;
    return parsed as SiteMeta;
  } catch {
    return null;
  }
}

export async function readSiteZip(slug: string): Promise<Uint8Array | null> {
  if (!validSlug(slug)) return null;
  return storage.get(siteZipPath(slug));
}

export function isExpired(meta: SiteMeta): boolean {
  return Date.now() > meta.expiresAt;
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