// store.js — persistence orchestration.
// `local` is the localStorage backend (guest + offline cache). `cloudBackend()` is the signed-in
// backend, talking to our own API (was Firestore) via api.js; app.js injects it on sign-in.
import { api } from "./api.js";

const LS_CONFIG = "ladder.last";
const LS_PRESETS = "ladder.presets";
// BYOW: regimens live under their own keys so an uploaded workout can never collide with — or be
// mistaken for — a ladder-circuit config/preset (v1 decision 5).
const LS_REGIMEN = "ladder.regimen";
const LS_REGIMEN_PRESETS = "ladder.regimenPresets";
// Reserved key that namespaces regimen presets inside the single cloud presets document, so the
// server's /api/presets contract stays unchanged. Rejected as a user-facing preset name.
export const REGIMEN_NS = "__regimens__";

export const local = {
  loadConfig() { try { const s = localStorage.getItem(LS_CONFIG); return s ? JSON.parse(s) : null; } catch (e) { return null; } },
  saveConfig(c) { try { localStorage.setItem(LS_CONFIG, JSON.stringify(c)); } catch (e) {} },
  loadPresets() { try { return JSON.parse(localStorage.getItem(LS_PRESETS) || "{}"); } catch (e) { return {}; } },
  savePresets(o) { try { localStorage.setItem(LS_PRESETS, JSON.stringify(o)); } catch (e) {} },
  // Active regimen (null when the ladder circuit is the live workout).
  loadRegimen() { try { const s = localStorage.getItem(LS_REGIMEN); return s ? JSON.parse(s) : null; } catch (e) { return null; } },
  saveRegimen(r) { try { r ? localStorage.setItem(LS_REGIMEN, JSON.stringify(r)) : localStorage.removeItem(LS_REGIMEN); } catch (e) {} },
  loadRegimenPresets() { try { return JSON.parse(localStorage.getItem(LS_REGIMEN_PRESETS) || "{}"); } catch (e) { return {}; } },
  saveRegimenPresets(o) { try { localStorage.setItem(LS_REGIMEN_PRESETS, JSON.stringify(o)); } catch (e) {} },
};

// Split/merge helpers for the cloud presets document, which carries both kinds.
export function splitPresets(doc) {
  const d = (doc && typeof doc === "object") ? doc : {};
  const { [REGIMEN_NS]: regimens, ...ladder } = d;
  return { ladder, regimens: (regimens && typeof regimens === "object") ? regimens : {} };
}
export function mergePresets(ladder, regimens) {
  const out = { ...(ladder || {}) };
  delete out[REGIMEN_NS];
  if (regimens && Object.keys(regimens).length) out[REGIMEN_NS] = regimens;
  return out;
}

// Cloud backend for a signed-in user. Same interface the Firestore backend exposed
// (loadConfig/saveConfig/loadPresets/savePresets/deleteAll) so app.js is unchanged in shape; the
// user is inferred server-side from the JWT, so no uid is passed.
export function cloudBackend() {
  return {
    async loadConfig() { const { config } = await api.get("/state"); return config ?? null; },
    async saveConfig(c) { await api.put("/state", { config: c }); },
    async loadPresets() { const { presets } = await api.get("/presets"); return presets || {}; },
    async savePresets(o) { await api.put("/presets", { presets: o }); },
    async deleteAll() { await api.del("/account"); },
  };
}

// Decide a just-signed-in user's config from local + cloud snapshots. Cloud wins.
export function decideMigration(localConfig, cloudConfig) {
  if (cloudConfig) return { action: "use-cloud", config: cloudConfig };
  if (localConfig) return { action: "upload-local", config: localConfig };
  return { action: "none", config: null };
}
