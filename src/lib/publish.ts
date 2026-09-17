import { newSlug, validSlug } from "./ids.js";
import { MAX_FILES_PER_SITE, MAX_SITE_ZIP_BYTES } from "./limits.js";
import { readZipEntries } from "./zip.js";
import {
  createSite,
  listLive24hSiteMetas,
  readSiteMeta,
  resolveHomepage,
  updateSiteExpiry,
  type CreateSiteOptions,
} from "./site.js";
import { recordUploadLog, updateUploadLogExpiry } from "./logs.js";
import { computeGraceDisplacement, isStandard24hTtl, promisedExpiresAt } from "./grace.js";

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
  options?: CreateSiteOptions & { maxZipBytes?: number; slug?: string },
): Promise<PublishedSite> {
  const ceiling = options?.maxZipBytes ?? MAX_SITE_ZIP_BYTES;
  if (zipBytes.byteLength === 0 || zipBytes.byteLength > ceiling) {
    throw new Error("site_too_large");
  }

  const entries = readZipEntries(zipBytes, MAX_FILES_PER_SITE);
  if (!entries) throw new Error("not_a_zip");
  if (entries.length === 0) throw new Error("empty_site");
  if (entries.length > MAX_FILES_PER_SITE) throw new Error("too_many_files");

  const homepage = resolveHomepage(entries);

  let slug = options?.slug && validSlug(options.slug) ? options.slug : "";
  if (slug) {
    // Custom slugs are caller-chosen: never silently overwrite a live site.
    const existing = await readSiteMeta(slug);
    if (existing) throw new Error("slug_taken");
  }
  if (!slug) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = newSlug();
      const existing = await readSiteMeta(candidate);
      if (!existing) {
        slug = candidate;
        break;
      }
    }
  }
  if (!slug) throw new Error("no_slug_available");

  const meta = await createSite(slug, zipBytes, ttlSeconds, entries.length, homepage, options);

  if (isStandard24hTtl(meta.ttlSeconds)) {
    try {
      const live = await listLive24hSiteMetas();
      const { displaced } = computeGraceDisplacement(live, Date.now());
      await Promise.all(
        displaced.map(async (row) => {
          await updateSiteExpiry(row.slug, row.expiresAt, row.graceActive);
          await updateUploadLogExpiry(row.slug, row.expiresAt, row.graceActive).catch(() => {});
        }),
      );
    } catch {
      // Next 24h upload repairs extra grace rows if this pass fails.
    }
  }

  await recordUploadLog({
    id: meta.slug,
    slug: meta.slug,
    createdAt: meta.createdAt,
    expiresAt: meta.expiresAt,
    ttlSeconds: meta.ttlSeconds,
    graceActive: meta.graceActive,
    bytes: meta.bytes,
    files: meta.files,
    homepage: meta.homepage,
    ip: meta.ip ?? "unknown",
    source: meta.source ?? "website",
    userAgent: meta.userAgent,
    country: meta.country,
    city: meta.city,
    region: meta.region,
    visits: 0,
    lastVisitAt: null,
  }).catch(() => {});

  return {
    slug,
    url: `/s/${slug}/`,
    expiresAt: promisedExpiresAt(meta),
    files: meta.files,
    homepage: meta.homepage,
  };
}
