// Jingle suite: the composer is pinned bit-exact (rounded 1e-6) against a
// golden battery — a jingle URL must reproduce forever (v1 contract). The
// browser part fingerprints two full renders (perceptual, within tolerance).
// Record:  node engine/jingle-test.js --record   /  tests.html?record
import { test, eq, assert, RECORD, recordGolden, loadGolden } from "./testkit.js";
import {
  composeJingle, renderJingle, composeMotif, renderMotif,
  suggestMotifs, suggestArrangements, motifFromText, normalizeJingleSpec,
  jingleToHash, jingleFromHash, JINGLE_VIBES, JINGLE_LENGTH, JINGLE_PADS,
} from "./engine.js";
import { MODES } from "./theory.js";
import { fingerprint, closeFP } from "./audio-fp.js";

const r6 = (x) => +(+x).toFixed(6);

// The battery: texts short/long/unicode/empty, taglines, every knob exercised.
export const JINGLE_CASES = {
  "kal-bright-9s":   { text: "kal", lengthSec: 9 },
  "default-daysong": { text: "daysong" },
  "acme-tagline":    { text: "Acme Corp", tagline: "we build rockets", lengthSec: 18, vibe: "bold" },
  "long-30s-playful": { text: "wonderfully long brand name", lengthSec: 30, vibe: "playful", seed: 7 },
  "no-text-seeded":  { text: "", seed: 42, vibe: "dreamy", lengthSec: 10 },
  "desi-open":       { text: "chai point", vibe: "desi", ending: "open", lengthSec: 15 },
  "unicode-minimal": { text: "కాఫీ ☕ 42", vibe: "minimal", lengthSec: 6 },
  "warm-custom":     { text: "Nora", vibe: "warm", lead: "nylon", key: 9, mode: "dorian", lengthSec: 21, seed: 3 },
};

function snapshot(spec) {
  const c = composeJingle(spec);
  return {
    tempo: r6(c.tempo), songEnd: r6(c.songEnd), plan: c.plan,
    events: c.scheduled.map((e) => [r6(e.t), e.voice, e.midi != null ? e.midi : e.type, r6(e.durSec || 0), r6(e.vel)]),
  };
}

/* ---- pure (Node + browser) ------------------------------------------- */
test("the K·A·L rule is pinned (letterIndex mod 7)", () => {
  eq(motifFromText("kal"), [3, 0, 4]);                    // K·A·L → fa–do–sol, the ident-lab verdict
  eq(motifFromText("daysong"), [3, 0, 3, 4, 0, 6]);       // >6 letters: first five + last
  eq(motifFromText("a"), [0, 4]);                         // 1 letter gets a fifth answered
  eq(motifFromText("42"), [4, 2]);                        // digits map too
  eq(motifFromText("!! — !!"), null);                     // no letters -> null (seeded motif instead)
});

test("composeJingle is deterministic", () => {
  for (const spec of Object.values(JINGLE_CASES)) eq(snapshot(spec), snapshot(spec));
});

test("URL round-trips: jingleFromHash(jingleToHash(s)) === normalize(s)", () => {
  for (const spec of Object.values(JINGLE_CASES)) {
    eq(jingleFromHash(jingleToHash(spec)), normalizeJingleSpec(spec));
  }
  eq(jingleFromHash("#/nope"), null);
  eq(jingleFromHash("#/j/hello+world/5?v=1&len=8"),
    normalizeJingleSpec({ text: "hello world", seed: 5, lengthSec: 8 }));
});

test("every length × vibe lands in the 6–30s envelope, events inside the song", () => {
  for (const vibe of Object.keys(JINGLE_VIBES)) {
    for (let len = JINGLE_LENGTH.min; len <= JINGLE_LENGTH.max; len += 4) {
      for (const text of ["kal", "a much longer brand name here", ""]) {
        const c = composeJingle({ text, vibe, lengthSec: len, tagline: len % 8 === 0 ? "the tag" : "", seed: len });
        assert(c.songEnd >= 5 && c.songEnd <= 31.5, `${vibe}/${len}/"${text}": songEnd ${c.songEnd}`);
        assert(Math.abs(c.songEnd - len) <= 4.5, `${vibe}/${len}/"${text}": missed ask by ${Math.abs(c.songEnd - len)}`);
        let prev = -1;
        for (const e of c.scheduled) {
          assert(e.t >= prev - 1e-9, "events sorted");
          assert(e.t < c.songEnd, "event starts inside the song");
          assert(e.vel > 0 && e.vel <= 1, "vel in (0,1]");
          prev = e.t;
        }
      }
    }
  }
});

