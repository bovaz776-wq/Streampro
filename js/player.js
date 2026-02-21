/**
 * player.js — Player Engine
 * Manages video element, loading, playback, seeking, and all media operations.
 * Uses callbacks pattern to communicate with UI (avoids circular deps).
 */

import {
  $, clamp, fmtTime, fmtBytes, guessName, buildProxy, mediaKey,
  isHLSUrl, PROXY_URL, TRACKERS, isVideoExt, isPlayableExt,
  detectCodecSupport, getExt
} from "./config.js";

import { History, Queue, Settings, Bookmarks, PixelDrainCache } from "./store.js";
import { resolveMedia, tryLoadWithFallback, detectRangeSupport, getDownloadUrl, parseInput } from "./resolver.js";

// ═══════════════════════════════════════
//  CALLBACK SYSTEM
//  UI sets these via setPlayerCallbacks()
// ═══════════════════════════════════════
let _cb = {};
export function setPlayerCallbacks(cb) { _cb = { ..._cb, ...cb }; }
function emit(name, ...args) { if (_cb[name]) return _cb[name](...args); }

// ═══════════════════════════════════════
//  STATE
// ═══════════════════════════════════════
let v = null;             // HTMLVideoElement
let cur = null;           // current media info
let rangeOK = false;
let hls = null;           // HLS.js instance
let autoSaveTmr = null;

// Torrent
let wt = null, tor = null, torFile = null, torStatsTmr = null;

// AB Loop
let abA = null, abB = null, abOn = false;

// Local
let localObjURL = null;

// Seek
let seekResumeWanted = false;
let internalSeekPause = false;

// EQ audio graph (managed here, effects.js provides logic)
let audioCtx = null, mediaSrc = null, preGain = null, eqFilters = null, eqConnected = false;
let silenceCheckTmr = null;

// ═══════════════════════════════════════
//  GETTERS (read-only access for other modules)
// ═══════════════════════════════════════
export function getVideo() { return v; }
export function getCur() { return cur; }
export function isRangeOK() { return rangeOK; }
export function getHLS() { return hls; }
export function getABState() { return { abA, abB, abOn }; }
export function getLocalObjURL() { return localObjURL; }
export function getAudioCtx() { return audioCtx; }
export function isEqConnected() { return eqConnected; }
export function getMediaSrc() { return mediaSrc; }

// ═══════════════════════════════════════
//  INIT
// ═══════════════════════════════════════
export function init(videoEl) {
  v = videoEl;
  const s = Settings.load();
  v.volume = s.volume;
  v.muted = s.muted;
  v.playbackRate = s.rate;
  bindVideoEvents();
}

// ═══════════════════════════════════════
//  VIDEO EVENT BINDING
// ═══════════════════════════════════════
export function bindVideoEvents() {
  v.addEventListener("click", e => {
    if (e.target.closest(".controls")) return;
    togglePlay();
  });
  v.addEventListener("dblclick", e => {
    if (e.target.closest(".controls")) return;
    toggleFullscreen();
  });

  v.addEventListener("play", () => {
    emit("playStateChanged", false);
    emit("revealControls");
  });

  v.addEventListener("pause", () => {
    if (internalSeekPause) { internalSeekPause = false; return; }
    emit("playStateChanged", true);
    emit("revealControls");
    forceSave();
  });

  v.addEventListener("timeupdate", () => {
    emit("progressUpdate");
    checkAB();
  });

  v.addEventListener("progress", () => emit("bufferUpdate"));

  v.addEventListener("loadedmetadata", () => {
    updateMeta();
    emit("metaReady");
  });

  v.addEventListener("volumechange", () => {
    emit("volumeChanged", v.volume, v.muted);
  });

  v.addEventListener("ratechange", () => {
    emit("rateChanged", v.playbackRate);
  });

  // Seeking HUD — pause during seek to reduce decoder artifacts
  v.addEventListener("seeking", () => {
    if (!v.src) return;
    emit("seekHUD", true);
    if (!v.paused) {
      seekResumeWanted = true;
      internalSeekPause = true;
      v.pause();
    } else {
      seekResumeWanted = false;
    }
  });

  v.addEventListener("seeked", () => {
    const resume = () => {
      emit("seekHUD", false);
      if (seekResumeWanted) v.play().catch(() => {});
      seekResumeWanted = false;
    };
    if (typeof v.requestVideoFrameCallback === "function") {
      v.requestVideoFrameCallback(() => resume());
    } else {
      setTimeout(resume, 70);
    }
  });

  v.addEventListener("ended", () => {
    forceSave();
    emit("toast", "Playback ended", "ok");
    if (Queue.all().length) setTimeout(() => playNextFromQueue(), 600);
  });

  v.addEventListener("error", () => {
    if (v.error) console.warn("Video error code:", v.error.code, v.error.message);
  });
}

