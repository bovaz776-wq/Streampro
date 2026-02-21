/**
 * store.js — Model layer
 * History, Queue, Bookmarks, Settings, PixelDrain cache
 */

import {
  Store, K_SETTINGS, K_HISTORY, K_QUEUE, K_MARKS, K_PD,
  MAX_HISTORY, clamp
} from "./config.js";

// ═══════════════════════════════════════
//  SETTINGS
// ═══════════════════════════════════════

const DEFAULT_SETTINGS = {
  volume: 0.85,
  muted: false,
  rate: 1.0,
  vfEnabled: true,
  vf: { bright: 100, contrast: 100, sat: 100, hue: 0, blur: 0 },
  eqEnabled: false,
  eq: { pre: 0, b0: 0, b1: 0, b2: 0, b3: 0, b4: 0 },
};

export const Settings = {
  _cache: null,

  load() {
    const raw = Store.get(K_SETTINGS, {});
    this._cache = { ...DEFAULT_SETTINGS, ...raw };
    // Clamp values
    this._cache.volume = clamp(this._cache.volume, 0, 1);
    this._cache.rate = clamp(this._cache.rate, 0.25, 4);
    this._cache.vf = { ...DEFAULT_SETTINGS.vf, ...(raw.vf || {}) };
    this._cache.eq = { ...DEFAULT_SETTINGS.eq, ...(raw.eq || {}) };
    // Jangan auto-on EQ
    this._cache.eqEnabled = false;
    return this._cache;
  },

  get() {
    if (!this._cache) this.load();
    return this._cache;
  },

  save(partial) {
    if (partial) Object.assign(this._cache, partial);
    Store.set(K_SETTINGS, this._cache);
  },

  saveVF(vf) {
    this._cache.vf = { ...vf };
    this.save();
  },

  saveEQ(eq) {
    this._cache.eq = { ...eq };
    this.save();
  },

  reset() {
    this._cache = { ...DEFAULT_SETTINGS };
    this.save();
  }
};

// ═══════════════════════════════════════
//  HISTORY
// ═══════════════════════════════════════

// Callbacks agar UI bisa listen
let _historyListeners = [];

export const History = {
  onChange(fn) { _historyListeners.push(fn); },
  _emit() { _historyListeners.forEach(fn => { try { fn(); } catch {} }); },

  all() {
    return Store.get(K_HISTORY, []);
  },

  _set(list) {
    Store.set(K_HISTORY, list);
    this._emit();
  },

  upsert(item) {
    let list = this.all();
    const i = list.findIndex(x => x.id === item.id);
    if (i !== -1) list.splice(i, 1);
    list.unshift({ ...item, last: Date.now() });
    if (list.length > MAX_HISTORY) list.length = MAX_HISTORY;
    this._set(list);
  },

  updateProgress(id, pos, dur) {
    const list = this.all();
    const it = list.find(x => x.id === id);
    if (!it) return;
    it.pos = pos;
    it.dur = dur;
    it.done = dur > 0 && pos / dur > 0.95;
    it.last = Date.now();
    Store.set(K_HISTORY, list);
    // Tidak emit full render untuk progress — terlalu sering
  },

  remove(id) {
    this._set(this.all().filter(x => x.id !== id));
  },

  clear() {
    this._set([]);
  },

  getPos(id) {
    const it = this.all().find(x => x.id === id);
    return it ? (it.pos || 0) : 0;
  }
};

// ═══════════════════════════════════════
//  QUEUE
// ═══════════════════════════════════════

let _queueListeners = [];

export const Queue = {
  onChange(fn) { _queueListeners.push(fn); },
  _emit() { _queueListeners.forEach(fn => { try { fn(); } catch {} }); },

  all() {
    return Store.get(K_QUEUE, []);
  },

  _set(list) {
    Store.set(K_QUEUE, list);
    this._emit();
  },

  add(item) {
    const q = this.all();
    if (q.find(x => x.id === item.id)) return false; // duplicate
    q.push(item);
    this._set(q);
    return true;
  },

  remove(id) {
    this._set(this.all().filter(x => x.id !== id));
  },

  clear() {
    this._set([]);
  },

  shift() {
    const q = this.all();
    const first = q.shift();
    this._set(q);
    return first || null;
  }
};

// ═══════════════════════════════════════
//  BOOKMARKS
// ═══════════════════════════════════════

let _bmListeners = [];

export const Bookmarks = {
  onChange(fn) { _bmListeners.push(fn); },
  _emit() { _bmListeners.forEach(fn => { try { fn(); } catch {} }); },

  _getAll() {
    return Store.get(K_MARKS, {});
  },

  _setAll(map) {
    Store.set(K_MARKS, map);
    this._emit();
  },

  getMarks(mediaKey) {
    return this._getAll()[mediaKey] || [];
  },

  add(mediaKey, time, label) {
    const map = this._getAll();
    const list = map[mediaKey] || [];

    // Jangan duplikat kalau terlalu dekat
    if (list.find(x => Math.abs(x.t - time) < 0.6)) return false;

    list.push({ t: time, label, at: Date.now() });
    list.sort((a, b) => a.t - b.t);
    map[mediaKey] = list;
    this._setAll(map);
    return true;
  },

  remove(mediaKey, index) {
    const map = this._getAll();
    const list = map[mediaKey] || [];
    list.splice(index, 1);
    map[mediaKey] = list;
    this._setAll(map);
  },

  clear(mediaKey) {
    const map = this._getAll();
    delete map[mediaKey];
    this._setAll(map);
  }
};

// ═══════════════════════════════════════
//  PIXELDRAIN METADATA CACHE
// ═══════════════════════════════════════

export const PixelDrainCache = {
  _cache: null,

  _load() {
    if (!this._cache) this._cache = Store.get(K_PD, {});
    return this._cache;
  },

  getId(url) {
    let m = String(url).match(/pixeldrain\.com\/u\/([a-zA-Z0-9]+)/);
    if (m) return m[1];
    m = String(url).match(/pixeldrain\.com\/api\/file\/([a-zA-Z0-9]+)/);
    return m ? m[1] : null;
  },

  get(id) {
    const cache = this._load();
    const hit = cache[id];
    if (hit && hit.ts && (Date.now() - hit.ts) < 7 * 86400000) return hit;
    return null;
  },

  set(id, meta) {
    const cache = this._load();
    cache[id] = { ...meta, ts: Date.now() };
    this._cache = cache;
    Store.set(K_PD, cache);
  },

  async fetch(id) {
    // Cek cache dulu
    const cached = this.get(id);
    if (cached) return cached;

    try {
      const r = await fetch(`https://pixeldrain.com/api/file/${id}/info`, {
        cache: "force-cache"
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();

      const meta = {
        id,
        name: d.name || null,
        size: typeof d.size === "number" ? d.size : null,
        type: d.mime_type || d.content_type || null,
        thumb: `https://pixeldrain.com/api/file/${id}/thumbnail?size=256`,
      };
      this.set(id, meta);
      return meta;
    } catch (e) {
      console.warn("PD fetch failed:", e);
      return null;
    }
  }
};