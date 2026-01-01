const root = document.getElementById("panPlayerRoot");
const video = document.getElementById("panVideo");
const overlay = document.getElementById("panOverlay");
const controls = document.getElementById("panControls");
const poster = document.getElementById("panPoster");

const seek = document.getElementById("panSeek");
const vol = document.getElementById("panVol");
const timeEl = document.getElementById("panTime");

const qualBtn = document.getElementById("panQualBtn");
const qualMenu = document.getElementById("panQualMenu");

const playIcon = document.getElementById("panPlayIcon");
const volIcon = document.getElementById("panVolIcon");

const nextOverlay = document.getElementById("panNextOverlay");
const nextMeta = document.getElementById("panNextMeta");
const cancelNext = document.getElementById("panCancelNext");

const toast = document.getElementById("panToast");
const bright = document.getElementById("panBright");

const episodes = window.__PAN_EPISODES__ || [];

const bookId = root.dataset.book;
const chapterId = root.dataset.chapter;
const index = Number(root.dataset.index || 0);

let uiTimer = null;
let dragging = false;
let theater = false;

let loadingState = true;
let nextTimer = null;
let nextCountdown = 4;
let pendingNextHref = null;

let brightnessLevel = 0.0; // 0 = normal, 0.6 = darker overlay
let gesture = {
  active: false,
  startX: 0,
  startY: 0,
  startTime: 0,
  side: "left", // left/right
  mode: null,   // volume/brightness
  lastTapAt: 0,
  lastTapX: 0,
  tapCount: 0
};

function fmt(t) {
  t = Math.max(0, Number(t || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  if (h > 0) return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

function showUI() {
  controls.classList.add("pan-uiOn");
  clearTimeout(uiTimer);
  uiTimer = setTimeout(() => {
    if (!video.paused && !loadingState) controls.classList.remove("pan-uiOn");
  }, 1600);
}

function setLoading(on, label) {
  loadingState = !!on;
  root.classList.toggle("pan-loading", loadingState);
  const lab = root.querySelector(".pan-loadingLabel");
  if (lab) lab.setAttribute("data-label", label || "Loading…");
  showUI();
}

function setSource(url) {
  setLoading(true, "Preparing stream…");
  video.pause();
  video.src = url;
  video.load();
}

function progressKey() {
  return `panstream:progress:${bookId}:${chapterId}`;
}

function saveProgress() {
  if (!video.duration || !isFinite(video.duration)) return;
  localStorage.setItem(progressKey(), JSON.stringify({
    t: video.currentTime,
    d: video.duration,
    at: Date.now()
  }));
}

function restoreProgress() {
  const raw = localStorage.getItem(progressKey());
  if (!raw) return;
  try {
    const j = JSON.parse(raw);
    if (j && typeof j.t === "number" && j.t > 8) {
      video.currentTime = Math.min(j.t, Math.max(0, (video.duration || j.d) - 2));
    }
  } catch {}
}

function buildQualityList(baseUrl) {
  const qualities = [1080, 720, 540, 360, 144];
  const list = [];
  for (const q of qualities) {
    const candidate = baseUrl.replace(/\.(\d{3,4})p\./, `.${q}p.`);
    if (candidate !== baseUrl || q === 720) list.push({ q, url: candidate });
  }
  const uniq = new Map();
  list.forEach(it => uniq.set(String(it.q), it));
  return [...uniq.values()].sort((a, b) => b.q - a.q);
}

function renderQualityMenu(list) {
  qualMenu.innerHTML = "";
  list.forEach((it) => {
    const btn = document.createElement("button");
    btn.className = "pan-qualItem";
    btn.innerHTML = `<span>${it.q}p</span><i class="ri-sparkling-2-line"></i>`;
    btn.onclick = () => switchQuality(it.url);
    qualMenu.appendChild(btn);
  });
}

function switchQuality(url) {
  const t = video.currentTime || 0;
  const wasPaused = video.paused;

  setLoading(true, "Switching quality…");
  setSource(url);

  video.addEventListener("loadedmetadata", () => {
    video.currentTime = Math.min(t, Math.max(0, (video.duration || t) - 0.5));
    if (!wasPaused) video.play().catch(() => {});
  }, { once: true });

  qualMenu.classList.remove("pan-qualOpen");
}

function setPlayIcon() {
  if (!playIcon) return;
  playIcon.className = video.paused ? "ri-play-fill" : "ri-pause-fill";
}

function setVolIcon() {
  if (!volIcon) return;
  if (video.muted || video.volume === 0) volIcon.className = "ri-volume-mute-fill";
  else if (video.volume < 0.4) volIcon.className = "ri-volume-down-fill";
  else volIcon.className = "ri-volume-up-fill";
}

function toastMsg(msg) {
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add("on");
  setTimeout(() => toast.classList.remove("on"), 650);
}

function applyBrightness() {
  const v = Math.max(0, Math.min(0.7, brightnessLevel));
  if (bright) bright.style.opacity = String(v);
}

function togglePlay() {
  if (video.paused) {
    poster.classList.add("pan-hide");
    setLoading(true, "Starting playback…");
    video.play().catch(() => {});
  } else {
    video.pause();
    controls.classList.add("pan-uiOn");
  }
  setPlayIcon();
}

function seekToRatio(r) {
  if (!video.duration) return;
  video.currentTime = Math.max(0, Math.min(video.duration, r * video.duration));
}

function toggleTheater() {
  theater = !theater;
  root.classList.toggle("pan-theater", theater);
}

async function togglePiP() {
  if (!document.pictureInPictureEnabled) return;
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else await video.requestPictureInPicture();
  } catch {}
}

async function toggleFS() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await root.requestFullscreen();
  } catch {}
}

