const express = require("express");
const layouts = require("express-ejs-layouts");
const axios = require("axios");
const NodeCache = require("node-cache");
const morgan = require("morgan");
const helmet = require("helmet");
const compression = require("compression");
const path = require("path");
const { URL } = require("url");

const app = express();

const PORT = process.env.PORT || 3000;
const API_BASE = process.env.API_BASE || "https://api.sansekai.my.id/api/dramabox";
const CACHE_TTL = Number(process.env.CACHE_TTL_SECONDS || 180);

const cache = new NodeCache({
  stdTTL: CACHE_TTL,
  checkperiod: Math.max(30, Math.floor(CACHE_TTL / 2))
});

app.set("view engine", "ejs");
app.set("views", path.join(process.cwd(), "views"));
app.use(layouts);
app.set("layout", "layouts/main");

app.use(express.static(path.join(process.cwd(), "public"), { maxAge: "7d" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(compression());
app.use(
  helmet({
    contentSecurityPolicy: false
  })
);
app.use(morgan("dev"));

/** ======================
 * Utils
 * ====================== */
function safeArr(x) {
  return Array.isArray(x) ? x : [];
}
function first(x) {
  return safeArr(x)[0] || null;
}
function isObj(x) {
  return x && typeof x === "object" && !Array.isArray(x);
}

// Normalisasi detail: kadang API bisa return object atau array(1)
function normalizeDetail(detail) {
  if (Array.isArray(detail)) return detail[0] || {};
  if (isObj(detail)) return detail;
  return {};
}

// Normalisasi episodes: kadang array, kadang object berisi list/data/episodes
function normalizeEpisodes(raw) {
  if (Array.isArray(raw)) return raw;
  if (isObj(raw)) {
    if (Array.isArray(raw.list)) return raw.list;
    if (Array.isArray(raw.data)) return raw.data;
    if (Array.isArray(raw.episodes)) return raw.episodes;
    if (Array.isArray(raw.result)) return raw.result;
  }
  return [];
}

function getBaseUrl(req) {
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  return `${proto}://${host}`;
}

function baseMeta(req, { title, description, path, image }) {
  const t = title ? `${title} • PanStream` : "PanStream • Luxury Streaming";
  const d = description || "PanStream — luxury streaming experience.";
  const base = getBaseUrl(req).replace(/\/$/, "");
  const u = base + (String(path || "/").startsWith("/") ? path : `/${path}`);
  return {
    title: t,
    description: d,
    url: u,
    image: image || "",
    siteName: "PanStream"
  };
}

async function apiGet(pathname, params = {}) {
  const key = `GET:${pathname}:${JSON.stringify(params)}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const url = `${API_BASE}${pathname}`;
  const res = await axios.get(url, {
    params,
    headers: { accept: "*/*" },
    timeout: 15000
  });

  cache.set(key, res.data);
  return res.data;
}

/** ======================
 * Image Proxy (Fix iOS/hotlink)
 * ====================== */
app.get("/img", async (req, res) => {
  try {
    const u = String(req.query.u || "");
    if (!u) return res.status(400).send("Missing u");

    const parsed = new URL(u);

    // allowlist (aman)
    const allowed = [
      "hwztchapter.dramaboxdb.com",
      "hwztvideo.dramaboxdb.com",
      "hwztakavideo.dramaboxdb.com",
      "dramaboxdb.com"
    ];
    const okHost = allowed.some((h) => parsed.hostname.endsWith(h));
    if (!okHost) return res.status(403).send("Host not allowed");

    const r = await axios.get(u, { responseType: "arraybuffer", timeout: 15000 });
    res.setHeader("Content-Type", r.headers["content-type"] || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400");
    return res.send(Buffer.from(r.data));
  } catch (e) {
    return res.status(404).send("Image not found");
  }
});

/** ======================
 * API proxy for frontend
 * ====================== */
app.get("/api/home", async (req, res) => {
  try {
    const [vip, dubindo, random, foryou, latest, trending] = await Promise.all([
      apiGet("/vip"),
      apiGet("/dubindo", { classify: "terbaru", page: 1 }),
      apiGet("/randomdrama"),
      apiGet("/foryou"),
      apiGet("/latest"),
      apiGet("/trending")
    ]);
    res.json({ vip, dubindo, random, foryou, latest, trending });
  } catch {
    res.status(500).json({ error: "home_fetch_failed" });
  }
});

app.get("/api/dubindo", async (req, res) => {
  try {
    const classify = req.query.classify || "terbaru";
    const page = Number(req.query.page || 1);
    const data = await apiGet("/dubindo", { classify, page });
    res.json({ classify, page, data });
  } catch {
    res.status(500).json({ error: "dubindo_fetch_failed" });
  }
});

app.get("/api/search", async (req, res) => {
  try {
    const query = String(req.query.q || "").trim();
    if (!query) return res.json({ query, data: [] });
    const data = await apiGet("/search", { query });
    res.json({ query, data });
  } catch {
    res.status(500).json({ error: "search_failed" });
  }
});

/** ======================
 * SSR Pages
 * ====================== */
app.get("/", async (req, res) => {
  try {
    const [vip, dubindo, random, foryou, latest, trending] = await Promise.all([
      apiGet("/vip"),
      apiGet("/dubindo", { classify: "terbaru", page: 1 }),
      apiGet("/randomdrama"),
      apiGet("/foryou"),
      apiGet("/latest"),
      apiGet("/trending")
    ]);

    const hero = first(trending) || first(latest) || first(vip);

    const meta = baseMeta(req, {
      title: "PanStream",
      description: "Luxury streaming — VIP, dub indo, trending, for you.",
      path: "/",
      image: hero?.bookCover ? `${getBaseUrl(req)}/img?u=${encodeURIComponent(hero.bookCover)}` : ""
    });

    res.render("pages/home", {
      meta,
      hero,
      sections: {
        vip: safeArr(vip),
        dubindo: safeArr(dubindo),
        random: safeArr(random),
        foryou: safeArr(foryou),
        latest: safeArr(latest),
        trending: safeArr(trending)
      }
    });
  } catch {
    res.render("pages/home", {
      meta: baseMeta(req, { title: "PanStream", path: "/" }),
      hero: null,
      sections: { vip: [], dubindo: [], random: [], foryou: [], latest: [], trending: [] }
    });
  }
});

app.get("/browse", async (req, res) => {
  const classify = String(req.query.classify || "terbaru");
  let page1 = [];
  try {
    page1 = safeArr(await apiGet("/dubindo", { classify, page: 1 }));
  } catch {}

  const meta = baseMeta(req, {
    title: `Browse ${classify}`,
    description: `Browse dub indo (${classify}) with infinite scroll.`,
    path: `/browse?classify=${encodeURIComponent(classify)}`
  });

  res.render("pages/browse", { meta, classify, page1 });
});

app.get("/detail/:bookId", async (req, res) => {
  const bookId = req.params.bookId;
  try {
    const rawDetail = await apiGet("/detail", { bookId });
    const detail = normalizeDetail(rawDetail);

    const rawEpisodes = await apiGet("/allepisode", { bookId });
    const episodes = normalizeEpisodes(rawEpisodes)
      .map((ep, i) => ({
        chapterId: String(ep.chapterId ?? ep.id ?? ep.chapter_id ?? ""),
        chapterName: ep.chapterName ?? ep.name ?? `Episode ${i + 1}`,
        videoPath: ep.videoPath ?? ep.videoUrl ?? ep.playUrl ?? ""
      }))
      .filter((x) => x.chapterId); // penting: jangan bikin link undefined

    const meta = baseMeta(req, {
      title: detail.bookName || "Detail",
      description: (detail.introduction || "").slice(0, 160) || "Detail drama di PanStream.",
      path: `/detail/${bookId}`,
      image: detail.bookCover ? `${getBaseUrl(req)}/img?u=${encodeURIComponent(detail.bookCover)}` : ""
    });

    res.render("pages/detail", { meta, detail, episodes });
  } catch (e) {
    console.error("DETAIL_ERROR:", e?.message || e);
    res.status(404).render("pages/404", { meta: baseMeta(req, { title: "404", path: req.path }) });
  }
});

app.get("/watch/:bookId/:chapterId", async (req, res) => {
  const { bookId } = req.params;
  const chapterId = String(req.params.chapterId || "");

  try {
    const rawDetail = await apiGet("/detail", { bookId });
    const detail = normalizeDetail(rawDetail);

    const rawEpisodes = await apiGet("/allepisode", { bookId });
    const episodes = normalizeEpisodes(rawEpisodes)
      .map((ep, i) => ({
        i,
        chapterId: String(ep.chapterId ?? ep.id ?? ep.chapter_id ?? ""),
        chapterName: ep.chapterName ?? ep.name ?? `Episode ${i + 1}`,
        videoPath: ep.videoPath ?? ep.videoUrl ?? ep.playUrl ?? "",
        href: `/watch/${bookId}/${String(ep.chapterId ?? ep.id ?? ep.chapter_id ?? "")}`
      }))
      .filter((x) => x.chapterId);

    // kalau chapterId invalid / tidak ketemu → redirect ke episode pertama biar tidak 404
    const idx = episodes.findIndex((x) => x.chapterId === chapterId);
    if (idx === -1) {
      const firstEp = episodes[0];
      if (!firstEp) throw new Error("No episodes");
      return res.redirect(firstEp.href);
    }

    const current = episodes[idx];
    const videoPath = current.videoPath || detail.videoPath || "";

    const meta = baseMeta(req, {
      title: `${detail.bookName || "Watch"} — ${current.chapterName || "Episode"}`,
      description: `Watch ${detail.bookName || "drama"} on PanStream.`,
      path: `/watch/${bookId}/${chapterId}`,
      image: detail.bookCover ? `${getBaseUrl(req)}/img?u=${encodeURIComponent(detail.bookCover)}` : ""
    });

    res.render("pages/watch", {
      meta,
      detail,
      episodes,
      player: {
        bookId,
        chapterId,
        currentIndex: idx,
        videoPath
      }
    });
  } catch (e) {
    console.error("WATCH_ERROR:", e?.message || e);
    res.status(404).render("pages/404", { meta: baseMeta(req, { title: "404", path: req.path }) });
  }
});

app.get("/sitemap.xml", async (req, res) => {
  res.type("application/xml");

  let items = [];
  try {
    const [vip, latest, trending, foryou] = await Promise.all([
      apiGet("/vip"),
      apiGet("/latest"),
      apiGet("/trending"),
      apiGet("/foryou")
    ]);
    items = [...safeArr(vip), ...safeArr(latest), ...safeArr(trending), ...safeArr(foryou)];
  } catch {}

  const base = getBaseUrl(req).replace(/\/$/, "");
  const seen = new Set();
  const urls = [
    { loc: `${base}/`, changefreq: "daily", priority: "1.0" },
    { loc: `${base}/browse?classify=terbaru`, changefreq: "daily", priority: "0.8" }
  ];

  for (const it of items) {
    const id = it?.bookId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    urls.push({ loc: `${base}/detail/${id}`, changefreq: "weekly", priority: "0.7" });
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `
  <url>
    <loc>${u.loc}</loc>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`
  )
  .join("")}
</urlset>`;
  res.send(xml);
});

app.use((req, res) => {
  res.status(404).render("pages/404", { meta: baseMeta(req, { title: "404", path: req.path }) });
});

app.use((err, req, res, next) => {
  console.error("PANSTREAM_FATAL:", err);
  res.status(500).send("Internal Server Error");
});

module.exports = app;

// local only
if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => console.log(`PanStream local on :${PORT}`));
}
