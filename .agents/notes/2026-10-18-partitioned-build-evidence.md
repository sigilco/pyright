# Partitioned scriptc build — evidence record (2026-10-18)

Collected per request so future sessions don't re-derive this. All numbers measured on the Devin box, `work/scriptc-native` @ `092921cb5`.

## 1. Exact invocation

```bash
cd packages/pyright
pnpm run bundle:cli:flat                                  # esbuild flat ESM -> dist-cli-dev/pyright-flat.js
node scripts/make-native-bundle.mjs                       # -> dist-cli-dev/pyright-native.js (banner strip, builtin remap, for-in->Object.keys, @ts-nocheck)
node ~/repos/scriptc/packages/cli/dist/main.js build dist-cli-dev/pyright-native.js -o /tmp/pyright-native
```

- scriptc: workspace checkout `espetro/scriptc@work/pyright-probe` (= 0.3.6 + relaxed tsc codes). Global fallback: `scriptc@0.3.6` via npm.
- **No partition-related flags or `SCRIPTC_*` env vars are set.** 0.3.6 exposes no jobs knob; `--jobs`/`SCRIPTC_JOBS` is proposed in espetro/scriptc#2 (unreleased). Partitioning is fully automatic.
- Output binary requires a sibling `typeshed-fallback/` (copy from `dist-cli-dev/`).

## 2. Partition count/size chosen

- **256 partitions** for the 3.7MB flat bundle: cache dir `~/.cache/scriptc/build/native-partitions-v1/c21036a932290891625edc81a57e48c3/` contains `00`..`ff`, 1.7GB total, 519 `.o` files (~1–11MB each).
- Assignment is internal: `stableHash(symbol) % count` (position-stable; a one-function edit dirties ~1 partition + importers). Reference: `docs/iteration-guide.md`.
- For comparison, a synthetic 63MB IR module chose 16 partitions — partition count tracks module structure, not raw size.

## 3. Wall times

| build | time | notes |
| --- | --- | --- |
| pyright bundle, scriptc **0.3.5** (earlier this week) | ~50 min | single `scriptc-llvm-codegen emit` process over ~75 `--output` partitions, ~123% CPU, ~19.6GB RSS |
| pyright bundle, scriptc **0.3.6** (latest attempt) | killed at ~47 min, still in codegen | pre-deadline kill, unfinished |
| synthetic 63MB IR, npm 0.3.6 (iteration-guide) | 3m35s cold → 1m59s one-fn edit (15/16 partitions reused) → 0.5s no-change | 16 partitions; emit already parallel via `DefaultThreadPool(hardware_concurrency())` + ThinLTO |

So: emit parallelism landed upstream and the synthetic case is fast, but the real pyright bundle at 256 partitions is still tens of minutes.

## 4. Machine specs

- 8 vCPU (x86_64), 31GB RAM, Devin Linux box. Emit pool = `hardware_concurrency()` → ~8 workers.

## 5. Outcome

- 0.3.5-era build: completed, produced a binary — `--version` prints `pyright 1.1.414`; typecheck run blocked at runtime fences (SC1101 in fslib shim — the frontier at stop time, ScrStats/Dirent wrap landed but unverified).
- 0.3.6 build: killed at ~47min in codegen; never completed, so post-fix state is unverified. Runtime-parity validation vs `npx pyright`/bun binary (`scripts/parity-check.mjs`) remains pending — unchanged requirement.

## 6. Slowness hypothesis

1. **Per-partition fixed cost × 256**: at ~8 emit workers, 256 partitions ≈ 32 serial batches; if each partition carries even ~5–10s of fixed overhead (IR decode, module setup, object emit), that's ~30–45min floor — matches the observed wall.
2. **Frontend floor**: tsc→IR over the 3.7MB bundle is itself minutes and serial.
3. **Memory pressure**: earlier builds peaked ~19.6GB RSS of 31GB — GC/allocation pressure during emit is plausible on this module size.
4. **Partition count is likely the wrong default for this bundle**: the synthetic 63MB IR got 16 partitions and finished in minutes. Capping partition count (or a `--jobs`-style knob + coarser partitions) is the probable fix — see espetro/scriptc#2 and vercel-labs/scriptc#1325.

## Pointers

- Measured rebuild curve + probe-first loop: `docs/iteration-guide.md`
- Per-fence fixes: `docs/upstream-deviations.md`
- Parity gate: `scripts/parity-check.mjs` (`PARITY_REF`/`PARITY_BUN`/`PARITY_NATIVE`)
