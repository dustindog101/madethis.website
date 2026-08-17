import { storage } from "./storage.js";
import { SITE_PREFIX } from "./limits.js";
import { readSiteMeta } from "./site.js";

export interface UploadLogRecord {
  id: string;
  slug: string;
  createdAt: number;
  expiresAt: number;
  bytes: number;
  files: number;
  homepage: string | null;
  ip: string;
  source: "website" | "cli" | "api";
  userAgent?: string;
  country?: string;
  city?: string;
  region?: string;
}

export interface UploadLogMetrics {
  totalUploads: number;
  activeSites: number;
  totalBytes: number;
  sources: {
    website: number;
    cli: number;
    api: number;
  };
}

export interface GetLogsOptions {
  page?: number;
  limit?: number;
  search?: string;
  source?: string;
}

export interface PaginatedLogsResult {
  records: UploadLogRecord[];
  totalRecords: number;
  totalPages: number;
  currentPage: number;
  limit: number;
  metrics: UploadLogMetrics;
}

const LOGS_PATH = "config/upload-logs.json";
const MAX_LOG_RECORDS = 1000;

export async function readAllLogs(): Promise<UploadLogRecord[]> {
  const raw = await storage.get(LOGS_PATH);
  if (raw) {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(raw)) as UploadLogRecord[];
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // JSON parse error — will attempt reconstruction
    }
  }

  // Fallback: reconstruct index from existing site metadata
  return reconstructLogsFromSites();
}

async function reconstructLogsFromSites(): Promise<UploadLogRecord[]> {
  try {
    const siteRows = await storage.list(SITE_PREFIX);
    const slugs = new Set<string>();
    for (const pathname of siteRows) {
      const match = /^sites\/([a-z2-9]{6,16})\.meta\.json$/.exec(pathname);
      if (match) slugs.add(match[1]);
    }

    const records: UploadLogRecord[] = [];
    for (const slug of slugs) {
      const meta = await readSiteMeta(slug);
      if (meta) {
        records.push({
          id: meta.slug,
          slug: meta.slug,
          createdAt: meta.createdAt,
          expiresAt: meta.expiresAt,
          bytes: meta.bytes,
          files: meta.files,
          homepage: meta.homepage,
          ip: meta.ip ?? "unknown",
          source: meta.source ?? "website",
          userAgent: meta.userAgent,
          country: meta.country,
          city: meta.city,
          region: meta.region,
        });
      }
    }

    // Sort newest first
    records.sort((a, b) => b.createdAt - a.createdAt);

    if (records.length > 0) {
      await saveLogs(records);
    }

    return records;
  } catch {
    return [];
  }
}

async function saveLogs(logs: UploadLogRecord[]): Promise<void> {
  const trimmed = logs.slice(0, MAX_LOG_RECORDS);
  const data = new TextEncoder().encode(JSON.stringify(trimmed));
  await storage.put(LOGS_PATH, data, "application/json", { allowOverwrite: true });
}

export async function recordUploadLog(record: UploadLogRecord): Promise<void> {
  const logs = await readAllLogs();
  // Filter out any existing entry with the same slug to prevent duplicates
  const filtered = logs.filter((l) => l.slug !== record.slug);
  filtered.unshift(record);
  await saveLogs(filtered);
}

export async function deleteUploadLogEntry(slug: string): Promise<void> {
  const logs = await readAllLogs();
  const filtered = logs.filter((l) => l.slug !== slug);
  await saveLogs(filtered);
}

export async function getUploadLogs(options: GetLogsOptions = {}): Promise<PaginatedLogsResult> {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.max(1, Math.min(100, options.limit ?? 10));
  const search = options.search?.trim().toLowerCase() ?? "";
  const sourceFilter = options.source?.trim().toLowerCase() ?? "";

  const allLogs = await readAllLogs();
  const now = Date.now();

  let activeSites = 0;
  let totalBytes = 0;
  const sources = { website: 0, cli: 0, api: 0 };

  for (const log of allLogs) {
    if (log.expiresAt > now) activeSites++;
    totalBytes += log.bytes ?? 0;
    if (log.source === "cli") sources.cli++;
    else if (log.source === "api") sources.api++;
    else sources.website++;
  }

  let filtered = allLogs;

  if (sourceFilter && sourceFilter !== "all") {
    filtered = filtered.filter((l) => l.source === sourceFilter);
  }

  if (search) {
    filtered = filtered.filter(
      (l) =>
        l.slug.toLowerCase().includes(search) ||
        l.ip.toLowerCase().includes(search) ||
        (l.homepage && l.homepage.toLowerCase().includes(search)) ||
        (l.country && l.country.toLowerCase().includes(search)) ||
        (l.city && l.city.toLowerCase().includes(search)) ||
        (l.region && l.region.toLowerCase().includes(search)) ||
        (l.userAgent && l.userAgent.toLowerCase().includes(search)),
    );
  }

  const totalRecords = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / limit));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * limit;
  const records = filtered.slice(startIndex, startIndex + limit);

  return {
    records,
    totalRecords,
    totalPages,
    currentPage,
    limit,
    metrics: {
      totalUploads: allLogs.length,
      activeSites,
      totalBytes,
      sources,
    },
  };
}
