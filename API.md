# madethis.website API

Base URL: `https://www.madethis.website`

All responses are JSON unless noted. Errors look like:

```json
{ "ok": false, "error": { "code": "rate_limited", "message": "..." } }
```

## Quick pick

| Use case | Endpoint | Auth |
|----------|----------|------|
| Browser dropzone / custom UI with folders | `POST /api/upload/*` (chunked) | None |
| Scripts, CI, single files | `POST /api/cli/upload` | API key |
| Serve a live site | `GET /s/{slug}/` | None |
| Get API key | `GET /admin` → sign in | Admin login |

**TTL:** `3600` (1 hour) or `86400` (24 hours).

**Limits:** 8 MB packed zip · 500 files · 3 MB per upload chunk.

---

## 1. Chunked upload (browser or any HTTP client)

Use this for folders, zips, or anything that might exceed 4.5 MB per request. Same flow as the website dropzone.

### Step 1 — Init

```http
POST /api/upload/init
Content-Type: application/json

{
  "totalBytes": 12345,
  "ttlSeconds": 3600
}
```

**Response `200`:**

```json
{
  "uploadId": "cy74ukg6ptt2dgeq",
  "chunkSize": 3145728
}
```

Headers include `X-RateLimit-Remaining`.

### Step 2 — Upload chunks

```http
POST /api/upload/chunk
Content-Type: application/octet-stream
x-upload-id: cy74ukg6ptt2dgeq
x-chunk-index: 0

<raw bytes>
```

Repeat for each chunk (`0`, `1`, `2`, …). Chunks must be ≤ 3 MB.

**Response `201`:** `{ "ok": true, "index": 0 }`

### Step 3 — Finalize

Compute SHA-256 of the **full zip bytes** (hex string).

```http
POST /api/upload/finalize
Content-Type: application/json

{
  "uploadId": "cy74ukg6ptt2dgeq",
  "totalChunks": 1,
  "ttlSeconds": 3600,
  "sha256": "abc123...64 hex chars..."
}
```

**Response `200`:**

```json
{
  "ok": true,
  "slug": "fz3ncc2u",
  "url": "/s/fz3ncc2u/",
  "expiresAt": 1786192127800,
  "files": 1,
  "homepage": "index.html"
}
```

Live site: `https://www.madethis.website/s/fz3ncc2u/`

### JavaScript example (single zip)

```javascript
const zipBlob = /* your zip Blob */;
const buffer = new Uint8Array(await zipBlob.arrayBuffer());
const sha256 = await crypto.subtle.digest("SHA-256", buffer);
const shaHex = [...new Uint8Array(sha256)].map(b => b.toString(16).padStart(2, "0")).join("");

const init = await fetch("https://www.madethis.website/api/upload/init", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ totalBytes: buffer.byteLength, ttlSeconds: 3600 }),
}).then(r => r.json());

const chunkSize = init.chunkSize;
const totalChunks = Math.ceil(buffer.byteLength / chunkSize);
for (let i = 0; i < totalChunks; i++) {
  const start = i * chunkSize;
  const chunk = buffer.subarray(start, start + chunkSize);
  await fetch("https://www.madethis.website/api/upload/chunk", {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "x-upload-id": init.uploadId,
      "x-chunk-index": String(i),
    },
    body: chunk,
  });
}

const fin = await fetch("https://www.madethis.website/api/upload/finalize", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    uploadId: init.uploadId,
    totalChunks,
    ttlSeconds: 3600,
    sha256: shaHex,
  }),
}).then(r => r.json());

console.log("Live at:", new URL(fin.url, "https://www.madethis.website").href);
```

### Python example

```python
import hashlib, json, urllib.request

BASE = "https://www.madethis.website"
with open("site.zip", "rb") as f:
    data = f.read()
sha = hashlib.sha256(data).hexdigest()

init = json.loads(urllib.request.urlopen(urllib.request.Request(
    f"{BASE}/api/upload/init",
    data=json.dumps({"totalBytes": len(data), "ttlSeconds": 3600}).encode(),
    headers={"Content-Type": "application/json"}, method="POST",
)).read())

uid = init["uploadId"]
chunk_size = init["chunkSize"]
chunks = [data[i:i+chunk_size] for i in range(0, len(data), chunk_size)]
for i, chunk in enumerate(chunks):
    urllib.request.urlopen(urllib.request.Request(
        f"{BASE}/api/upload/chunk", data=chunk,
        headers={"Content-Type": "application/octet-stream", "x-upload-id": uid, "x-chunk-index": str(i)},
        method="POST",
    ))

fin = json.loads(urllib.request.urlopen(urllib.request.Request(
    f"{BASE}/api/upload/finalize",
    data=json.dumps({"uploadId": uid, "totalChunks": len(chunks), "ttlSeconds": 3600, "sha256": sha}).encode(),
    headers={"Content-Type": "application/json"}, method="POST",
)).read())
print(BASE + fin["url"])
```

