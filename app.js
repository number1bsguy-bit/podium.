/* Podium — speech articulation coach.
   Mic → (1) Web Speech API live transcript, (2) Web Audio analysis: pace, pauses, pitch variation, volume,
   (3) MediaRecorder playback. Text + voice → local score. Optional AI coach via POST /api/coach. */
"use strict";

// ---------- data ----------
const SCEN = [
  {id:"pitch",tag:"Elevator",title:"Explain what you do in 30 seconds",prompt:"A senior leader from another team asks at the coffee machine: \"So what are you working on?\"",frame:["Point","Proof","Ask"],goals:["career","network"]},
  {id:"raise",tag:"Negotiation",title:"Ask for a raise",prompt:"Your one-to-one with your manager. You have two minutes to make the case for a compensation review.",frame:["Ask","Evidence","Market","Next step"],goals:["career"]},
  {id:"disagree",tag:"Meetings",title:"Disagree with your boss in a meeting",prompt:"Your manager proposes launching next week. You believe it needs two more weeks of testing.",frame:["Shared goal","Concern","Data","Alternative"],goals:["leader","career"]},
  {id:"update",tag:"Stand-up",title:"Give a status update that lands",prompt:"Weekly leadership sync. Your project is a week behind. Give the update.",frame:["Bottom line","Cause","Fix","Need"],goals:["leader"]},
  {id:"weakness",tag:"Interview",title:"What's your biggest weakness?",prompt:"Final-round interview. Answer honestly, without a humble-brag.",frame:["Situation","Task","Action","Result"],goals:["interview"]},
  {id:"intro",tag:"Networking",title:"Introduce yourself at an event",prompt:"Someone you'd like to know walks up and says: \"Hi, I don't think we've met.\"",frame:["Name","Hook","Question"],goals:["network"]},
  {id:"conflict",tag:"Interview",title:"Tell me about a conflict at work",prompt:"Behavioural interview question. Keep it under ninety seconds.",frame:["Situation","Task","Action","Result"],goals:["interview","leader"]},
  {id:"bad",tag:"Meetings",title:"Deliver bad news to a client",prompt:"The feature the client was promised for this month will slip to next quarter.",frame:["Headline","Why","Plan","Commitment"],goals:["leader","career"]},
  {id:"free",tag:"Open practice",title:"Free practice",prompt:"Rehearse anything: a pitch, a toast, tomorrow's presentation opener.",frame:["Point","Reason","Example","Point"],goals:[]},
];