/** Prefetch Next Episode (document) */
function prefetchNext() {
  const nxt = episodes[index + 1];
  if (!nxt?.href) return;

  // 1) prefetch link hint
  const link = document.createElement("link");
  link.rel = "prefetch";
  link.as = "document";
  link.href = nxt.href;
  document.head.appendChild(link);

  // 2) warm cache via fetch (best-effort)
  fetch(nxt.href, { method: "GET", credentials: "same-origin" }).catch(() => {});
}

/** Auto Next */
function clearNextOverlay() {
  nextOverlay?.classList.remove("on");
  pendingNextHref = null;
  nextCountdown = 4;
  if (nextTimer) clearInterval(nextTimer);
  nextTimer = null;
}

function startAutoNext() {
  const nxt = episodes[index + 1];
  if (!nxt || !nxt.href) return;

  pendingNextHref = nxt.href;
  nextCountdown = 4;

  if (nextOverlay) {
    nextOverlay.classList.add("on");
    nextMeta.textContent = `Next episode in ${nextCountdown}s…`;
  }

  if (nextTimer) clearInterval(nextTimer);
  nextTimer = setInterval(() => {
    nextCountdown -= 1;
    if (nextMeta) nextMeta.textContent = `Next episode in ${nextCountdown}s…`;
    if (nextCountdown <= 0) {
      clearInterval(nextTimer);
      nextTimer = null;
      if (nextMeta) nextMeta.textContent = "Loading next episode…";
      setLoading(true, "Loading next episode…");
      setTimeout(() => (window.location.href = pendingNextHref), 220);
    }
  }, 1000);
}

/** ============ Controls Bindings ============ */
root.addEventListener("mousemove", showUI);

root.addEventListener("click", (e) => {
  const a = e.target?.dataset?.action || e.target?.closest("[data-action]")?.dataset?.action;
  if (!a) return;

  if (a === "play") togglePlay();
  if (a === "next") startAutoNext();
  if (a === "theater") toggleTheater();
  if (a === "pip") togglePiP();
  if (a === "fs") toggleFS();
  if (a === "rew") { video.currentTime = Math.max(0, (video.currentTime || 0) - 10); toastMsg("⟲ 10s"); }
  if (a === "fwd") { video.currentTime = Math.min(video.duration || 0, (video.currentTime || 0) + 10); toastMsg("10s ⟳"); }
  if (a === "mute") { video.muted = !video.muted; setVolIcon(); toastMsg(video.muted ? "Muted" : "Unmuted"); }
});

overlay.addEventListener("click", () => togglePlay());

qualBtn.addEventListener("click", () => {
  qualMenu.classList.toggle("pan-qualOpen");
});

cancelNext?.addEventListener("click", () => {
  clearNextOverlay();
  setLoading(false);
});

seek.addEventListener("input", () => {
  dragging = true;
  const r = Number(seek.value) / 1000;
  if (video.duration) {
    const t = r * video.duration;
    timeEl.textContent = `${fmt(t)} / ${fmt(video.duration)}`;
  }
});

seek.addEventListener("change", () => {
  const r = Number(seek.value) / 1000;
  seekToRatio(r);
  dragging = false;
});

vol.addEventListener("input", () => {
  video.volume = Number(vol.value);
  video.muted = false;
  setVolIcon();
});

