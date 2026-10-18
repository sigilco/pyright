/* eslint-disable @typescript-eslint/no-unused-vars -- generic params mirror the real protocol signatures */
/*
 * vscodeLanguageserverProtocol.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Shim for 'vscode-languageserver-protocol' in the scriptc native-CLI bundle.
 * Provides the ProtocolRequestType/ProtocolNotificationType class factories
 * plus the named request/notification objects pyright imports. The objects
 * carry the same method strings as the real package but none of the
 * LSP-server behavior.
 */

import {
    AbstractMessageSignature,
    NotificationType,
    NotificationType0,
    ParameterStructures,
    ProgressType,
    RequestType,
    RequestType0,
} from './vscodeJsonrpc';

export * from './vscodeJsonrpc';
export { LSPErrorCodes } from './vscodeJsonrpc';
export * from 'vscode-languageserver-types';

export const MessageDirection = {
    clientToServer: 'clientToServer',
    serverToClient: 'serverToClient',
    both: 'both',
} as const;
export type MessageDirection = 'clientToServer' | 'serverToClient' | 'both';

export const NotebookCellKind = {
    Markup: 1,
    Code: 2,
} as const;
export type NotebookCellKind = 1 | 2;

export class ProtocolRequestType0<R, PR, E, RO> extends RequestType0<R, E> {
    readonly registerType = new MessageSignatureRO(this.method);
    constructor(method: string) {
        super(method);
    }
}

export class ProtocolRequestType<P, R, PR, E, RO> extends RequestType<P, R, E> {
    readonly registerType = new MessageSignatureRO(this.method);
    constructor(method: string) {
        super(method, ParameterStructures.byName);
    }
}

export class ProtocolNotificationType0<RO> extends NotificationType0 {
    readonly registerType = new MessageSignatureRO(this.method);
    constructor(method: string) {
        super(method);
    }
}

export class ProtocolNotificationType<P, RO> extends NotificationType<P> {
    readonly registerType = new MessageSignatureRO(this.method);
    constructor(method: string) {
        super(method, ParameterStructures.byName);
    }
}

class MessageSignatureRO extends AbstractMessageSignature {
    constructor(method: string) {
        super(method, 0);
    }
}

// ---- Named protocol objects imported by pyright sources. Method strings
// match vscode-languageserver-protocol. ----

export const InitializeRequest = new ProtocolRequestType<unknown, unknown, never, void, unknown>('initialize');
export const InitializedNotification = new ProtocolNotificationType<unknown, unknown>('initialized');
export const ShutdownRequest = new RequestType0<void, void>('shutdown');
export const RegistrationRequest = new ProtocolRequestType<unknown, void, never, void, void>(
    'client/registerCapability'
);
export const UnregistrationRequest = new ProtocolRequestType<unknown, void, never, void, void>(
    'client/unregisterCapability'
);
export const ApplyWorkspaceEditRequest = new ProtocolRequestType<unknown, unknown, never, void, void>(
    'workspace/applyEdit'
);
export const ConfigurationRequest = new ProtocolRequestType<unknown, unknown[], never, void, void>(
    'workspace/configuration'
);
export const DidOpenTextDocumentNotification = new ProtocolNotificationType<unknown, unknown>('textDocument/didOpen');
export const DidChangeTextDocumentNotification = new ProtocolNotificationType<unknown, unknown>(
    'textDocument/didChange'
);
export const DidCloseTextDocumentNotification = new ProtocolNotificationType<unknown, unknown>('textDocument/didClose');
export const DidOpenNotebookDocumentNotification = new ProtocolNotificationType<unknown, unknown>(
    'notebookDocument/didOpen'
);
export const DidChangeNotebookDocumentNotification = new ProtocolNotificationType<unknown, unknown>(
    'notebookDocument/didChange'
);
export const DidCloseNotebookDocumentNotification = new ProtocolNotificationType<unknown, unknown>(
    'notebookDocument/didClose'
);
export const DidChangeWatchedFilesNotification = new ProtocolNotificationType<unknown, unknown>(
    'workspace/didChangeWatchedFiles'
);
export const DidChangeWorkspaceFoldersNotification = new ProtocolNotificationType<unknown, unknown>(
    'workspace/didChangeWorkspaceFolders'
);
export const PublishDiagnosticsNotification = new ProtocolNotificationType<unknown, unknown>(
    'textDocument/publishDiagnostics'
);
export const HoverRequest = new ProtocolRequestType<unknown, unknown, never, void, unknown>('textDocument/hover');
export const DocumentDiagnosticRequest = new ProtocolRequestType<unknown, unknown, unknown, void, void>(
    'textDocument/diagnostic'
);
export const WorkspaceDiagnosticRequest = new ProtocolRequestType<unknown, unknown, unknown, void, void>(
    'workspace/diagnostic'
);
export const DiagnosticRefreshRequest = new RequestType0<void, void>('workspace/diagnostic/refresh');
export const InlayHintRefreshRequest = new RequestType0<void, void>('workspace/inlayHint/refresh');
export const SemanticTokensRefreshRequest = new RequestType0<void, void>('workspace/semanticTokens/refresh');
export const CodeLensRefreshRequest = new RequestType0<void, void>('workspace/codeLens/refresh');
export const InlineValueRefreshRequest = new RequestType0<void, void>('workspace/inlineValue/refresh');
export const LogMessageNotification = new ProtocolNotificationType<unknown, unknown>('window/logMessage');
export const TelemetryEventNotification = new ProtocolNotificationType<unknown, unknown>('telemetry/event');
export const ExecuteCommandRequest = new ProtocolRequestType<unknown, unknown, never, void, void>(
    'workspace/executeCommand'
);

export interface DocumentDiagnosticReport {
    kind: string;
}
export interface FullDocumentDiagnosticReport extends DocumentDiagnosticReport {
    kind: 'full';
    resultId?: string;
}
export interface UnchangedDocumentDiagnosticReport extends DocumentDiagnosticReport {
    kind: 'unchanged';
    resultId: string;
}
export interface WorkspaceDiagnosticReport {
    items: unknown[];
}
export interface FileEvent {
    uri: string;
    type: number;
}
export interface NotificationHandler<P = any> {
    (params: P): void;
}
export interface RequestHandler<P = any, R = any, E = any> {
    (params: P, token: import('./vscodeJsonrpc').CancellationToken): R;
}

export const ProgressToken = ProgressType;
