// adapters/competitions.js — Icelandic architecture competitions (FÍLA).
//
// FÍLA's REST API is auth-locked, but its RSS feed is open — and RSS is far
// more stable than scraping HTML (it won't break when they restyle the site),
// so we read the feed. Each <item> gives title, link, pubDate, categories and
// a description rich with keywords for the scorer.
//
// Feed: https://fila.is/category/samkeppnir/asamkeppnir/feed/  ("Auglýstar
// samkeppnir" = advertised competitions). All items here are competition-
// related; the scorer ranks them, so we keep them all.
//
// Strict by design: if the feed has zero <item>s, we throw, so the run is
// logged as failed in ingest_runs instead of silently going dark.
 
const SOURCES = [
  { id: 'fila', name: 'FÍLA', url: 'https://fila.is/category/samkeppnir/asamkeppnir/feed/' },
];
 
// pull the first capture group of a regex, or null
function pick(xml, re) {
  const m = xml.match(re);
  return m ? m[1] : null;
}
 
// decode the handful of XML/HTML entities that appear in these feeds
function decode(s) {
  if (!s) return s;
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#173;|&shy;/g, '')      // soft hyphens inside words
    .replace(/&#160;|&nbsp;/g, ' ')
    .replace(/&#8211;/g, '–')
    .replace(/&#8217;|&#8216;|&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}
 
function parseFeed(xml, src) {
  const items = [];
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
 
  for (const block of blocks) {
    const title = decode(pick(block, /<title>([\s\S]*?)<\/title>/i));
    const link  = decode(pick(block, /<link>([\s\S]*?)<\/link>/i));
    if (!title || !link) continue;
 
    // stable id: the WordPress post id from the guid (…/?p=2626)
    const guid = pick(block, /<guid[^>]*>([\s\S]*?)<\/guid>/i) || link;
    const idMatch = guid.match(/[?&]p=(\d+)/);
    const sourceUid = idMatch ? idMatch[1] : link;
 
    // RFC-822 date in pubDate parses directly
    const pub = pick(block, /<pubDate>([\s\S]*?)<\/pubDate>/i);
    const published_at = pub ? new Date(pub).toISOString() : null;
 
    const description = decode(pick(block, /<description>([\s\S]*?)<\/description>/i));
 
    items.push({
      source: src.id,
      source_uid: sourceUid,
      title,
      // organiser is named in the description (e.g. "Reykjavíkurborg",
      // "Fasteignaþróunarfélagið Spilda ehf"); we keep the text for the scorer
      buyer: null,
      country: 'IS',
      cpv: [],
      notice_type: 'competition',
      url: link,
      published_at,
      deadline_at: null,    // not in the feed; lives on the detail page
      est_value: null,
      currency: null,
      // expose the description so the scorer can read its keywords
      description,
      raw: { description },
    });
  }
 
  if (items.length === 0) {
    throw new Error(`${src.id}: feed fetched but 0 items (feed format may have changed)`);
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
    const xml = await res.text();
    out.push(...parseFeed(xml, src));
  }
  return out;
}