const LEX = {
  en: {
    fillers:["um","umm","uh","uhh","erm","hmm","like","basically","actually","literally","you know","i mean","so yeah","kind of","sort of","kinda","sorta","whatever","stuff","and stuff","or something"],
    hedges:["i think","i guess","i feel like","i believe","maybe","perhaps","probably","hopefully","sorry","i'm sorry","i'm not sure","not sure","i'm no expert","i'm not an expert","if that makes sense","does that make sense","a little bit","a bit","i was wondering","i just wanted","just wanted","might be","could be","i suppose","more or less"],
    weak:["just","really","very","pretty","quite","somewhat","try to","trying to","honestly","totally"],
    asks:/\?|\b(would you|could you|can we|let's|let us|i recommend|i propose|next step|i'd like to|i'm asking|can i|shall we|are you open)\b/i,
    weakOpen:/^(um+|uh+|so|well|like|basically|sorry|i think|i guess|i just|i'm not sure|maybe|okay so|ok so)\b/,
  },
  fr: {
    fillers:["euh","heu","bah","ben","bon ben","genre","du coup","en fait","voilà","quoi","tu vois","vous voyez","enfin","bref","style","truc","machin"],
    hedges:["je pense","je crois","j'ai l'impression","peut-être","un peu","désolé","désolée","pardon","je ne sais pas","je sais pas","il me semble","éventuellement","normalement","on va dire","si ça a du sens","je voulais juste"],
    weak:["juste","vraiment","très","assez","plutôt","essayer de"],
    asks:/\?|\b(pourriez-vous|pouvez-vous|est-ce qu|je propose|je recommande|prochaine étape|on peut|seriez-vous|je vous propose)\b/i,
    weakOpen:/^(euh|bah|ben|bon|alors euh|du coup|en fait|désolé|je pense|je crois|peut-être)\b/,
  },
};
LEX.es = {fillers:["eh","este","o sea","pues","bueno","tipo","sabes","digamos"],hedges:["creo que","pienso que","quizás","tal vez","perdón","lo siento","un poco","no sé"],weak:["solo","muy","realmente","bastante"],asks:/\?|\b(podríamos|propongo|recomiendo|siguiente paso)\b/i,weakOpen:/^(eh|este|bueno|pues|o sea|perdón|creo que)\b/};
LEX.de = {fillers:["äh","ähm","also","halt","quasi","sozusagen","irgendwie","ne","weißt du"],hedges:["ich glaube","ich denke","vielleicht","eventuell","sorry","entschuldigung","ein bisschen","ich weiß nicht"],weak:["nur","eigentlich","wirklich","sehr","ziemlich"],asks:/\?|\b(könnten wir|ich schlage vor|ich empfehle|nächster schritt)\b/i,weakOpen:/^(äh|ähm|also|ja also|sorry|ich glaube)\b/};

// ---------- utils ----------
const $ = s => document.querySelector(s);
const store = {
  get(k, d){ try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const clamp = x => Math.round(Math.max(0, Math.min(100, x)));
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmtTime = s => Math.floor(s/60) + ":" + String(Math.floor(s%60)).padStart(2,"0");
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function phraseRx(list){
  const alt = list.map(p => p.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).sort((a,b)=>b.length-a.length).join("|");
  return new RegExp("(?<![\\p{L}\\p{N}'’])(" + alt + ")(?![\\p{L}\\p{N}])", "giu");
}

// ---------- state ----------
const settings = Object.assign({lang:"en-US", accessCode:"", autoCoach:false}, store.get("podium.settings", {}));
let goal = store.get("podium.goal", "career");
let cur = SCEN[0];
let voice = null;       // metrics from the last recording
let lastText = null;    // last text analysis
let lastCoach = null;
let take = null;        // live recording session

const lexFor = () => LEX[settings.lang.slice(0,2)] || LEX.en;
let RX = buildRx();
function buildRx(){ const L = lexFor(); return {f:phraseRx(L.fillers), h:phraseRx(L.hedges), w:phraseRx(L.weak), L}; }

// ---------- text analysis ----------
function analyzeText(text){
  const t = text.trim();
  const words = t.match(/[\p{L}\p{N}][\p{L}\p{N}'’%€$.,-]*/gu) || [];
  const n = words.length || 1;
  const sents = t.split(/(?<=[.!?])\s+/).filter(s => s.trim());
  const count = re => (t.match(re) || []).length;
  const f = count(RX.f), h = count(RX.h), w = count(RX.w);
  // Speech engines rarely punctuate; estimate sentence length from ~2.6 s of speech if no punctuation.
  let avg = sents.length > 1 ? n / sents.length : (voice && voice.duration ? Math.min(n, voice.wpm/60*5.5) : n);
  const nums = /\d|\b(percent|per cent|pour cent|million|thousand|mille|hundred|cent|half|twice|double)\b/i.test(t);
  const first = t.toLowerCase().replace(/^[^\p{L}]+/u, "");
  const weakOpen = RX.L.weakOpen.test(first);
  const tail = t.split(/\s+/).slice(-30).join(" ");
  const ask = RX.L.asks.test(tail);
  const per100 = x => x / n * 100;
  const concision  = clamp(100 - Math.max(0, avg-20)*3 - per100(w)*6 - (n>220 ? (n-220)/3 : 0));
  const clarity    = clamp(100 - per100(f)*9 + (nums?6:-8) - Math.max(0, avg-28)*2);
  const confidence = clamp(100 - per100(h)*10 - (weakOpen?12:0) - per100(w)*3);
  const structure  = clamp(55 + (weakOpen?-10:20) + (ask?20:0) + (nums?10:0) + (n>=40?5:-10));
  return {n:words.length, f, h, w, avg, nums, weakOpen, ask, concision, clarity, confidence, structure};
}
function deliveryScore(v){
  if (!v || v.speakingTime < 3) return null;
  let s = 100;
  if (v.wpm < 120) s -= (120 - v.wpm) * 0.8; else if (v.wpm > 170) s -= (v.wpm - 170) * 0.9;
  s -= v.longPauses * 6;
  if (v.minutes > 0.2 && v.shortPauses / v.minutes < 4) s -= 8;       // no breathing room
  if (v.pitchSt !== null) { if (v.pitchSt < 2) s -= (2 - v.pitchSt) * 18; else if (v.pitchSt > 7) s -= 6; }
  s -= Math.max(0, 70 - v.volumeSteady) * 0.3;
  return clamp(s);
}
function highlight(text){
  const marks = [];
  const put = (re, cls) => { text = text.replace(re, m => { marks.push(`<mark class="${cls}">${esc(m)}</mark>`); return `\u0000${marks.length-1}\u0000`; }); };
  put(RX.h,"h"); put(RX.f,"f"); put(RX.w,"w");
  return esc(text).replace(/\u0000(\d+)\u0000/g, (_,i) => marks[i]).replace(/\n/g,"<br>");
}
function tighten(text){
  let t = text.replace(RX.h," ").replace(RX.f," ").replace(RX.w," ");
  t = t.replace(/\s+,/g,",").replace(/,\s*,+/g,",").replace(/\s{2,}/g," ").replace(/(^|[.!?]\s+)[,\s]+/g,"$1").replace(/\s+([.?!,])/g,"$1").trim();
  t = t.replace(/(^|[.!?]\s+)(so|well|okay|ok|alors|donc)\b[,\s]*/giu, "$1");
  t = t.replace(/(^|[.!?]\s+)(\p{Ll})/gu, (m,a,b) => a + b.toUpperCase()).replace(/\bi\b/g,"I");
  return t || "—";
}

// ---------- pitch detection (normalized autocorrelation) ----------
function detectPitch(buf, sr){
  const N = buf.length, minLag = Math.floor(sr/400), maxLag = Math.min(Math.floor(sr/70), N-1);
  const corr = new Float32Array(maxLag+1);
  let best = 0, bestLag = -1;
  for (let lag = minLag; lag <= maxLag; lag++){
    let s = 0, e1 = 0, e2 = 0;
    for (let i = 0; i < N - lag; i++){ const a = buf[i], b = buf[i+lag]; s += a*b; e1 += a*a; e2 += b*b; }
    const c = s / (Math.sqrt(e1*e2) || 1); corr[lag] = c;
    if (c > best){ best = c; bestLag = lag; }
  }
  if (best < 0.55) return null;
  // prefer the shortest lag that is a local peak near the max (avoids octave-down errors)
  for (let lag = minLag+1; lag < maxLag; lag++){
    if (corr[lag] >= best*0.9 && corr[lag] >= corr[lag-1] && corr[lag] >= corr[lag+1]){ bestLag = lag; break; }
  }
  const a = corr[bestLag-1] || 0, b = corr[bestLag], c = corr[bestLag+1] || 0;
  const shift = (a - c) / (2*(a - 2*b + c) || 1);
  return sr / (bestLag + (Math.abs(shift) < 1 ? shift : 0));
}

// ---------- recording ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

async function startTake(){
  if (!navigator.mediaDevices?.getUserMedia){ setStatus("This browser can't access a microphone here. Open Podium over https or localhost.", true); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true, noiseSuppression:true, autoGainControl:false}}); }
  catch (e){ setStatus(e.name === "NotAllowedError" ? "Microphone blocked. Allow mic access in your browser's site settings, then try again." : "No microphone found.", true); return; }

  speechSynthesis?.cancel();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser(); an.fftSize = 2048; src.connect(an);
  const buf = new Float32Array(an.fftSize);

  take = { stream, ctx, an, buf, t0: performance.now(), frames: [], noise: 0.01, finals: "", interim: "", rec: null, mr: null, chunks: [], wake: null, speechOn: false };

  // recorder for playback
  try {
    const mime = ["audio/webm;codecs=opus","audio/mp4","audio/webm"].find(m => window.MediaRecorder?.isTypeSupported?.(m));
    take.mr = new MediaRecorder(stream, mime ? {mimeType:mime} : undefined);
    take.mr.ondataavailable = e => e.data.size && take?.chunks.push(e.data);
    take.mr.start(250);
  } catch {}

  // live transcription
  if (SR){
    const rec = new SR(); rec.lang = settings.lang; rec.continuous = true; rec.interimResults = true;
    rec.onresult = e => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++){
        const r = e.results[i];
        if (r.isFinal) take.finals += (take.finals ? " " : "") + r[0].transcript.trim();
        else interim += r[0].transcript;
      }
      take.interim = interim.trim();
      $("#transcript").value = (take.finals + " " + take.interim).trim();
    };
    rec.onerror = e => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setStatus("Speech-to-text was blocked. Your voice is still being measured; type what you said afterwards.", true);
      else if (e.error === "network") setStatus("Speech-to-text needs an internet connection. Voice metrics still work.", true);
    };
    rec.onend = () => { if (take && take.rec === rec){ try { rec.start(); } catch {} } };   // Chrome stops after silences
    try { rec.start(); take.rec = rec; } catch {}
    setStatus("Listening… answer as if they're in front of you.");
  } else {
    setStatus("Live transcription isn't available in this browser (try Chrome, Edge or Safari). Your voice is still measured; type what you said when you stop.");
  }

  try { take.wake = await navigator.wakeLock?.request("screen"); } catch {}
  $("#transcript").value = ""; $("#playback").hidden = true; $("#coach").hidden = true;
  $("#recBtn").setAttribute("aria-pressed","true"); $("#recLabel").textContent = "Stop";

  take.timer = setInterval(sampleFrame, 50);
  take.raf = requestAnimationFrame(drawLive);
}

