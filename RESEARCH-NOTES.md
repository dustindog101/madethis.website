# Research notes — madethis.website (temporary static hosting MVP)

All findings below are from fetched/verified sources; nothing invented.
Companion product: cybershare.dev (Astro 7, Geist fonts) — stack matched.

## Comparable products & their flows (verified)

- **Netlify Drop** (app.netlify.com/drop): drag a folder, zip, or single
  HTML file → live URL in seconds, no account needed. Anonymous drops used to
  expire; Netlify answers abuse by password-protecting anonymous sites until
  claimed and capping at 3 per IP. Also: "drop a folder with an index.html"
  is the canonical flow users expect.
- **Surge.sh**: one command `surge` from the directory → random subdomain
  `wandering-unicorn.surge.sh`, publish + teardown outputs; CLI-first, no GUI.
- **Common denominator adopted here**: drop → anonymous → instant URL →
  automatic expiry (Netlify shutdown puts the clock on anonymous pages).
  We ship the "expires on its own" behavior as the product promise and skip
  auth entirely (user asks "temporarily host" — TTL is the point).

## Vercel constraint research (verified)

- Request body limit for Serverless Functions: **4.5 MB** (Vercel docs,
  "Limits" page + community threads). → chunked uploads (3 MB chunks).
- Vercel Blob SDK (@vercel/blob 2.x): `put/get/del/list`, `addRandomSuffix:
  false`, private access, store via `BLOB_READ_WRITE_TOKEN` or OIDC +
  `BLOB_STORE_ID`. Verified from using-blob-sdk docs.
- Cron jobs exist on Vercel (vercel.json `"crons"`) — runs every 4h to
  hard-delete expired sites; serve route also refuses past-expiry content.

## Storage decisions made here (own reasoning, noted for future review)

- One zip + one meta.json per site under `sites/<slug>/`. Slug is the
  pathname → no KV/database needed; metadata rides inside the blob store.
- Serve route reads the zip per request (sizes capped 8 MB → cheap).
  Revisit: extract-on-finalize (one blob per file) if traffic grows.
- Local dev: same storage interface backed by `.local-blob/` disk dir when
  no Blob env is set → full end-to-end testing without a Vercel account.

## Design research

- Instant-film ephemeral metaphor (expiry = print fading) chosen to avoid
  the generic dev-tool clichés (black+acid-green, purple AI gradients).
- Type: Space Grotesk (display) + Geist + Geist Mono — matches repo habit
  of self-hosted Fontsource fonts (same as cybershare.dev).

## Security notes (why)

- Secrets only via env (`.env.example`, never committed).
- Path traversal / null bytes / backslashes rejected in serve route;
  `X-Content-Type-Options: nosniff`, `Referrer-Policy` hard-set.
- sha256 verified at finalize (client → server integrity).
- Upload endpoints have no CORS headers (same-origin only).
- Rate limiting deliberately out of MVP (needs KV); noted on roadmap.

## Open risks / next steps

- Same-origin serving of user HTML is fine now (no cookies), but a
  wildcard subdomain remains the long-term isolation boundary.
- Hobby free-tier Blob caps (5 GB storage / bandwidth) — keep TTLs short,
  cron aggressive.