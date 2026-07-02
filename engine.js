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

export function enc(config) {
  try {
    return btoa(unescape(encodeURIComponent(JSON.stringify(config))))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  } catch (e) { return ""; }
}

export function dec(s) {
  try {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(decodeURIComponent(escape(atob(s))));
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
let DEFAULTS = { people: 2, prep: 5, theme: "Volt", volume: 0.8, targetMin: 0 };
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

export function sanitize(c) {
  c.stations = (c.stations || []).map(s => ({
    ex: (s.ex || "").trim() || "Exercise",
    gear: (s.gear || "").trim(),
    rep: (s.rep || "").trim(),
    url: (/^https?:\/\//i.test(s.url || "")) ? s.url : "",
  }));
  if (!c.stations.length) c.stations = [{ ex: "Exercise", gear: "", rep: "" }];
  c.ladder = (c.ladder || []).map(p => [
    Math.max(1, parseInt(p[0]) || 1),
    Math.max(0, parseInt(p[1]) || 0),
  ]);
  if (!c.ladder.length) c.ladder = [[30, 15]];
  c.prep = Math.max(0, Math.min(60, parseInt(c.prep) || 0));
  c.targetMin = Math.max(0, Math.min(180, parseInt(c.targetMin) || 0));
  c.volume = Math.max(0, Math.min(1, c.volume));
  c.people = clampPeople(c.people, c.stations.length);
  c.personNames = (c.personNames || []).slice(0, c.people);
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
