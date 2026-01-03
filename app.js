/* PanStream — Server (Shortmax API)
   Backend: Node.js + Express + EJS Layouts
   Notes:
   - Token API disimpan di server (env SHORTMAX_TOKEN), tidak dikirim ke browser.
   - Endpoint JSON untuk client:
     /api/languages
     /api/home?lang=en
     /api/search?q=love&lang=en
     /api/episodes/:code?lang=en
     /api/play/:code?lang=en&ep=1
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

const API_BASE = "https://sapimu.au/shortmax/api/v1";
const API_TOKEN = process.env.SHORTMAX_TOKEN || "";

// ====== Basic guards ======
if (!API_TOKEN) {
  console.warn(
    "[WARN] SHORTMAX_TOKEN belum diset. Endpoint /api/* akan mengembalikan error."
  );
}

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

// Default locals untuk layout (hindari 'pageScript is not defined')
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

  return { siteName: SITE_NAME, tagline: SITE_TAGLINE, title, description, url, image, jsonLd };
}

function previewBody(data) {
  try {
    if (typeof data === "string") return data.slice(0, 240);
    return JSON.stringify(data).slice(0, 240);
  } catch {
    return "";
  }
}

function upstreamHeaders(req) {
  const base =
    req?.headers?.host ? `https://${req.headers.host}` : "https://localhost";
  return {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
    Referer: base + "/",
    Origin: base,
    Connection: "keep-alive",
    Authorization: `Bearer ${API_TOKEN}`,
  };
}

// Small in-memory cache (TTL mengikuti 'ttl' dari response kalau ada)
const memCache = new Map(); // key -> { exp:number, value:any }
function cacheGet(key) {
  const hit = memCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) {
    memCache.delete(key);
    return null;
  }
  return hit.value;
}
function cacheSet(key, value, ttlSec) {
  const ttl = Math.max(1, Number(ttlSec || 0)) * 1000;
  memCache.set(key, { exp: Date.now() + ttl, value });
}

async function safeApiGet(req, endpoint, params = {}, timeoutMs = 45000) {
  if (!API_TOKEN) {
    return { ok: false, status: 500, data: null, error: "missing_token" };
  }

  const url = API_BASE + endpoint;
  try {
    const resp = await axios.get(url, {
      params,
      headers: upstreamHeaders(req),
      timeout: timeoutMs,
      validateStatus: () => true,
    });

    // API baru biasanya balikin { data, cached, ttl }
    if (resp.status < 200 || resp.status >= 300) {
      console.error(
        `UPSTREAM_FAIL ${endpoint}:`,
        resp.status,
        previewBody(resp.data)
      );
      return { ok: false, status: resp.status, data: null, error: "upstream_fail" };
    }

    return { ok: true, status: resp.status, data: resp.data, error: null };
  } catch (e) {
    console.error(`UPSTREAM_ERR ${endpoint}:`, e?.message || e);
    return { ok: false, status: 500, data: null, error: "upstream_error" };
  }
}

// Normalize model supaya UI lama bisa dipakai
function normalizeShow(item = {}) {
  return {
    id: Number(item.id || 0),
    code: Number(item.code || 0),
    name: item.name || "",
    cover: item.cover || "",
    episodes: Number(item.episodes || 0),
    views: Number(item.views || 0),
    favorites: Number(item.favorites || 0),
    summary: item.summary || "",
    tags: Array.isArray(item.tags) ? item.tags : [],
    tagline: item.tagline || "",
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
// PAGES (shell) — render cepat, data diisi client
// IMPORTANT: pageScript harus path valid, jangan double prefix
// ============================================================================

app.get("/", (req, res) => {
  res.locals.pageScript = "/public/js/home.js";
  const meta = baseMeta(req, {
    title: "Home",
    description: "PanStream — streaming dengan tampilan mewah, cepat, dan responsif.",
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
  const lang = String(req.query.lang || "en");

  const meta = baseMeta(req, {
    title: "Browse",
    description: "Browse koleksi drama PanStream.",
    path: "/browse",
  });

  return res.render("pages/browse", { meta, shell: true, lang });
});

app.get("/search", (req, res) => {
  res.locals.pageScript = "/public/js/search.js";
  const q = String(req.query.q || "").trim();
  const lang = String(req.query.lang || "en");

  const meta = baseMeta(req, {
    title: q ? `Search: ${q}` : "Search",
    description: q ? `Hasil pencarian ${q}.` : "Cari judul favoritmu.",
    path: q ? `/search?q=${encodeURIComponent(q)}&lang=${encodeURIComponent(lang)}` : "/search",
  });

  return res.render("pages/search", { meta, shell: true, q, lang });
});

app.get("/detail/:code", (req, res) => {
  res.locals.pageScript = "/public/js/detail.js";
  const code = String(req.params.code || "");
  const lang = String(req.query.lang || "en");

  const meta = baseMeta(req, {
    title: "Detail",
    description: "Memuat detail…",
    path: `/detail/${encodeURIComponent(code)}`,
  });

  return res.render("pages/detail", { meta, shell: true, code, lang });
});

app.get("/watch/:code/:ep", (req, res) => {
  res.locals.pageScript = "/public/js/player.js";
  const code = String(req.params.code || "");
  const ep = String(req.params.ep || "1");
  const lang = String(req.query.lang || "en");

  const meta = baseMeta(req, {
    title: "Watch",
    description: "Memuat video…",
    path: `/watch/${encodeURIComponent(code)}/${encodeURIComponent(ep)}`,
  });

  return res.render("pages/watch", { meta, shell: true, code, ep, lang });
});

// ============================================================================
// JSON API (server -> upstream)
// ============================================================================

app.get("/api/languages", async (req, res) => {
  const cacheKey = "languages";
  const cached = cacheGet(cacheKey);
  if (cached) return res.status(200).json(cached);

  const r = await safeApiGet(req, "/languages", {}, 30000);
  if (!r.ok) return res.status(200).json({ data: [], error: r.error });

  const payload = {
    data: Array.isArray(r.data?.data) ? r.data.data : [],
    cached: Boolean(r.data?.cached),
    ttl: Number(r.data?.ttl || 0),
  };

  if (payload.ttl) cacheSet(cacheKey, payload, payload.ttl);
  return res.status(200).json(payload);
});

app.get("/api/home", async (req, res) => {
  const lang = String(req.query.lang || "en");
  const cacheKey = `home:${lang}`;

  const cached = cacheGet(cacheKey);
  if (cached) return res.status(200).json(cached);

  const r = await safeApiGet(req, "/home", { lang }, 45000);
  if (!r.ok) return res.status(200).json({ data: [], error: r.error });

  const list = Array.isArray(r.data?.data) ? r.data.data.map(normalizeShow) : [];
  const payload = {
    data: list,
    featured: list[0] || null,
    cached: Boolean(r.data?.cached),
    ttl: Number(r.data?.ttl || 0),
  };

  if (payload.ttl) cacheSet(cacheKey, payload, payload.ttl);
  return res.status(200).json(payload);
});

app.get("/api/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const lang = String(req.query.lang || "en");
  if (!q) return res.status(200).json({ data: [], q: "", lang });

  const cacheKey = `search:${lang}:${q.toLowerCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.status(200).json(cached);

  const r = await safeApiGet(req, "/search", { q, lang }, 45000);
  if (!r.ok) return res.status(200).json({ data: [], q, lang, error: r.error });

  const list = Array.isArray(r.data?.data) ? r.data.data.map(normalizeShow) : [];
  const payload = {
    data: list,
    q,
    lang,
    cached: Boolean(r.data?.cached),
    ttl: Number(r.data?.ttl || 0),
  };

  if (payload.ttl) cacheSet(cacheKey, payload, payload.ttl);
  return res.status(200).json(payload);
});

app.get("/api/episodes/:code", async (req, res) => {
  const code = String(req.params.code || "");
  const lang = String(req.query.lang || "en");
  if (!code) return res.status(400).json({ error: "missing_code" });

  const cacheKey = `eps:${lang}:${code}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.status(200).json(cached);

  const r = await safeApiGet(req, `/episodes/${encodeURIComponent(code)}`, { lang }, 45000);
  if (!r.ok) return res.status(200).json({ data: [], code, lang, error: r.error });

  const list = Array.isArray(r.data?.data)
    ? r.data.data.map((x) => ({
        id: Number(x.id || 0),
        episode: Number(x.episode || 0),
        locked: Boolean(x.locked),
      }))
    : [];

  const payload = {
    data: list,
    code,
    lang,
    cached: Boolean(r.data?.cached),
    ttl: Number(r.data?.ttl || 0),
  };

  if (payload.ttl) cacheSet(cacheKey, payload, payload.ttl);
  return res.status(200).json(payload);
});

app.get("/api/play/:code", async (req, res) => {
  const code = String(req.params.code || "");
  const lang = String(req.query.lang || "en");
  const ep = Number(req.query.ep || 1);
  if (!code) return res.status(400).json({ error: "missing_code" });

  // play URL cepat expired -> cache pendek mengikuti ttl/expires_in
  const cacheKey = `play:${lang}:${code}:${ep}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.status(200).json(cached);

  const r = await safeApiGet(req, `/play/${encodeURIComponent(code)}`, { lang, ep }, 45000);
  if (!r.ok) return res.status(200).json({ data: null, code, lang, ep, error: r.error });

  const d = r.data?.data || null;
  const payload = {
    data: d
      ? {
          id: Number(d.id || 0),
          name: d.name || "",
          episode: Number(d.episode || ep),
          total: Number(d.total || 0),
          video: d.video || {},
          expires: Number(d.expires || 0),
          expires_in: Number(d.expires_in || 0),
        }
      : null,
    cached: Boolean(r.data?.cached),
    ttl: Number(r.data?.ttl || 0),
    code,
    lang,
    ep,
  };

  // cache: pakai ttl dari API, atau fallback ke min(expires_in, 120) biar gak stale
  const ttlSec = payload.ttl || Math.min(120, Math.max(5, payload.data?.expires_in || 0));
  cacheSet(cacheKey, payload, ttlSec);

  return res.status(200).json(payload);
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