function sampleFrame(){
  if (!take) return;
  const {an, buf, ctx} = take;
  an.getFloatTimeDomainData(buf);
  let e = 0; for (let i = 0; i < buf.length; i++) e += buf[i]*buf[i];
  const rms = Math.sqrt(e / buf.length);
  const t = (performance.now() - take.t0) / 1000;
  if (t < 0.6) take.noise = Math.min(take.noise, rms || take.noise); // calibrate floor
  const thr = Math.max(0.006, take.noise * 3);
  const voiced = rms > thr;
  if (!voiced) take.noise = take.noise * 0.97 + rms * 0.03;
  const pitch = voiced && rms > thr*1.5 ? detectPitch(buf, ctx.sampleRate) : null;
  take.frames.push({t, rms, voiced, pitch});
  $("#clock").textContent = fmtTime(t);
}

async function stopTake(discard){
  if (!take) return;
  const tk = take; take = null;
  clearInterval(tk.timer); cancelAnimationFrame(tk.raf);
  if (tk.rec){ const r = tk.rec; tk.rec = null; try { r.stop(); } catch {} }
  try { tk.wake?.release(); } catch {}
  if (discard){ try { tk.mr?.stop(); } catch {} tk.stream.getTracks().forEach(t => t.stop()); tk.ctx.close(); $("#recBtn").setAttribute("aria-pressed","false"); return; }
  if (tk.mr && tk.mr.state !== "inactive"){
    await new Promise(res => { tk.mr.onstop = res; tk.mr.stop(); });
    const blob = new Blob(tk.chunks, {type: tk.mr.mimeType || "audio/webm"});
    const pb = $("#playback"); if (pb.src) URL.revokeObjectURL(pb.src);
    pb.src = URL.createObjectURL(blob); pb.hidden = false;
  }
  tk.stream.getTracks().forEach(t => t.stop());
  tk.ctx.close();
  $("#recBtn").setAttribute("aria-pressed","false"); $("#recLabel").textContent = "Record another take";

  // give the recognizer a moment to deliver its last final result
  await new Promise(r => setTimeout(r, 400));
  const text = (tk.finals + " " + tk.interim).trim();
  if (text) $("#transcript").value = text;

  voice = summarizeVoice(tk.frames, $("#transcript").value);
  drawTimeline(tk.frames);
  if (!voice){ setStatus("I didn't hear any speech. Check the mic is the right one and speak a little louder.", true); refresh(); return; }
  setStatus($("#transcript").value.trim() ? "Take analyzed. Fix any misheard words in the transcript, then get AI coaching." : "Take measured. Type what you said in the transcript box to score your wording.");
  refresh();
  if (settings.autoCoach && lastText?.n >= 8) runCoach();
}

