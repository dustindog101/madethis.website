import type { APIRoute } from "astro";
import { json, error } from "../../../lib/http";
import { newUploadId } from "../../../lib/ids";
import { MAX_CHUNK_BYTES, MAX_SITE_ZIP_BYTES, UPLOAD_TTL_OPTIONS } from "../../../lib/limits";

export const prerender = false;

interface InitBody {
  totalBytes?: number;
  ttlSeconds?: number;
}

async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

export const POST: APIRoute = async ({ request }) => {
  const body = await readJson<InitBody>(request);
  if (!body) return error(400, "invalid_json");
  if (typeof body.totalBytes !== "number" || !Number.isFinite(body.totalBytes)) {
    return error(400, "missing_total_bytes");
  }
  if (body.totalBytes <= 0 || body.totalBytes > MAX_SITE_ZIP_BYTES) {
    return error(400, "size_out_of_range", `ZIP must be between 1 byte and ${MAX_SITE_ZIP_BYTES} bytes`);
  }
  const ttlSeconds = body.ttlSeconds ?? UPLOAD_TTL_OPTIONS[1];
  if (!UPLOAD_TTL_OPTIONS.includes(ttlSeconds)) {
    return error(400, "invalid_ttl");
  }
  return json({
    uploadId: newUploadId(),
    chunkSize: MAX_CHUNK_BYTES,
  });
};