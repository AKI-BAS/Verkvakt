# Setup — a 2-hour morning

Goal by the end: live Icelandic architecture tenders from TED flowing into a
dashboard you can open in a browser. Competitions + útboðsvefur come later.

You need: a GitHub account, a Supabase account (free), a Cloudflare account
(free), and Node.js 18+ installed. Have the repo open in your editor.

---

## 0 · Push to GitHub — 10 min

```bash
cd verkvakt
git init
git add .
git commit -m "Verkvakt: initial scaffold"
# create an empty repo on github.com first, then:
git remote add origin git@github.com:YOURNAME/verkvakt.git
git push -u origin main
```

---

## 1 · Database — 20 min

1. Create a new project at supabase.com. Pick a region close to you
   (eu-central is fine). Wait for it to finish provisioning.
2. Left sidebar → **SQL Editor** → New query.
3. Open `schema.sql`, paste the whole thing in, click **Run**. You should see
   "Success". This creates the `opportunities` and `ingest_runs` tables, the
   `v_open_opportunities` view, and the read-only access rule.
4. Sidebar → **Project Settings → API**. Copy and keep three things:
   - **Project URL**            (e.g. https://abcd1234.supabase.co)
   - **anon public** key        (safe to put in the dashboard)
   - **service_role** key       (SECRET — only the worker uses it)

---

## 2 · Worker — 40 min

```bash
cd worker
npm install
```

Edit `wrangler.toml` → set `SUPABASE_URL` to your Project URL.

Log in and set the secret:
```bash
npx wrangler login                       # opens browser, authorise
npx wrangler secret put SUPABASE_SERVICE_KEY   # paste the service_role key
```

Run it locally and trigger one pull:
```bash
npx wrangler dev
# in another terminal (or just open the URL it prints):
curl http://localhost:8787/run
```

You should get JSON like:
```json
{ "summary": [ { "source": "ted", "found": 12, "upserted": 12, "ok": true },
               { "source": "competitions", "found": 0, "ok": true } ] }
```

- `found > 0` on **ted** → it's working. Check Supabase → Table Editor →
  `opportunities` to see the rows.
- `ted` shows `ok: false` with an error → read the message; it's almost always
  a TED query field name. Open `worker/src/adapters/ted.js`, check `COUNTRY`
  and the `classification-cpv` / `place-of-performance` field names against
  https://ted.europa.eu/expert-search, adjust, re-run. (Budgeted for this.)

When `/run` returns TED rows, deploy so the 6-hourly cron takes over:
```bash
npx wrangler deploy
```

---

## 3 · Dashboard — 20 min

1. Open `web/index.html`, set the two values at the top:
   ```js
   const SUPABASE_URL  = "https://abcd1234.supabase.co";
   const SUPABASE_ANON = "the anon public key";
   ```
2. Open the file in a real browser (not Claude's preview). The sample banner
   disappears and you see live TED rows. Links open the actual notices.
3. Host it: Cloudflare Pages or GitHub Pages, point it at `/web`. Or just keep
   opening the file locally for now.

```bash
git add -A && git commit -m "wire up live data" && git push
```

---

## If you finish early

- Widen the net: add or remove CPV codes in `ted.js` (`CPV` array) and keyword
  lists in `scoring.js`, re-run `/run`, watch what changes.
- Lengthen the look-back: `fetchTed({ sinceDays: 30 })` in `index.js` to pull a
  month instead of two weeks.
- Sanity-check the run log: Supabase → `ingest_runs` shows every run, so a
  source going quiet is visible.

## Not in this session (next time)

Competition parser (AÍ/FÍLA) · útboðsvefur email ingestion · alerts for
`is_major` items · dashboard shortlist/archive actions.
