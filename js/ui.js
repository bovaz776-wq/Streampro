/**
 * ui.js — View layer
 * Renders all UI, handles DOM events, delegates actions to Player.
 */

import {
  $, $$, clamp, escHTML, fmtTime, fmtBytes, timeAgo,
  isInputFocused, buildProxy, mediaKey, isVideoExt
} from "./config.js";

import { History, Queue, Bookmarks, Settings } from "./store.js";
import * as Player from "./player.js";
import { applyVisual, updateVisualUI, updateEqUI, toggleEQ, resetEQ, resetVisual } from "./effects.js";

// ═══════════════════════════════════════
//  TOAST
// ═══════════════════════════════════════
export function toast(msg, type = "") {
  const host = $("#toasts");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  host.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("show")));
  setTimeout(() => el.classList.remove("show"), 2600);
  setTimeout(() => el.remove(), 3100);
}

// ═══════════════════════════════════════
//  OVERLAYS
// ═══════════════════════════════════════
export function showIdle() {
  $("#ovIdle").classList.remove("hide");
  $("#ovLoad").classList.add("hide");
  $("#ovErr").classList.add("hide");
  Player.getVideo().classList.remove("show");
  $("#qualMenu").style.display = "none";
  hideFormatWarning();
  setSeekStatus("idle");
}

export function showLoading(title, sub = "") {
  $("#ldTitle").textContent = title || "Loading…";
  $("#ldSub").textContent = sub || "";
  $("#ovIdle").classList.add("hide");
  $("#ovErr").classList.add("hide");
  $("#ovLoad").classList.remove("hide");
  Player.getVideo().classList.remove("show");
}

export function showError(title, msg) {
  $("#errTitle").textContent = title || "Cannot play";
  $("#errText").textContent = msg || "Unknown error";
  $("#ovIdle").classList.add("hide");
  $("#ovLoad").classList.add("hide");
  $("#ovErr").classList.remove("hide");
  Player.getVideo().classList.remove("show");
  Player.stopAutoSave();
  setSeekStatus("warn");
}

export function showVideo() {
  $("#ovIdle").classList.add("hide");
  $("#ovLoad").classList.add("hide");
  $("#ovErr").classList.add("hide");
  Player.getVideo().classList.add("show");
  applyVisual();
  updateEqUI();
  renderBookmarks();
  renderBMMarkers();
}

// ═══════════════════════════════════════
//  FORMAT WARNING BAR
// ═══════════════════════════════════════
export function showFormatWarning(msg) {
  const bar = $("#formatBar");
  const txt = $("#formatMsg");
  if (!bar || !txt) return;
  txt.textContent = msg;
  bar.classList.add("show");
}

export function hideFormatWarning() {
  $("#formatBar")?.classList.remove("show");
}

// ═══════════════════════════════════════
//  SEEK STATUS & BADGE
// ═══════════════════════════════════════
export function setSeekStatus(mode) {
  const dot = $("#seekDot"), text = $("#seekText");
  if (!dot || !text) return;
  dot.classList.remove("ok", "warn");
  if (mode === "ok" || mode === true) { dot.classList.add("ok"); text.textContent = "SEEKABLE"; }
  else if (mode === "warn" || mode === false) { dot.classList.add("warn"); text.textContent = "BUFFERED"; }
  else text.textContent = "READY";
}

export function setSeekBadge(isOK) {
  const b = $("#seekBadge"), info = $("#iSeek");
  if (isOK) {
    if (b) { b.className = "badge ok"; b.textContent = "SEEK: FULL"; }
    if (info) { info.className = "v good"; info.textContent = "Full"; }
  } else {
    if (b) { b.className = "badge warn"; b.textContent = "SEEK: BUFFERED"; }
    if (info) { info.className = "v warn"; info.textContent = "Buffered"; }
  }
  setSeekStatus(isOK);
}

