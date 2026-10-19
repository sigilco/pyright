# Fence-iteration guide (scriptc-native)

How to reproduce, triage, and verify scriptc fences on the pyright bundle without paying for full builds.

## Toolchain rule (2026-10-18): upstream npm scriptc only

Use the published `scriptc` (npm `scriptc@latest`, verified 0.3.6) — NOT the `~/repos/scriptc` workspace checkout and NOT `node ~/repos/scriptc/packages/cli/dist/main.js`.

- `scriptc coverage dist-cli-dev/pyright-native.js` on the current bundle: **0 hard refusals** — `@ts-nocheck` (prepended by `make-native-bundle.mjs`) absorbs all SC0001 strictness codes (186 on raw npm 0.3.6 → 0). The `work/pyright-probe` relaxed-codes branch is no longer needed for the bundle path. Flagged gap: it remains required if we ever compile un-nocheck'd TS directly.
- 100 fences remain but are all **deferred-runtime** (SC1090/SC1101/SC2020 etc. — throw only if the site executes); many are on dead paths for the typecheck CLI (`child_process`, runtime-path `fork`, `process.mainModule`, `crypto.getRandomValues`).
- Upstream-only also kills the workspace↔published runtime-pack skew (`scr_dyn_promise_key_get` etc. undefined at link) — compiler and pack always come from the same release.
- If a genuinely missing feature is needed (e.g. a real `--jobs` knob, a partition threshold flag), flag it — do not silently build a fork branch.

Build command: `scriptc build dist-cli-dev/pyright-native.js -o /tmp/pyright-native` (same `-o` every time — see cache rules below).

## Measured rebuild curve (scriptc 0.3.6)

Synthetic program: 63MB IR, ~2500 functions, 16 partitions, npm-distributed `scriptc` 0.3.6:

| change | wall time | partitions re-emitted |
|---|---|---|
| cold build | 3m35s | 16/16 |
| one-function edit, same `-o` | 1m59s | 1/16 (15 reused from `native-v1/partitions/`) |
| no change, same `-o` | 0.5s | 0 (whole-executable cache replay) |
| no change, different `-o` | 1m59s | 0 re-emitted, but exe cache miss → full link |

Facts that shape the workflow:

- Emit parallelism in 0.3.6 is **input-dependent**: partitions only exist when the `.ll` exceeds ~4 MiB, and even then observed emit on the pyright bundle ran ~1.2 cores (two sessions, `SCRIPTC_JOBS=8` included — the env var is absent on published helpers and `--jobs` is a cap, not a switch, per upstream review). On a synthetic 18.7MB `.ll`, emit did parallelize (307% CPU / 8 partitions). Treat full-bundle emit as ~40–50min serial until proven otherwise on your input; the frontend (tsc→IR→`.ll`) is itself the serial bulk.
- The **warm partition cache is the real lever**: byte-identical input → ~4min end-to-end; any source change re-hashes the whole bundle → cold ~44min. Keep input bytes stable between builds; iterate via probes instead.
- Partition assignment is `stableHash(symbol) % count` — position-stable, so a one-line edit dirties only its partition plus partitions importing the edited symbol. Iteration cost is roughly `frontend + 1/partitions` when the same `-o` is reused.
- **Never change `-o`** between iterations: `outPath` is an executable-cache key input. Reuse one output path and diff binaries if needed.
- Partition cache lives at `~/.cache/scriptc/build/native-v1/partitions/<sha256(helper+target)[:32]>/`.
- Preflight status (2026-10-18, `@ts-nocheck` bundle): npm 0.3.6 → **0 hard refusals, 100 deferred-runtime sites** — the bundle BUILDS; remaining work is runtime fences on executed paths. Probe-first is still the live loop for fence fixes (a bundle edit = ~44min cold build).

## Portable cache (GitHub Releases)

`~/.cache/scriptc` restores across machines via two scripts in `packages/pyright/scripts/`:

```bash
cd packages/pyright
node scripts/cache-restore.mjs   # BEFORE your first build on a cold machine
node scripts/cache-publish.mjs   # after a successful cold build / bundle change
```

