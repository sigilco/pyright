/*
 * sourceMapSupport.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * No-op replacement for 'source-map-support' in the scriptc native-CLI bundle.
 * Stack-trace source-map rewriting is meaningless for a compiled native
 * binary, so install() intentionally does nothing.
 */

export interface InstallOptions {
    environment?: 'node' | 'browser' | 'auto';
    handleUncaughtExceptions?: boolean;
    hookRequire?: boolean;
    overrideRetrieveFile?: boolean;
    overrideRetrieveSourceMap?: boolean;
    retrieveFile?: (path: string) => string;
    retrieveSourceMap?: (source: string) => { url: string; map: string } | null;
}

export function install(_options?: InstallOptions): void {
    // no-op
}