// ═══════════════════════════════════════
//  ACTION INDICATORS (Apple-style feedback)
// ═══════════════════════════════════════
export function showActionIndicator(type) {
  const ind = $("#actionInd"), icon = $("#actionIcon");
  const paths = {
    play: '<path d="M6 4l15 8-15 8V4z"/>',
    pause: '<rect x="5" y="4" width="5" height="16" rx="1"/><rect x="14" y="4" width="5" height="16" rx="1"/>',
    mute: '<path d="M11 5l-5 4H2v6h4l5 4V5z"/><line x1="22" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="22" y2="15"/>',
    unmute: '<path d="M11 5l-5 4H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>',
  };
  if (paths[type]) icon.innerHTML = paths[type];
  ind.classList.remove("pop");
  void ind.offsetWidth;
  ind.classList.add("pop");
}

export function showSkipIndicator(dir, seconds = 10) {
  const el = dir === "left" ? $("#skipLeft") : $("#skipRight");
  el.querySelector("span").textContent = `${seconds}s`;
  el.classList.remove("pop");
  void el.offsetWidth;
  el.classList.add("pop");
}

// ═══════════════════════════════════════
//  SEEK HUD
// ═══════════════════════════════════════
let seekHUD = null;
function ensureSeekHUD() {
  if (seekHUD) return;
  seekHUD = document.createElement("div");
  seekHUD.style.cssText = `position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:112px;height:44px;display:none;align-items:center;justify-content:center;gap:10px;border-radius:14px;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.12);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);z-index:20;color:rgba(255,255,255,.92);font-weight:850;font-size:12px;letter-spacing:-.01em;`;
  const spin = document.createElement("div");
  spin.style.cssText = `width:18px;height:18px;border-radius:999px;border:2px solid rgba(255,255,255,.18);border-top-color:rgba(255,255,255,.85);animation:spSpin .7s linear infinite;`;
  const txt = document.createElement("div"); txt.textContent = "Seeking";
  seekHUD.appendChild(spin); seekHUD.appendChild(txt);
  $("#stage").appendChild(seekHUD);
}

export function showSeekHUD(on) {
  ensureSeekHUD();
  seekHUD.style.display = on ? "flex" : "none";
}

// ═══════════════════════════════════════
//  ICON UPDATERS
// ═══════════════════════════════════════
export function updatePlayIcon() {
  const v = Player.getVideo();
  $("#playIcon").innerHTML = v.paused
    ? '<path d="M6 4l15 8-15 8V4z"/>'
    : '<rect x="5" y="4" width="5" height="16" rx="1"/><rect x="14" y="4" width="5" height="16" rx="1"/>';
}

export function updateVolIcon() {
  const v = Player.getVideo();
  const ic = $("#volIcon");
  if (v.muted || v.volume === 0) {
    ic.innerHTML = '<path d="M11 5l-5 4H2v6h4l5 4V5z"/><line x1="22" y1="9" x2="17" y2="15" stroke="currentColor"/><line x1="17" y1="9" x2="22" y2="15" stroke="currentColor"/>';
  } else if (v.volume < 0.5) {
    ic.innerHTML = '<path d="M11 5l-5 4H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>';
  } else {
    ic.innerHTML = '<path d="M11 5l-5 4H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>';
  }
}

// ═══════════════════════════════════════
//  PROGRESS / BUFFER
// ═══════════════════════════════════════
export function updateProgress() {
  const v = Player.getVideo();
  if (!isFinite(v.duration)) { $("#time").textContent = "0:00 / 0:00"; return; }
  const pct = (v.currentTime / v.duration) * 100;
  $("#fill").style.width = pct + "%";
  $("#knob").style.left = pct + "%";
  $("#time").textContent = `${fmtTime(v.currentTime)} / ${fmtTime(v.duration)}`;
}

export function updateBuffer() {
  const v = Player.getVideo();
  if (!isFinite(v.duration)) return;
  try {
    if (v.buffered.length) {
      const end = v.buffered.end(v.buffered.length - 1);
      $("#buf").style.width = (end / v.duration * 100) + "%";
      const stBuf = $("#stBuf");
      if (stBuf) stBuf.textContent = (end - v.currentTime).toFixed(1) + "s";
    }
  } catch {}
}

