import {
  THEMES, LADDERS, LENGTHS, EXERCISES, DEFAULT, WORKOUTS, howto, workoutToConfig,
  encShare, decShare, buildLibrary,
} from "./catalog.js";
import {
  blockLenOf, blocksFor, buildPhases, migrate, sanitize,
  clampPeople, occupants, setDefaults, secondCue, decideBoot, isIdle, advancePhases,
  summarizeConfig, gearOf,
  validateRegimen, sanitizeRegimen, buildRegimenPhases, REGIMEN_SCHEMA,
  guestAccessLabel,
} from "./engine.js";
import * as store from "./store.js";
import * as auth from "./auth.js";

// Engine fallbacks come from the catalog's DEFAULT so the two can't drift (GAPS #10 -- a missing
// keepAwake used to read as undefined and let the screen sleep mid-workout).
setDefaults({ people: DEFAULT.people, prep: DEFAULT.prep, theme: DEFAULT.theme, volume: DEFAULT.volume, targetMin: DEFAULT.targetMin, voice: DEFAULT.voice, ticks: DEFAULT.ticks, halfChime: DEFAULT.halfChime, haptics: DEFAULT.haptics, keepAwake: DEFAULT.keepAwake });

const $ = id => document.getElementById(id);
const clone = o => JSON.parse(JSON.stringify(o));

// ---------- boot decision ----------
// Pure and unit-tested in engine.js (decideBoot). Computed before loadConfig() because it decides
// WHERE the config comes from: a share hash is honored only for a genuine recipient (no local
// state). For a returning user the hash is stale, and reading it into `config` anyway used to let
// the next persist() overwrite their own saved workout (GAPS #5).
const boot = decideBoot(location.hash, !!store.local.loadConfig());
const bootedFromShare = boot.bootedFromShare, freshShare = boot.freshShare;

// ---------- config persistence ----------
function loadConfig(){
  if(boot.configSource === "share"){
    const body=(location.hash||"").replace(/^#/,"");
    const c=decShare(body); if(c) return sanitize(migrate(c));
  }
  const c=store.local.loadConfig(); if(c) return sanitize(migrate(c));
  return sanitize(clone(DEFAULT));
}
function persist(){
  store.local.saveConfig(config);
  // Note: the URL hash is NOT written here — normal use keeps a clean URL so the
  // welcome/home flow shows. A share link is produced only via "Copy shareable link".
  cloudSaveConfig(config);
}
function getPresets(){ return store.local.loadPresets(); }
function setPresets(o){ store.local.savePresets(o); cloudSavePresets(store.mergePresets(o, getRegimenPresets(), getPins())); refreshLandingIfVisible(); }
// BYOW persistence (PR-1/PR-2/PR-3): the active regimen and regimen presets, namespaced away
// from ladder presets. Guests persist to localStorage; signed-in users ride the same cloud doc.
function persistRegimen(){ store.local.saveRegimen(activeRegimen); }
function getRegimenPresets(){ return store.local.loadRegimenPresets(); }
function setRegimenPresets(o){ store.local.saveRegimenPresets(o); cloudSavePresets(store.mergePresets(getPresets(), o, getPins())); refreshLandingIfVisible(); }
// Landing-page pins. Stored beside the presets and carried in the same cloud document under
// their own reserved key, so a pin follows you between devices.
function getPins(){ return store.local.loadPins(); }
function setPins(a){ store.local.savePins(a); cloudSavePresets(store.mergePresets(getPresets(), getRegimenPresets(), a)); }

// Saving or deleting a preset from the settings sheet changes what the lobby lists; keep the
// two in step without making the setters know anything else about the landing screen.
function refreshLandingIfVisible(){ if(activeScreen === "landing") renderLanding(); }

let cloud=null, authUser=null, _cfgSaveT=null;
let _authInited=false;
let activeScreen="";
// Sync health, surfaced as a dot on the identity chip (GAPS #6). Cloud failures still degrade to
// local-only -- the timer never breaks -- but they are no longer invisible to the user or to the
// console. "ok" = last write succeeded, "err" = it failed, "" = nothing written yet this session.
let _syncState = "";
function noteSync(ok, what, e){
  _syncState = ok ? "ok" : "err";
  if(!ok) console.warn("cloud " + what + " failed", e);
  paintSyncDot();
}
function paintSyncDot(){
  paintLandingSync();
  document.querySelectorAll(".idchip .syncdot").forEach(d=>{
    d.className = "syncdot" + (_syncState ? " " + _syncState : "");
    d.title = _syncState==="err" ? "Last cloud sync failed \u2014 changes are saved on this device"
            : _syncState==="ok"  ? "Synced" : "";
  });
}
function cloudSaveConfig(c){
  if(!cloud) return;
  clearTimeout(_cfgSaveT);
  _cfgSaveT=setTimeout(()=>{
    if(cloud) cloud.saveConfig(c).then(()=>noteSync(true,"config")).catch(e=>noteSync(false,"config save",e));
  }, 1200);
}
function cloudSavePresets(o){
  if(cloud) cloud.savePresets(o).then(()=>noteSync(true,"presets")).catch(e=>noteSync(false,"preset save",e));
}

async function connectAuth(){
  if(_authInited) return;
  _authInited=true;
  try{ await auth.initAuth(onAuthChange); }
  catch(e){ _authInited=false; }
}
async function onAuthChange(u){
  const wasSignedIn = !!authUser;
  authUser=u;
  if(u){
    try{
      cloud = store.cloudBackend();
      let cloudCfg=null, cloudAt=0;
      try{ const st=await cloud.loadState(); cloudCfg=st.config; cloudAt=st.updatedAt; }
      catch(e){ noteSync(false,"config load",e); }
      // Newest-wins, not cloud-always-wins: signing in on a device with fresher local edits must
      // not silently replace them with a stale cloud snapshot (GAPS #1).
      const dec = store.decideMigration(store.local.loadConfig(), cloudCfg,
        { localAt: store.local.configUpdatedAt(), cloudAt });
      const idle = isIdle({ activeScreen, running, freshShare });
      if(dec.action==="use-cloud"){
        const cfg=sanitize(migrate(dec.config));
        store.local.saveConfig(cfg);                 // always cache the cloud copy locally
        if(idle){ config=cfg; applyTheme(config.theme); build(); setupView(); reset(); }
      } else if(dec.action==="upload-local"){
        const cfg=sanitize(migrate(dec.config));
        try{ await cloud.saveConfig(cfg); noteSync(true,"config"); }catch(e){ noteSync(false,"config save",e); }
        if(idle){ config=cfg; applyTheme(config.theme); build(); setupView(); reset(); }
      }
      // presets: MERGE, never replace. The cloud copy wins on a name collision, but presets made
      // locally since the last sync survive and are pushed back up (GAPS #1). The one cloud
      // document carries both ladder presets and the namespaced regimen presets, so split/merge
      // around the transfer.
      try{
        const cp=await cloud.loadPresets();
        const split=store.splitPresets(cp || {});
        const ladder = store.mergePresetMaps(store.local.loadPresets(), split.ladder);
        const regimens = store.mergePresetMaps(store.local.loadRegimenPresets(), split.regimens);
        const pins = store.mergePins(store.local.loadPins(), split.pins);
        store.local.savePresets(ladder);
        store.local.saveRegimenPresets(regimens);
        store.local.savePins(pins);
        const merged=store.mergePresets(ladder, regimens, pins);
        if(Object.keys(merged).length){ await cloud.savePresets(merged); noteSync(true,"presets"); }
      }catch(e){ noteSync(false,"preset sync",e); }
    }catch(e){ noteSync(false,"sync",e); /* keep local config on any cloud error */ }
  } else {
    clearTimeout(_cfgSaveT); cloud=null; _syncState="";
    // On an actual sign-out (was signed in), return to the welcome/sign-in screen.
    // Welcome is the app's only light surface; if the settings sheet is open (e.g. sign-out
    // triggered from Account > Sign out inside the sheet) it must be closed first, or its
    // hardcoded-dark .sheetcard is left floating over the now-light body with unreadable
    // (var(--ink) is light-mode dark-on-dark) text. closeSettings() is a no-op if already closed.
    if(wasSignedIn){ closeSettings(); showScreen("welcome"); }
  }
  updateAccountUI(authUser);
  if(activeScreen==="landing") renderLanding();
}

let config = loadConfig();

// ---------- derived / phases ----------
const RING_C = 2*Math.PI*108;
let phases=[], cum=[], WORKOUT_TOTAL=0, N=0, LADN=0, TOTBLOCKS=0;
// Signature of everything that determines person-card / big-circuit CONTENT (not the
// per-frame ring/countdown). Recomputed only when the config changes, so render()'s
// list renderers can cheaply detect "nothing changed" and skip a full DOM rebuild.
let _contentSig = "";
// BYOW: which phase source is live. "ladder" = the circuit engine (buildPhases); "regimen" = an
// uploaded regimen@1 (buildRegimenPhases). Both emit the same {phases,cum,total} shape, so the
// clock (loop/start/reset/secondCue) runs either one unchanged — only the *views* differ.
let activeKind = "ladder", activeRegimen = null;
function build(){
  if (activeKind === "regimen" && activeRegimen) {
    const r = buildRegimenPhases(activeRegimen);
    phases = r.phases; cum = r.cum; WORKOUT_TOTAL = r.total;
    N = 0; LADN = 0; TOTBLOCKS = 0;
    _contentSig = JSON.stringify(["regimen", activeRegimen.name, phases.length]);
    return;
  }
  const r = buildPhases(config);
  phases = r.phases; cum = r.cum; WORKOUT_TOTAL = r.total;
  N = r.N; LADN = r.LADN; TOTBLOCKS = r.TOTBLOCKS;
  _contentSig = JSON.stringify([config.people, config.stations, config.personNames]);
}

// Adopt an uploaded regimen as the live workout. Seeds the run's knobs from defaults (theme only
// when it names a known THEMES key, per UR-4/SR-3), then rebuilds phases through the normal path.
function adoptRegimen(regimen){
  activeRegimen = sanitizeRegimen(regimen);
  activeKind = "regimen";
  // Only the knobs the shared clock/audio actually read at runtime. `prep` is deliberately NOT
  // copied — buildRegimenPhases takes it from the regimen's own defaults, and writing it here
  // would leak the regimen's lead-in into the user's saved ladder config.
  const d = activeRegimen.defaults || {};
  config.voice = d.voice;
  config.halfChime = d.halfChime;
  config.volume = d.volume;
  if (d.theme && THEMES[d.theme]) config.theme = d.theme;
  applyTheme(config.theme);
  persistRegimen();
}
// Return to the ladder circuit as the phase source.
function adoptLadder(){ activeKind = "ladder"; activeRegimen = null; }

// ---------- audio / voice / haptics ----------
let actx=null;
function ensureAudio(){ try{ if(!actx) actx=new (window.AudioContext||window.webkitAudioContext)(); if(actx.state==="suspended") actx.resume(); }catch(e){ actx=null; } }
function tone(freq,start,dur,vol,type){
  if(!actx) return;
  const o=actx.createOscillator(), g=actx.createGain();
  o.type=type||"square"; o.frequency.value=freq; o.connect(g); g.connect(actx.destination);
  const t=actx.currentTime+start, v=(vol||0.25)*config.volume;
  g.gain.setValueAtTime(0.0001,t); g.gain.linearRampToValueAtTime(Math.max(0.0001,v),t+0.012);
  g.gain.exponentialRampToValueAtTime(0.0001,t+dur); o.start(t); o.stop(t+dur+0.03);
}
const sWork=()=>{tone(660,0,.12,.32);tone(990,.10,.20,.32);};
const sRest=()=>{tone(420,0,.26,.26,"sine");};
const sRotate=()=>{tone(523,0,.14,.30);tone(659,.14,.14,.30);tone(880,.28,.34,.34);};
const sTick=()=>{ if(config.ticks) tone(1568,0,.05,.16,"sine"); };
const sDone=()=>{[523,659,784,1047].forEach((f,i)=>tone(f,i*.13,.34,.30,"triangle"));};
// speechSynthesis.cancel() is deliberate and global: a cue must never queue behind a stale one
// (a backed-up queue would announce "3" during the next interval). It can clip other page/OS
// utterances, which is the accepted trade for cue timing.
function say(t){ try{ if(!config.voice||config.volume<=0||!window.speechSynthesis) return; speechSynthesis.cancel(); const u=new SpeechSynthesisUtterance(t); u.volume=config.volume; u.rate=1.12; u.pitch=1; speechSynthesis.speak(u);}catch(e){} }
function buzz(p){ try{ if(config.haptics&&navigator.vibrate) navigator.vibrate(p);}catch(e){} }

// ---------- wake lock ----------
let wake=null;
async function acquireWake(){ try{ if(config.keepAwake&&"wakeLock" in navigator){ wake=await navigator.wakeLock.request("screen"); } }catch(e){} }
function releaseWake(){ try{ if(wake){ wake.release(); wake=null; } }catch(e){} }
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState!=="visible" || !running) return;
  acquireWake();
  // rAF was paused while hidden; charge the elapsed wall-clock time and repaint immediately so the
  // returning user sees the true position instead of a stale frame (GAPS #7).
  const now=performance.now(); remaining-=(now-last); last=now;
  if(remaining<=0){
    const adv=advancePhases(phases, idx, remaining);
    idx=adv.idx; remaining=adv.remaining; cueSec=null;
    if(adv.finished){ finished=true; running=false; releaseWake(); sDone(); say("Workout complete"); render(); showComplete(); return; }
    enterPhase(phases[idx], phases[idx].type==="work"&&phases[idx].iv===0);
  }
  render();
});

