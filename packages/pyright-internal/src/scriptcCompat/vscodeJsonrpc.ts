/* eslint-disable @typescript-eslint/no-unused-vars -- generic params mirror the real vscode-jsonrpc signatures */
/*
 * vscodeJsonrpc.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Modern-TS reimplementation of the subset of 'vscode-jsonrpc' (and its
 * /node and /browser entry points) that pyright actually consumes. Written
 * for the scriptc native-CLI bundle: plain classes, no CJS interop, no
 * LinkedMap. LSP-transport machinery is present only so named imports
 * resolve; it is never exercised by the typecheck CLI.
 */

export type CancellationId = string | number;
export namespace CancellationId {
    export const None: CancellationId = -1;
    export const All: CancellationId = -2;
}

export interface Event<T> {
    (listener: (e: T) => any, thisArgs?: any, disposables?: Disposable[]): Disposable;
}

export class Disposable {
    private _callOnDispose: (() => any) | undefined;

    constructor(callOnDispose: () => any) {
        this._callOnDispose = callOnDispose;
    }

    static create(func: () => void): Disposable {
        return new Disposable(func);
    }

    dispose(): any {
        const fn = this._callOnDispose;
        this._callOnDispose = undefined;
        if (fn) {
            return fn();
        }
        return undefined;
    }
}

interface ListenerEntry<T> {
    listener: (e: T) => any;
    thisArgs: any;
    disposable?: Disposable;
}

export class Emitter<T> {
    private _disposed = false;
    private _listeners?: (ListenerEntry<T> | undefined)[];
    private _event?: Event<T>;
    private _deliveryQueue?: { listener: ListenerEntry<T>; event: T }[];

    get event(): Event<T> {
        if (!this._event) {
            this._event = (listener, thisArgs, disposables) => {
                const entry: ListenerEntry<T> = { listener, thisArgs };
                if (!this._listeners) {
                    this._listeners = [];
                }
                this._listeners.push(entry);

                const result = new Disposable(() => {
                    if (!this._disposed && this._listeners) {
                        const idx = this._listeners.indexOf(entry);
                        if (idx > -1) {
                            this._listeners[idx] = undefined;
                        }
                    }
                });

                if (disposables) {
                    disposables.push(result);
                }
                return result;
            };
        }
        return this._event;
    }

    fire(event: T): void {
        if (this._listeners) {
            for (const listener of this._listeners) {
                if (!listener) {
                    continue;
                }
                const entry: { listener: ListenerEntry<T>; event: T } = { listener, event };
                if (this._deliveryQueue) {
                    this._deliveryQueue.push(entry);
                    continue;
                }
                this._deliveryQueue = [entry];
                while (this._deliveryQueue.length > 0) {
                    const item = this._deliveryQueue.shift()!;
                    try {
                        item.listener.listener.call(item.listener.thisArgs, item.event);
                    } catch {
                        // Listener errors are swallowed, matching vscode-jsonrpc.
                    }
                }
                this._deliveryQueue = undefined;
            }
        }
    }

    dispose(): void {
        this._disposed = true;
        this._listeners = undefined;
        this._deliveryQueue = undefined;
    }
}

export interface CancellationToken {
    readonly isCancellationRequested: boolean;
    onCancellationRequested(listener: (e: any) => any, thisArgs?: any, disposables?: Disposable[]): Disposable;
}

export namespace CancellationToken {
    export const None: CancellationToken = Object.freeze({
        isCancellationRequested: false,
        onCancellationRequested: () => Disposable.create(() => {}),
    });

    export const Cancelled: CancellationToken = Object.freeze({
        isCancellationRequested: true,
        onCancellationRequested: (listener: (e: any) => any, thisArgs?: any) => {
            const disposable = new Disposable(() => {});
            try {
                listener.call(thisArgs, undefined);
            } catch {
                // match vscode-jsonrpc: listener errors are swallowed.
            }
            return disposable;
        },
    });

    export function is(value: unknown): value is CancellationToken {
        const candidate = value as CancellationToken;
        return (
            !!candidate &&
            (candidate === None || candidate === Cancelled || typeof candidate.isCancellationRequested === 'boolean')
        );
    }
}

export abstract class AbstractCancellationTokenSource {
    abstract get token(): CancellationToken;
    abstract cancel(): void;
    abstract dispose(cancel?: boolean): void;
}

export class CancellationTokenSource extends AbstractCancellationTokenSource {
    private _emitter: Emitter<any> | undefined;
    private _isCancelled = false;

    get token(): CancellationToken {
        const source = this;
        return {
            get isCancellationRequested(): boolean {
                return source._isCancelled;
            },
            onCancellationRequested: (listener, thisArgs, disposables) => {
                if (source._isCancelled) {
                    try {
                        listener.call(thisArgs, undefined);
                    } catch {
                        // swallow
                    }
                    return Disposable.create(() => {});
                }
                if (!source._emitter) {
                    source._emitter = new Emitter<any>();
                }
                return source._emitter.event(listener, thisArgs, disposables);
            },
        };
    }

