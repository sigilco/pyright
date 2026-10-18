/*
 * scriptc-compat shim for `tmp`.
 *
 * The real package is CJS built on callback plumbing and process-exit
 * bookkeeping we don't need: realFileSystem.ts only uses the synchronous
 * dir/file creators and setGracefulCleanup. Implemented over
 * fs.mkdtempSync + fs.writeFileSync, with removeCallback kept for the
 * DirResult contract.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomBytesHex } from '../common/crypto';

export interface DirOptions {
    prefix?: string;
    tmpdir?: string;
    dir?: string;
}

export interface FileOptions extends DirOptions {
    postfix?: string;
    discardDescriptor?: boolean;
}

export interface DirResult {
    name: string;
    removeCallback: () => void;
}

export interface FileResult extends DirResult {
    fd?: number;
}

export function setGracefulCleanup(): void {
    // Temp artifacts under the OS temp root are left for the OS to reap;
    // pyright's usage never relied on forcible exit-time removal.
}

export function dirSync(options?: DirOptions): DirResult {
    const root = options?.dir ?? options?.tmpdir ?? os.tmpdir();
    const prefix = options?.prefix ?? 'tmp-';
    const name = fs.mkdtempSync(path.join(root, prefix));
    return {
        name,
        removeCallback: () => fs.rmSync(name, { recursive: true, force: true }),
    };
}

export function fileSync(options?: FileOptions): FileResult {
    const dir = options?.dir ?? os.tmpdir();
    const name = path.join(dir, `${options?.prefix ?? 'tmp-'}${randomBytesHex(8)}${options?.postfix ?? ''}`);
    const fd = fs.openSync(name, 'wx+');
    if (options?.discardDescriptor) {
        fs.closeSync(fd);
    }
    return {
        name,
        fd: options?.discardDescriptor ? undefined : fd,
        removeCallback: () => fs.rmSync(name, { force: true }),
    };
}
