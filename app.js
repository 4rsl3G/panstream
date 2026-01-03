/* PanStream — VPS build (FINAL)
   Backend: Node.js + Express + EJS Layouts
   Features: SEO, sitemap/robots, image proxy, browse infinite, custom player endpoints
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

// ✅ default locals (fix: pageScript is not defined)
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

  return {
    siteName: SITE_NAME,
    tagline: SITE_TAGLINE,
    title,
    description,
    url,
    image,
    jsonLd
  };
}

async function apiGet(endpoint, params = {}) {
  const url = new URL(`${API_BASE}${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), {
    headers: { accept: "*/*" }
  });

  if (!res.ok) throw new Error(`API ${endpoint} failed: ${res.status}`);
  return res.json();
}

// list endpoints return array
function normalizeList(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw?.list)) return raw.list;
  return [];
}

function normalizeCard(item = {}) {
  return {
    bookId: String(item.bookId || ""),
    bookName: item.bookName || "",
    cover: item.bookCover || item.cover || "",
    introduction: item.introduction || "",
    playCount: item.playCount || "",
    tags: Array.isArray(item.tags) ? item.tags : []
  };
}

// detail endpoint format: { data: { book: {...}, chapterList: [...] } }
function normalizeDetailFromApi(raw) {
  const book = raw?.data?.book || raw?.book || {};
  return {
    bookId: String(book.bookId || ""),
    bookName: book.bookName || "",
    bookCover: book.cover || book.bookCover || "",
    introduction: book.introduction || "",
    viewCount: Number(book.viewCount || 0),
    followCount: Number(book.followCount || 0),
    totalChapterNum: Number(book.chapterCount || 0),
    tags: Array.isArray(book.tags) ? book.tags : (Array.isArray(book.labels) ? book.labels : []),
    performers: Array.isArray(book.performerList) ? book.performerList : []
  };
}

function buildEpisodesFromDetail(rawDetail) {
  const list = rawDetail?.data?.chapterList || [];
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
      cover: ch.cover || ""
    }))
    .filter((ep) => ep.chapterId);
}

function isHttpUrl(s) {
  return /^https?:\/\//i.test(String(s || ""));
}

// ---------- Image proxy (FINAL FIX: no .pipe, works on VPS) ----------
app.get("/img", async (req, res) => {
  const u = String(req.query.u || "");
  if (!u || !isHttpUrl(u)) return res.status(400).send("bad_url");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const upstream = await fetch(u, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (PanStream Image Proxy)",
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "Referer": getBaseUrl(req) + "/",
        "Accept-Language": "en-US,en;q=0.9,id;q=0.8"
      }
    });

    if (upstream.status === 404) return res.status(404).send("img_not_found");
    if (!upstream.ok) {
      console.error("IMG_UPSTREAM_ERR:", upstream.status, u);
      return res.status(502).send(`upstream_${upstream.status}`);
    }

    const ct = upstream.headers.get("content-type") || "image/jpeg";
    res.setHeader("Content-Type", ct);
    res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");

    // IMPORTANT: some Node fetch implementations return WebStream (no .pipe)
    const ab = await upstream.arrayBuffer();
    res.end(Buffer.from(ab));
  } catch (e) {
    const msg = e?.name === "AbortError" ? "img_timeout" : "img_proxy_failed";
    console.error("IMG_PROXY_ERR:", msg, e?.message || e, u);
    res.status(502).send(msg);
  } finally {
    clearTimeout(timeout);
  }
});

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
  try {
    const [latestRaw, trendingRaw, foryouRaw, randomRaw] = await Promise.all([
      apiGet("/latest"),
      apiGet("/trending"),
      apiGet("/foryou"),
      apiGet("/randomdrama")
    ]);

    const latest = normalizeList(latestRaw).map(normalizeCard);
    const trending = normalizeList(trendingRaw).map(normalizeCard);
    const foryou = normalizeList(foryouRaw).map(normalizeCard);
    const random = normalizeList(randomRaw).map(normalizeCard);

    const featured = trending[0] || latest[0] || foryou[0] || random[0] || null;

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

    res.render("pages/home", { meta, featured, latest, trending, foryou, random });
  } catch (e) {
    console.error("HOME_ERR:", e?.message || e);
    const meta = baseMeta(req, { title: "Home", path: "/" });
    res.render("pages/home", { meta, featured: null, latest: [], trending: [], foryou: [], random: [] });
  }
});

// Browse page (infinite scroll)
app.get("/browse", async (req, res) => {
  const classify = String(req.query.classify || "terbaru");
  const page = Number(req.query.page || 1);

  try {
    const raw = await apiGet("/dubindo", { classify, page });
    const items = normalizeList(raw).map(normalizeCard);

    const meta = baseMeta(req, {
      title: "Browse",
      description: "Browse koleksi drama PanStream dengan lazy scroll dan efek mewah.",
      path: "/browse"
    });

    res.render("pages/browse", { meta, items, classify, page });
  } catch (e) {
    console.error("BROWSE_ERR:", e?.message || e);
    const meta = baseMeta(req, { title: "Browse", path: "/browse" });
    res.render("pages/browse", { meta, items: [], classify, page });
  }
});