// ═══════════════════════════════════════
//  META UPDATE
// ═══════════════════════════════════════
function updateMeta() {
  let seekable = false;
  try {
    if (v.seekable?.length) seekable = v.seekable.end(v.seekable.length - 1) > 0;
  } catch {}
  rangeOK = rangeOK || seekable || cur?.kind === "local" || cur?.kind === "torrent" || cur?.provider === "HLS";
  emit("seekStatusChanged", rangeOK);
  emit("metaUpdated", {
    duration: v.duration,
    width: v.videoWidth,
    height: v.videoHeight,
    rate: v.playbackRate,
  });
}

// ═══════════════════════════════════════
//  STOP / CLEANUP
// ═══════════════════════════════════════
function stopHLS() {
  if (hls) { try { hls.destroy(); } catch {} hls = null; }
}

function stopTorrent() {
  if (torStatsTmr) { clearInterval(torStatsTmr); torStatsTmr = null; }
  if (tor) { try { tor.removeAllListeners(); tor.destroy({ destroyStore: true }); } catch {} tor = null; }
  torFile = null;
  emit("torrentStats", null);
}

export function stopAutoSave() {
  if (autoSaveTmr) { clearInterval(autoSaveTmr); autoSaveTmr = null; }
}

function startAutoSave() {
  stopAutoSave();
  autoSaveTmr = setInterval(() => {
    if (cur && isFinite(v.duration)) History.updateProgress(cur.id, v.currentTime, v.duration);
  }, 4000);
}

export function forceSave() {
  if (cur && isFinite(v.duration)) History.updateProgress(cur.id, v.currentTime, v.duration);
}

function revokeLocalURL() {
  if (localObjURL) { try { URL.revokeObjectURL(localObjURL); } catch {} localObjURL = null; }
}

export function stopMedia() {
  stopHLS();
  stopTorrent();
  stopAutoSave();
  stopSilenceCheck();
  try { v.pause(); v.removeAttribute("src"); v.load(); } catch {}
}

// ═══════════════════════════════════════
//  SEEK LOGIC
// ═══════════════════════════════════════
function bufferedContains(t) {
  try {
    for (let i = 0; i < v.buffered.length; i++) {
      if (t >= v.buffered.start(i) && t <= v.buffered.end(i)) return true;
    }
  } catch {}
  return false;
}

function doSeek(t) {
  if (typeof v.fastSeek === "function") v.fastSeek(t);
  else v.currentTime = t;
}

export function safeSeek(t) {
  if (!isFinite(v.duration)) return;
  t = clamp(t, 0, v.duration);

  if (rangeOK || bufferedContains(t)) { doSeek(t); return; }

  const before = v.currentTime;
  doSeek(t);

  setTimeout(() => {
    const close = Math.abs(v.currentTime - t) <= 2;
    if (!close && !bufferedContains(t) && !rangeOK) {
      try { v.currentTime = before; } catch {}
      emit("toast", "Server tidak mendukung seek jauh (byte-range).", "warn");
    }
  }, 900);
}

export function skip(sec) {
  if (!isFinite(v.duration)) return;
  safeSeek(v.currentTime + sec);
  emit("skipIndicator", sec < 0 ? "left" : "right", Math.abs(sec));
}

