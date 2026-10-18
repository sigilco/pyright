/*
 * vscodeLanguageserverNode.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Shim for 'vscode-languageserver/node' (and '/browser') in the scriptc
 * native-CLI bundle. createConnection exists only so named imports resolve;
 * it always throws because no LSP transport exists in the typecheck CLI.
 */

export * from './vscodeJsonrpc';
export * from './vscodeLanguageserverProtocol';
// Both shims declare NotificationHandler/RequestHandler; an explicit export
// disambiguates the star-export collision for tsc (esbuild is indifferent).
export { NotificationHandler, RequestHandler } from './vscodeJsonrpc';
export * from 'vscode-languageserver-types';

export function createConnection(..._args: any[]): never {
    throw new Error('LSP connections are not supported in the native CLI build');
}
