# madethis.website

Temporary hosting for static websites. Drop a folder, get a live link,
watch it expire on schedule. No account, no build step, free.

## The product in one line

Drag a folder / .zip / .html onto the page → a URL like
`madethis.website/s/abc2def8/` goes live in seconds → files are deleted
when the countdown hits zero (1h or 24h).

## Stack

- **Astro 7** (server output) + `@astrojs/vercel` — static marketing page + API routes
- **Vercel Blob** — single store: one zip + one meta file per site
- **JSZip / fflate** — client-side packing, server-side unzipping on read
- Bespoke CSS (no framework), Space Grotesk + Geist

## Run locally

```bash
npm install
npm run dev          # works without any env vars — falls back to .local-blob/ on disk
```

With a real store (uses Vercel Blob):

```bash
vercel link
vercel env pull      # pulls BLOB_READ_WRITE_TOKEN (+ BLOB_STORE_ID with OIDC)
npm run dev
```

## Deploy

```bash
vercel deploy --prod
```

Connect the `madethis.website` domain + a Blob store in the dashboard.
Add `CRON_SECRET` if you want the cleanup cron locked down (cron is wired
in `vercel.json`). Set `CLI_API_KEY` (32+ chars) to enable the CLI upload API.

## CLI upload (HTML files)

Generate a key and add it to Vercel env vars as `CLI_API_KEY`:

```bash
openssl rand -hex 32
```

Upload from your terminal:

```bash
export MADETHIS_API_KEY='your-key-here'
chmod +x scripts/madethis
./scripts/madethis upload path/to/page.html --ttl 1h
```

Or with curl:

```bash
curl -fsS -X POST "https://www.madethis.website/api/cli/upload?ttl=3600" \
  -H "Authorization: Bearer $MADETHIS_API_KEY" \
  -H "Content-Type: text/html; charset=utf-8" \
  --data-binary @page.html
```

Rate limits (all uploads): 200/hour global, 10/hour per IP on the web UI,
30/hour per IP on CLI, 50/day per IP. Returns `429` with `Retry-After` when exceeded.

## Architecture

```
/index.astro              landing + dropzone (uploader runs client-side)
/s/[slug]/[...file].ts    serves sites: reads zip, maps path → entry
/api/upload/init.ts       mints uploadId, validates size + TTL
/api/upload/chunk.ts      stores one ≤3MB chunk (Vercel body limit)
/api/upload/finalize.ts   assembles, checks sha256, writes sites/<slug>.zip + meta
/api/cron/cleanup.ts      deletes expired sites + orphaned chunks
src/lib/*                 storage(Blob/local), slugs, mime, safety
```

Uploads are chunked because Vercel caps request bodies at 4.5 MB; chunks
are 3 MB. Sites capped at **8 MB packed**, **500 files**.

## Limits and honesty

- Free, anonymous, no account — anything you can build gets the same
  first-class treatment: 1h/24h TTL.
- Expired sites are hard-deleted (cleanup cron once daily; the serve route also
  refuses anything past expiry), then 404 brand page.
- `robots.txt` blocks crawling of `/s/` and `/api/`.

## Roadmap

- Wildcard subdomains (`slug.madethis.website`, closer to `surge.sh` UX)
- Custom 404.html support per site
- Upload via web-worker zip to keep the main thread free on big folders
- Rate limiting / daily quotas as traffic grows