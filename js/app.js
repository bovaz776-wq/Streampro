/**
 * app.js — Entry point
 * Wires everything together: Player ↔ UI ↔ Keyboard ↔ Effects
 *
 * GitHub Pages compatible — semua file di-load sebagai ES Modules.
 */

import { $, fmtBytes } from "./config.js";
import { Settings } from "./store.js";
import * as Player from "./player.js";
import * as UI from "./ui.js";
import { initKeyboard } from "./keyboard.js";
import {
  initVisual, initEQ, applyVisual, updateVisualUI,
  updateEqUI, bindEffectsUI
} from "./effects.js";

// ═══════════════════════════════════════
//  PLAYER → UI CALLBACKS
//  Player.js emits events, we route them to UI functions.
// ═══════════════════════════════════════

Player.setPlayerCallbacks({
  // ── Overlays ──
  showIdle: () => UI.showIdle(),
  showLoading: (title, sub) => UI.showLoading(title, sub),
  showError: (title, msg) => UI.showError(title, msg),
  showVideo: () => UI.showVideo(),

  // ── Toast ──
  toast: (msg, type) => UI.toast(msg, type),

  // ── Format / codec warning ──
  formatWarning: (msg) => UI.showFormatWarning(msg),
  codecInfo: (info) => {
    // Tampilkan info codec di panel
    const iCodec = $("#iCodec"), iCont = $("#iContainer");
    if (iCodec) iCodec.textContent = info.codec || "—";
    if (iCont) iCont.textContent = info.container || "—";
  },

  // ── Media info ──
  mediaInfo: (info) => UI.updateMediaInfo(info),

  // ── Seek status ──
  seekStatusChanged: (isOK) => UI.setSeekBadge(isOK),

  // ── Play/pause state ──
  playStateChanged: (paused) => {
    UI.updatePlayIcon();
    if (paused) {
      UI.revealControls();
    } else {
      UI.revealControls();
    }
  },

  // ── Progress & buffer ──
  progressUpdate: () => UI.updateProgress(),
  bufferUpdate: () => UI.updateBuffer(),

  // ── Meta ready (loadedmetadata) ──
  metaReady: () => {
    UI.updateProgress();
    UI.renderBookmarks();
    UI.renderBMMarkers();
    applyVisual();
    updateEqUI();
    const cur = Player.getCur();
    if (cur) $("#ctrlTitle").textContent = cur.title || "Video";
  },
  metaUpdated: (meta) => UI.updateMetaDisplay(meta),

  // ── Volume / rate ──
  volumeChanged: (vol, muted) => {
    UI.updateVolIcon();
    $("#volRange").value = String(vol);
  },
  rateChanged: (rate) => {
    $("#speedBtn").firstChild.nodeValue = rate.toFixed(1) + "× ";
    const stRate = $("#stRate");
    if (stRate) stRate.textContent = rate.toFixed(2) + "×";
  },

  // ── Controls ──
  revealControls: () => UI.revealControls(),

  // ── Seek HUD ──
  seekHUD: (on) => UI.showSeekHUD(on),

  // ── Skip / action indicators ──
  skipIndicator: (dir, sec) => UI.showSkipIndicator(dir, sec),
  actionIndicator: (type) => UI.showActionIndicator(type),

  // ── A/B loop ──
  abChanged: (state) => UI.updateABUI(state),

  // ── Torrent ──
  torrentStats: (stats) => UI.updateTorrentStats(stats),
  torrentPicker: (t, list) => UI.openTorrentPicker(t, list),

  // ── HLS ready ──
  hlsReady: (hlsInstance) => UI.setupHLSQualMenu(hlsInstance),

  // ── Video element replaced (EQ disable) ──
  videoReplaced: (newVid) => {
    // Setelah video element diganti, perlu re-apply visual
    applyVisual();
    updateVisualUI();
    updateEqUI();
  },
});

// ═══════════════════════════════════════
//  INIT
// ═══════════════════════════════════════

function init() {
  const vid = $("#vid");

  // 1. Initialize player engine
  Player.init(vid);

  // 2. Initialize effects
  initVisual();
  initEQ(UI.toast);

  // 3. Setup UI
  UI.setupSpeedMenu();
  UI.buildMoreMenu();
  UI.setTab("info");
  UI.showIdle();
  UI.setSeekBadge(false);
  UI.updatePlayIcon();
  UI.updateVolIcon();

  // Set initial volume range from settings
  $("#volRange").value = String(vid.volume);
  $("#speedBtn").firstChild.nodeValue = vid.playbackRate.toFixed(1) + "× ";

  // 4. Bind all UI events
  UI.bindUI();
  UI.bindSeekBar();
  UI.initControlsHide();
  UI.initFullscreenHandler();

  // 5. Bind effects UI
  bindEffectsUI();

  // 6. Bind keyboard & command palette
  initKeyboard();

  // 7. Render initial state
  UI.renderLeft();
  UI.renderQueue();
  UI.renderBookmarks();
  UI.renderBMMarkers();

  // 8. Start stats loop
  UI.startStats();

  // 9. Save on page hide
  window.addEventListener("pagehide", () => {
    Player.forceSave();
    Settings.save({ volume: vid.volume, muted: vid.muted, rate: vid.playbackRate });
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      Player.forceSave();
      Settings.save({ volume: vid.volume, muted: vid.muted, rate: vid.playbackRate });
    }
  });

  console.log("%c Stream Pro v2.0 — MVC ", "background:#0a84ff;color:#fff;font-weight:900;padding:4px 12px;border-radius:6px;");
}

// ═══════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}