// ═══════════════════════════════════════
//  CONTROLS AUTO-HIDE
// ═══════════════════════════════════════
let uiTimer = null, uiHovering = false;
const controlsEl = () => $("#controls");
const stageEl = () => $("#stage");

function anyMenuOpen() {
  return ["speedPop","qualPop","morePop"].some(id => document.getElementById(id)?.classList.contains("open"));
}

function scheduleHide() {
  clearTimeout(uiTimer);
  const v = Player.getVideo();
  if (v.paused || !v.src) return;
  uiTimer = setTimeout(() => {
    if (uiHovering || anyMenuOpen()) { scheduleHide(); return; }
    controlsEl()?.classList.add("hideUI");
    stageEl()?.classList.add("cursor-none");
  }, 3000);
}

export function revealControls() {
  controlsEl()?.classList.remove("hideUI");
  stageEl()?.classList.remove("cursor-none");
  scheduleHide();
}

export function initControlsHide() {
  const stage = stageEl();
  ["mousemove","pointermove","touchstart"].forEach(ev =>
    stage.addEventListener(ev, revealControls, { passive: true })
  );
  stage.addEventListener("mouseleave", () => {
    const v = Player.getVideo();
    if (!v.paused && v.src) scheduleHide();
  });
  const c = controlsEl();
  c.addEventListener("pointerenter", () => { uiHovering = true; revealControls(); clearTimeout(uiTimer); });
  c.addEventListener("pointerleave", () => { uiHovering = false; scheduleHide(); });
}

// ═══════════════════════════════════════
//  SEEK BAR
// ═══════════════════════════════════════
export function bindSeekBar() {
  const bar = $("#bar"), tip = $("#barTip");
  let dragging = false;
  const v = () => Player.getVideo();

  const getPct = x => { const r = bar.getBoundingClientRect(); return clamp((x - r.left) / r.width, 0, 1); };
  const seekX = x => { if (isFinite(v().duration)) Player.safeSeek(getPct(x) * v().duration); };
  const updateTip = x => {
    if (!isFinite(v().duration)) return;
    const r = bar.getBoundingClientRect();
    const pct = clamp((x - r.left) / r.width, 0, 1);
    tip.textContent = fmtTime(pct * v().duration);
    const tipW = tip.offsetWidth || 40;
    tip.style.left = clamp(x - r.left, tipW / 2, r.width - tipW / 2) + "px";
  };

  bar.addEventListener("mousedown", e => { dragging = true; bar.classList.add("drag"); seekX(e.clientX); });
  bar.addEventListener("mousemove", e => { updateTip(e.clientX); if (dragging) seekX(e.clientX); });
  document.addEventListener("mousemove", e => { if (dragging) { seekX(e.clientX); updateTip(e.clientX); } });
  document.addEventListener("mouseup", () => { if (dragging) { dragging = false; bar.classList.remove("drag"); } });
  bar.addEventListener("touchstart", e => { dragging = true; bar.classList.add("drag"); seekX(e.touches[0].clientX); }, { passive: true });
  document.addEventListener("touchmove", e => { if (dragging && e.touches[0]) { seekX(e.touches[0].clientX); updateTip(e.touches[0].clientX); } }, { passive: true });
  document.addEventListener("touchend", () => { if (dragging) { dragging = false; bar.classList.remove("drag"); } });
}

// ═══════════════════════════════════════
//  MENUS
// ═══════════════════════════════════════
export function closeAllPops() {
  ["speedPop","qualPop","morePop"].forEach(id => document.getElementById(id)?.classList.remove("open"));
}

export function setupSpeedMenu() {
  const speeds = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
  const pop = $("#speedPop");
  const v = () => Player.getVideo();
  pop.innerHTML = "";
  speeds.forEach(sp => {
    const b = document.createElement("button");
    b.className = "opt" + (v().playbackRate === sp ? " on" : "");
    b.innerHTML = `<span>${sp.toFixed(2).replace(/0$/, "")}×</span><code>${sp === 1 ? "default" : ""}</code>`;
    b.addEventListener("click", () => {
      v().playbackRate = sp;
      $("#speedBtn").firstChild.nodeValue = sp.toFixed(1) + "× ";
      Settings.save({ rate: sp });
      $$("#speedPop .opt").forEach(x => x.classList.remove("on"));
      b.classList.add("on");
      pop.classList.remove("open");
      toast("Speed: " + sp + "×", "ok");
    });
    pop.appendChild(b);
  });
}

