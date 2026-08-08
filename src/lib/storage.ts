import { readFile, writeFile, mkdir, readdir, unlink, stat } from "node:fs/promises";
import { join, dirname, normalize, relative } from "node:path";
import { put, get, del, list } from "@vercel/blob";

export interface StoredFile {
  pathname: string;
  data: Uint8Array;
  contentType: string;
  uploadedAt: number;
}

export interface StorageBackend {
  put(pathname: string, data: Uint8Array, contentType: string): Promise<void>;
  get(pathname: string): Promise<Uint8Array | null>;
  delete(pathname: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

function sanitizePathname(pathname: string): string {
  const clean = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
  return clean.startsWith("/") ? clean.slice(1) : clean;
}

class VercelBlobStore implements StorageBackend {
  async put(pathname: string, data: Uint8Array, contentType: string): Promise<void> {
    await put(sanitizePathname(pathname), data, {
      access: "private",
      contentType,
      addRandomSuffix: false,
    });
  }

  async get(pathname: string): Promise<Uint8Array | null> {
    try {
      const blob = await get(sanitizePathname(pathname));
      const buffer = await blob.blob.arrayBuffer();
      return new Uint8Array(buffer);
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
      cursor = page.cursor;
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

  async put(pathname: string, data: Uint8Array, contentType: string): Promise<void> {
    const abs = await this.resolve(pathname);
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

export const storage: StorageBackend = process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID
  ? new VercelBlobStore()
  : new LocalDiskStore();