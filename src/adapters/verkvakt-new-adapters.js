// adapters/verkvakt-new-adapters.js
//
// Two ready-to-run sources for Verkvakt, emitting the SAME normalized row shape
// the rest of the pipeline expects (matches adapters/ted.js and the add.html
// parser), so index.js scores + upserts them with no other changes:
//
//   { source, source_uid, title, buyer, country, cpv, notice_type, url,
//     published_at, deadline_at, est_value, currency, description, raw }
//
// Upsert key downstream is onConflict: 'source,source_uid' — so source_uid must
// be STABLE per item (re-runs update, never duplicate).
 
/* ---------- shared helpers ---------- */
 
// Icelandic "23.06.2026" / "23.6.2026" -> ISO. Pass through ISO untouched.
function isoDate(v) {
  if (!v) return null;
  if (typeof v !== "string") return null;
  const dotted = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (dotted) {
    const [, d, m, y] = dotted;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // already looks like a date/datetime
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v;
  return null;
}
 
const stripHtml = (h) =>
  (h || "").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
 
/* =========================================================================
 * 1) SKIPULAGSGÁTT — OGC API Features (planning / EIA / build-permit cases)
 *    One marker per case in collection "SkipulagsgattMerki", base case info
 *    in feature.properties. No date filter server-side (bbox + paging only),
 *    so we page the set and let the 'source,source_uid' upsert dedupe.
 *
 *    The exact property KEYS weren't confirmable remotely. This handles that
 *    two ways: (a) description = all string property values joined, so the
 *    Icelandic keyword scorer works regardless of key names; (b) it logs the
 *    real keys once on first run so you can tighten title/date mapping after.
 * ========================================================================= */
 
const SKG_BASE = "https://skipulagsgatt.is/api/issues/ogc";
const SKG_COLLECTION = "SkipulagsgattMerki";
// Optional bbox "minLon,minLat,maxLon,maxLat" (EPSG:4326). null = whole country.
// Greater Reykjavík ≈ "-22.1,63.95,-21.5,64.25"
const SKG_BBOX = null;
 
// ISO datetime with no timezone -> append Z. Iceland is GMT year-round, so this
// is correct, not an approximation. Date-only and dotted dates handled too.
function isoDateTime(v) {
  if (!v || typeof v !== "string") return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return /[Z+]/.test(v) ? v : v + "Z";
  return isoDate(v);
}
 
// ── title resolution ───────────────────────────────────────────────────────
// The marker collection's exact key for the case SUBJECT wasn't confirmable
// remotely, and many records return no `heitiMals` (that's the "Mál 503" bug).
// Try the likely subject keys in order; if none is present, build an
// INFORMATIVE label from whatever descriptive fields exist — never a bare
// "Mál N". The one-time key dump (in the loop) lets us lock the exact field.
const SKG_TITLE_KEYS = [
  "heitiMals", "malsheiti", "titill", "heiti", "nafn",
  "vidfangsefni", "malsefni", "efni", "lysing",
];
const SKG_TYPE_KEYS  = ["tegundFerlis", "nuverandiFasi", "malsflokkur"];
const SKG_WHERE_KEYS = ["sveitarfelog", "sveitarfelag", "umbod", "stofnun"];
 
function skgFirst(obj, keys) {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}
function skgTitle(p) {
  const subject = skgFirst(p, SKG_TITLE_KEYS);
  if (subject) return subject;
  // Informative fallback beats "Mál 503": "<type> — <where> (mál <nr>)".
  const type  = skgFirst(p, SKG_TYPE_KEYS);
  const where = skgFirst(p, SKG_WHERE_KEYS);
  const nr    = p.malsnr ?? p.id;
  const lead  = [type, where].filter(Boolean).join(" — ");
  if (lead)  return `${lead}${nr ? ` (mál ${nr})` : ""}`;
  return `Mál ${nr ?? "?"}`;
}
 
// One-time diagnostic so the real field names can be confirmed from worker logs.
let SKG_LOGGED = false;
 
export async function fetchSkipulagsgatt({
  pageSize = 200,
  maxPages = 30,
  includeFinished = false, // skip stadaMals === 'Lokið' (closed cases aren't opportunities)
} = {}) {
  const out = [];
  let startIndex = 0;
 
  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      limit: String(pageSize),
      startIndex: String(startIndex),
      crs: "http://www.opengis.net/def/crs/EPSG/0/4326",
    });
    if (SKG_BBOX) params.set("bbox", SKG_BBOX);
 
    const url = `${SKG_BASE}/collections/${SKG_COLLECTION}/items?${params}`;
    const res = await fetch(url, { headers: { Accept: "application/geo+json" } });
    if (!res.ok) throw new Error(`skipulagsgatt ${res.status} @ ${startIndex}`);
 
    const fc = await res.json();
    const features = Array.isArray(fc.features) ? fc.features : [];
    if (features.length === 0) break;
 
    for (const f of features) {
      const p = f.properties || {};
 
      if (!SKG_LOGGED) {
        SKG_LOGGED = true;
        console.log("[skipulagsgatt] property keys:", Object.keys(p).join(", "));
        console.log("[skipulagsgatt] sample feature:", JSON.stringify(p).slice(0, 800));
      }
 
      // Liveness filter: drop closed cases. They're historical, not opportunities.
      if (!includeFinished && p.stadaMals === "Lokið") continue;
 
      // Text the keyword scorer reads (planning cases carry no CPV).
      const description = [skgTitle(p), p.tegundFerlis, p.vidfangsefni, p.nuverandiFasi, p.umbod]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 1500);
 
      out.push({
        source: "skipulagsgatt",
        source_uid: String(p.malsnr ?? p.id ?? f.id),
        title: skgTitle(p),
        buyer: p.umbod ?? p.sveitarfelog ?? "",
        country: "IS",
        cpv: [],
        notice_type: "planning",
        url: p.tengill ?? `https://skipulagsgatt.is/issues/${p.id}`,
        published_at: isoDateTime(p.dagsStofnad),
        deadline_at: isoDateTime(p.dagsLokid),
        est_value: null,
        currency: null,
        description,
        raw: {
          malsnr: p.malsnr,
          stada: p.stadaMals,
          fasi: p.nuverandiFasi,
          tegund: p.tegundFerlis,
        },
      });
    }
 
    if (features.length < pageSize) break;
    startIndex += pageSize;
  }
  return out;
}
 
