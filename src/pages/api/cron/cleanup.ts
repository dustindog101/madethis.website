import type { APIRoute } from "astro";
import { json } from "../../../lib/http";
import { storage } from "../../../lib/storage";
import { SITE_PREFIX, TMP_PREFIX } from "../../../lib/limits";
import { readSiteMeta, isExpired, deleteSite } from "../../../lib/site";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${secret}`) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }
  }

  const now = Date.now();
  let expiredSitesRemoved = 0;
  let tmpRemoved = 0;
  const errors: string[] = [];

  const siteRows = await storage.list(SITE_PREFIX);
  const bySlug = new Map<string, string>();
  for (const pathname of siteRows) {
    const match = /^sites\/([a-z2-9]{6,16})\.meta\.json$/.exec(pathname);
    if (match) bySlug.set(match[1], pathname);
  }

  await Promise.all(
    [...bySlug.entries()].map(async ([slug]) => {
      try {
        const meta = await readSiteMeta(slug);
        if (meta && isExpired(meta)) {
          await deleteSite(slug);
          expiredSitesRemoved++;
        }
      } catch {
        errors.push(slug);
      }
    }),
  );

  const tmpRows = await storage.list(TMP_PREFIX);
  await Promise.all(
    tmpRows.map(async (pathname) => {
      try {
        await storage.delete(pathname);
        tmpRemoved++;
      } catch {
        errors.push(pathname);
      }
    }),
  );

  return json({
    ok: true,
    expiredSitesRemoved: expiredSitesRemoved,
    tmpChunksRemoved: tmpRemoved,
    errors,
  });
};