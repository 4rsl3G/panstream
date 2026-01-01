const grid = document.getElementById("grid");
const sentinel = document.getElementById("sentinel");
const classify = window.__PAN_BROWSE__?.classify || "terbaru";

let page = 1;
let loading = false;
let ended = false;

function cardHTML(d) {
  return `
  <a class="group block" href="/detail/${d.bookId}">
    <div class="aspect-[2/3] rounded-2xl overflow-hidden border border-white/10">
      <img loading="lazy" src="${d.bookCover}" class="w-full h-full object-cover group-hover:scale-[1.04] transition duration-500"/>
    </div>
    <div class="mt-3 text-sm opacity-90 line-clamp-2">${d.bookName || ""}</div>
    <div class="text-xs opacity-60 mt-1">${d.playCount || ""}</div>
  </a>`;
}

async function loadNext() {
  if (loading || ended) return;
  loading = true;
  page += 1;

  try {
    const res = await fetch(`/api/dubindo?classify=${encodeURIComponent(classify)}&page=${page}`);
    const j = await res.json();
    const data = Array.isArray(j.data) ? j.data : [];

    if (!data.length) {
      ended = true;
      sentinel.textContent = "No more results.";
      sentinel.classList.add("opacity-50");
      return;
    }

    const frag = document.createElement("div");
    frag.innerHTML = data.map(cardHTML).join("");
    [...frag.children].forEach((el) => grid.appendChild(el));
  } catch {
    sentinel.textContent = "Failed to load. Scroll to retry.";
  } finally {
    loading = false;
  }
}

const io = new IntersectionObserver(
  (entries) => entries.forEach((e) => e.isIntersecting && loadNext()),
  { rootMargin: "900px" }
);

io.observe(sentinel);
