$(function () {
  const state = window.__PAN_BROWSE__ || { classify: "terbaru", page: 1 };
  let page = state.page || 1;
  let classify = state.classify || "terbaru";
  let loading = false;

  const $grid = $("#panBrowseGrid");
  const $load = $("#panBrowseLoadMore");

  function cardHTML(d) {
    return `
      <a href="/detail/${d.bookId}" class="pan-gridCard">
        <div class="pan-gridPoster">
          <img loading="lazy" src="/img?u=${encodeURIComponent(d.cover || "")}" alt="${(d.bookName || "").replace(/"/g,'&quot;')}"/>
          <div class="pan-gridShade"></div>
        </div>
        <div class="pan-gridMeta">
          <div class="pan-gridTitle">${d.bookName || ""}</div>
          <div class="pan-gridSub">${d.playCount || ""}</div>
        </div>
      </a>
    `;
  }

  async function loadMore() {
    if (loading) return;
    loading = true;
    $load.addClass("is-show");

    try {
      const next = page + 1;
      const res = await fetch(`/api/browse?classify=${encodeURIComponent(classify)}&page=${next}`);
      const json = await res.json();
      const items = json.items || [];
      if (!items.length) {
        $load.find(".pan-loadText").text("No more results");
        setTimeout(() => $load.removeClass("is-show"), 800);
        return;
      }
      items.forEach((d) => $grid.append(cardHTML(d)));
      page = next;

      setTimeout(() => AOS.refresh(), 250);
    } catch {
      $load.find(".pan-loadText").text("Load failed");
    } finally {
      loading = false;
      setTimeout(() => $load.removeClass("is-show"), 800);
    }
  }

  // infinite scroll trigger
  window.addEventListener("scroll", () => {
    const nearBottom = (window.innerHeight + window.scrollY) > (document.body.offsetHeight - 900);
    if (nearBottom) loadMore();
  });

  // filter buttons
  $(".pan-filterBtn").on("click", function () {
    $(".pan-filterBtn").removeClass("is-active");
    $(this).addClass("is-active");

    classify = $(this).data("classify") || "terbaru";
    page = 1;
    $grid.html("");
    $load.find(".pan-loadText").text("Loading more…");
    loadMore(); // fetch page 2; but page 1 already empty so will populate from page2
    // better: redirect to page1 for consistent results
    window.location.href = `/browse?classify=${encodeURIComponent(classify)}&page=1`;
  });
});