export function setupHLSQualMenu(hlsInstance) {
  if (!hlsInstance?.levels?.length) { $("#qualMenu").style.display = "none"; return; }
  $("#qualMenu").style.display = "";
  const pop = $("#qualPop");
  pop.innerHTML = "";

  const auto = document.createElement("button");
  auto.className = "opt on";
  auto.innerHTML = '<span>Auto</span><code>adaptive</code>';
  auto.addEventListener("click", () => {
    hlsInstance.currentLevel = -1;
    $("#qualBtn").firstChild.nodeValue = "Auto ";
    $$("#qualPop .opt").forEach(x => x.classList.remove("on"));
    auto.classList.add("on"); pop.classList.remove("open");
    toast("Quality: Auto", "ok");
  });
  pop.appendChild(auto);

  hlsInstance.levels.forEach((lv, idx) => {
    const label = lv.height ? `${lv.height}p` : `Level ${idx}`;
    const bit = lv.bitrate ? `${(lv.bitrate / 1e6).toFixed(1)} Mbps` : "";
    const b = document.createElement("button");
    b.className = "opt";
    b.innerHTML = `<span>${label}</span><code>${bit}</code>`;
    b.addEventListener("click", () => {
      hlsInstance.currentLevel = idx;
      $("#qualBtn").firstChild.nodeValue = label + " ";
      $$("#qualPop .opt").forEach(x => x.classList.remove("on"));
      b.classList.add("on"); pop.classList.remove("open");
      toast("Quality: " + label, "ok");
    });
    pop.appendChild(b);
  });
  $("#qualBtn").firstChild.nodeValue = "Auto ";
}

export function buildMoreMenu() {
  const pop = $("#morePop");
  pop.innerHTML = "";
  const add = (label, hint, fn) => {
    const b = document.createElement("button");
    b.className = "opt";
    b.innerHTML = `<span>${label}</span><code>${hint}</code>`;
    b.addEventListener("click", () => { pop.classList.remove("open"); fn(); revealControls(); });
    pop.appendChild(b);
  };
  add("Bookmark", "B", () => Player.addBookmark());
  add("A/B Loop", "A", () => Player.toggleAB());
  add("Screenshot", "P", () => Player.screenshot());
  add("Subtitles…", "S", () => $("#subIn").click());
  add("Picture in Picture", "PiP", () => Player.togglePiP());
  add("Add to Queue", "+Q", () => Player.addCurrentToQueue());
  add("Play Next", "→Q", () => Player.playNextFromQueue());
}

// ═══════════════════════════════════════
//  LEFT PANEL RENDERER
// ═══════════════════════════════════════
let leftMode = "history";
export function getLeftMode() { return leftMode; }
export function setLeftMode(m) { leftMode = m; renderLeft(); }

