# Sign-in Screen Light Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the welcome/sign-in screen as a light, centered, minimal column matching the supplied reference layout — ring mark, "Welcome back" heading, guest pill above an "or" divider, email + password pill fields, one dark CTA, footer microcopy — while the rest of the app stays dark.

**Architecture:** The light theme is a **scoped token override**, not a change to `:root`. A `body.auth-light` class re-points the existing CSS custom properties (`--bg`, `--ink`, `--dim`, `--line`, `--panel`) to light values and neutralizes the body gradient and grain overlay. The class is toggled in exactly one place — inside `showScreen()` — so every one of the 14 call sites stays untouched and the two states can never desync. Markup for the welcome section is rebuilt from scratch; the new CSS lives in a single self-contained block that replaces the `.lane*` block added in the previous pass.

**Tech Stack:** Vanilla ES modules, no build step, no dependencies. `node:test` for the one piece of extracted pure logic. Google Fonts (Anton / Barlow Condensed / Barlow) already loaded.

## Global Constraints

- **Zero npm dependencies.** Do not add any. Static site, no build step — a hard project constraint.
- **Do not edit `design-tokens.css`.** It is not linked from `index.html`; edits there produce no visual change. All CSS goes in `styles.css`.
- **Do not modify the CSP `<meta>` in `index.html`.** No new origins are needed: the mark is inline SVG, the fonts are already-allowed `fonts.googleapis.com` / `fonts.gstatic.com`.
- **Every dynamic value interpolated into HTML must pass through `esc()`**, and generated attributes must use double quotes (`esc()` does not escape single quotes).
- **Do not touch `enc`/`dec`, `LIGHT_FIELDS`, `sanitize`, or `migrate` semantics.** Share-link backward compatibility is a hard requirement. This work does not go near the config trust boundary.
- **Do not remove the render caches** (`_contentSig`, `_pcardKey`, `_bigKey`) in `app.js`.
- **Element IDs that must survive verbatim** (they are wired in `app.js` and read by tests): `loginForm`, `loginEmail`, `loginPassword`, `loginRemember`, `loginError`, `signInBtn`, `guestBtn`, `welcomeUser`, `welcomeHint`.
- **`npm test` must pass (60+ tests) before any task is claimed done.**
- Copy is **sentence case** on this screen ("Continue as guest"), a deliberate departure from the app's uppercase-condensed button style, matching the reference.

## Design Decisions (settled with the user)

| Decision | Choice |
|---|---|
| Theme | Light, like the reference. App stays dark elsewhere. |
| Field flow | Email + password both on one screen, single submit. No two-step. |
| Slot above divider | "Continue as guest" outlined pill (where Google sat), with "2 of 5 workouts" beneath. |
| Slot below form | Admin-accounts note (where "Sign up" sat). |
| Rung strip | Dropped. Replaced by plain-text workout count. |

## Design Tokens (light scope)

Applied only under `body.auth-light`:

| Token | Value | Role |
|---|---|---|
| `--bg` | `#ffffff` | page |
| `--ink` | `#101322` | heading + input text (near-navy, matches reference) |
| `--dim` | `#6b7280` | microcopy, placeholders — 5.0:1 on white |
| `--line` | `#e3e5ea` | input + guest-pill borders |
| `--panel` | `#ffffff` | field fill |
| `--auth-cta` | `#101322` | primary button fill |
| `--auth-cta-ink` | `#ffffff` | primary button text |
| `--auth-focus` | `#6f9b16` | focus ring — deepened lime, 3.9:1 on white |

