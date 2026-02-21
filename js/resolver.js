/**
 * resolver.js — Smart URL resolver
 *
 * FLOW:
 *  1. Parse raw input → detect kind (torrent / direct / needs-resolve)
 *  2. Jika host butuh resolve → call proxy /resolve endpoint
 *  3. Return { playURL, directURL, headers, cookie, referer, provider, ... }
 *
 * FIXES:
 *  - GoFile CDN: butuh cookie accountToken
 *  - MEGA: encrypted, return warning
 *  - PixelDrain: /api/file/{id} + proxy
 *  - Semua host lain: proxy /resolve otomatis
 */

import {
  PROXY_URL, buildProxy, hostNeedsResolve,
  isHLSUrl, isDASHUrl, getExt, detectCodecSupport,
  guessName, isVideoExt
} from "./config.js";

import { PixelDrainCache } from "./store.js";

// ═══════════════════════════════════════
//  PARSE INPUT
// ═══════════════════════════════════════

/**
 * Parse user input string → structured object
 * @returns {object|null}
 */
export function parseInput(raw) {
  let u = (raw || "").trim();
  if (!u) return null;

  // Torrent / Magnet
  if (u.startsWith("magnet:")) {
    return { kind: "torrent", torrentId: u, provider: "Torrent", directURL: u };
  }
  if (/\.torrent(\?|#|$)/i.test(u)) {
    return { kind: "torrent", torrentId: u, provider: "Torrent", directURL: u };
  }

  // Normalize protocol
  if (!/^https?:\/\//i.test(u) && !u.startsWith("blob:")) {
    u = "https://" + u;
  }

  return {
    kind: "url",
    url: u,
    directURL: u,
    provider: detectProvider(u),
    pdId: PixelDrainCache.getId(u),
  };
}

/**
 * Detect provider name dari URL
 */
function detectProvider(url) {
  const h = (() => { try { return new URL(url).hostname.toLowerCase(); } catch { return ""; } })();

  if (h.includes("gofile.io")) return "GoFile";
  if (h.includes("google.com") || h.includes("googleusercontent.com")) return "Google Drive";
  if (h.includes("mega.nz") || h.includes("mega.co.nz")) return "MEGA";
  if (h.includes("pixeldrain.com")) return "PixelDrain";
  if (h.includes("mediafire.com")) return "MediaFire";
  if (h.includes("megaup.net")) return "MegaUp";
  if (h.includes("1fichier.com")) return "1Fichier";
  if (h.includes("krakenfiles.com")) return "Krakenfiles";
  if (h.includes("send.cm")) return "Send.cm";
  if (h.includes("streamtape") || h.includes("strtape")) return "StreamTape";
  if (h.includes("dood") || h.includes("ds2play") || h.includes("d0")) return "DoodStream";
  if (h.includes("filemoon")) return "FileMoon";
  if (h.includes("streamwish") || h.includes("wish")) return "StreamWish";
  if (h.includes("mp4upload")) return "Mp4Upload";
  if (h.includes("mixdrop") || h.includes("mixdrp")) return "MixDrop";
  if (h.includes("vidoza")) return "Vidoza";
  if (h.includes("voe.")) return "Voe";
  if (h.includes("upstream")) return "Upstream";
  if (h.includes("filelions") || h.includes("lions")) return "FileLions";
  if (h.includes("vtube") || h.includes("vtbe")) return "VTube";
  if (h.includes("hexupload")) return "HexUpload";
  if (h.includes("racaty")) return "Racaty";
  if (h.includes("usersdrive")) return "UsersDrive";
  if (h.includes("buzzheavier") || h.includes("bfrm.io")) return "Buzzheavier";
  if (isHLSUrl(url)) return "HLS";
  if (isDASHUrl(url)) return "DASH";
  return "Direct";
}

// ═══════════════════════════════════════
//  RESOLVE VIA PROXY
// ═══════════════════════════════════════

/**
 * Call proxy /resolve?url=... endpoint
 * @returns {object|null} { url, referer, origin, cookie, headers, note, filename, filesize }
 */
async function callResolve(url) {
  if (!PROXY_URL) return null;

  const base = PROXY_URL.replace(/\/$/, "");
  const resolveURL = `${base}/resolve?url=${encodeURIComponent(url)}`;

  try {
    const resp = await fetch(resolveURL, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) return null;
    const data = await resp.json();

    if (data.resolved && data.url) {
      return {
        url: data.url,
        referer: data.referer || null,
        origin: data.origin || null,
        cookie: data.cookie || null,
        headers: data.headers || null,
        note: data.note || null,
        filename: data.filename || null,
        filesize: data.filesize || null,
        mode: data.mode || "resolved",
      };
    }

    return null;
  } catch (e) {
    console.warn("Resolve failed:", e);
    return null;
  }
}

// ═══════════════════════════════════════
//  MAIN RESOLVE FUNCTION
// ═══════════════════════════════════════

/**
 * Resolve URL → mendapatkan playable URL + metadata
 *
 * @param {string} raw - URL dari user
 * @returns {object} {
 *   kind, provider, url, directURL, playURL,
 *   id, title, needsResolve,
 *   resolvedData, codecInfo, pdMeta,
 *   warning
 * }
 */
export async function resolveMedia(raw) {
  const parsed = parseInput(raw);
  if (!parsed) return null;

  // Torrent → return langsung
  if (parsed.kind === "torrent") {
    return {
      kind: "torrent",
      provider: "Torrent",
      url: raw,
      directURL: parsed.directURL,
      torrentId: parsed.torrentId,
      playURL: null,
      id: `tor:${raw}`,
      title: "Torrent",
      needsResolve: false,
      resolvedData: null,
      codecInfo: null,
      pdMeta: null,
      warning: null,
    };
  }

  const url = parsed.url;
  const needsResolve = hostNeedsResolve(url);

  let directURL = parsed.directURL;
  let playURL = null;
  let resolvedData = null;
  let title = guessName(url, parsed.provider);
  let pdMeta = null;
  let warning = null;

  // ── Step 1: PixelDrain metadata ──
  if (parsed.pdId) {
    try {
      pdMeta = await Promise.race([
        PixelDrainCache.fetch(parsed.pdId),
        new Promise((_, rej) => setTimeout(() => rej("timeout"), 5000)),
      ]);
    } catch { pdMeta = null; }

    if (pdMeta?.name) title = pdMeta.name;

    // PixelDrain direct API URL
    directURL = `https://pixeldrain.com/api/file/${parsed.pdId}`;
  }

  // ── Step 2: Resolve via proxy jika butuh ──
  if (needsResolve) {
    resolvedData = await callResolve(url);

    if (resolvedData) {
      directURL = resolvedData.url;
      if (resolvedData.filename) title = resolvedData.filename;

      // MEGA warning
      if (resolvedData.note && resolvedData.note.includes("encrypted")) {
        warning = "MEGA files are encrypted. Browser tidak bisa play langsung. Gunakan MEGA app atau download dulu.";
      }
    }
  }

  // ── Step 3: Build play URL ──
  if (resolvedData && resolvedData.cookie) {
    // Harus lewat proxy karena butuh cookie/headers
    playURL = buildProxy(directURL);
  } else if (needsResolve) {
    // Selalu proxy untuk host yang butuh resolve
    playURL = buildProxy(directURL);
  } else if (isHLSUrl(directURL)) {
    // HLS selalu proxy untuk rewrite
    playURL = buildProxy(directURL);
  } else {
    // Direct URL — coba tanpa proxy dulu, fallback ke proxy
    playURL = directURL;
  }

  // ── Step 4: Codec detection ──
  const mimeType = pdMeta?.type || null;
  const codecInfo = detectCodecSupport(directURL, mimeType);

  // Tambahan warning dari codec detection
  if (codecInfo.warning && !warning) {
    warning = codecInfo.warning;
  }

  // Update title dari filename jika ada
  if (resolvedData?.filename) title = resolvedData.filename;
  if (pdMeta?.name) title = pdMeta.name;

  return {
    kind: "url",
    provider: parsed.provider,
    url: raw,
    directURL,
    playURL,
    id: `url:${directURL}`,
    title,
    needsResolve,
    resolvedData,
    codecInfo,
    pdMeta,
    pdId: parsed.pdId || null,
    warning,
  };
}

// ═══════════════════════════════════════
//  RANGE SUPPORT DETECTION
// ═══════════════════════════════════════

/**
 * Detect apakah server support byte-range (untuk seek)
 * @returns {boolean|null} true/false/null(unknown)
 */
export async function detectRangeSupport(url) {
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { Range: "bytes=0-0" },
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });

    if (resp.status === 206) return true;
    const ar = (resp.headers.get("accept-ranges") || "").toLowerCase();
    if (ar.includes("bytes")) return true;
    return false;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════