export function renderLeft() {
  const host = $("#leftList");
  if (!host) return;
  host.innerHTML = "";
  const cur = Player.getCur();

  if (leftMode === "history") {
    const list = History.all();
    if (!list.length) { host.innerHTML = `<div class="empty">No history yet.<br/>Paste URL or open file.</div>`; return; }

    list.forEach(it => {
      const on = cur && cur.id === it.id;
      const pct = it.dur > 0 ? clamp((it.pos / it.dur) * 100, 0, 100) : 0;
      const thumbHTML = it.thumb
        ? `<img src="${escHTML(it.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
        : `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 4l15 8-15 8V4z"/></svg>`;
      const row = document.createElement("div");
      row.className = "item" + (on ? " on" : "");
      row.innerHTML = `
        <div class="thumb ${it.thumb ? "hasImg" : ""}">${thumbHTML}<div class="prog" style="width:${pct}%"></div></div>
        <div class="meta">
          <div class="name">${escHTML(it.title || "Video")}</div>
          <div class="sub">
            <span class="tag">${escHTML(it.provider || "Direct")}</span>
            <span>${it.dur ? fmtTime(it.pos || 0) + " / " + fmtTime(it.dur) : "—"}</span>
            ${it.size ? `<span>${fmtBytes(it.size)}</span>` : ""}
            ${it.last ? `<span>${timeAgo(it.last)}</span>` : ""}
          </div>
        </div>
        <button class="rm" title="Remove"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg></button>`;

      row.addEventListener("click", e => {
        if (e.target.closest(".rm")) return;
        if (it.kind === "torrent") Player.loadTorrent(it.url || it.directURL || "");
        else if (it.kind === "local") { toast("Reopen local file", "warn"); $("#fileIn").click(); }
        else Player.loadMedia(it.url || it.directURL, true);
      });
      row.querySelector(".rm").addEventListener("click", e => { e.stopPropagation(); History.remove(it.id); toast("Removed", "ok"); });
      host.appendChild(row);
    });
  } else {
    const q = Queue.all();
    if (!q.length) { host.innerHTML = `<div class="empty">Queue is empty.</div>`; return; }
    q.forEach(it => {
      const row = document.createElement("div");
      row.className = "item";
      row.innerHTML = `
        <div class="thumb"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 4l15 8-15 8V4z"/></svg><div class="prog" style="width:0%"></div></div>
        <div class="meta"><div class="name">${escHTML(it.title || "Video")}</div><div class="sub"><span class="tag">${escHTML(it.provider || "Direct")}</span><span>queued</span></div></div>
        <button class="rm" title="Remove"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg></button>`;
      row.addEventListener("click", e => {
        if (e.target.closest(".rm")) return;
        if (it.kind === "torrent") Player.loadTorrent(it.url || it.directURL || "");
        else if (it.kind === "local") { toast("Reopen local file", "warn"); $("#fileIn").click(); }
        else Player.loadMedia(it.url || it.directURL, true);
      });
      row.querySelector(".rm").addEventListener("click", e => { e.stopPropagation(); Queue.remove(it.id); toast("Removed", "ok"); });
      host.appendChild(row);
    });
  }
}

// ═══════════════════════════════════════
//  QUEUE PANEL
// ═══════════════════════════════════════
export function renderQueue() {
  const host = $("#qList"), empty = $("#qEmpty");
  if (!host) return;
  host.innerHTML = "";
  const q = Queue.all();
  if (empty) empty.style.display = q.length ? "none" : "block";
  q.forEach(it => {
    const row = document.createElement("div");
    row.className = "qItem";
    row.innerHTML = `<div class="l"><strong>${escHTML(it.title || "Video")}</strong><span>${escHTML(it.provider || "Direct")}</span></div>
      <button class="miniBtn danger" title="Remove"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg></button>`;
    row.addEventListener("click", e => {
      if (e.target.closest(".danger")) { Queue.remove(it.id); toast("Removed", "ok"); return; }
      if (it.kind === "torrent") Player.loadTorrent(it.url || it.directURL || "");
      else Player.loadMedia(it.url || it.directURL, true);
    });
    host.appendChild(row);
  });
}

// ═══════════════════════════════════════
//  BOOKMARKS
// ═══════════════════════════════════════
export function renderBookmarks() {
  const host = $("#bmList"), empty = $("#bmEmpty");
  if (!host) return;
  host.innerHTML = "";
  const cur = Player.getCur();
  if (!cur) { if (empty) empty.style.display = "block"; return; }
  const list = Bookmarks.getMarks(cur.mediaKey);
  if (empty) empty.style.display = list.length ? "none" : "block";

  list.forEach((bm, idx) => {
    const row = document.createElement("div");
    row.className = "bmItem";
    row.innerHTML = `<div class="l"><strong>${escHTML(bm.label)}</strong><span>${fmtTime(bm.t)}</span></div>
      <button class="miniBtn danger" title="Remove"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg></button>`;
    row.addEventListener("click", e => {
      if (e.target.closest(".miniBtn")) return;
      Player.safeSeek(bm.t); toast("Jump: " + fmtTime(bm.t), "ok");
    });
    row.querySelector(".miniBtn").addEventListener("click", e => {
      e.stopPropagation(); Bookmarks.remove(cur.mediaKey, idx); toast("Bookmark removed", "ok");
    });
    host.appendChild(row);
  });
}

