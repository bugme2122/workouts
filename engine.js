// engine.js — pure logic, no DOM. Imported by app.js (browser) and tests (node).
export function blockLenOf(config) {
  return config.ladder.reduce((a, p) => a + p[0] + p[1], 0);
}

export function blocksFor(config) {
  const N = config.stations.length || 1;
  const bl = blockLenOf(config) || 1;
  return (config.targetMin && config.targetMin > 0)
    ? Math.max(1, Math.round(config.targetMin * 60 / bl))
    : N;
}

export function buildPhases(config) {
  const N = config.stations.length || 1;
  const LADN = config.ladder.length || 1;
  const TOTBLOCKS = blocksFor(config);
  const phases = [{ type: "prep", dur: config.prep }];
  for (let b = 0; b < TOTBLOCKS; b++) {
    for (let i = 0; i < LADN; i++) {
      phases.push({ type: "work", dur: config.ladder[i][0], block: b, iv: i });
      phases.push({ type: "rest", dur: config.ladder[i][1], block: b, iv: i });
    }
  }
  const cum = [];
  let acc = 0;
  for (let k = 0; k < phases.length; k++) {
    cum[k] = acc;
    if (phases[k].type !== "prep") acc += phases[k].dur;
  }
  return { phases, cum, total: acc, N, LADN, TOTBLOCKS };
}

// Share-link codec. The wire format is UTF-8 bytes -> binary string -> base64url, byte-identical
// to the original escape/unescape implementation, so every `#w=`/`#c=` link already in the wild
// keeps decoding (tests/sharelinks.test.mjs and engine.test.mjs pin this). Deprecated Annex-B
// escape/unescape were replaced with TextEncoder/TextDecoder; the bytes did not change.
function utf8ToBinary(str) {
  const bytes = new TextEncoder().encode(str);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}
function binaryToUtf8(bin) {
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
  return new TextDecoder().decode(bytes);
}

