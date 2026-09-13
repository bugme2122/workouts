// store.js — persistence orchestration.
// `local` is the localStorage backend (guest + offline cache). `cloudBackend()` is the signed-in
// backend, talking to our own API (was Firestore) via api.js; app.js injects it on sign-in.
import { api } from "./api.js";

const LS_CONFIG = "ladder.last";
// Sidecar stamp for LS_CONFIG (GAPS #1). Kept out of the config object itself so it can never
// ride a share link or a preset — sanitize()/LIGHT_FIELDS know nothing about it.
const LS_CONFIG_AT = "ladder.last.at";
const LS_PRESETS = "ladder.presets";
// BYOW: regimens live under their own keys so an uploaded workout can never collide with — or be
// mistaken for — a ladder-circuit config/preset (v1 decision 5).
const LS_REGIMEN = "ladder.regimen";
const LS_REGIMEN_PRESETS = "ladder.regimenPresets";
// Pinned rows on the landing page ("preset:Name" / "regimen:Name").
const LS_PINS = "ladder.pins";
// Reserved key that namespaces regimen presets inside the single cloud presets document, so the
// server's /api/presets contract stays unchanged. Rejected as a user-facing preset name.
export const REGIMEN_NS = "__regimens__";
// Same trick for the landing page's pinned rows, so a pin follows you between devices.
// Both namespaces are retired together by the custom-workouts plan.
export const PINS_NS = "__pins__";

export const local = {
  loadConfig() { try { const s = localStorage.getItem(LS_CONFIG); return s ? JSON.parse(s) : null; } catch (e) { return null; } },
  saveConfig(c) { try { localStorage.setItem(LS_CONFIG, JSON.stringify(c)); localStorage.setItem(LS_CONFIG_AT, String(Date.now())); } catch (e) {} },
  // When this device last wrote its config; 0 when never written (or storage is unavailable).
  configUpdatedAt() { try { return parseInt(localStorage.getItem(LS_CONFIG_AT)) || 0; } catch (e) { return 0; } },
  loadPresets() { try { return JSON.parse(localStorage.getItem(LS_PRESETS) || "{}"); } catch (e) { return {}; } },
  savePresets(o) { try { localStorage.setItem(LS_PRESETS, JSON.stringify(o)); } catch (e) {} },
  // Active regimen (null when the ladder circuit is the live workout).
  loadRegimen() { try { const s = localStorage.getItem(LS_REGIMEN); return s ? JSON.parse(s) : null; } catch (e) { return null; } },
  saveRegimen(r) { try { r ? localStorage.setItem(LS_REGIMEN, JSON.stringify(r)) : localStorage.removeItem(LS_REGIMEN); } catch (e) {} },
  loadRegimenPresets() { try { return JSON.parse(localStorage.getItem(LS_REGIMEN_PRESETS) || "{}"); } catch (e) { return {}; } },
  saveRegimenPresets(o) { try { localStorage.setItem(LS_REGIMEN_PRESETS, JSON.stringify(o)); } catch (e) {} },
  loadPins() { try { const a = JSON.parse(localStorage.getItem(LS_PINS) || "[]"); return Array.isArray(a) ? a.filter(x => typeof x === "string") : []; } catch (e) { return []; } },
  savePins(a) { try { localStorage.setItem(LS_PINS, JSON.stringify((a || []).filter(x => typeof x === "string"))); } catch (e) {} },
};

// Split/merge helpers for the cloud presets document, which carries both kinds.
export function splitPresets(doc) {
  const d = (doc && typeof doc === "object") ? doc : {};
  const { [REGIMEN_NS]: regimens, [PINS_NS]: pins, ...ladder } = d;
  return {
    ladder,
    regimens: (regimens && typeof regimens === "object") ? regimens : {},
    pins: Array.isArray(pins) ? pins.filter(x => typeof x === "string") : [],
  };
}
export function mergePresets(ladder, regimens, pins) {
  const out = { ...(ladder || {}) };
  delete out[REGIMEN_NS];
  delete out[PINS_NS];
  if (regimens && Object.keys(regimens).length) out[REGIMEN_NS] = regimens;
  if (pins && pins.length) out[PINS_NS] = pins;
  return out;
}

// Union of two pin lists, order-stable. Pins are a preference, so a device that pinned
// something offline keeps it after a sync (GAPS #1's merge rule, applied to pins).
export function mergePins(localPins, cloudPins) {
  const out = [...(localPins || [])];
  (cloudPins || []).forEach(p => { if (!out.includes(p)) out.push(p); });
  return out;
}

// Cloud backend for a signed-in user. Same interface the Firestore backend exposed
// (loadConfig/saveConfig/loadPresets/savePresets/deleteAll) so app.js is unchanged in shape; the
// user is inferred server-side from the JWT, so no uid is passed.
export function cloudBackend() {
  return {
    async loadConfig() { const { config } = await api.get("/state"); return config ?? null; },
    // Same GET, but keeps the server's document timestamp so decideMigration can compare ages
    // instead of blindly preferring the cloud (GAPS #1).
    async loadState() {
      const { config, updatedAt } = await api.get("/state");
      return { config: config ?? null, updatedAt: updatedAt ? Date.parse(updatedAt) || 0 : 0 };
    },
    async saveConfig(c) { await api.put("/state", { config: c }); },
    async loadPresets() { const { presets } = await api.get("/presets"); return presets || {}; },
    async savePresets(o) { await api.put("/presets", { presets: o }); },
    async deleteAll() { await api.del("/account"); },
  };
}

// Decide a just-signed-in user's config from local + cloud snapshots.
// When both sides exist AND both are timestamped, the NEWER one wins — otherwise the historical
// cloud-wins rule stands. Before this (GAPS #1) signing in on a device with fresh local edits
// silently replaced them with a possibly months-old cloud snapshot, with no undo.
export function decideMigration(localConfig, cloudConfig, { localAt = 0, cloudAt = 0 } = {}) {
  if (cloudConfig && localConfig && localAt && cloudAt && localAt > cloudAt)
    return { action: "upload-local", config: localConfig };
  if (cloudConfig) return { action: "use-cloud", config: cloudConfig };
  if (localConfig) return { action: "upload-local", config: localConfig };
  return { action: "none", config: null };
}

// Union of two preset maps, cloud winning on a name collision. Replaces the old wholesale
// overwrite, which discarded every preset made locally since the last sync (GAPS #1).
export function mergePresetMaps(localPresets, cloudPresets) {
  return { ...(localPresets || {}), ...(cloudPresets || {}) };
}
