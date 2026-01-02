$(function () {
  document.querySelectorAll("[data-rail]").forEach((rail) => {
    let isDown = false, startX = 0, scrollLeft = 0;

    rail.addEventListener("mousedown", (e) => {
      isDown = true;
      startX = e.pageX - rail.offsetLeft;
      scrollLeft = rail.scrollLeft;
      rail.classList.add("is-drag");
    });

    rail.addEventListener("mouseleave", () => {
      isDown = false;
      rail.classList.remove("is-drag");
    });

    rail.addEventListener("mouseup", () => {
      isDown = false;
      rail.classList.remove("is-drag");
    });

    rail.addEventListener("mousemove", (e) => {
      if (!isDown) return;
      e.preventDefault();
      const x = e.pageX - rail.offsetLeft;
      const walk = (x - startX) * 1.4;
      rail.scrollLeft = scrollLeft - walk;
    });
  });
});