- **Key:** `scriptc-<scriptc-version>-<sha256(dist-cli-dev/pyright-native.js)[:16]>.tar.zst` (`.tar.gz` fallback when zstd is absent). The asset name is the whole cache key — any source change produces a new key, and a bundle byte-diff means a cold build.
- **What's inside:** the whole `build/native-v1/` subtree — `frontend/` (serialized program, ~533MB), `object/` (hash-addressed .o + .sha256), `partitions/` (per-partition .bc/.o). All entries are content-hash-named: stale entries waste disk, never corrupt.
- **Measured on this bundle (2026-10-19, 0.3.6):** cold build 47m27s → wipe cache → restore → **5.8s** (whole-program replay). A partitions-only restore gives **zero** speedup (49m06s — emit re-runs regardless); `frontend/` is the actual reuse lever, correcting the earlier "partitions drive reuse" claim — partitions only pay off on *edited* inputs.
- **RangeError caveat:** the `frontend/` entry is the same "cached program" that can throw `RangeError: Invalid string length` in `compileTracked` on very large inputs. Our 533MB entry restored+replayed fine; if a restored build crashes with that error, `rm -rf ~/.cache/scriptc/build` and rebuild cold (then republish).
- **Release:** assets live on the rolling `scriptc-cache` release tag; publish creates it if absent and prunes to the newest 3 tarballs after upload.
- **Restore semantics:** `cache-restore.mjs` prints `HIT`/`MISS` and always exits 0 — a MISS means proceed cold. Extraction is idempotent (tar over the cache root).
- **When to publish:** after every successful cold build of a new bundle (the next session will restore it), and after bundle-affecting changes land. Stale keys are pruned automatically.

Env overrides for other machines: `SCRIPTC` (scriptc binary), `GH_REPO`, `RELEASE_TAG`, `SCRIPTC_CACHE_DIR`. Requires `gh` authenticated against the repo.

## Probe-first workflow

One tiny `.js` program per fence class, compiled through the same toolchain in ~1s instead of a bundle build.

```bash
cd packages/pyright
node scripts/probe.mjs --all                       # all probes, --emit obj
node scripts/probe.mjs scripts/probes/uri-template.js --run   # compile + run, diff vs Node
```

- Default mode: `scriptc build <probe> --emit obj -o /tmp/...` — PASS if it compiles, FAIL with the SC code printed if refused. `--emit obj` skips linking and lands in ~1.5s.
- `--run` links and executes via `SCRIPTC` env (default `scriptc`; point it at the npm-distributed binary, e.g. `SCRIPTC=/tmp/sc036/node_modules/.bin/scriptc`) and byte-compares stdout+exit vs `node`.
- Mark expected divergence with a `// probe-expect: diverge` pragma → reports XFAIL/XPASS instead of FAIL.
- Current probes (`scripts/probes/`): `uri-template` (Uri→template-literal dyn-leak), `class-capture` (local class, closure capture, statics, computed getter), `map-union` (Map.get union narrowing), `fs-seam` (statSync on `uri.getFilePath()`), `stdlib-surface` (mkdir/writeFile/readdir/path/tmpdir).
- Writing a new probe: keep it <30 lines, one fence class per file, print observable output so `--run` can diff it.

## Seam-isolation test (no compile needed)

`packages/pyright-internal/src/tests/scriptcUriSeam.test.ts` instruments `toString` on `FileUri`/`WebUri`/`ConstantUri`/`EmptyUri` under plain Node jest and records the call site of every implicit-coercion hit during real analysis (`typeAnalyzeSampleFiles`). BASELINE pins the 5 known sites; any *new* site fails the test in ~1.5s — the Uri→string leak class is enumerable without touching scriptc:

```bash
cd packages/pyright-internal
PYLANCE_JEST_TRANSPILE_ONLY=1 node --max-old-space-size=8192 --expose-gc \
  ./node_modules/jest/bin/jest scriptcUriSeam --runInBand --forceExit
```

## Reduced-scope entry

`packages/pyright-internal/src/checkMain.ts` + `packages/pyright/src/checkMain.ts` + `bundle:check:flat` script → `dist-cli-dev/pyright-check-flat.js`. Single-threaded typecheck only (files/--project/--outputjson/--level/etc.; no --verifytypes/--createstub/--threads/--watch/stdin).

**Measured: 5.37MB vs 5.45MB flat bundle — only ~1.5% smaller.** The analyzer core dominates; the CLI features dropped contribute almost nothing to emit time. Kept as a convenience near-parity entry, but do NOT expect emit savings — the partition cache and probes are the real levers.

## Recommended loop

1. Reproduce the fence as a probe (<1min cycle, `--emit obj`; `--run` for behavior fences).
2. Fix the pyright-internal site; rerun the probe to verify.
3. For Uri→string leaks, run the seam jest test — no scriptc build at all.
4. Full bundle build only for parity/gate checks, always reusing the same `-o` (incremental ≈ frontend time + one partition when warm).

## Flagged as not-worth-it (days-scale)

- Shrinking the bundle meaningfully (tree-shaking the analyzer) — the 5MB is checker code, not CLI fat.
- Runtime-pack/compile skew between a workspace compiler and published packs (undefined `scr_dyn_promise_key_get`, `scr_dyn_error_string` at link) — moot under the upstream-only rule above.