    cancel(): void {
        if (!this._isCancelled) {
            this._isCancelled = true;
            if (this._emitter) {
                this._emitter.fire(undefined);
                this.dispose();
            }
        }
    }

    dispose(cancel = false): void {
        if (cancel) {
            this.cancel();
        }
        if (this._emitter) {
            this._emitter.dispose();
            this._emitter = undefined;
        }
    }
}

export class ResponseError<E> extends Error {
    readonly code: number;
    readonly data: E | undefined;

    constructor(code: number, message: string, data?: E) {
        super(message);
        this.code = typeof code === 'number' ? code : 0;
        this.data = data;
        Object.setPrototypeOf(this, ResponseError.prototype);
    }
}

export namespace ErrorCodes {
    export const ParseError = -32700;
    export const InvalidRequest = -32600;
    export const MethodNotFound = -32601;
    export const InvalidParams = -32602;
    export const InternalError = -32603;
    export const jsonrpcReservedErrorRangeStart = -32099;
    export const serverErrorStart = jsonrpcReservedErrorRangeStart;
    export const ServerNotInitialized = -32002;
    export const UnknownErrorCode = -32001;
    export const jsonrpcReservedErrorRangeEnd = -32000;
    export const serverErrorEnd = jsonrpcReservedErrorRangeEnd;
    export const MessageWriteError = 1;
    export const MessageReadError = 2;
}

// LSP reserved error codes (exported from vscode-jsonrpc too in newer versions).
export namespace LSPErrorCodes {
    export const lspReservedErrorRangeStart = -32899;
    export const RequestFailed = -32803;
    export const ServerCancelled = -32802;
    export const ContentModified = -32801;
    export const RequestCancelled = -32800;
    export const lspReservedErrorRangeEnd = -32800;
}

export enum MessageType {
    Request = 1,
    Notification = 2,
    Response = 3,
}

export interface Message {
    jsonrpc: string;
}

export interface RequestMessage extends Message {
    id: number | string;
    method: string;
    params?: any;
}

export interface NotificationMessage extends Message {
    method: string;
    params?: any;
}

export interface ResponseMessage extends Message {
    id: number | string | null;
    result?: any;
    error?: { code: number; message: string; data?: any };
}

export function isRequestMessage(message: Message | undefined): message is RequestMessage {
    const candidate = message as RequestMessage;
    return !!candidate && candidate.id !== undefined && candidate.method !== undefined;
}

export function isNotificationMessage(message: Message | undefined): message is NotificationMessage {
    const candidate = message as NotificationMessage & { id?: unknown };
    return !!candidate && candidate.id === undefined && candidate.method !== undefined;
}

export function isResponseMessage(message: Message | undefined): message is ResponseMessage {
    const candidate = message as ResponseMessage;
    return !!candidate && (candidate.result !== undefined || candidate.error !== undefined);
}

export class ParameterStructures {
    static readonly auto = new ParameterStructures('auto');
    static readonly byName = new ParameterStructures('byName');
    static readonly byPosition = new ParameterStructures('byPosition');

    private constructor(private readonly _kind: 'auto' | 'byName' | 'byPosition') {}

    static is(value: any): value is ParameterStructures {
        return (
            value === ParameterStructures.auto ||
            value === ParameterStructures.byName ||
            value === ParameterStructures.byPosition
        );
    }

    toString(): string {
        return this._kind;
    }
}

export class MessageSignature {
    readonly method: string;
    readonly numberOfParams: number;
    readonly parameterStructures: ParameterStructures;

    constructor(method: string, numberOfParams = 0, parameterStructures = ParameterStructures.auto) {
        this.method = method;
        this.numberOfParams = numberOfParams;
        this.parameterStructures = parameterStructures;
    }
}

export abstract class AbstractMessageSignature {
    constructor(
        readonly method: string,
        readonly numberOfParams: number,
        readonly parameterStructures: ParameterStructures = ParameterStructures.auto
    ) {}
    get type(): MessageSignature {
        return new MessageSignature(this.method, this.numberOfParams, this.parameterStructures);
    }
}

export class RequestType0<R, E> extends AbstractMessageSignature {
    constructor(method: string) {
        super(method, 0);
    }
}

export class RequestType<P, R, E> extends AbstractMessageSignature {
    constructor(method: string, _parameterStructures: ParameterStructures = ParameterStructures.auto) {
        super(method, 1, _parameterStructures);
    }
}

