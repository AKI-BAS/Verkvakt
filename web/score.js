// scoring.js — decide how relevant an opportunity is to the studio.
//
// Philosophy: never silently drop. We SCORE and RANK. Pure-construction and
// pure-engineering jobs sink to the bottom; they don't disappear. The studio
// said the goal is "more to choose from", so over-surfacing is the safe error.
//
// The output is explainable on purpose — `signals` records *why* something
// scored as it did, so a low score is auditable rather than mysterious.
//
// Tune the lists below freely; they're the whole policy of the tool.

// ── What the studio does: architecture, interiors, exteriors, planning,
//    full service through construction. NOT pure electrical/plumbing/eng. ──

// CPV families that are squarely architecture/design/planning (incl. bundled
// arch+eng packages the studio leads or partners on). Matched as prefixes.
const CPV_POSITIVE = [
  '712',     // architectural & related services
  '714',     // urban planning & landscape architecture
  '71240',   // architectural, engineering and planning services (bundled)
  '71250',   // architectural, engineering and surveying services (bundled)
  '71530',   // construction consultancy
  '79932',   // interior design services
  '79933',   // design support / stage-set & similar
];

// CPV families that are pure non-architecture. Strong negative.
const CPV_NEGATIVE = [
  '4531',    // electrical installation
  '4533',    // plumbing, heating, ventilation (MEP)
  '7131',    // pure consultative engineering (no design lead)
  '7132',    // engineering design only
  '45',      // construction works (contractor scope) — soft, see note below
  '90',      // cleaning, environmental services
  '50',      // repair & maintenance
];
// Note: '45' (works) is broad. We treat it as a *mild* negative because some
// design-build packages carry a 45 code alongside a 712 code — the positive
// 712 match wins. A bare 45-only notice is a contractor job and sinks.

// Keyword signals (case/diacritic-insensitive). Icelandic first, English after.
const KW_POSITIVE = [
  'arkitekt', 'arkitektúr', 'hönnun', 'fullnaðarhönnun', 'heildarhönnun',
  'skipulag', 'deiliskipulag', 'aðalskipulag', 'rammaskipulag',
  'innanhúss', 'innanhússarkitekt', 'landslag', 'landslagsarkitekt',
  'hönnunarsamkeppni', 'hugmyndasamkeppni', 'framkvæmdasamkeppni', 'forval',
  'byggingarlist', 'mannvirkjahönnun', 'útlit', 'endurhönnun', 'viðbygging',
  'nýbygging', 'hugmyndaleit', 'samkeppni um hönnun', 'samkeppni um skipulag',
  // English
  'architect', 'architectural', 'design competition', 'urban planning',
  'landscape architect', 'masterplan', 'master plan', 'interior design',
];

const KW_NEGATIVE = [
  'raflagnir', 'rafhönnun', 'rafmagn', 'raforku', 'pípulagnir', 'lagnahönnun',
  'lagnir', 'loftræsti', 'loftræsting', 'burðarþol', 'burðarvirki',
  'malbik', 'malbikun', 'jarðvinna', 'gröftur', 'vegagerð', 'vegir',
  'snjómokstur', 'ræsting', 'sorphirða', 'steypuvinna', 'jarðstrengur',
  'slökkvikerfi', 'brunaviðvörun', 'efnisvinnsla',
  // English
  'electrical installation', 'plumbing', 'asphalt', 'earthworks', 'road works',
];

// strip Icelandic diacritics so "hönnun" matches "honnun" etc.
function fold(s = '') {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/þ/g, 'th').replace(/ð/g, 'd').replace(/æ/g, 'ae');
}

function cpvHits(cpvList, prefixes) {
  const hits = [];
  for (const code of cpvList || []) {
    const c = String(code).replace(/\D/g, '');
    for (const p of prefixes) if (c.startsWith(p)) { hits.push(code); break; }
  }
  return hits;
}

function kwHits(haystack, words) {
  const h = fold(haystack);
  return words.filter((w) => h.includes(fold(w)));
}

// Main entry. opp = normalised opportunity { title, buyer, notice_type,
// cpv:[], est_value, deadline_at, ... }. Returns { score, tier, signals, is_major }.
export function scoreOpportunity(opp) {
  const text = [opp.title, opp.buyer, opp.notice_type].filter(Boolean).join(' · ');
  const signals = [];
  let score = 0;

  // CPV is the strongest, most reliable signal (when present — TED has it).
  const cpvPos = cpvHits(opp.cpv, CPV_POSITIVE);
  const cpvNeg = cpvHits(opp.cpv, CPV_NEGATIVE);
  if (cpvPos.length) { score += 40; signals.push(`cpv+ ${cpvPos.join(',')}`); }
  if (cpvNeg.length) { score -= 25; signals.push(`cpv- ${cpvNeg.join(',')}`); }

  // Keyword signals (the only thing we have for sources without CPV).
  const kwPos = kwHits(text, KW_POSITIVE);
  const kwNeg = kwHits(text, KW_NEGATIVE);
  if (kwPos.length) { score += 12 * kwPos.length; signals.push(`kw+ ${kwPos.join(',')}`); }
  if (kwNeg.length) { score -= 10 * kwNeg.length; signals.push(`kw- ${kwNeg.join(',')}`); }

  // Competitions are prime architecture opportunities — nudge them up.
  if (/samkeppni|competition|forval|hugmyndaleit/i.test(text)) {
    score += 15; signals.push('competition');
  }

  // Value boost (bigger projects are worth surfacing higher).
  const v = Number(opp.est_value) || 0;
  if (v >= 50_000_000) { score += 20; signals.push('value≥50M'); }
  else if (v >= 10_000_000) { score += 10; signals.push('value≥10M'); }

  // Deadline urgency: closing soon should rise even at equal relevance.
  const daysLeft = opp.deadline_at
    ? (new Date(opp.deadline_at) - Date.now()) / 86_400_000 : null;
  if (daysLeft != null && daysLeft >= 0 && daysLeft <= 7) {
    score += 8; signals.push('closing≤7d');
  }

  // Tier thresholds — tune to taste once you've watched real data flow.
  let tier = 'low';
  if (score >= 50) tier = 'high';
  else if (score >= 20) tier = 'medium';
  if (cpvPos.length === 0 && kwPos.length === 0 && (cpvNeg.length || kwNeg.length))
    tier = 'excluded';

  // "Major" = worth an active alert, not just a dashboard row.
  const is_major =
    tier === 'high' && (v >= 50_000_000 || (daysLeft != null && daysLeft <= 14));

  return { score, tier, signals, is_major };
}
