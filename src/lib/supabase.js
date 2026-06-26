// supabase.js — minimal Supabase writes from the Worker, via PostgREST.
// We use plain fetch (no SDK) to keep the Worker tiny. The Worker authenticates
// with the SERVICE ROLE key, which bypasses RLS — so keep that key a secret
// (wrangler secret), never in the dashboard.

function headers(env) {
  return {
    'Content-Type': 'application/json',
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
  };
}

// Upsert a batch of opportunities, merging on the (source, source_uid) key.
// Returns the number of rows written.
export async function upsertOpportunities(env, rows) {
  if (!rows.length) return 0;
  const url =
    `${env.SUPABASE_URL}/rest/v1/opportunities` +
    `?on_conflict=source,source_uid`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...headers(env),
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`supabase upsert ${res.status}: ${body}`);
  }
  return rows.length;
}

// Record how a source run went — so you can SEE when a source quietly dies.
export async function logRun(env, run) {
  const url = `${env.SUPABASE_URL}/rest/v1/ingest_runs`;
  await fetch(url, {
    method: 'POST',
    headers: { ...headers(env), Prefer: 'return=minimal' },
    body: JSON.stringify([{ ...run, finished_at: new Date().toISOString() }]),
  }).catch(() => {}); // logging must never break ingestion
}