// ---------- state ----------
let idx=0, remaining=0, running=false, finished=false, last=0, cueSec=null, rafId=null;

// ---------- elements ----------
const elPhase=$("phase"),elNum=$("num"),elIv=$("ivlabel"),elTot=$("tot"),elProg=$("progbar"),
  elRing=$("ring"),elTcard=$("tcard"),elRot=$("rotban"),elBlk=$("blklab"),elLad=$("ladlab"),elElap=$("elap"),
  elDots=$("dots"),
  btnStart=$("startbtn"),btnReset=$("resetbtn");

function fmt(s){ s=Math.max(0,Math.round(s)); const m=Math.floor(s/60),r=s%60; return m+":"+String(r).padStart(2,"0"); }
function applyTheme(name){ const t=THEMES[name]||THEMES.Volt; const r=document.documentElement.style;
  r.setProperty("--work",t.work); r.setProperty("--rest",t.rest); r.setProperty("--rotate",t.rotate); r.setProperty("--prep",t.prep); }
function accentVar(p,rot){ if(finished) return "var(--work)"; if(p.type==="prep") return "var(--prep)"; if(p.type==="work") return "var(--work)"; return rot?"var(--rotate)":"var(--rest)"; }

function renderDots(){ let h=""; for(let i=0;i<LADN;i++) h+="<i></i>"; elDots.innerHTML=h; }
function setupView(){
  const reg = activeKind === "regimen";
  // Regimen mode is a single shared track: no ladder dots, no per-person legend (v1 decision 2).
  document.getElementById("screen-live").classList.toggle("regimen-mode", reg);
  if (reg) {
    elLad.textContent = (phases.length - 1) + " segments";
    elDots.innerHTML = "";
    const lg = document.getElementById("legend"); if (lg) lg.innerHTML = "";
    return;
  }
  elLad.textContent = config.ladder.map(x=>x[0]).join("·")+"s";
  renderDots();
  renderLegend();
}

function personLabel(k){
  return (config.personNames && config.personNames[k] && config.personNames[k].trim())
    ? config.personNames[k].trim() : "P"+(k+1);
}

// Cache keys: the displayed block + content signature fully determine each list's DOM.
// Content changes only a few times per workout (block rotation / config edit), so we
// early-return on the ~60fps render() calls in between — avoiding teardown+rebuild churn
// and letting the .rotate-flash CSS pulse actually progress instead of restarting at 0%.
let _pcardKey = null, _bigKey = null;
function renderPersonCards(block){
  const host = document.getElementById("personCards");
  const key = block + "|" + _contentSig;
  if (_pcardKey === key) return;
  _pcardKey = key;
  const occ = occupants(block, config.people, N);
  host.innerHTML = "";
  occ.forEach(o=>{
    const s = config.stations[o.station];      // o.station already wrapped — F1 safe
    const card = document.createElement("div");
    card.className = "pcard";
    card.style.setProperty("--person", "var(--p"+(o.person+1)+")");
    card.innerHTML =
      '<div class="stnum">'+(o.station+1)+'</div>'+
      '<div class="who" style="color:var(--person)">'+esc(personLabel(o.person))+'</div>'+
      '<div class="ex">'+esc(s.ex || "—")+'</div>'+
      '<div class="meta"><span class="tag gear">'+esc(s.gear || "")+'</span>'+
      '<span class="tag">'+esc(s.rep || "")+'</span></div>';
    host.appendChild(card);
  });
}

