# Upstream deviations

Source and vendored-dependency changes made on this fork to eliminate scriptc
build fences on the flat ESM CLI bundle (`packages/pyright/dist-cli-dev/pyright-flat.js`).
Each entry should be small, semantics-preserving, and noted for future upstream merges.

| file/patch | what changed | why (scriptc fence) | upstream-merge note |
| --- | --- | --- | --- |
| `packages/pyright-internal/src/localization/localize.ts` | `loadDefaultStrings` now reads through a `getStringsForLocale(localeMap, locale)` helper whose map parameter is a declared `Map<string, StringLookupMap>` instead of calling `.get` on the module-level `stringMapsByLocale` literal. | `mapIntrinsic get must return the 'V | undefined' union` — the bundled map literal's `V` is inferred as a union of the JSON module namespaces. | Harmless indirection; can be kept or dropped upstream. |
| `patches/source-map-support@0.5.21.patch` | `cloneCallSite` initializes `object` via `Object.create(Object.prototype)` instead of `{}`. | `recordKeySet receiver: expected record, got union` — the expando object inferred a union receiver for `object[name] =`. | Semantics identical (still inherits `Object.prototype`); trivially upstreamable. |
| `patches/smol-toml@1.8.0.patch` | `TomlDate`'s `toString`/`toDateString`/`toTimeString`/`toLocaleString` moved from class methods to `TomlDate.prototype.<name> = function () { return this._date.<name>(); }` assignments after the class body. | `class captures require a local-class instance receiver and no closure environment` — these Object-prototype-named methods are lowered receiverless, which fences inside the `__esm` closure. | Prototype assignment preserves the public API; merge-safe. |
