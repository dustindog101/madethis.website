import { readFile, writeFile, mkdir, readdir, unlink, stat } from "node:fs/promises";
import { join, dirname, normalize, relative } from "node:path";
import { put, get, del, list } from "@vercel/blob";

export interface PutOptions {
  allowOverwrite?: boolean;
}

export interface StorageBackend {
  put(pathname: string, data: Uint8Array, contentType: string, options?: PutOptions): Promise<void>;
  get(pathname: string): Promise<Uint8Array | null>;
  delete(pathname: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

function sanitizePathname(pathname: string): string {
  const clean = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
  return clean.startsWith("/") ? clean.slice(1) : clean;
}

async function streamToBytes(stream: ReadableStream): Promise<Uint8Array> {
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

class VercelBlobStore implements StorageBackend {
  async put(pathname: string, data: Uint8Array, contentType: string, options?: PutOptions): Promise<void> {
    await put(sanitizePathname(pathname), data, {
      access: "private",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: options?.allowOverwrite ?? false,
    });
  }

  async get(pathname: string): Promise<Uint8Array | null> {
    try {
      const result = await get(sanitizePathname(pathname), { access: "private" });
      if (!result?.stream) return null;
      return streamToBytes(result.stream);
    } catch {
      return null;
    }
  }

  async delete(pathname: string): Promise<void> {
    await del(sanitizePathname(pathname));
  }

  async list(prefix: string): Promise<string[]> {
    const blobs: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, limit: 1000 });
      blobs.push(...page.blobs.map((b) => b.pathname));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return blobs;
  }
}

class LocalDiskStore implements StorageBackend {
  private readonly root: string;

  constructor(root = ".local-blob") {
    this.root = root;
  }

  private async resolve(pathname: string): Promise<string> {
    const clean = sanitizePathname(pathname);
    const abs = join(this.root, clean);
    const rel = relative(this.root, abs);
    if (rel.startsWith("..") || rel.includes("..")) {
      throw new Error("path traversal rejected");
    }
    return abs;
  }

  async put(pathname: string, data: Uint8Array, _contentType: string, options?: PutOptions): Promise<void> {
    const abs = await this.resolve(pathname);
    if (!options?.allowOverwrite) {
      try {
        await stat(abs);
        throw new Error("blob already exists");
      } catch (err) {
        if (err instanceof Error && err.message === "blob already exists") throw err;
      }
    }
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, data);
  }

  async get(pathname: string): Promise<Uint8Array | null> {
    const abs = await this.resolve(pathname);
    try {
      const info = await stat(abs);
      if (!info.isFile()) return null;
      return new Uint8Array(await readFile(abs));
    } catch {
      return null;
    }
  }

  async delete(pathname: string): Promise<void> {
    const abs = await this.resolve(pathname);
    try {
      await unlink(abs);
    } catch {
      // ignore missing
    }
  }

  async list(prefix: string): Promise<string[]> {
    const base = await this.resolve(prefix);
    try {
      await stat(base);
    } catch {
      return [];
    }
    const walk = async (dir: string): Promise<string[]> => {
      const out: string[] = [];
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          out.push(...(await walk(full)));
        } else {
          out.push(relative(this.root, full).replace(/\\/g, "/"));
        }
      }
      return out;
    };
    const rows = await walk(base);
    return rows.map((p) => `${prefix}${p.replace(/^\/+/, "")}`.replace(/\/+/g, "/"));
  }
}

const onVercel = process.env.VERCEL === "1";
const hasBlob = Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);

export const storage: StorageBackend = hasBlob
  ? new VercelBlobStore()
  : onVercel
    ? new VercelBlobStore()
    : new LocalDiskStore();

export function storageReady(): boolean {
  if (!onVercel) return true;
  return hasBlob;
}
