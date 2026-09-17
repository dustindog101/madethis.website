import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { createHash } from "node:crypto";
import { zipSync } from "fflate";

const BASE_URL = process.env.MADETHIS_URL || "https://www.madethis.website";
const CHUNK_SIZE = 3 * 1024 * 1024;
const DEFAULT_TTL = 604800; // 7 days

async function uploadFile(filePath, customSlug = undefined, ttl = DEFAULT_TTL) {
  console.log(`\nReading ${filePath}...`);
  const filename = basename(filePath);
  const fileBytes = new Uint8Array(await readFile(filePath));
  console.log(`File size: ${(fileBytes.byteLength / (1024 * 1024)).toFixed(2)} MB`);

  console.log("Packing zip (STORE level 0)...");
  const zipBytes = zipSync({
    [filename]: [fileBytes, { level: 0 }],
  });
  console.log(`Packed zip size: ${(zipBytes.byteLength / (1024 * 1024)).toFixed(2)} MB`);

  console.log(`Initiating upload with ${ttl}s (${Math.round(ttl / 86400)}d) TTL...`);
  const initRes = await fetch(`${BASE_URL}/api/upload/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ totalBytes: zipBytes.byteLength, ttlSeconds: ttl }),
  });
  const initData = await initRes.json();
  if (!initRes.ok) {
    throw new Error(`Init failed: ${JSON.stringify(initData)}`);
  }

  const { uploadId } = initData;
  console.log(`Upload started. ID: ${uploadId}`);

  const totalChunks = Math.ceil(zipBytes.byteLength / CHUNK_SIZE);
  console.log(`Uploading ${totalChunks} chunks...`);

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, zipBytes.byteLength);
    const chunk = zipBytes.subarray(start, end);

    let ok = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const chunkRes = await fetch(`${BASE_URL}/api/upload/chunk`, {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "x-upload-id": uploadId,
            "x-chunk-index": String(i),
          },
          body: chunk,
        });
        if (chunkRes.ok) {
          ok = true;
          break;
        }
        console.warn(`Chunk ${i} attempt ${attempt + 1} rejected with ${chunkRes.status}`);
      } catch (err) {
        console.warn(`Chunk ${i} attempt ${attempt + 1} network error: ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
    if (!ok) throw new Error(`Failed to upload chunk ${i}`);
    process.stdout.write(`\rChunk ${i + 1}/${totalChunks} uploaded (${Math.round(((i + 1) / totalChunks) * 100)}%)`);
  }
  console.log("\nAll chunks uploaded.");

  const sha256 = createHash("sha256").update(zipBytes).digest("hex");
  console.log("Finalizing upload...");
  const finRes = await fetch(`${BASE_URL}/api/upload/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      uploadId,
      totalChunks,
      ttlSeconds: ttl,
      sha256,
      slug: customSlug,
    }),
  });
  const finData = await finRes.json();
  if (!finRes.ok) {
    throw new Error(`Finalize failed: ${JSON.stringify(finData)}`);
  }

  const fullUrl = `${BASE_URL}/s/${finData.slug}/`;
  console.log(`SUCCESS! Live link (${Math.round(ttl / 86400)}d): ${fullUrl}`);
  return { ...finData, fullUrl };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: node upload-video.mjs <file> [slug] [ttlSeconds]");
    process.exit(1);
  }

  // Support syntax:
  // node upload-video.mjs <file> [slug]
  // or node upload-video.mjs --file=<file> --slug=<slug>
  const file = args[0];
  const slug = args[1] && !args[1].startsWith("-") ? args[1] : undefined;
  const ttl = args[2] ? Number(args[2]) : DEFAULT_TTL;

  await uploadFile(file, slug, ttl);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
