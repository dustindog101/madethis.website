/* madethis.website uploader — drag, pack, chunk-up, paste, expire */

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
  card: (document.getElementById("drop-card") || document.querySelector(".drop-card")) as HTMLElement,
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

  // Paste modal elements
  pasteModal: document.getElementById("paste-modal") as HTMLDialogElement | null,
  pastePreviewImg: document.getElementById("paste-preview-img") as HTMLImageElement | null,
  pasteMetaName: document.getElementById("paste-meta-name") as HTMLElement | null,
  pasteMetaSize: document.getElementById("paste-meta-size") as HTMLElement | null,
  pasteTtlPills: Array.from(document.querySelectorAll<HTMLButtonElement>(".paste-ttl-pill")),
  pasteCloseBtn: document.getElementById("paste-close-btn") as HTMLButtonElement | null,
  pasteCancelBtn: document.getElementById("paste-cancel-btn") as HTMLButtonElement | null,
  pasteUploadBtn: document.getElementById("paste-upload-btn") as HTMLButtonElement | null,
};

let ttlSeconds = 86400;
let busy = false;

let pendingPasteFile: File | null = null;
let pendingPasteTtl = 86400;
let pastePreviewUrl: string | null = null;

function setBusy(state: boolean, stage = ""): void {
  busy = state;
  const card = els.card || document.getElementById("drop-card") || document.querySelector(".drop-card");
  card?.classList.toggle("is-busy", state);
  els.zone?.setAttribute("aria-disabled", String(state));
  els.error?.classList.remove("is-shown");
  if (els.progress) {
    els.progress.style.display = state ? "block" : "none";
  }
  if (stage && els.stage) els.stage.textContent = stage;
}

function setProgress(pct: number): void {
  const clamped = Math.max(0, Math.min(1, pct));
  if (els.bar) els.bar.style.width = `${Math.round(clamped * 100)}%`;
  if (els.pct) els.pct.textContent = `${Math.round(clamped * 100)}%`;
}

function showError(message: string): void {
  setBusy(false);
  if (els.error) {
    els.error.textContent = message;
    els.error.classList.add("is-shown");
  }
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
els.zone?.addEventListener("click", () => {
  if (!busy) els.fileInput?.click();
});
els.zone?.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && !busy) {
    e.preventDefault();
    els.fileInput?.click();
  }
});

["dragenter", "dragover"].forEach((type) => {
  els.zone?.addEventListener(type, (e) => {
    const dragEvent = e as DragEvent;
    if (!busy && dragEvent.dataTransfer?.items?.length) {
      e.preventDefault();
      els.zone.classList.add("is-dragging");
    }
  });
});
["dragleave", "drop"].forEach((type) => {
  els.zone?.addEventListener(type, () => els.zone?.classList.remove("is-dragging"));
});
els.zone?.addEventListener("drop", (e) => {
  e.preventDefault();
  if (busy) return;
  const items = Array.from(e.dataTransfer?.items ?? []);
  void handleDropped(items as DragItem[]);
});

/* ---- input fallbacks ---- */
els.folderInput?.addEventListener("change", () => {
  const files = Array.from(els.folderInput.files ?? []);
  els.folderInput.value = "";
  if (files.length) void runUpload(files.map((f) => ({ name: f.webkitRelativePath || f.name, file: f })));
});
els.fileInput?.addEventListener("change", () => {
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
                const childNode = child as FsNode;
                const childPath = prefix ? `${prefix}/${childNode.name}` : childNode.name;
                if (childNode.isDirectory) {
                  await listAll(childNode, childPath);
                } else if (childNode.file) {
                  childNode.file((f: File) => addFile(childPath, f), () => {});
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
        if (entry.isFile && entry.file) {
          entry.file((f: File) => addFile(entry.name, f), () => {});
        } else {
          await listAll(entry, "");
        }
      } catch {
        showError("Couldn't read that folder. Try using the file browser instead.");
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
    showError("No valid files found. Please upload a folder, .zip, image, or .html file.");
  }
}

/* ---- Clipboard Paste Support ---- */

window.addEventListener("paste", (e: ClipboardEvent) => {
  if (busy) return;

  // Don't intercept paste inside text inputs or textareas
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
    return;
  }

  const items = e.clipboardData?.items;
  if (!items) return;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) {
        e.preventDefault();
        openPasteModal(file);
        break;
      }
    }
  }
});

