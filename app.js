/* PanStream — VPS build (FINAL, NO IMAGE PROXY) — REALTIME API
   Backend: Node.js + Express + EJS Layouts
   Notes:
   - NO render loading page
   - All data pulled realtime from API (no local json)
   - Adjusted to /detail response you provided
*/

const path = require("path");
const express = require("express");
const compression = require("compression");
const morgan = require("morgan");
const ejsLayouts = require("express-ejs-layouts");

const app = express();

const PORT = process.env.PORT || 3000;
const SITE_NAME = "PanStream";
const SITE_TAGLINE = "Luxury streaming experience";
const API_BASE = "https://api.sansekai.my.id/api/dramabox";

// ---------- App setup ----------
app.disable("x-powered-by");
app.set("view engine", "ejs");
app.set("views", path.join(process.cwd(), "views"));
app.use(ejsLayouts);
app.set("layout", "layouts/main");

app.use(compression());
app.use(morgan("dev"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ✅ default locals
app.use((req, res, next) => {
  res.locals.pageScript = null;
  next();
});

// Static assets
app.use("/public", express.static(path.join(process.cwd(), "public"), { maxAge: "7d" }));

// ---------- Helpers ----------
function getBaseUrl(req) {
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0].trim();
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  return `${proto}://${host}`;
}

function baseMeta(req, opts = {}) {
  const baseUrl = getBaseUrl(req);
  const title = opts.title ? `${opts.title} • ${SITE_NAME}` : `${SITE_NAME} • ${SITE_TAGLINE}`;
  const description = opts.description || "PanStream — pengalaman streaming mewah, cepat, dan responsif.";
  const url = `${baseUrl}${opts.path || req.path || "/"}`;
  const image = opts.image || `${baseUrl}/public/img/og.png`;
  const jsonLd = opts.jsonLd || null;

  return { siteName: SITE_NAME, tagline: SITE_TAGLINE, title, description, url, image, jsonLd };
}

// ---------- API fetch with timeout ----------
async function apiGet(endpoint, params = {}, timeoutMs = 12000) {
  const url = new URL(`${API_BASE}${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    url.searchParams.set(k, String(v));
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url.toString(), {
      headers: { accept: "*/*" },
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`API ${endpoint} failed: ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function normalizeList(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw?.list)) return raw.list;
  if (Array.isArray(raw?.items)) return raw.items;
  return [];
}

function toAbsUrl(u) {
  const s = String(u || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("//")) return "https:" + s;
  if (/^[a-z0-9.-]+\.[a-z]{2,}\//i.test(s)) return "https://" + s;
  return s;
}

function pickCover(item = {}) {
  return (
    item.coverWap || // list response (trending/dubindo often)
    item.cover ||    // detail/recommends
    item.bookCover ||
    item.coverUrl ||
    item.image ||
    item.img ||
    item.pic ||
    item.poster ||
    ""
  );
}

function isProbablyValidCover(u) {
  const s = String(u || "").trim();
  if (!s) return false;
  if (!/^https?:\/\//i.test(s)) return false;
  if (!s.includes(".") || !s.includes("/")) return false;
  return true;
}

function normalizeCard(item = {}) {
  const cover = toAbsUrl(pickCover(item));
  const playCount = item.playCount || item.play || item.rankVo?.hotCode || "";

  return {
    bookId: String(item.bookId || item.id || ""),
    bookName: item.bookName || item.name || "",
    cover,
    introduction: item.introduction || item.desc || "",
    playCount: String(playCount || ""),
    chapterCount: Number(item.chapterCount || 0),
    tags: Array.isArray(item.tags) ? item.tags : [],
    typeTwoName: item.typeTwoName || "",
    shelfTime: item.shelfTime || "",
    corner: item.corner || null
  };
}

// ✅ /detail response EXACT: raw.data.book, raw.data.chapterList, raw.data.recommends
function normalizeDetailFromApi(raw) {
  const book = raw?.data?.book || {};
  const cover = toAbsUrl(book.cover || book.coverWap || book.bookCover || "");

  return {
    bookId: String(book.bookId || ""),
    bookName: book.bookName || "",
    bookCover: cover,
    introduction: book.introduction || "",
    viewCount: Number(book.viewCount || 0),
    followCount: Number(book.followCount || 0),
    chapterCount: Number(book.chapterCount || 0),
    tags: Array.isArray(book.tags) ? book.tags : [],
    labels: Array.isArray(book.labels) ? book.labels : [],
    typeTwoName: book.typeTwoName || "",
    typeTwoList: Array.isArray(book.typeTwoList) ? book.typeTwoList : [],
    shelfTime: book.shelfTime || "",
    performers: Array.isArray(book.performerList) ? book.performerList : []
  };
}

function buildEpisodesFromDetail(raw) {
  const list = raw?.data?.chapterList || [];
  if (!Array.isArray(list)) return [];

  return list
    .map((ch, i) => ({
      chapterId: String(ch.id || ""),
      chapterIndex: Number(ch.index ?? i),
      chapterName: ch.name || `EP ${i + 1}`,
      indexStr: ch.indexStr || String(i + 1).padStart(3, "0"),
      unlock: Boolean(ch.unlock),
      duration: Number(ch.duration || 0),
      mp4: ch.mp4 || "",
      m3u8Url: ch.m3u8Url || "",
      m3u8Flag: Boolean(ch.m3u8Flag),
      cover: toAbsUrl(ch.cover || "")
    }))
    .filter((ep) => ep.chapterId);
}

function normalizeRecommendsFromDetail(raw) {
  const rec = raw?.data?.recommends || [];
  if (!Array.isArray(rec)) return [];
  return rec.map(normalizeCard).filter((x) => x.bookId);
}

// ---------- Tiny cache (RAM) for detail covers ----------
const COVER_CACHE_TTL_MS = 10 * 60 * 1000;
const coverCache = new Map();

function cacheGetCover(bookId) {
  const hit = coverCache.get(String(bookId));
  if (!hit) return "";
  if (Date.now() > hit.exp) {
    coverCache.delete(String(bookId));
    return "";
  }
  return hit.cover || "";
}

function cacheSetCover(bookId, cover) {
  if (!bookId || !cover) return;
  coverCache.set(String(bookId), { cover, exp: Date.now() + COVER_CACHE_TTL_MS });
}

async function fillMissingCovers(cards, limit = 12) {
  if (!Array.isArray(cards) || !cards.length) return cards;

  const need = cards
    .filter((x) => x && x.bookId && !isProbablyValidCover(x.cover))
    .slice(0, limit);

  if (!need.length) return cards;

  await Promise.all(
    need.map(async (c) => {
      try {
        const cached = cacheGetCover(c.bookId);
        if (cached) {
          c.cover = cached;
          return;
        }

        const raw = await apiGet("/detail", { bookId: c.bookId }, 15000);
        const det = normalizeDetailFromApi(raw);

        if (isProbablyValidCover(det.bookCover)) {
          c.cover = det.bookCover;
          cacheSetCover(c.bookId, det.bookCover);
        }
      } catch {
        // ignore
      }
    })
  );

  return cards;
}

// ---------- SEO robots + sitemap ----------
app.get("/robots.txt", (req, res) => {
  const baseUrl = getBaseUrl(req);
  res.type("text/plain").send(`User-agent: *\nAllow: /\nSitemap: ${baseUrl}/sitemap.xml\n`);
});

app.get("/sitemap.xml", (req, res) => {
  const baseUrl = getBaseUrl(req);
  const urls = [`${baseUrl}/`, `${baseUrl}/browse`, `${baseUrl}/search`];
  res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `<url><loc>${u}</loc></url>`).join("\n")}
</urlset>`);
});

// ---------- Pages ----------
app.get("/", async (req, res) => {
  let latest = [];
  let trending = [];
  let foryou = [];
  let random = [];
  let featured = null;

  try {
    const [latestRaw, trendingRaw, foryouRaw, randomRaw] = await Promise.all([
      apiGet("/latest"),
      apiGet("/trending"),
      apiGet("/foryou"),
      apiGet("/randomdrama")
    ]);

    latest = normalizeList(latestRaw).map(normalizeCard);
    trending = normalizeList(trendingRaw).map(normalizeCard);
    foryou = normalizeList(foryouRaw).map(normalizeCard);
    random = normalizeList(randomRaw).map(normalizeCard);

    await Promise.all([
      fillMissingCovers(trending, 20),
      fillMissingCovers(latest, 20),
      fillMissingCovers(foryou, 12),
      fillMissingCovers(random, 12)
    ]);

    featured = trending[0] || latest[0] || foryou[0] || random[0] || null;
  } catch (e) {
    console.error("HOME_ERR:", e?.message || e);
    // keep empty arrays, still render
  }

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: getBaseUrl(req),
    potentialAction: {
      "@type": "SearchAction",
      target: `${getBaseUrl(req)}/search?q={search_term_string}`,
      "query-input": "required name=search_term_string"
    }
  };

  const meta = baseMeta(req, {
    title: "Home",
    description: "PanStream — streaming drama dengan tampilan super mewah, cepat, dan responsif.",
    path: "/",
    jsonLd
  });

  return res.render("pages/home", { meta, featured, latest, trending, foryou, random });
});

// Browse page
app.get("/browse", async (req, res) => {
  const classify = String(req.query.classify || "terbaru");
  const page = Number(req.query.page || 1);

  let items = [];
  try {
    const raw = await apiGet("/dubindo", { classify, page });
    items = normalizeList(raw).map(normalizeCard);
    await fillMissingCovers(items, 24);
  } catch (e) {
    console.error("BROWSE_ERR:", e?.message || e);
  }

  const meta = baseMeta(req, {
    title: "Browse",
    description: "Browse koleksi drama PanStream dengan lazy scroll dan efek mewah.",
    path: "/browse"
  });

  return res.render("pages/browse", { meta, items, classify, page });
});

// Browse JSON for infinite scroll
app.get("/api/browse", async (req, res) => {
  try {
    const classify = String(req.query.classify || "terbaru");
    const page = Number(req.query.page || 1);

    const raw = await apiGet("/dubindo", { classify, page });
    const items = normalizeList(raw).map(normalizeCard);

    await fillMissingCovers(items, 24);

    return res.json({ classify, page, items });
  } catch (e) {
    console.error("API_BROWSE_ERR:", e?.message || e);
    return res.status(500).json({ error: "browse_failed" });
  }
});

app.get("/search", async (req, res) => {
  const q = String(req.query.q || "").trim();

  let popular = [];
  let items = [];

  try {
    const popularRaw = await apiGet("/populersearch").catch(() => []);
    const popularList = normalizeList(popularRaw);

    popular = popularList
      .map((x) => {
        if (typeof x === "string") return x;
        return x?.keyword || x?.name || x?.title || x?.word || x?.query || "";
      })
      .filter(Boolean)
      .slice(0, 12);

    if (q) {
      const raw = await apiGet("/search", { query: q });
      items = normalizeList(raw).map(normalizeCard);
      await fillMissingCovers(items, 24);
    }
  } catch (e) {
    console.error("SEARCH_ERR:", e?.message || e);
  }

  const meta = baseMeta(req, {
    title: q ? `Search: ${q}` : "Search",
    description: q ? `Hasil pencarian ${q} di PanStream.` : "Cari drama favoritmu di PanStream.",
    path: q ? `/search?q=${encodeURIComponent(q)}` : "/search"
  });

  return res.render("pages/search", { meta, q, items, popular });
});

app.get("/detail/:bookId", async (req, res) => {
  const bookId = req.params.bookId;

  let detail = null;
  let episodes = [];
  let recommends = [];

  try {
    const rawDetail = await apiGet("/detail", { bookId }, 15000);

    detail = normalizeDetailFromApi(rawDetail);
    episodes = buildEpisodesFromDetail(rawDetail);
    recommends = normalizeRecommendsFromDetail(rawDetail);

    if (isProbablyValidCover(detail.bookCover)) cacheSetCover(detail.bookId, detail.bookCover);
  } catch (e) {
    console.error("DETAIL_ERR:", e?.message || e);
  }

  const meta = baseMeta(req, {
    title: detail?.bookName || "Detail",
    description: (detail?.introduction || "").slice(0, 160) || "Detail drama di PanStream.",
    path: `/detail/${bookId}`,
    image: detail?.bookCover || undefined,
    jsonLd: detail
      ? {
          "@context": "https://schema.org",
          "@type": "TVSeries",
          name: detail.bookName,
          description: detail.introduction,
          image: detail.bookCover,
          url: `${getBaseUrl(req)}/detail/${bookId}`
        }
      : null
  });

  // detail null -> tetap render, biar UI kamu yang handle empty state
  return res.render("pages/detail", { meta, detail, episodes, recommends });
});

app.get("/watch/:bookId/:chapterId", async (req, res) => {
  const { bookId } = req.params;
  const chapterId = String(req.params.chapterId || "");

  let detail = null;
  let episodes = [];
  let player = null;

  try {
    const rawDetail = await apiGet("/detail", { bookId }, 15000);
    detail = normalizeDetailFromApi(rawDetail);

    episodes = buildEpisodesFromDetail(rawDetail).map((ep) => ({
      ...ep,
      href: `/watch/${bookId}/${ep.chapterId}`
    }));

    if (isProbablyValidCover(detail.bookCover)) cacheSetCover(detail.bookId, detail.bookCover);

    const idx = episodes.findIndex((x) => x.chapterId === chapterId);
    if (idx === -1) {
      const firstUnlock = episodes.find((x) => x.unlock);
      return firstUnlock ? res.redirect(firstUnlock.href) : res.redirect(`/detail/${bookId}`);
    }

    const current = episodes[idx];
    if (!current.unlock) {
      const firstUnlock = episodes.find((x) => x.unlock);
      return firstUnlock ? res.redirect(firstUnlock.href) : res.redirect(`/detail/${bookId}`);
    }

    player = {
      bookId,
      chapterId,
      currentIndex: idx,
      videoUrl: current.mp4 || "",
      hlsUrl: current.m3u8Flag ? (current.m3u8Url || "") : ""
    };
  } catch (e) {
    console.error("WATCH_ERR:", e?.message || e);
  }

  const meta = baseMeta(req, {
    title: detail ? `${detail.bookName} • Watch` : "Watch",
    description: detail ? `Tonton ${detail.bookName} di PanStream.` : "Tonton di PanStream.",
    path: `/watch/${bookId}/${chapterId}`,
    image: detail?.bookCover || undefined
  });

  return res.render("pages/watch", { meta, detail, episodes, player });
});

// Player sources endpoint (for your player.js quality menu)
app.get("/api/sources", async (req, res) => {
  try {
    const bookId = String(req.query.bookId || "");
    const chapterId = String(req.query.chapterId || "");
    if (!bookId || !chapterId) return res.status(400).json({ error: "missing_params" });

    const rawDetail = await apiGet("/detail", { bookId }, 15000);
    const eps = buildEpisodesFromDetail(rawDetail);
    const ep = eps.find((x) => x.chapterId === chapterId);
    if (!ep) return res.status(404).json({ error: "episode_not_found" });

    const sources = [];
    if (ep.mp4) sources.push({ label: "MP4", url: ep.mp4 });
    if (ep.m3u8Flag && ep.m3u8Url) sources.push({ label: "HLS", url: ep.m3u8Url });

    return res.json({
      bookId,
      chapterId,
      unlock: ep.unlock,
      best: ep.mp4 || ep.m3u8Url || "",
      sources
    });
  } catch (e) {
    console.error("SOURCES_ERR:", e?.message || e);
    return res.status(500).json({ error: "sources_failed" });
  }
});

// 404
app.use((req, res) => {
  res.status(404).render("pages/404", { meta: baseMeta(req, { title: "404", path: req.path }) });
});

// Start server
app.listen(PORT, () => {
  console.log(`[PanStream] running on http://localhost:${PORT}`);
});