**Why `--auth-focus` is not `--brand`:** the app's lime `#c6f24e` is a dark-background color; on white it measures roughly 1.4:1 and is invisible as a focus indicator. `#6f9b16` is the same hue deepened to clear the 3:1 non-text contrast floor. The same reasoning applies to the mark in Task 3.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `engine.js` | Modify (append) | `guestAccessLabel()` — the one piece of new pure logic, so it can be tested per project convention. |
| `tests/engine.test.mjs` | Modify (append) | Tests for `guestAccessLabel()`. |
| `index.html` | Modify | Add Barlow 700 to the font URL; rebuild the `#screen-welcome` section; add `auth-light` to the initial `<body>` class. |
| `styles.css` | Modify | Replace the `.lane*` block with the light auth block. |
| `app.js` | Modify | Toggle `body.auth-light` inside `showScreen()`; replace `paintRungs()` with `paintGuestCount()`. |

---

### Task 1: Extract and test the guest access label

The workout-count copy is the only new logic here. Project convention (`CLAUDE.md`) is that new pure logic goes in `engine.js` and gets a test; `app.js` is untested and should not grow logic.

**Files:**
- Modify: `engine.js` (append at end of file)
- Test: `tests/engine.test.mjs` (append at end of file)

**Interfaces:**
- Consumes: nothing.
- Produces: `guestAccessLabel(total: number, free: number) -> string`. Task 5 imports this into `app.js`.

- [x] **Step 1: Write the failing test**

Append to `tests/engine.test.mjs`:

```js
test("guestAccessLabel describes a partial guest allowance", () => {
  assert.equal(guestAccessLabel(5, 2), "2 of 5 workouts");
});

test("guestAccessLabel says 'all' when the allowance covers the catalog", () => {
  assert.equal(guestAccessLabel(5, 5), "All 5 workouts");
  assert.equal(guestAccessLabel(5, 9), "All 5 workouts");
});

test("guestAccessLabel uses the singular for a one-workout allowance", () => {
  assert.equal(guestAccessLabel(5, 1), "1 of 5 workouts");
  assert.equal(guestAccessLabel(1, 1), "All 1 workout");
});

test("guestAccessLabel handles an empty catalog without producing junk", () => {
  assert.equal(guestAccessLabel(0, 2), "No workouts");
});

test("guestAccessLabel clamps a negative allowance to none", () => {
  assert.equal(guestAccessLabel(5, -1), "0 of 5 workouts");
});
```

Add `guestAccessLabel` to the existing import list at the top of `tests/engine.test.mjs`. Open the file, find the `import { ... } from "../engine.js";` line, and add the name to it.

- [x] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `guestAccessLabel is not a function` (or a SyntaxError about the missing export).

- [x] **Step 3: Write the minimal implementation**

Append to `engine.js`:

```js
// Welcome-screen copy for how much of the catalog a path unlocks. Pure so it can be
// tested; app.js feeds it WORKOUTS.length and GUEST_FREE.
export function guestAccessLabel(total, free) {
  const t = Math.max(0, total | 0);
  const f = Math.min(Math.max(0, free | 0), t);
  if (t === 0) return "No workouts";
  const noun = t === 1 ? "workout" : "workouts";
  return f >= t ? "All " + t + " " + noun : f + " of " + t + " " + noun;
}
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — 65 tests, 0 failures.

- [x] **Step 5: Commit**

```bash
git add engine.js tests/engine.test.mjs
git commit -m "feat(auth): add guestAccessLabel for welcome-screen catalog copy"
```

---

### Task 2: Scope the light theme to the welcome screen

This task delivers the theme switch with the *old* markup still in place. Doing it first means Task 3 can be reviewed as a pure markup change, and a reviewer can reject the theming without rejecting the layout.

**Files:**
- Modify: `index.html` (the `<body>` tag; the fonts `<link>` at line ~42; the `theme-color` meta at line ~36)
- Modify: `styles.css` (insert a new block after the `#screen-welcome{ --accent: var(--brand); }` line)
- Modify: `app.js` (`showScreen()`, lines 641-645)

**Interfaces:**
- Consumes: nothing.
- Produces: the `body.auth-light` contract — `showScreen("welcome")` adds the class, every other screen removes it. Tasks 3 and 4 write markup and CSS that assume it.

- [x] **Step 1: Add Barlow 700 to the font request**

