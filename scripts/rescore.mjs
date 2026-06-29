// rescore.mjs — re-run the CURRENT scorer over every stored row and patch the
// ones whose kind/tier/score/signals have drifted.
//
// Why this exists: the Worker only scores on ingest. When scoring.js improves,
// existing rows keep their OLD verdict until something re-touches them — which
// is how a news story (e.g. the "gangstéttir" sidewalk piece) can sit in the
// dashboard tagged opportunity/high long after the scorer learned to demote it.
// This is the re-score sibling of the planned skipulagsgátt sweep step.
//
// Preview-first: runs as a DRY RUN by default and prints every change it would
// make. Pass --apply to actually PATCH Supabase.
//
//   $env:SUPABASE_URL="https://eghjeemcfreihhzdbnnc.supabase.co"
//   $env:SUPABASE_SERVICE_KEY="<service-role key, NOT anon>"
//   node scripts/rescore.mjs            # dry run — shows the diff, writes nothing
//   node scripts/rescore.mjs --apply    # commit the changes

import { scoreOpportunity } from '../src/lib/scoring.js';
import { readFileSync, existsSync } from 'fs';

// Load .env from the repo root if present (zero-dependency). Already-set
// session/shell vars take precedence, so you can override per-run.
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (!(k in process.env)) process.env[k] = v;
  }
}

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const APPLY = process.argv.includes('--apply');
if (!URL || !KEY) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY'); process.exit(1); }

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

// Page through the table (PostgREST caps at 1000 rows per request).
async function fetchAll() {
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${URL}/rest/v1/opportunities?select=*&order=id.asc`, {
      headers: { ...H, Range: `${from}-${from + PAGE - 1}`, Prefer: 'count=exact' },
    });
    if (!res.ok) throw new Error(`fetch ${res.status}: ${await res.text()}`);
    const batch = await res.json();
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}

async function patch(id, fields) {
  const res = await fetch(`${URL}/rest/v1/opportunities?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...H, Prefer: 'return=minimal' },
    body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`patch ${id} ${res.status}: ${await res.text()}`);
}

const changed = (a, b) =>
  a.kind !== b.kind || a.tier !== b.tier || a.score !== b.score ||
  JSON.stringify(a.signals || []) !== JSON.stringify(b.signals || []);

const rows = await fetchAll();
console.log(`Loaded ${rows.length} rows. ${APPLY ? 'APPLYING changes.' : 'DRY RUN — no writes.'}\n`);

let n = 0;
for (const r of rows) {
  // Re-score from the same normalised fields the adapters produce.
  const v = scoreOpportunity({
    title: r.title, buyer: r.buyer, notice_type: r.notice_type,
    cpv: r.cpv, est_value: r.est_value, deadline_at: r.deadline_at,
    description: r.description ?? r.raw?.description, raw: r.raw,
  });
  const next = { kind: v.kind, tier: v.tier, score: v.score, signals: v.signals, is_major: v.is_major };
  if (!changed(r, next)) continue;
  n++;
  console.log(`• ${r.title?.slice(0, 60)}`);
  console.log(`    ${r.kind}/${r.tier}/${r.score}  ->  ${next.kind}/${next.tier}/${next.score}`);
  if (APPLY) await patch(r.id, next);
}

console.log(`\n${n} row(s) ${APPLY ? 'updated' : 'would change'}. ${APPLY ? '' : 'Re-run with --apply to commit.'}`);