function renderBigCircuit(block) {
  const host = document.getElementById("bigCircuit");
  if (!host) return;
  const key = block + "|" + _contentSig;
  if (_bigKey === key) return;
  _bigKey = key;
  const occ = occupants(block, config.people, N);
  const byStation = {};
  occ.forEach(o => { byStation[o.station] = o.person; });
  host.innerHTML = "";
  for (let i = 0; i < N; i++) {
    const s = config.stations[i];
    const person = byStation[i];
    const lit = person !== undefined;
    const row = document.createElement("div");
    row.className = "st" + (lit ? " lit" : "");
    if (lit) row.style.background = "var(--p" + (person + 1) + ")";
    row.innerHTML =
      '<span class="num">' + (i + 1) + '</span>' +
      '<span class="nm">' + esc(s.ex || "—") + '</span>' +
      (lit ? '<span class="who">' + esc(personLabel(person)) + '</span>' : '<span class="who"></span>') +
      '<span class="rep">' + esc(s.rep || "") + '</span>';
    host.appendChild(row);
  }
}

function renderLegend() {
  const el = document.getElementById("legend");
  if (!el) return;
  let h = "";
  for (let k = 0; k < config.people; k++) {
    h += '<span><i style="background:var(--p' + (k + 1) + ')"></i>' + esc(personLabel(k)) + '</span>';
  }
  el.innerHTML = h;
}

// BYOW live view (UR-3 option A): current segment label, big countdown, and "up next".
// Deliberately separate from the ladder view — a regimen has no stations, people, or rotation,
// so reusing renderPersonCards/renderBigCircuit would mean faking station-shaped data.
function renderRegimenView(p){
  const secLeft = finished?0:Math.ceil(remaining/1000);
  document.documentElement.style.setProperty("--accent", accentVar(p,false));
  elNum.textContent = finished?"✓":secLeft;

  const segNo = idx;                       // phases[0] is prep, so idx doubles as the segment number
  const segTot = phases.length - 1;
  if(finished){ elPhase.textContent="Complete"; elIv.textContent="nice work"; }
  else if(p.type==="prep"){ elPhase.textContent=running?"Get ready":"Tap to start"; elIv.textContent=segTot+" segments · "+fmt(WORKOUT_TOTAL); }
  else {
    elPhase.textContent = p.label || (p.type==="work"?"Work":"Rest");
    elIv.textContent = "segment "+segNo+" of "+segTot;
  }

  const denom = p.dur*1000;
  const frac = (finished||denom<=0)?0:Math.max(0,Math.min(1,remaining/denom));
  elRing.setAttribute("stroke-dashoffset",(RING_C*(1-frac)).toFixed(1));
  elTcard.classList.toggle("urgent", !finished&&running&&(p.type==="work"||p.type==="rest")&&secLeft<=3);
  elRot.classList.remove("show");

  // "Up next" — user strings via textContent only (SR-4).
  const host = document.getElementById("regimenNext");
  if(host){
    const nx = phases[idx+1];
    host.textContent = (finished||!nx) ? "" : "Next: " + (nx.label || (nx.type==="work"?"Work":"Rest")) + " · " + nx.dur + "s";
  }

  const elapsed = cum[idx] + (p.type==="prep"?0:(p.dur - remaining/1000));
  const e = finished?WORKOUT_TOTAL:Math.max(0,Math.min(WORKOUT_TOTAL,elapsed));
  elElap.textContent=fmt(e);
  elTot.textContent= finished?"Done":fmt(WORKOUT_TOTAL-e);
  elProg.style.width=(100*e/(WORKOUT_TOTAL||1)).toFixed(1)+"%";
  elBlk.textContent=(p.type==="prep"&&!finished)?("— / "+segTot):(segNo+" / "+segTot);

  btnStart.textContent = finished?"Restart":(running?"Pause":(idx===0&&Math.abs(remaining-phases[0].dur*1000)<1?"Start":"Resume"));
}

function render(){
  const p=phases[idx]; if(!p) return;
  if(activeKind==="regimen") return renderRegimenView(p);
  let disp = (p.block!==undefined)?p.block:0, rot=false;
  if(p.type==="rest" && p.iv===LADN-1 && p.block<TOTBLOCKS-1){ disp=p.block+1; rot=true; }
  document.documentElement.style.setProperty("--accent", accentVar(p,rot));

  const secLeft = finished?0:Math.ceil(remaining/1000);
  elNum.textContent = finished?"✓":secLeft;

  if(finished){ elPhase.textContent="Complete"; elIv.textContent="nice work"; }
  else if(p.type==="prep"){ elPhase.textContent=running?"Get ready":"Tap to start"; elIv.textContent=config.stations.length+" stations · "+fmt(WORKOUT_TOTAL); }
  else { elPhase.textContent = p.type==="work"?"Work":(rot?"Rotate":"Rest"); elIv.textContent = config.ladder[p.iv][0]+"s on · "+config.ladder[p.iv][1]+"s off"; }

  // Guard the divide: prep:0 makes p.dur*1000===0, so remaining/0 would be NaN
  // (0/0) for one frame and produce a NaN stroke-dashoffset. Treat 0-duration as frac 0.
  const denom = p.dur*1000;
  const frac = (finished||denom<=0)?0:Math.max(0,Math.min(1,remaining/denom));
  elRing.setAttribute("stroke-dashoffset",(RING_C*(1-frac)).toFixed(1));
  elTcard.classList.toggle("urgent", !finished&&running&&(p.type==="work"||p.type==="rest")&&secLeft<=3);

  const dots=elDots.children;
  for(let i=0;i<dots.length;i++){ dots[i].className=""; if(p.type==="prep"||finished) continue; if(i<p.iv) dots[i].className="done"; else if(i===p.iv) dots[i].className="on"; }

  elRot.classList.toggle("show", rot);

  renderPersonCards(disp);
  renderBigCircuit(disp);
  document.querySelectorAll("#personCards .pcard").forEach(c=>c.classList.toggle("rotate-flash", rot));

  const elapsed = cum[idx] + (p.type==="prep"?0:(p.dur - remaining/1000));
  const e = finished?WORKOUT_TOTAL:Math.max(0,Math.min(WORKOUT_TOTAL,elapsed));
  elElap.textContent=fmt(e);
  elTot.textContent= finished?"Done":fmt(WORKOUT_TOTAL-e);
  elProg.style.width=(100*e/(WORKOUT_TOTAL||1)).toFixed(1)+"%";
  elBlk.textContent=(p.type==="prep"&&!finished)?("— / "+TOTBLOCKS):((p.block+1)+" / "+TOTBLOCKS);

  btnStart.textContent = finished?"Restart":(running?"Pause":(idx===0&&Math.abs(remaining-phases[0].dur*1000)<1?"Start":"Resume"));
}

function enterPhase(p,firstWorkOfBlock){
  // BYOW (FR-9): a regimen segment announces its own `say` (falling back to `label`, then the
  // type word). Sounds/haptics are the ladder ones, reused verbatim.
  if(activeKind==="regimen"){
    if(p.type==="work"){ sWork(); buzz([50,40,80]); }
    else if(p.type==="rest"){ sRest(); buzz([120]); }
    else return;
    say(p.say || p.label || (p.type==="work"?"Work":"Rest"));
    return;
  }
  if(p.type==="work"){ sWork(); buzz([50,40,80]);
    if(p.block===0&&p.iv===0){ say("Go"); }
    else if(config.people===1&&firstWorkOfBlock){ const st=occupants(p.block,1,N)[0].station; say(config.stations[st].ex); }
    else say("Work"); }
  else if(p.type==="rest"){ const rot=(p.iv===LADN-1&&p.block<TOTBLOCKS-1); if(rot){ sRotate(); buzz([80,50,80,50,160]); say("Rotate. Switch stations."); } else { sRest(); buzz([120]); say("Rest"); } }
}

function loop(){
  if(!running) return;
  const now=performance.now(); remaining-=(now-last); last=now;
  const p=phases[idx]; const secLeft=Math.ceil(remaining/1000);
  if(secLeft>=1&&secLeft!==cueSec){
    cueSec=secLeft;
    const cue=secondCue(p, secLeft);
    if(cue.beep) sTick();
    if(cue.speak) say(cue.speak);
    // Per-segment halfway override (FR-8): a regimen segment may set halfway:false/true;
    // otherwise fall back to the global setting.
    const wantChime = (typeof p.halfway === "boolean") ? p.halfway : config.halfChime;
    if(cue.chime && wantChime) say("Halfway");
  }
  if(remaining<=0){
    // A hidden tab pauses rAF, so one frame can land many phases later. Wall-clock accounting is
    // exact, but announcing every phase flown past fired a burst of beeps/speech -- cue only the
    // phase actually landed on (GAPS #7).
    const adv=advancePhases(phases, idx, remaining);
    idx=adv.idx; remaining=adv.remaining; cueSec=null;
    if(adv.finished){ finished=true; running=false; releaseWake(); sDone(); say("Workout complete"); render(); showComplete(); return; }
    const np=phases[idx]; enterPhase(np, np.type==="work"&&np.iv===0);
  }
  render(); rafId=requestAnimationFrame(loop);
}
function start(){
  ensureAudio();
  if(finished) reset();
  if(running){ running=false; if(rafId) cancelAnimationFrame(rafId); releaseWake(); render(); return; }
  running=true; last=performance.now(); cueSec=null; acquireWake();
  if(idx===0 && phases[0].type==="prep") say("Get ready");
  render(); rafId=requestAnimationFrame(loop);
}
function reset(){ running=false; finished=false; if(rafId) cancelAnimationFrame(rafId); releaseWake(); idx=0; remaining=phases[0].dur*1000; cueSec=null; render();
  $("doneCard").hidden = true; elTcard.style.display = ""; }

