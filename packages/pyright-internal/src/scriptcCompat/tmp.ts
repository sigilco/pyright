// Thin scriptc-native stand-in for the `tmp` npm package. The real package
// needs fs.constants / os.errno, which have no scriptc lowering; pyright only
// uses setGracefulCleanup, dirSync and fileSync over node:fs primitives.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface DirResult {
    name: string;
    removeCallback: () => void;
}

export interface FileResult {
    name: string;
    fd?: number;
    removeCallback: () => void;
}

export interface DirOptions {
    dir?: string;
    prefix?: string;
    [key: string]: any;
}

export interface FileOptions {
    dir?: string;
    prefix?: string;
    postfix?: string;
    discardDescriptor?: boolean;
    [key: string]: any;
}

export function setGracefulCleanup(): void {
    // No tracked handles in this port; temp files are left for the OS.
}

function _base(dir: string | undefined): string {
    const root = dir || os.tmpdir();
    fs.mkdirSync(root, { recursive: true });
    return root;
}

function _rmdir(p: string): void {
    try {
        fs.rmSync(p, { recursive: true });
    } catch {
        // ignore
    }
}

export function dirSync(options?: DirOptions): DirResult {
    const opts: DirOptions = options || {};
    const name = fs.mkdtempSync(path.join(_base(opts.dir), opts.prefix || 'tmp-'));
    return {
        name,
        removeCallback: () => {
            _rmdir(name);
        },
    };
}

export function fileSync(options?: FileOptions): FileResult {
    const opts: FileOptions = options || {};
    const root = _base(opts.dir);
    const prefix = opts.prefix || 'tmp-';
    const postfix = opts.postfix || '';
    let name = '';
    let fd = -1;
    // mkdtempSync gives a unique dir; claim a file inside it.
    const holder = fs.mkdtempSync(path.join(root, prefix));
    name = path.join(holder, `file${postfix}`);
    try {
        fd = fs.openSync(name, 'w');
    } catch {
        _rmdir(holder);
        throw new Error(`unable to create temp file in ${root}`);
    }
    if (opts.discardDescriptor !== false) {
        fs.closeSync(fd);
    }
    return {
        name,
        fd: opts.discardDescriptor === false ? fd : undefined,
        removeCallback: () => {
            _rmdir(holder);
        },
    };
}