---

## 2. CLI upload (scripts & automation)

Single request — best for `.html`, `.md`, `.js`, `.css`, or `.zip` files.

**Auth:** `Authorization: Bearer <API_KEY>`

Get your key: sign in at [/admin](https://www.madethis.website/admin) (footer **·** link).

### Query params

| Param | Values | Default |
|-------|--------|---------|
| `ttl` | `3600`, `86400`, `1h`, `24h` | `86400` |

### Headers

| Header | Required | Notes |
|--------|----------|-------|
| `Authorization` | Yes | `Bearer <API_KEY>` |
| `Content-Type` | Yes | See table below |
| `X-Filename` | No | Defaults from body type (`index.html`, `index.md`, etc.) |

### Supported uploads

| File type | Content-Type | Behavior |
|-----------|--------------|----------|
| `.html` / `.htm` | `text/html` | Served directly |
| `.md` | `text/markdown` | Served as markdown |
| `.js` / `.mjs` | `text/javascript` | Auto-wraps with shell `index.html` |
| `.css` | `text/css` | Auto-wraps with shell `index.html` |
| `.zip` | `application/zip` | Full static site (HTML + assets) |
| JSON body | `application/json` | `{ "content": "...", "filename": "index.html", "ttl": 3600 }` |

Max single-file size: **2 MB**. Max zip: **8 MB**.

### curl examples

```bash
export MADETHIS_API_KEY='your-key-from-admin'
BASE=https://www.madethis.website

# HTML
curl -fsS -X POST "$BASE/api/cli/upload?ttl=1h" \
  -H "Authorization: Bearer $MADETHIS_API_KEY" \
  -H "Content-Type: text/html; charset=utf-8" \
  --data-binary @index.html

# Markdown
curl -fsS -X POST "$BASE/api/cli/upload?ttl=24h" \
  -H "Authorization: Bearer $MADETHIS_API_KEY" \
  -H "Content-Type: text/markdown; charset=utf-8" \
  -H "X-Filename: readme.md" \
  --data-binary @readme.md

# JS (gets index.html wrapper automatically)
curl -fsS -X POST "$BASE/api/cli/upload?ttl=1h" \
  -H "Authorization: Bearer $MADETHIS_API_KEY" \
  -H "Content-Type: text/javascript; charset=utf-8" \
  -H "X-Filename: app.js" \
  --data-binary @app.js

# Full static site zip
curl -fsS -X POST "$BASE/api/cli/upload?ttl=24h" \
  -H "Authorization: Bearer $MADETHIS_API_KEY" \
  -H "Content-Type: application/zip" \
  --data-binary @dist.zip
```

**Response `201`:**

```json
{
  "ok": true,
  "slug": "ccsyermu",
  "url": "/s/ccsyermu/",
  "fullUrl": "https://www.madethis.website/s/ccsyermu/",
  "expiresAt": 1786192127800,
  "files": 1,
  "homepage": "index.html"
}
```

### Included script

```bash
chmod +x scripts/madethis
export MADETHIS_API_KEY='your-key'
./scripts/madethis upload page.html --ttl 1h
./scripts/madethis upload notes.md
./scripts/madethis upload app.js
./scripts/madethis upload dist.zip --json
```

---

## 3. Serving sites

```http
GET /s/{slug}/
GET /s/{slug}/path/to/file.css
GET /s/{slug}/about.html
```

- Root `/s/{slug}/` serves `index.html`, `index.htm`, or `index.md` (first found).
- Expired sites return **410** with a branded HTML page.
- Unknown slug returns **404**.

No auth required to view.

---

## 4. Rate limits

| Scope | Limit |
|-------|-------|
| Global | 200 uploads/hour |
| Web UI per IP | 10/hour, 50/day |
| CLI per IP | 30/hour, 50/day |

`429` responses include `Retry-After` and `X-RateLimit-*` headers.

---

## 5. Error codes

| Code | HTTP | Meaning |
|------|------|---------|
| `rate_limited` | 429 | Slow down |
| `unauthorized` | 401 | Bad/missing API key (CLI) |
| `size_out_of_range` | 400 | Zip too large/small |
| `not_a_zip` | 422 | Finalize body isn't a valid zip |
| `checksum_mismatch` | 422 | SHA-256 doesn't match |
| `missing_chunk` | 409 | Chunk not uploaded before finalize |
| `invalid_ttl` | 400 | TTL must be 1h or 24h |

---

## 6. Admin API (optional)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/admin/setup` | POST | First-time admin creation |
| `/api/admin/login` | POST | Sign in (sets session cookie) |
| `/api/admin/logout` | POST | Sign out |
| `/api/admin/api-key` | GET | View API key (session cookie) |
| `/api/admin/api-key` | POST | Regenerate API key |

Not required for public uploads — only for managing your CLI key.
