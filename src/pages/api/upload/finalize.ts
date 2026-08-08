import { createHash } from "node:crypto";
import type { APIRoute } from "astro";
import { json, error } from "../../../lib/http";
import { validUploadId, newSlug } from "../../../lib/ids";
import {
  MAX_CHUNK_BYTES,
  MAX_FILES_PER_SITE,
  MAX_SITE_ZIP_BYTES,
  UPLOAD_TTL_OPTIONS,
  tmpChunkPath,
} from "../../../lib/limits";
import { storage } from "../../../lib/storage";
import { readZipEntries } from "../../../lib/zip";
import { createSite, readSiteMeta, resolveHomepage } from "../../../lib/site";

export const prerender = false;

interface FinalizeBody {
  uploadId?: string;
  totalChunks?: number;
  ttlSeconds?: number;
  sha256?: string;
}

const MAX_TOTAL_CHUNKS = 64;

export const POST: APIRoute = async ({ request }) => {
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
  if (!UPLOAD_TTL_OPTIONS.includes(ttlSeconds)) return error(400, "invalid_ttl");

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

  const entries = readZipEntries(zipBytes, MAX_FILES_PER_SITE);
  if (!entries) {
    await cleanupChunks(body.uploadId, totalChunks);
    return error(422, "not_a_zip", "That file isn't a readable ZIP archive.");
  }
  if (entries.length === 0) {
    await cleanupChunks(body.uploadId, totalChunks);
    return error(422, "empty_site", "The archive contains no files.");
  }
  if (entries.length > MAX_FILES_PER_SITE) {
    await cleanupChunks(body.uploadId, totalChunks);
    return error(422, "too_many_files", `Sites are limited to ${MAX_FILES_PER_SITE} files.`);
  }

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
  if (!slug) {
    await cleanupChunks(body.uploadId, totalChunks);
    return error(503, "no_slug_available");
  }

  const meta = await createSite(slug, zipBytes, ttlSeconds, entries.length, homepage);
  await cleanupChunks(body.uploadId, totalChunks);

  return json({
    ok: true,
    slug,
    url: `/s/${slug}/`,
    expiresAt: meta.expiresAt,
    files: meta.files,
    homepage: meta.homepage,
  });
};

async function cleanupChunks(uploadId: string, totalChunks: number): Promise<void> {
  await Promise.allSettled(
    Array.from({ length: totalChunks }, (_, i) => storage.delete(tmpChunkPath(uploadId, i))),
  );
}