import { readFile, writeFile, mkdir, readdir, unlink, stat } from "node:fs/promises";
import { join, dirname, normalize, relative } from "node:path";
import { put, get, del, list } from "@vercel/blob";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

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

class CloudflareR2Store implements StorageBackend {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(options?: {
    endpoint?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    bucketName?: string;
  }) {
    const endpoint =
      options?.endpoint ??
      process.env.R2_ENDPOINT ??
      (process.env.R2_ACCOUNT_ID
        ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
        : undefined);
    const accessKeyId = options?.accessKeyId ?? process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = options?.secretAccessKey ?? process.env.R2_SECRET_ACCESS_KEY;
    this.bucket = options?.bucketName ?? process.env.R2_BUCKET_NAME ?? "madethis-uploads";

    if (!endpoint || !accessKeyId || !secretAccessKey) {
      throw new Error("Missing Cloudflare R2 credentials (R2_ENDPOINT/R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)");
    }

    this.client = new S3Client({
      region: "auto",
      endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  async put(pathname: string, data: Uint8Array, contentType: string, _options?: PutOptions): Promise<void> {
    const key = sanitizePathname(pathname);
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: data,
      ContentType: contentType,
    });
    await this.client.send(command);
  }

  async get(pathname: string): Promise<Uint8Array | null> {
    try {
      const key = sanitizePathname(pathname);
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      const response = await this.client.send(command);
      if (!response.Body) return null;
      return await response.Body.transformToByteArray();
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        (("name" in err && (err as { name: string }).name === "NoSuchKey") ||
          ("$metadata" in err &&
            (err as { $metadata: { httpStatusCode?: number } }).$metadata.httpStatusCode === 404))
      ) {
        return null;
      }
      throw err;
    }
  }

  async delete(pathname: string): Promise<void> {
    try {
      const key = sanitizePathname(pathname);
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      await this.client.send(command);
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        (("name" in err && (err as { name: string }).name === "NoSuchKey") ||
          ("$metadata" in err &&
            (err as { $metadata: { httpStatusCode?: number } }).$metadata.httpStatusCode === 404))
      ) {
        return;
      }
      throw err;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;
    const cleanPrefix = sanitizePathname(prefix);

    do {
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: cleanPrefix,
        ContinuationToken: continuationToken,
      });
      const response = await this.client.send(command);
      if (response.Contents) {
        for (const item of response.Contents) {
          if (item.Key) keys.push(item.Key);
        }
      }
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    return keys;
  }
}

class VercelBlobStore implements StorageBackend {
  async put(pathname: string, data: Uint8Array, contentType: string, options?: PutOptions): Promise<void> {
    await put(sanitizePathname(pathname), Buffer.from(data), {
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

const hasR2 = Boolean(
  process.env.R2_ACCESS_KEY_ID &&
  process.env.R2_SECRET_ACCESS_KEY &&
  (process.env.R2_ENDPOINT || process.env.R2_ACCOUNT_ID)
);
const hasBlob = Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
const onVercel = process.env.VERCEL === "1";

export const storage: StorageBackend = hasR2
  ? new CloudflareR2Store()
  : hasBlob
    ? new VercelBlobStore()
    : onVercel
      ? new VercelBlobStore()
      : new LocalDiskStore();

export function storageReady(): boolean {
  if (!onVercel) return true;
  return hasR2 || hasBlob;
}
