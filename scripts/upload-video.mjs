import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { createHash } from "node:crypto";
import { zipSync } from "fflate";

const BASE_URL = process.env.MADETHIS_URL || "https://www.madethis.website";
const CHUNK_SIZE = 3 * 1024 * 1024;
const TTL = 86400; // 24 hours

async function uploadFile(filePath) {
  console.log(`\nReading ${filePath}...`);
  const filename = basename(filePath);
  const fileBytes = new Uint8Array(await readFile(filePath));
  console.log(`File size: ${(fileBytes.byteLength / (1024 * 1024)).toFixed(2)} MB`);

  console.log("Packing zip (STORE level 0)...");
  const zipBytes = zipSync({
    [filename]: [fileBytes, { level: 0 }],
  });
  console.log(`Packed zip size: ${(zipBytes.byteLength / (1024 * 1024)).toFixed(2)} MB`);

  console.log("Initiating upload with 24h TTL...");
  const initRes = await fetch(`${BASE_URL}/api/upload/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ totalBytes: zipBytes.byteLength, ttlSeconds: TTL }),
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
      ttlSeconds: TTL,
      sha256,
    }),
  });
  const finData = await finRes.json();
  if (!finRes.ok) {
    throw new Error(`Finalize failed: ${JSON.stringify(finData)}`);
  }

  const fullUrl = `${BASE_URL}/s/${finData.slug}/`;
  console.log(`SUCCESS! Live link (24h): ${fullUrl}`);
  return { ...finData, fullUrl };
}

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("Usage: node upload-video.mjs <file1> <file2> ...");
    process.exit(1);
  }

  const results = [];
  for (const file of files) {
    const res = await uploadFile(file);
    results.push(res);
  }

  console.log("\n================ SUMMARY ================");
  for (const r of results) {
    console.log(`${r.homepage || r.slug}: ${r.fullUrl}`);
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