function generatePastedFilename(file: File): string {
  if (file.name && file.name !== "image.png" && file.name !== "blob") {
    return file.name;
  }
  const ext = file.type === "image/jpeg" ? "jpg" : file.type === "image/webp" ? "webp" : file.type === "image/gif" ? "gif" : file.type === "image/svg+xml" ? "svg" : "png";
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `pasted-${stamp}.${ext}`;
}

function openPasteModal(file: File): void {
  if (!els.pasteModal) {
    // Fallback if modal element not present
    void runUpload([{ name: generatePastedFilename(file), file }]);
    return;
  }

  pendingPasteFile = file;
  pendingPasteTtl = ttlSeconds;

  els.pasteTtlPills.forEach((p) => {
    const isThis = Number(p.dataset.ttl ?? 86400) === pendingPasteTtl;
    p.classList.toggle("is-on", isThis);
    p.setAttribute("aria-pressed", String(isThis));
  });

  if (pastePreviewUrl) URL.revokeObjectURL(pastePreviewUrl);
  pastePreviewUrl = URL.createObjectURL(file);

  if (els.pastePreviewImg) {
    els.pastePreviewImg.src = pastePreviewUrl;
  }

  const filename = generatePastedFilename(file);
  if (els.pasteMetaName) els.pasteMetaName.textContent = filename;
  if (els.pasteMetaSize) els.pasteMetaSize.textContent = `${file.type.replace("image/", "").toUpperCase()} · ${formatBytes(file.size)}`;

  try {
    els.pasteModal.showModal();
  } catch {
    // Fallback if showModal throws
    void runUpload([{ name: filename, file }], pendingPasteTtl);
  }
}

function closePasteModal(): void {
  if (els.pasteModal?.open) {
    els.pasteModal.close();
  }
  if (pastePreviewUrl) {
    URL.revokeObjectURL(pastePreviewUrl);
    pastePreviewUrl = null;
  }
  pendingPasteFile = null;
}

els.pasteTtlPills.forEach((pill) => {
  pill.addEventListener("click", () => {
    els.pasteTtlPills.forEach((p) => {
      p.classList.toggle("is-on", p === pill);
      p.setAttribute("aria-pressed", String(p === pill));
    });
    pendingPasteTtl = Number(pill.dataset.ttl ?? 86400);
  });
});

els.pasteCloseBtn?.addEventListener("click", closePasteModal);
els.pasteCancelBtn?.addEventListener("click", closePasteModal);

els.pasteUploadBtn?.addEventListener("click", () => {
  if (!pendingPasteFile) return;
  const file = pendingPasteFile;
  const ttl = pendingPasteTtl;
  const name = generatePastedFilename(file);
  closePasteModal();

  document.getElementById("drop-anchor")?.scrollIntoView({ behavior: "smooth", block: "center" });
  void runUpload([{ name, file }], ttl);
});

// Light-dismiss fallback for <dialog> on browsers lacking closedby support
if (els.pasteModal && !("closedBy" in HTMLDialogElement.prototype)) {
  els.pasteModal.addEventListener("click", (event: MouseEvent) => {
    if (event.target !== els.pasteModal) return;
    const rect = els.pasteModal.getBoundingClientRect();
    const isDialogContent =
      rect.top <= event.clientY &&
      event.clientY <= rect.top + rect.height &&
      rect.left <= event.clientX &&
      event.clientX <= rect.left + rect.width;
    if (!isDialogContent) {
      closePasteModal();
    }
  });
}

/* ---- pack + upload ---- */

