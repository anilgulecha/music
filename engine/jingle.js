/* ---------------------------------------------------------------------
   Jingle — a 6–30s sonic logo composed from a name (+ optional tagline).

   Generalizes the ident-lab prototype (kalviumjr's entry/exit idents):
   letters become the melody by the K·A·L rule — letterIndex mod 7 is a
   scale degree (K→fa, A→do, L→sol) — a seeded RNG shapes the rhythm, and
   sections stack to fit the requested length:

     statement · restatement (octave double, pad, bass) · turn (IV→V,
     arps, drums) · answer (the tagline phrase) · close (resolve or
     stay open)

   Everything renders through the REAL Daysong engine — graph.js buses +
   voices.js instruments via renderSegment — no parallel mock synth.

   Deterministic: the spec IS the jingle. Same text + knobs + seed ⇒ the
   same piece, forever; jingleToHash/jingleFromHash make a URL of it
   (versioned v=1 so the contract can evolve without breaking old links).
--------------------------------------------------------------------- */
import { A } from "./state.js";
import { RNG, clamp } from "./rng.js";
import { MODES } from "./theory.js";
import { renderSegment } from "./render.js";

export const JINGLE_VERSION = 1;
export const JINGLE_LENGTH = { min: 6, max: 30, def: 12 };

// Voices a jingle may use (all real voices.js timbres; the first five are
// the ident-lab ports). Pad '' = no pad.
export const JINGLE_LEADS = ['chime', 'marimba', 'bell', 'nylon', 'soft',
  'glass', 'reed', 'breath', 'keys', 'brass', 'organ', 'pure',
  'bansuri', 'whistle', 'santoor', 'sarangi', 'shehnai', 'harmonium'];
export const JINGLE_PADS = ['', 'warm', 'halo', 'choir', 'strings', 'hollow', 'tanpura'];
export const JINGLE_ENDINGS = ['resolved', 'open'];

/* Vibe presets: bundles of knobs for non-musicians. `bright` is the
   ident-lab locked verdict (chime · pad · perc). Explicit knobs override. */
export const JINGLE_VIBES = {
  bright:  { lead: 'chime',   pad: 'warm',    mode: 'ionian',     tempo: 112, bass: true,  perc: true,  arp: true,  percKit: 'kit',   reverb: 0.35, echo: 0.12 },
  playful: { lead: 'marimba', pad: 'halo',    mode: 'lydian',     tempo: 126, bass: true,  perc: true,  arp: true,  percKit: 'kit',   reverb: 0.30, echo: 0.18 },
  warm:    { lead: 'soft',    pad: 'choir',   mode: 'mixolydian', tempo: 96,  bass: true,  perc: false, arp: false, percKit: 'kit',   reverb: 0.40, echo: 0.10 },
  bold:    { lead: 'brass',   pad: 'strings', mode: 'ionian',     tempo: 120, bass: true,  perc: true,  arp: false, percKit: 'kit',   reverb: 0.30, echo: 0.10 },
  dreamy:  { lead: 'bell',    pad: 'halo',    mode: 'lydian',     tempo: 88,  bass: false, perc: false, arp: true,  percKit: 'kit',   reverb: 0.55, echo: 0.30 },
  classic: { lead: 'keys',    pad: 'strings', mode: 'ionian',     tempo: 104, bass: true,  perc: false, arp: false, percKit: 'kit',   reverb: 0.35, echo: 0.12 },
  desi:    { lead: 'bansuri', pad: 'tanpura', mode: 'mixolydian', tempo: 108, bass: false, perc: true,  arp: false, percKit: 'tabla', reverb: 0.45, echo: 0.15 },
  minimal: { lead: 'pure',    pad: '',        mode: 'ionian',     tempo: 100, bass: false, perc: false, arp: false, percKit: 'kit',   reverb: 0.40, echo: 0.20 },
};

