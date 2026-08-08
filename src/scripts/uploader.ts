/* madethis.website uploader — drag, pack, chunk-up, expire */

const MAX_ZIP_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 500;
const CHUNK_SIZE = 3 * 1024 * 1024;

/* ---- minimal types for the FileSystem API (missing from lib.dom) ---- */
type FsNode = FileSystemEntry & {
  file?: (cb: (f: File) => void, err?: (e: unknown) => void) => void;
  createReader?: () => FileSystemDirectoryReader;
};
type DragItem = DataTransferItem & { webkitGetAsEntry?(): FsNode | null };

interface RawFile {
  name: string;
  file: Blob;
}

/* ------------------------------------------------------------------ */

const els = {
  card: document.getElementById("drop-card") as HTMLElement,
  zone: document.getElementById("drop-zone") as HTMLElement,
  error: document.getElementById("drop-error") as HTMLElement,
  progress: document.getElementById("drop-progress") as HTMLElement,
  stage: document.getElementById("progress-stage") as HTMLElement,
  pct: document.getElementById("progress-pct") as HTMLElement,
  bar: document.getElementById("progress-bar") as HTMLElement,
  result: document.getElementById("result") as HTMLElement,
  slugText: document.getElementById("result-slug") as HTMLElement,
  url: document.getElementById("result-url") as HTMLElement,
  urlLink: document.getElementById("result-url-link") as HTMLAnchorElement,
  files: document.getElementById("result-files") as HTMLElement,
  printNo: document.getElementById("result-printno") as HTMLElement,
  hh: document.getElementById("countdown-hh") as HTMLElement,
  mm: document.getElementById("countdown-mm") as HTMLElement,
  ss: document.getElementById("countdown-ss") as HTMLElement,
  copy: document.getElementById("copy-btn") as HTMLButtonElement,
  share: document.getElementById("share-btn") as HTMLButtonElement,
  open: document.getElementById("open-btn") as HTMLButtonElement,
  again: document.getElementById("again-btn") as HTMLButtonElement,
  folderInput: document.getElementById("file-folder") as HTMLInputElement,
  fileInput: document.getElementById("file-file") as HTMLInputElement,
  pills: Array.from(document.querySelectorAll<HTMLButtonElement>(".ttl-pill")),
};

let ttlSeconds = 86400;
let busy = false;

function setBusy(state: boolean, stage = ""): void {
  busy = state;
  els.card.classList.toggle("is-busy", state);
  els.zone.setAttribute("aria-disabled", String(state));
  els.error.classList.remove("is-shown");
  if (state) els.progress.style.display = "block";
  else els.progress.style.display = "none";
  if (stage) els.stage.textContent = stage;
}

function setProgress(pct: number): void {
  const clamped = Math.max(0, Math.min(1, pct));
  els.bar.style.width = `${Math.round(clamped * 100)}%`;
  els.pct.textContent = `${Math.round(clamped * 100)}%`;
}

function showError(message: string): void {
  setBusy(false);
  els.error.textContent = message;
  els.error.classList.add("is-shown");
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/* ---- TTL pills ---- */
els.pills.forEach((pill) => {
  pill.addEventListener("click", () => {
    els.pills.forEach((p) => {
      p.classList.toggle("is-on", p === pill);
      p.setAttribute("aria-pressed", String(p === pill));
    });
    ttlSeconds = Number(pill.dataset.ttl ?? 86400);
  });
});

/* ---- drop zone (clickable) ---- */
els.zone.addEventListener("click", () => {
  if (!busy) els.fileInput.click();
});
els.zone.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && !busy) {
    e.preventDefault();
    els.fileInput.click();
  }
});

["dragenter", "dragover"].forEach((type) => {
  els.zone.addEventListener(type, (e) => {
    const dragEvent = e as DragEvent;
    if (!busy && dragEvent.dataTransfer?.items?.length) {
      e.preventDefault();
      els.zone.classList.add("is-dragging");
    }
  });
});
["dragleave", "drop"].forEach((type) => {
  els.zone.addEventListener(type, () => els.zone.classList.remove("is-dragging"));
});
els.zone.addEventListener("drop", (e) => {
  e.preventDefault();
  if (busy) return;
  const items = Array.from(e.dataTransfer?.items ?? []);
  void handleDropped(items as DragItem[]);
});

