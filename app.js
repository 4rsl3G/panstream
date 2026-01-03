/* PanStream — VPS build (FINAL, MODE B: SHELL + CLIENT FETCH)
   Backend: Node.js + Express + EJS Layouts
   - Pages render cepat (tanpa nunggu API)
   - Data realtime diambil lewat /api/* (server -> upstream API)
   - NO loading.ejs
   - Detail normalize mengikuti response /detail yang kamu kirim
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

// default locals (fix: pageScript is not defined)
app.use((req, res, next) => {
  res.locals.pageScript = null;
  next();
});

// Static assets
app.use(
  "/public",
  express.static(path.join(process.cwd(), "public"), { maxAge: "7d" })
);

// ---------- Helpers ----------
function getBaseUrl(req) {
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "http")
    .split(",")[0]
    .trim();
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0]
    .trim();
  return `${proto}://${host}`;
}

function baseMeta(req, opts = {}) {
  const baseUrl = getBaseUrl(req);
  const title = opts.title
    ? `${opts.title} • ${SITE_NAME}`
    : `${SITE_NAME} • ${SITE_TAGLINE}`;
  const description =
    opts.description ||
    "PanStream — pengalaman streaming mewah, cepat, dan responsif.";
  const url = `${baseUrl}${opts.path || req.path || "/"}`;
  const image = opts.image || `${baseUrl}/public/img/og.png`;
  const jsonLd = opts.jsonLd || null;

  return {
    siteName: SITE_NAME,
    tagline: SITE_TAGLINE,
    title,
    description,
    url,
    image,
    jsonLd,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- Upstream API fetch (timeout + retry) ----------
async function apiGet(endpoint, params = {}, timeoutMs = 25000) {
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
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`API ${endpoint} failed: ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function apiGetRetry(endpoint, params = {}, opts = {}) {
  const {
    retries = 2,
    timeoutMs = 25000,
    retryDelayMs = 900,
  } = opts;

  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await apiGet(endpoint, params, timeoutMs);
    } catch (e) {
      lastErr = e;
      if (i === retries) break;
      await sleep(retryDelayMs * (i + 1));
    }
  }
  throw lastErr;
}

// list endpoints return array
function normalizeList(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw?.list)) return raw.list;
  // beberapa API suka taruh items
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
    item.coverWap || // dari response dubindo kamu
    item.cover ||
    item.bookCover ||
    item.book_cover ||
    item.coverUrl ||
    item.coverURL ||
    item.image ||
    item.imageUrl ||
    item.img ||
    item.imgUrl ||
    item.pic ||
    item.picUrl ||
    item.poster ||
    item.posterUrl ||
    item.verticalCover ||
    item.verticalCoverUrl ||
    item.bookCoverUrl ||
    ""
  );
}

function normalizeCard(item = {}) {
  return {
    bookId: String(item.bookId || item.id || ""),
    bookName: item.bookName || item.name || "",
    cover: toAbsUrl(pickCover(item)),
    introduction: item.introduction || item.desc || "",
    playCount: item.playCount || item.play || "",
    tags: Array.isArray(item.tags) ? item.tags : [],
    // opsional UI label
    corner: item.corner || null,
    chapterCount: Number(item.chapterCount || 0),
    shelfTime: item.shelfTime || item.shelf_time || "",
  };
}

// /detail normalize sesuai response yang kamu kirim
function normalizeDetailFromApi(raw) {
  const book = raw?.data?.book || raw?.book || {};
  return {
    bookId: String(book.bookId || ""),
    bookName: book.bookName || "",
    cover: toAbsUrl(book.cover || ""),
    viewCount: Number(book.viewCount || 0),
    followCount: Number(book.followCount || 0),
    introduction: book.introduction || "",
    chapterCount: Number(book.chapterCount || 0),
    tags: Array.isArray(book.tags) ? book.tags : (Array.isArray(book.labels) ? book.labels : []),
    labels: Array.isArray(book.labels) ? book.labels : [],
    typeTwoName: book.typeTwoName || "",
    language: book.simpleLanguage || book.language || "",
    shelfTime: book.shelfTime || "",
    performers: Array.isArray(book.performerList) ? book.performerList : [],
    recommends: Array.isArray(raw?.data?.recommends) ? raw.data.recommends.map(normalizeCard) : [],
  };
}

function buildEpisodesFromDetail(rawDetail) {
  const list = rawDetail?.data?.chapterList || [];
  if (!Array.isArray(list)) return [];
  return list
    .map((ch, i) => ({
      chapterId: String(ch.id || ""),
      chapterName: ch.name || `EP ${i + 1}`,
      chapterIndex: Number(ch.index ?? i),
      indexStr: ch.indexStr || String(i + 1).padStart(3, "0"),
      unlock: Boolean(ch.unlock),
      duration: Number(ch.duration || 0),
      mp4: ch.mp4 || "",
      m3u8Url: ch.m3u8Url || "",
      m3u8Flag: Boolean(ch.m3u8Flag),
      cover: toAbsUrl(ch.cover || ""),
      utime: ch.utime || "",
      chapterPrice: Number(ch.chapterPrice || 0),
      isNew: Boolean(ch.new),
    }))
    .filter((ep) => ep.chapterId);
}

// ---------- SEO robots + sitemap ----------
app.get("/robots.txt", (req, res) => {
  const baseUrl = getBaseUrl(req);
  res
    .type("text/plain")
    .send(`User-agent: *\nAllow: /\nSitemap: ${baseUrl}/sitemap.xml\n`);
});

app.get("/sitemap.xml", (req, res) => {
  const baseUrl = getBaseUrl(req);
  const urls = [`${baseUrl}/`, `${baseUrl}/browse`, `${baseUrl}/search`];
  res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `<url><loc>${u}</loc></url>`).join("\n")}
</urlset>`);
});

// ============================================================================
// PAGES (SHELL ONLY) — cepat, tidak nunggu API
// ============================================================================

app.get("/", (req, res) => {
  res.locals.pageScript = "/public/js/home.js"; // kamu bikin home.js untuk fetch /api/home
  const meta = baseMeta(req, {
    title: "Home",
    description: "PanStream — streaming drama dengan tampilan super mewah, cepat, dan responsif.",
    path: "/",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: SITE_NAME,
      url: getBaseUrl(req),
      potentialAction: {
        "@type": "SearchAction",
        target: `${getBaseUrl(req)}/search?q={search_term_string}`,
        "query-input": "required name=search_term_string",
      },
    },
  });

  // render tanpa data (client akan isi)
  return res.render("pages/home", {
    meta,
    shell: true,
  });
});

app.get("/browse", (req, res) => {
  res.locals.pageScript = "/public/js/browse.js";

  const classify = String(req.query.classify || "terbaru");
  const page = Number(req.query.page || 1);

  const meta = baseMeta(req, {
    title: "Browse",
    description: "Browse koleksi drama PanStream dengan lazy scroll dan efek mewah.",
    path: "/browse",
  });

  // inject state untuk client
  return res.render("pages/browse", {
    meta,
    shell: true,
    classify,
    page,
  });
});

app.get("/search", (req, res) => {
  res.locals.pageScript = "/public/js/search.js"; // kamu bikin untuk fetch /api/search & /api/popular
  const q = String(req.query.q || "").trim();

  const meta = baseMeta(req, {
    title: q ? `Search: ${q}` : "Search",
    description: q ? `Hasil pencarian ${q} di PanStream.` : "Cari drama favoritmu di PanStream.",
    path: q ? `/search?q=${encodeURIComponent(q)}` : "/search",
  });

  return res.render("pages/search", {
    meta,
    shell: true,
    q,
  });
});

app.get("/detail/:bookId", (req, res) => {
  res.locals.pageScript = "/public/js/detail.js"; // kamu bikin untuk fetch /api/detail?bookId=...
  const bookId = String(req.params.bookId || "");

  const meta = baseMeta(req, {
    title: "Detail",
    description: "Memuat detail drama…",
    path: `/detail/${bookId}`,
  });

  return res.render("pages/detail", {
    meta,
    shell: true,
    bookId,
  });
});

app.get("/watch/:bookId/:chapterId", (req, res) => {
  res.locals.pageScript = "/public/js/player.js";
  const bookId = String(req.params.bookId || "");
  const chapterId = String(req.params.chapterId || "");

  const meta = baseMeta(req, {
    title: "Watch",
    description: "Memuat video…",
    path: `/watch/${bookId}/${chapterId}`,
  });

  // cfg player akan diisi client setelah fetch detail
  return res.render("pages/watch", {
    meta,
    shell: true,
    bookId,
    chapterId,
  });
});

// ============================================================================
// JSON API (SERVER -> UPSTREAM) — realtime
// ============================================================================

// home bundles
app.get("/api/home", async (req, res) => {
  try {
    const [latestRaw, trendingRaw, foryouRaw, randomRaw] = await Promise.all([
      apiGetRetry("/latest", {}, { retries: 2, timeoutMs: 30000 }),
      apiGetRetry("/trending", {}, { retries: 2, timeoutMs: 30000 }),
      apiGetRetry("/foryou", {}, { retries: 2, timeoutMs: 30000 }),
      apiGetRetry("/randomdrama", {}, { retries: 2, timeoutMs: 30000 }),
    ]);

    const latest = normalizeList(latestRaw).map(normalizeCard);
    const trending = normalizeList(trendingRaw).map(normalizeCard);
    const foryou = normalizeList(foryouRaw).map(normalizeCard);
    const random = normalizeList(randomRaw).map(normalizeCard);

    const featured = trending[0] || latest[0] || foryou[0] || random[0] || null;

    return res.json({
      featured,
      latest,
      trending,
      foryou,
      random,
    });
  } catch (e) {
    console.error("API_HOME_ERR:", e?.message || e);
    return res.status(500).json({ error: "home_failed" });
  }
});

// browse realtime (dubindo)
app.get("/api/browse", async (req, res) => {
  try {
    const classify = String(req.query.classify || "terbaru");
    const page = Number(req.query.page || 1);

    const raw = await apiGetRetry(
      "/dubindo",
      { classify, page },
      { retries: 2, timeoutMs: 30000 }
    );

    const items = normalizeList(raw).map(normalizeCard);

    return res.json({ classify, page, items });
  } catch (e) {
    console.error("API_BROWSE_ERR:", e?.message || e);
    return res.status(500).json({ error: "browse_failed" });
  }
});

// popular search keywords
app.get("/api/popular", async (req, res) => {
  try {
    const popularRaw = await apiGetRetry(
      "/populersearch",
      {},
      { retries: 2, timeoutMs: 25000 }
    );

    const popularList = normalizeList(popularRaw);
    const popular = popularList
      .map((x) => {
        if (typeof x === "string") return x;
        return x?.keyword || x?.name || x?.title || x?.word || x?.query || "";
      })
      .filter(Boolean)
      .slice(0, 12);

    return res.json({ popular });
  } catch (e) {
    console.error("API_POPULAR_ERR:", e?.message || e);
    return res.status(500).json({ error: "popular_failed" });
  }
});

// search results
app.get("/api/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json({ q: "", items: [] });

    const raw = await apiGetRetry(
      "/search",
      { query: q },
      { retries: 2, timeoutMs: 30000 }
    );

    const items = normalizeList(raw).map(normalizeCard);
    return res.json({ q, items });
  } catch (e) {
    console.error("API_SEARCH_ERR:", e?.message || e);
    return res.status(500).json({ error: "search_failed" });
  }
});

// detail full (book + episodes + recommends)
app.get("/api/detail", async (req, res) => {
  try {
    const bookId = String(req.query.bookId || "");
    if (!bookId) return res.status(400).json({ error: "missing_bookId" });

    const rawDetail = await apiGetRetry(
      "/detail",
      { bookId },
      { retries: 2, timeoutMs: 35000 }
    );

    const detail = normalizeDetailFromApi(rawDetail);
    const episodes = buildEpisodesFromDetail(rawDetail);

    return res.json({
      detail,
      episodes,
      rawStatus: rawDetail?.status ?? null,
      message: rawDetail?.message ?? "",
      timestamp: rawDetail?.timestamp ?? null,
    });
  } catch (e) {
    console.error("API_DETAIL_ERR:", e?.message || e);
    return res.status(500).json({ error: "detail_failed" });
  }
});

// player sources endpoint (ambil dari /detail)
app.get("/api/sources", async (req, res) => {
  try {
    const bookId = String(req.query.bookId || "");
    const chapterId = String(req.query.chapterId || "");
    if (!bookId || !chapterId)
      return res.status(400).json({ error: "missing_params" });

    const rawDetail = await apiGetRetry(
      "/detail",
      { bookId },
      { retries: 2, timeoutMs: 35000 }
    );

    const eps = buildEpisodesFromDetail(rawDetail);
    const ep = eps.find((x) => x.chapterId === chapterId);
    if (!ep) return res.status(404).json({ error: "episode_not_found" });

    // susun sumber untuk quality dropdown
    const sources = [];
    if (ep.mp4) sources.push({ type: "mp4", label: "MP4 720p", url: ep.mp4 });
    if (ep.m3u8Flag && ep.m3u8Url)
      sources.push({ type: "hls", label: "HLS 720p", url: ep.m3u8Url });

    return res.json({
      bookId,
      chapterId,
      unlock: ep.unlock,
      best: ep.mp4 || ep.m3u8Url || "",
      sources,
    });
  } catch (e) {
    console.error("API_SOURCES_ERR:", e?.message || e);
    return res.status(500).json({ error: "sources_failed" });
  }
});

// ============================================================================
// 404
// ============================================================================
app.use((req, res) => {
  res.status(404).render("pages/404", {
    meta: baseMeta(req, { title: "404", path: req.path }),
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`[PanStream] running on http://localhost:${PORT}`);
});
