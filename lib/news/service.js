// Market news headlines from configured public RSS feeds.
//
// Only the headline, link, publication time and publisher are used; article
// text and images are never copied. Every item links to the publisher. When
// no feed responds the API reports the news as unavailable instead of showing
// placeholder stories.

const DEFAULT_FEEDS = ["https://cointelegraph.com/rss", "https://www.coindesk.com/arc/outboundfeeds/rss/"];
const TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 8000;
const MAX_ITEMS = 12;

let cache = { at: 0, data: null };
let inflight = null;

export function configuredFeeds() {
  const raw = process.env.NEWS_FEEDS?.trim();
  if (raw === "disabled") return [];
  const list = raw ? raw.split(",").map((s) => s.trim()) : DEFAULT_FEEDS;
  return list.filter((u) => /^https:\/\//i.test(u));
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function clean(s) {
  return String(s ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, " ")
    .trim();
}
const tag = (xml, name) => xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"))?.[1] ?? null;

/** Parses RSS 2.0 (and basic Atom) into headline items. */
export function parseFeed(xml, fallbackSource) {
  const channel = tag(xml, "channel") ?? xml;
  const source = clean(tag(channel.split(/<item[\s>]/i)[0], "title")) || fallbackSource;
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  return blocks
    .map((b) => {
      const title = clean(tag(b, "title"));
      let link = clean(tag(b, "link"));
      if (!link) link = b.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? "";
      const date = new Date(clean(tag(b, "pubDate") ?? tag(b, "published") ?? tag(b, "updated") ?? ""));
      return { title, link, publishedAt: Number.isNaN(date.getTime()) ? null : date.toISOString(), source };
    })
    .filter((i) => i.title && /^https:\/\//i.test(i.link))
    .map((i) => ({ ...i, source: i.source.replace(/\.com News$/i, "").replace(/: .*$/, "") }));
}

async function fetchFeed(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "HarborFinance/1.0 (+news headlines)", Accept: "application/rss+xml, application/xml, text/xml" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseFeed(await res.text(), new URL(url).hostname.replace(/^www\./, ""));
  } finally {
    clearTimeout(timer);
  }
}

async function load() {
  const feeds = configuredFeeds();
  if (!feeds.length) return { available: false, reason: "disabled", items: [], sources: [], asOf: new Date().toISOString() };
  const results = await Promise.allSettled(feeds.map(fetchFeed));
  const seen = new Set();
  const items = results
    .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .filter((i) => (seen.has(i.link) ? false : seen.add(i.link)))
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
    .slice(0, MAX_ITEMS);
  return { available: items.length > 0, reason: items.length ? null : "unreachable", items, sources: [...new Set(items.map((i) => i.source))], asOf: new Date().toISOString() };
}

/** Cached headlines. Keeps serving the last good result if a refresh fails. */
export async function getNews() {
  if (cache.data && Date.now() - cache.at < TTL_MS) return cache.data;
  inflight ??= load()
    .then((data) => {
      if (data.available || !cache.data) cache = { at: Date.now(), data };
      else cache.at = Date.now() - TTL_MS + 60_000; // retry in a minute, keep last good headlines
      return cache.data;
    })
    .finally(() => (inflight = null));
  return inflight;
}
