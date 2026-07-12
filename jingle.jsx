// Jingle — your sonic logo, made from your name. (the jingle.html app)
//
// A three-step wizard over engine/jingle.js:
//   ① the tune   — type a name; six seeded takes on its motif (the letters
//                  ARE the melody), auditioned in your chosen voice
//   ② the band   — eight arrangements (length spread 8–30s, pad, drums/bass/
//                  arp, ending, space); adjust length + pad after picking
//   ③ share      — the only step that encodes: an intro sting + the full
//                  cut, downloads (mp3/opus/wav) and the link
//
// Steps ①–② play instantly: each preview renders offline through the REAL
// engine (renderMotif / renderJingle → AudioBuffer, cached) and plays the
// buffer — any change stops the prior sound and plays the new one. Nothing
// is mocked; nothing is encoded until step ③.
//
// The URL is the recipe: #/j/<text>/<seed>?knobs — deterministic, shareable;
// a shared link lands on step ③ already baking, and can step back to remix.

import React, { useState, useEffect, useRef, useMemo } from "react";
import { createRoot } from "react-dom/client";
import {
  Sparkles, Download, Link as LinkIcon, Check, Music4, Share2,
  ArrowLeft, ArrowRight, Play, Square, Drum, Guitar, AudioWaveform,
} from "https://esm.sh/lucide-react@0.460.0?external=react";
import * as engine from "engine";