//  MULTI-SOURCE FALLBACK CHAIN
// ═══════════════════════════════════════

/**
 * Coba load video dari beberapa URL secara berurutan.
 * Ini FIX utama: jika URL pertama gagal, coba proxy, coba direct, dll.
 *
 * @param {HTMLVideoElement} videoEl
 * @param {object} mediaInfo - dari resolveMedia()
 * @returns {{ success: boolean, usedUrl: string, error?: string }}
 */
export async function tryLoadWithFallback(videoEl, mediaInfo) {
  // Bangun chain URL yang akan dicoba
  const urls = [];
  const { playURL, directURL, resolvedData } = mediaInfo;

  // 1. Primary play URL
  if (playURL) urls.push(playURL);

  // 2. Direct URL tanpa proxy (jika beda dari playURL)
  if (directURL && directURL !== playURL) urls.push(directURL);

  // 3. Direct URL via proxy (jika belum ada di list)
  const proxied = buildProxy(directURL);
  if (!urls.includes(proxied)) urls.push(proxied);

  // 4. Original URL via proxy (jika beda)
  if (mediaInfo.url !== directURL) {
    const proxiedOrig = buildProxy(mediaInfo.url);
    if (!urls.includes(proxiedOrig)) urls.push(proxiedOrig);
  }

  // Coba satu per satu
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const success = await _tryLoadSingle(videoEl, url);

    if (success) {
      return { success: true, usedUrl: url, tryIndex: i };
    }
  }

  return {
    success: false,
    usedUrl: urls[0],
    error: "Semua URL gagal dimuat. Periksa link atau coba download langsung."
  };
}