/** Keyboard shortcuts */
window.addEventListener("keydown", (e) => {
  if (["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;

  if (e.code === "Space") { e.preventDefault(); togglePlay(); }
  if (e.code === "ArrowLeft") { video.currentTime = Math.max(0, (video.currentTime || 0) - 5); toastMsg("⟲ 5s"); }
  if (e.code === "ArrowRight") { video.currentTime = Math.min(video.duration || 0, (video.currentTime || 0) + 5); toastMsg("5s ⟳"); }
  if (e.key.toLowerCase() === "n") startAutoNext();
  if (e.key.toLowerCase() === "t") toggleTheater();
  if (e.key.toLowerCase() === "f") toggleFS();
});

/** ============ Video Loading States ============ */
video.addEventListener("loadstart", () => setLoading(true, "Loading stream…"));
video.addEventListener("waiting", () => setLoading(true, "Buffering…"));
video.addEventListener("stalled", () => setLoading(true, "Network stalled…"));
video.addEventListener("canplay", () => setLoading(false));
video.addEventListener("playing", () => { setLoading(false); setPlayIcon(); });

video.addEventListener("pause", () => {
  setPlayIcon();
  controls.classList.add("pan-uiOn");
});

video.addEventListener("timeupdate", () => {
  if (!video.duration || dragging) return;
  const r = video.currentTime / video.duration;
  seek.value = String(Math.floor(r * 1000));
  timeEl.textContent = `${fmt(video.currentTime)} / ${fmt(video.duration)}`;

  if (Math.floor(video.currentTime) % 5 === 0) saveProgress();

  // prefetch ketika mendekati akhir (lebih seamless)
  if (video.duration - video.currentTime < 25) prefetchNext();
});

video.addEventListener("loadedmetadata", () => {
  restoreProgress();
  setVolIcon();
  setPlayIcon();
  showUI();
});

video.addEventListener("ended", () => {
  saveProgress();
  startAutoNext();
});

/** ============ Mobile Gestures ============ */
function onPointerDown(e) {
  gesture.active = true;
  gesture.startX = e.clientX;
  gesture.startY = e.clientY;
  gesture.startTime = Date.now();

  const rect = root.getBoundingClientRect();
  const mid = rect.left + rect.width / 2;
  gesture.side = e.clientX < mid ? "left" : "right";

  gesture.mode = null;
}

function onPointerMove(e) {
  if (!gesture.active) return;

  const dx = e.clientX - gesture.startX;
  const dy = e.clientY - gesture.startY;

  // decide mode by vertical intent
  if (!gesture.mode && Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) {
    gesture.mode = (gesture.side === "right") ? "volume" : "brightness";
    toastMsg(gesture.mode === "volume" ? "Volume" : "Brightness");
  }

  if (gesture.mode === "volume") {
    // swipe up -> louder, down -> quieter
    const delta = -dy / 320; // sensitivity
    const v = Math.max(0, Math.min(1, (video.volume || 1) + delta));
    video.volume = v;
    video.muted = false;
    if (vol) vol.value = String(v);
    setVolIcon();
  }

  if (gesture.mode === "brightness") {
    // swipe up -> brighter (less overlay), down -> darker (more overlay)
    const delta = dy / 360;
    brightnessLevel = Math.max(0, Math.min(0.7, brightnessLevel + delta));
    applyBrightness();
  }

  showUI();
}

function onPointerUp(e) {
  if (!gesture.active) return;
  gesture.active = false;

  // Double tap seek (only if it was a tap, not a swipe)
  const dt = Date.now() - gesture.startTime;
  const moved = Math.hypot(e.clientX - gesture.startX, e.clientY - gesture.startY);

  if (dt < 220 && moved < 10) {
    const now = Date.now();
    const sameZone = Math.abs(e.clientX - gesture.lastTapX) < 80 && (now - gesture.lastTapAt) < 320;

    if (sameZone) {
      // double tap action
      const rect = root.getBoundingClientRect();
      const mid = rect.left + rect.width / 2;
      if (e.clientX < mid) {
        video.currentTime = Math.max(0, (video.currentTime || 0) - 10);
        toastMsg("⟲ 10s");
      } else {
        video.currentTime = Math.min(video.duration || 0, (video.currentTime || 0) + 10);
        toastMsg("10s ⟳");
      }
      gesture.lastTapAt = 0;
      gesture.lastTapX = 0;
    } else {
      gesture.lastTapAt = now;
      gesture.lastTapX = e.clientX;
    }
  }
}

root.addEventListener("pointerdown", onPointerDown, { passive: true });
root.addEventListener("pointermove", onPointerMove, { passive: true });
root.addEventListener("pointerup", onPointerUp, { passive: true });
root.addEventListener("pointercancel", onPointerUp, { passive: true });

/** Init */
(function init() {
  const src = root.dataset.video || "";
  setSource(src);

  const qList = buildQualityList(src);
  renderQualityMenu(qList);

  poster.classList.remove("pan-hide");
  controls.classList.add("pan-uiOn");

  setVolIcon();
  setPlayIcon();
  applyBrightness();

  // prefetch next page early
  prefetchNext();
})();
