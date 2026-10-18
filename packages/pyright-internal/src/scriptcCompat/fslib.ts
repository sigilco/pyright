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

    statSync(p: string): fs.Stats {
        return this.delegate ? this.delegate.statSync(p) : fs.statSync(p);
    }

    lstatSync(p: string): fs.Stats {
        return this.delegate ? this.delegate.lstatSync(p) : fs.lstatSync(p);
    }

    realpathSync(p: string): string {
        return this.delegate ? this.delegate.realpathSync(p) : fs.realpathSync(p);
    }

    readdirSync(p: string): string[];
    readdirSync(p: string, options: { withFileTypes: true }): fs.Dirent[];
    readdirSync(p: string, options?: { withFileTypes?: boolean }): string[] | fs.Dirent[] {
        if (this.delegate) {
            return options?.withFileTypes
                ? this.delegate.readdirSync(p, { withFileTypes: true })
                : this.delegate.readdirSync(p);
        }
        return options?.withFileTypes
            ? fs.readdirSync(p, { withFileTypes: true })
            : fs.readdirSync(p);
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
