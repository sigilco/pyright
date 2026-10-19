/*
 * scriptc-compat shim for `@yarnpkg/fslib`.
 *
 * The real package is a large CJS module tree (FakeFS/NodeFS/ZipFS plus a
 * dozen auxiliary FS classes, patchFs, Emscripten-adjacent helpers) whose
 * function-prototype class model trips scriptc diagnostic fences
 * (`Class constructor FakeFS2 cannot be invoked without 'new'` and friends).
 *
 * The native typechecker only performs plain POSIX file operations on
 * directory trees, so this shim implements the exact surface
 * realFileSystem.ts touches over `node:fs`:
 *   FakeFS   — node-backed base with an optional delegate chain
 *   PosixFS  — FakeFS + mapToBase/mapFromBase (identity here)
 *   VirtualFS— FakeFS constructed from { baseFs }
 *   ZipOpenFS/ZipFS — zip/egg/jar archive reads degrade to "not a zip";
 *              getZipSync throws like the yarnpkgLibzip shim.
 *   ppath    — node:path posix with fslib's `root` field added
 *   NativePath/PortablePath — string aliases (PortablePath.root/.dot kept)
 */

import * as fs from 'fs';
import * as path from 'path';

export type NativePath = string;
export type PortablePath = string;
export const PortablePath = {
    root: '/',
    dot: '.',
} as const;

export const ppath = Object.assign({}, path.posix, { root: '/' });

const ZIP_UNAVAILABLE = 'scriptc-native build: zip archive support is not available';

/*
 * scriptc: native fs.Stats/fs.Dirent handles cannot cross ANY call
 * boundary — passing one into a constructor/function converts typed
 * values to 'unknown' (SC1101) at runtime. Every fs result is therefore
 * unwrapped inline in the same method that calls node:fs into these
 * concrete program classes; predicates are eagerly copied into bools
 * and exposed as real methods (function-valued fields cannot
 * materialize across a dynamic boundary either).
 */
export class ScrStats {
    private _isFile = false;
    private _isDirectory = false;
    private _isBlockDevice = false;
    private _isCharacterDevice = false;
    private _isSymbolicLink = false;
    private _isFIFO = false;
    private _isSocket = false;
    private _isZipDirectory = false;
    dev = 0;
    ino = 0;
    mode = 0;
    nlink = 0;
    uid = 0;
    gid = 0;
    rdev = 0;
    size = 0;
    blksize = 0;
    blocks = 0;
    atimeMs = 0;
    mtimeMs = 0;
    ctimeMs = 0;
    birthtimeMs = 0;
    isFile() {
        return this._isFile;
    }
    isDirectory() {
        return this._isDirectory;
    }
    isBlockDevice() {
        return this._isBlockDevice;
    }
    isCharacterDevice() {
        return this._isCharacterDevice;
    }
    isSymbolicLink() {
        return this._isSymbolicLink;
    }
    isFIFO() {
        return this._isFIFO;
    }
    isSocket() {
        return this._isSocket;
    }
    isZipDirectory() {
        return this._isZipDirectory;
    }
    setPredicates(
        isFile: boolean,
        isDirectory: boolean,
        isBlockDevice: boolean,
        isCharacterDevice: boolean,
        isSymbolicLink: boolean,
        isFIFO: boolean,
        isSocket: boolean,
        isZipDirectory: boolean
    ): void {
        this._isFile = isFile;
        this._isDirectory = isDirectory;
        this._isBlockDevice = isBlockDevice;
        this._isCharacterDevice = isCharacterDevice;
        this._isSymbolicLink = isSymbolicLink;
        this._isFIFO = isFIFO;
        this._isSocket = isSocket;
        this._isZipDirectory = isZipDirectory;
    }
}

export class ScrDirent {
    name = '';
    parentPath = '';
    private _isFile = false;
    private _isDirectory = false;
    private _isBlockDevice = false;
    private _isCharacterDevice = false;
    private _isSymbolicLink = false;
    private _isFIFO = false;
    private _isSocket = false;
    setPredicates(
        isFile: boolean,
        isDirectory: boolean,
        isBlockDevice: boolean,
        isCharacterDevice: boolean,
        isSymbolicLink: boolean,
        isFIFO: boolean,
        isSocket: boolean
    ): void {
        this._isFile = isFile;
        this._isDirectory = isDirectory;
        this._isBlockDevice = isBlockDevice;
        this._isCharacterDevice = isCharacterDevice;
        this._isSymbolicLink = isSymbolicLink;
        this._isFIFO = isFIFO;
        this._isSocket = isSocket;
    }
    isFile() {
        return this._isFile;
    }
    isDirectory() {
        return this._isDirectory;
    }
    isBlockDevice() {
        return this._isBlockDevice;
    }
    isCharacterDevice() {
        return this._isCharacterDevice;
    }
    isSymbolicLink() {
        return this._isSymbolicLink;
    }
    isFIFO() {
        return this._isFIFO;
    }
    isSocket() {
        return this._isSocket;
    }
}

