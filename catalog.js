import { enc, dec, sanitize, sameCircuit, lightDelta, applyLight,
         summarizeConfig, classifyPreset } from "./engine.js";

export { sanitize };

export const YT = q => "https://www.youtube.com/results?search_query=" + encodeURIComponent(q);

export const THEMES = {
  Volt:  { work:"#c6f24e", rest:"#ffb13d", rotate:"#ff4d6d", prep:"#56d3ff" },
  Ember: { work:"#ff7a2e", rest:"#ffd23d", rotate:"#ff2e7a", prep:"#5fd0ff" },
  Ice:   { work:"#42e8ff", rest:"#8a8fff", rotate:"#ff5c8a", prep:"#bdfff0" },
  Mono:  { work:"#f1f1ea", rest:"#9aa0aa", rotate:"#ff5b5b", prep:"#6aa6ff" },
  Candy: { work:"#ff5cae", rest:"#ffe14d", rotate:"#a05cff", prep:"#4ce0ff" },
};

export const LADDERS = {
  "Descending": [[60,30],[50,25],[40,20],[30,15],[20,10]],
  "Ascending":  [[20,10],[30,15],[40,20],[50,25],[60,30]],
  "Pyramid":    [[20,10],[40,20],[60,30],[40,20],[20,10]],
  "Tabata":     [[20,10],[20,10],[20,10],[20,10],[20,10],[20,10],[20,10],[20,10]],
  "Flat 40/20": [[40,20],[40,20],[40,20],[40,20],[40,20]],
};

export const LENGTHS = [
  {label:"1 pass", min:0},{label:"15 min", min:15},{label:"20", min:20},
  {label:"30", min:30},{label:"45", min:45},{label:"60", min:60},
];

export const EXERCISES = [
  {ex:"KB Swing",         gear:"25 lb",      rep:"15 reps",       url:YT("kettlebell swing form technique")},
  {ex:"Goblet Squat",     gear:"15 lb",      rep:"15 reps",       url:YT("kettlebell goblet squat form")},
  {ex:"KB Clean & Press", gear:"25 lb",      rep:"10 · 5/arm", url:YT("kettlebell clean and press form")},
  {ex:"KB Deadlift",      gear:"25 lb",      rep:"12 reps",       url:YT("kettlebell deadlift form")},
  {ex:"KB Row",           gear:"25 lb",      rep:"10/arm",        url:YT("kettlebell bent over row form")},
  {ex:"Vest Squats",      gear:"Vest",       rep:"15 reps",       url:YT("bodyweight squat proper form")},
  {ex:"Walking Lunges",   gear:"Vest",       rep:"10/leg",        url:YT("walking lunge form")},
  {ex:"Push-ups",         gear:"Bodyweight", rep:"12–15 reps", url:YT("push up proper form")},
  {ex:"Mountain Climbers",gear:"Bodyweight", rep:"30 sec",        url:YT("mountain climbers form")},
  {ex:"Plank",            gear:"Vest",       rep:"Hold",          url:YT("forearm plank form")},
  {ex:"Plate G-to-OH",    gear:"10 lb",      rep:"12 reps",       url:YT("weight plate ground to overhead")},
  {ex:"Jump Rope",        gear:"Rope",       rep:"To time",       url:YT("jump rope basics beginners")},
];

export function howto(s){ return (s && s.url) ? s.url : YT(((s && s.ex) || "exercise") + " proper form"); }

export const DEFAULT = {
  people: 2, prep: 5,
  ladder: [[60,30],[50,25],[40,20],[30,15],[20,10]],
  stations: [
    {ex:"KB Swings",   gear:"25 lb",      rep:"15 reps",        url:YT("kettlebell swing form technique")},
    {ex:"Jump Rope",   gear:"Rope",       rep:"To time",        url:YT("jump rope basics beginners")},
    {ex:"Vest Squats", gear:"Vest",       rep:"12 reps",        url:YT("bodyweight squat proper form")},
    {ex:"Clean & Press",gear:"25 lb",     rep:"10 · 5/arm", url:YT("kettlebell clean and press form")},
    {ex:"Goblet Squats",gear:"15 lb",     rep:"15 reps",        url:YT("kettlebell goblet squat form")},
    {ex:"Push-ups",    gear:"Bodyweight", rep:"12–15 reps", url:YT("push up proper form")},
  ],
  personNames: [],
  theme: "Volt", voice: true, ticks: true, haptics: false, keepAwake: true, volume: 0.8, halfChime: true,
  targetMin: 0, workoutId: "kb-ladder",
};

