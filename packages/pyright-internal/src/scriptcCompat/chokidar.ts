/*
 * chokidar.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Minimal chokidar replacement for the scriptc native-CLI bundle, backed by
 * node:fs.watch. Only the surface chokidarFileWatcherProvider uses:
 * watch(paths, opts) -> { on(event, cb), close() } with 'all' events of the
 * form (eventName, path[, stats]).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface WatchOptions {
    ignoreInitial?: boolean;
    ignorePermissionErrors?: boolean;
    followSymlinks?: boolean;
    interval?: number;
    binaryInterval?: number;
    usePolling?: boolean;
    disableGlobbing?: boolean;
    awaitWriteFinish?: { stabilityThreshold?: number; pollInterval?: number };
    ignored?: string[] | ((path: string, stats?: fs.Stats) => boolean);
}

export type FSWatcherEventName = 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir' | 'ready' | 'error';

type Listener = (...args: any[]) => void;

export class FSWatcher {
    private _watchers: fs.FSWatcher[] = [];
    private _listeners = new Map<string, Listener[]>();
    private _dirs = new Set<string>();
    private _closed = false;

    constructor(paths: string | string[], private _options: WatchOptions = {}) {
        const roots = Array.isArray(paths) ? paths : [paths];
        for (const root of roots) {
            this._watch(root);
        }
        // 'ready' is emitted asynchronously like chokidar does.
        setImmediate(() => this._emit('ready'));
    }

    on(event: 'all', listener: (eventName: string, path: string, stats?: fs.Stats) => void): this;
    on(event: string, listener: Listener): this;
    on(event: string, listener: Listener): this {
        const list = this._listeners.get(event) ?? [];
        list.push(listener);
        this._listeners.set(event, list);
        return this;
    }

    add(p: string | string[]): this {
        for (const root of Array.isArray(p) ? p : [p]) {
            this._watch(root);
        }
        return this;
    }

    async close(): Promise<void> {
        this._closed = true;
        for (const w of this._watchers) {
            w.close();
        }
        this._watchers = [];
    }

    private _emit(event: string, ...args: any[]): void {
        if (this._closed) {
            return;
        }
        for (const cb of this._listeners.get(event) ?? []) {
            try {
                cb(...args);
            } catch {
                // listener errors are not fatal to the watcher
            }
        }
        if (event !== 'all') {
            for (const cb of this._listeners.get('all') ?? []) {
                try {
                    cb(...args);
                } catch {
                    // same
                }
            }
        }
    }

    private _ignored(p: string): boolean {
        const ignored = this._options.ignored;
        if (typeof ignored === 'function') {
            try {
                return ignored(p);
            } catch {
                return false;
            }
        }
        if (Array.isArray(ignored)) {
            const norm = p.split(path.sep).join('/');
            return ignored.some((glob) =>
                glob.split('**').every((part) => !part || norm.includes(part.replace(/\*/g, '')))
            );
        }
        return false;
    }

    private _watch(root: string): void {
        let stat: fs.Stats;
        try {
            stat = fs.statSync(root);
        } catch {
            return;
        }
        if (stat.isDirectory()) {
            this._watchDir(root);
        } else {
            this._watchFile(root);
        }
    }

    private _watchDir(dir: string): void {
        if (this._dirs.has(dir) || this._ignored(dir)) {
            return;
        }
        this._dirs.add(dir);
        let entries: fs.Dirent[] = [];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (e) {
            this._emit('error', e);
            return;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (this._ignored(full)) {
                continue;
            }
            if (entry.isDirectory()) {
                this._watchDir(full);
            } else {
                this._watchFile(full);
            }
        }
        this._attach(dir, dir, true);
    }

    private _watchFile(file: string): void {
        if (this._ignored(file)) {
            return;
        }
        this._attach(file, file, false);
    }

    private _attach(watchTarget: string, eventPath: string, isDir: boolean): void {
        try {
            const watcher = fs.watch(watchTarget, { persistent: true }, (eventType, filename) => {
                const target = isDir && filename ? path.join(eventPath, filename) : eventPath;
                if (this._ignored(target)) {
                    return;
                }
                let stat: fs.Stats | undefined;
                try {
                    stat = fs.statSync(target);
                } catch {
                    stat = undefined;
                }
                if (stat) {
                    this._emit(
                        stat.isDirectory() ? 'addDir' : 'add',
                        stat.isDirectory() ? 'addDir' : 'change',
                        target,
                        stat
                    );
                    if (stat.isDirectory()) {
                        this._watchDir(target);
                    }
                } else {
                    this._emit('unlink', isDir ? 'unlinkDir' : 'unlink', target);
                }
            });
            watcher.on('error', (e) => {
                if (!this._options.ignorePermissionErrors) {
                    this._emit('error', e);
                }
            });
            this._watchers.push(watcher);
        } catch (e) {
            if (!this._options.ignorePermissionErrors) {
                this._emit('error', e);
            }
        }
    }
}

export function watch(paths: string | string[], options?: WatchOptions): FSWatcher {
    return new FSWatcher(paths, options);
}