The heading needs Barlow at weight 700; the current URL loads only 500 and 600. In `index.html`, find the fonts `<link>` and change `family=Barlow:wght@500;600` to `family=Barlow:wght@500;600;700`. The full line becomes:

```html
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Barlow+Condensed:wght@500;600;700&family=Barlow:wght@500;600;700&display=swap" rel="stylesheet">
```

No CSP change is needed — `fonts.googleapis.com` is already in `style-src`.

- [x] **Step 2: Make the welcome screen light by default in the markup**

The welcome screen is what boots in the common case (`CLAUDE.md`: "Welcome screen always shows on normal boot" — this is deliberate, do not change it). Starting the body light avoids a dark-to-white flash before the modules run. In `index.html`, change:

```html
<body>
```

to:

```html
<body class="auth-light">
```

A returning user with a remembered session boots straight to `live` and will see a brief white flash before `showScreen("live")` strips the class. That is the accepted trade-off — it affects returning users only, versus a flash on every fresh visit if the default were dark.

- [x] **Step 3: Add the light token block**

In `styles.css`, immediately after the line `#screen-welcome{ --accent: var(--brand); }`, insert:

```css
/* ---- Light auth theme -------------------------------------------------
   Scoped token override, toggled by showScreen() in app.js. The welcome
   screen is the only light surface in the app; everything else keeps the
   dark :root values. Do not move these into :root. ---- */
body.auth-light{
  --bg:#ffffff;
  --ink:#101322;
  --dim:#6b7280;
  --line:#e3e5ea;
  --panel:#ffffff;
  --panel2:#f6f7f9;
  --auth-cta:#101322;
  --auth-cta-ink:#ffffff;
  --auth-focus:#6f9b16;
  background:#ffffff;
  color:var(--ink);
}
/* Kill the dark page gradient and the film-grain overlay. */
body.auth-light::after{ display:none; }
```

The `background` shorthand is required: the base `body` rule sets a `radial-gradient(...), var(--bg)` background that would otherwise keep painting the dark gradient even after `--bg` flips.

- [x] **Step 4: Toggle the class from `showScreen()`**

`showScreen` is called from 14 sites. Hooking the class here rather than at each call site means the theme can never desync from the visible screen. In `app.js`, replace the function at lines 641-645:

```js
function showScreen(name) {
  activeScreen = name;
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById("screen-" + name).classList.add("active");
}
```

with:

```js
function showScreen(name) {
  activeScreen = name;
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById("screen-" + name).classList.add("active");
  // The welcome screen is the app's one light surface (see body.auth-light in
  // styles.css). Toggled here so it can never desync from the visible screen.
  const light = name === "welcome";
  document.body.classList.toggle("auth-light", light);
  const tc = document.querySelector('meta[name="theme-color"]');
  if (tc) tc.setAttribute("content", light ? "#ffffff" : "#0b0c0e");
}
```

The `theme-color` update keeps the mobile browser chrome from showing a dark bar above a white page.

- [x] **Step 5: Verify the theme switch by hand**

Run: `node --experimental-strip-types --version` is not needed; just serve the app.

```bash
npm start
```

Open `http://localhost:8000`. Expected: the welcome screen is white with dark text (the old lane cards will look wrong — that is fine, Task 4 replaces them). Click "Continue as guest". Expected: the home screen is dark again, with the grain overlay and gradient back. Click the gear, then "Sign in to sync" — expected: white again.

- [x] **Step 6: Run the tests**

Run: `npm test`
Expected: PASS — 65 tests, 0 failures. No engine logic changed.

- [x] **Step 7: Commit**

```bash
git add index.html styles.css app.js
git commit -m "feat(auth): scope a light theme to the welcome screen"
```

---

### Task 3: Rebuild the welcome markup to the reference composition

**Files:**
- Modify: `index.html` (replace the whole `#screen-welcome` section)