export function renderBMMarkers() {
  const host = $("#bmMarkers");
  if (!host) return;
  host.innerHTML = "";
  const cur = Player.getCur(), v = Player.getVideo();
  if (!cur || !isFinite(v.duration)) return;
  Bookmarks.getMarks(cur.mediaKey).forEach(bm => {
    const dot = document.createElement("div");
    dot.className = "bm-mark";
    dot.style.left = (bm.t / v.duration * 100) + "%";
    dot.title = `Bookmark: ${fmtTime(bm.t)}`;
    host.appendChild(dot);
  });
}

// ═══════════════════════════════════════
//  A/B REGION UI
// ═══════════════════════════════════════
export function updateABUI(abState) {
  const el = $("#abRegion"), v = Player.getVideo();
  if (!abState || abState.abA == null || abState.abB == null || !isFinite(v.duration)) {
    el?.classList.remove("on"); return;
  }
  const a = Math.min(abState.abA, abState.abB), b = Math.max(abState.abA, abState.abB);
  el.style.left = (a / v.duration * 100) + "%";
  el.style.width = ((b - a) / v.duration * 100) + "%";
  el.classList.add("on");
}

// ═══════════════════════════════════════
//  TABS
// ═══════════════════════════════════════
export function setTab(tab) {
  $$(".tab").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
  ["info","queue","marks","visual","audio","stats"].forEach(t => {
    const p = $(`#pane${t.charAt(0).toUpperCase() + t.slice(1)}`);
    if (p) p.style.display = t === tab ? "" : "none";
  });
}

// ═══════════════════════════════════════
//  MEDIA INFO UPDATE (from player callbacks)
// ═══════════════════════════════════════
export function updateMediaInfo(info) {
  $("#vTitle").textContent = info.title || "No video loaded";
  $("#vSub").textContent = info.provider || "—";
  $("#srcBadge").textContent = info.provider || "—";
  $("#iSrc").textContent = info.provider || "—";
  $("#ctrlTitle").textContent = info.title || "No video";

  if (info.pdMeta) {
    if (info.pdMeta.type) $("#iType").textContent = info.pdMeta.type;
    if (info.pdMeta.size != null) $("#iSize").textContent = fmtBytes(info.pdMeta.size);
  } else {
    $("#iType").textContent = info.fileType || "—";
    $("#iSize").textContent = info.fileSize ? fmtBytes(info.fileSize) : "—";
  }

  if (info.codecInfo) {
    const ci = info.codecInfo;
    const iCodec = $("#iCodec"), iCont = $("#iContainer");
    if (iCodec) iCodec.textContent = ci.codec || "—";
    if (iCont) iCont.textContent = ci.container || "—";
  }

  if (info.torrentName) {
    $("#vSub").textContent = `Torrent · ${info.torrentName}`;
    if (info.fileSize) $("#iSize").textContent = fmtBytes(info.fileSize);
  }

  $("#qualMenu").style.display = "none";
}

export function updateMetaDisplay(meta) {
  if (isFinite(meta.duration)) $("#iDur").textContent = fmtTime(meta.duration);
  if (meta.width && meta.height) $("#iRes").textContent = `${meta.width}×${meta.height}`;
  $("#stRate").textContent = (meta.rate || 1).toFixed(2) + "×";
}

export function updateTorrentStats(stats) {
  if (!stats) {
    $("#tPeers").textContent = "—";
    $("#tProg").textContent = "—";
    $("#tDown").textContent = "—";
    $("#tUp").textContent = "—";
    return;
  }
  $("#tPeers").textContent = String(stats.peers);
  $("#tProg").textContent = stats.progress;
  $("#tDown").textContent = stats.down;
  $("#tUp").textContent = stats.up;
}