// Browse JSON for infinite scroll
app.get("/api/browse", async (req, res) => {
  try {
    const classify = String(req.query.classify || "terbaru");
    const page = Number(req.query.page || 1);
    const raw = await apiGet("/dubindo", { classify, page });
    const items = normalizeList(raw).map(normalizeCard);
    res.json({ classify, page, items });
  } catch (e) {
    console.error("API_BROWSE_ERR:", e?.message || e);
    res.status(500).json({ error: "browse_failed" });
  }
});

app.get("/search", async (req, res) => {
  const q = String(req.query.q || "");
  const popularRaw = await apiGet("/populersearch").catch(() => []);
  const popular = normalizeList(popularRaw).slice(0, 12);

  let items = [];
  if (q.trim()) {
    try {
      const raw = await apiGet("/search", { query: q.trim() });
      items = normalizeList(raw).map(normalizeCard);
    } catch {
      items = [];
    }
  }

  const meta = baseMeta(req, {
    title: q ? `Search: ${q}` : "Search",
    description: q ? `Hasil pencarian ${q} di PanStream.` : "Cari drama favoritmu di PanStream.",
    path: q ? `/search?q=${encodeURIComponent(q)}` : "/search"
  });

  res.render("pages/search", { meta, q, items, popular });
});

app.get("/detail/:bookId", async (req, res) => {
  const bookId = req.params.bookId;

  try {
    const rawDetail = await apiGet("/detail", { bookId });
    const detail = normalizeDetailFromApi(rawDetail);
    const episodes = buildEpisodesFromDetail(rawDetail);

    const meta = baseMeta(req, {
      title: detail.bookName || "Detail",
      description: (detail.introduction || "").slice(0, 160) || "Detail drama di PanStream.",
      path: `/detail/${bookId}`,
      image: detail.bookCover ? `${getBaseUrl(req)}/img?u=${encodeURIComponent(detail.bookCover)}` : undefined,
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "TVSeries",
        name: detail.bookName,
        description: detail.introduction,
        image: detail.bookCover,
        url: `${getBaseUrl(req)}/detail/${bookId}`
      }
    });

    res.render("pages/detail", { meta, detail, episodes });
  } catch (e) {
    console.error("DETAIL_ERR:", e?.message || e);
    res.status(404).render("pages/404", { meta: baseMeta(req, { title: "404", path: req.path }) });
  }
});

app.get("/watch/:bookId/:chapterId", async (req, res) => {
  const { bookId } = req.params;
  const chapterId = String(req.params.chapterId || "");

  try {
    const rawDetail = await apiGet("/detail", { bookId });
    const detail = normalizeDetailFromApi(rawDetail);
    const episodes = buildEpisodesFromDetail(rawDetail).map((ep) => ({
      ...ep,
      href: `/watch/${bookId}/${ep.chapterId}`
    }));

    const idx = episodes.findIndex((x) => x.chapterId === chapterId);
    if (idx === -1) {
      const firstUnlock = episodes.find((x) => x.unlock);
      if (!firstUnlock) throw new Error("No unlock episodes");
      return res.redirect(firstUnlock.href);
    }

    const current = episodes[idx];

    if (!current.unlock) {
      const firstUnlock = episodes.find((x) => x.unlock);
      if (!firstUnlock) throw new Error("No unlock episodes");
      return res.redirect(firstUnlock.href);
    }

    const player = {
      bookId,
      chapterId,
      currentIndex: idx,
      videoUrl: current.mp4 || "",
      hlsUrl: current.m3u8Flag ? (current.m3u8Url || "") : ""
    };

    const meta = baseMeta(req, {
      title: `${detail.bookName} • EP ${current.chapterIndex + 1}`,
      description: `Tonton ${detail.bookName} di PanStream.`,
      path: `/watch/${bookId}/${chapterId}`,
      image: detail.bookCover ? `${getBaseUrl(req)}/img?u=${encodeURIComponent(detail.bookCover)}` : undefined
    });

    res.render("pages/watch", { meta, detail, episodes, player });
  } catch (e) {
    console.error("WATCH_ERR:", e?.message || e);
    res.status(404).render("pages/404", { meta: baseMeta(req, { title: "404", path: req.path }) });
  }
});

// Player sources endpoint: use mp4/hls from detail chapterList
app.get("/api/sources", async (req, res) => {
  try {
    const bookId = String(req.query.bookId || "");
    const chapterId = String(req.query.chapterId || "");
    if (!bookId || !chapterId) return res.status(400).json({ error: "missing_params" });

    const rawDetail = await apiGet("/detail", { bookId });
    const eps = buildEpisodesFromDetail(rawDetail);
    const ep = eps.find((x) => x.chapterId === chapterId);
    if (!ep) return res.status(404).json({ error: "episode_not_found" });

    const sources = [];
    if (ep.mp4) sources.push({ type: "mp4", quality: 720, url: ep.mp4, isDefault: true });
    if (ep.m3u8Flag && ep.m3u8Url) sources.push({ type: "hls", quality: 720, url: ep.m3u8Url, isDefault: false });

    res.json({
      bookId,
      chapterId,
      unlock: ep.unlock,
      best: ep.mp4 || ep.m3u8Url || "",
      sources
    });
  } catch (e) {
    console.error("SOURCES_ERR:", e?.message || e);
    res.status(500).json({ error: "sources_failed" });
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