function summarizeVoice(frames, text){
  const vf = frames.filter(f => f.voiced);
  if (vf.length < 10) return null;
  const dt = 0.05;
  const firstT = vf[0].t, lastT = vf[vf.length-1].t;
  const duration = Math.max(0.5, lastT - firstT + dt);
  const speakingTime = vf.length * dt;
  // pauses: silent runs between first and last voiced frame
  let longPauses = 0, shortPauses = 0, run = 0; const pauses = [];
  for (const f of frames){
    if (f.t < firstT || f.t > lastT) continue;
    if (!f.voiced) run += dt;
    else { if (run >= 1.5){ longPauses++; pauses.push([f.t-run, f.t]); } else if (run >= 0.3) shortPauses++; run = 0; }
  }
  // pitch variation in semitones
  const ps = vf.map(f => f.pitch).filter(Boolean);
  let pitchSt = null, medianHz = null;
  if (ps.length >= 15){
    const sorted = [...ps].sort((a,b)=>a-b); medianHz = sorted[Math.floor(sorted.length/2)];
    const st = ps.map(p => 12*Math.log2(p/medianHz)).filter(s => Math.abs(s) < 12);
    const mean = st.reduce((a,b)=>a+b,0)/st.length;
    pitchSt = Math.sqrt(st.reduce((a,b)=>a+(b-mean)**2,0)/st.length);
  }
  // volume steadiness from dB spread of voiced frames
  const db = vf.map(f => 20*Math.log10(f.rms + 1e-9));
  const m = db.reduce((a,b)=>a+b,0)/db.length;
  const sd = Math.sqrt(db.reduce((a,b)=>a+(b-m)**2,0)/db.length);
  const volumeSteady = clamp(100 - Math.max(0, sd - 6) * 10);
  const words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’]*/gu) || []).length;
  return { duration, speakingTime, minutes: duration/60, wpm: words ? Math.round(words / duration * 60) : 0,
           longPauses, shortPauses, pauses, pitchSt, medianHz, volumeSteady };
}

