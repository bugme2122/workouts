// store.js — persistence orchestration. Firebase-free & unit-testable.
// `local` is the localStorage backend (guest + offline cache). A cloud backend
// (Firestore) is created elsewhere and injected by app.js for signed-in users.
const LS_CONFIG = "ladder.last";
const LS_PRESETS = "ladder.presets";
const LS_WANTS_AUTH = "ladder.wantsAuth";
const LS_ENTERED = "ladder.entered";

export const local = {
  loadConfig() { try { const s = localStorage.getItem(LS_CONFIG); return s ? JSON.parse(s) : null; } catch (e) { return null; } },
  saveConfig(c) { try { localStorage.setItem(LS_CONFIG, JSON.stringify(c)); } catch (e) {} },
  loadPresets() { try { return JSON.parse(localStorage.getItem(LS_PRESETS) || "{}"); } catch (e) { return {}; } },
  savePresets(o) { try { localStorage.setItem(LS_PRESETS, JSON.stringify(o)); } catch (e) {} },
};

export function wantsAuth() { try { return localStorage.getItem(LS_WANTS_AUTH) === "1"; } catch (e) { return false; } }
export function setWantsAuth(v) { try { v ? localStorage.setItem(LS_WANTS_AUTH, "1") : localStorage.removeItem(LS_WANTS_AUTH); } catch (e) {} }
export function hasEntered() { try { return localStorage.getItem(LS_ENTERED) === "1"; } catch (e) { return false; } }
export function setEntered() { try { localStorage.setItem(LS_ENTERED, "1"); } catch (e) {} }
export function clearEntered() { try { localStorage.removeItem(LS_ENTERED); } catch (e) {} }

// Decide a just-signed-in user's config from local + cloud snapshots. Cloud wins.
export function decideMigration(localConfig, cloudConfig) {
  if (cloudConfig) return { action: "use-cloud", config: cloudConfig };
  if (localConfig) return { action: "upload-local", config: localConfig };
  return { action: "none", config: null };
}