// ═══════════════════════════════════════
//  TORRENT PICKER MODAL
// ═══════════════════════════════════════
export function openTorrentPicker(t, list) {
  $("#torModal").classList.add("open");
  const host = $("#torFiles");
  host.innerHTML = "";
  $("#torMeta").textContent = `${t.name || "Torrent"} · ${fmtBytes(t.length)} · ${t.infoHash.slice(0, 10)}…`;
  $("#torEmpty").style.display = list.length ? "none" : "block";

  list.forEach(f => {
    const row = document.createElement("div");
    row.className = "qItem";
    const playable = isVideoExt(f.name);
    row.innerHTML = `<div class="l"><strong>${escHTML(f.name)}</strong><span>${fmtBytes(f.length)} · ${playable ? "Playable" : "Maybe unsupported"}</span></div>
      <button class="miniBtn" title="Play"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 4l15 8-15 8V4z"/></svg></button>`;
    row.addEventListener("click", () => { Player.selectTorrentFile(t, f); $("#torModal").classList.remove("open"); });
    host.appendChild(row);
  });
}

// ═══════════════════════════════════════
//  STATS (periodic)
// ═══════════════════════════════════════
export function startStats() {
  setInterval(() => {
    const v = Player.getVideo();
    if (!v.src || v.paused) return;
    try {
      const q = v.getVideoPlaybackQuality?.();
      if (q) {
        const drop = $("#stDrop"), dec = $("#stDec");
        if (drop) drop.textContent = String(q.droppedVideoFrames || 0);
        if (dec) dec.textContent = String(q.totalVideoFrames || 0);
      }
    } catch {}
  }, 1200);
}

// ═══════════════════════════════════════
//  FULLSCREEN CHANGE HANDLER
// ═══════════════════════════════════════
export function initFullscreenHandler() {
  document.addEventListener("fullscreenchange", () => {
    const on = !!document.fullscreenElement;
    stageEl()?.classList.toggle("fs", on);
    $("#fsIcon").innerHTML = on
      ? '<path d="M9 9H3V3"/><path d="M15 9h6V3"/><path d="M9 15H3v6"/><path d="M15 15h6v6"/>'
      : '<path d="M8 3H3v5"/><path d="M16 3h5v5"/><path d="M8 21H3v-5"/><path d="M16 21h5v-5"/>';
    if (on) { const c = Player.getCur(); if (c) $("#ctrlTitle").textContent = c.title || "Video"; }
  });
}

