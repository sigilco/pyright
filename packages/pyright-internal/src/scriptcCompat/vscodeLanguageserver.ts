/*
 * vscodeLanguageserver.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Shim for 'vscode-languageserver' in the scriptc native-CLI bundle. Re-exports
 * the real vscode-languageserver-types surface (all types + small const enums)
 * plus the jsonrpc runtime shim. LSP-server-only machinery (Connection,
 * createConnection, progress reporters) exists only so esbuild named-import
 * resolution succeeds — it is never executed in typecheck.
 */

export * from './vscodeJsonrpc';
export { LSPErrorCodes } from './vscodeJsonrpc';
export * from 'vscode-languageserver-types';

import { NotificationType, ProgressType, RequestType } from './vscodeJsonrpc';

export interface WorkDoneProgressReporter {
    begin(title: string, percentage?: number, message?: string, cancellable?: boolean): void;
    report(arg0: number | string, arg1?: string): void;
    done(): void;
}

export interface ResultProgressReporter<PR> {
    report(data: PR): void;
}

export interface WorkDoneProgressServerReporter extends WorkDoneProgressReporter {
    readonly token: unknown;
}

export const WorkDoneProgress = new ProgressType<{
    kind: 'begin' | 'report' | 'end';
    title?: string;
    percentage?: number;
    message?: string;
    cancellable?: boolean;
}>();

export const WorkDoneProgressCreateRequest = new RequestType<{ token: unknown }, void, void>(
    'window/workDoneProgress/create'
);
export const WorkDoneProgressCancelNotification = new NotificationType<{ token: unknown }>(
    'window/workDoneProgress/cancel'
);

export interface ServerWorkDoneManager {
    attach(connection: unknown): void;
    detach(connection: unknown): void;
}

export interface Connection {
    // Type-only surface; the real Connection is an LSP server object that
    // never exists in the native CLI.
}

export const ConnectionOptions = Object.freeze({
    is: (value: unknown): value is { maxParallelism?: number } => !!value,
});

export const ProposedFeatures = Object.freeze({
    all: {},
});

export interface FileSystemWatcher {
    globPattern: unknown;
    kind?: number;
}

export interface ExecuteCommandParams {
    command: string;
    arguments?: unknown[];
}

export interface WorkspaceFoldersChangeEvent {
    added: unknown[];
    removed: unknown[];
}
