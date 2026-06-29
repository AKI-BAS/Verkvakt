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
 
// ── Discipline-aware signals for description-rich sources (byggingar, skipulagsgátt).
//    These matter most where there's no CPV to lean on.
 
// Design itself is being procured -> the opportunity we most want.
// NB: bare 'hönnun'/'hönnuður' are deliberately ABSENT here — in Icelandic the
// discipline is the PREFIX (raflagnahönnun = electrical, pípulagnahönnun =
// plumbing), so only discipline-safe tokens belong in this boost.
const KW_DESIGN = [
  'arkitekt', 'hönnunarsamkeppni', 'skipulagsráðgjöf', 'deiliskipulagsgerð',
  'óskað eftir hönnuðum','óskað eftir ráðgjöfum','óskað eftir arkitekt','byggingarlist',
  'landslagsarkitekt','landslagshönnun','landslagsarkitektúr',
];
 
// Construction EXECUTION terms -> a build tender (design already done), not a
// design lead. Surfaced but sunk: the studio does CA, but these aren't design work.
const KW_WORKS = [
  'jarðvinna', 'uppsteypa', 'mótasmíði', 'steinsteypa', 'magntölur', 'magntala',
  'þakfrágang', 'utanhússklæðning', 'gólfhitalagnir', 'frárennslislagnir',
  'tilboð í verkið', 'loftstokkar', 'uppgrafið efni', 'steypa', 'verktaki',
];
 
// Financial / corporate news (byggingar carries earnings stories) -> not an
// opportunity at all.
const KW_NOISE = [
  'rekstrarafkoma', 'rekstrarbati', 'ársreikning', 'eigið fé', 'ebitda',
  'rekstrargjöld', 'dótturfélag', 'afkoma', 'fjárhags- og starfsáætlun',
  'hagnað', 'velta ',
];
 
// Development / redevelopment LEAD -> design work coming upstream (max lead time).
// Bare 'deiliskipulag' is intentionally absent — too generic (most of
// skipulagsgátt); these are the SCALE qualifiers that mark a real project.
const KW_LEAD = [
  'fasteignaþróun', 'niðurrif', 'nýjar íbúðir', 'þróunarreit', 'byggingarheimildir',
  'uppbygging', 'íbúðir auk', 'blönduð byggð', 'rammaskipulag',
];
 