// ═══════════════════════════════════════
//  BIND ALL UI INTERACTIONS
// ═══════════════════════════════════════
export function bindUI() {
  const v = () => Player.getVideo();

  // Tabs
  $$(".tab").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));

  // Segments
  $("#segHistory").addEventListener("click", () => {
    leftMode = "history";
    $("#segHistory").classList.add("on"); $("#segQueue").classList.remove("on");
    renderLeft();
  });
  $("#segQueue").addEventListener("click", () => {
    leftMode = "queue";
    $("#segQueue").classList.add("on"); $("#segHistory").classList.remove("on");
    renderLeft();
  });

  // Load URL
  const doLoad = () => { const u = $("#urlIn").value.trim(); if (u) Player.loadMedia(u, false); };
  $("#loadBtn").addEventListener("click", doLoad);
  $("#urlIn").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); doLoad(); } });

  // File openers
  $("#openFileBtn").addEventListener("click", () => $("#fileIn").click());
  $("#openTorBtn").addEventListener("click", () => $("#torIn").click());
  $("#openSubBtn").addEventListener("click", () => $("#subIn").click());

  // File inputs
  $("#fileIn").addEventListener("change", e => { const f = e.target.files?.[0]; if (f) Player.loadLocalFile(f); e.target.value = ""; });
  $("#subIn").addEventListener("change", e => { const f = e.target.files?.[0]; if (f) Player.loadSubFile(f); e.target.value = ""; });
  $("#torIn").addEventListener("change", e => {
    const f = e.target.files?.[0];
    if (f) { const r = new FileReader(); r.onload = () => Player.loadTorrent(r.result); r.readAsArrayBuffer(f); }
    e.target.value = "";
  });

  // History / Queue
  $("#clearBtn").addEventListener("click", () => { if (confirm("Clear all history?")) { History.clear(); toast("History cleared", "ok"); } });
  $("#addQueueBtn").addEventListener("click", () => Player.addCurrentToQueue());
  $("#qClear").addEventListener("click", () => Queue.clear());
  $("#qPlayNext").addEventListener("click", () => Player.playNextFromQueue());

  // Error overlay
  $("#retryBtn").addEventListener("click", () => {
    const c = Player.getCur();
    if (!c) return showIdle();
    if (c.kind === "torrent") Player.loadTorrent(c.url || c.directURL || "");
    else if (c.kind === "local") { toast("Open file again", "warn"); $("#fileIn").click(); }
    else Player.loadMedia(c.url || c.directURL, true);
  });
  $("#dlDirectBtn").addEventListener("click", () => Player.downloadDirect());
  $("#resetBtn").addEventListener("click", () => Player.resetPlayer());

  // Download panel
  $("#dlBtn").addEventListener("click", () => Player.downloadDirect());

  // Controls
  $("#playBtn").addEventListener("click", () => Player.togglePlay());
  $("#bkBtn").addEventListener("click", () => Player.skip(-10));
  $("#fwBtn").addEventListener("click", () => Player.skip(10));

  // Volume
  $("#muteBtn").addEventListener("click", () => {
    v().muted = !v().muted;
    showActionIndicator(v().muted ? "mute" : "unmute");
    updateVolIcon();
    Settings.save({ volume: v().volume, muted: v().muted });
  });
  $("#volRange").addEventListener("input", e => {
    v().volume = Number(e.target.value); v().muted = false;
    updateVolIcon();
    Settings.save({ volume: v().volume, muted: false });
  });

  // Menus
  document.addEventListener("click", e => { if (!e.target.closest(".menu")) closeAllPops(); });

  const toggleMenu = (btnId, popId) => {
    $(btnId).addEventListener("click", e => {
      e.stopPropagation(); revealControls();
      const p = $(popId); const was = p.classList.contains("open");
      closeAllPops();
      if (!was) { if (popId === "#morePop") buildMoreMenu(); p.classList.add("open"); }
    });
  };
  toggleMenu("#speedBtn", "#speedPop");
  toggleMenu("#qualBtn", "#qualPop");
  toggleMenu("#moreBtn", "#morePop");

  // Fullscreen
  $("#fsBtn").addEventListener("click", () => Player.toggleFullscreen());

  // Torrent modal
  $("#torClose").addEventListener("click", () => $("#torModal").classList.remove("open"));
  $("#torModal").addEventListener("click", e => { if (e.target.id === "torModal") $("#torModal").classList.remove("open"); });

  // Format warning close
  $("#closeFormat")?.addEventListener("click", hideFormatWarning);

  // Help
  $("#helpBtn").addEventListener("click", () =>
    toast("Space Play · J/L ±10s · F Fullscreen · M Mute · B Bookmark · A A/B · P Screenshot · S Sub · Ctrl+K Cmd", "ok")
  );

  // Drag & drop
  const stage = stageEl();
  ["dragenter","dragover"].forEach(ev => stage.addEventListener(ev, e => { e.preventDefault(); $("#drop").classList.add("on"); }));
  ["dragleave","drop"].forEach(ev => stage.addEventListener(ev, e => { e.preventDefault(); $("#drop").classList.remove("on"); }));
  stage.addEventListener("drop", e => {
    const f = e.dataTransfer?.files?.[0]; if (!f) return;
    if (f.name.toLowerCase().endsWith(".torrent")) {
      const r = new FileReader(); r.onload = () => Player.loadTorrent(r.result); r.readAsArrayBuffer(f);
    } else Player.loadLocalFile(f);
  });

  // Store change listeners
  History.onChange(() => { renderLeft(); renderQueue(); });
  Queue.onChange(() => { renderLeft(); renderQueue(); });
  Bookmarks.onChange(() => { renderBookmarks(); renderBMMarkers(); });
}