// ---------- drawing ----------
function prepCanvas(){
  const c = $("#strip"), dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.round(w*dpr)){ c.width = Math.round(w*dpr); c.height = Math.round(h*dpr); }
  const g = c.getContext("2d"); g.setTransform(dpr,0,0,dpr,0,0); g.clearRect(0,0,w,h);
  return {g, w, h};
}
function paintFrames(frames, t0, t1, pauses){
  const {g, w, h} = prepCanvas();
  const span = Math.max(0.1, t1 - t0), x = t => (t - t0) / span * w;
  const acc = css("--accent"), pc = css("--pitch"), pz = css("--pause"), muted = css("--muted");
  if (pauses){ g.fillStyle = pz; for (const [a,b] of pauses) g.fillRect(x(a), 0, Math.max(2, x(b)-x(a)), h); }
  const bw = Math.max(1, w / Math.max(1, frames.length) * 0.8), mid = h * 0.62;
  g.fillStyle = acc;
  for (const f of frames){
    if (f.t < t0) continue;
    const amp = Math.min(1, Math.sqrt(f.rms) * 3.2) * (mid - 8);
    g.globalAlpha = f.voiced ? 0.95 : 0.25;
    g.fillRect(x(f.t), mid - amp, bw, amp * 1.35);
  }
  g.globalAlpha = 1; g.fillStyle = pc;
  for (const f of frames){
    if (!f.pitch || f.t < t0) continue;
    const st = 12 * Math.log2(f.pitch / 80);                    // 80 Hz → bottom, ~3 octaves to top
    g.beginPath(); g.arc(x(f.t), h - 8 - Math.min(1, st/36) * (h - 16), 1.8, 0, Math.PI*2); g.fill();
  }
  g.fillStyle = muted; g.font = "11px " + css("--f-mono");
  g.fillText(fmtTime(t0), 6, h - 6); const end = fmtTime(t1); g.fillText(end, w - g.measureText(end).width - 6, h - 6);
}
function drawLive(){
  if (!take) return;
  const t = (performance.now() - take.t0)/1000;
  paintFrames(take.frames.slice(-200), Math.max(0, t - 10), Math.max(10, t), null);
  take.raf = requestAnimationFrame(drawLive);
}
function drawTimeline(frames){
  if (!frames?.length){ drawIdle(); return; }
  paintFrames(frames, 0, frames[frames.length-1].t, voice?.pauses || []);
  lastFrames = frames;
}
let lastFrames = null;
function drawIdle(){
  const {g, w, h} = prepCanvas();
  g.fillStyle = css("--muted"); g.font = "13px " + css("--f-body"); g.textAlign = "center";
  g.fillText("Your voice timeline appears here while you speak", w/2, h/2 + 4); g.textAlign = "start";
}
new ResizeObserver(() => { if (take) return; lastFrames ? paintFrames(lastFrames, 0, lastFrames.at(-1).t, voice?.pauses||[]) : drawIdle(); }).observe($("#strip"));
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => lastFrames ? drawTimeline(lastFrames) : drawIdle());

// ---------- scoring UI ----------
function verdict(s){ return s>=85?["Boardroom-ready","Direct, concrete, confident."]:s>=70?["Solid","A couple of habits to trim."]:s>=50?["Getting there","Cut the cushioning words first."]:["Rough draft","Lead with the point and drop the hedges."]; }
function dial(score){
  const r = 40, c = 2*Math.PI*r, col = score==null ? "var(--line)" : score>=70?"var(--good)":score>=50?"var(--warn)":"var(--bad)";
  $("#dial").innerHTML = `<circle cx="50" cy="50" r="${r}" fill="none" stroke="var(--sunk)" stroke-width="9"/>
    <circle cx="50" cy="50" r="${r}" fill="none" stroke="${col}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${c*(score||0)/100} ${c}" transform="rotate(-90 50 50)"/>
    <text x="50" y="57" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="24" font-weight="600" fill="var(--ink)">${score==null?"–":score}</text>`;
}
function tone(v, okFn, warnFn){ return v==null ? "" : okFn(v) ? "ok" : warnFn(v) ? "warn" : "bad"; }

