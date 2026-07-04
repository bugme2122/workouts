import {
  THEMES, LADDERS, LENGTHS, EXERCISES, DEFAULT, WORKOUTS, howto, workoutToConfig,
  encShare, decShare,
} from "./catalog.js";
import {
  blockLenOf, blocksFor, buildPhases, migrate, sanitize,
  clampPeople, occupants, setDefaults, secondCue,
} from "./engine.js";
import * as store from "./store.js";

setDefaults({ people: DEFAULT.people, prep: DEFAULT.prep, theme: DEFAULT.theme, volume: DEFAULT.volume, targetMin: DEFAULT.targetMin, voice: DEFAULT.voice, ticks: DEFAULT.ticks, halfChime: DEFAULT.halfChime });

const $ = id => document.getElementById(id);
const clone = o => JSON.parse(JSON.stringify(o));

// ---------- config persistence ----------
function loadConfig(){
  const body=(location.hash||"").replace(/^#/,"");
  if(body.startsWith("w=")||body.startsWith("c=")){ const c=decShare(body); if(c) return sanitize(migrate(c)); }
  const c=store.local.loadConfig(); if(c) return sanitize(migrate(c));
  return sanitize(clone(DEFAULT));
}
function persist(){
  store.local.saveConfig(config);
  try{ history.replaceState(null,"","#"+encShare(config)); }catch(e){}
  cloudSaveConfig(config);   // no-op until a cloud backend is attached (Task 3)
}
function getPresets(){ return store.local.loadPresets(); }
function setPresets(o){ store.local.savePresets(o); cloudSavePresets(o); }

let cloud=null;
function cloudSaveConfig(c){ /* attached in Task 3 */ }
function cloudSavePresets(o){ /* attached in Task 3 */ }

let config = loadConfig();

// ---------- derived / phases ----------
const RING_C = 2*Math.PI*108;
let phases=[], cum=[], WORKOUT_TOTAL=0, N=0, LADN=0, TOTBLOCKS=0;
function build(){
  const r = buildPhases(config);
  phases = r.phases; cum = r.cum; WORKOUT_TOTAL = r.total;
  N = r.N; LADN = r.LADN; TOTBLOCKS = r.TOTBLOCKS;
}

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
function say(t){ try{ if(!config.voice||config.volume<=0||!window.speechSynthesis) return; speechSynthesis.cancel(); const u=new SpeechSynthesisUtterance(t); u.volume=config.volume; u.rate=1.12; u.pitch=1; speechSynthesis.speak(u);}catch(e){} }
function buzz(p){ try{ if(config.haptics&&navigator.vibrate) navigator.vibrate(p);}catch(e){} }

// ---------- wake lock ----------
let wake=null;
async function acquireWake(){ try{ if(config.keepAwake&&"wakeLock" in navigator){ wake=await navigator.wakeLock.request("screen"); } }catch(e){} }
function releaseWake(){ try{ if(wake){ wake.release(); wake=null; } }catch(e){} }
document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible"&&running) acquireWake(); });

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
  elLad.textContent = config.ladder.map(x=>x[0]).join("·")+"s";
  renderDots();
  renderLegend();
}

function personLabel(k){
  return (config.personNames && config.personNames[k] && config.personNames[k].trim())
    ? config.personNames[k].trim() : "P"+(k+1);
}

