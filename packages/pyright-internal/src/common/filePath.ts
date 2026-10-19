/*
 * filePath.ts
 *
 * Branded string marking a path extracted from a Uri via getFilePath().
 * Erased at compile time — zero runtime cost. It exists so TypeScript (and
 * the scriptc frontend) enumerate every site that feeds an unverified string
 * into a filesystem operation instead of a Uri-derived path.
 */

export interface FilePathBrand {
    readonly __filePathBrand: unique symbol;
}

export type FilePath = string & FilePathBrand;

export function toFilePath(p: string): FilePath {
    return p as FilePath;
}
