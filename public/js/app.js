(function () {
  function showLoader() {
    $("#panPageLoader").addClass("is-on");
  }
  function hideLoader() {
    $("#panPageLoader").removeClass("is-on");
  }

  document.addEventListener("DOMContentLoaded", () => showLoader());
  window.addEventListener("load", () => setTimeout(hideLoader, 350));

  $(document).on("click", "a[href]", function (e) {
    const href = $(this).attr("href");
    if (!href) return;

    const isExternal = href.startsWith("http") || href.startsWith("//");
    const isAnchor = href.startsWith("#");
    const newTab = $(this).attr("target") === "_blank";
    if (isExternal || isAnchor || newTab) return;

    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;

    e.preventDefault();
    showLoader();
    setTimeout(() => (window.location.href = href), 180);
  });

  window.addEventListener("pageshow", (event) => {
    if (event.persisted) hideLoader();
  });
})();

document.querySelectorAll("[data-rail]").forEach((rail) => {
  rail.addEventListener(
    "wheel",
    (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        rail.scrollLeft += e.deltaY * 0.9;
      }
    },
    { passive: false }
  );
});
