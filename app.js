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

// default locals
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

function previewBody(data) {
  try {
    if (typeof data === "string") return data.slice(0, 200);
    return JSON.stringify(data).slice(0, 200);
  } catch {
    return "";
  }
}

function upstreamHeaders(req) {
  const base =
    req?.headers?.host ? `https://${req.headers.host}` : "https://pansa.my.id";
  return {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
    Referer: base + "/",
    Origin: base,
    Connection: "keep-alive",
  };
}

async function safeApiGet(req, endpoint, params = {}, timeoutMs = 45000) {
  try {
    const resp = await axios.get(API_BASE + endpoint, {
      params,
      headers: upstreamHeaders(req),
      timeout: timeoutMs,
      validateStatus: () => true,
    });

    if (resp.status < 200 || resp.status >= 300) {
      console.error(
        `UPSTREAM_FAIL ${endpoint}:`,
        resp.status,
        previewBody(resp.data)
      );
      return null;
    }

    return resp.data;
  } catch (e) {
    console.error(`UPSTREAM_ERR ${endpoint}:`, e?.message || e);
    return null;
  }
}

// list endpoints return array
function normalizeList(raw) {
  if (!raw) return [];
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
// PAGES (SHELL ONLY) — render cepat, data diisi client
// NOTE: pageScript path harus BENAR: "/public/js/xxx.js"
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

  return res.render("pages/home", {
    meta,
    shell: true,
    items: [],
    popular: [],
    apiBase: API_BASE,
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

  return res.render("pages/browse", {
    meta,
    shell: true,
    classify,
    page,
    items: [],
    apiBase: API_BASE,
  });
});

app.get("/search", (req, res) => {
  res.locals.pageScript = "/public/js/search.js";
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
    items: [],
    popular: [],
    apiBase: API_BASE,
  });
});

app.get("/detail/:bookId", (req, res) => {
  res.locals.pageScript = "/public/js/detail.js";
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
    items: [],
    apiBase: API_BASE,
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

  return res.render("pages/watch", {
    meta,
    shell: true,
    bookId,
    chapterId,
    items: [],
    apiBase: API_BASE,
  });
});

// ============================================================================
// JSON API (SERVER -> UPSTREAM) — tidak pernah 500 hanya karena upstream 403
// ============================================================================

app.get("/api/home", async (req, res) => {
  const latestRaw = await safeApiGet(req, "/latest");
  const trendingRaw = await safeApiGet(req, "/trending");
  const foryouRaw = await safeApiGet(req, "/foryou");
  const randomRaw = await safeApiGet(req, "/randomdrama");

  const latest = normalizeList(latestRaw).map(normalizeCard);
  const trending = normalizeList(trendingRaw).map(normalizeCard);
  const foryou = normalizeList(foryouRaw).map(normalizeCard);
  const random = normalizeList(randomRaw).map(normalizeCard);

  const featured = trending[0] || latest[0] || foryou[0] || random[0] || null;

  return res.status(200).json({
    featured,
    latest,
    trending,
    foryou,
    random,
    upstream: {
      latest: !!latestRaw,
      trending: !!trendingRaw,
      foryou: !!foryouRaw,
      random: !!randomRaw,
    },
  });
});

app.get("/api/browse", async (req, res) => {
  const classify = String(req.query.classify || "terbaru");
  const page = Number(req.query.page || 1);

  const raw = await safeApiGet(req, "/dubindo", { classify, page });
  const items = normalizeList(raw).map(normalizeCard);

  return res.status(200).json({ classify, page, items });
});

app.get("/api/popular", async (req, res) => {
  const raw = await safeApiGet(req, "/populersearch");
  const list = normalizeList(raw);

  const popular = list
    .map((x) => {
      if (typeof x === "string") return x;
      return x?.keyword || x?.name || x?.title || x?.word || x?.query || "";
    })
    .filter(Boolean)
    .slice(0, 12);

  return res.status(200).json({ popular });
});

app.get("/api/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.status(200).json({ q: "", items: [] });

  const raw = await safeApiGet(req, "/search", { query: q });
  const items = normalizeList(raw).map(normalizeCard);

  return res.status(200).json({ q, items });
});

app.get("/api/detail", async (req, res) => {
  const bookId = String(req.query.bookId || "");
  if (!bookId) return res.status(400).json({ error: "missing_bookId" });

  const rawDetail = await safeApiGet(req, "/detail", { bookId }, 60000);

  if (!rawDetail) {
    return res.status(200).json({
      detail: null,
      episodes: [],
      rawStatus: null,
      message: "",
      timestamp: null,
    });
  }

  const detail = normalizeDetailFromApi(rawDetail);
  const episodes = buildEpisodesFromDetail(rawDetail);

  return res.status(200).json({
    detail,
    episodes,
    rawStatus: rawDetail?.status ?? null,
    message: rawDetail?.message ?? "",
    timestamp: rawDetail?.timestamp ?? null,
  });
});

app.get("/api/sources", async (req, res) => {
  const bookId = String(req.query.bookId || "");
  const chapterId = String(req.query.chapterId || "");
  if (!bookId || !chapterId)
    return res.status(400).json({ error: "missing_params" });

  const rawDetail = await safeApiGet(req, "/detail", { bookId }, 60000);
  if (!rawDetail) return res.status(200).json({ bookId, chapterId, sources: [], best: "" });

  const eps = buildEpisodesFromDetail(rawDetail);
  const ep = eps.find((x) => x.chapterId === chapterId);
  if (!ep) return res.status(200).json({ bookId, chapterId, sources: [], best: "" });

  const sources = [];
  if (ep.mp4) sources.push({ type: "mp4", label: "MP4 720p", url: ep.mp4 });
  if (ep.m3u8Flag && ep.m3u8Url)
    sources.push({ type: "hls", label: "HLS 720p", url: ep.m3u8Url });

  return res.status(200).json({
    bookId,
    chapterId,
    unlock: ep.unlock,
    best: ep.mp4 || ep.m3u8Url || "",
    sources,
  });
});

// ============================================================================
// 404
// ============================================================================
app.use((req, res) => {
  res.status(404).render("pages/404", {
    meta: baseMeta(req, { title: "404", path: req.path }),
    items: [],
    popular: [],
    apiBase: API_BASE,
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`[PanStream] running on http://localhost:${PORT}`);
});