function showComplete() {
  const card = $("doneCard");
  const sum = $("doneSum");
  if (activeKind === "regimen") {
    sum.innerHTML =
      "<b>" + fmt(WORKOUT_TOTAL) + "</b> total · <b>" + (phases.length - 1) + "</b> segments · " +
      esc(activeRegimen ? activeRegimen.name : "Workout");
    card.hidden = false;
    elTcard.style.display = "none";
    return;
  }
  const who = config.people === 1 ? "solo" : (config.people + " people");
  sum.innerHTML =
    "<b>" + fmt(WORKOUT_TOTAL) + "</b> total · <b>" + TOTBLOCKS + "</b> blocks · <b>" +
    N + "</b> stations · " + who;
  card.hidden = false;
  elTcard.style.display = "none"; // hide the ring card
}
$("doneRestart").addEventListener("click", () => {
  $("doneCard").hidden = true;
  elTcard.style.display = "";
  reset(); showScreen("home");
});

btnStart.addEventListener("click",start);
btnReset.addEventListener("click",reset);
elTcard.addEventListener("click",start);

// ================= SETTINGS =================
const sheet=$("sheet"); let draft=null; let sheetFromCustomize=false;

function openSettings(){ if(running) start(); sheetFromCustomize=false; draft=clone(config); fillSettings(); sheet.classList.add("open"); }
function closeSettings(){ sheet.classList.remove("open"); }

function fillSettings(){
  $("prepInput").value=draft.prep;
  $("volInput").value=Math.round(draft.volume*100);
  document.querySelectorAll(".sw-toggle").forEach(t=>{ t.classList.toggle("on", !!draft[t.dataset.tog]); });
  renderThemes(); renderLengthSeg(); renderLadderSeg(); renderStationRows(); renderLadderRows(); renderPresets(); updateLenHint();
  byowClearError(); renderByowActive();
  $("linkOut").classList.remove("show");
}
function lenSummary(c){
  const n=c.stations.length||1, bl=blockLenOf(c)||1, blocks=blocksFor(c), total=blocks*bl;
  let note = blocks>n ? " (cycling)" : (blocks<n ? " (not all stations reached)" : "");
  return "≈ "+fmt(total)+" · "+blocks+" blocks of "+fmt(bl)+" · "+n+" stations"+note;
}
function updateLenHint(){ const el=$("lenHint"); if(el) el.textContent=lenSummary(draft); }
function renderLengthSeg(){ const c=$("lenSeg"); c.innerHTML="";
  LENGTHS.forEach(L=>{ const b=document.createElement("button"); b.textContent=L.label;
    if(draft.targetMin===L.min) b.className="sel";
    b.onclick=()=>{ draft.targetMin=L.min; renderLengthSeg(); updateLenHint(); }; c.appendChild(b); });
}
function ladderMatch(){ const s=JSON.stringify(draft.ladder); for(const k in LADDERS){ if(JSON.stringify(LADDERS[k])===s) return k; } return null; }
function renderLadderSeg(){ const c=$("ladSeg"); c.innerHTML=""; const cur=ladderMatch();
  Object.keys(LADDERS).forEach(name=>{ const b=document.createElement("button"); b.textContent=name; if(cur===name) b.className="sel";
    b.onclick=()=>{ draft.ladder=clone(LADDERS[name]); renderLadderRows(); renderLadderSeg(); updateLenHint(); }; c.appendChild(b); });
  if(!cur){ const s=document.createElement("span"); s.className="hint"; s.style.alignSelf="center"; s.textContent="Custom"; c.appendChild(s); }
}
function renderThemes(){ const row=$("themeRow"); row.innerHTML="";
  Object.keys(THEMES).forEach(name=>{ const t=THEMES[name]; const b=document.createElement("div");
    b.className="sw"+(draft.theme===name?" sel":""); b.title=name;
    b.style.background="linear-gradient(135deg,"+t.work+" 0 50%,"+t.rest+" 50% 100%)";
    b.onclick=()=>{ draft.theme=name; applyTheme(name); renderThemes(); }; row.appendChild(b); });
}
function stRow(s,i){
  const d=document.createElement("div"); d.className="stcard";
  let opts='<option value="">Quick-pick exercise…</option>';
  EXERCISES.forEach((e,j)=>{ opts+='<option value="'+j+'">'+esc(e.ex)+' · '+esc(e.gear)+'</option>'; });
  d.innerHTML='<div class="rtop">'+
      '<span class="grip">'+(i+1)+'</span>'+
      '<select class="fld pick">'+opts+'</select>'+
      '<a class="howto" target="_blank" rel="noopener" title="How to do this">?</a>'+
      '<button class="minibtn up">&#9650;</button><button class="minibtn dn">&#9660;</button><button class="minibtn rm">&times;</button>'+
    '</div>'+
    '<div class="rfields">'+
      '<input class="fld ex" placeholder="Exercise" value="'+esc(s.ex)+'">'+
      '<input class="fld gr" placeholder="Gear" value="'+esc(s.gear)+'">'+
      '<input class="fld rp" placeholder="Reps" value="'+esc(s.rep)+'">'+
    '</div>';
  const pick=d.querySelector(".pick"), howtoA=d.querySelector(".howto");
  const [ex,gr,rp]=d.querySelectorAll(".rfields input");
  howtoA.href=howto(s);
  pick.onchange=()=>{ const j=pick.value; if(j!==""){ const e=EXERCISES[+j]; draft.stations[i]={ex:e.ex,gear:e.gear,rep:e.rep,url:e.url}; renderStationRows(); } };
  ex.oninput=()=>{ draft.stations[i].ex=ex.value; draft.stations[i].url=""; howtoA.href=howto(draft.stations[i]); };
  gr.oninput=()=>draft.stations[i].gear=gr.value;
  rp.oninput=()=>draft.stations[i].rep=rp.value;
  d.querySelector(".up").onclick=()=>{ if(i>0){ const a=draft.stations; [a[i-1],a[i]]=[a[i],a[i-1]]; renderStationRows(); } };
  d.querySelector(".dn").onclick=()=>{ const a=draft.stations; if(i<a.length-1){ [a[i+1],a[i]]=[a[i],a[i+1]]; renderStationRows(); } };
  d.querySelector(".rm").onclick=()=>{ if(draft.stations.length>1){ draft.stations.splice(i,1); renderStationRows(); } };
  return d;
}
function renderStationRows(){ const L=$("stationList"); L.innerHTML=""; draft.stations.forEach((s,i)=>L.appendChild(stRow(s,i))); updateLenHint(); }
function ladRow(pair,i){
  const d=document.createElement("div"); d.className="ladrow";
  d.innerHTML='<span class="ilab">Int '+(i+1)+'</span>'+
    '<input class="fld num w" type="number" min="1" max="600" value="'+pair[0]+'"><span class="unit">on</span>'+
    '<input class="fld num r" type="number" min="0" max="600" value="'+pair[1]+'"><span class="unit">off</span>'+
    '<button class="minibtn rm" style="margin-left:auto">&times;</button>';
  const w=d.querySelector(".w"), r=d.querySelector(".r");
  w.oninput=()=>{ draft.ladder[i][0]=Math.max(1,parseInt(w.value)||1); renderLadderSeg(); updateLenHint(); };
  r.oninput=()=>{ draft.ladder[i][1]=Math.max(0,parseInt(r.value)||0); renderLadderSeg(); updateLenHint(); };
  d.querySelector(".rm").onclick=()=>{ if(draft.ladder.length>1){ draft.ladder.splice(i,1); renderLadderRows(); } };
  return d;
}
function renderLadderRows(){ const L=$("ladderList"); L.innerHTML=""; draft.ladder.forEach((p,i)=>L.appendChild(ladRow(p,i))); renderLadderSeg(); updateLenHint(); }
function renderPresets(){ const L=$("presetList"); const ps=getPresets(); L.innerHTML="";
  const names=Object.keys(ps);
  if(!names.length){ L.innerHTML='<div class="hint">No saved presets yet.</div>'; return; }
  names.forEach(n=>{ const d=document.createElement("div"); d.className="presetrow";
    d.innerHTML='<span class="pn">'+esc(n)+'</span><button class="minibtn load" style="width:auto;padding:0 12px">Load</button><button class="minibtn del">&times;</button>';
    // Presets are semi-trusted (another device, an older schema, a cloud round-trip), so a load
    // goes through the same trust boundary as every other config source (GAPS #8). Clone first --
    // migrate/sanitize both mutate their argument, and `ps` is the stored map.
    d.querySelector(".load").onclick=()=>{ draft=sanitize(migrate(clone(ps[n]))); applyTheme(draft.theme); fillSettings(); };
    d.querySelector(".del").onclick=()=>{ const o=getPresets(); delete o[n]; setPresets(o); renderPresets(); };
    L.appendChild(d); });
}
// Escapes both quote styles, so an attribute built with single quotes is safe too (GAPS #15).
function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }

