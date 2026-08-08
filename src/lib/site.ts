import { storage } from "./storage.js";
import { siteZipPath, siteMetaPath } from "./limits";
import { validSlug } from "./ids";
import type { ZipEntry } from "./zip";

export interface SiteMeta {
  slug: string;
  createdAt: number;
  expiresAt: number;
  bytes: number;
  files: number;
  homepage: string | null;
}

export function resolveHomepage(entries: ZipEntry[]): string | null {
  const roots = entries.filter((e) => !e.pathname.includes("/"));
  const byName = (name: string) => roots.find((e) => e.pathname === name);
  if (byName("index.html")) return "index.html";
  if (byName("index.htm")) return "index.htm";
  if (roots.length > 0) return roots[0].pathname;
  return null;
}

export async function createSite(
  slug: string,
  zipBytes: Uint8Array,
  ttlSeconds: number,
  files: number,
  homepage: string | null,
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
 * Deletes the zip first, then the meta — the meta is the "index" of the
 * site, so removing it last keeps read paths from ever racing into a
 * half-deleted state.
 */
export async function deleteSite(slug: string): Promise<void> {
  await storage.delete(siteZipPath(slug));
  await storage.delete(siteMetaPath(slug));
}