/* ---------------------------------------------------------------------
   Option lists + tiny formatters
--------------------------------------------------------------------- */
const KEY_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const MODE_NAMES = {
  ionian: "major", lydian: "lydian", mixolydian: "mixo", dorian: "dorian",
  aeolian: "minor", harmonicMinor: "h.minor", melodicMinor: "m.minor", phrygian: "phrygian",
};
const LEAD_OPTS = [
  ["chime", "Chime (ident bell)"], ["marimba", "Marimba"], ["bell", "Bell (FM)"],
  ["nylon", "Nylon (pluck)"], ["soft", "Soft"], ["glass", "Glass (FM bell)"],
  ["reed", "Reed"], ["breath", "Breath"], ["keys", "Keys (e-piano)"],
  ["brass", "Brass"], ["organ", "Organ"], ["pure", "Pure (sine)"],
  ["bansuri", "Bansuri"], ["whistle", "Whistle"], ["santoor", "Santoor"],
  ["sarangi", "Sarangi"], ["shehnai", "Shehnai"], ["harmonium", "Harmonium"],
];
const PAD_OPTS = [
  ["", "no pad"], ["warm", "warm pad"], ["halo", "halo pad"], ["choir", "choir pad"],
  ["strings", "strings"], ["hollow", "hollow pad"], ["tanpura", "tanpura"],
];
const padName = (p) => (PAD_OPTS.find(([v]) => v === p) || ["", p])[1];
const slug = (t) => (t || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "jingle";
const STING_LEN = 6;

/* ---------------------------------------------------------------------
   Preview player: offline-render (real engine) → cached buffer → play.
   One AudioContext; starting anything stops whatever played before.
--------------------------------------------------------------------- */
function usePreview() {
  const acRef = useRef(null), srcRef = useRef(null), tokenRef = useRef(0), cacheRef = useRef(new Map());
  const [playingKey, setPlayingKey] = useState(null);
  const [loadingKey, setLoadingKey] = useState(null);

  function stop() {
    tokenRef.current++;
    if (srcRef.current) { try { srcRef.current.onended = null; srcRef.current.stop(); } catch (_) {} srcRef.current = null; }
    setPlayingKey(null); setLoadingKey(null);
  }

  async function play(kind, spec) {
    const key = kind + "|" + engine.jingleToHash(spec);
    stop();
    const token = ++tokenRef.current;
    const cache = cacheRef.current;
    let buf = cache.get(key);
    if (!buf) {
      setLoadingKey(key);
      try {
        const r = kind === "motif"
          ? await engine.renderMotif(spec)
          : await engine.renderJingle({ ...spec, lengthSec: Math.min(12, spec.lengthSec) });
        buf = r.audioBuffer;
      } catch (e) { console.error("[jingle] preview failed:", e); setLoadingKey(null); return; }
      cache.set(key, buf);
      if (cache.size > 24) cache.delete(cache.keys().next().value);
    }
    if (token !== tokenRef.current) return;   // superseded by a newer click
    setLoadingKey(null);
    const ac = (acRef.current ||= new (window.AudioContext || window.webkitAudioContext)());
    try { await ac.resume(); } catch (_) {}
    if (token !== tokenRef.current) return;
    const src = ac.createBufferSource();
    src.buffer = buf; src.connect(ac.destination);
    src.onended = () => { if (srcRef.current === src) { srcRef.current = null; setPlayingKey(null); } };
    srcRef.current = src;
    setPlayingKey(key);
    src.start();
  }

  useEffect(() => () => { stop(); if (acRef.current) acRef.current.close().catch(() => {}); }, []);
  const keyOf = (kind, spec) => kind + "|" + engine.jingleToHash(spec);
  return { play, stop, playingKey, loadingKey, keyOf };
}

/* ---------------------------------------------------------------------
   Viz for the final cut (dark stage, playhead follows the <audio>)
--------------------------------------------------------------------- */
const VOICE_COLOR = { lead: "#fbbf24", counter: "#7dd3fc", arp: "#c4b5fd", bass: "#34d399", pad: "rgba(255,255,255,0.14)" };
function JingleViz({ composed, totalSec, audioRef }) {
  const canvasRef = useRef(null), rafRef = useRef(0);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !composed) return;
    const draw = () => {
      const cx = engine.fitCanvas(canvas);
      const W = canvas.clientWidth, H = canvas.clientHeight;
      cx.clearRect(0, 0, W, H);
      let lo = 120, hi = 0;
      for (const e of composed.scheduled) if (e.midi != null && e.voice !== "bass") { lo = Math.min(lo, e.midi); hi = Math.max(hi, e.midi); }
      if (hi <= lo) { lo = 55; hi = 90; }
      const x = (t) => 8 + (t / totalSec) * (W - 16);
      const y = (m) => 10 + (1 - (m - lo) / (hi - lo)) * (H - 34);
      for (const c of composed.displayCues) {
        if (c.t === 0) continue;
        cx.strokeStyle = "rgba(255,255,255,0.10)";
        cx.beginPath(); cx.moveTo(x(c.t), 6); cx.lineTo(x(c.t), H - 6); cx.stroke();
      }
      for (const e of composed.scheduled) {
        if (e.voice === "perc") { cx.fillStyle = "rgba(255,255,255,0.35)"; cx.fillRect(x(e.t), H - 10, 2, 5); }
        else if (e.voice === "pad") { cx.fillStyle = VOICE_COLOR.pad; cx.fillRect(x(e.t), y(e.midi) - 4, Math.max(2, (e.durSec / totalSec) * (W - 16)), 8); }
        else if (e.voice === "bass") { cx.fillStyle = VOICE_COLOR.bass; cx.fillRect(x(e.t), H - 18, Math.max(2, (e.durSec / totalSec) * (W - 16)), 4); }
        else {
          cx.fillStyle = VOICE_COLOR[e.voice] || "#fff";
          cx.beginPath(); cx.roundRect(x(e.t), y(e.midi) - 2.5, Math.max(3, (e.durSec / totalSec) * (W - 16)), 5, 2.5); cx.fill();
        }
      }
      const a = audioRef.current;
      if (a && a.duration > 0) {
        const px = x(Math.min(a.currentTime, totalSec));
        cx.strokeStyle = "rgba(255,255,255,0.75)"; cx.lineWidth = 1.5;
        cx.beginPath(); cx.moveTo(px, 4); cx.lineTo(px, H - 4); cx.stroke(); cx.lineWidth = 1;
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [composed, totalSec]);
  return <canvas ref={canvasRef} className="w-full h-36 rounded-xl bg-neutral-900" />;
}

/* ---------------------------------------------------------------------
   Small bits
--------------------------------------------------------------------- */
function PlayBadge({ active, loading }) {
  if (loading) return <span className="loading loading-spinner loading-xs text-primary" />;
  if (active) return <Square size={13} className="text-primary" fill="currentColor" />;
  return <Play size={13} className="opacity-40" />;
}
const cardCls = (sel) =>
  "text-left rounded-xl border p-3 transition-colors cursor-pointer " +
  (sel ? "border-primary bg-primary/10 shadow-sm" : "border-base-300 bg-base-100/80 hover:border-base-content/30");

/* ---------------------------------------------------------------------
   The app
--------------------------------------------------------------------- */
function App() {
  const initialSpec = useMemo(() => engine.jingleFromHash(location.hash), []);
  const [spec, setSpec] = useState(initialSpec || engine.normalizeJingleSpec({ text: "", seed: 0 }));
  const [step, setStep] = useState(initialSpec ? 3 : 1);
  const [maxStep, setMaxStep] = useState(initialSpec ? 3 : 1);
  const [text, setText] = useState(spec.text);           // raw input, debounced into spec
  const [tagline, setTagline] = useState(spec.tagline);
  const [motifs, setMotifs] = useState(() => engine.suggestMotifs(spec.text));
  const [baked, setBaked] = useState(null);               // { full:{...enc}, sting:{...enc} }
  const [baking, setBaking] = useState(null);             // progress text
  const [copied, setCopied] = useState(false);
  const [busyFmt, setBusyFmt] = useState(null);
  const pv = usePreview();
  const audioRef = useRef(null);
  const touchedRef = useRef(!!initialSpec);
  const bakeIdRef = useRef(0);

  const hash = useMemo(() => engine.jingleToHash(spec), [spec]);
  const arrangements = useMemo(() => engine.suggestArrangements(spec), [spec.text, spec.seed, spec.lead]);

  // URL is the recipe
  useEffect(() => {
    if (touchedRef.current) history.replaceState(null, "", location.pathname + location.search + hash);
  }, [hash]);

  // shared link opened mid-session / back-forward
  useEffect(() => {
    const onHash = () => {
      const s = engine.jingleFromHash(location.hash);
      if (!s || engine.jingleToHash(s) === engine.jingleToHash(spec)) return;
      pv.stop();
      setSpec(s); setText(s.text); setTagline(s.tagline);
      setMotifs(engine.suggestMotifs(s.text));
      setStep(3); setMaxStep(3);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [spec]);

  // debounce the name into the spec: refresh the six takes, keep the slot
  useEffect(() => {
    if (text === spec.text) return;
    const id = setTimeout(() => {
      touchedRef.current = true;
      pv.stop();
      const cards = engine.suggestMotifs(text);
      setMotifs(cards);
      const slot = cards.find((m) => m.seed === spec.seed) || cards[0];
      setSpec((s) => engine.normalizeJingleSpec({ ...s, text, ...slot }));
    }, 350);
    return () => clearTimeout(id);
  }, [text]);

  useEffect(() => {
    if (tagline === spec.tagline) return;
    const id = setTimeout(() => {
      touchedRef.current = true;
      setSpec((s) => engine.normalizeJingleSpec({ ...s, tagline }));
    }, 350);
    return () => clearTimeout(id);
  }, [tagline]);

  function update(patch, { play } = {}) {
    touchedRef.current = true;
    const next = engine.normalizeJingleSpec({ ...spec, ...patch });
    setSpec(next);
    setBaked(null);
    if (play) pv.play(play, next);
  }

  /* ---- step 3: the only render+encode ---- */
  async function bake(s = spec) {
    pv.stop();
    const id = ++bakeIdRef.current;
    setBaked(null);
    try {
      const out = {};
      for (const [cut, cutSpec] of [["full", s], ["sting", { ...s, lengthSec: STING_LEN }]]) {
        setBaking(cut === "full" ? "rendering the full cut…" : "rendering the intro sting…");
        const r = await engine.renderJingle(cutSpec);
        if (id !== bakeIdRef.current) return;
        setBaking(cut === "full" ? "encoding the full cut…" : "encoding the intro sting…");
        const enc = await engine.encodeSong(r.audioBuffer, "mp3", {});
        if (id !== bakeIdRef.current) { URL.revokeObjectURL(enc.url); return; }
        out[cut] = { ...enc, audioBuffer: r.audioBuffer, composed: r.composed, duration: r.duration, totalSec: r.totalSec };
      }
      setBaked(out);
    } catch (e) { console.error("[jingle] bake failed:", e); }
    if (id === bakeIdRef.current) setBaking(null);
  }
  useEffect(() => { if (step === 3 && !baked && !baking) bake(); }, [step]);

  function goto(n) {
    if (n > maxStep + 0) return;
    pv.stop();
    setStep(n);
  }
  function advance() {
    pv.stop();
    const n = Math.min(3, step + 1);
    setStep(n); setMaxStep((m) => Math.max(m, n));
  }

  async function download(cut, fmt) {
    const b = baked && baked[cut];
    if (!b || busyFmt) return;
    setBusyFmt(cut + fmt);
    try {
      let blob = b.blob, ext = b.ext;
      if (fmt === "wav") { blob = engine.bufferToWav(b.audioBuffer); ext = "wav"; }
      else if (fmt === "opus") { const enc = await engine.encodeSong(b.audioBuffer, "opus", {}); blob = enc.blob; ext = enc.ext; }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `jingle-${slug(spec.text)}${cut === "sting" ? "-intro" : ""}.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) { console.error("[jingle] download failed:", e); }
    setBusyFmt(null);
  }
  function copyLink() {
    navigator.clipboard.writeText(location.origin + location.pathname + hash).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1400);
    });
  }
  function share() {
    const url = location.origin + location.pathname + hash;
    if (navigator.share) navigator.share({ title: `Jingle — ${spec.text || "seeded"}`, url }).catch(() => {});
    else copyLink();
  }

  const motifSel = (m) => m.seed === spec.seed && m.key === spec.key && m.mode === spec.mode && m.tempo === spec.tempo;
  const arrSel = (a) => Object.entries(a).every(([k, v]) => spec[k] === v);

  return (
    <div className="max-w-2xl mx-auto px-5 py-8">
      <div className="jg-backdrop" />

      {/* header */}
      <header className="flex items-end justify-between mb-5 ds-up">
        <div>
          <div className="flex items-center gap-2.5">
            <Music4 size={26} className="text-primary" />
            <h1 className="ds-serif text-4xl font-semibold">Jingle</h1>
          </div>
          <p className="text-sm text-base-content/60 mt-1.5">
            Your sonic logo — 6 to 30 seconds, <em>made from your name</em>. Three steps: pick the tune,
            pick the band, share the link.
          </p>
        </div>
        <a className="link link-hover text-xs text-base-content/50 whitespace-nowrap mb-1" href="./">daysong →</a>
      </header>

      {/* stepper */}
      <ul className="steps steps-horizontal w-full text-xs mb-5 ds-up select-none">
        {[["the tune", 1], ["the band", 2], ["share", 3]].map(([label, n]) => (
          <li key={n}
            className={"step " + (step >= n ? "step-primary " : "") + (n <= maxStep ? "cursor-pointer" : "opacity-50")}
            onClick={() => n <= maxStep && goto(n)}>
            {label}
          </li>
        ))}
      </ul>

      {/* ── step 1: the tune ─────────────────────────────────────────── */}
      {step === 1 && (
        <div className="card bg-base-100/90 shadow-sm ds-up">
          <div className="card-body gap-4 p-5">
            <label className="form-control">
              <input
                className="input input-bordered input-lg ds-serif"
                placeholder="Your name, your brand, anything…"
                value={text} maxLength={80} autoFocus
                onChange={(e) => setText(e.target.value)}
              />
              <span className="label-text-alt text-base-content/40 mt-1.5">
                {text.trim() ? "the letters are the tune (K·A·L → fa–do–sol) — six takes below" : "leave empty for a pure seeded melody"}
              </span>
            </label>
            <div className="grid sm:grid-cols-2 gap-4">
              <label className="form-control">
                <input className="input input-bordered input-sm" placeholder="Tagline (optional)"
                  value={tagline} maxLength={80} onChange={(e) => setTagline(e.target.value)} />
                <span className="label-text-alt text-base-content/40 mt-1">an answering phrase — never changes the tune</span>
              </label>
              <label className="form-control">
                <select className="select select-bordered select-sm" value={spec.lead}
                  onChange={(e) => update({ lead: e.target.value }, { play: "motif" })}>
                  {LEAD_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <span className="label-text-alt text-base-content/40 mt-1">the main voice — changing it replays</span>
              </label>
            </div>

            {/* six takes */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {motifs.map((m, i) => {
                const cardSpec = engine.normalizeJingleSpec({ ...spec, ...m });
                const key = pv.keyOf("motif", cardSpec);
                return (
                  <button key={i} className={cardCls(motifSel(m))} onClick={() => update(m, { play: "motif" })}>
                    <div className="flex items-center justify-between">
                      <span className="ds-serif text-base truncate">{slug(text) === "jingle" && !text.trim() ? "seeded" : slug(text)}-{i}</span>
                      <PlayBadge active={pv.playingKey === key} loading={pv.loadingKey === key} />
                    </div>
                    <div className="text-[11px] text-base-content/50 mt-0.5">
                      {KEY_NAMES[m.key]} {MODE_NAMES[m.mode]} · {m.tempo} bpm
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="flex justify-end">
              <button className="btn btn-primary btn-sm gap-1.5" onClick={advance}>
                this one <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── step 2: the band ─────────────────────────────────────────── */}
      {step === 2 && (
        <div className="card bg-base-100/90 shadow-sm ds-up">
          <div className="card-body gap-4 p-5">
            <p className="text-sm text-base-content/60 -mb-1">
              Eight ways to dress <span className="ds-serif">“{spec.text || "your tune"}”</span> — tap to hear
              (long cuts preview a ~12s slice; you'll hear the whole thing in step 3).
            </p>
            <div className="grid grid-cols-2 gap-2">
              {arrangements.map((a, j) => {
                const cardSpec = engine.normalizeJingleSpec({ ...spec, ...a });
                const key = pv.keyOf("arr", cardSpec);
                return (
                  <button key={j} className={cardCls(arrSel(a))} onClick={() => update(a, { play: "arr" })}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium tabular-nums">{a.lengthSec}s · {padName(a.pad)}</span>
                      <PlayBadge active={pv.playingKey === key} loading={pv.loadingKey === key} />
                    </div>
                    <div className="text-[11px] text-base-content/50 mt-0.5 flex items-center gap-1.5 flex-wrap">
                      {a.perc && <span className="inline-flex items-center gap-0.5"><Drum size={11} />{a.percKit === "tabla" ? "tabla" : "drums"}</span>}
                      {a.bass && <span className="inline-flex items-center gap-0.5"><Guitar size={11} />bass</span>}
                      {a.arp && <span className="inline-flex items-center gap-0.5"><AudioWaveform size={11} />arp</span>}
                      <span>· {a.ending}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* adjust the chosen one */}
            <div className="flex flex-wrap items-center gap-4 border border-base-200 rounded-xl px-3 py-2.5">
              <span className="text-xs text-base-content/50">adjust:</span>
              <label className="flex items-center gap-2 flex-1 min-w-40">
                <input type="range" min={6} max={30} step={1} value={spec.lengthSec} className="range range-primary range-xs"
                  onChange={(e) => update({ lengthSec: +e.target.value })} />
                <span className="text-sm tabular-nums w-8 text-right">{spec.lengthSec}s</span>
              </label>
              <select className="select select-bordered select-xs" value={spec.pad}
                onChange={(e) => update({ pad: e.target.value }, { play: "arr" })}>
                {PAD_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>

            <div className="flex justify-between">
              <button className="btn btn-ghost btn-sm gap-1.5" onClick={() => goto(1)}><ArrowLeft size={14} /> the tune</button>
              <button className="btn btn-primary btn-sm gap-1.5" onClick={advance}>
                <Sparkles size={14} /> render it
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── step 3: render & share ───────────────────────────────────── */}
      {step === 3 && (
        <div className="flex flex-col gap-4 ds-up">
          {baking && (
            <div className="card bg-base-100/90 shadow-sm">
              <div className="card-body items-center gap-3 py-8">
                <Music4 size={22} className="jg-baking text-primary" />
                <p className="text-sm text-base-content/60">{baking}</p>
                <progress className="progress progress-primary w-56 h-1.5" />
              </div>
            </div>
          )}

          {baked && (
            <div className="card bg-base-100/90 shadow-sm">
              <div className="card-body gap-3 p-5">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="ds-serif text-2xl truncate">
                    {spec.text ? <>“{spec.text}”</> : <>seeded #{spec.seed}</>}
                    {spec.tagline && <span className="text-base-content/50 text-base"> — {spec.tagline}</span>}
                  </h2>
                  <span className="text-xs text-base-content/40 whitespace-nowrap tabular-nums">
                    {baked.full.duration.toFixed(1)}s +ring · {(baked.full.size / 1024).toFixed(0)} KB {baked.full.ext}
                  </span>
                </div>
                <JingleViz composed={baked.full.composed} totalSec={baked.full.totalSec} audioRef={audioRef} />
                <audio ref={audioRef} controls className="w-full" src={baked.full.url} />
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-base-content/40 mr-auto">the full cut</span>
                  {["mp3", "opus", "wav"].map((f) => (
                    <button key={f} className="btn btn-sm btn-ghost gap-1" disabled={!!busyFmt} onClick={() => download("full", f)}>
                      {busyFmt === "full" + f ? <span className="loading loading-spinner loading-xs" /> : <Download size={14} />} {f}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {baked && (
            <div className="card bg-base-100/90 shadow-sm">
              <div className="card-body gap-3 p-5">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-sm font-medium">intro sting</h3>
                  <span className="text-xs text-base-content/40 tabular-nums">
                    {baked.sting.duration.toFixed(1)}s +ring — the same tune, statement & close only
                  </span>
                </div>
                <audio controls className="w-full h-10" src={baked.sting.url} />
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-base-content/40 mr-auto">for video intros & idents</span>
                  {["mp3", "opus", "wav"].map((f) => (
                    <button key={f} className="btn btn-sm btn-ghost gap-1" disabled={!!busyFmt} onClick={() => download("sting", f)}>
                      {busyFmt === "sting" + f ? <span className="loading loading-spinner loading-xs" /> : <Download size={14} />} {f}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {baked && (
            <div className="card bg-base-100/90 shadow-sm">
              <div className="card-body gap-3 p-5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button className="btn btn-sm btn-outline gap-1.5" onClick={copyLink}>
                    {copied ? <Check size={14} /> : <LinkIcon size={14} />} {copied ? "copied" : "copy link"}
                  </button>
                  <button className="btn btn-sm btn-ghost gap-1.5" onClick={share}><Share2 size={14} /> share</button>
                  <button className="btn btn-sm btn-ghost gap-1.5 ml-auto" onClick={() => goto(2)}><ArrowLeft size={14} /> remix</button>
                </div>
                <p className="text-[11px] text-base-content/35">
                  This URL <em>is</em> the jingle — same link, same sound, forever (it re-bakes both cuts on arrival).
                  Rendered in your browser by the <a className="link" href="./#/roster">Daysong engine</a>; no samples, no server.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      <footer className="text-center text-[11px] text-base-content/35 mt-8">
        want a whole piece instead? <a className="link" href="./">get your daysong →</a>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