// settings events
document.querySelectorAll(".gearbtn").forEach(b=>{ b.onclick=openSettings; });
$("closeS").onclick=()=>{ if(sheetFromCustomize){ closeSettings(); applyTheme(draft.theme); } else { applyTheme(config.theme); closeSettings(); } };
$("addStation").onclick=()=>{ draft.stations.push({ex:"New exercise",gear:"",rep:""}); renderStationRows(); };
$("addInterval").onclick=()=>{ const lastp=draft.ladder[draft.ladder.length-1]||[30,15]; draft.ladder.push([lastp[0],lastp[1]]); renderLadderRows(); };
$("prepInput").oninput=e=>draft.prep=parseInt(e.target.value)||0;
$("volInput").oninput=e=>draft.volume=(parseInt(e.target.value)||0)/100;
document.querySelectorAll(".sw-toggle").forEach(t=>{ t.onclick=()=>{ draft[t.dataset.tog]=!draft[t.dataset.tog]; t.classList.toggle("on",draft[t.dataset.tog]); }; });
$("savePreset").onclick=()=>{ const nm=($("presetName").value||"").trim(); if(!nm) return;
  // Guard the reserved namespace so a ladder preset can never shadow the regimen bucket.
  if(nm===store.REGIMEN_NS){ return; }
  const o=getPresets(); o[nm]=sanitize(clone(draft)); setPresets(o); $("presetName").value=""; renderPresets(); };
$("resetDefault").onclick=()=>{ draft=clone(DEFAULT); applyTheme(draft.theme); fillSettings(); };

// ---------- BYOW: import / preview / adopt / export / presets ----------
// The uploaded file is untrusted: guarded JSON.parse -> validateRegimen -> sanitizeRegimen,
// and every user string reaches the DOM via textContent (SR-4). Nothing is adopted until the
// user confirms in the preview (UR-2); a rejection leaves the current workout untouched (SR-6).
let byowPending = null;

function byowError(msg){
  const e=$("byowErr"); e.textContent=msg; e.hidden=false;
  $("byowPrev").hidden=true; byowPending=null;
}
function byowClearError(){ $("byowErr").hidden=true; $("byowErr").textContent=""; }

// Total seconds + flattened segment count of a sanitized regimen, for the preview card.
function byowSummary(r){
  const built=buildRegimenPhases(r);
  const rounds=r.segments.reduce((n,s)=>n+(s.type==="group"?s.rounds:0),0);
  return { segments: built.phases.length-1, total: built.total, rounds };
}

function byowIngest(text){
  byowClearError();
  let obj;
  try{ obj=JSON.parse(text); }
  catch(e){ return byowError("That file isn't valid JSON."); }
  const v=validateRegimen(obj);
  if(!v.ok) return byowError(v.error);
  const r=sanitizeRegimen(v.regimen);
  byowPending=r;
  const s=byowSummary(r);
  $("byowPrevTitle").textContent=r.name;
  $("byowPrevMeta").textContent =
    s.segments+" segments · "+fmt(s.total)+" total"+(s.rounds?(" · "+s.rounds+" repeated rounds"):"");
  $("byowPrev").hidden=false;
}

function byowReadFile(file){
  if(!file) return;
  const fr=new FileReader();
  fr.onload=()=>byowIngest(String(fr.result||""));
  fr.onerror=()=>byowError("Couldn't read that file.");
  fr.readAsText(file);
}

// Reflect the active regimen (name + preset/export controls) in the sheet.
function renderByowActive(){
  const on = activeKind==="regimen" && !!activeRegimen;
  $("byowActive").hidden=!on;
  if(on) $("byowActiveLab").textContent='Running: "'+activeRegimen.name+'"';
  renderByowPresets();
}

function renderByowPresets(){
  const L=$("byowPresetList"); if(!L) return;
  const ps=getRegimenPresets(); L.innerHTML="";
  Object.keys(ps).forEach(n=>{
    const d=document.createElement("div");
    d.className="presetrow";
    d.innerHTML='<span class="pn"></span><button class="minibtn load" style="width:auto;padding:0 10px">Load</button>'+
                '<button class="minibtn del" style="width:auto;padding:0 10px">Delete</button>';
    d.querySelector(".pn").textContent=n;            // user string -> textContent (SR-4)
    d.querySelector(".load").onclick=()=>{ byowAdopt(sanitizeRegimen(ps[n])); };
    d.querySelector(".del").onclick=()=>{ const o=getRegimenPresets(); delete o[n]; setRegimenPresets(o); renderByowPresets(); };
    L.appendChild(d);
  });
}

// Adopt a regimen as the live workout and rebuild through the normal path.
function byowAdopt(r){
  adoptRegimen(r);
  build(); setupView(); reset();
  byowPending=null; $("byowPrev").hidden=true; $("byowPaste").value="";
  renderByowActive();
  closeSettings(); showScreen("live"); ensureAudio();
}

