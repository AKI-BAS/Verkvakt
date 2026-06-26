// index.js — the Worker. Runs on a schedule (and on-demand via a URL) to pull
// every source, score each opportunity, and upsert into Supabase.
//
// Each adapter is isolated in its own try/catch so one broken source never
// stops the others, and every run is logged to ingest_runs so a silently dead
// source is visible instead of just going quiet.

import { fetchTed } from './adapters/ted.js';
import { fetchCompetitions } from './adapters/competitions.js';
import { scoreOpportunity } from './lib/scoring.js';
import { upsertOpportunities, logRun } from './lib/supabase.js';

const ADAPTERS = [
  { name: 'ted',          run: () => fetchTed({ sinceDays: 14 }) },
  { name: 'competitions', run: () => fetchCompetitions() },
];

async function runAll(env) {
  const summary = [];

  for (const a of ADAPTERS) {
    const started = new Date().toISOString();
    try {
      const raw = await a.run();

      // score every item; keep the scorer's verdict on the row
      const rows = raw.map((o) => {
        const { score, tier, signals, is_major } = scoreOpportunity(o);
        return {
          ...o,
          score, tier,
          signals: JSON.stringify(signals),
          is_major,
          published_at: o.published_at || null,
          deadline_at: o.deadline_at || null,
        };
      });

      const upserted = await upsertOpportunities(env, rows);
      await logRun(env, {
        source: a.name, started_at: started,
        found: raw.length, upserted, ok: true, error: null,
      });
      summary.push({ source: a.name, found: raw.length, upserted, ok: true });
    } catch (err) {
      await logRun(env, {
        source: a.name, started_at: started,
        found: 0, upserted: 0, ok: false, error: String(err).slice(0, 500),
      });
      summary.push({ source: a.name, ok: false, error: String(err) });
    }
  }

  return summary;
}

export default {
  // Scheduled trigger (see wrangler.toml cron).
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAll(env));
  },

  // Manual trigger + a tiny health endpoint, handy while building.
  // GET /run    -> run all adapters now, return the summary
  // GET /health -> ok
  async fetch(req, env) {
    const { pathname } = new URL(req.url);
    if (pathname === '/run') {
      const summary = await runAll(env);
      return Response.json({ ran_at: new Date().toISOString(), summary });
    }
    return new Response('verkvakt worker ok', { status: 200 });
  },
};
