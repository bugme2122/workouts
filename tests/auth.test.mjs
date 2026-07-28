import test from "node:test";
import assert from "node:assert/strict";
import { initAuth, login, signOutUser, currentUser } from "../auth.js";

// In-memory Web Storage mocks.
function memStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _map: m,
  };
}
function resetStorage() {
  globalThis.localStorage = memStore();
  globalThis.sessionStorage = memStore();
}
function res(status, obj) {
  const body = JSON.stringify(obj);
  return { ok: status >= 200 && status < 300, status, async text() { return body; }, async json() { return obj; } };
}
const pathOf = (url) => String(url).slice(String(url).indexOf("/api") + 4);

// A fetch backend that knows one user.
function serverFetch() {
  return async (url, opts) => {
    const path = pathOf(url);
    const auth = opts.headers?.Authorization || "";
    if (path === "/auth/login") {
      const { email, password } = JSON.parse(opts.body);
      if (email === "a@b.com" && password === "correcthorse")
        return res(200, { accessToken: "acc1", refreshToken: "rt1", user: { id: "u1", email } });
      return res(401, { error: "Invalid email or password." });
    }
    if (path === "/auth/refresh") {
      const { refreshToken } = JSON.parse(opts.body);
      if (refreshToken === "rt1") return res(200, { accessToken: "acc2", refreshToken: "rt2" });
      return res(401, { error: "Invalid or expired refresh token." });
    }
    if (path === "/users/me") {
      if (auth === "Bearer acc2" || auth === "Bearer acc1") return res(200, { id: "u1", email: "a@b.com" });
      return res(401, { error: "Authentication required." });
    }
    if (path === "/auth/logout") return res(204, {});
    return res(404, { error: "nope" });
  };
}

test("login with remember=true stores refresh token in localStorage (not session), access in memory", async () => {
  resetStorage();
  globalThis.fetch = serverFetch();
  let changed = null;
  await initAuth((u) => { changed = u; });
  const user = await login("a@b.com", "correcthorse", true);
  assert.equal(user.email, "a@b.com");
  assert.equal(currentUser().email, "a@b.com");
  assert.equal(changed?.email, "a@b.com"); // onChange fired
  assert.equal(globalThis.localStorage.getItem("workouts_rt"), "rt1"); // remember → localStorage
  assert.equal(globalThis.sessionStorage.getItem("workouts_rt"), null);
  // access token is never persisted
  assert.equal(globalThis.localStorage.getItem("workouts_at"), null);
});

test("login with remember=false stores refresh token in sessionStorage only", async () => {
  resetStorage();
  globalThis.fetch = serverFetch();
  await initAuth(() => {});
  await login("a@b.com", "correcthorse", false);
  assert.equal(globalThis.sessionStorage.getItem("workouts_rt"), "rt1");
  assert.equal(globalThis.localStorage.getItem("workouts_rt"), null);
});

test("restore() rebuilds the session from a stored refresh token", async () => {
  resetStorage();
  globalThis.fetch = serverFetch();
  // Simulate a prior "remember me" login persisted across a reload.
  globalThis.localStorage.setItem("workouts_remember", "true");
  globalThis.localStorage.setItem("workouts_rt", "rt1");
  let changed = "unset";
  const me = await initAuth((u) => { changed = u; }); // initAuth → restore
  assert.equal(me?.email, "a@b.com");
  assert.equal(currentUser().email, "a@b.com");
  assert.equal(changed?.email, "a@b.com");
  // refresh rotated the token; new one persisted
  assert.equal(globalThis.localStorage.getItem("workouts_rt"), "rt2");
});

test("no stored token → initAuth restores to signed-out", async () => {
  resetStorage();
  globalThis.fetch = serverFetch();
  let changed = "unset";
  const me = await initAuth((u) => { changed = u; });
  assert.equal(me, null);
  assert.equal(currentUser(), null);
  assert.equal(changed, null);
});

test("signOutUser clears storage and fires onChange(null)", async () => {
  resetStorage();
  globalThis.fetch = serverFetch();
  let changed = "unset";
  await initAuth((u) => { changed = u; });
  await login("a@b.com", "correcthorse", true);
  await signOutUser();
  assert.equal(currentUser(), null);
  assert.equal(changed, null);
  assert.equal(globalThis.localStorage.getItem("workouts_rt"), null);
  assert.equal(globalThis.sessionStorage.getItem("workouts_rt"), null);
});