$("byowPick").onclick=()=>$("byowFile").click();
$("byowFile").onchange=e=>{ byowReadFile(e.target.files&&e.target.files[0]); e.target.value=""; };
$("byowLoadPaste").onclick=()=>{ const t=($("byowPaste").value||"").trim(); if(!t) return byowError("Paste some JSON first."); byowIngest(t); };
$("byowCancel").onclick=()=>{ byowPending=null; $("byowPrev").hidden=true; byowClearError(); };
$("byowUse").onclick=()=>{ if(byowPending) byowAdopt(byowPending); };
$("byowBackToLadder").onclick=()=>{ adoptLadder(); persistRegimen(); build(); setupView(); reset(); renderByowActive(); };
$("byowSavePreset").onclick=()=>{
  const nm=($("byowPresetName").value||"").trim();
  if(!nm||!activeRegimen) return;
  const o=getRegimenPresets(); o[nm]=activeRegimen; setRegimenPresets(o);
  $("byowPresetName").value=""; renderByowPresets();
};
// FR-12: export the active regimen as a .json file (the upload/edit/re-upload loop).
$("byowExport").onclick=()=>{
  if(!activeRegimen) return;
  const blob=new Blob([JSON.stringify(activeRegimen,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  a.download=(activeRegimen.name||"workout").replace(/[^a-z0-9._-]+/gi,"-").toLowerCase()+".json";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
};
$("copyLink").onclick=()=>{ const link=location.origin+location.pathname+"#"+encShare(sanitize(clone(draft)));
  const out=$("linkOut"); out.textContent=link; out.classList.add("show");
  try{ navigator.clipboard.writeText(link).then(()=>{ $("copyLink").textContent="✓ Link copied"; setTimeout(()=>{$("copyLink").innerHTML="&#128279; Copy shareable link";},1600); }); }catch(e){}
};
$("applyBtn").onclick=()=>{
  if(sheetFromCustomize){
    draft.people=clampPeople(draft.people, draft.stations.length);
    draft.personNames=draft.personNames.slice(0, draft.people);
    applyTheme(draft.theme);
    closeSettings();
    renderPeoplePicker(); renderNameList(); renderCustLen(); renderCustomizeSummaries();
  } else {
    config=sanitize(clone(draft)); applyTheme(config.theme); persist(); build(); setupView(); reset(); closeSettings();
  }
};

// ================= SCREENS / CATALOG =================
function showScreen(name) {
  activeScreen = name;
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById("screen-" + name).classList.add("active");
  // Welcome and the landing lobby are the app's light surfaces (see body.auth-light in
  // styles.css). Toggled here, in exactly one place, so it can never desync from the
  // visible screen. The timer and the catalog stay dark.
  const light = name === "welcome" || name === "landing";
  document.body.classList.toggle("auth-light", light);
  const tc = document.querySelector('meta[name="theme-color"]');
  if (tc) tc.setAttribute("content", light ? "#ffffff" : "#0b0c0e");
}

// Guests can use the first N workouts; the rest show a sign-in nudge.
// NOTE: this is a NUDGE, NOT SECURITY (GAPS #9). The whole catalog ships to the client in
// catalog.js, the lock is a CSS class, and decShare() has no lock check -- a `#w=<id>` link opens
// any workout as a guest. Real gating would require serving catalog content from the API.
const GUEST_FREE = 2;

// Welcome-screen copy for how much of the catalog the guest path unlocks. Driven
// from WORKOUTS/GUEST_FREE so it can never drift from what renderCatalog() locks.
function paintGuestCount() {
  const el = document.getElementById("guestCount");
  if (el) el.textContent = guestAccessLabel(WORKOUTS.length, GUEST_FREE);
}
function renderCatalog() {
  const stack = document.getElementById("catalogStack");
  if (!stack) return;
  stack.innerHTML = "";
  const signedIn = !!authUser;
  WORKOUTS.forEach((w, i) => {
    const locked = !signedIn && i >= GUEST_FREE;
    const card = document.createElement("div");
    card.className = "wcard" + (locked ? " locked" : "");
    const mins = estimateMinutes(workoutToConfig(w));
    card.innerHTML =
      '<div class="wtop"><div><div class="wname">' + esc(w.name) + (locked ? ' <span class="lock">🔒</span>' : '') + '</div>' +
      '<div class="wtag">' + esc(w.category) + '</div></div>' +
      '<div class="wdur">~' + mins + ' min</div></div>' +
      '<div class="exmini">' + w.stations.map(s => '<span>' + esc(s.ex) + '</span>').join("") + '</div>' +
      (locked
        ? '<div class="wfoot"><button class="go unlock">Sign in to unlock</button></div>'
        : '<div class="wfoot"><button class="cust">Customize</button><button class="go">Start ▸</button></div>');
    if (locked) {
      card.querySelector(".unlock").onclick = () => showScreen("welcome");
    } else {
      card.querySelector(".cust").onclick = () => openCustomize(w);
      card.querySelector(".go").onclick = () => { config = sanitize(workoutToConfig(w)); persist(); startLive(); };
    }
    stack.appendChild(card);
  });
}

function estimateMinutes(cfg) {
  const r = buildPhases(cfg);
  return Math.round(r.total / 60);
}

// ================= CUSTOMIZE =================
function openCustomize(workout) {
  draft = sanitize(workout ? workoutToConfig(workout) : clone(DEFAULT));
  applyTheme(draft.theme);
  $("custTitle").textContent = workout ? workout.name : "Custom workout";
  renderPeoplePicker(); renderNameList(); renderCustLen(); renderCustomizeSummaries();
  showScreen("customize");
}

function renderPeoplePicker() {
  const row = $("peopleRow");
  const maxP = Math.min(6, draft.stations.length);
  row.innerHTML = "";
  for (let n = 1; n <= 6; n++) {
    const b = document.createElement("div");
    b.className = "pp pp" + n + (n <= draft.people ? " on" : "") + (n > maxP ? " disabled" : "");
    b.textContent = n;
    if (n <= maxP) b.onclick = () => { draft.people = n; draft.personNames = draft.personNames.slice(0, n); renderPeoplePicker(); renderNameList(); };
    row.appendChild(b);
  }
}

function renderNameList() {
  const list = $("nameList");
  list.innerHTML = "";
  for (let k = 0; k < draft.people; k++) {
    const wrap = document.createElement("div");
    wrap.className = "nrow";
    wrap.innerHTML = '<span class="dot" style="background:var(--p' + (k + 1) + ')"></span>' +
      '<input placeholder="Person ' + (k + 1) + ' name (optional)">';
    const input = wrap.querySelector("input");
    input.value = draft.personNames[k] || "";
    input.oninput = () => { draft.personNames[k] = input.value; };
    list.appendChild(wrap);
  }
}

function renderCustLen() {
  const c = $("custLenSeg");
  c.innerHTML = "";
  LENGTHS.forEach(L => {
    const b = document.createElement("button");
    b.textContent = L.label;
    if (draft.targetMin === L.min) b.className = "on";
    b.onclick = () => { draft.targetMin = L.min; renderCustLen(); };
    c.appendChild(b);
  });
}

function renderCustomizeSummaries() {
  const n = draft.stations.length;
  $("custStationCount").textContent = n + (n === 1 ? " station" : " stations");
  $("custLadder").textContent = draft.ladder.map(x => x[0]).join("·") + "s";
  const snd = [draft.voice ? "Voice" : null, draft.ticks ? "Beeps" : null, draft.halfChime ? "Halfway" : null, draft.haptics ? "Haptics" : null].filter(Boolean).join(" · ") || "Silent";
  $("custThemeSound").textContent = draft.theme + " · " + snd;
}

function openCustomizeEditor() { sheetFromCustomize = true; fillSettings(); sheet.classList.add("open"); }

$("goBtn").onclick = () => { config = sanitize(clone(draft)); persist(); startLive(); };
$("custBack").onclick = () => showScreen("home");
$("custEditStations").onclick = openCustomizeEditor;
$("custEditTheme").onclick = openCustomizeEditor;
$("buildOwn").onclick = () => { if(!authUser){ showScreen("welcome"); return; } openCustomize(null); };


// ================= LANDING (the lobby) =================
// Everything here renders from what the app already stores: the active config, saved ladder
// presets, uploaded regimens, and the pinned list. There is no session history yet, so the
// hero shows the setup you would start right now rather than inventing a "last run".
let lpFilter = "all";

function goLanding(){ showScreen("landing"); renderLanding(); }

// Draw one interval strip into `el`. Width is proportional to seconds so a rest reads as a real
// pause; work-bar HEIGHT is the seconds on, which is what makes a descending ladder look like
// stairs and a Tabata look like a picket fence.
function drawStrip(el, ladder){
  const lad = (Array.isArray(ladder) && ladder.length) ? ladder : [[30,15]];
  const total = lad.reduce((a,p)=>a+p[0]+p[1],0) || 1;
  const maxOn = Math.max(...lad.map(p=>p[0])) || 1;
  el.innerHTML = "";
  lad.forEach((p,i)=>{
    const w = document.createElement("div");
    w.className = "work";
    w.style.flex = p[0]/total;
    w.style.height = Math.round(30 + 70*(p[0]/maxOn)) + "%";
    w.style.animationDelay = (i*40) + "ms";
    el.appendChild(w);
    if(p[1] > 0){
      const r = document.createElement("div");
      r.className = "rest";
      r.style.flex = p[1]/total;
      el.appendChild(r);
    }
  });
}

// Name of whatever is loaded right now: an adopted regimen, a catalog workout, or a custom circuit.
function activeName(){
  if(activeKind==="regimen" && activeRegimen) return activeRegimen.name;
  const w = WORKOUTS.find(x => x.id === config.workoutId);
  return w ? w.name : "Your custom circuit";
}
function activeBlurb(){
  if(activeKind==="regimen" && activeRegimen) return "An uploaded workout. It runs on the same clock and cues as everything else.";
  const w = WORKOUTS.find(x => x.id === config.workoutId);
  if(w && w.blurb) return w.blurb;
  return "Built here — your stations, your ladder, your people.";
}

function renderLandingHero(){
  const reg = activeKind==="regimen" && activeRegimen;
  const built = reg ? buildRegimenPhases(activeRegimen) : null;
  const sum = reg ? null : summarizeConfig(config);
  const mins = reg ? Math.max(1, Math.round(built.total/60)) : sum.minutes;
  const people = reg ? 1 : sum.people;

  $("lpResumeWhen").textContent = reg
    ? "Loaded now · uploaded workout · " + mins + " min"
    : "Loaded now · " + mins + " min · " + (people===1 ? "solo" : people + " people");
  $("lpResumeName").textContent = activeName();
  $("lpResumeBlurb").textContent = activeBlurb();

  const ladder = reg
    ? (buildLibrary({ regimens: { [activeRegimen.name]: activeRegimen } })[0] || {}).ladder
    : config.ladder;
  drawStrip($("lpResumeStrip"), ladder);
  $("lpStripNote").textContent = reg
    ? (built.phases.length - 1) + " segments, start to finish"
    : "one block, then everyone rotates a station";

  // Cap the gear list: past three items it stops being scannable and starts being a paragraph.
  const allGear = reg ? [] : gearOf(config);
  const gear = allGear.length > 3 ? allGear.slice(0, 3).concat("+" + (allGear.length - 3) + " more") : allGear;
  const foot = reg
    ? ["<span><b>" + (built.phases.length - 1) + "</b> segments</span>"]
    : [
        "<span><b>" + sum.stations + "</b> station" + (sum.stations===1 ? "" : "s") + "</span>",
        "<span><b>" + sum.intervals + "</b> interval" + (sum.intervals===1 ? "" : "s") + " per block</span>",
        "<span><b>" + sum.blocks + "</b> block" + (sum.blocks===1 ? "" : "s") + "</span>",
        gear.length ? "<span>" + esc(gear.join(" · ")) + "</span>" : "",
      ];
  $("lpResumeFoot").innerHTML = foot.filter(Boolean).join("");
}

function renderLandingMine(){
  const rows = buildLibrary({ presets: getPresets(), regimens: getRegimenPresets(), pins: getPins() });
  const counts = {
    all: rows.length,
    pinned: rows.filter(r => r.pinned).length,
    saved: rows.filter(r => r.origin==="saved").length,
    uploaded: rows.filter(r => r.origin==="uploaded").length,
    edited: rows.filter(r => r.origin==="edited").length,
  };
  const LABELS = { all:"All", pinned:"Pinned", saved:"Saved setups", uploaded:"Uploaded", edited:"Edited by me" };
  const nav = $("navMineCount"); if(nav) nav.textContent = counts.all ? String(counts.all) : "";

  // Only offer a filter that would return something, so a chip never leads to an empty list.
  const keys = counts.all ? ["all","pinned","saved","uploaded","edited"].filter(k => k==="all" || counts[k]) : [];
  if(!keys.includes(lpFilter)) lpFilter = "all";
  // One chip is not a filter: hide the row until there is something to narrow down.
  $("lpFilters").innerHTML = keys.length < 2 ? "" : keys.map(k =>
    '<button data-f="' + k + '" aria-pressed="' + (k===lpFilter) + '">' + LABELS[k] + " " + counts[k] + "</button>").join("");
  $("lpFilters").querySelectorAll("button").forEach(b => {
    b.onclick = () => { lpFilter = b.dataset.f; renderLandingMine(); };
  });

  const host = $("lpMine");
  const list = rows.filter(r => lpFilter==="all" ? true : lpFilter==="pinned" ? r.pinned : r.origin===lpFilter);
  if(!list.length){
    host.innerHTML = '<div class="lpempty"><b>Nothing saved yet.</b>' +
      "Customize any workout and save the setup — it shows up here, on every device you sign in on.</div>";
    return;
  }
  const ORIGIN = { saved:"Saved", uploaded:"Uploaded", edited:"Edited" };
  host.innerHTML = list.map((r,i) =>
    '<div class="lprow">' +
      '<div>' +
        '<div class="nm">' +
          '<button class="lppin" data-i="' + i + '" aria-pressed="' + r.pinned + '" ' +
            'aria-label="' + (r.pinned ? "Unpin " : "Pin ") + esc(r.name) + '" title="' + (r.pinned ? "Unpin" : "Pin") + '">' +
            (r.pinned ? "&#9679;" : "&#9675;") + "</button>" +
          '<span class="t">' + esc(r.name) + "</span>" +
          '<span class="lporigin">' + ORIGIN[r.origin] + "</span>" +
        "</div>" +
        '<div class="meta"><b>' + r.minutes + "</b> min · <b>" + r.stations + "</b> " +
          (r.kind==="regimen" ? (r.stations===1 ? "segment" : "segments") : (r.stations===1 ? "station" : "stations")) +
          (r.kind==="regimen" ? "" : " · " + (r.people===1 ? "solo" : "<b>" + r.people + "</b> people")) +
          (r.from ? " · from " + esc(r.from) : "") + "</div>" +
      "</div>" +
      '<div class="strip sm" data-i="' + i + '" aria-hidden="true"></div>' +
      '<button class="go" data-i="' + i + '">Start</button>' +
    "</div>").join("");

  host.querySelectorAll(".strip").forEach(el => drawStrip(el, list[+el.dataset.i].ladder));
  host.querySelectorAll(".lppin").forEach(b => {
    b.onclick = () => {
      const row = list[+b.dataset.i];
      const pins = getPins();
      setPins(pins.includes(row.key) ? pins.filter(k => k !== row.key) : pins.concat(row.key));
      renderLandingMine();
    };
  });
  host.querySelectorAll(".go").forEach(b => {
    b.onclick = () => startFromLibrary(list[+b.dataset.i]);
  });
}

// Start a row from "My workouts". Presets go through the same trust boundary as every other
// config source; uploaded regimens go through validate + sanitize the same way an upload does.
function startFromLibrary(row){
  if(row.kind==="regimen"){
    const r = getRegimenPresets()[row.name];
    if(!r) return;
    adoptRegimen(sanitizeRegimen(clone(r)));
    build(); setupView(); reset();
    renderByowActive();
    showScreen("live"); ensureAudio();
    return;
  }
  const p = getPresets()[row.name];
  if(!p) return;
  adoptLadder(); persistRegimen();
  config = sanitize(migrate(clone(p)));
  applyTheme(config.theme); persist();
  build(); setupView(); reset();
  showScreen("live"); ensureAudio();
}

function renderLandingTeasers(){
  const signedIn = !!authUser;
  // Three that are not already the loaded workout, so the lobby never suggests what you have open.
  const picks = WORKOUTS.filter(w => w.id !== config.workoutId).slice(0, 3);
  const nav = $("navCatCount"); if(nav) nav.textContent = String(WORKOUTS.length);
  $("lpTeasers").innerHTML = picks.map((w,i) => {
    const locked = !signedIn && WORKOUTS.indexOf(w) >= GUEST_FREE;
    const sum = summarizeConfig(sanitize(workoutToConfig(w)));
    return '<button class="lpteaser" data-i="' + i + '">' +
      '<div class="strip sm" data-i="' + i + '" aria-hidden="true"></div>' +
      "<h3>" + esc(w.name) + (locked ? ' <span class="lock">&#128274;</span>' : "") + "</h3>" +
      '<p class="blurb">' + esc(w.blurb || w.category) + "</p>" +
      '<div class="tmeta">' + sum.minutes + " min · " + sum.stations + " stations" +
        (locked ? " · sign in to unlock" : "") + "</div>" +
    "</button>";
  }).join("");
  $("lpTeasers").querySelectorAll(".strip").forEach(el =>
    drawStrip(el, workoutToConfig(picks[+el.dataset.i]).ladder));
  $("lpTeasers").querySelectorAll(".lpteaser").forEach(b => {
    b.onclick = () => {
      const w = picks[+b.dataset.i];
      if(!authUser && WORKOUTS.indexOf(w) >= GUEST_FREE){ showScreen("welcome"); return; }
      openCustomize(w);
    };
  });
}

function paintLandingSync(){
  const note = $("lpSyncNote"), who = $("lpWho");
  if(!note || !who) return;
  if(authUser){
    const first = ((authUser.firstName || authUser.email || "Account").trim().split(/\s+/)[0]) || "Account";
    who.innerHTML = '<span class="av">' + esc((first[0]||"?").toUpperCase()) + "</span>" +
      "<span>" + esc(first) + '</span><span class="st' + (_syncState==="err" ? " err" : "") + '"></span>';
    note.textContent = _syncState==="err"
      ? "Last sync failed — your workouts are saved on this device."
      : "Saved to your account. Your workouts follow you to any device you sign in on.";
  } else {
    who.innerHTML = '<span class="av">?</span><span>Guest</span>';
    note.textContent = "Guest mode — everything is saved on this device only.";
  }
}

function renderLanding(){
  const first = authUser ? ((authUser.firstName || "").trim().split(/\s+/)[0]) : "";
  $("lpGreet").textContent = first ? "Ready when you are, " + first + "." : "Ready when you are.";
  const rows = buildLibrary({ presets: getPresets(), regimens: getRegimenPresets(), pins: getPins() });
  $("lpSub").innerHTML = rows.length
    ? "<b>" + rows.length + "</b> workout" + (rows.length===1 ? "" : "s") + " of your own, plus <b>" +
      WORKOUTS.length + "</b> in the catalog."
    : "Nothing saved yet — start from the catalog and keep whatever setup works.";
  renderLandingHero();
  renderLandingMine();
  renderLandingTeasers();
  paintLandingSync();
}

// Nav. "Today" is the page you are on; the rest go where their names say.
$("navToday").onclick = () => { window.scrollTo({top:0, behavior:"instant"}); };
$("navMine").onclick = () => { document.getElementById("lpMineH").scrollIntoView({block:"start"}); };
$("navCatalog").onclick = () => showScreen("home");
$("navSounds").onclick = () => openSettings();
$("navAccount").onclick = () => { authUser ? openAcctMenu() : showScreen("welcome"); };
$("lpAllWorkouts").onclick = () => showScreen("home");
$("homeBack").onclick = () => goLanding();
// Leaving a live workout pauses it rather than letting cues fire from a screen you can't see.
// The paused position is still there when you come back.
$("liveBack").onclick = () => { if(running) start(); goLanding(); };
$("lpStart").onclick = () => { build(); setupView(); reset(); showScreen("live"); ensureAudio(); };
$("lpChange").onclick = () => {
  if(activeKind==="regimen"){ openSettings(); return; }
  const w = WORKOUTS.find(x => x.id === config.workoutId);
  // Customize edits a draft; seed it from the live config so "change setup" means this setup.
  openCustomize(w || null);
  draft = sanitize(clone(config));
  renderPeoplePicker(); renderNameList(); renderCustLen(); renderCustomizeSummaries();
};

// ---------- init ----------
// `boot` was decided at the top of this file (engine.decideBoot, unit-tested). A stale share hash
// is cleared; EVERY normal load shows the welcome/sign-in gate -- no silent auto-login.
if (boot.clearHash) {
  try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
}
// BYOW: restore a previously adopted regimen so it survives a reload. A `#w=`/`#c=` share link
// explicitly asks for a ladder workout, so it wins over the saved regimen.
if (!bootedFromShare) {
  const savedRegimen = store.local.loadRegimen();
  if (savedRegimen) { activeRegimen = sanitizeRegimen(savedRegimen); activeKind = "regimen"; }
}
applyTheme(config.theme);
// Note: the catalog is rendered by updateAccountUI(null) at the end of boot, so no
// separate renderCatalog() call is needed here (it would be a redundant double render).
if (boot.screen === "live") {
  showScreen("live"); build(); setupView(); reset();
} else {
  showScreen("welcome");
}

// ---------- cross-tab sync (GAPS #12) ----------
// Two tabs each hold their own in-memory config; without this neither learns about the other's
// change and the next write silently wins. Adopt a sibling tab's config only while idle -- never
// mid-workout -- which is the same rule cloud sync uses.
window.addEventListener("storage", (ev) => {
  if (ev.key !== "ladder.last" || !ev.newValue) return;
  if (!isIdle({ activeScreen, running, freshShare })) return;
  if (activeKind === "regimen") return;
  try {
    const incoming = sanitize(migrate(JSON.parse(ev.newValue)));
    if (JSON.stringify(incoming) === JSON.stringify(config)) return;
    config = incoming; applyTheme(config.theme); build(); setupView(); reset();
  } catch (e) { console.warn("cross-tab config reload failed", e); }
});

document.getElementById("guestBtn").onclick = () => { goLanding(); };
paintGuestCount();

// Email/password sign-in. Accounts are admin-provisioned (no self-registration). Errors are shown
// inline; the server returns a generic "Invalid email or password." so we don't leak which was wrong.
const loginForm = document.getElementById("loginForm");
if(loginForm) loginForm.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const email = (document.getElementById("loginEmail").value || "").trim();
  const password = document.getElementById("loginPassword").value || "";
  const remember = !!document.getElementById("loginRemember").checked;
  const errEl = document.getElementById("loginError");
  const btn = document.getElementById("signInBtn");
  if(errEl){ errEl.hidden = true; errEl.textContent = ""; }
  if(btn) btn.disabled = true;
  try {
    await connectAuth();               // wire auth (idempotent) so onAuthChange drives cloud sync
    await auth.login(email, password, remember);
    const pw = document.getElementById("loginPassword"); if(pw) pw.value = "";
    goLanding();
  } catch (e) {
    if(errEl){ errEl.textContent = (e && e.message) ? e.message : "Sign in failed."; errEl.hidden = false; }
  } finally {
    if(btn) btn.disabled = false;
  }
});

// Entering live from the catalog/customize always means the ladder circuit — leaving a
// previously adopted regimen behind (it stays saved under its own key).
function startLive() { adoptLadder(); persistRegimen(); build(); setupView(); reset(); showScreen("live"); ensureAudio(); }

function updateIdChips(u){
  const chips = document.querySelectorAll(".idchip");
  if(u){
    const first = ((u.firstName || u.email || "Account").trim().split(/\s+/)[0]) || "Account";
    const av = '<span class="av">'+esc((first[0]||"?").toUpperCase())+'</span>';
    chips.forEach(c=>{ c.innerHTML = av+'<span class="nm">'+esc(first)+'</span><span class="syncdot"></span>'; c.hidden=false; c.onclick=openAcctMenu; });
    paintSyncDot();
  } else {
    chips.forEach(c=>{ c.hidden=true; c.onclick=null; });
  }
}
// Account dropdown: opened from the identity chip; shows email + sign out.
function openAcctMenu(e){
  if(e && e.stopPropagation) e.stopPropagation();
  if(!authUser) return;
  const menu = document.getElementById("acctMenu");
  if(!menu) return;
  const nm = document.getElementById("amName"), em = document.getElementById("amEmail");
  if(nm) nm.textContent = [authUser.firstName, authUser.lastName].filter(Boolean).join(" ") || authUser.email || "Account";
  if(em) em.textContent = authUser.email || "";
  menu.hidden = false;
}
function closeAcctMenu(){ const m=document.getElementById("acctMenu"); if(m) m.hidden=true; }
// Shared account actions, wired from both the dropdown and the settings panel.
async function signOut(){ try{ await auth.signOutUser(); }catch(e){} }
// In-app confirm (GAPS #15): native confirm() blocks the whole page (and any automation) and
// looks nothing like the rest of the UI. Resolves true/false; Esc or the backdrop cancels.
function askConfirm(title, body, okLabel){
  return new Promise(resolve=>{
    const box=$("confirmBox"); if(!box) return resolve(false);
    $("confirmTitle").textContent=title;
    $("confirmBody").textContent=body;
    $("confirmOk").textContent=okLabel||"Confirm";
    box.hidden=false;
    const onKey=(ev)=>{ if(ev.key==="Escape") done(false); };
    const done=(v)=>{ box.hidden=true; $("confirmOk").onclick=null; $("confirmCancel").onclick=null;
      box.onclick=null; document.removeEventListener("keydown",onKey); resolve(v); };
    $("confirmOk").onclick=()=>done(true);
    $("confirmCancel").onclick=()=>done(false);
    box.onclick=(ev)=>{ if(ev.target===box) done(false); };
    document.addEventListener("keydown",onKey);
    $("confirmCancel").focus();
  });
}
async function deleteCloud(){
  const yes = await askConfirm("Delete cloud data?",
    "This removes your synced workout and presets from the cloud. Your device keeps its local copy.",
    "Delete");
  if(!yes) return;
  clearTimeout(_cfgSaveT);
  try{ if(cloud) await cloud.deleteAll(); }catch(e){ noteSync(false,"delete",e); }
  try{ await auth.signOutUser(); }catch(e){}
}
{
  const so = document.getElementById("amSignOut"), del = document.getElementById("amDelete");
  if(so) so.onclick = () => { closeAcctMenu(); signOut(); };
  if(del) del.onclick = () => { closeAcctMenu(); deleteCloud(); };
  document.addEventListener("click", (ev)=>{
    const m=document.getElementById("acctMenu");
    if(!m || m.hidden) return;
    const t=ev.target;
    if(t && t.closest && (t.closest("#acctMenu") || t.closest(".idchip"))) return;
    closeAcctMenu();
  });
  document.addEventListener("keydown", (ev)=>{ if(ev.key==="Escape") closeAcctMenu(); });
}
function updateAccountUI(u){
  updateIdChips(u);
  renderCatalog();   // re-render so guest workout-locks update on sign in/out
  const box = document.getElementById("accountInfo");
  const wu = document.getElementById("welcomeUser");
  if(!box) return;
  if(u){
    const name = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || "Signed in";
    box.innerHTML = '<div class="who">'+esc(name)+'</div>'+
      '<button id="acctSignOut">Sign out</button>'+
      '<button id="acctDelete" class="danger">Delete my cloud data</button>';
    document.getElementById("acctSignOut").onclick = signOut;
    document.getElementById("acctDelete").onclick = deleteCloud;
    if(wu){ wu.hidden=false; wu.textContent="Signed in as "+name; }
  } else {
    box.innerHTML = '<div>Not signed in &mdash; using this device only.</div>'+
      '<button id="acctSignIn">Sign in to sync</button>';
    const b=document.getElementById("acctSignIn");
    if(b) b.onclick = () => { closeSettings && closeSettings(); showScreen("welcome"); };
    if(wu){ wu.hidden=true; }
  }
}
updateAccountUI(null);   // initial (signed-out) render
// Restore a remembered session on load: wires auth + onAuthChange so a returning user is signed
// in and their cloud config syncs. Guests (no stored token) are unaffected.
connectAuth();
