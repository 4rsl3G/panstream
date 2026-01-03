/* PanStream — VPS build (FINAL, MODE B: SHELL + CLIENT FETCH) — AXIOS EDITION
   Backend: Node.js + Express + EJS Layouts
   - Pages render cepat (tanpa nunggu API)
   - Data realtime diambil lewat /api/* (server -> upstream API via Axios)
*/

const path = require("path");
const express = require("express");
const compression = require("compression");
const morgan = require("morgan");
const ejsLayouts = require("express-ejs-layouts");
const axios = require("axios");

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

// ============================================================================
// AXIOS CLIENT (browser-like headers to reduce WAF/CDN blocks)
// ============================================================================
const axiosClient = axios.create({
  baseURL: API_BASE,
  // IMPORTANT: axios timeout is per request
  timeout: 35000,
  headers: {
    Accept: "application/json, text/plain, */*",
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
    "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
    Connection: "keep-alive",
  },
  // in case upstream returns non-200 but still JSON
  validateStatus: () => true,
});

function buildAxiosError(endpoint, resOrErr) {
  // resOrErr can be axios response or error
  if (resOrErr && resOrErr.status) {
    const status = resOrErr.status;
    let preview = "";
    try {
      const data = resOrErr.data;
      if (typeof data === "string") preview = data.slice(0, 200);
      else preview = JSON.stringify(data).slice(0, 200);
    } catch (_) {}
    return new Error(`API ${endpoint} failed: ${status} body=${preview}`);
  }
  if (resOrErr && resOrErr.response && resOrErr.response.status) {
    const status = resOrErr.response.status;
    let preview = "";
    try {
      const data = resOrErr.response.data;
      if (typeof data === "string") preview = data.slice(0, 200);
      else preview = JSON.stringify(data).slice(0, 200);
    } catch (_) {}
    return new Error(`API ${endpoint} failed: ${status} body=${preview}`);
  }
  return new Error(`API ${endpoint} failed: ${resOrErr?.message || resOrErr}`);
}

async function apiGet(endpoint, params = {}, timeoutMs = 35000) {
  const resp = await axiosClient.get(endpoint, {
    params,
    timeout: timeoutMs,
  });

  if (resp.status < 200 || resp.status >= 300) {
    throw buildAxiosError(endpoint, resp);
  }

  return resp.data;
}

async function apiGetRetry(endpoint, params = {}, opts = {}) {
  const {
    retries = 2,
    timeoutMs = 35000,
    retryDelayMs = 900,
  } = opts;

  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await apiGet(endpoint, params, timeoutMs);
    } catch (e) {
      lastErr = e;
      if (i === retries) break;
      await sleep(retryDelayMs * (i + 1)); // backoff
    }
  }
  throw lastErr;
}

