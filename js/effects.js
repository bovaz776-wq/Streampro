/**
 * effects.js — Visual Filters & Audio EQ
 * Pure state management + UI updates for effects panels.
 * Audio graph operations delegated to player.js functions.
 */

import { $, clamp } from "./config.js";
import { Settings } from "./store.js";
import * as Player from "./player.js";

// ═══════════════════════════════════════
//  VISUAL FILTERS
// ═══════════════════════════════════════

let vfEnabled = true;
let VF = { bright: 100, contrast: 100, sat: 100, hue: 0, blur: 0 };

export function initVisual() {
  const s = Settings.get();
  vfEnabled = s.vfEnabled !== undefined ? !!s.vfEnabled : true;
  VF = { ...VF, ...(s.vf || {}) };
  applyVisual();
  updateVisualUI();
}

export function applyVisual() {
  const v = Player.getVideo();
  if (!v) return;
  if (!vfEnabled) { v.style.filter = "none"; return; }
  v.style.filter = [
    `brightness(${VF.bright}%)`, `contrast(${VF.contrast}%)`,
    `saturate(${VF.sat}%)`, `hue-rotate(${VF.hue}deg)`, `blur(${VF.blur}px)`,
  ].join(" ");
}

export function updateVisualUI() {
  const sw = $("#vfToggle");
  if (!sw) return;
  sw.classList.toggle("on", vfEnabled);
  sw.setAttribute("aria-checked", vfEnabled);

  const map = [
    ["#vfBright", "#vfBrightV", VF.bright, "%"],
    ["#vfContrast", "#vfContrastV", VF.contrast, "%"],
    ["#vfSat", "#vfSatV", VF.sat, "%"],
    ["#vfHue", "#vfHueV", VF.hue, "°"],
    ["#vfBlur", "#vfBlurV", VF.blur, "px"],
  ];
  map.forEach(([inp, lab, val, unit]) => {
    const i = $(inp), l = $(lab);
    if (i) i.value = String(val);
    if (l) l.textContent = `${val}${unit}`;
  });
}

export function toggleVisual() {
  vfEnabled = !vfEnabled;
  applyVisual();
  updateVisualUI();
  Settings.save({ vfEnabled, vf: VF });
}

export function setVFParam(key, value) {
  VF[key] = Number(value);
  applyVisual();
  updateVisualUI();
  Settings.saveVF(VF);
}

export function resetVisual() {
  VF = { bright: 100, contrast: 100, sat: 100, hue: 0, blur: 0 };
  applyVisual();
  updateVisualUI();
  Settings.save({ vf: VF });
}

export function getVFEnabled() { return vfEnabled; }

// ═══════════════════════════════════════
//  AUDIO EQUALIZER
// ═══════════════════════════════════════

let eqEnabled = false;
let EQ = { pre: 0, b0: 0, b1: 0, b2: 0, b3: 0, b4: 0 };
let _toastFn = null;

export function initEQ(toastFn) {
  _toastFn = toastFn;
  const s = Settings.get();
  EQ = { ...EQ, ...(s.eq || {}) };
  eqEnabled = false; // Never auto-enable
  updateEqUI();
}

function _toast(msg, type) { if (_toastFn) _toastFn(msg, type); }

export function getEQEnabled() { return eqEnabled; }
export function getEQ() { return { ...EQ }; }

export function updateEqUI() {
  const sw = $("#eqToggle");
  if (!sw) return;
  sw.classList.toggle("on", eqEnabled);
  sw.setAttribute("aria-checked", eqEnabled);

  const pre = $("#eqPre"), preV = $("#eqPreV");
  if (pre) pre.value = String(EQ.pre);
  if (preV) preV.textContent = `${Number(EQ.pre).toFixed(1)} dB`;

  [["#eqB0","#eqB0V",EQ.b0], ["#eqB1","#eqB1V",EQ.b1],
   ["#eqB2","#eqB2V",EQ.b2], ["#eqB3","#eqB3V",EQ.b3],
   ["#eqB4","#eqB4V",EQ.b4]].forEach(([inp, lab, val]) => {
    const i = $(inp), l = $(lab);
    if (i) i.value = String(val);
    if (l) l.textContent = Number(val).toFixed(1);
  });

  const note = $("#eqSourceNote");
  if (!note) return;
  const cur = Player.getCur();
  if (cur && Player.canUseEQ()) {
    note.style.borderColor = "rgba(48,209,88,.2)";
    note.textContent = "Source compatible with EQ (local/same-origin).";
  } else if (cur) {
    note.style.borderColor = "rgba(255,159,10,.2)";
    note.textContent = "Remote source. EQ may be blocked by CORS.";
  } else {
    note.style.borderColor = "";
    note.textContent = "EQ works best with local files. Remote URLs require CORS support.";
  }
}

