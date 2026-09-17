import {
  MAX_GRACE_TTL_SECONDS,
  ONE_HOUR_TTL_SECONDS,
  STANDARD_24H_TTL_SECONDS,
  SEVEN_DAYS_TTL_SECONDS,
  TOP_RECENT_GRACE_COUNT,
} from "./limits.js";

export type UploadTtlSeconds = 3600 | 86400 | 604800;

export interface GraceSiteInput {
  slug: string;
  createdAt: number;
  expiresAt: number;
  ttlSeconds: number;
  graceActive?: boolean;
}

export interface DisplacedSite {
  slug: string;
  expiresAt: number;
  graceActive: false;
}

export interface DisplacementResult {
  displaced: DisplacedSite[];
}

export function isOneHourTtl(ttlSeconds: number): boolean {
  return ttlSeconds === ONE_HOUR_TTL_SECONDS;
}

export function isStandard24hTtl(ttlSeconds: number): boolean {
  return ttlSeconds === STANDARD_24H_TTL_SECONDS;
}

export function isSevenDaysTtl(ttlSeconds: number): boolean {
  return ttlSeconds === SEVEN_DAYS_TTL_SECONDS;
}

export function internalExpiresAt(createdAt: number, ttlSeconds: number): number {
  if (isOneHourTtl(ttlSeconds)) return createdAt + ONE_HOUR_TTL_SECONDS * 1000;
  if (isSevenDaysTtl(ttlSeconds)) return createdAt + SEVEN_DAYS_TTL_SECONDS * 1000;
  return createdAt + MAX_GRACE_TTL_SECONDS * 1000;
}

export function promisedExpiresAt(meta: { createdAt: number; ttlSeconds: number }): number {
  return meta.createdAt + meta.ttlSeconds * 1000;
}

export function siteCacheMaxAge(
  meta: { expiresAt: number; graceActive?: boolean },
  now: number = Date.now(),
): number {
  const remaining = Math.max(0, Math.floor((meta.expiresAt - now) / 1000));
  if (remaining === 0) return 0;
  if (meta.graceActive) return Math.min(60, remaining);
  return Math.min(3600, remaining);
}

export function normalizeSiteMetaFields(parsed: {
  slug: string;
  createdAt: number;
  expiresAt: number;
  ttlSeconds?: number;
  graceActive?: boolean;
}): { ttlSeconds: UploadTtlSeconds; graceActive: boolean } {
  const ttlSeconds: UploadTtlSeconds =
    parsed.ttlSeconds === ONE_HOUR_TTL_SECONDS
      ? ONE_HOUR_TTL_SECONDS
      : parsed.ttlSeconds === STANDARD_24H_TTL_SECONDS
        ? STANDARD_24H_TTL_SECONDS
        : parsed.ttlSeconds === SEVEN_DAYS_TTL_SECONDS
          ? SEVEN_DAYS_TTL_SECONDS
          : parsed.expiresAt - parsed.createdAt <= ONE_HOUR_TTL_SECONDS * 1000 + 1000
            ? ONE_HOUR_TTL_SECONDS
            : parsed.expiresAt - parsed.createdAt > STANDARD_24H_TTL_SECONDS * 1000 + 1000
              ? (parsed.expiresAt - parsed.createdAt >= SEVEN_DAYS_TTL_SECONDS * 1000 - 60000 ? SEVEN_DAYS_TTL_SECONDS : STANDARD_24H_TTL_SECONDS)
              : STANDARD_24H_TTL_SECONDS;

  const graceActive =
    typeof parsed.graceActive === "boolean"
      ? parsed.graceActive
      : ttlSeconds === STANDARD_24H_TTL_SECONDS &&
        parsed.expiresAt > parsed.createdAt + STANDARD_24H_TTL_SECONDS * 1000;

  return { ttlSeconds, graceActive };
}

function standardEnd(createdAt: number): number {
  return createdAt + STANDARD_24H_TTL_SECONDS * 1000;
}

function hasExtraLifetime(meta: GraceSiteInput): boolean {
  return meta.expiresAt > standardEnd(meta.createdAt);
}

export function computeGraceDisplacement(liveMetas: GraceSiteInput[], now: number): DisplacementResult {
  const ranked = liveMetas
    .filter((meta) => isStandard24hTtl(meta.ttlSeconds) && now <= meta.expiresAt)
    .sort((a, b) => b.createdAt - a.createdAt || a.slug.localeCompare(b.slug));

  const displaced: DisplacedSite[] = [];
  for (const meta of ranked.slice(TOP_RECENT_GRACE_COUNT)) {
    if (!hasExtraLifetime(meta)) continue;
    const cutoff = standardEnd(meta.createdAt);
    displaced.push({
      slug: meta.slug,
      expiresAt: now > cutoff ? now : cutoff,
      graceActive: false,
    });
  }
  return { displaced };
}
