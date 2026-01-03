$(function () {
  const cfg = window.__PAN_PLAYER__ || {};
  const eps = window.__PAN_EPISODES__ || [];

  const v = document.getElementById("panVideo");
  if (!v) return;

  const $loader = $("#panPlayerLoader");
  const $play = $("#panPlay");
  const $mute = $("#panMute");
  const $vol = $("#panVol");
  const $fs = $("#panFs");
  const $next = $("#panNext");

  const $track = $("#panTrack");
  const $fill = $("#panFill");
  const $knob = $("#panKnob");
  const $buf = $("#panBuf"); // optional (kalau ada)
  const $now = $("#panTimeNow");
  const $dur = $("#panTimeDur");

  const $qBtn = $("#panQuality");
  const $qDrop = $("#panQualityDrop");

  const shell = document.querySelector(".pan-playerShell") || v.parentElement;
  const LS_KEY = `pan_player_pos_${cfg.bookId || "x"}_${cfg.chapterId || "x"}`;

  // =========================
  // Helpers
  // =========================
  function fmt(t) {
    if (!isFinite(t) || t < 0) return "0:00";
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function clamp(n, min, max) {
    return Math.min(Math.max(n, min), max);
  }

  function showLoader(on) {
    on ? $loader.addClass("is-show") : $loader.removeClass("is-show");
  }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  }

  function updateButtons() {
    $play.html(v.paused ? '<i class="ri-play-fill"></i>' : '<i class="ri-pause-fill"></i>');
    $mute.html(v.muted || v.volume === 0 ? '<i class="ri-volume-mute-fill"></i>' : '<i class="ri-volume-up-fill"></i>');
    if ($vol.length) $vol.val(String(v.muted ? 0 : v.volume));
  }

  function updateProgress() {
    $now.text(fmt(v.currentTime));
    $dur.text(fmt(v.duration));

    const p = v.duration ? (v.currentTime / v.duration) : 0;
    const pct = clamp(p * 100, 0, 100);

    $fill.css("width", `${pct}%`);
    $knob.css("left", `${pct}%`);

    // buffered (optional)
    if ($buf.length && v.duration && v.buffered && v.buffered.length) {
      const end = v.buffered.end(v.buffered.length - 1);
      const bp = clamp((end / v.duration) * 100, 0, 100);
      $buf.css("width", `${bp}%`);
    }
  }

  function togglePlay() {
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }

  function seekTo(percent) {
    if (!v.duration) return;
    v.currentTime = clamp(percent, 0, 1) * v.duration;
  }

  function seekBy(seconds) {
    if (!v.duration) return;
    v.currentTime = clamp(v.currentTime + seconds, 0, v.duration);
  }

  function goNext() {
    const i = Number(cfg.currentIndex || 0);
    for (let j = i + 1; j < eps.length; j++) {
      if (eps[j].unlock) {
        showLoader(true);
        window.location.href = eps[j].href;
        return;
      }
    }
  }

  async function loadSources() {
    const res = await fetch(`/api/sources?bookId=${encodeURIComponent(cfg.bookId)}&chapterId=${encodeURIComponent(cfg.chapterId)}`);
    const json = await res.json();
    return json.sources || [];
  }

  function setSource(url, { keepTime = true } = {}) {
    if (!url) return;

    const wasPaused = v.paused;
    const t = keepTime ? v.currentTime : 0;

    showLoader(true);
    v.pause();
    v.src = url;
    v.load();

    const restore = () => {
      if (keepTime && isFinite(t) && t > 0 && v.duration) {
        v.currentTime = clamp(t, 0, v.duration - 0.1);
      }
      if (!wasPaused) v.play().catch(() => {});
      showLoader(false);
      v.removeEventListener("canplay", restore);
    };

    v.addEventListener("canplay", restore);
  }

  // =========================
  // Controls Auto Hide (responsive UX)
  // =========================
  let uiTimer = null;

  function showControls() {
    if (!shell) return;
    shell.classList.remove("is-controlsHide");
    clearTimeout(uiTimer);
    uiTimer = setTimeout(() => {
      if (!v.paused) shell.classList.add("is-controlsHide");
    }, 2200);
  }

  function hideControlsNow() {
    if (!shell) return;
    if (!v.paused) shell.classList.add("is-controlsHide");
  }

  // show on any interaction
  ["mousemove", "touchstart", "pointerdown"].forEach((evt) => {
    shell?.addEventListener(evt, showControls, { passive: true });
  });

  // tap video toggles play/pause
  v.addEventListener("click", () => {
    togglePlay();
    showControls();
  });

  // =========================
  // Double tap seek (mobile)
  // =========================
  let lastTap = 0;
  v.addEventListener("touchend", (e) => {
    const now = Date.now();
    const dt = now - lastTap;
    lastTap = now;

    // double tap within 280ms
    if (dt < 280) {
      const touch = e.changedTouches?.[0];
      if (!touch) return;

      const rect = v.getBoundingClientRect();
      const x = touch.clientX - rect.left;
      const isLeft = x < rect.width / 2;

      seekBy(isLeft ? -10 : 10);
      showControls();
    }
  }, { passive: true });

  // =========================
  // Progress Seek - Pointer Events (mouse + touch + pen)
  // =========================
  let dragging = false;

  function clientXToPercent(clientX) {
    const rect = $track[0].getBoundingClientRect();
    const x = clamp(clientX - rect.left, 0, rect.width);
    return rect.width ? (x / rect.width) : 0;
  }

  function onSeekMove(clientX) {
    seekTo(clientXToPercent(clientX));
    updateProgress();
  }

  if ($track.length) {
    $track[0].addEventListener("pointerdown", (e) => {
      dragging = true;
      $track[0].setPointerCapture?.(e.pointerId);
      onSeekMove(e.clientX);
      showControls();
    });

    $track[0].addEventListener("pointermove", (e) => {
      if (!dragging) return;
      onSeekMove(e.clientX);
    });

    $track[0].addEventListener("pointerup", () => {
      dragging = false;
      showControls();
    });

    $track[0].addEventListener("pointercancel", () => {
      dragging = false;
    });
  }

  // =========================
  // Volume / Mute
  // =========================
  $play.on("click", () => { togglePlay(); showControls(); });

  $mute.on("click", () => {
    v.muted = !v.muted;
    if (!v.muted && v.volume === 0) v.volume = 0.6;
    updateButtons();
    showControls();
  });

  $vol.on("input", function () {
    const val = clamp(Number(this.value), 0, 1);
    v.volume = val;
    v.muted = val === 0;
    updateButtons();
    showControls();
  });

  // =========================
  // Fullscreen + PiP
  // =========================
  function toggleFullscreen() {
    if (!shell) return;

    // iOS safari: fullscreen via video element
    if (isIOS() && v.webkitEnterFullscreen) {
      v.webkitEnterFullscreen();
      return;
    }

    if (!document.fullscreenElement) shell.requestFullscreen?.();
    else document.exitFullscreen?.();
  }

  $fs.on("click", () => {
    toggleFullscreen();
    showControls();
  });

  document.addEventListener("fullscreenchange", () => {
    showControls();
  });

  // PiP: tekan "P"
  async function togglePiP() {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await v.requestPictureInPicture?.();
      }
    } catch {}
  }

  // =========================
  // Next
  // =========================
  $next.on("click", () => { showLoader(true); setTimeout(goNext, 250); });

  // =========================
  // Keyboard shortcuts
  // =========================
  window.addEventListener("keydown", (e) => {
    if (["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;

    if (e.code === "Space") { e.preventDefault(); togglePlay(); }
    if (e.code === "ArrowRight") seekBy(5);
    if (e.code === "ArrowLeft") seekBy(-5);
    if (e.code === "KeyM") { v.muted = !v.muted; updateButtons(); }
    if (e.code === "KeyF") toggleFullscreen();
    if (e.code === "KeyP") togglePiP();
    if (e.code === "KeyN") goNext();

    showControls();
  });

  // =========================
  // Quality menu
  // =========================
  $qBtn.on("click", async () => {
    if ($qDrop.hasClass("is-open")) { $qDrop.removeClass("is-open"); return; }

    $qDrop.addClass("is-open").html(`<div class="pan-qItem">Loading…</div>`);
    showControls();

    try {
      const sources = await loadSources();
      if (!sources.length) {
        $qDrop.html(`<div class="pan-qItem">No sources</div>`);
        return;
      }

      const currentUrl = v.currentSrc || v.src || "";

      $qDrop.html(sources.map(s => {
        const active = currentUrl && s.url && currentUrl.includes(s.url);
        return `
          <button class="pan-qItem ${active ? "is-active" : ""}" data-url="${s.url}">
            <i class="ri-radio-button-line"></i> ${s.label}
          </button>
        `;
      }).join(""));

      $qDrop.find(".pan-qItem").on("click", function () {
        const url = $(this).data("url");
        if (url) {
          setSource(url, { keepTime: true });
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

  // =========================
  // Save/restore progress
  // =========================
  function restoreProgress() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      const t = raw ? Number(raw) : 0;
      if (isFinite(t) && t > 3) {
        // restore after metadata ready
        const apply = () => {
          if (v.duration && t < v.duration - 2) v.currentTime = t;
          v.removeEventListener("loadedmetadata", apply);
        };
        v.addEventListener("loadedmetadata", apply);
      }
    } catch {}
  }

  let saveTick = 0;
  function saveProgress() {
    // save tiap ~1.5 detik
    const now = Date.now();
    if (now - saveTick < 1500) return;
    saveTick = now;

    try {
      if (isFinite(v.currentTime) && v.currentTime > 0) {
        localStorage.setItem(LS_KEY, String(v.currentTime));
      }
    } catch {}
  }

  // =========================
  // Video events
  // =========================
  v.addEventListener("waiting", () => showLoader(true));
  v.addEventListener("playing", () => { showLoader(false); updateButtons(); showControls(); });
  v.addEventListener("canplay", () => showLoader(false));
  v.addEventListener("timeupdate", () => { updateProgress(); saveProgress(); });
  v.addEventListener("durationchange", updateProgress);
  v.addEventListener("loadedmetadata", () => { updateProgress(); updateButtons(); });
  v.addEventListener("play", () => { updateButtons(); showControls(); });
  v.addEventListener("pause", () => { updateButtons(); showControls(); shell?.classList.remove("is-controlsHide"); });

  v.addEventListener("ended", () => {
    showLoader(true);
    // reset saved progress (biar next episode gak balik ke akhir)
    try { localStorage.removeItem(LS_KEY); } catch {}
    setTimeout(goNext, 550);
  });

  // =========================
  // Initial load
  // =========================
  const startUrl = cfg.videoUrl || cfg.hlsUrl || "";
  if (startUrl) setSource(startUrl, { keepTime: false });

  restoreProgress();
  updateButtons();
  updateProgress();
  showControls();
  hideControlsNow();
});
