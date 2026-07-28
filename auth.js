// auth.js — API-backed accounts (email/password JWT), replacing Firebase Google sign-in.
// Access token lives in memory only (XSS mitigation); the rotating refresh token is persisted to
// localStorage when "Remember me" is on (survives a browser restart, up to the refresh-token life)
// else sessionStorage (cleared on tab close). A page load restores the session via /auth/refresh →
// /users/me. Ported from the FACS AuthContext, vanilla (no React).
import { configureApi, apiFetch } from "./api.js";

const RT_KEY = "workouts_rt";
const REMEMBER_KEY = "workouts_remember";

let accessToken = null; // in memory only
let refreshToken = null;
let currentUserObj = null;
let changeHandler = () => {};

function apiBase() {
  return ((typeof globalThis !== "undefined" && globalThis.__BASE__) || "") + "/api";
}

// --- refresh-token storage ---
function rememberOn() {
  try { return localStorage.getItem(REMEMBER_KEY) === "true"; } catch { return false; }
}
function readStoredRt() {
  try { return localStorage.getItem(RT_KEY) || sessionStorage.getItem(RT_KEY); } catch { return null; }
}
function persistRt(token) {
  try {
    localStorage.removeItem(RT_KEY);
    sessionStorage.removeItem(RT_KEY);
    if (token) (rememberOn() ? localStorage : sessionStorage).setItem(RT_KEY, token);
  } catch { /* storage unavailable */ }
}
function clearStorage() {
  try {
    localStorage.removeItem(RT_KEY);
    sessionStorage.removeItem(RT_KEY);
    localStorage.removeItem(REMEMBER_KEY);
  } catch { /* ignore */ }
}

function applyTokens(a, r) {
  accessToken = a;
  refreshToken = r;
  persistRt(r);
}
function doClear() {
  accessToken = null;
  refreshToken = null;
  currentUserObj = null;
  clearStorage();
}

function wireApi() {
  configureApi({
    accessToken: () => accessToken,
    refreshToken: () => refreshToken,
    setTokens: ({ accessToken: a, refreshToken: r }) => applyTokens(a, r),
    onLogout: () => { doClear(); changeHandler(null); }, // involuntary end (refresh failed)
  });
}

export function currentUser() { return currentUserObj; }
export function isSignedIn() { return !!currentUserObj; }

// Register the auth-state listener, wire the API client, and restore any prior session.
export async function initAuth(onChange) {
  changeHandler = onChange || (() => {});
  wireApi();
  return restore();
}

// Silently restore a session from a stored refresh token. Uses fetch directly (no access token
// yet), then /users/me via the configured client.
export async function restore() {
  const stored = readStoredRt();
  if (!stored) { doClear(); changeHandler(null); return null; }
  try {
    const rr = await fetch(`${apiBase()}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: stored }),
    });
    if (!rr.ok) throw new Error("refresh failed");
    const tokens = await rr.json();
    applyTokens(tokens.accessToken, tokens.refreshToken);
    const me = await apiFetch("/users/me");
    currentUserObj = me;
    changeHandler(me);
    return me;
  } catch {
    doClear();
    changeHandler(null);
    return null;
  }
}

export async function login(email, password, remember = false) {
  // Set the preference before storing tokens so persistRt targets the right store.
  try { localStorage.setItem(REMEMBER_KEY, remember ? "true" : "false"); } catch { /* ignore */ }
  const data = await apiFetch("/auth/login", { method: "POST", body: { email, password } });
  applyTokens(data.accessToken, data.refreshToken);
  currentUserObj = data.user;
  changeHandler(data.user);
  return data.user;
}

export async function signOutUser() {
  try {
    if (refreshToken) await apiFetch("/auth/logout", { method: "POST", body: { refreshToken } });
  } catch { /* best-effort */ }
  doClear();
  changeHandler(null);
}