// ═══════════════════════════════════════
//  PLAY / PAUSE
// ═══════════════════════════════════════
export function togglePlay() {
  if (!v.src) return;
  if (v.paused) {
    v.play().catch(() => emit("toast", "Cannot autoplay", "warn"));
    emit("actionIndicator", "play");
  } else {
    v.pause();
    emit("actionIndicator", "pause");
  }
}

// ═══════════════════════════════════════
//  A/B LOOP
// ═══════════════════════════════════════
export function toggleAB() {
  if (!v.src) return;
  if (abA == null) {
    abA = v.currentTime;
    emit("toast", "A set: " + fmtTime(abA), "ok");
  } else if (abB == null) {
    abB = v.currentTime;
    abOn = true;
    const a = Math.min(abA, abB), b = Math.max(abA, abB);
    emit("toast", `Loop: ${fmtTime(a)} → ${fmtTime(b)}`, "ok");
  } else {
    abA = null; abB = null; abOn = false;
    emit("toast", "A/B cleared", "ok");
  }
  emit("abChanged", { abA, abB, abOn });
}

function checkAB() {
  if (!abOn || abA == null || abB == null) return;
  const a = Math.min(abA, abB), b = Math.max(abA, abB);
  if (v.currentTime >= b) v.currentTime = a;
}

// ═══════════════════════════════════════
//  SCREENSHOT
// ═══════════════════════════════════════
export async function screenshot() {
  if (!v.videoWidth || !v.videoHeight) return emit("toast", "No frame", "warn");
  const c = document.createElement("canvas");
  c.width = v.videoWidth; c.height = v.videoHeight;
  try {
    c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, "image/png"));
    if (!blob) throw new Error("No blob");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `screenshot-${fmtTime(v.currentTime).replace(/:/g, "-")}.png`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    emit("toast", "Screenshot saved", "ok");
  } catch { emit("toast", "Screenshot blocked by CORS", "warn"); }
}

// ═══════════════════════════════════════
//  FULLSCREEN & PIP
// ═══════════════════════════════════════
export async function toggleFullscreen() {
  const stage = $("#stage");
  try {
    if (!document.fullscreenElement) { await stage.requestFullscreen(); stage.classList.add("fs"); }
    else await document.exitFullscreen();
  } catch {}
}

export async function togglePiP() {
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else if (v.src) await v.requestPictureInPicture();
  } catch { emit("toast", "PiP not supported", "warn"); }
}

