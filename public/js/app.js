$(function () {
  // page loader
  const $loader = $("#panPageLoader");
  setTimeout(() => $loader.addClass("is-hide"), 450);

  // AOS
  AOS.init({ duration: 650, once: true, offset: 80 });

  // mobile menu
  const $btn = $("#panMenuBtn");
  const $menu = $("#panMobileMenu");
  $btn.on("click", () => $menu.toggleClass("is-open"));

  // close menu on outside click
  $(document).on("click", (e) => {
    if (!$(e.target).closest("#panMenuBtn, #panMobileMenu").length) {
      $menu.removeClass("is-open");
    }
  });
});