async function runUpload(files: RawFile[], ttlOverride?: number): Promise<void> {
  if (busy) return;
  if (files.length > MAX_FILES) {
    showError(`Too many files. The limit is ${MAX_FILES} files per upload.`);
    return;
  }
  const totalBytes = files.reduce((n, f) => n + f.file.size, 0);
  if (totalBytes === 0) {
    showError("The selected file is empty.");
    return;
  }

  const effectiveTtl = ttlOverride ?? ttlSeconds;

  setBusy(true, "packing");
  setProgress(0.02);

  try {
    const zip = await buildZip(files);
    if (zip.size > MAX_ZIP_BYTES) {
      showError(`File size exceeds limit (${formatBytes(MAX_ZIP_BYTES)} packed). Your upload is ${formatBytes(zip.size)}.`);
      return;
    }
    await uploadZip(zip, effectiveTtl);
  } catch (err) {
    showError(err instanceof Error ? err.message : "Upload failed. Please try again.");
  }
}

async function buildZip(files: RawFile[]): Promise<Blob> {
  const isSingle = files.length === 1;
  if (isSingle) {
    const name = files[0].name.toLowerCase();
    if (name.endsWith(".zip")) return files[0].file;
  }
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const { name, file } of files) {
    zip.file(name, file);
  }
  return zip.generateAsync(
    {
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    },
    (meta: { percent: number }) => {
      setProgress(0.02 + 0.28 * (meta.percent / 100));
    }
  );
}

async function uploadZip(zipBlob: Blob, uploadTtl = ttlSeconds): Promise<void> {
  setBusy(true, "uploading");

  let init: { uploadId: string };
  try {
    const res = await fetch("/api/upload/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ totalBytes: zipBlob.size, ttlSeconds: uploadTtl }),
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
        if (res.status === 413) throw new Error("Upload chunk exceeded server limit.");
        if (!res.ok) throw new Error("chunk rejected");
        break;
      } catch (err) {
        attempt++;
        if (attempt >= 3) throw new Error("Upload interrupted. Please check your connection and try again.");
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
      body: JSON.stringify({ uploadId: init.uploadId, totalChunks, ttlSeconds: uploadTtl, sha256: shaHex }),
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
  const card = els.card || document.getElementById("drop-card") || document.querySelector(".drop-card");
  card?.classList.remove("is-busy");
  card?.classList.add("is-done");
  if (els.progress) {
    els.progress.style.display = "none";
  }

  const fullUrl = `${location.origin}${fin.url}`;
  if (els.slugText) els.slugText.textContent = fin.slug.toUpperCase();
  if (els.url) els.url.textContent = fin.url;
  if (els.urlLink) els.urlLink.href = fin.url;
  if (els.files) els.files.textContent = `${fin.files} file${fin.files === 1 ? "" : "s"}`;
  if (els.printNo) els.printNo.textContent = fin.slug.slice(0, 4);

  els.open?.addEventListener("click", () => window.open(fin.url, "_blank", "noopener"));
  els.again?.addEventListener("click", resetCard);
  els.share?.addEventListener("click", () => {
    const payload = { title: "Temporary site on madethis.website", text: fullUrl };
    if (navigator.share) {
      navigator.share(payload).catch(() => {});
    } else {
      copyToClipboard(fullUrl, els.share, "Link copied ✓");
    }
  });
  els.copy?.addEventListener("click", () => copyToClipboard(fullUrl, els.copy, "Copied ✓"));

  startCountdown(fin.expiresAt);
}

function resetCard(): void {
  const card = els.card || document.getElementById("drop-card") || document.querySelector(".drop-card");
  card?.classList.remove("is-done", "is-busy");
  setProgress(0);
  els.error?.classList.remove("is-shown");
}

async function copyToClipboard(text: string, btn: HTMLButtonElement | null, doneLabel: string): Promise<void> {
  if (!btn) return;
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
      if (els.hh) els.hh.textContent = "00";
      if (els.mm) els.mm.textContent = "00";
      if (els.ss) els.ss.textContent = "00";
      clearInterval(startCountdown.timer);
      return;
    }
    if (els.hh) els.hh.textContent = String(Math.floor(diff / 3_600_000)).padStart(2, "0");
    if (els.mm) els.mm.textContent = String(Math.floor((diff % 3_600_000) / 60_000)).padStart(2, "0");
    if (els.ss) els.ss.textContent = String(Math.floor((diff % 60_000) / 1000)).padStart(2, "0");
  };
  tick();
  startCountdown.timer = setInterval(tick, 1000) as unknown as number;
}
startCountdown.timer = 0;

async function sha256Hex(buffer: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer as unknown as ArrayBufferView);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}