// NOTE: each workout `id` must be a URL-safe slug with no "~" (it is the #w=<id> share-link key; "~" delimits the settings tail).
export const WORKOUTS = [
  {
    id: "kb-ladder", name: "Full-Body KB Ladder", category: "Strength · Descending 60→20s",
    blurb: "Six stations, one kettlebell, intervals that shrink as you tire.",
    defaultPeople: 2, ladder: LADDERS["Descending"], theme: "Volt", prep: 5, targetMin: 0,
    stations: DEFAULT.stations,
  },
  {
    id: "tabata", name: "Tabata Burner", category: "Cardio · 8× 20/10",
    blurb: "Twenty on, ten off, eight times. As short and as unpleasant as it sounds.",
    defaultPeople: 1, ladder: LADDERS["Tabata"], theme: "Ember", prep: 5, targetMin: 0,
    stations: [
      {ex:"Burpees",         gear:"Bodyweight", rep:"Max", url:YT("burpee proper form")},
      {ex:"Mountain Climbers",gear:"Bodyweight", rep:"Fast", url:YT("mountain climbers form")},
      {ex:"Jump Squats",     gear:"Bodyweight", rep:"Max", url:YT("jump squat form")},
      {ex:"High Knees",      gear:"Bodyweight", rep:"Fast", url:YT("high knees exercise form")},
    ],
  },
  {
    id: "bw-pyramid", name: "Bodyweight Pyramid", category: "No gear · 20→60→20s",
    blurb: "Climbs from 20 seconds to 60 and walks back down. Nothing to carry.",
    defaultPeople: 2, ladder: LADDERS["Pyramid"], theme: "Ice", prep: 5, targetMin: 0,
    stations: [
      {ex:"Push-ups",       gear:"Bodyweight", rep:"12–15", url:YT("push up proper form")},
      {ex:"Air Squats",     gear:"Bodyweight", rep:"20",    url:YT("air squat form")},
      {ex:"Walking Lunges", gear:"Bodyweight", rep:"10/leg",url:YT("walking lunge form")},
      {ex:"Plank",          gear:"Bodyweight", rep:"Hold",  url:YT("forearm plank form")},
      {ex:"Mountain Climbers",gear:"Bodyweight",rep:"30s",  url:YT("mountain climbers form")},
      {ex:"Jump Rope",      gear:"Rope",       rep:"To time",url:YT("jump rope basics beginners")},
    ],
  },
  {
    id: "partner-circuit", name: "Partner Circuit", category: "Strength · Descending",
    blurb: "The same ladder built for two — you rotate, they rotate, nobody waits for the bell.",
    defaultPeople: 2, ladder: LADDERS["Descending"], theme: "Candy", prep: 5, targetMin: 0,
    stations: DEFAULT.stations,
  },
  {
    id: "quick-15", name: "Quick 15", category: "Flat 40/20 · 15 min",
    blurb: "Flat 40/20 on a 15-minute cap, for the days you nearly skipped it.",
    defaultPeople: 2, ladder: LADDERS["Flat 40/20"], theme: "Mono", prep: 5, targetMin: 15,
    stations: [
      {ex:"KB Swings",   gear:"25 lb",      rep:"15", url:YT("kettlebell swing form technique")},
      {ex:"Push-ups",    gear:"Bodyweight", rep:"12", url:YT("push up proper form")},
      {ex:"Goblet Squats",gear:"15 lb",     rep:"15", url:YT("kettlebell goblet squat form")},
      {ex:"Jump Rope",   gear:"Rope",       rep:"time",url:YT("jump rope basics beginners")},
    ],
  },
];

// Build a full editable config from a catalog workout.
export function workoutToConfig(w) {
  return {
    ...DEFAULT,
    workoutId: w.id,
    people: w.defaultPeople,
    ladder: JSON.parse(JSON.stringify(w.ladder)),
    stations: JSON.parse(JSON.stringify(w.stations)),
    theme: w.theme || DEFAULT.theme,
    prep: w.prep ?? DEFAULT.prep,
    targetMin: w.targetMin ?? 0,
    personNames: [],
  };
}

// Build the sanitized baseline config for a catalog workout id (or null).
export function baselineFor(id) {
  const w = WORKOUTS.find(x => x.id === id);
  return w ? sanitize(workoutToConfig(w)) : null;
}

// Encode a config to the shortest lossless hash body (no leading '#').
export function encShare(config) {
  const base = baselineFor(config.workoutId);
  if (base && sameCircuit(config, base)) {
    const d = lightDelta(config, base);
    const tail = Object.keys(d).length ? "~" + enc(d) : "";
    return "w=" + encodeURIComponent(config.workoutId) + tail;
  }
  return "c=" + enc(config);
}