// ═══════════════════════════════════════
//  SUBTITLE
// ═══════════════════════════════════════
export function loadSubFile(file) {
  if (!file) return;
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const reader = new FileReader();
  reader.onload = () => {
    let text = String(reader.result || "");
    if (ext === "srt") {
      text = "WEBVTT\n\n" + text.replace(/\r+/g, "")
        .replace(/(\d+)\n(\d{2}:\d{2}:\d{2}),(\d{3}) --> (\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1\n$2.$3 --> $4.$5");
    } else if (!text.startsWith("WEBVTT")) {
      text = "WEBVTT\n\n" + text;
    }
    v.querySelectorAll("track").forEach(t => {
      if (t.src?.startsWith("blob:")) URL.revokeObjectURL(t.src);
      t.remove();
    });
    const blob = new Blob([text], { type: "text/vtt" });
    const url = URL.createObjectURL(blob);
    const track = document.createElement("track");
    track.kind = "subtitles"; track.label = file.name; track.srclang = "id";
    track.src = url; track.default = true;
    v.appendChild(track);
    setTimeout(() => { if (v.textTracks?.[0]) v.textTracks[0].mode = "showing"; }, 200);
    emit("toast", "Subtitle loaded", "ok");
  };
  reader.readAsText(file);
}

// ═══════════════════════════════════════
//  DOWNLOAD
// ═══════════════════════════════════════
export function downloadDirect() {
  if (!cur) return emit("toast", "No media loaded", "warn");
  const url = getDownloadUrl(cur);
  if (!url) return emit("toast", "Download unavailable", "warn");
  const a = document.createElement("a");
  a.href = url;
  a.download = cur.title || "video";
  a.target = "_blank";
  document.body.appendChild(a); a.click(); a.remove();
  emit("toast", "Download started", "ok");
}

// ═══════════════════════════════════════
//  RESUME FROM HISTORY
// ═══════════════════════════════════════
function resumeIfNeeded() {
  if (!cur) return;
  const pos = History.getPos(cur.id);
  if (pos > 5) {
    setTimeout(() => {
      if (isFinite(v.duration) && pos < v.duration - 3) {
        safeSeek(pos);
        emit("toast", "Resumed: " + fmtTime(pos), "ok");
      }
    }, 400);
  }
}

// ═══════════════════════════════════════
//  QUEUE HELPERS
// ═══════════════════════════════════════
export function addCurrentToQueue() {
  if (!cur) return emit("toast", "No media loaded", "warn");
  const ok = Queue.add({
    id: cur.id, kind: cur.kind, provider: cur.provider,
    title: cur.title, url: cur.url || cur.directURL, directURL: cur.directURL,
  });
  emit("toast", ok ? "Added to queue" : "Already in queue", ok ? "ok" : "warn");
}

export function playNextFromQueue() {
  const next = Queue.shift();
  if (!next) return emit("toast", "Queue empty", "warn");
  if (next.kind === "torrent") loadTorrent(next.url || next.directURL || "");
  else if (next.kind === "local") { emit("toast", "Reopen local file", "warn"); $("#fileIn").click(); }
  else loadMedia(next.url || next.directURL, true);
}

// ═══════════════════════════════════════
//  BOOKMARKS
// ═══════════════════════════════════════
export function addBookmark() {
  if (!cur || !isFinite(v.duration)) return emit("toast", "No video to bookmark", "warn");
  const ok = Bookmarks.add(cur.mediaKey, v.currentTime, `Mark @ ${fmtTime(v.currentTime)}`);
  emit("toast", ok ? "Bookmark added" : "Bookmark already near here", ok ? "ok" : "warn");
}

// ═══════════════════════════════════════
//  TRY LOAD SINGLE SRC
// ═══════════════════════════════════════
function tryLoadSrc(url, timeout = 18000) {
  return new Promise(resolve => {
    let done = false;
    const ok = () => { if (done) return; done = true; cleanup(); resolve(true); };
    const no = () => { if (done) return; done = true; cleanup(); resolve(false); };
    const cleanup = () => {
      v.removeEventListener("canplay", ok);
      v.removeEventListener("loadeddata", ok);
      v.removeEventListener("error", no);
      clearTimeout(tmr);
    };
    v.addEventListener("canplay", ok, { once: true });
    v.addEventListener("loadeddata", ok, { once: true });
    v.addEventListener("error", no, { once: true });
    try { v.src = url; v.load(); } catch { no(); return; }
    const tmr = setTimeout(no, timeout);
  });
}

// ═══════════════════════════════════════
//  LOAD MEDIA (URL / HLS / PixelDrain)
//  🔑 FIX UTAMA: resolve dulu, fallback chain, codec detection
// ═══════════════════════════════════════
export async function loadMedia(raw, fromHistory = false) {
  const parsed = parseInput(raw);
  if (!parsed) return;
  if (parsed.kind === "torrent") return loadTorrent(parsed.torrentId);

  stopMedia();
  revokeLocalURL();
  if (mediaSrc) await replaceVideoFresh();

  abA = abB = null; abOn = false;
  emit("abChanged", { abA, abB, abOn });

  // ── Step 1: Resolve URL via proxy ──
  emit("showLoading", "Resolving…", parsed.provider || "");

  let info;
  try {
    info = await resolveMedia(raw);
    if (!info) { emit("showError", "Invalid URL", "Cannot parse input."); return; }
  } catch (e) {
    emit("showError", "Resolve error", String(e));
    return;
  }

  // ── Step 2: MEGA warning (encrypted — cannot play) ──
  if (info.warning && info.warning.includes("encrypted")) {
    emit("showError", "Cannot play MEGA", info.warning);
    return;
  }

  // ── Step 3: Setup cur state ──
  cur = {
    kind: "url",
    provider: info.provider,
    url: raw,
    directURL: info.directURL,
    playURL: info.playURL,
    id: info.id,
    title: info.title,
    pdId: info.pdId || null,
    resolvedData: info.resolvedData,
    codecInfo: info.codecInfo,
  };
  cur.mediaKey = mediaKey(cur);

  emit("mediaInfo", {
    title: cur.title,
    provider: cur.provider,
    pdMeta: info.pdMeta,
    codecInfo: info.codecInfo,
  });

  // ── Step 4: Format warning (MKV/x265/10bit) — tapi TETAP coba play ──
  if (info.warning) {
    emit("formatWarning", info.warning);
  }
  if (info.codecInfo) {
    emit("codecInfo", info.codecInfo);
  }

  emit("showLoading", "Loading…", info.provider);

  // ── Step 5: HLS ──
  const isM3U8 = isHLSUrl(info.directURL);

  if (isM3U8) {
    if (window.Hls && Hls.isSupported()) {
      v.removeAttribute("src"); v.load();
      hls = new Hls({ maxBufferLength: 30, enableWorker: true });
      hls.loadSource(info.playURL);
      hls.attachMedia(v);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        rangeOK = true;
        emit("seekStatusChanged", true);
        emit("showVideo");
        emit("hlsReady", hls);
        _saveToHistory(info);
        emit("toast", "HLS ready", "ok");
        if (fromHistory) resumeIfNeeded();
      });
      hls.on(Hls.Events.ERROR, (_, d) => {
        if (d?.fatal) emit("showError", "HLS Error", "Fatal: " + (d.type || "unknown"));
      });
      return;
    }

    if (v.canPlayType("application/vnd.apple.mpegurl")) {
      const ok = await tryLoadSrc(info.playURL);
      if (ok) {
        rangeOK = true;
        emit("seekStatusChanged", true);
        emit("showVideo");
        _saveToHistory(info);
        if (fromHistory) resumeIfNeeded();
        return;
      }
    }

    emit("showError", "HLS Error", "Cannot play HLS (browser/CORS).");
    return;
  }

  // ── Step 6: Normal video — fallback chain ──
  const result = await tryLoadWithFallback(v, info);

  if (result.success) {
    emit("showVideo");
    // Detect byte-range for long seek
    const rs = await detectRangeSupport(result.usedUrl);
    rangeOK = rs === true;
    emit("seekStatusChanged", rangeOK);
    _saveToHistory(info);
    emit("toast", rangeOK ? "Seek: full (byte-range)" : "Seek: buffered only", rangeOK ? "ok" : "warn");
    if (fromHistory) resumeIfNeeded();
    return;
  }

  // ── Step 7: All URLs failed ──
  let errMsg = result.error || "Cannot load video.";
  if (info.codecInfo?.warning) {
    errMsg += "\n\n" + info.codecInfo.warning;
  }
  errMsg += "\n\nGunakan tombol Download untuk mendownload file dan putar dengan VLC.";
  emit("showError", "Cannot play", errMsg);
}