export class RequestType1<P1, R, E> extends AbstractMessageSignature {
    constructor(method: string, _parameterStructures: ParameterStructures = ParameterStructures.auto) {
        super(method, 1, _parameterStructures);
    }
}

export class RequestType2<P1, P2, R, E> extends AbstractMessageSignature {
    constructor(method: string) {
        super(method, 2);
    }
}

export class RequestType3<P1, P2, P3, R, E> extends AbstractMessageSignature {
    constructor(method: string) {
        super(method, 3);
    }
}

export class RequestType4<P1, P2, P3, P4, R, E> extends AbstractMessageSignature {
    constructor(method: string) {
        super(method, 4);
    }
}

export class RequestType5<P1, P2, P3, P4, P5, R, E> extends AbstractMessageSignature {
    constructor(method: string) {
        super(method, 5);
    }
}

export class RequestType6<P1, P2, P3, P4, P5, P6, R, E> extends AbstractMessageSignature {
    constructor(method: string) {
        super(method, 6);
    }
}

export class RequestType7<P1, P2, P3, P4, P5, P6, P7, R, E> extends AbstractMessageSignature {
    constructor(method: string) {
        super(method, 7);
    }
}

export class RequestType8<P1, P2, P3, P4, P5, P6, P7, P8, R, E> extends AbstractMessageSignature {
    constructor(method: string) {
        super(method, 8);
    }
}

export class RequestType9<P1, P2, P3, P4, P5, P6, P7, P8, P9, R, E> extends AbstractMessageSignature {
    constructor(method: string) {
        super(method, 9);
    }
}

export class NotificationType0 extends AbstractMessageSignature {
    constructor(method: string) {
        super(method, 0);
    }
}

export class NotificationType<P> extends AbstractMessageSignature {
    constructor(method: string, _parameterStructures: ParameterStructures = ParameterStructures.auto) {
        super(method, 1, _parameterStructures);
    }
}

export class NotificationType1<P1> extends AbstractMessageSignature {
    constructor(method: string) {
        super(method, 1);
    }
}

export class NotificationType2<P1, P2> extends AbstractMessageSignature {
    constructor(method: string) {
        super(method, 2);
    }
}

export class NotificationType3<P1, P2, P3> extends AbstractMessageSignature {
    constructor(method: string) {
        super(method, 3);
    }
}

export class NotificationType4<P1, P2, P3, P4> extends AbstractMessageSignature {
    constructor(method: string) {
        super(method, 4);
    }
}

export class NotificationType5<P1, P2, P3, P4, P5> extends AbstractMessageSignature {
    constructor(method: string) {
        super(method, 5);
    }
}

export class NotificationType6<P1, P2, P3, P4, P5, P6> extends AbstractMessageSignature {
    constructor(method: string) {
        super(method, 6);
    }
}

export class NotificationType7<P1, P2, P3, P4, P5, P6, P7> extends AbstractMessageSignature {
    constructor(method: string) {
        super(method, 7);
    }
}

export class NotificationType8<P1, P2, P3, P4, P5, P6, P7, P8> extends AbstractMessageSignature {
    constructor(method: string) {
        super(method, 8);
    }
}

export class NotificationType9<P1, P2, P3, P4, P5, P6, P7, P8, P9> extends AbstractMessageSignature {
    constructor(method: string) {
        super(method, 9);
    }
}

export class ProgressType<PR> {
    constructor() {}
}

export enum Trace {
    Off = 0,
    Messages = 1,
    Verbose = 2,
}

export namespace TraceValues {
    export const Off: Trace = Trace.Off;
    export const Messages: Trace = Trace.Messages;
    export const Verbose: Trace = Trace.Verbose;
}

export type TraceValue = 'off' | 'messages' | 'verbose';

export const SetTraceNotification = new NotificationType<{ value: Trace }>('$/setTrace');
export const LogTraceNotification = new NotificationType<{ message: string; verbose?: string }>('$/logTrace');

export type HandlerResult<R, E> = R | ResponseError<E> | Promise<R> | Promise<ResponseError<E>> | Promise<any>;

export type StarHandler = (method: string, params: any) => Promise<any>;
export type GenericRequestHandler<R, E> = (...params: any[]) => HandlerResult<R, E>;
export type GenericNotificationHandler = (...params: any[]) => void;
export type NotificationHandler<P> = (params: P) => void;
export type RequestHandler<P, R, E> = (params: P, token: CancellationToken) => HandlerResult<R, E>;
export type RequestHandler0<R, E> = (token: CancellationToken) => HandlerResult<R, E>;

export interface ConnectionOptions {
    cancellationStrategy?: unknown;
    connectionStrategy?: unknown;
    maxParallelism?: number;
}

export namespace ConnectionOptions {
    export function is(value: any): value is ConnectionOptions {
        return !!value;
    }
}

