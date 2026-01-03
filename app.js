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

async function safeApiGet(endpoint, params = {}) {
  try {
    const res = await axios.get(API_BASE + endpoint, {
      params,
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0",
        Referer: "https://pansa.my.id",
        Origin: "https://pansa.my.id"
      },
      timeout: 40000
    });

    if (res.status === 403) {
      console.error("API 403:", endpoint);
      return null;
    }

    return res.data;
  } catch (e) {
    console.error("API Error:", endpoint, e.message);
    return null;
  }
}

function normalizeList(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw?.list)) return raw.list;
  if (Array.isArray(raw?.items)) return raw.items;
  return [];
}

function normalizeCard(item = {}) {
  return {
    bookId: String(item.bookId || item.id || ""),
    bookName: item.bookName || item.name || "",
    cover: item.cover || item.image || "",
    introduction: item.introduction || item.desc || "",
    playCount: item.playCount || "",
    tags: Array.isArray(item.tags) ? item.tags : [],
    chapterCount: Number(item.chapterCount || 0),
    shelfTime: item.shelfTime || ""
  };
}

// ============================================================================
// PAGES (shell only, tidak menunggu API)
// ============================================================================

app.get("/", (req, res) => {
  const meta = baseMeta(req, { title: "Home", path: "/" });
  return res.render("pages/home", { meta, shell: true, items: [] });
});

app.get("/browse", (req, res) => {
  const meta = baseMeta(req, { title: "Browse", path: "/browse" });
  return res.render("pages/browse", { meta, shell: true, items: [] });
});

app.get("/search", (req, res) => {
  const meta = baseMeta(req, { title: "Search", path: "/search" });
  return res.render("pages/search", { meta, shell: true, popular: [] });
});

app.get("/detail/:bookId", (req, res) => {
  const meta = baseMeta(req, { title: "Detail", path: "/detail/" + req.params.bookId });
  return res.render("pages/detail", { meta, shell: true, items: [] });
});

app.get("/watch/:bookId/:chapterId", (req, res) => {
  const meta = baseMeta(req, { title: "Watch", path: "/watch/" + req.params.bookId });
  return res.render("pages/watch", { meta, shell: true, items: [] });
});

// ============================================================================
// API ROUTES (langsung hit API_BASE, tanpa proxy)
// ============================================================================

app.get("/api/home", async (req, res) => {
  const [latestRaw, trendingRaw, foryouRaw, randomRaw] = await Promise.all([
    safeApiGet("/latest"),
    safeApiGet("/trending"),
    safeApiGet("/foryou"),
    safeApiGet("/randomdrama")
  ]);

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
    random
  });
});

app.get("/api/browse", async (req, res) => {
  const classify = String(req.query.classify || "terbaru");
  const page = Number(req.query.page || 1);

  const raw = await safeApiGet("/dubindo", { classify, page });
  const items = normalizeList(raw).map(normalizeCard);

  return res.status(200).json({ classify, page, items });
});

app.get("/api/popular", async (req, res) => {
  const raw = await safeApiGet("/populersearch");
  const list = normalizeList(raw);
  const popular = list
    .map(x => typeof x === "string" ? x : x?.keyword || x?.name || "")
    .filter(Boolean)
    .slice(0, 12);

  return res.status(200).json({ popular });
});

app.get("/api/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.json({ q: "", items: [] });

  const raw = await safeApiGet("/search", { query: q });
  const items = normalizeList(raw).map(normalizeCard);

  return res.status(200).json({ q, items });
});

app.get("/api/detail", async (req, res) => {
  const bookId = String(req.query.bookId || "");
  if (!bookId) return res.status(400).json({ error: "missing_bookId" });

  const raw = await safeApiGet("/detail", { bookId });
  const detail = raw?.data?.book ? raw.data.book : null;
  const episodes = Array.isArray(raw?.data?.chapterList) ? raw.data.chapterList : [];

  return res.status(200).json({ detail, episodes });
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
