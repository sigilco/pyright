# pyright → native typecheck CLI port

Goal: distributable pyright **typecheck CLI** for embedding in pyscriptc — no LSP/TSP server, no watch daemon, no VS Code harness. Same binary later doubles as a persistent daemon (`--mode daemon`, JSON-RPC over stdio) for pyscriptc's TSP/linter plugins.

## Scope decisions (fork `sigilco/pyright`, `develop` branch; `main` tracks upstream)

| Feature | Verdict | Mechanism |
|---|---|---|
| file/project typecheck, `--outputjson` | keep | core path (`runSingleThreaded`) |
| config discovery (`pyrightconfig.json`, pyproject) | keep | core path |
| `--threads` multi-worker | keep if cheap | `child_process.fork(mainModulePath)` — JSON messages, self re-exec; scriptc fork support is partial-but-matching shape |
| `--watch` | **drop v1** | chokidar provider → null `FileWatcherProvider` via DI; fs.watch only partial in scriptc |
| `--verifytypes` / `--createstub` | keep if free; stub-gate otherwise |
| langserver/TSP entry | **exclude** | build only `src/pyright.ts` entry; `vscode-languageserver` refs are type-only/dead for CLI |
| typeshed-fallback | ship as sibling dir v1 | 32MB/5330 .pyi resolved from module dir; embed later |

## Phases

### Phase 0 — POC binary (bun --compile) — CHILD A
- `packages/pyright`: add rspack variant `cli` — entry `src/pyright.ts` only, `splitChunks:false`, prod mode → single `dist/cli/pyright.js` + `typeshed-fallback/`.
- Apply the scriptc-compat patches (harmless upstream):
  - delete 16 legacy decorators in `common/uri/{baseUri,fileUri,webUri}.ts` (memoization no-op)
  - `localize.ts`: `import x = require(...json)` → `import * as x from`
  - `uriMap.ts`: `entries()` anonymous class → `as unknown as MapIterator`
- Null watcher provider patch (watch flag → error "unsupported in native build").
- `bun build dist/cli/pyright.js --compile` → `pyright` exe; node SEA fallback.
- Validate: output parity vs `npx pyright` (exit codes + `--outputjson`) on sample project incl. import resolution via typeshed.

### Phase 1 — scriptc native — CHILD B
- Feed scriptc the single-file bundle (bundler pre-resolves the ~127 SC1016 cycles that fenced the source path).
- Engine work in `espetro/scriptc`: extend `JS_RELAXED_TSC_CODES` / suppressed-JS-strictness set for the ~107 checkJs leftovers on the bundle (tslib always-true helpers ~90, JSDoc-override, delete-optional, etc.).
- Enumerate remaining real fences (expected: `require()` sites, fs.watch, zlib, worker_threads/child_process options) → fence inventory report.
- Then: compile → binary → parity check.

### Phase 2 — pyscriptc embedding + daemon
- `pyscriptc check` shells the binary (companion asset or vendored fetch).
- Daemon mode: JSON-RPC stdio surface (check-file, check-delta, shutdown); persistent `AnalyzerService`/`Program` gives incremental rechecks for free (`markFilesDirty` — dependents only).
- Linter plugins register as checker visitors reusing the bound graph — traversal-only cost.

## Risks
- Post-graph fence density unknown until Path-B engine tweak lands (bounded by inventory).
- `--threads` under scriptc depends on `fork` option-parity; worst case single-threaded v1.
- typeshed embedding needs an asset mechanism before a true single-file exe.

## Addendum — pyscriptc TypeFacts input (2026-10-18)

pyscriptc needs `TypeFacts` (serializable type info per symbol); today the CLI only emits diagnostics (mypy-parity, zero facts). Options:
- **`--facts` verb in this fork (recommended)**: `TypeEvaluator` already computes types — serialize to our JSON contract directly. Cleanest, no LSP hop; pairs with the Phase-2 daemon surface (`facts-file`, `facts-delta` ops over the persistent `Program`).
- LSP hover: untested under bun-compile; second choice.

Decision recorded from pyscriptc agent input; do not implement in the scriptc-native branch — belongs to the Phase-2 daemon work.