/*
 * Node-backed filesystem with an optional delegate: subclasses that wrap
 * another FS (PosixFS/VirtualFS/ZipOpenFS) pass the inner FS and every
 * method forwards to it when present. This collapses fslib's proxy-class
 * zoo into one chain without changing observable behavior on real paths.
 */
export class FakeFS {
    constructor(protected readonly delegate?: FakeFS) {}

    existsSync(p: string): boolean {
        return this.delegate ? this.delegate.existsSync(p) : fs.existsSync(p);
    }

    statSync(p: string): ScrStats {
        return this.delegate ? this.delegate.statSync(p) : this.statSyncImpl(p, false);
    }

    lstatSync(p: string): ScrStats {
        return this.delegate ? this.delegate.lstatSync(p) : this.statSyncImpl(p, true);
    }

    /*
     * The native fs.Stats handle is produced and consumed inside this
     * method: copying it through a parameter (ctor or helper) is itself
     * the SC1101 crossing, so the unwrap stays inline here.
     */
    private statSyncImpl(p: string, lstat: boolean): ScrStats {
        const s = lstat ? fs.lstatSync(p) : fs.statSync(p);
        const out = new ScrStats();
        out.setPredicates(
            s.isFile(),
            s.isDirectory(),
            s.isBlockDevice(),
            s.isCharacterDevice(),
            s.isSymbolicLink(),
            s.isFIFO(),
            s.isSocket(),
            false
        );
        out.dev = s.dev;
        out.ino = s.ino;
        out.mode = s.mode;
        out.nlink = s.nlink;
        out.uid = s.uid;
        out.gid = s.gid;
        out.rdev = s.rdev;
        out.size = s.size;
        out.blksize = s.blksize;
        out.blocks = s.blocks;
        out.atimeMs = s.atimeMs;
        out.mtimeMs = s.mtimeMs;
        out.ctimeMs = s.ctimeMs;
        out.birthtimeMs = s.birthtimeMs;
        return out;
    }

    realpathSync(p: string): string {
        return this.delegate ? this.delegate.realpathSync(p) : fs.realpathSync(p);
    }

    readdirSync(p: string): string[];
    readdirSync(p: string, options: { withFileTypes: true }): ScrDirent[];
    readdirSync(p: string, options?: { withFileTypes?: boolean }): string[] | ScrDirent[] {
        if (this.delegate) {
            return options?.withFileTypes
                ? this.delegate.readdirSync(p, { withFileTypes: true })
                : this.delegate.readdirSync(p);
        }
        if (options?.withFileTypes) {
            const entries: ScrDirent[] = [];
            for (const d of fs.readdirSync(p, { withFileTypes: true })) {
                const e = new ScrDirent();
                e.name = d.name;
                // Native Dirent methods: only isFile/isDirectory/isSymbolicLink
                // have scriptc lowerings — isBlockDevice/isCharacterDevice/
                // isFIFO/isSocket throw SC2020 (verified by probes/dirent-predicates).
                // Those kinds are never pyright source files, so report them false.
                e.setPredicates(
                    d.isFile(),
                    d.isDirectory(),
                    false,
                    false,
                    d.isSymbolicLink(),
                    false,
                    false
                );
                entries.push(e);
            }
            return entries;
        }
        return fs.readdirSync(p);
    }

    readFileSync(p: string): Buffer;
    readFileSync(p: string, encoding: BufferEncoding): string;
    readFileSync(p: string, encoding?: BufferEncoding): Buffer | string {
        if (this.delegate) {
            return encoding
                ? this.delegate.readFileSync(p, encoding)
                : this.delegate.readFileSync(p);
        }
        return encoding ? fs.readFileSync(p, encoding) : fs.readFileSync(p);
    }