/* ---- input fallbacks ---- */
els.folderInput.addEventListener("change", () => {
  const files = Array.from(els.folderInput.files ?? []);
  els.folderInput.value = "";
  if (files.length) void runUpload(files.map((f) => ({ name: f.webkitRelativePath || f.name, file: f })));
});
els.fileInput.addEventListener("change", () => {
  const files = Array.from(els.fileInput.files ?? []);
  els.fileInput.value = "";
  if (files.length) void runUpload(files.map((f) => ({ name: f.name, file: f })));
});

/* ---- dropping: walk directory trees ---- */

async function handleDropped(items: DragItem[]): Promise<void> {
  const files: RawFile[] = [];
  const seen = new Set<string>();

  const addFile = (name: string, file: File): void => {
    const clean = name.replace(/^\/+/, "").split("/").filter(Boolean).join("/");
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    files.push({ name: clean, file });
  };

  const listAll = (entry: FsNode, prefix: string): Promise<void> =>
    new Promise((resolve, reject) => {
      if (!entry.createReader) return resolve();
      const reader = entry.createReader();
      const readBatch = (): Promise<void> =>
        new Promise((res, rej) => {
          reader.readEntries(async (entries) => {
            try {
              for (const child of entries) {
                const childPath = prefix ? `${prefix}/${child.name}` : child.name;
                if (child.isDirectory) {
                  await listAll(child, childPath);
                } else {
                  child.file((f) => addFile(childPath, f), () => {});
                }
              }
              if (entries.length > 0) await readBatch();
              res();
            } catch (e) {
              rej(e);
            }
          }, rej);
        });
      readBatch().then(resolve).catch(reject);
    });

  for (const item of items) {
    const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
    if (entry) {
      try {
        if (entry.isFile) {
          entry.file((f) => addFile(entry.name, f), () => {});
        } else {
          await listAll(entry, "");
        }
      } catch {
        showError("Couldn't read that folder — try the browse button instead.");
        return;
      }
    } else {
      const f = item.getAsFile?.() ?? null;
      if (f) addFile(f.name, f);
    }
  }

  if (files.length > 0) {
    await runUpload(files);
  } else {
    showError("Nothing usable in that drop — want a folder, a .zip, or a single .html?");
  }
}

/* ---- pack + upload ---- */

async function runUpload(files: RawFile[]): Promise<void> {
  if (busy) return;
  if (files.length > MAX_FILES) {
    showError(`Too many files — the free tier allows ${MAX_FILES} per site.`);
    return;
  }
  const totalBytes = files.reduce((n, f) => n + f.file.size, 0);
  if (totalBytes === 0) {
    showError("That folder looks empty — no bytes inside.");
    return;
  }

  setBusy(true, "packing");
  setProgress(0.02);

  try {
    const zip = await buildZip(files);
    if (zip.size > MAX_ZIP_BYTES) {
      showError(`Too heavy — a site can be up to ${formatBytes(MAX_ZIP_BYTES)} packed. Yours is ${formatBytes(zip.size)}.`);
      return;
    }
    await uploadZip(zip);
  } catch (err) {
    showError(err instanceof Error ? err.message : "Unexpected failure — try again.");
  }
}

async function buildZip(files: RawFile[]): Promise<Blob> {
  const isSingle = files.length === 1;
  if (isSingle) {
    const name = files[0].name.toLowerCase();
    if (name.endsWith(".zip")) return files[0].file;
    if (name.endsWith(".html") || name.endsWith(".htm")) return files[0].file;
  }
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const { name, file } of files) {
    zip.file(name, file);
  }
  const options: JSZip.JSZipGeneratorOptions<"blob"> & { updateCallback?: (m: { percent: number }) => void } = {
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    updateCallback: (meta) => setProgress(0.02 + 0.28 * (meta.percent / 100)),
  };
  return zip.generateAsync(options);
}