export function enc(config) {
  try {
    return btoa(utf8ToBinary(JSON.stringify(config)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  } catch (e) { return ""; }
}

export function dec(s) {
  try {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(binaryToUtf8(atob(s)));
  } catch (e) { return null; }
}

export function offsetFor(k, P, N) {
  return Math.round(k * N / (P || 1));
}

export function clampPeople(people, N) {
  return Math.max(1, Math.min(people || 1, Math.min(6, N)));
}

export function occupants(block, P, N) {
  const out = [];
  for (let k = 0; k < P; k++) {
    out.push({ person: k, station: ((block + offsetFor(k, P, N)) % N + N) % N });
  }
  return out;
}

// DEFAULT_CONFIG is injected by the caller (app.js) via setDefaults(); tests pass a
// literal. This keeps engine.js free of catalog data.
// NOTE: keep in sync with DEFAULT in catalog.js and the setDefaults() call in app.js — every
// field sanitize() falls back on must exist here, or a legacy/crafted config lands on `undefined`
// (GAPS #10: a missing keepAwake used to let the screen sleep mid-workout).
let DEFAULTS = {
  people: 2, prep: 5, theme: "Volt", volume: 0.8, targetMin: 0,
  voice: true, ticks: true, halfChime: true, haptics: false, keepAwake: true,
};
export function setDefaults(d) { DEFAULTS = { ...DEFAULTS, ...d }; }

export function migrate(c) {
  const src = c || {};
  const out = { ...DEFAULTS, ...src };
  if (out.mode !== undefined) {
    if (src.people === undefined) out.people = out.mode === "solo" ? 1 : 2;
    delete out.mode;
  }
  if (out.people === undefined) out.people = 2;
  if (!Array.isArray(out.personNames)) out.personNames = [];
  return out;
}

// Caps on untrusted array lengths — a share link decodes attacker-controlled JSON,
// and a giant stations/ladder array would stall the main thread building phases/DOM.
// 40 stations / 60 ladder intervals are far beyond any real workout.
const MAX_STATIONS = 40, MAX_LADDER = 60;
const BOOL_FIELDS = ["voice", "ticks", "haptics", "keepAwake", "halfChime"];

export function sanitize(c) {
  // Array.isArray, not `|| []`: a crafted config can carry a STRING here, and "x".slice()
  // returns a string whose .map is undefined — sanitize would throw instead of sanitizing.
  c.stations = (Array.isArray(c.stations) ? c.stations : []).slice(0, MAX_STATIONS).map(s0 => {
    // Coerce non-object entries (null / string / number from a crafted config) so
    // reading .ex/.gear/... can never throw a TypeError at module load.
    const s = (s0 && typeof s0 === "object") ? s0 : {};
    return {
      ex: (s.ex || "").trim() || "Exercise",
      gear: (s.gear || "").trim(),
      rep: (s.rep || "").trim(),
      url: (/^https?:\/\//i.test(s.url || "")) ? s.url : "",
    };
  });
  if (!c.stations.length) c.stations = [{ ex: "Exercise", gear: "", rep: "" }];
  c.ladder = (Array.isArray(c.ladder) ? c.ladder : []).slice(0, MAX_LADDER).map(p => {
    const pair = Array.isArray(p) ? p : [];
    return [
      Math.max(1, parseInt(pair[0]) || 1),
      Math.max(0, parseInt(pair[1]) || 0),
    ];
  });
  if (!c.ladder.length) c.ladder = [[30, 15]];
  c.prep = Math.max(0, Math.min(60, parseInt(c.prep) || 0));
  c.targetMin = Math.max(0, Math.min(180, parseInt(c.targetMin) || 0));
  // Coerce volume: "loud" -> NaN and null both fall back to the default (not NaN, not silent).
  const v = Number(c.volume);
  c.volume = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : DEFAULTS.volume;
  c.people = clampPeople(c.people, c.stations.length);
  // Coerce every name to a string so app.js personLabel()'s .trim() can never throw.
  c.personNames = (Array.isArray(c.personNames) ? c.personNames : []).slice(0, c.people)
    .map(n => typeof n === "string" ? n : "");
  // Booleans are part of the trust boundary too: a crafted config can carry voice:"yes" (truthy
  // but not a boolean) and a legacy one can omit keepAwake entirely. Coerce, defaulting when absent.
  for (const b of BOOL_FIELDS) c[b] = (c[b] === undefined) ? !!DEFAULTS[b] : !!c[b];
  return c;
}

// Per-second audio-cue decision (pure). Returns which cue(s) fire at `secLeft`
// whole seconds remaining in `phase`. app.js maps this to sound/speech.
export function secondCue(phase, secLeft) {
  const out = { speak: null, beep: false, chime: false };
  if (!phase || secLeft < 1) return out;
  const type = phase.type, dur = phase.dur || 0;
  if (type === "prep") {
    if (secLeft <= Math.min(3, dur - 1)) { out.speak = String(secLeft); out.beep = true; }
    return out;
  }
  if (type === "work" || type === "rest") {
    if (secLeft <= Math.min(5, dur - 1)) { out.speak = String(secLeft); out.beep = true; }
    if (dur >= 12 && secLeft === Math.round(dur / 2)) out.chime = true;
    return out;
  }
  return out;
}

// --- Short share-link helpers (pure) ---
export const LIGHT_FIELDS = [
  "people", "personNames", "targetMin", "theme", "prep", "volume",
  "voice", "ticks", "haptics", "keepAwake", "halfChime",
];

export function sameCircuit(a, b) {
  return JSON.stringify(a.stations) === JSON.stringify(b.stations)
      && JSON.stringify(a.ladder) === JSON.stringify(b.ladder);
}

export function lightDelta(config, base, fields = LIGHT_FIELDS) {
  const d = {};
  for (const f of fields) {
    if (JSON.stringify(config[f]) !== JSON.stringify(base[f])) d[f] = config[f];
  }
  return d;
}

export function applyLight(base, delta) {
  return { ...base, ...(delta || {}) };
}

// ===================================================================================
// Bring Your Own Workout (BYOW) — regimen@1 ingest (pure, DOM-free)
// A regimen is an uploaded, ordered list of timed segments compiled into the SAME phase array
// buildPhases() produces, so the existing loop()/secondCue()/start()/reset() run it unchanged.
// ===================================================================================
export const REGIMEN_SCHEMA = "regimen@1";
// Caps on untrusted uploads (mirror the sanitize() discipline). A giant/deeply-repeated regimen
// would stall the main thread building phases/DOM.
const MAX_SEGMENTS = 500;   // total flattened phases
const MAX_ROUNDS = 50;      // per group
const MAX_SECONDS = 3600;   // per segment
const REGIMEN_TYPES = ["work", "rest", "prep"];

// validateRegimen(obj) -> { ok:true, regimen } | { ok:false, error }. Cheap shape gate before sanitize.
export function validateRegimen(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj))
    return { ok: false, error: "That file isn't a workout object." };
  if (obj.schema !== REGIMEN_SCHEMA)
    return { ok: false, error: `Unsupported workout format — expected schema "${REGIMEN_SCHEMA}".` };
  if (typeof obj.name !== "string" || !obj.name.trim())
    return { ok: false, error: "This workout needs a name." };
  if (!Array.isArray(obj.segments) || obj.segments.length === 0)
    return { ok: false, error: "This workout needs at least one segment." };
  return { ok: true, regimen: obj };
}

// Coerce one leaf (timed) segment; never throws. rest may be 0s; work/prep floor at 1s.
function sanitizeSegment(s0) {
  const s = (s0 && typeof s0 === "object" && !Array.isArray(s0)) ? s0 : {};
  const type = REGIMEN_TYPES.includes(s.type) ? s.type : "work";
  const floor = type === "rest" ? 0 : 1;
  let secs = parseInt(s.seconds);
  if (!Number.isFinite(secs)) secs = floor;
  secs = Math.max(floor, Math.min(MAX_SECONDS, secs));
  const out = { type, seconds: secs };
  const label = (typeof s.label === "string" ? s.label : "").trim();
  const say = (typeof s.say === "string" ? s.say : "").trim();
  if (label) out.label = label;
  if (say) out.say = say;
  if (typeof s.halfway === "boolean") out.halfway = s.halfway;
  return out;
}

// sanitizeRegimen(regimen) -> regimen (coerced, capped; never throws). Preserves one level of
// group nesting; a group-inside-a-group has its nested group dropped (depth 1 only).
export function sanitizeRegimen(regimen) {
  const r = (regimen && typeof regimen === "object" && !Array.isArray(regimen)) ? regimen : {};
  const out = {
    schema: REGIMEN_SCHEMA,
    name: (typeof r.name === "string" && r.name.trim()) ? r.name.trim() : "Workout",
  };
  const d = (r.defaults && typeof r.defaults === "object") ? r.defaults : {};
  const vol = Number(d.volume);
  out.defaults = {
    prep: Math.max(0, Math.min(60, parseInt(d.prep) || 0)),
    voice: d.voice !== false,
    halfChime: d.halfChime !== false,
    volume: Number.isFinite(vol) ? Math.max(0, Math.min(1, vol)) : DEFAULTS.volume,
  };
  if (typeof d.theme === "string") out.defaults.theme = d.theme; // caller validates against THEMES

  let count = 0; // flattened footprint, capped at MAX_SEGMENTS
  const segs = [];
  for (const raw of (Array.isArray(r.segments) ? r.segments : [])) {
    if (count >= MAX_SEGMENTS) break;
    if (raw && typeof raw === "object" && raw.type === "group") {
      const rounds = Math.max(1, Math.min(MAX_ROUNDS, parseInt(raw.rounds) || 1));
      const inner = [];
      for (const g of (Array.isArray(raw.segments) ? raw.segments : [])) {
        if (g && typeof g === "object" && g.type === "group") continue; // depth 1
        inner.push(sanitizeSegment(g));
      }
      if (!inner.length) continue;
      const fitRounds = Math.min(rounds, Math.floor((MAX_SEGMENTS - count) / inner.length));
      if (fitRounds <= 0) break;
      segs.push({ type: "group", rounds: fitRounds, segments: inner });
      count += fitRounds * inner.length;
    } else {
      segs.push(sanitizeSegment(raw));
      count += 1;
    }
  }
  if (!segs.length) segs.push({ type: "work", seconds: 30, label: "Exercise" });
  out.segments = segs;
  return out;
}

// buildRegimenPhases(regimen) -> { phases, cum, total } — same shape as buildPhases().
// phases[0] is a prep phase (from defaults.prep); groups expand `rounds` times; cum excludes prep.
export function buildRegimenPhases(regimen) {
  const r = (regimen && Array.isArray(regimen.segments)) ? regimen : sanitizeRegimen(regimen);
  const prep = Math.max(0, Math.min(60, parseInt(r.defaults?.prep) || 0));
  const phases = [{ type: "prep", dur: prep }];
  const pushLeaf = (s) => {
    const ph = { type: s.type, dur: s.seconds, say: s.say || s.label || null };
    if (s.label) ph.label = s.label;
    if (typeof s.halfway === "boolean") ph.halfway = s.halfway;
    phases.push(ph);
  };
  for (const s of r.segments) {
    if (s.type === "group") {
      const rounds = Math.max(1, parseInt(s.rounds) || 1);
      for (let i = 0; i < rounds; i++) for (const g of s.segments) pushLeaf(g);
    } else {
      pushLeaf(s);
    }
  }
  const cum = [];
  let acc = 0;
  for (let k = 0; k < phases.length; k++) {
    cum[k] = acc;
    if (phases[k].type !== "prep") acc += phases[k].dur;
  }
  return { phases, cum, total: acc };
}

// Welcome-screen copy for how much of the catalog a path unlocks. Pure so it can be
// tested; app.js feeds it WORKOUTS.length and GUEST_FREE.
export function guestAccessLabel(total, free) {
  const t = Math.max(0, total | 0);
  const f = Math.min(Math.max(0, free | 0), t);
  if (t === 0) return "No workouts";
  const noun = t === 1 ? "workout" : "workouts";
  return f >= t ? "All " + t + " " + noun : f + " of " + t + " " + noun;
}

// ===================================================================================
// Boot / run-loop decisions (pure) — extracted from app.js so they can be tested (GAPS #3).
// ===================================================================================

// What a given URL hash plus "does this device already have a saved config" means for boot.
// `configSource` is the fix for GAPS #5: a stale share hash must not half-apply — a returning
// user's config comes from localStorage, never from the link they didn't choose to open.
export function decideBoot(hash, hasLocal) {
  const bootedFromShare = /^#?[wc]=/.test(hash || "");
  const freshShare = bootedFromShare && !hasLocal;
  return {
    bootedFromShare,
    freshShare,
    screen: freshShare ? "live" : "welcome",
    configSource: freshShare ? "share" : "local",
    clearHash: bootedFromShare && !freshShare,
  };
}

// Is the app quiet enough to swap the live config out from under the user (cloud sync, another
// tab's write)? Only on the two non-workout screens, with nothing running and no share deep-link.
export function isIdle({ activeScreen, running, freshShare }) {
  return !freshShare && !running && (activeScreen === "home" || activeScreen === "welcome");
}

// Advance the clock past every phase whose time has run out, carrying the negative leftover.
// Returns the phase actually landed on plus the indexes flown past. A backgrounded tab (rAF is
// paused while hidden) can miss many phases at once; the caller announces only the landing phase
// rather than firing a burst of beeps for each skipped one (GAPS #7).
export function advancePhases(phases, idx, remaining) {
  const skipped = [];
  while (remaining <= 0) {
    const leftover = remaining;
    idx++;
    if (idx >= phases.length) {
      return { idx: phases.length - 1, remaining: 0, finished: true, skipped };
    }
    remaining = phases[idx].dur * 1000 + leftover;
    if (remaining <= 0) skipped.push(idx);
  }
  return { idx, remaining, finished: false, skipped };
}

// Compact summary of a sanitized config, for landing rows and catalog cards. Derived from
// buildPhases so it can never disagree with what the timer will actually run.
export function summarizeConfig(config) {
  const r = buildPhases(config);
  return {
    totalSec: r.total,
    minutes: Math.max(1, Math.round(r.total / 60)),
    blocks: r.TOTBLOCKS,
    stations: r.N,
    intervals: r.LADN,
    people: config.people || 1,
  };
}

// Where a saved preset came from, for the "My workouts" filter. A preset that names a catalog
// workout but no longer matches its circuit was edited; anything else is just a saved setup.
export function classifyPreset(preset, baseline) {
  if (!baseline) return "saved";
  return sameCircuit(preset, baseline) ? "saved" : "edited";
}

// Distinct gear across a config's stations, in station order ("25 lb · Rope · Vest").
export function gearOf(config) {
  const seen = [];
  (config.stations || []).forEach(s => {
    const g = (s && s.gear || "").trim();
    if (g && !seen.includes(g)) seen.push(g);
  });
  return seen;
}