function _saveToHistory(info) {
  History.upsert({
    id: cur.id, kind: cur.kind, provider: cur.provider,
    title: cur.title, url: cur.url, directURL: cur.directURL,
    pos: 0, dur: 0, done: false,
    thumb: info.pdMeta?.thumb || null,
    type: info.pdMeta?.type || info.codecInfo?.container || null,
    size: info.pdMeta?.size ?? info.resolvedData?.filesize ?? null,
  });
  startAutoSave();
}

// ═══════════════════════════════════════
//  LOAD LOCAL FILE
// ═══════════════════════════════════════
export async function loadLocalFile(file) {
  if (!file) return;
  stopMedia();
  revokeLocalURL();
  if (mediaSrc) await replaceVideoFresh();

  localObjURL = URL.createObjectURL(file);
  const sig = `${file.name}:${file.size}:${file.lastModified}`;

  cur = {
    kind: "local", provider: "Local", title: file.name,
    id: `local:${sig}`, fileSig: sig,
    directURL: localObjURL, url: `local:${file.name}`,
  };
  cur.mediaKey = mediaKey(cur);

  // Codec check
  const codecInfo = detectCodecSupport(file.name, file.type);
  cur.codecInfo = codecInfo;

  emit("mediaInfo", {
    title: file.name, provider: "Local",
    pdMeta: null, codecInfo,
    fileType: file.type, fileSize: file.size,
  });

  if (codecInfo.warning) emit("formatWarning", codecInfo.warning);

  abA = abB = null; abOn = false;
  emit("abChanged", { abA, abB, abOn });
  rangeOK = true;
  emit("seekStatusChanged", true);
  emit("showLoading", "Opening…", file.type || "video");

  const ok = await tryLoadSrc(localObjURL);
  if (ok) {
    emit("showVideo");
    History.upsert({
      id: cur.id, kind: cur.kind, provider: cur.provider,
      title: cur.title, url: cur.url, directURL: cur.directURL,
      pos: 0, dur: 0, done: false, thumb: null,
      type: file.type || null, size: file.size || null,
    });
    startAutoSave();
    emit("toast", "File ready", "ok");
  } else {
    let msg = "Cannot play file.";
    if (codecInfo.warning) msg += " " + codecInfo.warning;
    emit("showError", "Unsupported format", msg);
  }
}