function tips(a, v){
  const out = [];
  if (a.n < 8 && !v){ return [["Record a take (or type an answer) to get feedback.","var(--muted)"]]; }
  if (v){
    if (v.wpm && v.wpm < 120) out.push([`Pace ${v.wpm} wpm is slow enough to lose a room. Aim for 130 to 160 and cut words rather than slowing down.`,"var(--warn)"]);
    if (v.wpm > 170) out.push([`Pace ${v.wpm} wpm: you're rushing. Pause for a full beat after your key number.`,"var(--bad)"]);
    if (v.longPauses) out.push([`${v.longPauses} pause${v.longPauses>1?"s":""} over 1.5 s (red bands). Short pauses are power; long ones read as lost. Know your next line before you stop.`,"var(--warn)"]);
    if (v.minutes > 0.2 && v.shortPauses / v.minutes < 4) out.push(["Almost no breathing pauses. Stop for half a second at each full stop; it signals confidence.","var(--warn)"]);
    if (v.pitchSt !== null && v.pitchSt < 2) out.push([`Pitch variation ${v.pitchSt.toFixed(1)} semitones: flat. Lift your voice on the one word that matters in each sentence.`,"var(--bad)"]);
    if (v.volumeSteady < 60) out.push(["Volume swings a lot. Watch for trailing off at sentence ends; land the last word.","var(--warn)"]);
  }
  if (a.n >= 8){
    if (a.weakOpen) out.push(["Your first words are a run-up. Open with the point itself; people decide in 5 seconds whether to keep listening.","var(--bad)"]);
    if (a.f >= 2) out.push([`${a.f} fillers. Replace each with a silent half-second pause.`,"var(--warn)"]);
    if (a.h >= 2) out.push([`${a.h} hedges or apologies. State the position, then invite challenge: "I recommend X. What am I missing?"`,"var(--bad)"]);
    if (!a.nums) out.push(["No numbers. One concrete figure (a date, %, € or count) makes the claim stick.","var(--warn)"]);
    if (!a.ask) out.push(["No clear close. End with a question or a next step so the conversation moves.","var(--warn)"]);
  }
  if (!out.length) out.push(["Clean, direct and well paced. Do it again without looking at notes.","var(--good)"]);
  if (SR && /^en/.test(settings.lang) && a.f === 0 && v) out.push(["Speech-to-text often deletes \"um\" and \"uh\". Listen to the playback to catch the ones it hid.","var(--muted)"]);
  return out;
}

function refresh(){
  const text = $("#transcript").value;
  const a = analyzeText(text); lastText = a;
  const has = a.n >= 3;
  const del = deliveryScore(voice);
  const parts = [["Clarity",has?a.clarity:null],["Confidence",has?a.confidence:null],["Structure",has?a.structure:null],["Concision",has?a.concision:null],["Delivery",del]];
  const vals = parts.map(p=>p[1]).filter(v=>v!=null);
  const overall = vals.length ? Math.round(vals.reduce((x,y)=>x+y,0)/vals.length) : null;
  a.overall = overall;
  dial(overall);
  const [vt, vs] = overall==null ? ["No take yet","Record an answer to see your score."] : verdict(overall);
  $("#verdict").textContent = vt; $("#verdictSub").textContent = vs;
  $("#bars").innerHTML = parts.map(([k,v]) => `<div class="bar"><div class="row"><span>${k}</span><span class="mono">${v==null?"–":v}</span></div><div class="track"><div class="fill" style="width:${v||0}%"></div></div></div>`).join("");

  const v = voice;
  $("#vmetrics").innerHTML = [
    [v?.wpm || "–", "words / min", tone(v?.wpm||null, x=>x>=130&&x<=165, x=>x>=115&&x<=180)],
    [v ? v.longPauses : "–", "pauses > 1.5 s", tone(v?v.longPauses:null, x=>x===0, x=>x<=2)],
    [v?.pitchSt!=null ? v.pitchSt.toFixed(1)+" st" : "–", "pitch variation", tone(v?.pitchSt??null, x=>x>=2.5&&x<=7, x=>x>=1.6)],
    [v ? v.volumeSteady : "–", "volume control", tone(v?v.volumeSteady:null, x=>x>=75, x=>x>=55)],
    [v ? fmtTime(v.duration) : "–", "speaking length", ""],
    [v?.medianHz ? Math.round(v.medianHz)+" Hz" : "–", "median pitch", ""],
  ].map(([b,s,c]) => `<div class="metric ${c}"><b>${b}</b><small>${s}</small></div>`).join("");
  $("#tmetrics").innerHTML = [
    [a.n, "words", ""], [a.f, "fillers", tone(has?a.f:null, x=>x===0, x=>x<=2)],
    [a.h, "hedges", tone(has?a.h:null, x=>x===0, x=>x<=2)], [has?(a.ask?"Yes":"No"):"–", "clear close", has?(a.ask?"ok":"warn"):""],
  ].map(([b,s,c]) => `<div class="metric ${c}"><b>${b}</b><small>${s}</small></div>`).join("");
  $("#tips").innerHTML = tips(a, v).map(([t,c]) => `<li style="--sev:${c}">${esc(t)}</li>`).join("");
  $("#marked").innerHTML = text.trim() ? highlight(text) : '<span class="empty">Your words, with fillers, hedges and weak words highlighted.</span>';
  $("#cleaned").textContent = text.trim() ? tighten(text) : "—";
}