// strip Icelandic diacritics so "hönnun" matches "honnun" etc.
// Off-scope disciplines Doric Corner does not do: MEP/utility/civil works and
// grounds/forestry maintenance. With ≥2 hits and no design role, these are excluded.
const KW_OFFSCOPE = [
  'lagnaframkvæmd','fráveitulögn','fráveitulagn','neysluvatnslögn','neysluvatnslagn',
  'hitaveitulögn','hitaveitulagn','rafveitulögn','rafveitulagn','fjarskiptalögn','fjarskiptalagn',
  'veitukerfi','veitulögn','veitulagn','vatnslögn','vatnslagn','gatnagerð','gatnaframkvæmd','malbik',
  'trjáfelling','grisjun','hirðing grænna','hirðingu grænna','grænna svæða','kurlun',
  'stubbatæting','trjáklifur','kjarrsögun','garðyrkja','sláttur','gróðursetning','skóglend',
];
 
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
// cpv:[], est_value, deadline_at, description, ... }.
// Returns { score, tier, signals, is_major }.
export function scoreOpportunity(opp) {
  const text = [opp.title, opp.buyer, opp.notice_type, opp.description].filter(Boolean).join(' · ');
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
 
  // Discipline-aware signals (mainly for description-rich, CPV-less sources).
  const kwDesign = kwHits(text, KW_DESIGN);
  const kwWorks  = kwHits(text, KW_WORKS);
  const kwNoise  = kwHits(text, KW_NOISE);
  const kwLead   = kwHits(text, KW_LEAD);
 
  if (kwDesign.length) { score += 18 * Math.min(kwDesign.length, 3); signals.push(`design+ ${kwDesign.join(',')}`); }
  if (kwLead.length)   { score += 12 * Math.min(kwLead.length, 3);   signals.push(`lead+ ${kwLead.join(',')}`); }
  if (kwNoise.length)  { score -= 35; signals.push(`noise ${kwNoise.slice(0, 3).join(',')}`); }
 
  // Works-execution tender with no design role = build contract, not a design lead.
  const isWorksTender = kwWorks.length >= 2 && kwDesign.length === 0;
  const kwOff = kwHits(text, KW_OFFSCOPE);
  const isOffScope = kwOff.length >= 2 && kwDesign.length === 0;
  if (isOffScope) signals.push(`off-scope ${kwOff.slice(0, 3).join(',')}`);
  if (isWorksTender) { score -= 28; signals.push(`works(${kwWorks.length}) no-design`); }
  else if (kwWorks.length) { score -= 5 * kwWorks.length; signals.push(`works- ${kwWorks.join(',')}`); }
 
  // Competitions are prime architecture opportunities — nudge them up.
  const isCompetition = /samkeppni|competition|forval|hugmyndaleit/i.test(text);
  if (isCompetition) { score += 15; signals.push('competition'); }
 
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
  const anyPositive = cpvPos.length || kwPos.length || kwDesign.length || kwLead.length;
  let tier = 'low';
  if (score >= 50) tier = 'high';
  else if (score >= 20) tier = 'medium';
 
  // Exclusions: financial news, or strong negatives with nothing positive.
  if (kwNoise.length && !anyPositive) tier = 'excluded';
  if (!anyPositive && (cpvNeg.length || kwNeg.length || isWorksTender)) tier = 'excluded';
  // A build tender shouldn't ride building-type keywords up to high/medium.
  if (isWorksTender && (tier === 'high' || tier === 'medium')) tier = 'low';
  if (isOffScope) tier = 'excluded'; // MEP/utility/grounds with no design role
 
  // "Major" = worth an active alert, not just a dashboard row.
  const is_major =
    tier === 'high' && (v >= 50_000_000 || (daysLeft != null && daysLeft <= 14));
 
  // ── kind: actionable opportunity vs editorial/planning news ────────────────
  // The planning portal (skipulagsgátt, notice_type 'planning') and the news
  // feed (byggingar, notice_type 'news') are mostly NOT biddable work — routine
  // zoning notices, road changes, financial stories. They default to NEWS so
  // they don't drown the dashboard. But we must NOT bury the strategic ones: a
  // competition launch, a design RFP, or a real development lead hiding in those
  // feeds gets promoted to OPPORTUNITY. Tender feeds (TED, FÍLA, útboðsvefur)
  // are biddable by nature, so they default to OPPORTUNITY.
 
  // Explicit tender-invitation language not already captured above.
  const invitesTender =
    /býður út|óskar eftir tilboð|óskað er eftir tilboð|auglýsir útboð|óskað eftir hönnuð|óskað eftir arkitekt|óskað eftir ráðgjöf/i.test(text);
 
  // A surface-worthy signal: design procurement, development lead, competition,
  // tender invitation, or a hard CPV architecture match.
  const strategic =
    cpvPos.length || kwDesign.length || kwLead.length || isCompetition || invitesTender;
 
  // Planning case already concluded — history, not a lead.
  const closedCase =
    (opp.raw && /lokið/i.test(String(opp.raw.stada ?? ''))) ||
    /lokið/i.test(String(opp.description ?? ''));
 
  // Project already awarded / underway / finished — the bid is gone, so it's
  // news even if development lead words (niðurrif, uppbygging…) match.
  const concludedStage =
    /í fullum gangi|stendur (nú )?yfir|fyrsta skóflustung|skóflustung\w* (var )?tekin|framkvæmdir (eru )?hafnar|framkvæmdir hófust|langt komin|langt komið|nær tilbúin|er tilbúin|fullbúin|tekið í notkun|vígð|vígt|vígsla|samdi við|samningur undirritaður|verksamningur|gengið til samninga|reyndist lægstbjóðandi|lægstbjóðandi í útboði|var boðið út|fær samning|fékk samning|framkvæmdum ljúk|framkvæmdum lýkur/i.test(text);
 
// Editorial commentary, not a live bid: a project being debated, cancelled,
  // deemed too costly, or a planning inquiry/decision outcome being reported.
  const editorialVeto =
    /óraunhæf|aldrei að veruleika|of dýr|of dýrt|fram úr áætlun|hætt við|harðlega gagnrýnt|gagnrýnd|hefur verið neitað|var (synjað|hafnað|neitað)|synjað um|skipulagsfulltrúi (gaf|féllst|hafnaði|synjaði)|umsögn skipulagsfulltrúa/i.test(text);
 
  const editorialSource = opp.notice_type === 'news' || opp.notice_type === 'planning'; 
  let kind;
  if (editorialSource) {
    // A live invitation always wins; otherwise a concluded/underway/finished
    // project is news even when lead or CPV signals match.
    const promote = strategic && !closedCase && (invitesTender || (!concludedStage && !editorialVeto));
    kind = promote ? 'opportunity' : 'news';
    if (kind === 'opportunity') signals.push('promoted-from-feed');
    else if (concludedStage) signals.push('past-stage');
    else if (editorialVeto) signals.push('editorial');
  } else {
    kind = (kwNoise.length && !strategic) ? 'news' : 'opportunity';
  }
 
  // ── Actionability gate ─────────────────────────────────────────────────────
  // Tier above measures topical relevance. But a NEWS item is intel, not a
  // biddable lead, however architecture-dense it is. It belongs in the News
  // lane — never atop the opportunity ranking. So cap news prominence here
  // (demote, don't exclude: cancellation/closed-case stories are still useful
  // forward signals). The raw score is preserved in the signal for audit.
  if (kind === 'news' && (tier === 'high' || tier === 'medium')) {
    signals.push(`news-capped(was ${tier}, score ${score})`);
    tier = 'low';
  }
 
  // A surfaced opportunity should never out-rank on a pure off-scope/works read
  // either — already handled above for tiers, but make is_major honest about kind.
  const is_major_final = is_major && kind === 'opportunity';
 
  return { score, tier, signals, is_major: is_major_final, kind };
}