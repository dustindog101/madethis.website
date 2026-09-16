import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeGraceDisplacement,
  normalizeSiteMetaFields,
  promisedExpiresAt,
  siteCacheMaxAge,
  type GraceSiteInput,
} from "./grace.js";
import { MAX_GRACE_TTL_SECONDS, STANDARD_24H_TTL_SECONDS } from "./limits.js";

const HOUR = 3600_000;
const DAY = 86_400_000;

function site(partial: Partial<GraceSiteInput> & Pick<GraceSiteInput, "slug" | "createdAt">): GraceSiteInput {
  const ttlSeconds = partial.ttlSeconds ?? 86400;
  const expiresAt =
    partial.expiresAt ?? partial.createdAt + (ttlSeconds === 86400 ? MAX_GRACE_TTL_SECONDS : ttlSeconds) * 1000;
  return {
    slug: partial.slug,
    createdAt: partial.createdAt,
    expiresAt,
    ttlSeconds,
    graceActive: partial.graceActive ?? ttlSeconds === 86400,
  };
}

test("no displacement when fewer than four live 24h sites", () => {
  const now = 1_700_000_000_000;
  const result = computeGraceDisplacement(
    [
      site({ slug: "new22222", createdAt: now }),
      site({ slug: "old22222", createdAt: now - HOUR }),
    ],
    now,
  );
  assert.deepEqual(result.displaced, []);
});

test("demotes the fourth-newest 24h site still inside its first 24h back to 24h", () => {
  const now = 1_700_000_000_000;
  const fourthCreated = now - 2 * HOUR;
  const result = computeGraceDisplacement(
    [
      site({ slug: "n1111111", createdAt: now }),
      site({ slug: "n2222222", createdAt: now - 10 * 60_000 }),
      site({ slug: "n3333333", createdAt: now - 20 * 60_000 }),
      site({ slug: "n4444444", createdAt: fourthCreated }),
    ],
    now,
  );
  assert.deepEqual(result.displaced, [
    {
      slug: "n4444444",
      expiresAt: fourthCreated + STANDARD_24H_TTL_SECONDS * 1000,
      graceActive: false,
    },
  ]);
});

test("immediately expires a fourth-place site that has already passed 24h", () => {
  const now = 1_700_000_000_000;
  const fourthCreated = now - 30 * HOUR;
  const result = computeGraceDisplacement(
    [
      site({ slug: "n1111111", createdAt: now }),
      site({ slug: "n2222222", createdAt: now - HOUR }),
      site({ slug: "n3333333", createdAt: now - 2 * HOUR }),
      site({
        slug: "n4444444",
        createdAt: fourthCreated,
        expiresAt: fourthCreated + MAX_GRACE_TTL_SECONDS * 1000,
      }),
    ],
    now,
  );
  assert.deepEqual(result.displaced, [{ slug: "n4444444", expiresAt: now, graceActive: false }]);
});

test("keeps a 30h-old site when it is still in the top 3", () => {
  const now = 1_700_000_000_000;
  const veteran = now - 30 * HOUR;
  const result = computeGraceDisplacement(
    [
      site({ slug: "n1111111", createdAt: now }),
      site({ slug: "n2222222", createdAt: now - HOUR }),
      site({
        slug: "n3333333",
        createdAt: veteran,
        expiresAt: veteran + MAX_GRACE_TTL_SECONDS * 1000,
      }),
    ],
    now,
  );
  assert.deepEqual(result.displaced, []);
});

test("ignores 1h ttl sites so they do not occupy grace slots", () => {
  const now = 1_700_000_000_000;
  const fourthCreated = now - HOUR;
  const result = computeGraceDisplacement(
    [
      site({ slug: "hour1111", createdAt: now + 1, ttlSeconds: 3600, graceActive: false }),
      site({ slug: "n1111111", createdAt: now }),
      site({ slug: "n2222222", createdAt: now - 10 * 60_000 }),
      site({ slug: "n3333333", createdAt: now - 20 * 60_000 }),
      site({ slug: "n4444444", createdAt: fourthCreated }),
    ],
    now,
  );
  assert.equal(result.displaced.length, 1);
  assert.equal(result.displaced[0]?.slug, "n4444444");
});

