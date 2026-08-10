import { newSlug } from "./ids.js";
import { MAX_FILES_PER_SITE, MAX_SITE_ZIP_BYTES } from "./limits.js";
import { readZipEntries } from "./zip.js";
import { createSite, readSiteMeta, resolveHomepage, type CreateSiteOptions } from "./site.js";
import { recordUploadLog } from "./logs.js";

export interface PublishedSite {
  slug: string;
  url: string;
  expiresAt: number;
  files: number;
  homepage: string | null;
}

export async function publishSiteFromZip(
  zipBytes: Uint8Array,
  ttlSeconds: number,
  options?: CreateSiteOptions,
): Promise<PublishedSite> {
  if (zipBytes.byteLength === 0 || zipBytes.byteLength > MAX_SITE_ZIP_BYTES) {
    throw new Error("site_too_large");
  }

  const entries = readZipEntries(zipBytes, MAX_FILES_PER_SITE);
  if (!entries) throw new Error("not_a_zip");
  if (entries.length === 0) throw new Error("empty_site");
  if (entries.length > MAX_FILES_PER_SITE) throw new Error("too_many_files");

  const homepage = resolveHomepage(entries);

  let slug = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = newSlug();
    const existing = await readSiteMeta(candidate);
    if (!existing) {
      slug = candidate;
      break;
    }
  }
  if (!slug) throw new Error("no_slug_available");

  const meta = await createSite(slug, zipBytes, ttlSeconds, entries.length, homepage, options);

  await recordUploadLog({
    id: meta.slug,
    slug: meta.slug,
    createdAt: meta.createdAt,
    expiresAt: meta.expiresAt,
    bytes: meta.bytes,
    files: meta.files,
    homepage: meta.homepage,
    ip: meta.ip ?? "unknown",
    source: meta.source ?? "website",
    userAgent: meta.userAgent,
    country: meta.country,
    city: meta.city,
  }).catch(() => {});

  return {
    slug,
    url: `/s/${slug}/`,
    expiresAt: meta.expiresAt,
    files: meta.files,
    homepage: meta.homepage,
  };
}