// ═══════════════════════════════════════
//  LOAD TORRENT (WebTorrent)
// ═══════════════════════════════════════
function ensureWT() { if (!wt) wt = new WebTorrent(); }

export async function loadTorrent(torrentId) {
  ensureWT();
  stopMedia();
  revokeLocalURL();
  if (mediaSrc) await replaceVideoFresh();

  emit("showLoading", "Torrent…", "Connecting to peers");
  emit("mediaInfo", { title: "Torrent", provider: "Torrent", pdMeta: null, codecInfo: null });

  abA = abB = null; abOn = false;
  emit("abChanged", { abA, abB, abOn });
  rangeOK = true;
  emit("seekStatusChanged", true);

  let torInput = torrentId;
  if (/^https?:\/\//i.test(torrentId) && /\.torrent(\?|#|$)/i.test(torrentId)) {
    try {
      const u = PROXY_URL ? buildProxy(torrentId) : torrentId;
      const res = await fetch(u);
      if (!res.ok) throw new Error("HTTP " + res.status);
      torInput = await res.arrayBuffer();
    } catch {
      emit("showError", "Torrent Error", "Cannot fetch .torrent URL. Try magnet or open file.");
      return;
    }
  }

  wt.add(torInput, { announce: TRACKERS }, t => {
    tor = t;
    torStatsTmr = setInterval(() => {
      if (!tor) return;
      emit("torrentStats", {
        peers: tor.numPeers || 0,
        progress: tor.progress != null ? (tor.progress * 100).toFixed(1) + "%" : "—",
        down: fmtBytes(tor.downloadSpeed) + "/s",
        up: fmtBytes(tor.uploadSpeed) + "/s",
      });
    }, 800);

    const files = (t.files || []).filter(f => isVideoExt(f.name));
    if (!files.length) { emit("showError", "Torrent Error", "No video files found."); return; }

    const playable = files.filter(f => isPlayableExt(f.name));
    const list = (playable.length ? playable : files).slice().sort((a, b) => b.length - a.length);

    if (list.length > 1) emit("torrentPicker", t, list);
    else selectTorrentFile(t, list[0]);
  });
}

