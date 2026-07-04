# Accounts, Auth & Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a welcome/landing page, Google sign-in, and cross-device sync of the current workout + presets via Firebase (Firestore), keeping a fully-local "guest" mode; and fix the Home accent color drifting with the last-opened workout theme.

**Architecture:** Static app + Firebase Web SDK v12.15.0 loaded by **dynamic `import()`** (so guests never fetch it). New `store.js` (Firebase-free persistence orchestration + localStorage backend, unit-tested), `auth.js` (lazy Google auth), `firebase-backend.js` (Firestore cloud store; stores config as a JSON string to dodge Firestore's no-nested-arrays rule), `firebase-config.js` (public config). `app.js` routes persistence through `store` and reacts to auth state. `engine.js`/`catalog.js` stay Firebase-free and testable.

**Tech Stack:** Vanilla ES modules, Firebase Web SDK v12.15.0 (CDN, dynamic import), Firestore, Node ≥18 `node --test`. No npm/build.

## Global Constraints

- **Relative asset paths** for local files; Firebase from `https://www.gstatic.com/firebasejs/12.15.0/*` via **dynamic import only** (never a top-level import in a file that boots at load).
- **Guest mode must never break, even offline** — no Firebase code runs unless the user has opted into cloud (a local `wantsAuth` flag) or taps Sign in.
- **`engine.js`/`catalog.js` stay Firebase-free** and Node-testable. `store.js` is Firebase-free too (cloud backend is injected).
- **Config is stored in Firestore as a single JSON string field** (`{ json: JSON.stringify(config) }`) — Firestore rejects nested arrays like `ladder`.
- Firestore paths: config `users/{uid}/state/current`, presets `users/{uid}/data/presets`. Security rules (already published by the user) restrict each user to their own `users/{uid}/**`.
- Public `firebaseConfig` is safe to commit. Do NOT add any secret/service-account key.
- Sign-in = **Google only** (popup). Landing = **Welcome → Sign in / Continue as guest**. Sync scope = **current config + presets** (no history). First-sign-in conflict = **cloud-wins**.

---

### Task 1: Fix Home accent drift (fixed brand color)

Home's Start buttons / duration pills use `var(--accent)` = `var(--work)`, which changes because opening a workout's Customize applies its theme globally. Pin Home to a stable brand accent.

**Files:**
- Modify: `styles.css`

- [ ] **Step 1: Add a brand token and use it on Home**

In `styles.css`, find the rule (around line 156):
```css
  #screen-home, #screen-customize{ --accent: var(--work); }
```
Replace it with (Home pinned to a fixed brand lime; Customize still previews the workout theme):
```css
  :root{ --brand:#c6f24e; }
  #screen-home{ --accent: var(--brand); }
  #screen-customize{ --accent: var(--work); }
```

- [ ] **Step 2: Verify**

Run: `node --test` → still passes (CSS-only change, no test impact; confirm nothing broke the module graph is N/A here).
Static check: `#screen-home` now resolves `--accent` to `#c6f24e` regardless of the active theme; `.wdur`/`.wfoot .go` on Home render lime consistently. The controller will confirm the Home cards render a stable lime accent in a browser check.

- [ ] **Step 3: Commit**

```bash
git add styles.css
git commit -m "fix: pin Home accent to a fixed brand color (no theme drift)"
```

---

### Task 2: `firebase-config.js` + `store.js` (persistence layer) + route app.js through it, with tests

Introduce the persistence abstraction and move app.js's localStorage usage behind it. Behavior-preserving for guests.

**Files:**
- Create: `firebase-config.js`
- Create: `store.js`
- Create: `tests/store.test.mjs`
- Modify: `app.js`

**Interfaces:**
- Produces (`store.js`): `local` (`{loadConfig, saveConfig, loadPresets, savePresets}`), `wantsAuth()`, `setWantsAuth(v)`, `hasEntered()`, `setEntered()`, `decideMigration(localConfig, cloudConfig)`.
- Produces (`firebase-config.js`): `firebaseConfig`, `FB_SDK`.

- [ ] **Step 1: Create `firebase-config.js`**

```js
// firebase-config.js — PUBLIC Firebase web config (safe to commit; security is
// enforced by Firestore rules, not by hiding this). Project: workout-system-73cf8.
export const firebaseConfig = {
  apiKey: "AIzaSyDbFCqQU4vmJ8tmDaAjHY1LlJhf6LwEA3M",
  authDomain: "workout-system-73cf8.firebaseapp.com",
  projectId: "workout-system-73cf8",
  storageBucket: "workout-system-73cf8.firebasestorage.app",
  messagingSenderId: "263629028755",
  appId: "1:263629028755:web:bd9ce676d2b4c9dc873c66",
};
export const FB_SDK = "https://www.gstatic.com/firebasejs/12.15.0";
```

- [ ] **Step 2: Write the failing tests**

Create `tests/store.test.mjs`:
```js
import test from "node:test";
import assert from "node:assert/strict";
import { decideMigration, local, wantsAuth, setWantsAuth, hasEntered, setEntered } from "../store.js";

// Minimal in-memory localStorage stub for Node.
function stubLocalStorage() {
  const m = new Map();
  globalThis.localStorage = {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
  };
  return m;
}

test("decideMigration prefers cloud when it has data", () => {
  assert.deepEqual(decideMigration({ a: 1 }, { b: 2 }), { action: "use-cloud", config: { b: 2 } });
});
test("decideMigration uploads local when cloud is empty", () => {
  assert.deepEqual(decideMigration({ a: 1 }, null), { action: "upload-local", config: { a: 1 } });
});
test("decideMigration is a no-op when both are empty", () => {
  assert.deepEqual(decideMigration(null, null), { action: "none", config: null });
});
test("local backend round-trips config and presets via localStorage", () => {
  stubLocalStorage();
  assert.equal(local.loadConfig(), null);
  local.saveConfig({ people: 3 });
  assert.deepEqual(local.loadConfig(), { people: 3 });
  assert.deepEqual(local.loadPresets(), {});
  local.savePresets({ A: { x: 1 } });
  assert.deepEqual(local.loadPresets(), { A: { x: 1 } });
});
test("wantsAuth and hasEntered flags persist and clear", () => {
  stubLocalStorage();
  assert.equal(wantsAuth(), false);
  setWantsAuth(true); assert.equal(wantsAuth(), true);
  setWantsAuth(false); assert.equal(wantsAuth(), false);
  assert.equal(hasEntered(), false);
  setEntered(); assert.equal(hasEntered(), true);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `node --test`
Expected: FAIL — `Cannot find module '../store.js'`.

- [ ] **Step 4: Create `store.js`**

```js
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

// Decide a just-signed-in user's config from local + cloud snapshots. Cloud wins.
export function decideMigration(localConfig, cloudConfig) {
  if (cloudConfig) return { action: "use-cloud", config: cloudConfig };
  if (localConfig) return { action: "upload-local", config: localConfig };
  return { action: "none", config: null };
}
```

- [ ] **Step 5: Run to verify pass**

Run: `node --test`
Expected: PASS — 28 prior + 5 new store tests green.

- [ ] **Step 6: Route `app.js` persistence through `store.local`**

In `app.js`, add to the imports (near the top, after the engine import). `store.js` has NO Firebase import, so this static import is safe:
```js
import * as store from "./store.js";
```
Replace `loadConfig` (app.js:15-20 region):
```js
function loadConfig(){
  const body=(location.hash||"").replace(/^#/,"");
  if(body.startsWith("w=")||body.startsWith("c=")){ const c=decShare(body); if(c) return sanitize(migrate(c)); }
  const c=store.local.loadConfig(); if(c) return sanitize(migrate(c));
  return sanitize(clone(DEFAULT));
}
```
Replace `persist` (keep the hash update):
```js
function persist(){
  store.local.saveConfig(config);
  try{ history.replaceState(null,"","#"+encShare(config)); }catch(e){}
  cloudSaveConfig(config);   // no-op until a cloud backend is attached (Task 3)
}
```
Replace `getPresets`/`setPresets`:
```js
function getPresets(){ return store.local.loadPresets(); }
function setPresets(o){ store.local.savePresets(o); cloudSavePresets(o); }
```
Add near the other state vars a cloud stub so Task 2 compiles/runs standalone (Task 3 fills these in):
```js
let cloud=null;
function cloudSaveConfig(c){ /* attached in Task 3 */ }
function cloudSavePresets(o){ /* attached in Task 3 */ }
```

- [ ] **Step 7: Verify**

Run: `node --test` → 33 pass (28 + 5).
Run: `node --check app.js` → OK.
Static: guest behavior unchanged (config + presets still persist via localStorage; share links still work). The controller runs the headless boot smoke.

- [ ] **Step 8: Commit**

```bash
git add firebase-config.js store.js tests/store.test.mjs app.js
git commit -m "feat: persistence layer (store.js) + firebase-config; route app.js through it"
```

---

### Task 3: `auth.js` + `firebase-backend.js` + wire auth/cloud sync into app.js

Add Google auth and the Firestore cloud backend (both lazy-loaded), and make signed-in users sync.

**Files:**
- Create: `auth.js`
- Create: `firebase-backend.js`
- Modify: `app.js`

**Interfaces:**
- Consumes: `firebaseConfig`, `FB_SDK`; `store.decideMigration`, `store.setWantsAuth`.
- Produces (`auth.js`): `initAuth(onChange)`, `signInWithGoogle()`, `signOutUser()`, `firebaseApp()`.
- Produces (`firebase-backend.js`): `cloudBackend(uid)` → `{ loadConfig, saveConfig, loadPresets, savePresets, deleteAll }` (all async).

- [ ] **Step 1: Create `auth.js`** (Firebase loaded lazily so guests never fetch it)

```js
// auth.js — Google auth via Firebase, lazy-loaded so guests/offline never fetch it.
import { firebaseConfig, FB_SDK } from "./firebase-config.js";

let _app = null, _auth = null, _provider = null;
async function ensure() {
  if (_auth) return _auth;
  const { initializeApp } = await import(`${FB_SDK}/firebase-app.js`);
  const { getAuth, GoogleAuthProvider } = await import(`${FB_SDK}/firebase-auth.js`);
  _app = initializeApp(firebaseConfig);
  _auth = getAuth(_app);
  _provider = new GoogleAuthProvider();
  return _auth;
}
export function firebaseApp() { return _app; }

export async function initAuth(onChange) {
  const auth = await ensure();
  const { onAuthStateChanged } = await import(`${FB_SDK}/firebase-auth.js`);
  onAuthStateChanged(auth, onChange);
}
export async function signInWithGoogle() {
  const auth = await ensure();
  const { signInWithPopup } = await import(`${FB_SDK}/firebase-auth.js`);
  return signInWithPopup(auth, _provider);
}
export async function signOutUser() {
  const auth = await ensure();
  const { signOut } = await import(`${FB_SDK}/firebase-auth.js`);
  return signOut(auth);
}
```

- [ ] **Step 2: Create `firebase-backend.js`** (Firestore; config stored as JSON string)

```js
// firebase-backend.js — Firestore cloud store for a signed-in user. Lazy-loaded.
// Config/presets are stored as a JSON STRING field because Firestore rejects
// nested arrays (our config.ladder is [[on,off],...]).
import { FB_SDK } from "./firebase-config.js";
import { firebaseApp } from "./auth.js";

let _db = null;
async function db() {
  if (_db) return _db;
  const { getFirestore } = await import(`${FB_SDK}/firebase-firestore.js`);
  _db = getFirestore(firebaseApp());
  return _db;
}
export function cloudBackend(uid) {
  const cfgPath = `users/${uid}/state/current`;
  const presetsPath = `users/${uid}/data/presets`;
  return {
    async loadConfig() {
      const d = await db();
      const { doc, getDoc } = await import(`${FB_SDK}/firebase-firestore.js`);
      const snap = await getDoc(doc(d, cfgPath));
      return snap.exists() && snap.data().json ? JSON.parse(snap.data().json) : null;
    },
    async saveConfig(c) {
      const d = await db();
      const { doc, setDoc } = await import(`${FB_SDK}/firebase-firestore.js`);
      await setDoc(doc(d, cfgPath), { json: JSON.stringify(c) });
    },
    async loadPresets() {
      const d = await db();
      const { doc, getDoc } = await import(`${FB_SDK}/firebase-firestore.js`);
      const snap = await getDoc(doc(d, presetsPath));
      return snap.exists() && snap.data().json ? JSON.parse(snap.data().json) : {};
    },
    async savePresets(o) {
      const d = await db();
      const { doc, setDoc } = await import(`${FB_SDK}/firebase-firestore.js`);
      await setDoc(doc(d, presetsPath), { json: JSON.stringify(o) });
    },
    async deleteAll() {
      const d = await db();
      const { doc, deleteDoc } = await import(`${FB_SDK}/firebase-firestore.js`);
      await deleteDoc(doc(d, cfgPath));
      await deleteDoc(doc(d, presetsPath));
    },
  };
}
```

- [ ] **Step 3: Wire auth + cloud into `app.js`**

Add the auth import at the top (static import is safe — `auth.js` only dynamically imports Firebase):
```js
import * as auth from "./auth.js";
```
Replace the Task-2 cloud stubs with the real implementations (find `let cloud=null;` and the two stub functions):
```js
let cloud=null, authUser=null, _cfgSaveT=null;
function cloudSaveConfig(c){
  if(!cloud) return;
  clearTimeout(_cfgSaveT);
  _cfgSaveT=setTimeout(()=>{ cloud.saveConfig(c).catch(()=>{}); }, 1200);
}
function cloudSavePresets(o){ if(cloud) cloud.savePresets(o).catch(()=>{}); }

async function connectAuth(){
  try{ await auth.initAuth(onAuthChange); }catch(e){ /* offline / blocked: stay guest */ }
}
async function onAuthChange(u){
  authUser=u;
  if(u){
    store.setWantsAuth(true);
    try{
      const { cloudBackend } = await import("./firebase-backend.js");
      cloud = cloudBackend(u.uid);
      let cloudCfg=null; try{ cloudCfg=await cloud.loadConfig(); }catch(e){}
      const dec = store.decideMigration(store.local.loadConfig(), cloudCfg);
      if(dec.action==="use-cloud"){ config=sanitize(migrate(dec.config)); store.local.saveConfig(config); }
      else if(dec.action==="upload-local"){ config=sanitize(migrate(dec.config)); try{ await cloud.saveConfig(config); }catch(e){} }
      // presets: cloud-wins, else upload local
      try{
        const cp=await cloud.loadPresets();
        if(cp && Object.keys(cp).length){ store.local.savePresets(cp); }
        else { const lp=store.local.loadPresets(); if(Object.keys(lp).length) await cloud.savePresets(lp); }
      }catch(e){}
      // Re-render only if not currently in a share-link/live session that must be preserved.
      if(!bootedFromShare){ applyTheme(config.theme); build(); setupView(); reset(); }
    }catch(e){ /* keep local config on any cloud error */ }
  } else {
    cloud=null; store.setWantsAuth(false);
  }
  updateAccountUI(authUser);
}
```
Add a `bootedFromShare` flag at boot (see Task 4 boot edit). `updateAccountUI` is defined in Task 4.

- [ ] **Step 4: Verify**

Run: `node --test` → 33 pass (unchanged; new modules aren't imported by tests).
Run: `node --check app.js && node --check auth.js && node --check firebase-backend.js` → all OK (syntax; dynamic-import URLs are not resolved by `--check`).
Static self-review: no TOP-LEVEL Firebase import anywhere (grep for `from "https://www.gstatic` → zero matches; all Firebase imports are `await import(...)`). `app.js` statically imports only local modules. Guest path never calls `auth.*` or `cloudBackend`.
Note for controller: the live auth/Firestore flow is NOT headless-testable; verify via the Task-4 manual checklist.

- [ ] **Step 5: Commit**

```bash
git add auth.js firebase-backend.js app.js
git commit -m "feat: Google auth + Firestore cloud sync (lazy-loaded, JSON-string storage)"
```

---

### Task 4: Landing screen, Account settings, boot flow, delete-my-data + manual checklist

Add the UI and boot routing, plus the account controls.

**Files:**
- Modify: `index.html` (welcome screen + Account settings section)
- Modify: `styles.css` (welcome screen styles)
- Modify: `app.js` (boot flow, welcome/account wiring, `updateAccountUI`)

- [ ] **Step 1: Add the welcome screen markup to `index.html`**

Immediately after `<body>` and before `#screen-home`, add:
```html
<section id="screen-welcome" class="screen">
  <div class="welcome">
    <div class="brand"><b>Ladder</b> Circuit</div>
    <div class="wtagline">Color-coded interval circuits for 1&ndash;6 people.</div>
    <div id="welcomeUser" class="welcomeUser" hidden></div>
    <button class="main" id="signInBtn">Sign in with Google</button>
    <button class="ghost" id="guestBtn">Continue as guest</button>
    <div class="hint" id="welcomeHint">Guest mode keeps everything on this device. Sign in to sync across devices.</div>
  </div>
</section>
```

- [ ] **Step 2: Add the Account section to the Settings sheet in `index.html`**

Find the Presets `.sec` block (contains `id="presetList"`). Immediately before it (or after it), add:
```html
    <div class="sec"><div class="lab">Account</div>
      <div id="accountInfo" class="accountInfo"></div>
    </div>
```

- [ ] **Step 3: Add welcome styles to `styles.css`**

```css
.welcome{ width:100%; max-width:480px; margin:0 auto; min-height:70vh; display:flex; flex-direction:column; justify-content:center; gap:14px; text-align:center; padding:24px 14px; }
.welcome .brand{ font-family:'Barlow Condensed',sans-serif; font-weight:700; letter-spacing:.14em; text-transform:uppercase; font-size:22px; color:var(--dim); }
.welcome .brand b{ color:var(--ink); }
.welcome .wtagline{ font-family:'Barlow',sans-serif; color:var(--dim); font-size:14px; margin-bottom:6px; }
.welcome .welcomeUser{ font-family:'Barlow Condensed',sans-serif; font-weight:700; color:var(--ink); font-size:16px; }
#screen-welcome{ --accent: var(--brand); }
.accountInfo{ display:flex; flex-direction:column; gap:9px; font-family:'Barlow',sans-serif; font-size:13px; color:var(--dim); }
.accountInfo .who{ color:var(--ink); font-weight:600; }
.accountInfo button{ font-family:'Barlow Condensed',sans-serif; font-weight:700; letter-spacing:.08em; text-transform:uppercase; font-size:13px; padding:10px 12px; border-radius:10px; border:1px solid var(--line); background:var(--panel); color:var(--ink); cursor:pointer; }
.accountInfo button.danger{ color:#ff6b6b; border-color:#5a2a2a; }
```

- [ ] **Step 4: Boot flow + welcome wiring in `app.js`**

Replace the init block (app.js:446-451 region) with:
```js
// ---------- init ----------
const bootedFromShare = /^#?[wc]=/.test(location.hash || "");
applyTheme(config.theme);
renderCatalog();
if (bootedFromShare) {
  showScreen("live"); build(); setupView(); reset();
} else if (store.hasEntered()) {
  showScreen("home");
} else {
  showScreen("welcome");
}
if (store.wantsAuth()) connectAuth();   // returning signed-in user: reconnect + cloud-load (async)

document.getElementById("guestBtn").onclick = () => { store.setEntered(); showScreen("home"); };
document.getElementById("signInBtn").onclick = async () => {
  store.setEntered();
  try { await connectAuth(); await auth.signInWithGoogle(); showScreen("home"); }
  catch (e) { showScreen("home"); }   // popup closed/blocked → continue as guest
};
```
(`bootedFromShare` is referenced by `onAuthChange` in Task 3 — it is a module-level `const` here, in scope.)

- [ ] **Step 5: `updateAccountUI` + account controls in `app.js`**

Add:
```js
function updateAccountUI(u){
  const box = document.getElementById("accountInfo");
  const wu = document.getElementById("welcomeUser");
  if(!box) return;
  if(u){
    const name = u.displayName || u.email || "Signed in";
    box.innerHTML = '<div class="who">'+esc(name)+'</div>'+
      '<button id="acctSignOut">Sign out</button>'+
      '<button id="acctDelete" class="danger">Delete my cloud data</button>';
    document.getElementById("acctSignOut").onclick = async () => { try{ await auth.signOutUser(); }catch(e){} };
    document.getElementById("acctDelete").onclick = async () => {
      if(!confirm("Delete your synced workout and presets from the cloud? Your device keeps its local copy.")) return;
      try{ if(cloud) await cloud.deleteAll(); }catch(e){}
      try{ await auth.signOutUser(); }catch(e){}
    };
    if(wu){ wu.hidden=false; wu.textContent="Signed in as "+name; }
  } else {
    box.innerHTML = '<div>Not signed in &mdash; using this device only.</div>'+
      '<button id="acctSignIn">Sign in with Google to sync</button>';
    const b=document.getElementById("acctSignIn");
    if(b) b.onclick = async () => { try{ await connectAuth(); await auth.signInWithGoogle(); }catch(e){} };
    if(wu){ wu.hidden=true; }
  }
}
updateAccountUI(null);   // initial (signed-out) render
```

- [ ] **Step 6: Verify**

Run: `node --test` → 33 pass.
Run: `node --check app.js` → OK.
Static self-review: `#screen-welcome`, `#signInBtn`, `#guestBtn`, `#accountInfo` exist and are wired; guest button routes to Home and sets the entered flag; boot shows welcome only on first visit (no entered flag, no share link); `updateAccountUI` toggles signed-in vs signed-out controls; delete uses a `confirm()`.
Controller runs the headless boot smoke (guest path — no Firebase loaded) and the workout driver.

- [ ] **Step 7: Manual test checklist (record in the report; requires a real browser + the live Firebase project)**

Serve over http (`python -m http.server 8000`, open `http://localhost:8000`):
1. **First load:** welcome screen appears. "Continue as guest" → Home; refresh → goes straight to Home (entered flag). Everything works offline, no network calls to Google (guest).
2. **Sign in:** tap Sign in with Google → popup → pick account → lands on Home. Settings → Account shows your name + Sign out + Delete.
3. **Cross-device sync:** as a signed-in user, change people/length/theme and start once (persist). On a second browser/device, sign in with the same account → the same config loads.
4. **Presets:** save a preset while signed in; it appears after signing in elsewhere.
5. **Guest→sign-in migration:** as a guest, set up a workout; sign in with a fresh account → your local setup uploads (cloud was empty). With an account that already has cloud data, cloud wins.
6. **Sign out:** reverts to local; app still usable; refresh stays on Home.
7. **Delete my cloud data:** confirm dialog → cloud docs removed (verify in Firestore console) → signed out; local copy remains.
8. **Rules:** in the Firestore console Rules Playground, confirm a read of `users/OTHER_UID/state/current` as a different `uid` is denied.
9. **Share links** still boot straight into Live in both guest and signed-in states.

- [ ] **Step 8: Commit**

```bash
git add index.html styles.css app.js
git commit -m "feat: welcome/landing screen + Account settings (sign in/out, delete data) + boot flow"
```

---

## Self-Review

- **Spec coverage:** landing page (T4), Google sign-in (T3 auth.js + T4 buttons), guest mode preserved (T2 local backend + T4 guest button; Firebase never loads for guests), cloud sync of config+presets (T3 backend + app wiring), cloud-wins migration (T2 `decideMigration` + T3 apply), per-user Firestore paths + JSON-string storage (T3), delete-my-data (T4), Home accent fix (T1), offline-safe (dynamic imports, T3). All covered.
- **Placeholder scan:** Task-2 cloud functions are explicit no-op stubs, replaced by real code in Task 3 (documented, not a placeholder gap) — every other step carries literal code.
- **Type consistency:** `store.local.{loadConfig,saveConfig,loadPresets,savePresets}`, `decideMigration -> {action,config}`, `cloudBackend(uid) -> {loadConfig,saveConfig,loadPresets,savePresets,deleteAll}`, `initAuth/signInWithGoogle/signOutUser/firebaseApp`, `bootedFromShare`, `updateAccountUI(u)` names match across producer/consumer tasks. Firestore path strings match between backend and rules.

## Verification note

The Firebase auth + Firestore paths cannot be exercised headlessly (real Google popup + live database + rules). Unit tests cover the Firebase-free logic (`store.js`); everything else is code-review-gated plus the Task-4 manual browser checklist against the live project. `node --check` confirms syntax of the Firebase modules without resolving their dynamic CDN imports.
