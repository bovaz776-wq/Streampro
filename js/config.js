/**
 * config.js — Constants, helpers, storage wrapper
 * Semua module lain import dari sini.
 */

// ═══════════════════════════════════════
//  PROXY
// ═══════════════════════════════════════
export const PROXY_URL = "https://euphonious-florentine-455517.netlify.app";

// ═══════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════
export const VERSION = "2.0.0";
export const K_SETTINGS = "sp_settings_v5";
export const K_HISTORY  = "sp_history_v5";
export const K_QUEUE    = "sp_queue_v5";
export const K_MARKS    = "sp_marks_v5";
export const K_PD       = "sp_pd_v2";
export const MAX_HISTORY = 80;

export const TRACKERS = [
  "wss://tracker.openwebtorrent.com",
  "wss://tracker.btorrent.xyz",
  "wss://tracker.fastcast.nz"
];

// Host patterns yang HARUS di-resolve via proxy
export const HOSTS_NEED_RESOLVE = [
  /gofile\.io/i,
  /store\d*\.gofile\.io/i,
  /drive\.google\.com/i,
  /docs\.google\.com/i,
  /drive\.usercontent\.google\.com/i,
  /mega\.nz/i,
  /mega\.co\.nz/i,
  /pixeldrain\.com/i,
  /mediafire\.com/i,
  /megaup\.net/i,
  /1fichier\.com/i,
  /krakenfiles\.com/i,
  /send\.cm/i,
  /streamtape\./i,
  /strtape\./i,
  /doodstream\./i,
  /dood\.\w+/i,
  /filemoon\./i,
  /streamwish\./i,
  /mp4upload\.com/i,
  /mixdrop\./i,
  /vidoza\./i,
  /voe\.\w+/i,
  /upstream\./i,
  /filelions\./i,
  /vtube\./i,
  /vtbe\./i,
  /hexupload\./i,
  /racaty\./i,
  /usersdrive\.com/i,
  /buzzheavier\.com/i,
  /bfrm\.io/i,
];

// ═══════════════════════════════════════
//  DOM HELPERS
// ═══════════════════════════════════════
export const $ = (s) => document.querySelector(s);
export const $$ = (s) => [...document.querySelectorAll(s)];

// ═══════════════════════════════════════
//  UTILITY FUNCTIONS
// ═══════════════════════════════════════
export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

export function escHTML(s) {
  return String(s).replace(/[&<>"']/g, m =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[m]
  );
}

export function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) return "0:00";
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

export function fmtBytes(b) {
  if (!isFinite(b) || b < 0) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return i === 0 ? `${Math.round(b)} ${u[i]}` : `${b.toFixed(1)} ${u[i]}`;
}

export function guessName(url, fallback = "Video") {
  try {
    const p = new URL(url).pathname.split("/").pop();
    if (p) return decodeURIComponent(p);
  } catch {}
  return fallback;
}

export function timeAgo(ts) {
  const d = Date.now() - ts;
  const s = d / 1000, m = s / 60, h = m / 60, dy = h / 24;
  if (s < 60) return "now";
  if (m < 60) return Math.floor(m) + "m";
  if (h < 24) return Math.floor(h) + "h";
  if (dy < 30) return Math.floor(dy) + "d";
  return "";
}

export function isInputFocused(el) {
  if (!el) return false;
  const t = (el.tagName || "").toLowerCase();
  return t === "input" || t === "textarea" || t === "select" || el.isContentEditable;
}

// ═══════════════════════════════════════
//  PROXY HELPERS
// ═══════════════════════════════════════
export function buildProxy(url) {
  if (!PROXY_URL) return url;
  const base = PROXY_URL.replace(/\/$/, "");
  return `${base}/?url=${encodeURIComponent(url)}`;
}

export function isRemoteURL(u) {
  try {
    const U = new URL(u, location.href);
    return U.origin !== location.origin;
  } catch { return false; }
}

/**
 * Cek apakah hostname harus di-resolve via proxy /resolve
 * sebelum bisa di-stream.
 */
export function hostNeedsResolve(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return HOSTS_NEED_RESOLVE.some(re => re.test(hostname));
  } catch { return false; }
}

// ═══════════════════════════════════════
//  FORMAT & CODEC DETECTION
// ═══════════════════════════════════════

const VIDEO_EXTS = new Set([
  "mp4","webm","m4v","mov","ogv","mkv","avi","flv","wmv",
  "m3u8","mpd","ts","m2ts","m4s"
]);
const AUDIO_EXTS = new Set(["mp3","m4a","ogg","opus","aac","wav","flac"]);

// Ekstensi yang browser BISA play secara native (umumnya)
const NATIVE_VIDEO_EXTS = new Set(["mp4","webm","m4v","mov","ogv","m3u8","ts"]);

