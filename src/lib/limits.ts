export const MAX_CHUNK_BYTES = 3 * 1024 * 1024;
export const MAX_SITE_ZIP_BYTES = 128 * 1024 * 1024;
export const MAX_FILES_PER_SITE = 500;
export const UPLOAD_TTL_OPTIONS = [3600, 86400] as const;
export const DEFAULT_TTL_SECONDS = 86400;
export const ONE_HOUR_TTL_SECONDS = 3600;
export const STANDARD_24H_TTL_SECONDS = 86400;
export const MAX_GRACE_TTL_SECONDS = 36 * 3600;
export const TOP_RECENT_GRACE_COUNT = 3;
export const TMP_LIFETIME_MS = 1000 * 60 * 60;

/** Abuse prevention — enforced via blob-backed counters. */
export const RATE_GLOBAL_PER_HOUR = 200;
export const RATE_IP_PER_HOUR = 10;
export const RATE_IP_PER_DAY = 50;
export const RATE_CLI_PER_HOUR = 30;

export const SITE_PREFIX = "sites/";
export const TMP_PREFIX = "tmp/";

export function siteZipPath(slug: string): string {
  return `${SITE_PREFIX}${slug}.zip`;
}

export function siteMetaPath(slug: string): string {
  return `${SITE_PREFIX}${slug}.meta.json`;
}

export function tmpChunkPath(uploadId: string, index: number): string {
  return `${TMP_PREFIX}${uploadId}/${index}`;
}

export function tmpUploadMetaPath(uploadId: string): string {
  return `${TMP_PREFIX}${uploadId}/meta.json`;
}