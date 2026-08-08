import { unzipSync, strToU8 } from "fflate";

export interface ZipEntry {
  pathname: string;
  data: Uint8Array;
}

/**
 * Lists the file entries of a zip buffer. Directories and macOS
 * metadata are filtered out. Returns null when the buffer is not
 * a readable zip.
 */
export function readZipEntries(zipBytes: Uint8Array, maxFiles: number): ZipEntry[] | null {
  try {
    const files = unzipSync(zipBytes);
    const entries: ZipEntry[] = [];
    for (const rawName of Object.keys(files)) {
      const pathname = normalizeEntry(rawName);
      if (!pathname) continue;
      const data = files[rawName];
      if (data.length === 0 && rawName.endsWith("/")) continue;
      if (isJunkEntry(pathname)) continue;
      entries.push({ pathname, data });
      if (entries.length > maxFiles) return null;
    }
    return entries;
  } catch {
    return null;
  }
}

function normalizeEntry(rawName: string): string | null {
  const cleaned = rawName.replace(/\\/g, "/");
  const segments = cleaned.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) return null;
  for (const segment of segments) {
    if (segment === ".." || segment === "." || segment.includes("\0")) return null;
  }
  const out = segments.join("/");
  return out.includes("..") ? null : out;
}

function isJunkEntry(pathname: string): boolean {
  if (pathname.startsWith("__MACOSX/")) return true;
  const parts = pathname.split("/");
  const leaf = parts[parts.length - 1];
  if (leaf === ".DS_Store") return true;
  if (leaf.startsWith("._")) return true;
  return false;
}

export function strToBytes(text: string): Uint8Array {
  return strToU8(text);
}