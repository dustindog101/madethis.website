import { createHash } from "node:crypto";
import type { APIRoute } from "astro";
import { json, error } from "../../../lib/http";
import { validUploadId } from "../../../lib/ids";
import {
  MAX_CHUNK_BYTES,
  MAX_SITE_ZIP_BYTES,
  UPLOAD_TTL_OPTIONS,
  tmpChunkPath,
} from "../../../lib/limits";
import { storage, storageReady } from "../../../lib/storage";
import { publishSiteFromZip } from "../../../lib/publish";

import { clientIp } from "../../../lib/ip";

export const prerender = false;

interface FinalizeBody {
  uploadId?: string;
  totalChunks?: number;
  ttlSeconds?: number;
  sha256?: string;
}

const MAX_TOTAL_CHUNKS = 64;

export const POST: APIRoute = async ({ request }) => {
  if (!storageReady()) {
    return error(503, "storage_unavailable", "Upload storage is not configured.");
  }

  let body: FinalizeBody;
  try {
    body = (await request.json()) as FinalizeBody;
  } catch {
    return error(400, "invalid_json");
  }

  if (!body.uploadId || !validUploadId(body.uploadId)) return error(400, "invalid_upload_id");
  const totalChunks = body.totalChunks ?? 0;
  if (!Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > MAX_TOTAL_CHUNKS) {
    return error(400, "invalid_chunk_count");
  }
  const ttlSeconds = body.ttlSeconds ?? UPLOAD_TTL_OPTIONS[1];
  if (!(UPLOAD_TTL_OPTIONS as readonly number[]).includes(ttlSeconds)) return error(400, "invalid_ttl");

  const expectedSha = body.sha256;
  if (typeof expectedSha !== "string" || !/^[a-f0-9]{64}$/.test(expectedSha)) {
    return error(400, "invalid_sha256");
  }

  const parts: Uint8Array[] = [];
  let totalBytes = 0;
  for (let i = 0; i < totalChunks; i++) {
    const chunk = await storage.get(tmpChunkPath(body.uploadId, i));
    if (!chunk) return error(409, "missing_chunk", `Chunk ${i} was not uploaded`);
    if (chunk.byteLength === 0 || chunk.byteLength > MAX_CHUNK_BYTES) return error(409, "invalid_chunk");
    totalBytes += chunk.byteLength;
    if (totalBytes > MAX_SITE_ZIP_BYTES) return error(413, "site_too_large");
    parts.push(chunk);
  }

  const zipBytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const part of parts) {
    zipBytes.set(part, offset);
    offset += part.byteLength;
  }

  const hash = createHash("sha256").update(zipBytes).digest("hex");
  if (hash !== expectedSha) {
    await cleanupChunks(body.uploadId, totalChunks);
    return error(422, "checksum_mismatch");
  }

  const rawIp = clientIp(request);
  const country = request.headers.get("x-vercel-ip-country") ?? undefined;
  const city = request.headers.get("x-vercel-ip-city") ?? undefined;
  const userAgent = request.headers.get("user-agent") ?? undefined;

  try {
    const published = await publishSiteFromZip(zipBytes, ttlSeconds, {
      ip: rawIp,
      source: "website",
      country,
      city,
      userAgent,
    });
    await cleanupChunks(body.uploadId, totalChunks);
    return json({
      ok: true,
      slug: published.slug,
      url: published.url,
      expiresAt: published.expiresAt,
      files: published.files,
      homepage: published.homepage,
    });
  } catch (err) {
    await cleanupChunks(body.uploadId, totalChunks);
    const message = err instanceof Error ? err.message : "publish_failed";
    if (message === "not_a_zip") {
      return error(422, "not_a_zip", "That file isn't a readable ZIP archive.");
    }
    if (message === "empty_site") {
      return error(422, "empty_site", "The archive contains no files.");
    }
    if (message === "too_many_files") {
      return error(422, "too_many_files", "Sites are limited to 500 files.");
    }
    if (message === "site_too_large") {
      return error(413, "site_too_large");
    }
    if (message === "no_slug_available") {
      return error(503, "no_slug_available");
    }
    return error(503, "publish_failed");
  }
};

async function cleanupChunks(uploadId: string, totalChunks: number): Promise<void> {
  await Promise.allSettled(
    Array.from({ length: totalChunks }, (_, i) => storage.delete(tmpChunkPath(uploadId, i))),
  );
}