test("the tagline never changes the name's tune", () => {
  for (const text of ["acme", "wonderfully long brand name", ""]) {
    const bare = composeJingle({ text, seed: 3 });
    const tagged = composeJingle({ text, seed: 3, tagline: "totally different words" });
    eq(tagged.motifIdx, bare.motifIdx, text);
    eq(tagged.motifBeats, bare.motifBeats, text);
  }
});

test("composeMotif states exactly the tune of the full piece", () => {
  for (const spec of Object.values(JINGLE_CASES)) {
    const m = composeMotif(spec), full = composeJingle(spec);
    eq(m.motifIdx, full.motifIdx);
    eq(m.motifBeats, full.motifBeats);
    for (const e of m.scheduled) assert(e.voice === "lead", "motif preview is lead-only");
    assert(m.scheduled.length === m.motifIdx.length, "one note per degree");
  }
});

test("suggestMotifs: 6 deterministic takes, card 0 is the anchor", () => {
  for (const text of ["kal", "Acme Corp", ""]) {
    const a = suggestMotifs(text), b = suggestMotifs(text);
    eq(a, b, "deterministic");
    assert(a.length === 6, "six cards");
    eq(a[0], { seed: 0, key: 5, mode: "ionian", tempo: 112 }, "anchor = ident verdict");
    for (const m of a) {
      assert(m.key >= 0 && m.key <= 11 && MODES[m.mode] && m.tempo >= 88 && m.tempo <= 138 + 1, "fields valid");
      eq(normalizeJingleSpec({ text, ...m }).mode, m.mode, "normalize keeps it");
    }
  }
});

test("suggestArrangements: 8 deterministic cards, the length axis fully covered", () => {
  for (const base of [{ text: "kal" }, { text: "gulecha", lead: "bansuri", seed: 4 }]) {
    const a = suggestArrangements(base), b = suggestArrangements(base);
    eq(a, b, "deterministic");
    assert(a.length === 8, "eight cards");
    eq(a.map((x) => x.lengthSec), [8, 10, 12, 15, 18, 21, 25, 30], "length spread");
    for (const arr of a) {
      assert(JINGLE_PADS.includes(arr.pad), "pad valid");
      const n = normalizeJingleSpec({ ...base, ...arr });
      eq(n.lengthSec, arr.lengthSec, "normalize keeps length");
      eq(n.pad, arr.pad, "normalize keeps pad");
    }
  }
});

/* ---- goldens ---------------------------------------------------------- */
if (RECORD) {
  test("record jingle golden", async () => {
    const out = {};
    for (const [name, spec] of Object.entries(JINGLE_CASES)) out[name] = snapshot(spec);
    await recordGolden("jingle", out);
  });
  test.browser("record jingle render golden", async () => {
    const out = {};
    for (const name of ["default-daysong", "acme-tagline"]) {
      const r = await renderJingle(JINGLE_CASES[name], { sampleRate: 44100 });
      out[name] = fingerprint(r.audioBuffer);
    }
    await recordGolden("jingle-render", out);
  });
} else {
  test("composeJingle matches golden (bit-exact, rounded 1e-6)", async () => {
    const want = await loadGolden("jingle");
    for (const [name, spec] of Object.entries(JINGLE_CASES)) eq(snapshot(spec), want[name], name);
  });
  test.browser("renderJingle matches golden (perceptual fingerprint)", async () => {
    const want = await loadGolden("jingle-render");
    for (const name of Object.keys(want)) {
      const r = await renderJingle(JINGLE_CASES[name], { sampleRate: 44100 });
      const errs = closeFP(fingerprint(r.audioBuffer), want[name]);
      if (errs.length) throw new Error(`${name}: ${errs.join("; ")}`);
    }
  });
  test.browser("renderMotif is deterministic (within tolerance) and audible", async () => {
    const spec = { text: "Acme Corp", lead: "marimba", tempo: 120 };
    const a = fingerprint((await renderMotif(spec)).audioBuffer);
    const b = fingerprint((await renderMotif(spec)).audioBuffer);
    const errs = closeFP(a, b);
    if (errs.length) throw new Error(errs.join("; "));
    if (!(a.peak > 0.05)) throw new Error("motif preview is silent: peak " + a.peak);
  });
}
