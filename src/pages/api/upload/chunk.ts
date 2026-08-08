import type { APIRoute } from "astro";
import { json, error } from "../../../lib/http";
import { validUploadId } from "../../../lib/ids";
import { MAX_CHUNK_BYTES, tmpChunkPath } from "../../../lib/limits";
import { storage } from "../../../lib/storage";

export const prerender = false;

const MAX_CHUNKS_PER_UPLOAD = 64;

export const POST: APIRoute = async ({ request }) => {
  const uploadId = request.headers.get("x-upload-id") ?? "";
  const rawIndex = request.headers.get("x-chunk-index") ?? "";
  if (!validUploadId(uploadId)) return error(400, "invalid_upload_id");
  if (!/^\d+$/.test(rawIndex)) return error(400, "invalid_chunk_index");
  const index = Number(rawIndex);
  if (index < 0 || index >= MAX_CHUNKS_PER_UPLOAD) return error(400, "chunk_out_of_range");

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/octet-stream")) return error(415, "unsupported_media_type");

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0) return error(400, "empty_chunk");
  if (bytes.byteLength > MAX_CHUNK_BYTES) return error(413, "chunk_too_large");

  try {
    await storage.put(tmpChunkPath(uploadId, index), bytes, "application/octet-stream");
  } catch {
    return error(503, "storage_unavailable", "Upload storage is not configured or temporarily unavailable.");
  }
  return json({ ok: true, index }, 201);
};