**Interfaces:**
- Consumes: the `body.auth-light` contract from Task 2.
- Produces: the DOM contract Task 4 styles and Task 5 wires — classes `.auth`, `.authmark`, `.authhead`, `.authsub`, `.guestbtn`, `.guestnote`, `.authsplit`, `.authform`, `.authfield`, `.remember`, `.authcta`, `.err`, `.authfoot`; IDs `guestBtn`, `guestCount`, `loginForm`, `loginEmail`, `loginPassword`, `loginRemember`, `signInBtn`, `loginError`, `welcomeUser`, `welcomeHint`.

- [x] **Step 1: Replace the section**

In `index.html`, replace the entire `<section id="screen-welcome" class="screen"> ... </section>` block (everything from that opening tag through its closing `</section>`) with:

```html
<section id="screen-welcome" class="screen">
  <div class="auth">
    <!-- The app's own mark: the timer ring with the interval dot. Inline SVG so it
         inherits the light theme and needs no img-src beyond what the CSP allows.
         Lime is deepened here because #c6f24e is invisible on white. -->
    <svg class="authmark" viewBox="0 0 48 48" role="img" aria-label="Ladder Circuit">
      <circle cx="24" cy="24" r="18" fill="none" stroke="#e3e5ea" stroke-width="5"/>
      <circle cx="24" cy="24" r="18" fill="none" stroke="#6f9b16" stroke-width="5"
              stroke-linecap="round" stroke-dasharray="85 200" transform="rotate(-90 24 24)"/>
      <circle cx="24" cy="24" r="4.5" fill="#e08a1e"/>
    </svg>

    <h1 class="authhead">Welcome back</h1>
    <p class="authsub">Color-coded interval circuits for 1&ndash;6 people.</p>
    <div id="welcomeUser" class="welcomeUser" hidden></div>

    <button class="guestbtn" id="guestBtn" type="button">Continue as guest</button>
    <p class="guestnote" id="guestCount"></p>

    <div class="authsplit"><span>or</span></div>

    <form id="loginForm" class="authform" autocomplete="on">
      <input class="authfield" id="loginEmail" type="email" placeholder="Email"
             aria-label="Email" autocomplete="username" required spellcheck="false">
      <input class="authfield" id="loginPassword" type="password" placeholder="Password"
             aria-label="Password" autocomplete="current-password" required>
      <label class="remember"><input id="loginRemember" type="checkbox"><span>Keep me signed in</span></label>
      <button class="authcta" id="signInBtn" type="submit">Continue</button>
      <div class="err" id="loginError" role="alert" hidden></div>
    </form>

    <p class="authfoot" id="welcomeHint">Accounts are created by an administrator.</p>
  </div>
</section>
```

Notes on the choices, so a reviewer can check intent:
- The reference has **no visible field labels**, only placeholders. `aria-label` on each input preserves the screen-reader name that the visible label used to provide. Do not remove them.
- `signInBtn` keeps its ID but its text is now "Continue", matching the reference. The `app.js` submit handler references the ID, not the text, so nothing breaks.
- `guestCount` is a new empty element that Task 5 fills.

- [x] **Step 2: Verify no ID was lost**

Run:

```bash
for id in loginForm loginEmail loginPassword loginRemember loginError signInBtn guestBtn welcomeUser welcomeHint guestCount; do
  printf "%-16s " "$id"; grep -c "id=\"$id\"" index.html
done
```

Expected: every line prints `1`. Any `0` means an ID was dropped and `app.js` will throw on boot.

- [x] **Step 3: Confirm the page still boots**

```bash
npm start
```

Open `http://localhost:8000`, open the browser console. Expected: no `Cannot read properties of null` errors. The layout will be unstyled and stacked — Task 4 fixes that. "Continue as guest" must still reach the home screen.

- [x] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS — 65 tests, 0 failures.