// ---------- AI coach ----------
async function runCoach(){
  const transcript = $("#transcript").value.trim();
  if ((transcript.match(/\S+/g)||[]).length < 5){ setStatus("Say or type at least a sentence before asking the coach.", true); return; }
  const btn = $("#aiBtn"); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Coaching…';
  const a = lastText || analyzeText(transcript);
  try {
    const r = await fetch("api/coach", { method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({
      transcript, goal, lang: settings.lang, accessCode: settings.accessCode,
      scenario: {title: cur.title, prompt: cur.prompt, frame: cur.frame},
      metrics: Object.assign({fillers:a.f, hedges:a.h}, voice ? {duration:voice.duration, speakingTime:voice.speakingTime, wpm:voice.wpm, longPauses:voice.longPauses, shortPauses:voice.shortPauses, pitchSt:voice.pitchSt, volumeSteady:voice.volumeSteady} : {}),
    })});
    const data = await r.json().catch(() => ({error: r.status === 404 ? "AI coach isn't running. Start Podium with server.js or deploy it with the api folder (see README)." : "Unexpected response from the coach server."}));
    if (!r.ok || data.error) throw new Error(data.error || "Coach error " + r.status);
    lastCoach = data; renderCoach(data);
  } catch (e){
    lastCoach = null;
    $("#coach").hidden = false; $("#cHeadline").textContent = "Coach unavailable"; $("#cScore").textContent = "";
    $("#cBody").innerHTML = `<p class="status err">${esc(e.message === "Failed to fetch" ? "Couldn't reach the coach server. Check your connection." : e.message)}</p><p class="note">The local scorecard still works without it.</p>`;
  } finally { btn.disabled = false; btn.textContent = "Get AI coaching"; }
}
function renderCoach(d){
  $("#coach").hidden = false;
  $("#cHeadline").textContent = d.headline || "Feedback";
  $("#cScore").textContent = Number.isFinite(d.score) ? d.score : "";
  const list = xs => (xs||[]).map(x => `<li>${esc(x)}</li>`).join("");
  $("#cBody").innerHTML = `
    ${d.strengths?.length ? `<div><span class="lbl">What worked</span><ul>${list(d.strengths)}</ul></div>` : ""}
    ${d.fixes?.length ? `<div><span class="lbl">Say it sharper</span>${d.fixes.map(f => `<div class="fix"><span class="was">${esc(f.quote||"")}</span><span class="now">${esc(f.better||"")}</span><span class="why">${esc(f.issue||"")}</span></div>`).join("")}</div>` : ""}
    ${d.delivery ? `<div><span class="lbl">Delivery</span><p style="margin:4px 0 0">${esc(d.delivery)}</p></div>` : ""}
    ${d.model_answer ? `<div><span class="lbl">Stronger version, in your words</span><p class="model">${esc(d.model_answer)}</p><div class="actions"><button class="btn small" id="hearModel">Hear it</button></div></div>` : ""}
    ${d.drill ? `<div><span class="lbl">Drill now</span><p style="margin:4px 0 0">${esc(d.drill)}</p></div>` : ""}
    ${d.follow_up ? `<div><span class="lbl">They'd ask next</span><p style="margin:4px 0 0"><strong>${esc(d.follow_up)}</strong></p><div class="actions"><button class="btn primary small" id="answerFollow">Answer this follow-up</button></div></div>` : ""}`;
  $("#hearModel")?.addEventListener("click", () => speak(d.model_answer));
  $("#answerFollow")?.addEventListener("click", () => {
    const fu = {id:"fu-"+Date.now(), tag:"Follow-up · " + cur.tag, title:d.follow_up, prompt:"Follow-up to: " + cur.title, frame:cur.frame, goals:cur.goals};
    pick(fu, true); window.scrollTo({top: $(".stage").offsetTop - 10, behavior:"smooth"});
  });
  $("#coach").scrollIntoView({behavior:"smooth", block:"nearest"});
}

// ---------- TTS ----------
function speak(text){
  if (!("speechSynthesis" in window) || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text); u.lang = settings.lang; u.rate = 1;
  const v = speechSynthesis.getVoices().find(v => v.lang === settings.lang) || speechSynthesis.getVoices().find(v => v.lang.startsWith(settings.lang.slice(0,2)));
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}