/**
 * Coba load single URL ke video element
 * @returns {Promise<boolean>}
 */
function _tryLoadSingle(videoEl, url, timeout = 18000) {
  return new Promise(resolve => {
    let done = false;
    const ok = () => { if (done) return; done = true; cleanup(); resolve(true); };
    const no = () => { if (done) return; done = true; cleanup(); resolve(false); };

    const cleanup = () => {
      videoEl.removeEventListener("canplay", ok);
      videoEl.removeEventListener("loadeddata", ok);
      videoEl.removeEventListener("error", no);
      clearTimeout(tmr);
    };

    videoEl.addEventListener("canplay", ok, { once: true });
    videoEl.addEventListener("loadeddata", ok, { once: true });
    videoEl.addEventListener("error", no, { once: true });

    try {
      videoEl.src = url;
      videoEl.load();
    } catch {
      no();
      return;
    }

    const tmr = setTimeout(no, timeout);
  });
}

// ═══════════════════════════════════════
//  EXPORT UTILITIES
// ═══════════════════════════════════════

/**
 * Build download URL — prefer direct, fallback proxy
 */
export function getDownloadUrl(mediaInfo) {
  if (!mediaInfo) return null;

  // Jika ada resolved URL
  if (mediaInfo.resolvedData?.url) {
    return buildProxy(mediaInfo.resolvedData.url);
  }

  // Direct URL
  if (mediaInfo.directURL) {
    return buildProxy(mediaInfo.directURL);
  }

  return buildProxy(mediaInfo.url);
}