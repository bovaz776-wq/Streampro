/**
 * resolver.js — Smart URL resolver (FIXED v2.1)
 * 
 * FIX: AbortSignal.timeout → manual AbortController
 * FIX: Better error logging
 * FIX: Smarter fallback chain
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

export function parseInput(raw) {
  let u = (raw || "").trim();
  if (!u) return null;

  if (u.startsWith("magnet:")) {
    return { kind: "torrent", torrentId: u, provider: "Torrent", directURL: u };
  }
  if (/\.torrent(\?|#|$)/i.test(u)) {
    return { kind: "torrent", torrentId: u, provider: "Torrent", directURL: u };
  }

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
//  SAFE FETCH WITH TIMEOUT
//  (FIX: AbortSignal.timeout tidak didukung semua browser)
// ═══════════════════════════════════════

function fetchWithTimeout(url, opts = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, {
    ...opts,
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));
}

// ═══════════════════════════════════════
//  RESOLVE VIA PROXY
// ═══════════════════════════════════════

async function callResolve(url) {
  if (!PROXY_URL) {
    console.warn("[resolver] No PROXY_URL configured");
    return null;
  }

  const base = PROXY_URL.replace(/\/$/, "");
  const resolveURL = `${base}/resolve?url=${encodeURIComponent(url)}`;

  console.log("[resolver] Calling resolve:", resolveURL);

  try {
    const resp = await fetchWithTimeout(resolveURL, {
      headers: { "Accept": "application/json" },
    }, 15000);

    console.log("[resolver] Resolve response status:", resp.status);

    if (!resp.ok) {
      console.warn("[resolver] Resolve HTTP error:", resp.status, resp.statusText);
      return null;
    }

    const text = await resp.text();
    console.log("[resolver] Resolve response body:", text.substring(0, 500));

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.warn("[resolver] Resolve response is not JSON:", e);
      return null;
    }

    if (data.resolved && data.url) {
      console.log("[resolver] ✓ Resolved:", data.url, "| note:", data.note || "—");
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

    console.warn("[resolver] Resolve returned resolved=false:", data);
    return null;
  } catch (e) {
    if (e.name === "AbortError") {
      console.warn("[resolver] Resolve timed out (15s)");
    } else {
      console.warn("[resolver] Resolve fetch error:", e);
    }
    return null;
  }
}

// ═══════════════════════════════════════
//  PROBE URL (check if streamable)
// ═══════════════════════════════════════

async function probeUrl(url) {
  try {
    const resp = await fetchWithTimeout(url, { method: "HEAD" }, 8000);
    const ct = (resp.headers.get("content-type") || "").toLowerCase();
    const cl = resp.headers.get("content-length");
    return {
      ok: resp.ok,
      status: resp.status,
      contentType: ct,
      contentLength: cl ? parseInt(cl) : null,
      isMedia: ct.startsWith("video/") || ct.startsWith("audio/") ||
               ct.includes("octet-stream") || ct.includes("matroska") ||
               ct.includes("mpegurl") || ct.includes("dash"),
      isHTML: ct.includes("text/html"),
    };
  } catch {
    return { ok: false, status: 0, contentType: "", isMedia: false, isHTML: false };
  }
}

// ═══════════════════════════════════════
//  MAIN RESOLVE FUNCTION
// ═══════════════════════════════════════

export async function resolveMedia(raw) {
  const parsed = parseInput(raw);
  if (!parsed) return null;

  if (parsed.kind === "torrent") {
    return {
      kind: "torrent", provider: "Torrent", url: raw,
      directURL: parsed.directURL, torrentId: parsed.torrentId,
      playURL: null, id: `tor:${raw}`, title: "Torrent",
      needsResolve: false, resolvedData: null, codecInfo: null,
      pdMeta: null, warning: null,
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

  console.log("[resolver] ── Resolving:", url);
  console.log("[resolver] Provider:", parsed.provider, "| needsResolve:", needsResolve);

  // ── Step 1: PixelDrain metadata ──
  if (parsed.pdId) {
    try {
      pdMeta = await Promise.race([
        PixelDrainCache.fetch(parsed.pdId),
        new Promise((_, rej) => setTimeout(() => rej("timeout"), 5000)),
      ]);
    } catch { pdMeta = null; }

    if (pdMeta?.name) title = pdMeta.name;
    directURL = `https://pixeldrain.com/api/file/${parsed.pdId}`;
    console.log("[resolver] PixelDrain ID:", parsed.pdId, "| directURL:", directURL);
  }

  // ── Step 2: Resolve via proxy ──
  if (needsResolve) {
    console.log("[resolver] Host needs resolve, calling proxy...");
    resolvedData = await callResolve(url);

    if (resolvedData) {
      directURL = resolvedData.url;
      if (resolvedData.filename) title = resolvedData.filename;

      if (resolvedData.note && resolvedData.note.includes("encrypted")) {
        warning = "MEGA files are AES encrypted. Browser tidak bisa play langsung. Download file dengan MEGA app lalu putar dengan VLC.";
      }
    } else {
      console.warn("[resolver] Resolve returned null — will try proxy streaming directly");
    }
  }

  // ── Step 3: Build play URL ──
  // Strategi: SELALU proxy untuk host yang butuh resolve
  // Untuk direct URL, coba langsung dulu
  if (needsResolve || parsed.pdId) {
    playURL = buildProxy(directURL);
    console.log("[resolver] Play via proxy:", playURL);
  } else if (isHLSUrl(directURL)) {
    playURL = buildProxy(directURL);
    console.log("[resolver] HLS via proxy:", playURL);
  } else {
    playURL = directURL;
    console.log("[resolver] Play direct:", playURL);
  }

  // ── Step 4: Codec detection ──
  const mimeType = pdMeta?.type || null;
  const codecInfo = detectCodecSupport(directURL, mimeType);

  if (codecInfo.warning && !warning) {
    warning = codecInfo.warning;
  }

  if (resolvedData?.filename) title = resolvedData.filename;
  if (pdMeta?.name) title = pdMeta.name;

  console.log("[resolver] ── Result:", {
    title, provider: parsed.provider, directURL, playURL,
    codec: codecInfo?.codec, container: codecInfo?.container,
    canPlay: codecInfo?.canPlay, warning,
  });

  return {
    kind: "url", provider: parsed.provider, url: raw,
    directURL, playURL, id: `url:${directURL}`, title,
    needsResolve, resolvedData, codecInfo, pdMeta,
    pdId: parsed.pdId || null, warning,
  };
}

// ═══════════════════════════════════════
//  RANGE SUPPORT DETECTION
// ═══════════════════════════════════════

export async function detectRangeSupport(url) {
  try {
    const resp = await fetchWithTimeout(url, {
      method: "GET",
      headers: { Range: "bytes=0-0" },
      cache: "no-store",
    }, 5000);

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
//  🔑 FIX: Better logging + probe before load
// ═══════════════════════════════════════

export async function tryLoadWithFallback(videoEl, mediaInfo) {
  const urls = [];
  const { playURL, directURL } = mediaInfo;

  // 1. Primary play URL (biasanya proxied)
  if (playURL) urls.push({ url: playURL, label: "proxy" });

  // 2. Direct URL tanpa proxy (jika beda)
  if (directURL && directURL !== playURL) {
    urls.push({ url: directURL, label: "direct" });
  }

  // 3. Direct URL via proxy (jika belum ada)
  const proxied = buildProxy(directURL);
  if (!urls.find(u => u.url === proxied)) {
    urls.push({ url: proxied, label: "proxy-fallback" });
  }

  // 4. Original URL via proxy (jika beda dari directURL)
  if (mediaInfo.url !== directURL) {
    const proxiedOrig = buildProxy(mediaInfo.url);
    if (!urls.find(u => u.url === proxiedOrig)) {
      urls.push({ url: proxiedOrig, label: "proxy-original" });
    }
  }

  console.log("[loader] ── Trying", urls.length, "URLs:");
  urls.forEach((u, i) => console.log(`  [${i}] ${u.label}: ${u.url.substring(0, 120)}...`));

  const errors = [];

  for (let i = 0; i < urls.length; i++) {
    const { url, label } = urls[i];
    console.log(`[loader] Attempt ${i + 1}/${urls.length} (${label})...`);

    const success = await _tryLoadSingle(videoEl, url);

    if (success) {
      console.log(`[loader] ✓ Success with ${label}`);
      return { success: true, usedUrl: url, tryIndex: i, label };
    }

    // Log kenapa gagal
    const errCode = videoEl.error?.code;
    const errMsg = videoEl.error?.message || "";
    const errDetail = `${label}: error code=${errCode} msg="${errMsg}"`;
    errors.push(errDetail);
    console.warn(`[loader] ✗ Failed ${label}:`, errDetail);
  }

  // Semua gagal — build detailed error
  const codecInfo = mediaInfo.codecInfo;
  let errorMsg = "Semua URL gagal dimuat.\n\n";

  if (codecInfo && !codecInfo.canPlay) {
    errorMsg += `Format: ${codecInfo.container} / ${codecInfo.codec}\n`;
    errorMsg += codecInfo.warning + "\n\n";
  }

  errorMsg += "Detail error:\n" + errors.join("\n") + "\n\n";
  errorMsg += "Gunakan tombol Download untuk download file, lalu putar dengan VLC.";

  console.error("[loader] ── All URLs failed:", errors);

  return {
    success: false,
    usedUrl: urls[0]?.url || "",
    error: errorMsg,
  };
}

function _tryLoadSingle(videoEl, url, timeout = 20000) {
  return new Promise(resolve => {
    let done = false;
    const ok = () => { if (done) return; done = true; cleanup(); resolve(true); };
    const no = () => { if (done) return; done = true; cleanup(); resolve(false); };

    const cleanup = () => {
      videoEl.removeEventListener("canplay", ok);
      videoEl.removeEventListener("loadeddata", ok);
      videoEl.removeEventListener("loadedmetadata", ok);
      videoEl.removeEventListener("error", no);
      clearTimeout(tmr);
    };

    // Listen for multiple success signals
    videoEl.addEventListener("canplay", ok, { once: true });
    videoEl.addEventListener("loadeddata", ok, { once: true });
    videoEl.addEventListener("loadedmetadata", ok, { once: true });
    videoEl.addEventListener("error", no, { once: true });

    try {
      videoEl.src = url;
      videoEl.load();
    } catch (e) {
      console.warn("[loader] Exception setting src:", e);
      no();
      return;
    }

    const tmr = setTimeout(() => {
      console.warn("[loader] Timeout after", timeout, "ms for:", url.substring(0, 80));
      no();
    }, timeout);
  });
}

// ═══════════════════════════════════════
//  DOWNLOAD URL
// ═══════════════════════════════════════

export function getDownloadUrl(mediaInfo) {
  if (!mediaInfo) return null;
  if (mediaInfo.resolvedData?.url) return buildProxy(mediaInfo.resolvedData.url);
  if (mediaInfo.directURL) return buildProxy(mediaInfo.directURL);
  return buildProxy(mediaInfo.url);
}
