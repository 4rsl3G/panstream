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
// PAGES (SHELL ONLY) — client fetch langsung ke API_BASE
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
    apiBase: API_BASE,
  });
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
