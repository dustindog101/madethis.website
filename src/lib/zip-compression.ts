export type ZipCompressionMethod = "STORE" | "DEFLATE";

const STORE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "avif",
  "woff2",
  "zip",
  "mp4",
  "webm",
  "mov",
  "m4v",
  "ogg",
  "ogv",
  "mp3",
  "pdf",
]);

function extensionOf(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function zipCompressionFor(filename: string): { method: ZipCompressionMethod } {
  return { method: STORE_EXTENSIONS.has(extensionOf(filename)) ? "STORE" : "DEFLATE" };
}

export function jszipFileOptions(
  filename: string,
  level = 6,
): { compression: ZipCompressionMethod; compressionOptions?: { level: number } } {
  const { method } = zipCompressionFor(filename);
  if (method === "STORE") return { compression: "STORE" };
  return { compression: "DEFLATE", compressionOptions: { level } };
}

export function fflateEntryLevel(filename: string, deflateLevel: 6 | 9): 0 | 6 | 9 {
  return zipCompressionFor(filename).method === "STORE" ? 0 : deflateLevel;
}
