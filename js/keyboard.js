/**
 * keyboard.js — Keyboard shortcuts & Command Palette
 */

import { $, $$, clamp, escHTML, isInputFocused } from "./config.js";
import { Settings } from "./store.js";
import * as Player from "./player.js";
import { toggleEQ, resetEQ, resetVisual } from "./effects.js";
import { toast, showActionIndicator, revealControls, updateVolIcon } from "./ui.js";

// ═══════════════════════════════════════
//  COMMAND PALETTE
// ═══════════════════════════════════════

const commands = [];
let cmdIdx = 0;

function buildCmds() {
  commands.length = 0;
  const add = (title, hint, run) => commands.push({ title, hint, run });

  add("Play / Pause", "Space", () => Player.togglePlay());
  add("Fullscreen", "F", () => Player.toggleFullscreen());

  add("Mute / Unmute", "M", () => {
    const v = Player.getVideo();
    v.muted = !v.muted;
    showActionIndicator(v.muted ? "mute" : "unmute");
    updateVolIcon();
    Settings.save({ muted: v.muted });
    toast(v.muted ? "Muted" : "Unmuted", "ok");
  });

  add("Open Video File", "file", () => $("#fileIn").click());
  add("Open Torrent File", "torrent", () => $("#torIn").click());
  add("Load Subtitles", "S", () => $("#subIn").click());

  add("Bookmark", "B", () => Player.addBookmark());
  add("A/B Loop", "A", () => Player.toggleAB());
  add("Screenshot", "P", () => Player.screenshot());
  add("Picture in Picture", "pip", () => Player.togglePiP());

  add("Add to Queue", "+queue", () => Player.addCurrentToQueue());
  add("Play Next from Queue", "next", () => Player.playNextFromQueue());
  add("Clear Queue", "clear", () => {
    const { Queue } = require("./store.js");
    Queue.clear();
    toast("Queue cleared", "ok");
  });

  add("EQ Toggle", "eq", () => toggleEQ());
  add("EQ Reset", "eq reset", () => resetEQ());
  add("Visual Reset", "visual", () => { resetVisual(); toast("Visual reset", "ok"); });

  [0.5, 0.75, 1.0, 1.25, 1.5, 2.0].forEach(sp => {
    add(`Speed ${sp}×`, "speed", () => {
      const v = Player.getVideo();
      v.playbackRate = sp;
      $("#speedBtn").firstChild.nodeValue = sp.toFixed(1) + "× ";
      Settings.save({ rate: sp });
      toast("Speed: " + sp + "×", "ok");
    });
  });

  add("Volume Up", "Up", () => {
    const v = Player.getVideo();
    v.volume = clamp(v.volume + 0.1, 0, 1);
    v.muted = false;
    Settings.save({ volume: v.volume, muted: false });
    toast("Volume: " + Math.round(v.volume * 100) + "%", "ok");
  });

  add("Volume Down", "Down", () => {
    const v = Player.getVideo();
    v.volume = clamp(v.volume - 0.1, 0, 1);
    Settings.save({ volume: v.volume });
    toast("Volume: " + Math.round(v.volume * 100) + "%", "ok");
  });

  add("Skip +30s", "+30", () => Player.skip(30));
  add("Skip -30s", "-30", () => Player.skip(-30));

  add("Download", "dl", () => Player.downloadDirect());
  add("Reset Player", "reset", () => Player.resetPlayer());
}

function getCmdFiltered(q) {
  q = (q || "").trim().toLowerCase();
  if (!q) return commands;
  return commands.filter(c => (c.title + " " + (c.hint || "")).toLowerCase().includes(q));
}

function renderCmdList(list) {
  const host = $("#cmdList");
  if (!host) return;
  host.innerHTML = "";
  cmdIdx = 0;

  if (!list.length) {
    host.innerHTML = `<div style="padding:16px;text-align:center;color:rgba(255,255,255,.35);font-size:12px;">No matching commands</div>`;
    return;
  }

  list.forEach((c, i) => {
    const row = document.createElement("div");
    row.className = "cmdItem" + (i === 0 ? " on" : "");
    row.innerHTML = `<span>${escHTML(c.title)}</span><small>${escHTML(c.hint || "")}</small>`;
    row.addEventListener("click", () => { closeCmd(); c.run(); });
    host.appendChild(row);
  });
}

export function openCmd() {
  buildCmds();
  $("#cmd").classList.add("open");
  const inp = $("#cmdIn");
  inp.value = "";
  renderCmdList(commands);
  setTimeout(() => inp.focus(), 50);
}

export function closeCmd() {
  $("#cmd").classList.remove("open");
}

function moveCmdSel(dir) {
  const items = $$("#cmdList .cmdItem");
  if (!items.length) return;
  items[cmdIdx]?.classList.remove("on");
  cmdIdx = (cmdIdx + dir + items.length) % items.length;
  items[cmdIdx]?.classList.add("on");
  items[cmdIdx]?.scrollIntoView({ block: "nearest" });
}

function runCmdSel() {
  const items = $$("#cmdList .cmdItem");
  if (items.length && items[cmdIdx]) items[cmdIdx].click();
}

