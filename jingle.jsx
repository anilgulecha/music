// Jingle — your sonic logo, made from your name. (the jingle.html app)
//
// Same model as Daysong: NO live tuning. Type a name, pick a vibe and a
// length → Generate: the whole jingle is composed + rendered offline through
// the real engine (engine/jingle.js → renderSegment → voices), encoded to
// MP3 in memory, then played from the blob. WAV/Opus encode on demand.
// The URL is the recipe: #/j/<text>/<seed>?knobs — deterministic, shareable.

import React, { useState, useEffect, useRef, useMemo } from "react";
import { createRoot } from "react-dom/client";
import {
  Sparkles, Download, Dices, Link as LinkIcon, Check, Music4,
  Share2, RefreshCw, SlidersHorizontal,
} from "https://esm.sh/lucide-react@0.460.0?external=react";
import * as engine from "engine";

/* ---------------------------------------------------------------------
   Option lists
--------------------------------------------------------------------- */
const KEY_OPTS = [
  [0, "C"], [1, "C♯"], [2, "D"], [3, "E♭"], [4, "E"], [5, "F"],
  [6, "F♯"], [7, "G"], [8, "A♭"], [9, "A"], [10, "B♭"], [11, "B"],
];
const MODE_OPTS = [
  ["ionian", "Ionian (major)"], ["lydian", "Lydian"], ["mixolydian", "Mixolydian"],
  ["dorian", "Dorian"], ["aeolian", "Aeolian (minor)"], ["harmonicMinor", "Harmonic minor"],
  ["melodicMinor", "Melodic minor"], ["phrygian", "Phrygian"],
];
const LEAD_OPTS = [
  ["chime", "Chime (ident bell)"], ["marimba", "Marimba"], ["bell", "Bell (FM)"],
  ["nylon", "Nylon (pluck)"], ["soft", "Soft"], ["glass", "Glass (FM bell)"],
  ["reed", "Reed"], ["breath", "Breath"], ["keys", "Keys (e-piano)"],
  ["brass", "Brass"], ["organ", "Organ"], ["pure", "Pure (sine)"],
  ["bansuri", "Bansuri"], ["whistle", "Whistle"], ["santoor", "Santoor"],
  ["sarangi", "Sarangi"], ["shehnai", "Shehnai"], ["harmonium", "Harmonium"],
];
const PAD_OPTS = [
  ["", "None"], ["warm", "Warm"], ["halo", "Halo"], ["choir", "Choir"],
  ["strings", "Strings"], ["hollow", "Hollow"], ["tanpura", "Tanpura"],
];
const VIBE_BLURBS = {
  bright: "the classic ident — chime, warm pad, a little sparkle",
  playful: "marimba skips in lydian, quick and grinning",
  warm: "soft and unhurried — no drums, all glow",
  bold: "brass and strings — announces something",
  dreamy: "FM bells in a big wash of reverb",
  classic: "e-piano and strings — timeless, tasteful",
  desi: "bansuri over a tanpura drone, tabla underneath",
  minimal: "one pure voice, nothing else",
};
const KNOB_KEYS = ["tempo", "key", "mode", "lead", "pad", "bass", "perc", "arp", "percKit", "ending", "reverb", "echo", "humanity"];