// Decode a hash body ('w=…' or 'c=…', optional leading '#') back to a config, or null.
export function decShare(str) {
  if (!str) return null;
  const body = str.replace(/^#/, "");
  if (body.startsWith("w=")) {
    const rest = body.slice(2);
    const ti = rest.indexOf("~");
    const id = decodeURIComponent(ti >= 0 ? rest.slice(0, ti) : rest);
    const delta = ti >= 0 ? (dec(rest.slice(ti + 1)) || {}) : {};
    const base = baselineFor(id) || sanitize(JSON.parse(JSON.stringify(DEFAULT)));
    return applyLight(base, delta);
  }
  if (body.startsWith("c=")) return dec(body.slice(2));
  return null;
}

// ---------------------------------------------------------------------------
// Landing page: the user's own library, assembled from what the app already stores.
// Pure — takes the three stores as data and returns rows ready to render. No DOM.
//
//   presets   ladder presets            -> "saved" or "edited" (edited = names a catalog
//                                          workout but no longer matches its circuit)
//   regimens  uploaded regimen@1 JSON   -> "uploaded"
//   pins      array of row keys         -> the pinned flag
//
// Rows are sorted pinned-first, then by name, so the list is stable between renders.
export function buildLibrary({ presets = {}, regimens = {}, pins = [] } = {}) {
  const rows = [];

  Object.keys(presets).forEach(name => {
    const cfg = sanitize(JSON.parse(JSON.stringify(presets[name])));
    const sum = summarizeConfig(cfg);
    const origin = classifyPreset(cfg, baselineFor(cfg.workoutId));
    const from = origin === "edited" ? (WORKOUTS.find(w => w.id === cfg.workoutId) || {}).name : "";
    rows.push({
      key: "preset:" + name, name, kind: "preset", origin, from,
      minutes: sum.minutes, stations: sum.stations, people: sum.people,
      ladder: cfg.ladder, pinned: pins.includes("preset:" + name),
    });
  });

  Object.keys(regimens).forEach(name => {
    const r = regimens[name] || {};
    // A regimen's "ladder", for the interval strip, is its FLATTENED work/rest pairs — groups
    // expanded, so a 3-round group draws three peaks instead of one slab. Capped so a 500-segment
    // upload can't produce a 500-bar strip.
    const ladder = [];
    regimenFlat(r).slice(0, MAX_STRIP_BARS * 2).forEach(s => {
      if (s.type === "rest" && ladder.length) ladder[ladder.length - 1][1] = s.seconds || 0;
      else if (s.type !== "rest") ladder.push([s.seconds || 1, 0]);
    });
    rows.push({
      key: "regimen:" + name, name, kind: "regimen", origin: "uploaded", from: "",
      // Count FLATTENED segments (groups expanded), the same number the live screen and the
      // upload preview show — a row saying "3 segments" for an 8-segment workout is a lie.
      minutes: Math.max(1, Math.round(regimenSeconds(r) / 60)), stations: regimenCount(r), people: 1,
      ladder: ladder.length ? ladder : [[30, 0]], pinned: pins.includes("regimen:" + name),
    });
  });

  return rows.sort((a, b) =>
    (b.pinned - a.pinned) || a.name.localeCompare(b.name));
}

// A strip past this many bars is a smear, not a shape.
const MAX_STRIP_BARS = 40;

// Leaf segments of a regimen in run order, groups expanded.
export function regimenFlat(r) {
  const walk = list => (Array.isArray(list) ? list : []).reduce((out, s) => {
    if (!s) return out;
    if (s.type === "group") {
      for (let i = 0; i < (s.rounds || 1); i++) out = out.concat(walk(s.segments));
      return out;
    }
    return out.concat(s);
  }, []);
  return walk(r.segments);
}

// Flattened leaf-segment count, groups expanded.
function regimenCount(r) {
  const walk = list => (Array.isArray(list) ? list : []).reduce((n, s) => {
    if (!s) return n;
    if (s.type === "group") return n + (s.rounds || 1) * walk(s.segments);
    return n + 1;
  }, 0);
  return walk(r.segments);
}

// Total seconds of a regimen, groups expanded. Cheap enough to run per row.
function regimenSeconds(r) {
  const walk = list => (Array.isArray(list) ? list : []).reduce((n, s) => {
    if (!s) return n;
    if (s.type === "group") return n + (s.rounds || 1) * walk(s.segments);
    return n + (s.seconds || 0);
  }, 0);
  return walk(r.segments);
}
