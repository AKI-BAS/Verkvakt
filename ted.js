// adapters/ted.js — Tenders Electronic Daily (the EU/EEA procurement journal).
//
// This is the highest-value source: structured, official, anonymous (no key),
// carries CPV codes, and — crucially — includes PINs (Prior Information
// Notices), which announce projects months before the formal tender. That's
// the lead-time win.
//
// API: POST https://api.ted.europa.eu/v3/notices/search   (no auth for reads)
// Query language: TED "expert search" syntax.
// Fair use: 700 requests/min — we're nowhere near that.

const TED_ENDPOINT = 'https://api.ted.europa.eu/v3/notices/search';

// ── Query knobs. If TED ever rejects the query, these field names are the
//    first thing to check against https://ted.europa.eu/expert-search ──
const COUNTRY = 'ISL'; // Iceland, TED 3-letter code (cf. LUX for Luxembourg)

// CPV families to pull at the QUERY level (coarse filter). The scorer refines
// afterwards. A main code matches its sub-codes automatically in TED.
// We deliberately include bundled arch+eng (7124x/7125x) but NOT bare 713x
// (pure engineering) — those would flood the feed and the studio doesn't do
// pure engineering. Interiors/landscape/planning are in via 712x/714x.
const CPV = ['71200000', '71400000', '71240000', '71250000', '79932000'];

// Fields we ask TED to return. Friendly names; the parser below reads them
// defensively because TED wraps many values as {language: value} or arrays.
const FIELDS = [
  'publication-number',
  'notice-title',
  'buyer-name',
  'buyer-country',
  'publication-date',
  'deadline-receipt-tender-date-lot',
  'classification-cpv',
  'notice-type',
  'place-of-performance',
  'links',
];

function buildQuery(sinceDays) {
  const cpvList = CPV.join(' ');
  let q = `place-of-performance IN (${COUNTRY})`
        + ` AND classification-cpv IN (${cpvList})`;
  if (sinceDays) {
    const d = new Date(Date.now() - sinceDays * 86_400_000);
    const ymd = d.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
    q += ` AND publication-date >= ${ymd}`;
  }
  return q;
}

// TED values are often {eng:"…", fra:"…"} or arrays. Pull a single string out.
function scalar(v) {
  if (v == null) return null;
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return scalar(v[0]);
  if (typeof v === 'object') {
    return scalar(v.eng ?? v.en ?? Object.values(v)[0]);
  }
  return null;
}

function listOf(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v.map(scalar).filter(Boolean) : [scalar(v)].filter(Boolean);
}

// Map a raw TED notice to our normalised shape (pre-scoring).
function normalize(n) {
  const pub = scalar(n['publication-number']);
  // Canonical deep-link to THIS specific notice (not the homepage). The notice
  // page is the official record and links onward to the buyer's tender docs.
  const url = pub ? `https://ted.europa.eu/en/notice/${pub}` : null;
  return {
    source: 'ted',
    source_uid: pub,
    title: scalar(n['notice-title']) || '(untitled TED notice)',
    buyer: scalar(n['buyer-name']),
    country: scalar(n['buyer-country']) || 'IS',
    cpv: listOf(n['classification-cpv']),
    notice_type: scalar(n['notice-type']),
    url,
    published_at: scalar(n['publication-date']),
    deadline_at: scalar(n['deadline-receipt-tender-date-lot']),
    est_value: null,         // value fields vary by form; add later if needed
    currency: null,
    raw: n,
  };
}

// Fetch all matching notices published in the last `sinceDays` days.
// Returns an array of normalised opportunities (un-scored).
export async function fetchTed({ sinceDays = 14 } = {}) {
  const out = [];
  let page = 1;
  const limit = 100;

  while (true) {
    const res = await fetch(TED_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        query: buildQuery(sinceDays),
        fields: FIELDS,
        limit,
        page,
        scope: 'ACTIVE',
        checkQuerySyntax: false,
        paginationMode: 'PAGE_NUMBER',
      }),
    });

    if (!res.ok) {
      // Surface TED's own message — usually it pinpoints the bad field.
      const body = await res.text();
      throw new Error(`TED ${res.status}: ${body.slice(0, 400)}`);
    }

    const data = await res.json();
    const notices = data.notices || data.results || [];
    for (const n of notices) {
      const norm = normalize(n);
      if (norm.source_uid) out.push(norm);
    }

    const total = data.totalNoticeCount ?? data.total ?? out.length;
    if (notices.length < limit || out.length >= total || page >= 25) break;
    page += 1;
  }

  return out;
}