/* =========================================================================
 * 2) BYGGINGAR.IS — WordPress REST (construction/architecture news: carries
 *    competition launches, útboð openings, Félagsbústaðir works, etc.).
 *    Noisy — scorer tiers it; keep sinceDays small so volume stays sane.
 * ========================================================================= */
 
const BYG_BASE = "https://byggingar.is/wp-json/wp/v2/posts";
 
export async function fetchByggingar({ sinceDays = 30, perPage = 50, maxPages = 4 } = {}) {
  const out = [];
  const after = new Date(Date.now() - sinceDays * 864e5).toISOString().slice(0, 19);
 
  for (let page = 1; page <= maxPages; page++) {
    const params = new URLSearchParams({
      per_page: String(perPage),
      page: String(page),
      after,
      orderby: "date",
      order: "desc",
      _fields: "id,date_gmt,link,title,excerpt,content,categories",
    });
 
    const res = await fetch(`${BYG_BASE}?${params}`);
    if (res.status === 400) break; // WP returns 400 past the last page
    if (!res.ok) throw new Error(`byggingar ${res.status} @ page ${page}`);
 
    const posts = await res.json();
    if (!Array.isArray(posts) || posts.length === 0) break;
 
    for (const post of posts) {
      const title = stripHtml(post.title?.rendered);
      const body = stripHtml(post.excerpt?.rendered) || stripHtml(post.content?.rendered);
      out.push({
        source: "byggingar",
        source_uid: String(post.id),
        title,
        buyer: "",
        country: "IS",
        cpv: [],
        notice_type: "news",
        url: post.link,
        published_at: post.date_gmt ? `${post.date_gmt}Z` : null,
        deadline_at: null, // run your Icelandic-date extractor on `description` if scored relevant
        est_value: null,
        currency: null,
        description: (title + " " + body).slice(0, 1500),
        raw: { categories: post.categories || [] },
      });
    }
    if (posts.length < perPage) break;
  }
  return out;
}