export interface ConnectionStrategy {
    cancelUndispatched?: (
        message: Message,
        next: (message: Message) => ResponseMessage | undefined
    ) => ResponseMessage | undefined;
}

export namespace ConnectionStrategy {
    export function is(value: any): value is ConnectionStrategy {
        return !!value;
    }
}

export interface MessageConnection {
    sendRequest: (...args: any[]) => Promise<any>;
    sendNotification: (...args: any[]) => void;
    onRequest: (...args: any[]) => void;
    onNotification: (...args: any[]) => void;
    onProgress: (...args: any[]) => void;
    sendProgress: (...args: any[]) => void;
    trace: (...args: any[]) => void;
    onError: (...args: any[]) => void;
    onClose: (...args: any[]) => void;
    onUnhandledNotification: (...args: any[]) => void;
    onUnhandledProgress: (...args: any[]) => void;
    dispose: () => void;
    listen: () => void;
    end: () => void;
    inspect: () => void;
    handleQueuedMessages?: () => void;
    hasPendingResponses?: () => boolean;
}

function _notSupported(): never {
    throw new Error('vscode-jsonrpc transport is not supported in the native CLI build');
}

export const createMessageConnection: (...args: any[]) => MessageConnection = _notSupported;

// ---- vscode-jsonrpc/node + /browser surface (message IO). Never used by the
// typecheck CLI; provided so named imports resolve. ----

export interface DataCallback {
    (data: Message): void;
}

export interface PartialMessageInfo {
    readonly messageToken: number;
    readonly waitingTime: number;
}

export interface MessageReader {
    onError: Event<Error>;
    onClose: Event<void>;
    onPartialMessage: Event<PartialMessageInfo>;
    listen(callback: DataCallback): Disposable;
    dispose(): void;
}

export interface MessageWriter {
    onError: Event<[Error, Message | undefined, number]>;
    onClose: Event<void>;
    write(msg: Message): Promise<void>;
    end(): void;
    dispose(): void;
}

export abstract class AbstractMessageReader {
    private _errorEmitter = new Emitter<Error>();
    private _closeEmitter = new Emitter<void>();
    private _partialMessageEmitter = new Emitter<PartialMessageInfo>();
    private _callback: DataCallback | undefined;

    get onError(): Event<Error> {
        return this._errorEmitter.event;
    }
    get onClose(): Event<void> {
        return this._closeEmitter.event;
    }
    get onPartialMessage(): Event<PartialMessageInfo> {
        return this._partialMessageEmitter.event;
    }
    listen(callback: DataCallback): Disposable {
        this._callback = callback;
        return Disposable.create(() => {
            this._callback = undefined;
        });
    }
    nextMessage(data: Message): void {
        this._callback?.(data);
    }
    dispose(): void {
        this._errorEmitter.dispose();
        this._closeEmitter.dispose();
        this._partialMessageEmitter.dispose();
    }
}

export abstract class AbstractMessageWriter {
    private _errorEmitter = new Emitter<[Error, Message | undefined, number]>();
    private _closeEmitter = new Emitter<void>();

    get onError(): Event<[Error, Message | undefined, number]> {
        return this._errorEmitter.event;
    }
    get onClose(): Event<void> {
        return this._closeEmitter.event;
    }
    async write(_msg: Message): Promise<void> {
        return;
    }
    end(): void {
        return;
    }
    dispose(): void {
        this._errorEmitter.dispose();
        this._closeEmitter.dispose();
    }
}

export class StreamMessageReader extends AbstractMessageReader {
    constructor(..._args: any[]) {
        super();
    }
}

export class StreamMessageWriter extends AbstractMessageWriter {
    constructor(..._args: any[]) {
        super();
    }
}

export class PortMessageReader extends AbstractMessageReader {
    constructor(..._args: any[]) {
        super();
    }
}

export class PortMessageWriter extends AbstractMessageWriter {
    constructor(..._args: any[]) {
        super();
    }
}

export class BrowserMessageReader extends AbstractMessageReader {
    constructor(..._args: any[]) {
        super();
    }
}

export class BrowserMessageWriter extends AbstractMessageWriter {
    constructor(..._args: any[]) {
        super();
    }
}

export const CancellationReceiverStrategy = Object.freeze({
    createCancellationTokenSource(_id: CancellationId) {
        return new CancellationTokenSource();
    },
    Is: (value: any) => value === CancellationReceiverStrategy,
});

export const CancellationSenderStrategy = Object.freeze({
    sendCancellation(_connection: MessageConnection, _id: CancellationId) {},
    cleanup(_id: CancellationId) {},
    Is: (value: any) => value === CancellationSenderStrategy,
});

export const CancellationStrategy = Object.freeze({
    receiver: CancellationReceiverStrategy,
    sender: CancellationSenderStrategy,
    Is: (value: any) => value === CancellationStrategy,
});