test("demotes every rank-4+ site that still has extra lifetime", () => {
  const now = 1_700_000_000_000;
  const result = computeGraceDisplacement(
    [
      site({ slug: "n1111111", createdAt: now }),
      site({ slug: "n2222222", createdAt: now - 1 }),
      site({ slug: "n3333333", createdAt: now - 2 }),
      site({ slug: "n4444444", createdAt: now - 3 }),
      site({ slug: "n5555555", createdAt: now - 4 }),
    ],
    now,
  );
  assert.deepEqual(
    result.displaced.map((row) => row.slug),
    ["n4444444", "n5555555"],
  );
  for (const row of result.displaced) {
    assert.equal(row.graceActive, false);
    assert.equal(row.expiresAt, row.slug === "n4444444" ? now - 3 + DAY : now - 4 + DAY);
  }
});

test("does not emit a write for a fourth-place site already at 24h expiry", () => {
  const now = 1_700_000_000_000;
  const fourthCreated = now - 2 * HOUR;
  const result = computeGraceDisplacement(
    [
      site({ slug: "n1111111", createdAt: now }),
      site({ slug: "n2222222", createdAt: now - 10 * 60_000 }),
      site({ slug: "n3333333", createdAt: now - 20 * 60_000 }),
      site({
        slug: "n4444444",
        createdAt: fourthCreated,
        expiresAt: fourthCreated + DAY,
        graceActive: false,
      }),
    ],
    now,
  );
  assert.deepEqual(result.displaced, []);
});

test("skips already-expired rows so logs cannot occupy slots", () => {
  const now = 1_700_000_000_000;
  const result = computeGraceDisplacement(
    [
      site({ slug: "n1111111", createdAt: now }),
      site({ slug: "n2222222", createdAt: now - HOUR }),
      site({ slug: "n3333333", createdAt: now - 2 * HOUR }),
      site({
        slug: "dead2222",
        createdAt: now - 10 * 60_000,
        expiresAt: now - 1,
        graceActive: false,
      }),
    ],
    now,
  );
  assert.deepEqual(result.displaced, []);
});

test("promisedExpiresAt is createdAt plus requested ttl, not grace", () => {
  const createdAt = 1_700_000_000_000;
  assert.equal(promisedExpiresAt({ createdAt, ttlSeconds: 86400 }), createdAt + DAY);
  assert.equal(promisedExpiresAt({ createdAt, ttlSeconds: 3600 }), createdAt + HOUR);
});

test("siteCacheMaxAge caps grace sites at 60s and standard sites at 3600s", () => {
  const now = 1_700_000_000_000;
  assert.equal(
    siteCacheMaxAge(
      { expiresAt: now + 12 * HOUR, graceActive: true },
      now,
    ),
    60,
  );
  assert.equal(
    siteCacheMaxAge(
      { expiresAt: now + 12 * HOUR, graceActive: false },
      now,
    ),
    3600,
  );
  assert.equal(
    siteCacheMaxAge({ expiresAt: now + 30_000, graceActive: true }, now),
    30,
  );
  assert.equal(siteCacheMaxAge({ expiresAt: now - 1, graceActive: false }, now), 0);
});

test("normalizeSiteMetaFields infers ttl and grace from legacy blobs", () => {
  const createdAt = 1_700_000_000_000;
  assert.deepEqual(
    normalizeSiteMetaFields({ slug: "old22222", createdAt, expiresAt: createdAt + HOUR }),
    { ttlSeconds: 3600, graceActive: false },
  );
  assert.deepEqual(
    normalizeSiteMetaFields({ slug: "old22222", createdAt, expiresAt: createdAt + DAY }),
    { ttlSeconds: 86400, graceActive: false },
  );
  assert.deepEqual(
    normalizeSiteMetaFields({
      slug: "new22222",
      createdAt,
      expiresAt: createdAt + MAX_GRACE_TTL_SECONDS * 1000,
      ttlSeconds: 86400,
      graceActive: true,
    }),
    { ttlSeconds: 86400, graceActive: true },
  );
});