- [x] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(auth): rebuild welcome markup to the centered reference layout"
```

---

### Task 4: Style the light auth composition

**Files:**
- Modify: `styles.css` (delete the `.lane*` block from the previous pass; add the auth block)

**Interfaces:**
- Consumes: the class contract from Task 3 and the tokens from Task 2.
- Produces: no JS-facing interface.

- [x] **Step 1: Delete the superseded lane block**

In `styles.css`, find the comment banner `/* ---- Welcome / sign-in lanes ---` and delete everything from that comment down to and including the `@media (prefers-reduced-motion:reduce){ .lane,.lane-guest,.loginForm input{ transition:none; } }` rule that closes it. Those selectors (`.lane`, `.lanehead`, `.lanename`, `.lanect`, `.rungs`, `.lanesplit`, `.lane-guest`, `.loginForm`) no longer match any markup. Leaving them risks the `.loginForm` rules colliding with the new `.authform` styles.

Verify the deletion is complete:

```bash
grep -c "lane\|rungs" styles.css
```

Expected: `0`.

- [x] **Step 2: Also delete the now-dead `.welcome` rules**

The old `.welcome`, `.welcome .brand`, `.welcome .wtagline` and `.welcome .welcomeUser` rules (around lines 176-180) target a `.welcome` wrapper that Task 3 replaced with `.auth`. Delete those four rules, but **keep** the `#screen-welcome{ --accent: var(--brand); }` line and the `.accountInfo` rules that sit between them — those are still used by the settings sheet.

- [x] **Step 3: Add the auth styles**

In `styles.css`, immediately after the `body.auth-light::after{ display:none; }` rule from Task 2, insert:

```css
/* ---- Welcome / sign-in composition ------------------------------------
   Centered narrow column on plain white, no card chrome — the panel and
   border-radius language of the dark app is deliberately absent here. ---- */
.auth{ width:100%; max-width:380px; margin:0 auto; min-height:82vh;
  display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap:0; text-align:center; padding:32px 20px; }

.authmark{ width:52px; height:52px; margin-bottom:22px; }

.authhead{ font-family:'Barlow',sans-serif; font-weight:700; font-size:34px; line-height:1.1;
  letter-spacing:-.01em; color:var(--ink); }
.authsub{ font-family:'Barlow',sans-serif; font-size:14px; color:var(--dim); margin-top:9px; }
.auth .welcomeUser{ font-family:'Barlow',sans-serif; font-weight:600; font-size:14px;
  color:var(--ink); margin-top:12px; }
.auth .welcomeUser[hidden]{ display:none; }

/* Guest takes the outlined-pill slot the reference gives to Google. */
.guestbtn{ width:100%; margin-top:28px; font-family:'Barlow',sans-serif; font-weight:600; font-size:16px;
  color:var(--ink); background:#fff; border:1px solid var(--line); border-radius:999px;
  padding:15px 20px; cursor:pointer; transition:border-color .15s, background .15s; }