function renderPersonCards(block){
  const host = document.getElementById("personCards");
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

function render(){
  const p=phases[idx]; if(!p) return;
  let disp = (p.block!==undefined)?p.block:0, rot=false;
  if(p.type==="rest" && p.iv===LADN-1 && p.block<TOTBLOCKS-1){ disp=p.block+1; rot=true; }
  document.documentElement.style.setProperty("--accent", accentVar(p,rot));

  const secLeft = finished?0:Math.ceil(remaining/1000);
  elNum.textContent = finished?"✓":secLeft;

  if(finished){ elPhase.textContent="Complete"; elIv.textContent="nice work"; }
  else if(p.type==="prep"){ elPhase.textContent=running?"Get ready":"Tap to start"; elIv.textContent=config.stations.length+" stations · "+fmt(WORKOUT_TOTAL); }
  else { elPhase.textContent = p.type==="work"?"Work":(rot?"Rotate":"Rest"); elIv.textContent = config.ladder[p.iv][0]+"s on · "+config.ladder[p.iv][1]+"s off"; }

  const frac = finished?0:Math.max(0,Math.min(1,remaining/(p.dur*1000)));
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
    if(cue.chime && config.halfChime) say("Halfway");
  }
  while(remaining<=0){
    const leftover=remaining; idx++;
    if(idx>=phases.length){ finished=true; running=false; idx=phases.length-1; releaseWake(); sDone(); say("Workout complete"); remaining=0; render(); showComplete(); return; }
    const np=phases[idx]; enterPhase(np, np.type==="work"&&np.iv===0);
    remaining=np.dur*1000+leftover; cueSec=null;
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
    d.querySelector(".load").onclick=()=>{ draft=migrate(ps[n]); applyTheme(draft.theme); fillSettings(); };
    d.querySelector(".del").onclick=()=>{ const o=getPresets(); delete o[n]; setPresets(o); renderPresets(); };
    L.appendChild(d); });
}
function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

// settings events
$("gear").onclick=openSettings;
$("closeS").onclick=()=>{ if(sheetFromCustomize){ closeSettings(); applyTheme(draft.theme); } else { applyTheme(config.theme); closeSettings(); } };
$("addStation").onclick=()=>{ draft.stations.push({ex:"New exercise",gear:"",rep:""}); renderStationRows(); };
$("addInterval").onclick=()=>{ const lastp=draft.ladder[draft.ladder.length-1]||[30,15]; draft.ladder.push([lastp[0],lastp[1]]); renderLadderRows(); };
$("prepInput").oninput=e=>draft.prep=parseInt(e.target.value)||0;
$("volInput").oninput=e=>draft.volume=(parseInt(e.target.value)||0)/100;
document.querySelectorAll(".sw-toggle").forEach(t=>{ t.onclick=()=>{ draft[t.dataset.tog]=!draft[t.dataset.tog]; t.classList.toggle("on",draft[t.dataset.tog]); }; });
$("savePreset").onclick=()=>{ const nm=($("presetName").value||"").trim(); if(!nm) return; const o=getPresets(); o[nm]=sanitize(clone(draft)); setPresets(o); $("presetName").value=""; renderPresets(); };
$("resetDefault").onclick=()=>{ draft=clone(DEFAULT); applyTheme(draft.theme); fillSettings(); };
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
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById("screen-" + name).classList.add("active");
}

function renderCatalog() {
  const stack = document.getElementById("catalogStack");
  stack.innerHTML = "";
  WORKOUTS.forEach(w => {
    const card = document.createElement("div");
    card.className = "wcard";
    const mins = estimateMinutes(workoutToConfig(w));
    card.innerHTML =
      '<div class="wtop"><div><div class="wname">' + esc(w.name) + '</div>' +
      '<div class="wtag">' + esc(w.category) + '</div></div>' +
      '<div class="wdur">~' + mins + ' min</div></div>' +
      '<div class="exmini">' + w.stations.map(s => '<span>' + esc(s.ex) + '</span>').join("") + '</div>' +
      '<div class="wfoot"><button class="cust">Customize</button><button class="go">Start ▸</button></div>';
    card.querySelector(".cust").onclick = () => openCustomize(w);
    card.querySelector(".go").onclick = () => { config = sanitize(workoutToConfig(w)); persist(); startLive(); };
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
$("buildOwn").onclick = () => openCustomize(null);

// ---------- init ----------
applyTheme(config.theme);
renderCatalog();
const hasShared = /^#?[wc]=/.test(location.hash || "");
showScreen(hasShared ? "live" : "home");
if (hasShared) { build(); setupView(); reset(); }

function startLive() { build(); setupView(); reset(); showScreen("live"); ensureAudio(); }
