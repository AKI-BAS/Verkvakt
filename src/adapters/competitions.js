// adapters/competitions.js — Icelandic architecture competitions (FÍLA).
//
// Source: the FÍLA "Auglýstar samkeppnir" RSS feed (stable, no auth). For each
// competition we then fetch the detail page to find the real deadline.
//
// Deadlines on these pages are a human-written schedule, e.g.:
//   29. mars – Forval ... auglýst
//   19. apríl – Skil á forvalsgögnum        <-- FIRST action deadline (target)
//   14. júní – Þátttakendur skila inn tillögum
// The dates carry NO year, so we anchor the year to the feed's publication date
// (which matches the schedule's first line) and roll forward if a deadline
// month is earlier than the publication month.
//
// We target the FIRST submission ("skil"/"frestur") date — when you must act to
// get in. If no deadline can be found confidently, deadline_at stays null
// rather than guessing a wrong date.
 
const SOURCES = [
  { id: 'fila', name: 'FÍLA', url: 'https://fila.is/category/samkeppnir/asamkeppnir/feed/' },
];
 
const MONTHS = {
  'januar': 0, 'februar': 1, 'mars': 2, 'april': 3, 'mai': 4, 'juni': 5,
  'juli': 6, 'agust': 7, 'september': 8, 'oktober': 9, 'november': 10, 'desember': 11,
};
 
function fold(s = '') {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .replace(/þ/g, 'th').replace(/ð/g, 'd').replace(/æ/g, 'ae');
}
function pick(xml, re) { const m = xml.match(re); return m ? m[1] : null; }
 
function decode(s) {
  if (!s) return s;
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#173;|&shy;/g, '')
    .replace(/&#160;|&nbsp;/g, ' ')
    .replace(/&#8211;|&#8212;/g, '–')
    .replace(/&#8217;|&#8216;|&#039;/g, "'")
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}
function stripTags(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ')
             .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}
 
function resolveYear(day, monthIdx, pubDate) {
  const pubYear = pubDate.getUTCFullYear();
  const pubMonth = pubDate.getUTCMonth();
  let year = pubYear;
  if (monthIdx < pubMonth) year = pubYear + 1; // schedule rolled into next year
  return new Date(Date.UTC(year, monthIdx, day));
}
 
// First action deadline from the detail-page text. ISO string or null.
function extractDeadline(text, pubDate) {
  const dateRe = /(\d{1,2})\.\s*([a-záðéíóúýþæö]+)/gi;
  const raw = [];
  let m;
  while ((m = dateRe.exec(text)) !== null) {
    const monthIdx = MONTHS[fold(m[2])];
    if (monthIdx == null) continue;
    raw.push({ day: parseInt(m[1], 10), monthIdx, index: m.index });
  }
  if (!raw.length) return null;
 
  // context for each date = text up to the NEXT date, so schedule lines don't bleed
  const cands = raw.map((r, i) => {
    const end = i + 1 < raw.length ? raw[i + 1].index : Math.min(text.length, r.index + 80);
    return { ...r, ctx: fold(text.slice(r.index, end)), at: resolveYear(r.day, r.monthIdx, pubDate) };
  });
 
  const isAction = (c) =>
    /\bskil\b|skila|forvalsgogn|frestur|rennur ut|berast eigi sidar/.test(c.ctx);
 
  const actions = cands.filter(isAction).sort((a, b) => a.at - b.at);
  return actions.length ? actions[0].at.toISOString() : null; // don't guess
}
 
async function fetchDeadline(url, pubDate) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'verkvakt/0.1 (architecture opportunity radar)' },
    });
    if (!res.ok) return null;
    return extractDeadline(stripTags(await res.text()), pubDate);
  } catch {
    return null; // best-effort; never break the run for a detail fetch
  }
}
 
function parseFeedItems(xml) {
  const items = [];
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  for (const block of blocks) {
    const title = decode(pick(block, /<title>([\s\S]*?)<\/title>/i));
    const link  = decode(pick(block, /<link>([\s\S]*?)<\/link>/i));
    if (!title || !link) continue;
    const guid = pick(block, /<guid[^>]*>([\s\S]*?)<\/guid>/i) || link;
    const idMatch = guid.match(/[?&]p=(\d+)/);
    const pub = pick(block, /<pubDate>([\s\S]*?)<\/pubDate>/i);
    const description = decode(pick(block, /<description>([\s\S]*?)<\/description>/i));
    items.push({
      source_uid: idMatch ? idMatch[1] : link,
      title, link, description,
      published_at: pub ? new Date(pub).toISOString() : null,
    });
  }
  return items;
}
 
export async function fetchCompetitions() {
  const out = [];
  for (const src of SOURCES) {
    const res = await fetch(src.url, {
      headers: { 'User-Agent': 'verkvakt/0.1 (architecture opportunity radar)' },
    });
    if (!res.ok) throw new Error(`${src.id} ${res.status}`);
    const feedItems = parseFeedItems(await res.text());
    if (feedItems.length === 0) {
      throw new Error(`${src.id}: feed fetched but 0 items (format may have changed)`);
    }
 
    for (const it of feedItems) {
      const pubDate = it.published_at ? new Date(it.published_at) : null;
      const deadline_at = pubDate ? await fetchDeadline(it.link, pubDate) : null;
      out.push({
        source: src.id,
        source_uid: it.source_uid,
        title: it.title,
        buyer: null,
        country: 'IS',
        cpv: [],
        notice_type: 'competition',
        url: it.link,
        published_at: it.published_at,
        deadline_at,
        est_value: null,
        currency: null,
        description: it.description,
        raw: { description: it.description, deadline_source: deadline_at ? 'detail-page' : 'none' },
      });
    }
  }
  return out;
}