// ---------- scenarios, history, settings ----------
function setStatus(msg, err){ const s = $("#status"); s.textContent = msg; s.classList.toggle("err", !!err); }
function renderRail(){
  const list = [...SCEN].sort((a,b) => (b.goals.includes(goal)) - (a.goals.includes(goal)));
  $("#rail").innerHTML = list.map(s => `<button class="scen" data-id="${s.id}" aria-current="${s.id===cur.id}"><strong>${esc(s.title)}</strong><small>${esc(s.tag)}${s.goals.includes(goal)?" · for your target":""}</small></button>`).join("");
  $("#rail").querySelectorAll(".scen").forEach(b => b.onclick = () => pick(SCEN.find(s => s.id === b.dataset.id)));
}
function pick(s, keepRail){
  if (take) stopTake(true);
  cur = s; voice = null; lastFrames = null; lastCoach = null;
  $("#sTag").textContent = s.tag; $("#sTitle").textContent = s.title; $("#sPrompt").textContent = s.prompt;
  $("#sFrame").innerHTML = s.frame.map(f => `<span>${esc(f)}</span>`).join('<span class="arrow">→</span>');
  $("#transcript").value = ""; $("#playback").hidden = true; $("#coach").hidden = true; $("#clock").textContent = "0:00";
  $("#recLabel").textContent = "Start speaking";
  setStatus("Press start, then answer as if you were in the room.");
  if (!keepRail) renderRail(); else $("#rail").querySelectorAll(".scen").forEach(b => b.setAttribute("aria-current","false"));
  drawIdle(); refresh();
}
const today = () => { const d = new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); };
const dayKey = d => d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
function renderHist(){
  const h = store.get("podium.hist", []);
  $("#reps").textContent = h.length;
  const days = new Set(h.map(x => x.d)); let st = 0; const d = new Date();
  if (!days.has(today())) d.setDate(d.getDate()-1);
  while (days.has(dayKey(d))){ st++; d.setDate(d.getDate()-1); }
  $("#streak").textContent = st + " d";
  const pts = h.slice(-10).map(x => x.s);
  if (pts.length > 1){
    const step = 116/(pts.length-1), xy = pts.map((v,i) => [2+i*step, 32 - v/100*30]);
    $("#spark").innerHTML = `<polyline fill="none" stroke="var(--accent)" stroke-width="2" points="${xy.map(p=>p.join(",")).join(" ")}"/><circle cx="${xy.at(-1)[0]}" cy="${xy.at(-1)[1]}" r="3" fill="var(--accent)"/>`;
  } else $("#spark").innerHTML = `<text x="0" y="22" font-size="11" fill="var(--muted)">Save 2 reps</text>`;
  $("#hist").innerHTML = h.length ? h.slice().reverse().map(x => `<div class="hrow"><span>${esc(x.t)} <span class="note">· ${x.d}${x.wpm?` · ${x.wpm} wpm`:""}${x.ai?` · coach ${x.ai}`:""}</span></span><span class="mono">${x.s}</span></div>`).join("")
    : '<p class="empty">No saved reps yet. Record a take, then press Save rep. One a day builds the habit.</p>';
}
function saveRep(){
  refresh();
  if (lastText?.overall == null){ setStatus("Record or type an answer before saving.", true); return; }
  const h = store.get("podium.hist", []);
  h.push({t: cur.title, s: lastText.overall, d: today(), wpm: voice?.wpm || null, ai: lastCoach?.score ?? null});
  store.set("podium.hist", h.slice(-300)); renderHist();
  const b = $("#saveBtn"); b.textContent = "Saved"; setTimeout(() => b.textContent = "Save rep", 1200);
}

// ---------- wiring ----------
$("#recBtn").onclick = () => take ? stopTake(false) : startTake();
$("#retryBtn").onclick = () => pick(cur, cur.id.startsWith("fu-"));
$("#aiBtn").onclick = runCoach;
$("#saveBtn").onclick = saveRep;
$("#hearPrompt").onclick = () => speak(cur.title.endsWith("?") ? cur.title : cur.prompt);
let deb; $("#transcript").addEventListener("input", () => { clearTimeout(deb); deb = setTimeout(() => {
  if (voice) voice.wpm = Math.round(($("#transcript").value.match(/[\p{L}\p{N}][\p{L}\p{N}'’]*/gu)||[]).length / voice.duration * 60);
  refresh(); }, 300); });
document.addEventListener("keydown", e => { if (e.code === "Space" && e.target === document.body){ e.preventDefault(); $("#recBtn").click(); } });

document.querySelectorAll(".chip").forEach(c => {
  c.setAttribute("aria-pressed", c.dataset.goal === goal);
  c.onclick = () => { goal = c.dataset.goal; store.set("podium.goal", goal); document.querySelectorAll(".chip").forEach(x => x.setAttribute("aria-pressed", x === c)); renderRail(); };
});
const dlg = $("#settings");
$("#openSettings").onclick = () => { $("#lang").value = settings.lang; $("#accessCode").value = settings.accessCode; $("#autoCoach").checked = settings.autoCoach; dlg.showModal(); };
dlg.addEventListener("close", () => {
  settings.lang = $("#lang").value; settings.accessCode = $("#accessCode").value; settings.autoCoach = $("#autoCoach").checked;
  store.set("podium.settings", settings); RX = buildRx(); document.documentElement.lang = settings.lang.slice(0,2); refresh();
});
let wipeArmed = false;
$("#wipe").onclick = e => {
  if (!wipeArmed){ wipeArmed = true; e.target.textContent = "Tap again to delete all reps"; setTimeout(() => { wipeArmed = false; e.target.textContent = "Delete saved reps"; }, 3000); return; }
  store.set("podium.hist", []); renderHist(); wipeArmed = false; e.target.textContent = "Deleted";
};

if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
document.documentElement.lang = settings.lang.slice(0,2);
renderHist(); pick(SCEN[0]);
