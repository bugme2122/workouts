// api.js — single fetch entry point for the workouts API. Attaches the access JWT, transparently
// refreshes once on a 401 (single-flight), and surfaces the server's `error` message. Tokens live
// in memory, injected by auth.js via configureApi(). Ported from the FACS client, vanilla (no build).

// Same-origin API base. BASE_PATH is injected at serve time (E4) as window.__BASE__ so calls hit
// e.g. /workouts/api/* in prod and /api/* locally. Read lazily so injection order doesn't matter.
function apiBase() {
  const base = (typeof globalThis !== "undefined" && globalThis.__BASE__) || "";
  return base + "/api";
}

let getAccessToken = () => null;
let getRefreshToken = () => null;
let onTokens = () => {};
let onAuthLost = () => {};

// Wire the client to auth.js's in-memory token state. Only overrides callbacks that are provided.
export function configureApi({ accessToken, refreshToken, setTokens, onLogout } = {}) {
  if (accessToken) getAccessToken = accessToken;
  if (refreshToken) getRefreshToken = refreshToken;
  if (setTokens) onTokens = setTokens;
  if (onLogout) onAuthLost = onLogout;
}

async function raw(path, { method = "GET", body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${apiBase()}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
}

// Single-flight: if several requests 401 at once, only one refresh runs; the rest await it, so a
// rotated-out token never triggers a spurious logout. Returns the FRESH access token (or null).
let refreshInFlight = null;
async function tryRefresh() {
  if (refreshInFlight) return refreshInFlight;
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
  refreshInFlight = (async () => {
    const res = await raw("/auth/refresh", { method: "POST", body: { refreshToken } });
    if (!res.ok) return null;
    const data = await res.json();
    onTokens(data);
    return data.accessToken;
  })().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

export async function apiFetch(path, options = {}) {
  let res = await raw(path, { ...options, token: getAccessToken() });

  if (res.status === 401 && !options._retried) {
    const fresh = await tryRefresh();
    if (fresh) {
      // Use the fresh token directly — getAccessToken()'s closure may not have updated yet.
      res = await raw(path, { ...options, token: fresh });
      if (res.status === 401) onAuthLost(); // still unauthorized → session ended
    } else {
      onAuthLost();
    }
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(data?.error || "Request failed.");
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: (p) => apiFetch(p),
  post: (p, body) => apiFetch(p, { method: "POST", body }),
  put: (p, body) => apiFetch(p, { method: "PUT", body }),
  patch: (p, body) => apiFetch(p, { method: "PATCH", body }),
  del: (p) => apiFetch(p, { method: "DELETE" }),
};
