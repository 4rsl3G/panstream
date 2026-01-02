const express = require("express");
const layouts = require("express-ejs-layouts");
const axios = require("axios");
const NodeCache = require("node-cache");
const morgan = require("morgan");
const helmet = require("helmet");
const compression = require("compression");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 3000;
const SITE_URL = process.env.SITE_URL || `http://localhost:${PORT}`;
const API_BASE = process.env.API_BASE || "https://api.sansekai.my.id/api/dramabox";
const CACHE_TTL = Number(process.env.CACHE_TTL_SECONDS || 180);

const cache = new NodeCache({ stdTTL: CACHE_TTL, checkperiod: Math.max(30, Math.floor(CACHE_TTL / 2)) });

app.set("view engine", "ejs");
app.set("views", path.join(process.cwd(), "views")); // penting buat Vercel bundling
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

function absUrl(pth) {
  const base = SITE_URL.replace(/\/$/, "");
  const p = String(pth || "").startsWith("/") ? pth : `/${pth}`;
  return base + p;
}

async function apiGet(p, params = {}) {
  const key = `GET:${p}:${JSON.stringify(params)}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const url = `${API_BASE}${p}`;
  const res = await axios.get(url, { params, headers: { accept: "*/*" }, timeout: 12000 });
  cache.set(key, res.data);
  return res.data;
}

const safeArr = (x) => (Array.isArray(x) ? x : []);
const first = (x) => safeArr(x)[0] || null;

function baseMeta({ title, description, path, image }) {
  const t = title ? `${title} • PanStream` : "PanStream • Streaming Drama";
  const d = description || "PanStream – streaming drama pilihanmu dengan pengalaman premium.";
  const u = absUrl(path || "/");
  return { title: t, description: d, url: u, image: image || "", siteName: "PanStream" };
}

/** API proxy */
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

app.get("/api/detail/:bookId", async (req, res) => {
  try {
    const detail = await apiGet("/detail", { bookId: req.params.bookId });
    res.json(detail);
  } catch {
    res.status(500).json({ error: "detail_failed" });
  }
});

app.get("/api/episodes/:bookId", async (req, res) => {
  try {
    const eps = await apiGet("/allepisode", { bookId: req.params.bookId });
    res.json(eps);
  } catch {
    res.status(500).json({ error: "episodes_failed" });
  }
});

/** SSR pages */
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
    const meta = baseMeta({
      title: "PanStream",
      description: "Streaming drama VIP, dub indo, trending, dan rekomendasi — pengalaman premium.",
      path: "/",
      image: hero?.bookCover
    });

    res.render("pages/home", { meta, hero, sections: { vip, dubindo, random, foryou, latest, trending } });
  } catch {
    res.render("pages/home", {
      meta: baseMeta({ title: "PanStream", path: "/" }),
      hero: null,
      sections: { vip: [], dubindo: [], random: [], foryou: [], latest: [], trending: [] }
    });
  }
});

app.get("/browse", async (req, res) => {
  const classify = String(req.query.classify || "terbaru");
  const meta = baseMeta({
    title: `Browse ${classify}`,
    description: `Jelajahi dub indo (${classify}) dengan infinite scroll di PanStream.`,
    path: `/browse?classify=${encodeURIComponent(classify)}`
  });

  let page1 = [];
  try {
    page1 = await apiGet("/dubindo", { classify, page: 1 });
  } catch {}

  res.render("pages/browse", { meta, classify, page1: safeArr(page1) });
});

app.get("/detail/:bookId", async (req, res) => {
  const bookId = req.params.bookId;
  try {
    const [detail, episodes] = await Promise.all([apiGet("/detail", { bookId }), apiGet("/allepisode", { bookId })]);
    const d = detail || {};
    const eps = safeArr(episodes);

    const meta = baseMeta({
      title: d.bookName || "Detail",
      description: (d.introduction || "").slice(0, 160) || "Detail drama di PanStream.",
      path: `/detail/${bookId}`,
      image: d.bookCover
    });

    res.render("pages/detail", { meta, detail: d, episodes: eps });
  } catch {
    res.status(404).render("pages/404", { meta: baseMeta({ title: "Tidak ditemukan", path: req.path }) });
  }
});

app.get("/watch/:bookId/:chapterId", async (req, res) => {
  const { bookId, chapterId } = req.params;
  try {
    const [detail, episodes] = await Promise.all([apiGet("/detail", { bookId }), apiGet("/allepisode", { bookId })]);
    const d = detail || {};
    const eps = safeArr(episodes);

    const currentIndex = Math.max(0, eps.findIndex((x) => String(x.chapterId) === String(chapterId)));
    const current = eps[currentIndex] || eps[0] || null;
    const videoPath = current?.videoPath || d.videoPath || "";

    const meta = baseMeta({
      title: `${d.bookName || "Watch"} — Episode`,
      description: `Tonton ${d.bookName || "drama"} dengan pemutar premium PanStream.`,
      path: `/watch/${bookId}/${chapterId}`,
      image: d.bookCover
    });

    res.render("pages/watch", {
      meta,
      detail: d,
      episodes: eps,
      player: { bookId, chapterId, currentIndex, videoPath }
    });
  } catch {
    res.status(404).render("pages/404", { meta: baseMeta({ title: "Tidak ditemukan", path: req.path }) });
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

  const seen = new Set();
  const urls = [];
  urls.push({ loc: absUrl("/"), changefreq: "daily", priority: "1.0" });
  urls.push({ loc: absUrl("/browse?classify=terbaru"), changefreq: "daily", priority: "0.8" });

  for (const it of items) {
    const id = it?.bookId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    urls.push({ loc: absUrl(`/detail/${id}`), changefreq: "weekly", priority: "0.7" });
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
  res.status(404).render("pages/404", { meta: baseMeta({ title: "404", path: req.path }) });
});

module.exports = app;

// Local dev only
if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => console.log(`PanStream local: ${SITE_URL}`));
}
