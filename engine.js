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
