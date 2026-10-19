/*
 * scriptc-compat stub for `@yarnpkg/libzip`.
 *
 * The package's libzipSync bootstrap is an Emscripten module loop
 * (`for (key in Module)`) over a checked-dynamic kind that scriptc refuses.
 * The native typechecker never reads .zip archives — pyright resolves plain
 * directory trees — so getLibzipSync (which is only invoked lazily by ZipFS
 * construction) becomes a hard failure here instead of shipping a wasm FS.
 */

export function getLibzipSync(): never {
    throw new Error('scriptc-native build: zip archive support (libzip) is not available');
}

export async function getLibzipPromise(): Promise<never> {
    return getLibzipSync();
}
