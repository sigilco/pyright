# Fence-iteration guide (scriptc-native)

How to reproduce, triage, and verify scriptc fences on the pyright bundle without paying for full builds.

## Measured rebuild curve (scriptc 0.3.6)

Synthetic program: 63MB IR, ~2500 functions, 16 partitions, npm-distributed `scriptc` 0.3.6:

| change | wall time | partitions re-emitted |
|---|---|---|
| cold build | 3m35s | 16/16 |
| one-function edit, same `-o` | 1m59s | 1/16 (15 reused from `native-v1/partitions/`) |
| no change, same `-o` | 0.5s | 0 (whole-executable cache replay) |
| no change, different `-o` | 1m59s | 0 re-emitted, but exe cache miss → full link |

Facts that shape the workflow:

- Emit is **already parallel** in 0.3.6. The earlier "~50min serial emit" figure is obsolete; the frontend (tsc→IR, ~2min for 63MB IR) is now the floor for a full build.
- Partition assignment is `stableHash(symbol) % count` — position-stable, so a one-line edit dirties only its partition plus partitions importing the edited symbol. Iteration cost is roughly `frontend + 1/partitions` when the same `-o` is reused.
- **Never change `-o`** between iterations: `outPath` is an executable-cache key input. Reuse one output path and diff binaries if needed.
- Partition cache lives at `~/.cache/scriptc/build/native-v1/partitions/<sha256(helper+target)[:32]>/`.
- The pyright bundle still refuses at preflight: npm 0.3.6 → 186 SC0001 (19s); repo probe-branch → 56 SC0001 (~5s). Builds never reach emit until those clear — probe-first is the only live loop for fence work.

## Probe-first workflow

One tiny `.js` program per fence class, compiled through the same toolchain in ~1s instead of a bundle build.

```bash
cd packages/pyright
node scripts/probe.mjs --all                       # all probes, --emit obj
node scripts/probe.mjs scripts/probes/uri-template.js --run   # compile + run, diff vs Node
```

- Default mode: `node ~/repos/scriptc/packages/cli/dist/main.js build <probe> --emit obj -o /tmp/...` — PASS if it compiles, FAIL with the SC code printed if refused. Obj emit skips linking, so it works even while the workspace compiler/runtime packs are version-skewed.
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
- Runtime-pack/compile skew between the workspace compiler and published 0.3.6 (undefined `scr_dyn_promise_key_get`, `scr_dyn_error_string` at link) — a scriptc-side versioning fix, not ours.
