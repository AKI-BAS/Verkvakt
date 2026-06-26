// adapters/competitions.js — Icelandic architecture competitions.
//
// These pages have no API, so this is light HTML scraping. They're the main
// channel where PRIVATE developers' opportunities surface (a developer running
// a forval "in cooperation with Arkitektafélag Íslands"), so they matter a lot
// even though they're lower-volume than TED.
//
// STATUS: structured stub. The fetch + selectors are sketched so you can drop
// in a parser once you've looked at the live markup. Each source is isolated:
// if FÍLA changes its HTML, AÍ keeps working, and the run log flags the break.
//
// Suggested approach: fetch the listing page, extract each item's title + link
// + date with a small HTML parser (e.g. the Worker-friendly `linkedom`, or a
// regex pass if the markup is simple), then return normalised rows.

const SOURCES = [
  { id: 'fila', name: 'FÍLA samkeppnir', url: 'https://fila.is/category/samkeppnir/asamkeppnir/' },
  { id: 'ai',   name: 'Arkitektafélag Íslands', url: 'https://www.honnunarmidstod.is/fagfelog/arkitektafelag-islands/frettir' },
];

// Parse one listing page's HTML into normalised opportunities.
// TODO: replace the placeholder with real extraction once markup is inspected.
function parseListing(html, src) {
  const items = [];
  // Example shape to aim for (one per competition found):
  // items.push({
  //   source: src.id,
  //   source_uid: <stable slug or absolute url>,
  //   title: <competition title>,
  //   buyer: <organiser, e.g. "Reykjavíkurborg" / developer name>,
  //   country: 'IS',
  //   cpv: [],                       // competitions rarely carry CPV
  //   notice_type: 'competition',
  //   url: <absolute link>,
  //   published_at: <iso date or null>,
  //   deadline_at: <iso date or null>,
  //   est_value: null, currency: null,
  //   raw: { html_snippet },
  // });
  return items;
}

export async function fetchCompetitions() {
  const out = [];
  for (const src of SOURCES) {
    const res = await fetch(src.url, {
      headers: { 'User-Agent': 'verkvakt/0.1 (architecture opportunity radar)' },
    });
    if (!res.ok) throw new Error(`${src.id} ${res.status}`);
    const html = await res.text();
    out.push(...parseListing(html, src));
  }
  return out;
}