export function selectTorrentFile(t, f) {
  torFile = f;
  emit("showLoading", "Torrent…", "Buffering video data");

  try {
    f.renderTo(v, { autoplay: false }, err => {
      if (err) { emit("showError", "Torrent Error", err.message); return; }

      cur = {
        kind: "torrent", provider: "Torrent", title: f.name,
        id: `tor:${t.infoHash}:${f.path}`, infoHash: t.infoHash,
        filePath: f.path, directURL: "magnet:" + t.infoHash, url: "magnet:" + t.infoHash,
      };
      cur.mediaKey = mediaKey(cur);

      emit("mediaInfo", { title: f.name, provider: "Torrent", pdMeta: null, codecInfo: null, torrentName: t.name, fileSize: f.length });
      History.upsert({
        id: cur.id, kind: cur.kind, provider: cur.provider,
        title: cur.title, url: cur.url, directURL: cur.directURL,
        pos: 0, dur: 0, done: false, thumb: null, type: null, size: f.length || null,
      });

      emit("showVideo");
      startAutoSave();
      emit("toast", "Torrent streaming", "ok");
    });
  } catch (e) { emit("showError", "Torrent Error", e?.message || "unknown"); }
}

// ═══════════════════════════════════════
//  RESET
// ═══════════════════════════════════════
export function resetPlayer() {
  stopMedia();
  revokeLocalURL();
  cur = null;
  rangeOK = false;
  abA = abB = null; abOn = false;
  emit("abChanged", { abA, abB, abOn });
  emit("showIdle");
  emit("mediaInfo", { title: "No video loaded", provider: null, pdMeta: null, codecInfo: null });
}

// ═══════════════════════════════════════
//  EQ — AUDIO GRAPH (used by effects.js)
// ═══════════════════════════════════════
export function canUseEQ() {
  if (!v.src) return false;
  if (v.src.startsWith("blob:")) return true;
  try { return new URL(v.src, location.href).origin === location.origin; } catch { return false; }
}

export function buildAudioGraph() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;
    if (!audioCtx) audioCtx = new Ctx();
    if (!mediaSrc) mediaSrc = audioCtx.createMediaElementSource(v);
    if (!preGain) preGain = audioCtx.createGain();
    if (!eqFilters) {
      const mk = (type, freq, q = 1.0) => {
        const f = audioCtx.createBiquadFilter();
        f.type = type; f.frequency.value = freq; f.Q.value = q; f.gain.value = 0;
        return f;
      };
      eqFilters = [mk("lowshelf", 60, 0.7), mk("peaking", 230, 1.0), mk("peaking", 910, 1.0), mk("peaking", 3600, 1.0), mk("highshelf", 14000, 0.7)];
    }
    return true;
  } catch (e) { console.warn("EQ build failed:", e); return false; }
}

export function disconnectAudio() {
  try { mediaSrc?.disconnect(); } catch {}
  try { preGain?.disconnect(); } catch {}
  if (eqFilters) eqFilters.forEach(f => { try { f.disconnect(); } catch {} });
  eqConnected = false;
}

export function connectDirect() {
  if (!mediaSrc || !audioCtx) return;
  disconnectAudio();
  mediaSrc.connect(audioCtx.destination);
  eqConnected = true;
}

export function connectEQ() {
  if (!mediaSrc || !preGain || !eqFilters || !audioCtx) return;
  disconnectAudio();
  mediaSrc.connect(preGain);
  let chain = preGain;
  eqFilters.forEach(f => { chain.connect(f); chain = f; });
  chain.connect(audioCtx.destination);
  eqConnected = true;
}

export function applyEQParams(eq) {
  if (!preGain || !eqFilters) return;
  preGain.gain.value = Math.pow(10, (Number(eq.pre) || 0) / 20);
  eqFilters[0].gain.value = Number(eq.b0) || 0;
  eqFilters[1].gain.value = Number(eq.b1) || 0;
  eqFilters[2].gain.value = Number(eq.b2) || 0;
  eqFilters[3].gain.value = Number(eq.b3) || 0;
  eqFilters[4].gain.value = Number(eq.b4) || 0;
}

export function resumeAudioCtx() {
  if (audioCtx) return audioCtx.resume();
}