async function uploadZip(zipBlob: Blob): Promise<void> {
  setBusy(true, "uploading");

  let init: { uploadId: string };
  try {
    const res = await fetch("/api/upload/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ totalBytes: zipBlob.size, ttlSeconds }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? "Couldn't start the upload.");
    init = data;
  } catch (err) {
    throw err instanceof Error ? err : new Error("Couldn't start the upload.");
  }

  const buffer = new Uint8Array(await zipBlob.arrayBuffer());
  const byteSize = Math.min(CHUNK_SIZE, Math.max(1, buffer.byteLength));
  const totalChunks = Math.ceil(buffer.byteLength / byteSize);
  const shaHex = await sha256Hex(buffer);

  let uploaded = 0;
  for (let index = 0; index < totalChunks; index++) {
    const start = index * byteSize;
    const chunk = buffer.subarray(start, Math.min(start + byteSize, buffer.byteLength));
    let attempt = 0;
    while (true) {
      try {
        const res = await fetch("/api/upload/chunk", {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "x-upload-id": init.uploadId,
            "x-chunk-index": String(index),
          },
          body: chunk,
        });
        if (res.status === 413) throw new Error("That chunk exceeded the server's limit — the site is too big.");
        if (!res.ok) throw new Error("chunk rejected");
        break;
      } catch (err) {
        attempt++;
        if (attempt >= 3) throw new Error("Upload interrupted — check your connection and try again.");
        await new Promise((r) => setTimeout(r, 600 * attempt));
      }
    }
    uploaded += chunk.byteLength;
    setProgress(0.3 + 0.6 * (uploaded / buffer.byteLength));
  }

  setBusy(true, "developing");
  setProgress(0.95);

  let fin: { ok: boolean; slug: string; url: string; expiresAt: number; files: number };
  try {
    const res = await fetch("/api/upload/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadId: init.uploadId, totalChunks, ttlSeconds, sha256: shaHex }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? "Finalize failed");
    fin = data;
  } catch (err) {
    throw err instanceof Error ? err : new Error("Finalize failed");
  }

  showResult(fin);
}

/* ---- success state ---- */

function showResult(fin: { ok: boolean; slug: string; url: string; expiresAt: number; files: number }): void {
  busy = false;
  els.card.classList.remove("is-busy");
  els.card.classList.add("is-done");

  const fullUrl = `${location.origin}${fin.url}`;
  els.slugText.textContent = fin.slug.toUpperCase();
  els.url.textContent = fin.url;
  els.urlLink.href = fin.url;
  els.files.textContent = `${fin.files} file${fin.files === 1 ? "" : "s"}`;
  els.printNo.textContent = fin.slug.slice(0, 4);

  els.open.addEventListener("click", () => window.open(fin.url, "_blank", "noopener"));
  els.again.addEventListener("click", resetCard);
  els.share.addEventListener("click", () => {
    const payload = { title: "I made this — it's temporary", text: fullUrl };
    if (navigator.share) {
      navigator.share(payload).catch(() => {});
    } else {
      copyToClipboard(fullUrl, els.share, "Link copied ✓");
    }
  });
  els.copy.addEventListener("click", () => copyToClipboard(fullUrl, els.copy, "Copied ✓"));

  startCountdown(fin.expiresAt);
}

function resetCard(): void {
  els.card.classList.remove("is-done", "is-busy");
  setProgress(0);
  els.error.classList.remove("is-shown");
}

async function copyToClipboard(text: string, btn: HTMLButtonElement, doneLabel: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      el.remove();
    } catch { /* give up quietly */ }
  }
  const prev = btn.textContent;
  btn.textContent = doneLabel;
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = prev;
    btn.disabled = false;
  }, 1400);
}

function startCountdown(expiresAt: number): void {
  clearInterval(startCountdown.timer);
  const tick = (): void => {
    const diff = expiresAt - Date.now();
    if (diff <= 0) {
      els.hh.textContent = els.mm.textContent = els.ss.textContent = "00";
      clearInterval(startCountdown.timer);
      return;
    }
    els.hh.textContent = String(Math.floor(diff / 3_600_000)).padStart(2, "0");
    els.mm.textContent = String(Math.floor((diff % 3_600_000) / 60_000)).padStart(2, "0");
    els.ss.textContent = String(Math.floor((diff % 60_000) / 1000)).padStart(2, "0");
  };
  tick();
  startCountdown.timer = setInterval(tick, 1000) as unknown as number;
}
startCountdown.timer = 0;

async function sha256Hex(buffer: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}