// ═══════════════════════════════════════
//  KEYBOARD HANDLER
// ═══════════════════════════════════════

function onKeyDown(e) {
  // ── Command palette open ──
  if ($("#cmd").classList.contains("open")) {
    if (e.key === "Escape") { e.preventDefault(); closeCmd(); }
    // Arrow / Enter handled by cmdIn keydown below
    return;
  }

  // ── Input focused → ignore most keys ──
  if (isInputFocused(e.target)) return;

  const k = (e.key || "").toLowerCase();

  // Ctrl/Cmd + K → open command palette
  if ((e.ctrlKey || e.metaKey) && k === "k") {
    e.preventDefault();
    openCmd();
    return;
  }

  // Escape → close modals
  if (e.key === "Escape") {
    if ($("#torModal").classList.contains("open")) {
      e.preventDefault();
      $("#torModal").classList.remove("open");
    }
    return;
  }

  const v = Player.getVideo();

  // Space → play/pause
  if (e.code === "Space") {
    e.preventDefault();
    Player.togglePlay();
    return;
  }

  // J / ArrowLeft → back 10s
  if (k === "j" || e.key === "ArrowLeft") { e.preventDefault(); Player.skip(-10); return; }

  // L / ArrowRight → forward 10s
  if (k === "l" || e.key === "ArrowRight") { e.preventDefault(); Player.skip(10); return; }

  // F → fullscreen
  if (k === "f") { e.preventDefault(); Player.toggleFullscreen(); return; }

  // M → mute
  if (k === "m") {
    e.preventDefault();
    v.muted = !v.muted;
    showActionIndicator(v.muted ? "mute" : "unmute");
    updateVolIcon();
    Settings.save({ muted: v.muted });
    toast(v.muted ? "Muted" : "Unmuted", "ok");
    return;
  }

  // B → bookmark
  if (k === "b") { e.preventDefault(); Player.addBookmark(); return; }

  // A → A/B loop
  if (k === "a") { e.preventDefault(); Player.toggleAB(); return; }

  // P → screenshot
  if (k === "p") { e.preventDefault(); Player.screenshot(); return; }

  // S → subtitle
  if (k === "s") { e.preventDefault(); $("#subIn").click(); return; }

  // ArrowUp → volume up
  if (e.key === "ArrowUp") {
    e.preventDefault();
    v.volume = clamp(v.volume + 0.05, 0, 1);
    v.muted = false;
    Settings.save({ volume: v.volume, muted: false });
    toast("Volume: " + Math.round(v.volume * 100) + "%", "ok");
    return;
  }

  // ArrowDown → volume down
  if (e.key === "ArrowDown") {
    e.preventDefault();
    v.volume = clamp(v.volume - 0.05, 0, 1);
    Settings.save({ volume: v.volume });
    toast("Volume: " + Math.round(v.volume * 100) + "%", "ok");
    return;
  }

  // , / . → frame step
  if (k === "," && isFinite(v.duration)) {
    e.preventDefault();
    v.currentTime = clamp(v.currentTime - (1 / 30), 0, v.duration);
    return;
  }
  if (k === "." && isFinite(v.duration)) {
    e.preventDefault();
    v.currentTime = clamp(v.currentTime + (1 / 30), 0, v.duration);
    return;
  }

  // [ / ] → speed
  if (k === "[") {
    e.preventDefault();
    v.playbackRate = clamp(v.playbackRate - 0.25, 0.25, 4);
    Settings.save({ rate: v.playbackRate });
    toast("Speed: " + v.playbackRate.toFixed(2) + "×", "ok");
    return;
  }
  if (k === "]") {
    e.preventDefault();
    v.playbackRate = clamp(v.playbackRate + 0.25, 0.25, 4);
    Settings.save({ rate: v.playbackRate });
    toast("Speed: " + v.playbackRate.toFixed(2) + "×", "ok");
    return;
  }

  // 0-9 → seek to percentage
  if (/^[0-9]$/.test(k) && isFinite(v.duration)) {
    e.preventDefault();
    const pct = parseInt(k, 10) / 10;
    Player.safeSeek(v.duration * pct);
    toast("Seek: " + Math.round(pct * 100) + "%", "ok");
  }
}

// ═══════════════════════════════════════
//  INIT
// ═══════════════════════════════════════

export function initKeyboard() {
  document.addEventListener("keydown", onKeyDown, { capture: true });

  // Command palette UI
  $("#cmdBtn")?.addEventListener("click", openCmd);
  $("#cmdClose")?.addEventListener("click", closeCmd);
  $("#cmd")?.addEventListener("click", e => { if (e.target.id === "cmd") closeCmd(); });

  $("#cmdIn")?.addEventListener("input", () => {
    renderCmdList(getCmdFiltered($("#cmdIn").value));
  });

  $("#cmdIn")?.addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { e.preventDefault(); moveCmdSel(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveCmdSel(-1); }
    else if (e.key === "Enter") { e.preventDefault(); runCmdSel(); }
    else if (e.key === "Escape") { e.preventDefault(); closeCmd(); }
  });
}