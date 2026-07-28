import test from "node:test";
import assert from "node:assert/strict";
import { configureApi, apiFetch } from "../api.js";

// Minimal Response-like for the mocked fetch (apiFetch uses .ok/.status/.text; refresh uses .json).
function res(status, obj) {
  const body = JSON.stringify(obj);
  return { ok: status >= 200 && status < 300, status, async text() { return body; }, async json() { return obj; } };
}
const pathOf = (url) => String(url).slice(String(url).indexOf("/api") + 4);

test("single-flight: concurrent 401s trigger exactly one refresh, then retry succeeds", async () => {
  const state = { refresh: 0, access: "stale", rt: "rt1" };
  globalThis.fetch = async (url, opts) => {
    const path = pathOf(url);
    const auth = opts.headers.Authorization || "";
    if (path === "/auth/refresh") {
      state.refresh++;
      await new Promise((r) => setTimeout(r, 10)); // force overlap
      return res(200, { accessToken: "fresh", refreshToken: "rt2" });
    }
    if (auth === "Bearer fresh") return res(200, { ok: true, path });
    return res(401, { error: "Session expired." });
  };
  configureApi({
    accessToken: () => state.access,
    refreshToken: () => state.rt,
    setTokens: ({ accessToken, refreshToken }) => { state.access = accessToken; state.rt = refreshToken; },
    onLogout: () => { throw new Error("should not log out"); },
  });

  const results = await Promise.all([apiFetch("/a"), apiFetch("/b"), apiFetch("/c")]);
  assert.equal(state.refresh, 1, "only one refresh across concurrent 401s");
  for (const r of results) assert.equal(r.ok, true);
  assert.equal(state.access, "fresh"); // tokens updated via setTokens
});

test("surfaces the server error message and status on failure", async () => {
  globalThis.fetch = async () => res(400, { error: "Bad thing" });
  configureApi({ accessToken: () => "x", refreshToken: () => null, setTokens() {}, onLogout() {} });
  await assert.rejects(() => apiFetch("/x"), (e) => e.message === "Bad thing" && e.status === 400);
});

test("no refresh token: a 401 calls onLogout and rejects (no crash)", async () => {
  let loggedOut = false;
  globalThis.fetch = async () => res(401, { error: "expired" });
  configureApi({ accessToken: () => "stale", refreshToken: () => null, setTokens() {}, onLogout: () => { loggedOut = true; } });
  await assert.rejects(() => apiFetch("/x"));
  assert.equal(loggedOut, true);
});

test("del() of a 204 no-content response returns null", async () => {
  globalThis.fetch = async () => ({ ok: true, status: 204, async text() { return ""; }, async json() { return null; } });
  configureApi({ accessToken: () => "tok", refreshToken: () => "rt", setTokens() {}, onLogout() {} });
  const { api } = await import("../api.js");
  const out = await api.del("/account");
  assert.equal(out, null);
});
