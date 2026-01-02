$(function () {
  const cfg = window.__PAN_PLAYER__;
  const eps = window.__PAN_EPISODES__ || [];

  const v = document.getElementById("panVideo");
  const $loader = $("#panPlayerLoader");
  const $play = $("#panPlay");
  const $mute = $("#panMute");
  const $vol = $("#panVol");
  const $fs = $("#panFs");
  const $next = $("#panNext");

  const $track = $("#panTrack");
  const $fill = $("#panFill");
  const $knob = $("#panKnob");
  const $now = $("#panTimeNow");
  const $dur = $("#panTimeDur");

  const $qBtn = $("#panQuality");
  const $qDrop = $("#panQualityDrop");

  function fmt(t) {
    if (!isFinite(t)) return "0:00";
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function showLoader(on) { on ? $loader.addClass("is-show") : $loader.removeClass("is-show"); }

  async function loadSources() {
    const res = await fetch(`/api/sources?bookId=${encodeURIComponent(cfg.bookId)}&chapterId=${encodeURIComponent(cfg.chapterId)}`);
    const json = await res.json();
    return json.sources || [];
  }

  function setSource(url) {
    showLoader(true);
    v.pause();
    v.src = url;
    v.load();
  }

  function togglePlay() {
    if (v.paused) v.play(); else v.pause();
  }

  function updateUI() {
    $play.html(v.paused ? '<i class="ri-play-fill"></i>' : '<i class="ri-pause-fill"></i>');
    $mute.html(v.muted || v.volume === 0 ? '<i class="ri-volume-mute-fill"></i>' : '<i class="ri-volume-up-fill"></i>');
    $now.text(fmt(v.currentTime));
    $dur.text(fmt(v.duration));

    const p = (v.duration ? (v.currentTime / v.duration) : 0);
    $fill.css("width", `${p * 100}%`);
    $knob.css("left", `${p * 100}%`);
  }

  function seekByClientX(clientX) {
    const rect = $track[0].getBoundingClientRect();
    const x = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    const p = x / rect.width;
    if (v.duration) v.currentTime = p * v.duration;
  }

  function goNext() {
    const i = cfg.currentIndex;
    for (let j = i + 1; j < eps.length; j++) {
      if (eps[j].unlock) {
        showLoader(true);
        window.location.href = eps[j].href;
        return;
      }
    }
  }

  // events
  v.addEventListener("waiting", () => showLoader(true));
  v.addEventListener("playing", () => showLoader(false));
  v.addEventListener("canplay", () => showLoader(false));
  v.addEventListener("timeupdate", updateUI);
  v.addEventListener("durationchange", updateUI);
  v.addEventListener("play", updateUI);
  v.addEventListener("pause", updateUI);
  v.addEventListener("ended", () => {
    // auto next with small loader delay
    showLoader(true);
    setTimeout(goNext, 650);
  });

  // controls
  $play.on("click", togglePlay);
  $mute.on("click", () => { v.muted = !v.muted; updateUI(); });
  $vol.on("input", function () {
    v.volume = Number(this.value);
    if (v.volume > 0) v.muted = false;
    updateUI();
  });
  $fs.on("click", () => {
    const shell = document.querySelector(".pan-playerShell");
    if (!document.fullscreenElement) shell.requestFullscreen?.();
    else document.exitFullscreen?.();
  });
  $next.on("click", () => { showLoader(true); setTimeout(goNext, 350); });

  // progress click/drag
  let dragging = false;
  $track.on("mousedown", (e) => { dragging = true; seekByClientX(e.clientX); });
  $(document).on("mousemove", (e) => { if (dragging) seekByClientX(e.clientX); });
  $(document).on("mouseup", () => { dragging = false; });

  // keyboard shortcuts
  window.addEventListener("keydown", (e) => {
    if (["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
    if (e.code === "Space") { e.preventDefault(); togglePlay(); }
    if (e.code === "ArrowRight") v.currentTime += 5;
    if (e.code === "ArrowLeft") v.currentTime -= 5;
    if (e.code === "KeyM") { v.muted = !v.muted; updateUI(); }
    if (e.code === "KeyN") goNext();
  });

  // quality menu (mp4/hls from API)
  $qBtn.on("click", async () => {
    if ($qDrop.hasClass("is-open")) { $qDrop.removeClass("is-open"); return; }
    $qDrop.addClass("is-open").html(`<div class="pan-qItem">Loading…</div>`);
    try {
      const sources = await loadSources();
      if (!sources.length) {
        $qDrop.html(`<div class="pan-qItem">No sources</div>`);
        return;
      }
      $qDrop.html(sources.map(s => `
        <button class="pan-qItem" data-url="${s.url}">
          <i class="ri-radio-button-line"></i> ${s.label}
        </button>
      `).join(""));
      $qDrop.find(".pan-qItem").on("click", function () {
        const url = $(this).data("url");
        if (url) {
          setSource(url);
          v.play().catch(() => {});
        }
        $qDrop.removeClass("is-open");
      });
    } catch {
      $qDrop.html(`<div class="pan-qItem">Failed</div>`);
    }
  });

  $(document).on("click", (e) => {
    if (!$(e.target).closest("#panQuality, #panQualityDrop").length) $qDrop.removeClass("is-open");
  });

  // initial source
  const startUrl = cfg.videoUrl || cfg.hlsUrl || "";
  if (startUrl) setSource(startUrl);
  updateUI();
});