export function setEQParam(key, value) {
  EQ[key] = Number(value);
  updateEqUI();
  Settings.saveEQ(EQ);
  if (Player.isEqConnected()) Player.applyEQParams(EQ);
}

export function resetEQ() {
  EQ = { pre: 0, b0: 0, b1: 0, b2: 0, b3: 0, b4: 0 };
  updateEqUI();
  Settings.saveEQ(EQ);
  if (Player.isEqConnected()) Player.applyEQParams(EQ);
  _toast("EQ reset", "ok");
}

/**
 * Toggle EQ on/off.
 * ⚠️ Disabling EQ requires replacing the video element
 *     to restore native audio pipeline.
 */
export async function toggleEQ() {
  if (eqEnabled) {
    // ─── DISABLE EQ ───
    eqEnabled = false;
    updateEqUI();
    Settings.save({ eqEnabled: false });

    if (Player.getMediaSrc() && Player.getCur()?.kind !== "torrent") {
      const state = Player.capturePlayState();
      _toast("EQ off — restoring native audio…", "ok");
      await Player.replaceVideoFresh();
      applyVisual(); // reapply filter to new element
      await Player.restoreAfterReplace(state);
      return;
    }

    if (Player.getMediaSrc()) Player.connectDirect();
    _toast("EQ off", "ok");
    return;
  }

  // ─── ENABLE EQ ───
  if (!Player.canUseEQ()) {
    _toast("EQ only works with local/same-origin source (CORS)", "warn");
    return;
  }

  eqEnabled = true;
  updateEqUI();
  Settings.save({ eqEnabled: true });

  const ok = Player.buildAudioGraph();
  if (!ok) {
    eqEnabled = false;
    updateEqUI();
    Settings.save({ eqEnabled: false });
    _toast("Cannot initialize audio processing", "warn");
    return;
  }

  try { await Player.resumeAudioCtx(); } catch {}
  Player.applyEQParams(EQ);
  Player.connectEQ();

  // Start silence detection — auto-disable if audio dies
  Player.startSilenceCheck(async () => {
    eqEnabled = false;
    updateEqUI();
    Settings.save({ eqEnabled: false });
    _toast("EQ disabled — restoring audio…", "warn");
    const state = Player.capturePlayState();
    await Player.replaceVideoFresh();
    applyVisual();
    await Player.restoreAfterReplace(state);
  });

  _toast("EQ enabled", "ok");
}

// ═══════════════════════════════════════
//  BIND EFFECTS UI
// ═══════════════════════════════════════

export function bindEffectsUI() {
  // Visual
  $("#vfToggle")?.addEventListener("click", toggleVisual);
  $("#vfReset")?.addEventListener("click", () => { resetVisual(); _toast("Visual reset", "ok"); });

  const vfBind = (id, key) => {
    $(id)?.addEventListener("input", e => setVFParam(key, e.target.value));
  };
  vfBind("#vfBright", "bright");
  vfBind("#vfContrast", "contrast");
  vfBind("#vfSat", "sat");
  vfBind("#vfHue", "hue");
  vfBind("#vfBlur", "blur");

  // EQ
  $("#eqToggle")?.addEventListener("click", toggleEQ);
  $("#eqReset")?.addEventListener("click", resetEQ);

  const eqBind = (id, key) => {
    $(id)?.addEventListener("input", e => setEQParam(key, e.target.value));
  };
  eqBind("#eqPre", "pre");
  eqBind("#eqB0", "b0");
  eqBind("#eqB1", "b1");
  eqBind("#eqB2", "b2");
  eqBind("#eqB3", "b3");
  eqBind("#eqB4", "b4");
}