// Ekstensi yang butuh handling khusus
const NEEDS_SPECIAL = new Set(["mkv","avi","flv","wmv","m2ts"]);

export function getExt(url) {
  try {
    const path = new URL(url).pathname.toLowerCase().split("?")[0];
    const dot = path.lastIndexOf(".");
    return dot < 0 ? "" : path.substring(dot + 1);
  } catch { return ""; }
}

export function isVideoExt(name) {
  const e = (name || "").split(".").pop()?.toLowerCase() || "";
  return VIDEO_EXTS.has(e);
}

export function isPlayableExt(name) {
  const e = (name || "").split(".").pop()?.toLowerCase() || "";
  return NATIVE_VIDEO_EXTS.has(e);
}

export function isHLSUrl(url) {
  return /\.m3u8(\?|#|$)/i.test(url);
}

export function isDASHUrl(url) {
  return /\.mpd(\?|#|$)/i.test(url);
}

/**
 * Deteksi codec support browser.
 * Return: { container, codec, canPlay, warning }
 */
export function detectCodecSupport(url, mimeType) {
  const ext = getExt(url);
  const v = document.createElement("video");
  const info = {
    container: ext.toUpperCase() || "unknown",
    codec: "unknown",
    canPlay: true,
    warning: null,
    needsSpecial: false,
  };

  // Deteksi dari MIME type jika ada
  if (mimeType) {
    const mt = mimeType.toLowerCase();
    if (mt.includes("x265") || mt.includes("hevc") || mt.includes("hvc1") || mt.includes("hev1")) {
      info.codec = "HEVC/x265";
      info.canPlay = !!v.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"');
      if (!info.canPlay) {
        info.warning = "HEVC/x265 tidak didukung browser ini. Gunakan Safari, Edge (+ HEVC ext), atau VLC.";
      }
    }
    if (mt.includes("matroska") || mt.includes("x-matroska")) {
      info.container = "MKV";
      info.needsSpecial = true;
    }
  }

  // Deteksi dari extension
  if (ext === "mkv") {
    info.container = "MKV";
    info.needsSpecial = true;
    // MKV with H.264 sering bisa play di Chrome
    const canMKV = !!v.canPlayType('video/x-matroska; codecs="avc1.640028"');
    const canWebM = !!v.canPlayType('video/webm; codecs="vp9"');
    if (!canMKV && !canWebM) {
      info.warning = info.warning || "MKV mungkin tidak bisa diputar. Coba tetap play — Chrome sering mendukung MKV+H.264.";
    }
  }

  if (ext === "avi") {
    info.container = "AVI";
    info.needsSpecial = true;
    info.canPlay = false;
    info.warning = "AVI tidak didukung browser. Gunakan VLC atau download file.";
  }

  if (ext === "flv") {
    info.container = "FLV";
    info.needsSpecial = true;
    info.canPlay = false;
    info.warning = "FLV tidak didukung browser. Gunakan VLC atau download file.";
  }

  if (ext === "wmv") {
    info.container = "WMV";
    info.needsSpecial = true;
    info.canPlay = false;
    info.warning = "WMV tidak didukung browser. Gunakan VLC atau download file.";
  }

  // Deteksi x265 dari nama file
  if (/x265|h\.?265|hevc/i.test(url)) {
    info.codec = "HEVC/x265";
    const hevcSupport = !!v.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"');
    if (!hevcSupport) {
      info.canPlay = false;
      info.warning = "HEVC/x265 tidak didukung browser ini. Gunakan Safari, Edge (+ HEVC ext), atau VLC.";
    }
  }

  // Deteksi 10bit dari nama file
  if (/10[\-\.]?bit/i.test(url)) {
    info.codec += " 10-bit";
    // 10-bit H.264 hampir tidak pernah didukung browser
    if (info.codec.includes("x265") || info.codec.includes("HEVC")) {
      // sudah ditangani di atas
    } else {
      // 10-bit H.264
      info.warning = info.warning || "10-bit video mungkin tidak didukung browser. Coba play — jika gagal, gunakan VLC.";
    }
  }

  return info;
}

// ═══════════════════════════════════════
//  STORAGE WRAPPER
// ═══════════════════════════════════════
export const Store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
    catch { return fallback; }
  },
  set(key, obj) {
    try { localStorage.setItem(key, JSON.stringify(obj)); }
    catch (e) { console.warn("Storage full:", e); }
  }
};

// ═══════════════════════════════════════
//  MEDIA KEY GENERATOR (for bookmarks)
// ═══════════════════════════════════════
export function mediaKey(cur) {
  if (!cur) return "";
  if (cur.kind === "torrent") return `tor:${cur.infoHash}:${cur.filePath}`;
  if (cur.kind === "local") return `local:${cur.fileSig}`;
  return `url:${cur.directURL || cur.url}`;
}