const DEFAULTS = {
  text: '', tagline: '', lengthSec: JINGLE_LENGTH.def, vibe: 'bright',
  key: 5,                       // F — the ident-lab verdict
  ending: 'resolved', humanity: 0.25, seed: 1,
};

/* ---- spec ----------------------------------------------------------- */
export function normalizeJingleSpec(input = {}) {
  const given = {};
  for (const [k, v] of Object.entries(input)) if (v !== undefined && v !== null) given[k] = v;
  const vibe = JINGLE_VIBES[given.vibe] ? given.vibe : DEFAULTS.vibe;
  const s = { ...DEFAULTS, ...JINGLE_VIBES[vibe], ...given, vibe };
  s.text = String(s.text);
  s.tagline = String(s.tagline);
  s.lengthSec = clamp(Math.round(Number(s.lengthSec) || JINGLE_LENGTH.def), JINGLE_LENGTH.min, JINGLE_LENGTH.max);
  s.tempo = clamp(Math.round(Number(s.tempo) || 112), 76, 152);
  s.key = ((Math.round(Number(s.key) || 0) % 12) + 12) % 12;
  if (!MODES[s.mode]) s.mode = 'ionian';
  if (!JINGLE_LEADS.includes(s.lead)) s.lead = 'chime';
  if (!JINGLE_PADS.includes(s.pad)) s.pad = 'warm';
  s.bass = !!s.bass; s.perc = !!s.perc; s.arp = !!s.arp;
  s.percKit = s.percKit === 'tabla' ? 'tabla' : 'kit';
  if (!JINGLE_ENDINGS.includes(s.ending)) s.ending = 'resolved';
  s.reverb = clamp(Number(s.reverb) || 0, 0, 1);
  s.echo = clamp(Number(s.echo) || 0, 0, 1);
  s.humanity = clamp(Number(s.humanity) || 0, 0, 1);
  s.seed = Math.max(0, Math.round(Number(s.seed) || 0));
  return s;
}

