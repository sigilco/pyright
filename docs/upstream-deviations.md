# Upstream deviations

| file/patch | what changed | why (scriptc fence) | upstream-merge note |
| --- | --- | --- | --- |
| patches/@yarnpkg__fslib@2.10.4.patch (lib/statUtils.js) | added `void this;` to the 12 stub methods `isBlockDevice`/`isCharacterDevice`/`isFIFO`/`isSocket` on `DirEntry`, `StatEntry`, `BigIntStatsEntry` | SC9001: receiverless methods of a class inside the `__commonJS` closure capture the closure environment | pure no-op; drop when the compiler supports closure-env classes or upstream gets an ESM build |
| patches/@yarnpkg__fslib@2.10.4.patch (lib/patchFs/FileHandle.js) | added `void this;` to `datasync`, `sync`, `utimes`, `readv` (existing Symbol→string-key patch kept) | same SC9001 receiverless-method fence | pure no-op; same note |
| patches/@yarnpkg__libzip@2.3.0.patch (lib/libzipSync.js) | `stream_ops[key] = fn` inside `keys.forEach` rewritten as `Object.defineProperty(stream_ops, key, {value, writable, enumerable, configurable})` | SC9001 recordKeySet: assigning a dynamic key to a `{}` record | identical property semantics; revert if compiler types `{}` as an open record |
