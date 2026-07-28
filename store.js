// store.js — persistence orchestration.
// `local` is the localStorage backend (guest + offline cache). `cloudBackend()` is the signed-in
// backend, talking to our own API (was Firestore) via api.js; app.js injects it on sign-in.
import { api } from "./api.js";

const LS_CONFIG = "ladder.last";
const LS_PRESETS = "ladder.presets";

export const local = {
  loadConfig() { try { const s = localStorage.getItem(LS_CONFIG); return s ? JSON.parse(s) : null; } catch (e) { return null; } },
  saveConfig(c) { try { localStorage.setItem(LS_CONFIG, JSON.stringify(c)); } catch (e) {} },
  loadPresets() { try { return JSON.parse(localStorage.getItem(LS_PRESETS) || "{}"); } catch (e) { return {}; } },
  savePresets(o) { try { localStorage.setItem(LS_PRESETS, JSON.stringify(o)); } catch (e) {} },
};

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