const slug = (t) => (t || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "jingle";
const specDiff = (full, base) => {
  const o = {};
  for (const k of KNOB_KEYS) if (full[k] !== base[k]) o[k] = full[k];
  return o;
};
function readHash() {
  const s = engine.jingleFromHash(location.hash);
  if (!s) return null;
  const base = { text: s.text, tagline: s.tagline, lengthSec: s.lengthSec, vibe: s.vibe, seed: s.seed };
  return { base, overrides: specDiff(s, engine.normalizeJingleSpec(base)) };
}

/* ---------------------------------------------------------------------
   Viz: note map on a dark stage + playhead following the <audio>
--------------------------------------------------------------------- */
const VOICE_COLOR = {
  lead: "#fbbf24", counter: "#7dd3fc", arp: "#c4b5fd", bass: "#34d399", pad: "rgba(255,255,255,0.14)",
};
function JingleViz({ composed, totalSec, audioRef }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !composed) return;
    const draw = () => {
      const cx = engine.fitCanvas(canvas);
      const W = canvas.clientWidth, H = canvas.clientHeight;
      cx.clearRect(0, 0, W, H);
      const notes = composed.scheduled;
      let lo = 120, hi = 0;
      for (const e of notes) if (e.midi != null && e.voice !== "bass") { lo = Math.min(lo, e.midi); hi = Math.max(hi, e.midi); }
      if (hi <= lo) { lo = 55; hi = 90; }
      const x = (t) => 8 + (t / totalSec) * (W - 16);
      const y = (m) => 10 + (1 - (m - lo) / (hi - lo)) * (H - 34);
      // section separators
      for (const c of composed.displayCues) {
        if (c.t === 0) continue;
        cx.strokeStyle = "rgba(255,255,255,0.10)";
        cx.beginPath(); cx.moveTo(x(c.t), 6); cx.lineTo(x(c.t), H - 6); cx.stroke();
      }
      for (const e of notes) {
        if (e.voice === "perc") {
          cx.fillStyle = "rgba(255,255,255,0.35)";
          cx.fillRect(x(e.t), H - 10, 2, 5);
        } else if (e.voice === "pad") {
          cx.fillStyle = VOICE_COLOR.pad;
          cx.fillRect(x(e.t), y(e.midi) - 4, Math.max(2, (e.durSec / totalSec) * (W - 16)), 8);
        } else if (e.voice === "bass") {
          cx.fillStyle = VOICE_COLOR.bass;
          cx.fillRect(x(e.t), H - 18, Math.max(2, (e.durSec / totalSec) * (W - 16)), 4);
        } else {
          cx.fillStyle = VOICE_COLOR[e.voice] || "#fff";
          const w = Math.max(3, (e.durSec / totalSec) * (W - 16));
          cx.beginPath();
          cx.roundRect(x(e.t), y(e.midi) - 2.5, w, 5, 2.5);
          cx.fill();
        }
      }
      // playhead
      const a = audioRef.current;
      if (a && a.duration > 0) {
        const px = x(Math.min(a.currentTime, totalSec));
        cx.strokeStyle = "rgba(255,255,255,0.75)";
        cx.lineWidth = 1.5;
        cx.beginPath(); cx.moveTo(px, 4); cx.lineTo(px, H - 4); cx.stroke();
        cx.lineWidth = 1;
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [composed, totalSec]);

  return <canvas ref={canvasRef} className="w-full h-36 rounded-xl bg-neutral-900" />;
}

/* ---------------------------------------------------------------------
   The app
--------------------------------------------------------------------- */
function App() {
  const initial = useMemo(readHash, []);
  const [base, setBase] = useState(initial ? initial.base : { text: "", tagline: "", lengthSec: 12, vibe: "bright", seed: 1 });
  const [overrides, setOverrides] = useState(initial ? initial.overrides : {});
  const [advanced, setAdvanced] = useState(initial ? Object.keys(initial.overrides).length > 0 : false);
  const [status, setStatus] = useState("idle");        // idle | baking | ready | error
  const [prog, setProg] = useState(null);
  const [result, setResult] = useState(null);
  const [stale, setStale] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busyFmt, setBusyFmt] = useState(null);
  const audioRef = useRef(null);
  const touchedRef = useRef(!!initial);
  const bakingRef = useRef(false);

  const merged = useMemo(() => engine.normalizeJingleSpec({ ...base, ...overrides }), [base, overrides]);
  const hash = useMemo(() => engine.jingleToHash(merged), [merged]);

  // URL is the recipe: write it on every change (once the user has touched anything)
  useEffect(() => {
    if (touchedRef.current) history.replaceState(null, "", location.pathname + location.search + hash);
  }, [hash]);

  // a shared link opened mid-session (or back/forward) re-installs + re-bakes
  useEffect(() => {
    const onHash = () => {
      const h = readHash();
      if (!h) return;
      const incoming = engine.normalizeJingleSpec({ ...h.base, ...h.overrides });
      if (engine.jingleToHash(incoming) === engine.jingleToHash(merged)) return;
      setBase(h.base); setOverrides(h.overrides);
      generate({ ...h.base, ...h.overrides });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [merged]);

  // opened via a shared link → bake it right away
  useEffect(() => { if (initial) generate({ ...initial.base, ...initial.overrides }); }, []);

  async function generate(spec = merged) {
    if (bakingRef.current) return;
    bakingRef.current = true;
    setStatus("baking"); setProg({ phase: "composing", progress: 0 });
    try {
      const r = await engine.renderJingle(spec, { onProgress: setProg });
      const enc = await engine.encodeSong(r.audioBuffer, "mp3", { onProgress: setProg });
      setResult((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return { ...enc, audioBuffer: r.audioBuffer, composed: r.composed, spec: r.spec, duration: r.duration, totalSec: r.totalSec };
      });
      setStatus("ready"); setStale(false);
    } catch (e) {
      console.error("[jingle] generate failed:", e);
      setStatus("error");
    }
    bakingRef.current = false;
  }

  function touch(fn) { touchedRef.current = true; fn(); if (status === "ready") setStale(true); }
  const setB = (patch) => touch(() => setBase((b) => ({ ...b, ...patch })));
  const setK = (k, v) => touch(() => setOverrides((o) => ({ ...o, [k]: v })));
  const setVibe = (v) => touch(() => { setBase((b) => ({ ...b, vibe: v })); setOverrides({}); });

  async function download(fmt) {
    if (!result || busyFmt) return;
    setBusyFmt(fmt);
    try {
      let blob = result.blob, ext = result.ext;
      if (fmt === "wav") { blob = engine.bufferToWav(result.audioBuffer); ext = "wav"; }
      else if (fmt === "opus") { const enc = await engine.encodeSong(result.audioBuffer, "opus", {}); blob = enc.blob; ext = enc.ext; }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `jingle-${slug(result.spec.text)}.${ext}`;
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
    if (navigator.share) navigator.share({ title: `Jingle — ${merged.text || "seeded"}`, url }).catch(() => {});
    else copyLink();
  }

  const canBake = status !== "baking";
  const knob = (k) => merged[k];

  return (
    <div className="max-w-2xl mx-auto px-5 py-8">
      <div className="jg-backdrop" />

      {/* header */}
      <header className="flex items-end justify-between mb-6 ds-up">
        <div>
          <div className="flex items-center gap-2.5">
            <Music4 size={26} className="text-primary" />
            <h1 className="ds-serif text-4xl font-semibold">Jingle</h1>
          </div>
          <p className="text-sm text-base-content/60 mt-1.5">
            Your sonic logo — 6 to 30 seconds, <em>made from your name</em>. Each letter becomes a note;
            share the link and anyone can replay or download it.
          </p>
        </div>
        <a className="link link-hover text-xs text-base-content/50 whitespace-nowrap mb-1" href="./">daysong →</a>
      </header>

      {/* inputs */}
      <div className="card bg-base-100/90 shadow-sm ds-up">
        <div className="card-body gap-4 p-5">
          <label className="form-control">
            <input
              className="input input-bordered input-lg ds-serif"
              placeholder="Your name, your brand, anything…"
              value={base.text}
              maxLength={80}
              onChange={(e) => setB({ text: e.target.value })}
            />
            <span className="label-text-alt text-base-content/40 mt-1.5">
              {base.text.trim() ? "the letters are the tune (K·A·L → fa–do–sol)" : "leave empty for a pure seeded melody"}
            </span>
          </label>

          <div className="grid sm:grid-cols-2 gap-4">
            <label className="form-control">
              <input
                className="input input-bordered input-sm"
                placeholder="Tagline (optional)"
                value={base.tagline}
                maxLength={80}
                onChange={(e) => setB({ tagline: e.target.value })}
              />
              <span className="label-text-alt text-base-content/40 mt-1">becomes the answering phrase</span>
            </label>
            <label className="form-control">
              <div className="flex items-center gap-3">
                <input type="range" min={6} max={30} step={1} value={base.lengthSec}
                  className="range range-primary range-xs"
                  onChange={(e) => setB({ lengthSec: +e.target.value })} />
                <span className="text-sm tabular-nums w-9 text-right">{base.lengthSec}s</span>
              </div>
              <span className="label-text-alt text-base-content/40 mt-1">length</span>
            </label>
          </div>

          {/* vibes */}
          <div>
            <div className="flex flex-wrap gap-1.5">
              {Object.keys(engine.JINGLE_VIBES).map((v) => (
                <button key={v}
                  className={"btn btn-xs capitalize " + (base.vibe === v && !Object.keys(overrides).length ? "btn-primary" : base.vibe === v ? "btn-primary btn-outline" : "btn-ghost border border-base-300")}
                  onClick={() => setVibe(v)} title={VIBE_BLURBS[v]}>
                  {v}
                </button>
              ))}
            </div>
            <p className="text-xs text-base-content/40 mt-1.5">{VIBE_BLURBS[base.vibe]}{Object.keys(overrides).length ? " · customized" : ""}</p>
          </div>

          {/* advanced */}
          <div className="collapse collapse-arrow border border-base-200 rounded-xl">
            <input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />
            <div className="collapse-title text-sm flex items-center gap-2 min-h-0 py-2.5">
              <SlidersHorizontal size={14} className="opacity-50" /> Fine-tune
            </div>
            <div className="collapse-content">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                <label className="form-control">
                  <span className="label-text text-xs mb-1">Voice</span>
                  <select className="select select-bordered select-sm" value={knob("lead")} onChange={(e) => setK("lead", e.target.value)}>
                    {LEAD_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                <label className="form-control">
                  <span className="label-text text-xs mb-1">Pad</span>
                  <select className="select select-bordered select-sm" value={knob("pad")} onChange={(e) => setK("pad", e.target.value)}>
                    {PAD_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                <label className="form-control">
                  <span className="label-text text-xs mb-1">Mode</span>
                  <select className="select select-bordered select-sm" value={knob("mode")} onChange={(e) => setK("mode", e.target.value)}>
                    {MODE_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                <label className="form-control">
                  <span className="label-text text-xs mb-1">Key</span>
                  <select className="select select-bordered select-sm" value={knob("key")} onChange={(e) => setK("key", +e.target.value)}>
                    {KEY_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                <label className="form-control">
                  <span className="label-text text-xs mb-1">Tempo · {knob("tempo")}</span>
                  <input type="range" min={76} max={152} value={knob("tempo")} className="range range-xs mt-2"
                    onChange={(e) => setK("tempo", +e.target.value)} />
                </label>
                <label className="form-control">
                  <span className="label-text text-xs mb-1">Ending</span>
                  <select className="select select-bordered select-sm" value={knob("ending")} onChange={(e) => setK("ending", e.target.value)}>
                    <option value="resolved">Resolved (lands home)</option>
                    <option value="open">Open (asks a question)</option>
                  </select>
                </label>
                <div className="col-span-2 sm:col-span-3 flex flex-wrap items-center gap-4">
                  {[["bass", "bass"], ["perc", "drums"], ["arp", "arp"]].map(([k, l]) => (
                    <label key={k} className="label cursor-pointer gap-2 py-0">
                      <input type="checkbox" className="toggle toggle-xs toggle-primary" checked={!!knob(k)} onChange={(e) => setK(k, e.target.checked)} />
                      <span className="label-text text-xs">{l}</span>
                    </label>
                  ))}
                  {knob("perc") && (
                    <label className="label cursor-pointer gap-2 py-0">
                      <input type="checkbox" className="toggle toggle-xs" checked={knob("percKit") === "tabla"} onChange={(e) => setK("percKit", e.target.checked ? "tabla" : "kit")} />
                      <span className="label-text text-xs">tabla kit</span>
                    </label>
                  )}
                  <label className="flex items-center gap-2 ml-auto">
                    <span className="label-text text-xs">reverb</span>
                    <input type="range" min={0} max={0.8} step={0.05} value={knob("reverb")} className="range range-xs w-20" onChange={(e) => setK("reverb", +e.target.value)} />
                  </label>
                  <label className="flex items-center gap-2">
                    <span className="label-text text-xs">echo</span>
                    <input type="range" min={0} max={0.6} step={0.05} value={knob("echo")} className="range range-xs w-20" onChange={(e) => setK("echo", +e.target.value)} />
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* generate row */}
          <div className="flex items-center gap-2">
            <button className="btn btn-primary flex-1" disabled={!canBake} onClick={() => generate()}>
              {status === "baking"
                ? <><Music4 size={16} className="jg-baking" /> baking…</>
                : status === "ready" || status === "error"
                  ? <><RefreshCw size={16} /> Regenerate</>
                  : <><Sparkles size={16} /> Generate jingle</>}
            </button>
            <button className="btn btn-ghost btn-square" disabled={!canBake}
              title={`Variation dice — seed ${base.seed}`}
              onClick={() => { setB({ seed: 1 + Math.floor(Math.random() * 9998) }); }}>
              <Dices size={18} />
            </button>
          </div>
          {status === "baking" && prog && (
            <div className="-mt-1">
              <progress className="progress progress-primary w-full h-1.5" value={prog.progress || 0} max="1" />
              <p className="text-[11px] text-base-content/40 text-center">{prog.phase}…</p>
            </div>
          )}
          {status === "error" && <p className="text-xs text-error">Something broke while baking — check the console, then try again.</p>}
        </div>
      </div>

      {/* result */}
      {result && (
        <div className={"card bg-base-100/90 shadow-sm mt-5 ds-up " + (stale ? "opacity-60" : "")}>
          <div className="card-body gap-3 p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="ds-serif text-2xl truncate">
                {result.spec.text ? <>“{result.spec.text}”</> : <>seeded #{result.spec.seed}</>}
                {result.spec.tagline && <span className="text-base-content/50 text-base"> — {result.spec.tagline}</span>}
              </h2>
              <span className="text-xs text-base-content/40 whitespace-nowrap tabular-nums">
                {result.duration.toFixed(1)}s +ring · {(result.size / 1024).toFixed(0)} KB {result.ext}
              </span>
            </div>

            <JingleViz composed={result.composed} totalSec={result.totalSec} audioRef={audioRef} />

            <audio ref={audioRef} controls className="w-full" src={result.url} />
            {stale && <p className="text-[11px] text-warning -mt-1">knobs changed — this is the previous bake; hit Regenerate</p>}

            <div className="flex flex-wrap items-center gap-1.5">
              <button className="btn btn-sm btn-outline gap-1.5" onClick={copyLink}>
                {copied ? <Check size={14} /> : <LinkIcon size={14} />} {copied ? "copied" : "copy link"}
              </button>
              <button className="btn btn-sm btn-ghost gap-1.5" onClick={share}><Share2 size={14} /> share</button>
              <div className="ml-auto flex gap-1.5">
                {["mp3", "opus", "wav"].map((f) => (
                  <button key={f} className="btn btn-sm btn-ghost gap-1" disabled={!!busyFmt} onClick={() => download(f)}>
                    {busyFmt === f ? <span className="loading loading-spinner loading-xs" /> : <Download size={14} />} {f}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-[11px] text-base-content/35">
              This URL <em>is</em> the jingle — same link, same sound, forever. Rendered in your browser by the{" "}
              <a className="link" href="./#/roster">Daysong engine</a>; no samples, no server.
            </p>
          </div>
        </div>
      )}

      <footer className="text-center text-[11px] text-base-content/35 mt-8">
        want a whole piece instead? <a className="link" href="./">get your daysong →</a>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