.guestbtn:hover{ border-color:#c8ccd4; background:#fafbfc; }
.guestbtn:active{ background:#f2f4f7; }
.guestnote{ font-family:'Barlow',sans-serif; font-size:12px; color:var(--dim); margin-top:9px; }
.guestnote:empty{ display:none; }

.authsplit{ display:flex; align-items:center; width:100%; margin:20px 0;
  font-family:'Barlow',sans-serif; font-size:13px; color:var(--dim); }
.authsplit::before,.authsplit::after{ content:""; flex:1; height:1px; background:var(--line); }
.authsplit span{ padding:0 14px; }

.authform{ display:flex; flex-direction:column; gap:11px; width:100%; }
.authfield{ font-family:'Barlow',sans-serif; font-size:16px; color:var(--ink); background:var(--panel);
  border:1px solid var(--line); border-radius:999px; padding:15px 20px; width:100%;
  transition:border-color .15s, box-shadow .15s; }
.authfield::placeholder{ color:var(--dim); }
.authfield:focus{ outline:none; border-color:var(--auth-focus);
  box-shadow:0 0 0 3px color-mix(in srgb, var(--auth-focus) 20%, transparent); }
.authfield:-webkit-autofill{ -webkit-text-fill-color:var(--ink);
  -webkit-box-shadow:0 0 0 40px #fff inset; caret-color:var(--ink); }

.authform .remember{ display:flex; align-items:center; gap:9px; cursor:pointer; padding:3px 4px;
  font-family:'Barlow',sans-serif; font-size:13px; color:var(--dim); }
.authform .remember span{ white-space:nowrap; }
.authform .remember input{ appearance:none; -webkit-appearance:none; flex:none; width:17px; height:17px;
  border:1px solid #c8ccd4; border-radius:5px; background:#fff; display:grid; place-items:center;
  cursor:pointer; margin:0; }
.authform .remember input:checked{ background:var(--auth-cta); border-color:var(--auth-cta); }
.authform .remember input:checked::after{ content:""; width:9px; height:5px; border:2px solid #fff;
  border-top:0; border-right:0; transform:translateY(-1px) rotate(-45deg); }
.authform .remember input:focus-visible{ outline:2px solid var(--auth-focus); outline-offset:2px; }

/* The one dominant action on the page. */
.authcta{ width:100%; margin-top:5px; font-family:'Barlow',sans-serif; font-weight:600; font-size:16px;
  color:var(--auth-cta-ink); background:var(--auth-cta); border:none; border-radius:999px;
  padding:16px 20px; cursor:pointer; transition:opacity .15s, transform .05s; }
.authcta:hover{ opacity:.9; }
.authcta:active{ transform:translateY(1px); }
.authcta:disabled{ opacity:.45; cursor:default; transform:none; }

.authform .err{ font-family:'Barlow',sans-serif; font-size:13px; color:#b42318; text-align:left;
  background:#fef3f2; border:1px solid #fecdc9; border-radius:12px; padding:10px 14px; }
.authform .err[hidden]{ display:none; }

.authfoot{ font-family:'Barlow',sans-serif; font-size:12px; color:var(--dim); margin-top:24px;
  line-height:1.5; }

.guestbtn:focus-visible,.authcta:focus-visible{ outline:2px solid var(--auth-focus); outline-offset:3px; }

@media (prefers-reduced-motion:reduce){
  .guestbtn,.authcta,.authfield{ transition:none; }
}
@media (max-width:380px){
  .authhead{ font-size:29px; }
  .auth{ padding:24px 16px; }
}
```

Two specificity notes, per the `CLAUDE.md` warning about selectors cancelling each other:
- `.authcta` is a **new class**, not a reuse of `button.main`. `button.main` is an element-plus-class selector with higher specificity than a bare `.authcta`, so reusing it would have meant fighting `background:var(--accent)` and `color:#0b0c0e` with `!important`. A separate class avoids that entirely.
- `.guestbtn` likewise does not reuse `button.ghost`.

- [x] **Step 4: Visually verify against the reference**

```bash
npm start
```

Open `http://localhost:8000` at a ~420px-wide window. Check each:
- Mark, heading, and subtitle are centered with generous space above the guest button.
- "Continue as guest" is a full-width outlined pill; the count sits directly under it in small grey.
- The "or" divider has hairlines running to both edges of the column.
- Both fields are full-width pills with grey placeholders.
- "Continue" is a solid near-black pill — the clear visual anchor of the page.
- "Keep me signed in" sits on one line and does not wrap.
- Tab through the whole screen: every control shows a visible green focus ring.

- [x] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS — 65 tests, 0 failures.

- [x] **Step 6: Commit**

```bash
git add styles.css
git commit -m "feat(auth): style the light centered sign-in composition"
```

---

### Task 5: Wire the guest count and verify both auth states end to end

**Files:**
- Modify: `app.js` (the `paintRungs()` function added in the previous pass, at lines ~649-663; its call site at line ~786; the `engine.js` import line near the top)

**Interfaces:**
- Consumes: `guestAccessLabel(total, free)` from Task 1; the `guestCount` element from Task 3.
- Produces: nothing downstream.

- [x] **Step 1: Import the helper**

Near the top of `app.js`, find the `import { ... } from "./engine.js";` line and add `guestAccessLabel` to the destructured list.

- [x] **Step 2: Replace `paintRungs` with `paintGuestCount`**

The rung strip is dropped per the design decision. In `app.js`, replace the whole `paintRungs` function (the comment block plus the function, added directly below the `const GUEST_FREE = 2;` line) with:

```js
// Welcome-screen copy for how much of the catalog the guest path unlocks. Driven
// from WORKOUTS/GUEST_FREE so it can never drift from what renderCatalog() locks.
function paintGuestCount() {
  const el = document.getElementById("guestCount");
  if (el) el.textContent = guestAccessLabel(WORKOUTS.length, GUEST_FREE);
}
```

Then update the call site — change the line `paintRungs();` (just below the `guestBtn` handler at line ~786) to:

```js
paintGuestCount();
```

Confirm nothing still references the old name:

```bash
grep -c "paintRungs" app.js
```

Expected: `0`.

- [x] **Step 3: Verify the guest path**

```bash
npm start
```

Open `http://localhost:8000`. Expected: the text under the guest button reads exactly **"2 of 5 workouts"**. Click the button — the home screen shows 5 cards, the first 2 startable and the last 3 showing "Sign in to unlock". The count and the lock state must agree; if they don't, `GUEST_FREE` and the label are reading different values.

- [x] **Step 4: Verify the error state**

On the welcome screen, enter `nobody@example.test` and any password, then click Continue. Expected: the button disables during the request, then a red-bordered error block appears above the footer text reading "Invalid email or password." (the server's generic message — it must not reveal which field was wrong). The layout must not jump more than the height of the error block.

- [x] **Step 5: Verify the signed-in state**

Sign in with a real account. Expected: you land on the home screen (dark), all 5 workouts unlocked. Open the gear, click "Sign in to sync" is absent — instead the account panel shows your name. Return to the welcome screen via the account panel and confirm `welcomeUser` renders "Signed in as <name>" in dark text on white, not the dark-theme `--ink` on a dark background.

- [x] **Step 6: Verify the theme never leaks**

Walk every screen once: welcome → home → customize → live → back to home. Expected: only the welcome screen is white. If any other screen renders white, `showScreen()` is not being called for that transition and the class is stuck.

- [x] **Step 7: Run the tests**

Run: `npm test`
Expected: PASS — 65 tests, 0 failures.

- [x] **Step 8: Commit**

```bash
git add app.js
git commit -m "feat(auth): show the guest catalog allowance under the guest button"
```

---

## Out of Scope

Called out so they are not silently absorbed:

- **The guest limit remains a UI nudge, not enforcement.** All 5 workouts still ship to the client in `catalog.js`, exactly as `CLAUDE.md` records. Making it real requires a server-side catalog endpoint — separate work.
- **No password reset, no self-registration.** Accounts stay admin-provisioned; the footer copy says so.
- **The rest of the app stays dark.** This plan does not introduce a light mode for home, customize, or live.
- **Pre-existing console errors are not addressed** — the `frame-ancestors`-in-`<meta>` warning and the blocked `data:` manifest both predate this work and are unrelated to it.

## Self-Review

**Spec coverage:** Light theme → Task 2. Centered column, ring mark, "Welcome back" heading → Tasks 3, 4. Guest pill above the divider → Tasks 3, 4. Email + password one screen → Task 3. Dark CTA → Task 4. Footer microcopy → Task 3. Rung strip dropped → Tasks 4 (CSS deleted), 5 (JS replaced). Workout count as plain text → Tasks 1, 5. All four settled decisions have a task.

**Placeholder scan:** No TBDs. Every code step carries the literal code to paste; every verification step names the command and the expected output.

**Type consistency:** `guestAccessLabel(total, free)` is defined in Task 1 and called with that exact signature in Task 5. `paintGuestCount()` is defined and called in Task 5. The element ID `guestCount` is created in Task 3 and read in Task 5. The class names in Task 4's CSS match Task 3's markup one-for-one. The `body.auth-light` class is written in Task 2 and consumed in Tasks 2 and 4.
