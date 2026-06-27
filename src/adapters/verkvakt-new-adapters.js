 verkvakt-new-adapters.js
 Drop-in adapter stubs for three new Verkvakt sources, matching the existing
 fetch-based, minimal-dependency style (Cloudflare Workers + Supabase).

 Each adapter returns an array of normalized records
   { source, sourceId, title, description, url, publishedAt, deadline }
 Feed those through your existing relevance scorer + Supabase upsert,
 keyed on (source, sourceId) so re-runs are idempotent.
 
 =========================================================================
  1) SKIPULAGSGÁTT  —  OGC API Features (planning  EIA  build-permit cases)
     Base httpsskipulagsgatt.isapiissuesogc
     Collection SkipulagsgattMerki = one marker per case + base case info.
     NOTE the service has NO dateproperty filter (only bbox + pagination),
     so we page through everything and let the Supabase upsert dedupe.
     The exact property keys weren't confirmable remotely — on first run this
     logs the keys of feature[0].properties so you can finalize the mapping.
  ========================================================================= 
 
const SKG_BASE = httpsskipulagsgatt.isapiissuesogc;
const SKG_COLLECTION = SkipulagsgattMerki;
 
 Optional restrict to regions you care about. bbox is minLon,minLat,maxLon,maxLat (EPSG4326).
 Greater Reykjavík ≈ -22.1,63.95,-21.5,64.25. Leave null to pull the whole country.
const SKG_BBOX = null;
 
async function fetchSkipulagsgatt({ pageSize = 200, maxPages = 25 } = {}) {
  const out = [];
  let startIndex = 0;
  let loggedSchema = false;
 
  for (let page = 0; page  maxPages; page++) {
    const params = new URLSearchParams({
      limit String(pageSize),
      startIndex String(startIndex),
      crs httpwww.opengis.netdefcrsEPSG04326,
    });
    if (SKG_BBOX) params.set(bbox, SKG_BBOX);
 
    const url = `${SKG_BASE}collections${SKG_COLLECTION}items${params}`;
    const res = await fetch(url, { headers { Accept applicationgeo+json } });
    if (!res.ok) throw new Error(`Skipulagsgátt ${res.status} @ startIndex ${startIndex}`);
 
    const fc = await res.json();
    const features = fc.features  [];
    if (features.length === 0) break;
 
    if (!loggedSchema && features[0]) {
       One-time discover the real property names, then tighten the mapping below.
      console.log(SKG property keys, Object.keys(features[0].properties  {}));
      loggedSchema = true;
    }
 
    for (const f of features) {
      const p = f.properties  {};
       TODO replace these guesses with the real keys from the log above.
      const caseNo = p.malsnumer  p.caseNumber  p.number  f.id;
      out.push({
        source skipulagsgatt,
        sourceId String(caseNo),
        title p.heiti  p.title  p.name  `Mál ${caseNo}`,
        description p.lysing  p.description  p.malsflokkur  ,
        url `httpsskipulagsgatt.isissues${caseNo}`,
        publishedAt p.birt  p.published  p.dagsetning  null,
        deadline p.frestur  p.athugasemdafrestur  p.deadline  null,
      });
    }
 
    if (features.length  pageSize) break;  last page
    startIndex += pageSize;
  }
  return out;
}
 
 =========================================================================
  2) BYGGINGAR.IS  —  WordPress REST API (constructionarchitecture news,
     incl. competition launches + útboð openings + Félagsbústaðir etc.)
     Native after= date filtering. Lean on the scorer — this feed is noisy.
  ========================================================================= 
 
const BYG_BASE = httpsbyggingar.iswp-jsonwpv2posts;
 
async function fetchByggingar({ sinceISO = null, perPage = 50, maxPages = 5 } = {}) {
  const out = [];
  for (let page = 1; page = maxPages; page++) {
    const params = new URLSearchParams({
      per_page String(perPage),
      page String(page),
      orderby date,
      order desc,
      _fields id,date_gmt,link,title,excerpt,content,categories,
    });
    if (sinceISO) params.set(after, sinceISO);  e.g. last successful run timestamp
 
    const res = await fetch(`${BYG_BASE}${params}`);
    if (res.status === 400) break;  WP returns 400 when page  available pages
    if (!res.ok) throw new Error(`byggingar.is ${res.status} @ page ${page}`);
 
    const posts = await res.json();
    if (!Array.isArray(posts)  posts.length === 0) break;
 
    for (const post of posts) {
      const strip = (h) = (h  ).replace([^]+g,  ).replace(s+g,  ).trim();
      out.push({
        source byggingar,
        sourceId String(post.id),
        title strip(post.title.rendered),
        description strip(post.excerpt.rendered)  strip(post.content.rendered).slice(0, 600),
        url post.link,
        publishedAt post.date_gmt  `${post.date_gmt}Z`  null,
        deadline null,  parse from content via your Icelandic-date extractor if scored relevant
      });
    }
    if (posts.length  perPage) break;
  }
  return out;
}
 
 =========================================================================
  3) TED  —  widen your EXISTING adapter's expert query to catch the two
     earliest-stage notice families you're likely missing
       • design contests  (architecture competitions ≥ EEA threshold)
       • planning  PINs   (buyer signals intent before the contract notice)
     Confirm the exact notice-type tokens in the eForms SDK notice-types.json
     against your working TED adapter before shipping.
  ========================================================================= 
 
const TED_CPV_PREFIXES = [712, 713, 714, 715];  your architecture families
 
function buildTedExpertQuery({
  country = ISL,
  cpvPrefixes = TED_CPV_PREFIXES,
  sinceYYYYMMDD = null,  e.g. 20251230
} = {}) {
  const cpv = cpvPrefixes.map((p) = `classification-cpv=${p}`).join( OR );
 
   form-type=planning  - PIN  prior-information (early signal)
   notice-type design-contest tokens - verify spelling in notice-types.json
  const earlyStage =
    `form-type=planning ` +
    `OR notice-type=cn-desg OR notice-type=can-desg`;  -- confirm tokens
 
  const parts = [
    `place-of-performance=${country}`,
    `(${cpv})`,
    `(${earlyStage} OR form-type=competition OR form-type=result)`,
  ];
  if (sinceYYYYMMDD) parts.push(`publication-date=${sinceYYYYMMDD}`);
  return parts.join( AND );
}
 
 Example call into the v3 Search API (anonymous; no auth needed for reuse).
 Mirror whatever request shape your existing TED adapter already uses.
async function fetchTedEarlyStage({ sinceYYYYMMDD = null } = {}) {
  const body = {
    query buildTedExpertQuery({ sinceYYYYMMDD }),
    fields [publication-number, notice-title, publication-date, deadline-receipt-tender],
    limit 100,
    page 1,
    scope ALL,
  };
  const res = await fetch(httpsted.europa.euapiv3.0noticessearch, {
    method POST,
    headers { Content-Type applicationjson },
    body JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`TED ${res.status}`);
  const data = await res.json();
  return (data.notices  []).map((n) = ({
    source ted-early,
    sourceId String(n[publication-number]),
    title n[notice-title],
    description ,
    url `httpsted.europa.euennotice-detail${n[publication-number]}`,
    publishedAt n[publication-date]  null,
    deadline n[deadline-receipt-tender]  null,
  }));
}
 
export { fetchSkipulagsgatt, fetchByggingar, buildTedExpertQuery, fetchTedEarlyStage };