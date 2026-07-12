# METALEARNINGS

Generalized principles inferred from human feedback while building Daysong — the
things the human turned out to care about, written as **portable rules**, not a
task log. Load this alongside `AGENTS.md` and apply pre-emptively. When a
correction happens, distill what it *generalizes to* and add it here.

## The creative artifact is sacred

- When porting or refactoring code that produces a creative output (sound, image,
  layout), **preserve the output exactly**. Move the I/O boundary, not the math.
  "Reactize it / refactor it" means *change the wiring, not the artifact.*
- A quality trade is only acceptable when it is **explicitly opted into** and
  **honestly bounded** ("barely perceptible", named limits). Never silently
  downgrade fidelity — no accidental mono, no quietly-lower bitrate. Match the
  quality bar of the medium (stereo, appropriate sample rate) by default.
- Before you can safely change such code, build a **regression oracle** for the
  artifact and prove it stays within tolerance.

## Measure, then claim. Name the limits.

- Benchmark before asserting a win, and report the **real** bottleneck even when
  it's not the one asked about (e.g. "encode isn't the long pole, render is").
- State tradeoffs and ceilings plainly. If the requested target (e.g. "10×
  barely-perceptibly") isn't reachable with acceptable quality, **say so and give
  the achievable range**, rather than overpromising or quietly missing it.
- Prefer honest, self-consistent evidence (peak/RMS, decode-checks, timings) over
  vibes. Distinguish *deterministic* from *statistically-stable* results.

## Surface conflicts; don't override an explicit instruction

- When two instructions collide (e.g. "make it private" vs "publish to Pages on a
  free plan"), **stop and present the conflict + options** instead of silently
  reverting one. The human's explicit choice wins; your job is to make its
  consequences visible and offer paths forward.

## Determinism, reproducibility, shareability

- Prefer **reproducible artifacts over ephemeral live state**: pre-render/one-shot
  over live streaming; a seed + settings that regenerate the exact same result.
- **Navigable state lives in the URL**, deep-linkable and bookmarkable — the
  identity of the thing (the seed) in the path, the knobs in the query.
- Seed all randomness; a "random" feature should still be reproducible from its
  recorded seed.

## Evolve in safe, small, testable pieces

- The human wants code that can be **worked on in pieces**. Split along real seams
  (composition / audio / encoding / viz), keep a thin barrel so the public surface
  never moves, and isolate the part they'll iterate on (here: `voices.js`).
- Refactor under TDD: golden-master first, then move verbatim in small steps,
  green at every step, commit per step so regressions bisect trivially.
- Choose the **right invariant for the medium**: bit-exact for pure logic; a
  perceptual fingerprint within tolerance for non-reproducible DSP. A too-strict
  oracle (hashing non-deterministic audio) is worse than a well-chosen loose one.

## Minimal, portable, convention-based tooling

- **No frameworks/deps** where a tiny purpose-built harness will do; keep tests
  **runnable in both Node and the browser**, skipping what an environment can't do.
- Prefer **flat, convention-driven layouts** (a single folder of peers,
  `foo.js` ↔ `foo-test.js`) over deep nesting.
- Keep the no-build, CDN-only constraint intact; don't reach for a bundler.

## Real previews and real-time feedback

- Previews/demos must exercise the **real code path**, not a separate mock (the
  roster auditions through the actual engine).
- Even internal/dev tools deserve **live visual feedback** — progress bars,
  incremental results as work happens — not just a console log or an end-state
  dump. If a long process only reports at the end, that's a gap to fix.

## Generalize prototypes by porting their verdicts, not just their code

- When a one-off prototype (e.g. ident-lab's sonic logo) graduates into a
  general feature, its **locked human verdicts become the defaults** of the
  general thing (the "kal · F · 112 · chime" verdict is the `bright` vibe and
  the default key). The prototype's creative DNA — mapping rules like
  letter→degree, envelope shapes, section grammar — is ported faithfully;
  only the wiring is adapted to the host engine's conventions.
- "Shareable" implies **deterministic**: if the human asks for a shareable
  artifact, treat every input (text, knobs, dice) as part of a reproducible,
  versioned recipe from day one — and pin the recipe contract with tests so a
  shared URL can never silently change meaning (evolve via version bump, not
  golden re-record).

## Ground proposals in the actual code; explain the why

- When suggesting directions (new instruments, optimizations), map them onto the
  **existing primitives and structure**, and explain the reasoning — don't hand
  back generic advice detached from the codebase.