    readFilePromise(p: string): Promise<Buffer>;
    readFilePromise(p: string, encoding: BufferEncoding): Promise<string>;
    readFilePromise(p: string, encoding?: BufferEncoding): Promise<Buffer | string> {
        if (this.delegate) {
            return encoding
                ? this.delegate.readFilePromise(p, encoding)
                : this.delegate.readFilePromise(p);
        }
        return encoding
            ? fs.promises.readFile(p, encoding)
            : fs.promises.readFile(p);
    }

    writeFileSync(p: string, data: string | Buffer, encoding?: BufferEncoding): void {
        if (this.delegate) {
            return this.delegate.writeFileSync(p, data, encoding);
        }
        fs.writeFileSync(p, data, encoding ? { encoding } : undefined);
    }

    openSync(p: string, flags: string): number {
        return this.delegate ? this.delegate.openSync(p, flags) : fs.openSync(p, flags);
    }

    readSync(fd: number, buffer: Buffer, offset: number, length: number, position: number | null): number {
        return this.delegate
            ? this.delegate.readSync(fd, buffer, offset, length, position)
            : fs.readSync(fd, buffer, offset, length, position);
    }

    closeSync(fd: number): void {
        if (this.delegate) {
            return this.delegate.closeSync(fd);
        }
        fs.closeSync(fd);
    }

    mkdirSync(p: string, options?: { recursive?: boolean; mode?: number }): void {
        if (this.delegate) {
            return this.delegate.mkdirSync(p, options);
        }
        fs.mkdirSync(p, options);
    }

    rmdirSync(p: string): void {
        if (this.delegate) {
            return this.delegate.rmdirSync(p);
        }
        fs.rmdirSync(p);
    }

    unlinkSync(p: string): void {
        if (this.delegate) {
            return this.delegate.unlinkSync(p);
        }
        fs.unlinkSync(p);
    }

    copyFileSync(src: string, dest: string): void {
        if (this.delegate) {
            return this.delegate.copyFileSync(src, dest);
        }
        fs.copyFileSync(src, dest);
    }

    createReadStream(p: string): fs.ReadStream {
        return this.delegate
            ? (this.delegate.createReadStream(p) as fs.ReadStream)
            : fs.createReadStream(p);
    }

    createWriteStream(p: string): fs.WriteStream {
        return this.delegate
            ? (this.delegate.createWriteStream(p) as fs.WriteStream)
            : fs.createWriteStream(p);
    }
}

export class PosixFS extends FakeFS {
    constructor(delegate: FakeFS) {
        super(delegate);
    }

    mapToBase(p: NativePath): PortablePath {
        return p;
    }

    mapFromBase(p: PortablePath): NativePath {
        return p;
    }
}

export class VirtualFS extends FakeFS {
    constructor(options: { baseFs: FakeFS }) {
        super(options.baseFs);
    }
}

interface ZipOpenFSOptions {
    libzip?: unknown;
    useCache?: boolean;
    maxOpenFiles?: number;
    readOnlyArchives?: boolean;
    filter?: RegExp | null;
}

export class ZipFS {
    constructor() {
        throw new Error(ZIP_UNAVAILABLE);
    }
}

/*
 * Constructor accepts the real options shape but never builds an archive
 * reader: archive members resolve through baseFs (plain node fs) and
 * getZipSync throws, which callers such as EggZipOpenFS.findZip already
 * catch and treat as "not a zip".
 */
export class ZipOpenFS extends FakeFS {
    public readonly baseFs: FakeFS;
    public readonly filter: RegExp | null;
    public readonly isZip = new Set<PortablePath>();
    public readonly notZip = new Set<PortablePath>();
    public readonly pathUtils = ppath;

    constructor(options?: ZipOpenFSOptions) {
        super();
        this.baseFs = new FakeFS();
        this.filter = options?.filter ?? null;
    }

    // Matches upstream fslib's `private getZipSync` / `private findZip` —
    // EggZipOpenFS overrides them behind its class-level @ts-expect-error.
    private getZipSync<T>(_p: PortablePath, _accept: (zipFs: ZipFS) => T): T {
        throw new Error(ZIP_UNAVAILABLE);
    }

    private findZip(p: PortablePath): { archivePath: PortablePath; subPath: PortablePath } | null {
        // Body infers the same `{archivePath, subPath} | null` shape the
        // EggZipOpenFS override returns — emitted JS drops `private`, so
        // scriptc checks override assignability on inferred types alone.
        return p.length > 0 ? { archivePath: p, subPath: p } : null;
    }
}
