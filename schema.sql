-- Verkvakt — database schema (Supabase / Postgres)
-- Run this in the Supabase SQL editor once to set everything up.
-- Re-running is safe: it uses IF NOT EXISTS / CREATE OR REPLACE throughout.

-- ──────────────────────────────────────────────────────────────────────────
-- opportunities: one row per tender / competition, from any source
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.opportunities (
  id            uuid primary key default gen_random_uuid(),

  -- natural key: which source, and that source's own id for the item.
  -- (TED -> publication-number, AÍ/FÍLA -> post slug, etc.)
  source        text not null,
  source_uid    text not null,

  -- core fields, normalised across every source
  title         text not null,
  buyer         text,
  country       text,
  cpv           text[] default '{}',     -- CPV codes when available (TED)
  notice_type   text,                    -- e.g. cn-standard, pin, competition
  url           text,                    -- canonical link back to the source
  published_at  timestamptz,
  deadline_at   timestamptz,
  est_value     numeric,
  currency      text,

  -- relevance, computed by the scorer (see worker/src/lib/scoring.js)
  score         integer default 0,
  tier          text default 'low',      -- high | medium | low | excluded
  signals       jsonb default '[]'::jsonb, -- why it scored this way (explainable)
  is_major      boolean default false,   -- flagged for an alert

  -- light workflow state you can drive from the dashboard later
  status        text default 'new',      -- new | seen | shortlisted | archived

  raw           jsonb,                   -- original payload, for debugging
  first_seen_at timestamptz default now(),
  updated_at    timestamptz default now(),

  unique (source, source_uid)
);

create index if not exists idx_opps_score    on public.opportunities (score desc);
create index if not exists idx_opps_deadline on public.opportunities (deadline_at);
create index if not exists idx_opps_source   on public.opportunities (source);
create index if not exists idx_opps_status   on public.opportunities (status);

-- keep updated_at fresh on every change
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_touch_opps on public.opportunities;
create trigger trg_touch_opps before update on public.opportunities
  for each row execute function public.touch_updated_at();

-- ──────────────────────────────────────────────────────────────────────────
-- ingest_runs: a log line per adapter run, so a silent dead source is visible
-- (the one real failure mode for a "don't miss projects" tool)
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.ingest_runs (
  id          uuid primary key default gen_random_uuid(),
  source      text not null,
  started_at  timestamptz default now(),
  finished_at timestamptz,
  found       integer default 0,   -- items the source returned
  upserted    integer default 0,   -- new or changed rows written
  ok          boolean default false,
  error       text
);
create index if not exists idx_runs_source on public.ingest_runs (source, started_at desc);

-- ──────────────────────────────────────────────────────────────────────────
-- dashboard view: open opportunities (no deadline, or deadline in the future),
-- not archived, ranked. The dashboard reads from this.
-- ──────────────────────────────────────────────────────────────────────────
create or replace view public.v_open_opportunities as
  select id, source, source_uid, title, buyer, country, cpv, notice_type, url,
         published_at, deadline_at, est_value, currency,
         score, tier, signals, is_major, status, first_seen_at, updated_at
  from public.opportunities
  where status <> 'archived'
    and (deadline_at is null or deadline_at >= now())
  order by is_major desc, score desc, deadline_at asc nulls last;

-- ──────────────────────────────────────────────────────────────────────────
-- Row Level Security
--  - anon (the dashboard, using the public anon key) may READ only.
--  - the Worker writes with the service_role key, which bypasses RLS.
-- ──────────────────────────────────────────────────────────────────────────
alter table public.opportunities enable row level security;

drop policy if exists "anon read opportunities" on public.opportunities;
create policy "anon read opportunities"
  on public.opportunities for select
  to anon
  using (true);
