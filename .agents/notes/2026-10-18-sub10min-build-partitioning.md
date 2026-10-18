# Sub-10-minute cold builds — decomposition assessment (2026-10-18)

Goal: turn the ~44–50min uncached `scriptc build` of `dist-cli-dev/pyright-native.js` (~5.46MB) into uncached units of ≤~10min each. Research/design only — no implementation committed.

Sources: measured numbers from `docs/iteration-guide.md` and `2026-10-18-partitioned-build-evidence.md` (do not re-measure); fresh cheap probes this session (esbuild metafile analysis, `scriptc build --help`, `--lib` profile probing, scriptc CLI docs).

## What actually drives the 44min

1. **Serial frontend** — tsc→IR→`.ll` serialization is the bulk of the wall (single tsc process, ~1 core). Codegen emit partitions only exist above ~4MiB `.ll`, and even when they exist, observed emit ran ~1.2 cores (68–256 partitions, count varies per run) — so partitioning neither parallelizes nor bounds cold time on this input.
2. **Input bytes, not code "shape"** — checkMain variant (5.37MB vs 5.46MB, −1.5%) proved dropping CLI surfaces buys ~nothing. The bundle composition (esbuild metafile, this session):

   | component | MB | share |
   |---|---|---|
   | analyzer/ (typeEvaluator 850kb, checker 225kb, typeUtils, types, typeGuards, …) | 2.62 | 48.7% |
   | **localization/*.nls.*.json (15 locales, inlined)** | **1.99** | **37.1%** |
   | parser/ | 0.36 | 6.7% |
   | pyright-internal other | 0.28 | 5.1% |
   | vendor (already aliased to scriptcCompat shims) | 0.11 | 2.0% |

   The 5MB is not CLI fat — but **~2MB of it is JSON string tables**, not code. Static `import xxStrings from './package.nls.xx.json'` in `localize.ts` inlines every locale into the compiled module; `loadStringsForLocale` picks one at runtime from `LC_ALL/LANG`.

3. **Per-partition fixed cost × serial emit** — 68–256 partitions at ~1.2 cores is the codegen-side wall; partition count varies per run and is not user-controllable (no knob in 0.3.6; `--jobs`/`SCRIPTC_JOBS` upstream proposal did NOT multiply cores on this bundle).

## Axis verdicts

### 1. Split into independently compiled units (`--lib` + link) — NOT VIABLE today

- `--emit=obj` produces a *program object*: a whole program with runtime functions left undefined, linkable only with the exact runtime pack from `--print=native-link-info`. It is "not a standalone library" (CLI docs) — there is no JS-module link model where unit A exports symbols unit B imports natively.
- `--lib --profile` compiles ONE entry module into a C-ABI archive (`<name>.lib.a`) for host applications (mobile/desktop embedders). Profile requires `profile_format:1`, `emission:"llvm"`, an `abi` block (prefix/exports/snapshot_format) — verified against npm 0.3.6. Exports are synchronous ABI functions.
- **Elephant:** pyright's analyzer↔checker↔parser boundary is a dense graph of JS object calls (typeEvaluator touches everything). Crossing it as a C ABI means marshalling JS values through the FFI seam per call — a rewrite, plus each archive embeds its own runtime (duplicate GC/QuickJS state, no `--import-bitcode` inlining). scriptc would need a "multi-module program, shared runtime" link mode first → flagged gap.
- Upstream-merge cost if it ever worked: high (new build system + link model).

### 2. Independent entrypoints / phase-split binaries — REJECTED as primary lever

- `checkMain` already exists: **measured −1.5% bundle, ~nothing off build time** (iteration-guide line 66).
- Splitting parser/binder/checker into separate binaries with IPC requires serializing pyright's in-memory program/type object graph — a program.ts-scale rewrite, and a permanent fork-only architecture upstream will never take. Quantified: days-to-weeks, diverges hard on any upstream re-sync.

### 3. Build-cache portability — the lever that works TODAY

- Warm path already measured: byte-identical input + same `-o` → **~4min end-to-end**; one-function edit → ~2min (partition cache reuses 15/16).
- `~/.cache/scriptc/build/native-v1/partitions/<sha256(helper+target)[:32]>/` is content-keyed → tar/restore it in CI keyed by `sha256(pyright-native.js)`; stale entries only waste disk, never corrupt.
- Known trap: cached program >512MB → `RangeError: Invalid string length` in `compileTracked` (evidence §Corroborating session). Flag upstream; workaround is `rm -rf ~/.cache/scriptc/build` (already used) — must fix for a shared-cache pipeline or warm hits die on large caches.
- Does not make *cold* fast — it makes "cold" rare. This is the honest path to "≤10min per build" in practice: one cold build on a blessed input, everything else warm.

### 4. Incremental bundling — defeated by whole-input hashing

- Confirmed in-guide: exe/partition cache keys hash the *whole input file*. Splitting into N rspack outputs only helps if each unit is a separate `scriptc` invocation whose products link — blocked by the same wall as axis 1. No repo-local fix; flagged as upstream gap (per-module compile + content-keyed unit cache).

### 5. Input-size reduction — best repo-local lever, insufficient alone

- **Localization offload:** lazy-load the 14 non-default locale JSONs (or all 15) from sibling files via `readFileSync`+`JSON.parse` inside `loadStringsForLocale` (ship `dist-cli-dev/nls/*.json` next to the binary, same as `typeshed-fallback/`). Removes ~1.9MB (37%) from scriptc input — the single biggest reducible chunk, and it is *data* (string tables → IR constants), so the frontend/IR-serialization win should be roughly proportional or better.
  - Upstream surface: `localize.ts` only — a file this fork already edits (scriptc `any`-map comments in situ). Behavior identical for `en-us`; env-locale users read JSON at first lookup. Merge cost on upstream re-sync: small, one function.
  - Est. cold build after cut: **~26–33min** (rough linear extrapolation; frontend is size-bound). Verify once; do NOT loop builds.
- Everything else is noise: vendor already shimmed (2%), checkMain proved CLI-surface cuts are ~1.5%.
- Elephant: even a 37% cut leaves ~3.5MB of analyzer+parser — the serial frontend over that is still >20min. Input trim cannot reach ≤10min alone.

### 6. scriptc-side feature gaps to flag upstream (request, don't build)

1. **Multi-module compilation + link with shared runtime** — the real unlock for ≤10min cold units (per-package units → separate `.o` → one link).
2. **Frontend (tsc→IR) parallelism or incremental per-module IR caching** — the serial bulk.
3. **Emit thread-pool actually parallelizing on real inputs** — observed ~1.2 cores through emit despite `DefaultThreadPool(hardware_concurrency())`; `--jobs` bound did not change it.
4. **Partition-count knob / cap** — count varies 68–256 per run with per-partition fixed cost; a cap would bound serial emit.
5. **`compileTracked` >512MB `RangeError` on cache hit** — blocks any shared-cache pipeline.
6. (Carried) relaxed tsc strictness codes for un-nocheck'd TS — workspace-only today.

## Ranked recommendation

| rank | option | est. cold unit time | upstream difficulty | maintenance |
|---|---|---|---|---|
| 1 | Cache-as-pipeline: sha256(input)-keyed `~/.cache/scriptc` restore + blessed-bundle cold build (fix/flag RangeError) | ~4min warm / one ~44min cold per input change | none (repo/CI only) | low |
| 2 | nls-JSON lazy-load offload (−37% input) → stacks with 1 | ~26–33min cold; ~2–3min warm | low (localize.ts only) | low |
| 3 | Upstream asks #1+#2 (multi-module units / frontend parallelism) — the only route to true ≤10min cold | units ~5–15min each *if* module-link lands | high (upstream feature) | medium |
| 4 | `--emit=obj`/`--lib` multi-unit link | n/a — model doesn't exist | blocked | — |
| 5 | Phase-split binaries + IPC | n/a — rewrite | rejected | high |
| 6 | Extra entrypoints (checkMain etc.) | ~same (measured −1.5%) | low | low — keep as convenience only |

**Recommended decomposition (when/if module-link exists, and to structure the input trim now):**

- Unit `analyzer-core` (~2.6MB): `analyzer/**` incl. typeEvaluator — cannot subdivide further; internal call density is the reason module-link must share one runtime.
- Unit `parser` (~0.36MB): parser/tokenizer/unicode — clean leaf.
- Unit `cli-shell` (~0.4MB): service/program glue + CLI + scriptcCompat shims.
- Unit `nls` (~2.0MB): **remove from compilation entirely** via lazy JSON (rank 2) — do it now regardless.
- Expected per-unit cold, post-offload: ~5–15min scaled by size — analyzer-core still the long pole → upstream gap #2 needed for true ≤10.

## Concrete next steps (not done here)

0. **First**: resolve the `SC1090` on `TomlDate` (smol-toml shim or pin) — the current fresh bundle does not compile at all.
1. Implement nls lazy-load behind the existing scriptcCompat seam; rebuild flat bundle; confirm ~3.5MB input; run ONE cold build to re-baseline.
2. Stand up CI cache step: `key = scriptc-cache-{hash(pyright-native.js)}-{hash(scriptc-version)}` over `~/.cache/scriptc`; keep stable `-o` everywhere.
3. File upstream issues for the six flagged gaps (especially #1 multi-module link, #5 RangeError).
4. Keep probe-first loop for runtime fences — unchanged.

## emit=llvm probe result (this session)

`scriptc build dist-cli-dev/pyright-native.js --emit=llvm` on a **fresh** bundle (rebuilt this session via `bundle:cli:flat` + `make-native-bundle.mjs`, npm scriptc 0.3.6) **hard-refused at 2m32s**:

- `SC1090` at `pyright-native.js:50` — `smol-toml`'s `TomlDate = class _TomlDate extends Date` (function-local class with private brand `#hasDate`). Earlier sessions' bundle evidently didn't contain this input path (or was built differently); `@ts-nocheck` absorbs strictness codes, NOT structural refusals like SC1090.
- Implication for this assessment: the "0 hard refusals → it builds" claim in the iteration guide is bundle-version-specific. Any input-split plan must re-run `scriptc coverage`/`--emit=llvm` on the *actual* bundle first — new vendored code can introduce hard refusals that dwarf partitioning concerns. smol-toml appears in the bundle via config-file parsing (pyproject.toml); a compat shim or a pinned smol-toml version may be needed before ANY cold build completes.
- Side datapoint: refusal surfaced at ~2.5min of frontend work — cheap enough that an `--emit=llvm` preflight gate is viable before paying for a full build.