// list endpoints return array
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
    item.coverWap ||
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
    corner: item.corner || null,
    chapterCount: Number(item.chapterCount || 0),
    shelfTime: item.shelfTime || item.shelf_time || "",
  };
}

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
    tags: Array.isArray(book.tags)
      ? book.tags
      : Array.isArray(book.labels)
      ? book.labels
      : [],
    labels: Array.isArray(book.labels) ? book.labels : [],
    typeTwoName: book.typeTwoName || "",
    language: book.simpleLanguage || book.language || "",
    shelfTime: book.shelfTime || "",
    performers: Array.isArray(book.performerList) ? book.performerList : [],
    recommends: Array.isArray(raw?.data?.recommends)
      ? raw.data.recommends.map(normalizeCard)
      : [],
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
// PAGES (SHELL ONLY)
// ============================================================================
app.get("/", (req, res) => {
  res.locals.pageScript = "/public/js/home.js";
  const meta = baseMeta(req, {
    title: "Home",
    description:
      "PanStream — streaming drama dengan tampilan super mewah, cepat, dan responsif.",
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

  return res.render("pages/home", { meta, shell: true });
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

  return res.render("pages/browse", { meta, shell: true, classify, page });
});

app.get("/search", (req, res) => {
  res.locals.pageScript = "/public/js/search.js";
  const q = String(req.query.q || "").trim();

  const meta = baseMeta(req, {
    title: q ? `Search: ${q}` : "Search",
    description: q ? `Hasil pencarian ${q} di PanStream.` : "Cari drama favoritmu di PanStream.",
    path: q ? `/search?q=${encodeURIComponent(q)}` : "/search",
  });

  return res.render("pages/search", { meta, shell: true, q });
});

app.get("/detail/:bookId", (req, res) => {
  res.locals.pageScript = "/public/js/detail.js";
  const bookId = String(req.params.bookId || "");

  const meta = baseMeta(req, {
    title: "Detail",
    description: "Memuat detail drama…",
    path: `/detail/${bookId}`,
  });

  return res.render("pages/detail", { meta, shell: true, bookId });
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

  return res.render("pages/watch", { meta, shell: true, bookId, chapterId });
});

// ============================================================================
// JSON API (SERVER -> UPSTREAM) — realtime
// ============================================================================
app.get("/api/home", async (req, res) => {
  try {
    const [latestRaw, trendingRaw, foryouRaw, randomRaw] = await Promise.all([
      apiGetRetry("/latest", {}, { retries: 2, timeoutMs: 45000 }),
      apiGetRetry("/trending", {}, { retries: 2, timeoutMs: 45000 }),
      apiGetRetry("/foryou", {}, { retries: 2, timeoutMs: 45000 }),
      apiGetRetry("/randomdrama", {}, { retries: 2, timeoutMs: 45000 }),
    ]);

    const latest = normalizeList(latestRaw).map(normalizeCard);
    const trending = normalizeList(trendingRaw).map(normalizeCard);
    const foryou = normalizeList(foryouRaw).map(normalizeCard);
    const random = normalizeList(randomRaw).map(normalizeCard);

    const featured = trending[0] || latest[0] || foryou[0] || random[0] || null;

    return res.json({ featured, latest, trending, foryou, random });
  } catch (e) {
    console.error("API_HOME_ERR:", e?.message || e);
    return res.status(500).json({ error: "home_failed" });
  }
});

app.get("/api/browse", async (req, res) => {
  try {
    const classify = String(req.query.classify || "terbaru");
    const page = Number(req.query.page || 1);

    const raw = await apiGetRetry(
      "/dubindo",
      { classify, page },
      { retries: 2, timeoutMs: 45000 }
    );

    const items = normalizeList(raw).map(normalizeCard);
    return res.json({ classify, page, items });
  } catch (e) {
    console.error("API_BROWSE_ERR:", e?.message || e);
    return res.status(500).json({ error: "browse_failed" });
  }
});

app.get("/api/popular", async (req, res) => {
  try {
    const popularRaw = await apiGetRetry(
      "/populersearch",
      {},
      { retries: 2, timeoutMs: 30000 }
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

app.get("/api/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json({ q: "", items: [] });

    const raw = await apiGetRetry(
      "/search",
      { query: q },
      { retries: 2, timeoutMs: 45000 }
    );

    const items = normalizeList(raw).map(normalizeCard);
    return res.json({ q, items });
  } catch (e) {
    console.error("API_SEARCH_ERR:", e?.message || e);
    return res.status(500).json({ error: "search_failed" });
  }
});

app.get("/api/detail", async (req, res) => {
  try {
    const bookId = String(req.query.bookId || "");
    if (!bookId) return res.status(400).json({ error: "missing_bookId" });

    const rawDetail = await apiGetRetry(
      "/detail",
      { bookId },
      { retries: 2, timeoutMs: 60000 }
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

app.get("/api/sources", async (req, res) => {
  try {
    const bookId = String(req.query.bookId || "");
    const chapterId = String(req.query.chapterId || "");
    if (!bookId || !chapterId)
      return res.status(400).json({ error: "missing_params" });

    const rawDetail = await apiGetRetry(
      "/detail",
      { bookId },
      { retries: 2, timeoutMs: 60000 }
    );

    const eps = buildEpisodesFromDetail(rawDetail);
    const ep = eps.find((x) => x.chapterId === chapterId);
    if (!ep) return res.status(404).json({ error: "episode_not_found" });

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
