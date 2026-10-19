/*
 * scriptcRoot.ts
 *
 * scriptc: assigning to `global` doesn't persist (`global.x = v; global.x`
 * reads back undefined), so `__rootDirectory` set by the CLI entry point
 * never reaches later readers. Keep a module-level mirror the entry point
 * sets and any module can read. Kept in a leaf module so both uriUtils and
 * localize can import it without a cycle.
 */

let scriptcRootDirectory: string | undefined;

export function setScriptcRootDirectory(dir: string) {
    scriptcRootDirectory = dir;
}

export function getScriptcRootDirectory(): string | undefined {
    return scriptcRootDirectory;
}