// ═══ Silence check ═══
function stopSilenceCheck() {
  if (silenceCheckTmr) { clearInterval(silenceCheckTmr); silenceCheckTmr = null; }
}

export function startSilenceCheck(onSilenceDetected) {
  stopSilenceCheck();
  if (!audioCtx) return;
  let analyser;
  try { analyser = audioCtx.createAnalyser(); analyser.fftSize = 256; } catch { return; }
  try {
    const lastNode = eqFilters ? eqFilters[eqFilters.length - 1] : mediaSrc;
    if (!lastNode) return;
    const g = audioCtx.createGain(); g.gain.value = 1;
    lastNode.connect(g); g.connect(analyser);
  } catch { return; }

  const buf = new Uint8Array(analyser.frequencyBinCount);
  let silentFrames = 0;
  silenceCheckTmr = setInterval(() => {
    if (v.paused || v.muted || v.volume === 0) { silentFrames = 0; return; }
    analyser.getByteFrequencyData(buf);
    const sum = buf.reduce((a, b) => a + b, 0);
    if (sum === 0) { silentFrames++; if (silentFrames >= 6) { stopSilenceCheck(); onSilenceDetected(); } }
    else silentFrames = 0;
  }, 500);
}

// ═══ Replace video fresh (for EQ disable) ═══
function capturePlayState() {
  return {
    currentTime: isFinite(v.currentTime) ? v.currentTime : 0,
    paused: v.paused, volume: v.volume, muted: v.muted,
    rate: v.playbackRate, wasPlaying: !v.paused && v.readyState >= 2,
  };
}

export async function replaceVideoFresh() {
  const old = v;
  const nv = document.createElement("video");
  nv.id = "vid"; nv.setAttribute("playsinline", ""); nv.preload = "auto";
  nv.className = old.className; nv.style.filter = old.style.filter || "none";
  try { old.pause(); } catch {}
  old.replaceWith(nv);
  v = nv;
  disconnectAudio();
  mediaSrc = null; preGain = null; eqFilters = null; eqConnected = false;
  if (audioCtx) { try { audioCtx.close(); } catch {} audioCtx = null; }
  bindVideoEvents();
  emit("videoReplaced", v);
}

export async function restoreAfterReplace(state) {
  if (!cur) { emit("showIdle"); return; }
  v.volume = state.volume; v.muted = state.muted; v.playbackRate = state.rate;
  emit("volumeChanged", v.volume, v.muted);

  if (cur.kind === "torrent") { emit("toast", "EQ restore: reload torrent manually", "warn"); return; }

  if (cur.kind === "local" && localObjURL) {
    emit("showLoading", "Restoring…");
    const ok = await tryLoadSrc(localObjURL);
    if (ok) {
      emit("showVideo");
      if (state.currentTime > 1) safeSeek(state.currentTime);
      if (state.wasPlaying) v.play().catch(() => {});
      emit("toast", "Audio restored", "ok");
    } else { emit("showError", "Restore Error", "Cannot restore — reopen file"); }
    return;
  }

  const url = cur.playURL || cur.directURL || cur.url;
  if (!url) return;

  emit("showLoading", "Restoring…");
  const isM3U8 = isHLSUrl(cur.directURL || "");

  if (isM3U8 && window.Hls && Hls.isSupported()) {
    hls = new Hls({ maxBufferLength: 30, enableWorker: true });
    hls.loadSource(url); hls.attachMedia(v);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      emit("showVideo");
      if (state.currentTime > 1) safeSeek(state.currentTime);
      if (state.wasPlaying) v.play().catch(() => {});
      emit("toast", "Audio restored", "ok");
      emit("hlsReady", hls);
    });
    return;
  }

  const ok = await tryLoadSrc(url);
  if (ok) {
    emit("showVideo");
    if (state.currentTime > 1) safeSeek(state.currentTime);
    if (state.wasPlaying) v.play().catch(() => {});
    emit("toast", "Audio restored", "ok");
  } else { emit("showError", "Restore Error", "Cannot restore stream"); }
}

export { capturePlayState };