// FNV-1a over codepoints — the text folds into the RNG seed, so both the
// words AND the dice shape the piece, deterministically.
function textHash(s) {
  let h = 2166136261 >>> 0;
  for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const fold = (h, seed) => ((h ^ Math.imul(seed + 1, 0x9E3779B9)) >>> 0);
// The motif is derived from text+seed ONLY, the answer from tagline+seed —
// so adding/editing a tagline can never change the tune of the name (the
// wizard picks the tune in step 1; later steps must not shift it).
const motifSeed = (s) => fold(textHash(s.text.toLowerCase()), s.seed);
const tagSeed = (s) => fold(textHash('\u0001' + s.tagline.toLowerCase()), s.seed);
const specSeed = (s) => ((textHash(s.text.toLowerCase() + '\n' + s.tagline.toLowerCase()) ^ Math.imul(s.seed + 1, 0x9E3779B9)) >>> 0);

// shared by composeJingle + composeMotif so the tune you audition in the
// wizard is exactly the tune the full piece states (same RNG draw order)
function deriveMotif(spec) {
  const rng = new RNG(motifSeed(spec) ^ 0x51ed270b);
  const idx = shapeContour(motifFromText(spec.text) || randomMotif(rng));
  return { idx, beats: motifRhythm(rng, idx.length) };
}

/* ---- text → motif (the K·A·L rule, generalized) --------------------- */
const charDeg = (ch) => {
  const cp = ch.codePointAt(0);
  if (cp >= 97 && cp <= 122) return (cp - 97) % 7;   // a–z: letterIndex mod 7 (K→3, A→0, L→4)
  if (cp >= 48 && cp <= 57) return (cp - 48) % 7;    // digits
  return cp % 7;                                     // any other letter glyph (unicode-friendly)
};

/** Scale degrees for a text: ≤6 letters use them all; longer texts use the
    first five + the last. Returns null for no letters at all. */
export function motifFromText(text) {
  const chars = [];
  for (const ch of String(text).toLowerCase()) if (/[\p{L}\p{N}]/u.test(ch)) chars.push(ch);
  if (!chars.length) return null;
  const use = chars.length <= 6 ? chars : [...chars.slice(0, 5), chars[chars.length - 1]];
  const degs = use.map(charDeg);
  if (degs.length === 1) degs.push((degs[0] + 4) % 7);   // a 1-letter brand still gets a 2-note call
  return degs;
}

// "just vibes" mode: no text -> a seeded motif with a singable degree walk
function randomMotif(rng) {
  const n = rng.int(3, 5);
  const degs = [rng.pick([0, 0, 2, 4])];
  for (let i = 1; i < n; i++) {
    const step = rng.weighted([[1, 3], [2, 2.5], [3, 1.5], [4, 1], [-1, 2], [-2, 1.5], [5, 0.6], [-3, 0.8]]);
    degs.push(((degs[i - 1] + step) % 7 + 7) % 7);
  }
  return degs;
}

/* Fold raw degrees into a singable contour: each note picks the octave
   (±7 diatonic steps) closest to the previous note, ties lean upward. */
function shapeContour(degs) {
  const idx = [degs[0]];
  for (let i = 1; i < degs.length; i++) {
    const prev = idx[i - 1];
    const base = Math.floor(prev / 7) * 7 + degs[i];
    let best = base, bestD = Infinity;
    for (const c of [base - 7, base, base + 7]) {
      if (c < -3 || c > 11) continue;
      const d = Math.abs(c - prev) + (c < prev ? 0.25 : 0);
      if (d < bestD) { bestD = d; best = c; }
    }
    idx.push(best);
  }
  return idx;
}

// seeded rhythm: mostly walking beats, the last note always held
function motifRhythm(rng, n) {
  const beats = [];
  for (let i = 0; i < n - 1; i++) beats.push(rng.weighted([[1, 5], [0.5, 1.6], [1.5, 1.2]]));
  beats.push(rng.weighted([[2, 2], [2.5, 3]]));
  return beats;
}

// diatonic index -> midi (base C5 zone for the lead, like ident-lab's oct 1)
function degMidi(spec, idx, oct = 0) {
  const scale = MODES[spec.mode];
  const d = ((idx % 7) + 7) % 7;
  return 72 + spec.key + scale[d] + 12 * (Math.floor((idx - d) / 7) + oct);
}

/* ---- the composer ---------------------------------------------------- */
const CHORDS = { I: [0, 2, 4], IV: [3, 5, 7], V: [4, 6, 8], HOME: [0, 2, 4, 7] };
const sum = (a) => a.reduce((s, x) => s + x, 0);

export function composeJingle(input) {
  const spec = normalizeJingleSpec(input);
  const { idx: motifIdx, beats: motifBeats } = deriveMotif(spec);
  let tagIdx = null, tagBeats = null;
  const tagDegs = motifFromText(spec.tagline);
  if (tagDegs) {
    const use = tagDegs.length <= 4 ? tagDegs : [...tagDegs.slice(0, 3), tagDegs[tagDegs.length - 1]];
    tagIdx = shapeContour(use);
    tagBeats = motifRhythm(new RNG(tagSeed(spec) ^ 0x2c1b3c6d), tagIdx.length);
  }

  // -- pick sections to fit the asked length, then micro-fit the tempo --
  const motifB = sum(motifBeats), tagB = tagIdx ? sum(tagBeats) : 0, closeB = 4, turnB = 4;
  const budget = spec.lengthSec * spec.tempo / 60;
  const plan = ['statement'];
  let beats = motifB + closeB + tagB;
  const fillers = [];
  while (beats < budget - 2 && fillers.length < 12) {
    const next = fillers.length % 2 === 0 ? 'restatement' : 'turn';
    const b = next === 'restatement' ? motifB : turnB;
    if (beats + b > budget + 2) break;
    fillers.push(next); beats += b;
  }
  plan.push(...fillers);
  if (tagIdx) plan.push('answer');
  plan.push('close');
  const tempo = clamp(beats * 60 / spec.lengthSec, Math.max(76, spec.tempo * 0.85), Math.min(152, spec.tempo * 1.15));
  const bt = 60 / tempo;

  // -- emit ------------------------------------------------------------
  const scheduled = [], displayCues = [];
  const note = (t, voice, midi, durSec, vel, energy) => scheduled.push({ t, voice, midi, durSec, vel, energy });
  const drum = (t, type, vel) => { if (spec.perc) scheduled.push({ t, voice: 'perc', type, vel }); };
  const chord = (t, degs, durSec, vel, energy) => { if (spec.pad) for (const d of degs) note(t, 'pad', degMidi(spec, d, -1), durSec, vel, energy); };
  const bass = (t, deg, durSec, vel) => { if (spec.bass) note(t, 'bass', degMidi(spec, deg, -3), durSec, vel); };

  const motif = (t0, { vel = 0.8, dbl = false } = {}) => {
    let t = t0;
    for (let i = 0; i < motifIdx.length; i++) {
      const last = i === motifIdx.length - 1;
      const durSec = motifBeats[i] * bt * 0.92;
      note(t, 'lead', degMidi(spec, motifIdx[i]), durSec, Math.min(0.95, vel * (last ? 1.06 : 1)));
      if (dbl) note(t + 0.04, 'counter', degMidi(spec, motifIdx[i], 1), durSec, 0.32);
      t += motifBeats[i] * bt;
    }
    return t;
  };

  let t = 0, restatements = 0;
  const lastMelIdx = tagIdx ? tagIdx[tagIdx.length - 1] : motifIdx[motifIdx.length - 1];
  for (const section of plan) {
    displayCues.push({ t, section });
    if (section === 'statement') {
      t = motif(t, { vel: 0.8 });
    } else if (section === 'restatement') {
      restatements++;
      const up = restatements > 1 && restatements % 2 === 0;   // later passes vary: octave shimmer swaps sides
      chord(t, CHORDS.I, motifB * bt, 0.9, 0.6);
      bass(t, 0, 2 * bt * 0.9, 0.8);
      if (motifB > 2.5) bass(t + Math.floor(motifB / 2) * bt, 0, (motifB - Math.floor(motifB / 2)) * bt * 0.9, 0.7);
      motif(t, { vel: 0.78, dbl: !up });
      if (up) note(t + 0.04, 'counter', degMidi(spec, motifIdx[0], 1), motifB * bt * 0.9, 0.22);
      for (let b = 0; b < Math.floor(motifB); b++) {
        drum(t + b * bt, 'shaker', 0.5);
        drum(t + (b + 0.5) * bt, 'shaker', 0.3);
      }
      t += motifB * bt;
    } else if (section === 'turn') {
      chord(t, CHORDS.IV, 2 * bt, 0.9, 0.7);
      chord(t + 2 * bt, CHORDS.V, 2 * bt, 0.9, 0.7);
      bass(t, 3, 2 * bt * 0.9, 0.8);
      bass(t + 2 * bt, 4, 2 * bt * 0.9, 0.8);
      if (spec.arp) {
        const cyc = [[3, 7, 5, 7], [4, 8, 6, 8]];
        for (let c = 0; c < 2; c++) for (let i = 0; i < 4; i++)
          note(t + (c * 2 + i * 0.5) * bt, 'arp', degMidi(spec, cyc[c][i]), 0.4 * bt, 0.7);
      }
      for (let b = 0; b < 4; b++) {
        if (b % 2 === 0) drum(t + b * bt, 'kick', 0.8);
        drum(t + b * bt, 'shaker', 0.5);
        drum(t + (b + 0.5) * bt, 'shaker', 0.3);
      }
      t += turnB * bt;
    } else if (section === 'answer') {
      chord(t, CHORDS.I, tagB * bt, 0.9, 0.6);
      bass(t, 0, 2 * bt * 0.9, 0.75);
      let tt = t;
      for (let i = 0; i < tagIdx.length; i++) {
        note(tt, 'lead', degMidi(spec, tagIdx[i]), tagBeats[i] * bt * 0.92, 0.82);
        tt += tagBeats[i] * bt;
      }
      t = tt;
    } else { // close
      chord(t, CHORDS.HOME, 3.6 * bt, 0.95, 0.65);
      bass(t, 0, 3 * bt, 0.85);
      drum(t, 'kick', 0.6);
      const targets = spec.ending === 'open' ? [-3, 4, 11] : [0, 7];
      let finalIdx = targets[0], bestD = Infinity;
      for (const c of targets) {
        const d = Math.abs(c - lastMelIdx) + (c < lastMelIdx ? 0.25 : 0);
        if (d < bestD) { bestD = d; finalIdx = c; }
      }
      note(t, 'lead', degMidi(spec, finalIdx), 2.5 * bt, 0.88);
      note(t + 0.05, 'counter', degMidi(spec, finalIdx, 1), 2 * bt, 0.25);
      t += closeB * bt;
    }
  }

  scheduled.sort((a, b) => a.t - b.t || (a.midi || 0) - (b.midi || 0) || (a.voice < b.voice ? -1 : 1));
  const songEnd = t + 0.6;
  const automation = [{ t: 0, tideCutoff: 18000, delayTime: Math.min(1.9, 0.75 * bt) }];
  const seed = specSeed(spec) || 1;

  const params = {
    tempo: Math.round(tempo * 100) / 100, key: String(spec.key), mode: spec.mode, meter: '4/4',
    lengthSec: songEnd, arc: 'arch', humanity: spec.humanity, swing: 0,
    mix: {
      lead: 0.85, counter: 0.55,
      pad: spec.pad ? 0.7 : 0, arp: spec.arp ? 0.55 : 0,
      bass: spec.bass ? 0.75 : 0, perc: spec.perc ? 0.6 : 0,
    },
    leadTimbre: spec.lead, padTimbre: spec.pad || 'warm', percKit: spec.percKit,
    reverb: spec.reverb, echo: spec.echo, master: 0.8, seed,
  };

  return { spec, params, scheduled, automation, displayCues, songEnd, seed, tempo: params.tempo, plan, motifIdx, motifBeats };
}

/* The bare tune — just the statement, lead only, at the spec's own tempo
   (no length fitting). What the wizard's step-1 cards audition; shares
   deriveMotif with composeJingle, so the rhythm/contour are identical. */
export function composeMotif(input) {
  const spec = normalizeJingleSpec(input);
  const { idx, beats } = deriveMotif(spec);
  const bt = 60 / spec.tempo;
  const scheduled = [];
  let t = 0;
  for (let i = 0; i < idx.length; i++) {
    const last = i === idx.length - 1;
    scheduled.push({
      t, voice: 'lead', midi: degMidi(spec, idx[i]),
      durSec: beats[i] * bt * 0.92, vel: Math.min(0.95, 0.8 * (last ? 1.06 : 1)),
    });
    t += beats[i] * bt;
  }
  const params = {
    tempo: spec.tempo, key: String(spec.key), mode: spec.mode, meter: '4/4',
    lengthSec: t + 0.4, arc: 'arch', humanity: spec.humanity, swing: 0,
    mix: { lead: 0.85, counter: 0, pad: 0, arp: 0, bass: 0, perc: 0 },
    leadTimbre: spec.lead, padTimbre: 'warm', percKit: 'kit',
    reverb: spec.reverb, echo: spec.echo, master: 0.8, seed: specSeed(spec) || 1,
  };
  const automation = [{ t: 0, tideCutoff: 18000, delayTime: Math.min(1.9, 0.75 * bt) }];
  return { spec, params, scheduled, automation, displayCues: [{ t: 0, section: 'statement' }], songEnd: t + 0.4, motifIdx: idx, motifBeats: beats };
}

/* ---- wizard suggesters (deterministic, but NOT part of the URL contract:
   the chosen values are always written into the URL explicitly, so these
   can be re-tuned later without breaking any shared link) ---------------- */

/** Six takes on a name's tune: card 0 is the anchor (F · ionian · 112 — the
    ident-lab verdict); 1–5 draw key/mode/tempo from hash(text)^i, and the
    seed itself re-rolls the rhythm. Each entry is a partial spec. */
export function suggestMotifs(text) {
  const out = [{ seed: 0, key: 5, mode: 'ionian', tempo: 112 }];
  const modes = [['ionian', 3], ['lydian', 2], ['mixolydian', 2], ['dorian', 1.5],
    ['aeolian', 1.5], ['melodicMinor', 0.6], ['harmonicMinor', 0.6]];
  const h = textHash(String(text).toLowerCase());
  for (let i = 1; i < 6; i++) {
    const r = new RNG(fold(h, i) ^ 0x6b79c1a5);
    out.push({ seed: i, key: r.int(0, 11), mode: r.weighted(modes), tempo: r.int(88, 138) });
  }
  return out;
}

const INDIAN = new Set(['bansuri', 'santoor', 'sarangi', 'shehnai', 'harmonium']);
const ARR_LENGTHS = [8, 10, 12, 15, 18, 21, 25, 30];

/** Eight arrangements for a chosen tune — lengths spread by card index (the
    length axis is fully covered); pad/band/kit/ending/space seeded from the
    motif identity. Each entry is a partial spec to merge over the current one. */
export function suggestArrangements(input) {
  const s = normalizeJingleSpec(input);
  const indian = INDIAN.has(s.lead);
  return ARR_LENGTHS.map((lengthSec, j) => {
    const r = new RNG((motifSeed(s) ^ Math.imul(j + 1, 0x9e3779b1)) >>> 0);
    const pad = r.weighted([['warm', 2], ['halo', 1.5], ['choir', 1], ['strings', 1.5],
      ['hollow', 0.7], ['tanpura', indian ? 1.5 : 0.4], ['', 0.8]]);
    const perc = r.chance(0.6);
    const tabla = r.chance(indian ? 0.5 : 0.15);   // drawn unconditionally: fixed draw count
    return {
      lengthSec, pad,
      bass: r.chance(0.75), perc, arp: r.chance(0.55),
      percKit: perc && tabla ? 'tabla' : 'kit',
      ending: r.chance(0.7) ? 'resolved' : 'open',
      reverb: Math.round(r.range(0.25, 0.6) * 20) / 20,
      echo: Math.round(r.range(0, 0.35) * 20) / 20,
    };
  });
}

/* ---- offline render through the real engine -------------------------- */
function makeAudioBuffer(numCh, length, sr) {   // same helper renderSong uses
  if (typeof AudioBuffer === 'function') {
    try { return new AudioBuffer({ numberOfChannels: numCh, length, sampleRate: sr }); } catch (_) {}
  }
  const OfflineCtx = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  return new OfflineCtx(numCh, length, sr).createBuffer(numCh, length, sr);
}

async function renderComposed(composed, opts = {}) {
  const onProgress = opts.onProgress || (() => {});
  const { spec, params, songEnd } = composed;
  const sr = opts.sampleRate || 44100;
  const revSec = opts.reverbSeconds != null ? opts.reverbSeconds : clamp(2.0 + spec.reverb * 2.0, 2.0, 3.4);
  onProgress({ phase: 'rendering', progress: 0 });
  // renderSegment reads mixes/space from A.params during its synchronous
  // buildGraph (before its first await), so set/restore like auditionVoice.
  const prevParams = A.params;
  A.params = params;
  let seg;
  try {
    seg = await renderSegment(params,
      { a: 0, b: songEnd, tail: revSec + 0.8, sampleRate: sr, reverbSeconds: revSec }, composed);
  } finally { A.params = prevParams; }
  const audioBuffer = makeAudioBuffer(2, seg.length, sr);
  audioBuffer.getChannelData(0).set(seg.channels[0]);
  audioBuffer.getChannelData(1).set(seg.channels[1]);
  onProgress({ phase: 'rendering', progress: 1 });
  return { audioBuffer, duration: songEnd, totalSec: seg.length / sr, spec, params, composed, sampleRate: sr };
}

export async function renderJingle(input, opts = {}) {
  (opts.onProgress || (() => {}))({ phase: 'composing', progress: 0 });
  return renderComposed(composeJingle(input), opts);
}

/** Render just the tune (statement, lead only) — the wizard's live preview. */
export async function renderMotif(input, opts = {}) {
  return renderComposed(composeMotif(input), { reverbSeconds: 2.0, ...opts });
}

/* ---- URL codec: one URL = one jingle (v1, versioned) ------------------ */
// #/j/<text>/<seed>?v=1&len=12&vibe=bright&…   — identity (text+seed) in the
// path, knobs in the query, vibe-default knobs omitted.
const Q = [   // [queryKey, specKey, write, read]
  ['tag', 'tagline', (v) => encodeText(v), (v) => decodeText(v)],
  ['bpm', 'tempo', String, Number],
  ['key', 'key', String, Number],
  ['mode', 'mode', String, String],
  ['lead', 'lead', String, String],
  ['pad', 'pad', String, String],
  ['bass', 'bass', (v) => (v ? '1' : '0'), (v) => v === '1'],
  ['perc', 'perc', (v) => (v ? '1' : '0'), (v) => v === '1'],
  ['arp', 'arp', (v) => (v ? '1' : '0'), (v) => v === '1'],
  ['kit', 'percKit', String, String],
  ['end', 'ending', String, String],
  ['rv', 'reverb', (v) => String(Math.round(v * 100) / 100), Number],
  ['ec', 'echo', (v) => String(Math.round(v * 100) / 100), Number],
  ['hum', 'humanity', (v) => String(Math.round(v * 100) / 100), Number],
];
const encodeText = (s) => encodeURIComponent(s).replace(/%20/g, '+');
const decodeText = (s) => decodeURIComponent(String(s).replace(/\+/g, '%20'));

export function jingleToHash(input) {
  const s = normalizeJingleSpec(input);
  const base = normalizeJingleSpec({ vibe: s.vibe });   // the vibe's own defaults
  const q = [`v=${JINGLE_VERSION}`, `len=${s.lengthSec}`];
  if (s.vibe !== DEFAULTS.vibe) q.push(`vibe=${s.vibe}`);
  for (const [qk, sk, write] of Q) {
    if (sk === 'tagline' ? s.tagline !== '' : s[sk] !== base[sk]) q.push(`${qk}=${write(s[sk])}`);
  }
  return `#/j/${encodeText(s.text)}/${s.seed}?${q.join('&')}`;
}

export function jingleFromHash(hash) {
  const m = String(hash || '').replace(/^#/, '').match(/^\/j\/([^/?]*)(?:\/(\d+))?(?:\?(.*))?$/);
  if (!m) return null;
  const spec = { text: decodeText(m[1]), seed: m[2] != null ? Number(m[2]) : 1 };
  const qs = new URLSearchParams(m[3] || '');
  if (qs.get('vibe')) spec.vibe = qs.get('vibe');
  if (qs.get('len')) spec.lengthSec = Number(qs.get('len'));
  for (const [qk, sk, , read] of Q) if (qs.has(qk)) spec[sk] = read(qs.get(qk));
  return normalizeJingleSpec(spec);
}
