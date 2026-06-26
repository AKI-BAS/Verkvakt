# Verkvakt

An opportunity radar for an architecture studio: it pulls public tenders and
architecture competitions from several Icelandic and EU sources, scores each
one for how relevant it is to the studio (architecture / interiors / planning /
full design — **not** pure electrical, plumbing, or engineering), and shows the
ranked result on one dashboard with the closing-soon ones surfaced first.

> Name means roughly "project watch". Rename freely — it's only in a few places.

## Why it's built this way

No single source has everything, so each source is a small **adapter** feeding
one normalised table. The realistic coverage picture:

| Source | What it gives | How |
| --- | --- | --- |
| **TED** | Above-threshold public tenders **+ PINs** (months of lead time), with CPV codes | Official v3 API, no key |
| **Competitions** (AÍ / FÍLA) | Architecture competitions incl. private-developer forval | Light HTML scrape |
| **Útboðsvefur** | Below-threshold public tenders | Forward its notification emails in (planned) |
| **Capital plans** (Vegagerðin, FSRE…) | Earliest signals, before the tender | Per-source watch (later) |

Two honest limits, by design: truly private commissions that are never
advertised can't be caught by anything, and scraped sources break when sites
change their markup — so every run is logged to `ingest_runs`, and a source
returning nothing shows up instead of going silently dark.

Nothing is ever silently dropped. Items are **scored and ranked**; pure-
construction and pure-engineering jobs sink to the bottom but stay visible.

## Layout

```
schema.sql            Supabase tables, dashboard view, RLS  (run once)
worker/               Cloudflare Worker — polls sources on a cron, scores, upserts
  src/index.js          orchestrator (runs every adapter, isolated)
  src/adapters/ted.js   TED v3 API  (working)
  src/adapters/competitions.js  AÍ/FÍLA  (structured stub)
  src/lib/scoring.js    relevance scoring — THE policy of the tool, tune freely
  src/lib/supabase.js   PostgREST upsert + run logging
web/index.html        single-file dashboard (runs on sample data out of the box)
```

## Setup

**1. Database** — create a Supabase project, open the SQL editor, paste
`schema.sql`, run it.

**2. Worker**
```bash
cd worker
npm install
# set SUPABASE_URL in wrangler.toml, then:
npx wrangler secret put SUPABASE_SERVICE_KEY   # paste the service_role key
npx wrangler dev          # local; hit http://localhost:8787/run to test
npx wrangler deploy       # go live + enable the 6-hourly cron
```
Visiting `/run` triggers all adapters once and returns a summary — the fastest
way to confirm TED data is flowing.

**3. Dashboard** — open `web/index.html`. It shows sample data until you fill in
`SUPABASE_URL` and the **anon** key at the top of the file (the anon key is
read-only via RLS and safe to ship). Host it anywhere static — GitHub Pages,
Cloudflare Pages.

## Tuning relevance

Everything that decides what's relevant lives in `worker/src/lib/scoring.js`:
CPV families, Icelandic/English keyword lists, value and deadline boosts, tier
thresholds. Each opportunity stores its `signals` (why it scored as it did), so
you can see exactly why something ranked where it did and adjust.

## Roadmap (rough order)

1. TED adapter live → confirm the CPV filter surfaces useful results ← **start here**
2. Competition parser (AÍ + FÍLA) — fill in `parseListing`
3. Útboðsvefur email ingestion (Cloudflare Email Worker → parse → upsert)
4. Alerts for `is_major` items (email/push)
5. Capital-plan watchers, dashboard workflow states (shortlist/archive)
