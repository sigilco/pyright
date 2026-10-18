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
export class FakeFS<P> {
    constructor(protected readonly delegate?: FakeFS<unknown>) {}

    existsSync(p: P): boolean {
        return this.delegate ? this.delegate.existsSync(p as never) : fs.existsSync(p as string);
    }

    statSync(p: P): fs.Stats {
        return this.delegate ? this.delegate.statSync(p as never) : fs.statSync(p as string);
    }

    lstatSync(p: P): fs.Stats {
        return this.delegate ? this.delegate.lstatSync(p as never) : fs.lstatSync(p as string);
    }

    realpathSync(p: P): string {
        return this.delegate ? this.delegate.realpathSync(p as never) : fs.realpathSync(p as string);
    }

    readdirSync(p: P): string[];
    readdirSync(p: P, options: { withFileTypes: true }): fs.Dirent[];
    readdirSync(p: P, options?: { withFileTypes?: boolean }): string[] | fs.Dirent[] {
        if (this.delegate) {
            return options?.withFileTypes
                ? this.delegate.readdirSync(p as never, { withFileTypes: true })
                : this.delegate.readdirSync(p as never);
        }
        return options?.withFileTypes
            ? fs.readdirSync(p as string, { withFileTypes: true })
            : fs.readdirSync(p as string);
    }

    readFileSync(p: P): Buffer;
    readFileSync(p: P, encoding: BufferEncoding): string;
    readFileSync(p: P, encoding?: BufferEncoding): Buffer | string {
        if (this.delegate) {
            return encoding
                ? this.delegate.readFileSync(p as never, encoding)
                : this.delegate.readFileSync(p as never);
        }
        return encoding ? fs.readFileSync(p as string, encoding) : fs.readFileSync(p as string);
    }

    readFilePromise(p: P): Promise<Buffer>;
    readFilePromise(p: P, encoding: BufferEncoding): Promise<string>;
    readFilePromise(p: P, encoding?: BufferEncoding): Promise<Buffer | string> {
        if (this.delegate) {
            return encoding
                ? this.delegate.readFilePromise(p as never, encoding)
                : this.delegate.readFilePromise(p as never);
        }
        return encoding
            ? fs.promises.readFile(p as string, encoding)
            : fs.promises.readFile(p as string);
    }

    writeFileSync(p: P, data: string | Buffer, encoding?: BufferEncoding): void {
        if (this.delegate) {
            return this.delegate.writeFileSync(p as never, data, encoding);
        }
        fs.writeFileSync(p as string, data, encoding ? { encoding } : undefined);
    }

    openSync(p: P, flags: string): number {
        return this.delegate ? this.delegate.openSync(p as never, flags) : fs.openSync(p as string, flags);
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

    mkdirSync(p: P, options?: { recursive?: boolean; mode?: number }): void {
        if (this.delegate) {
            return this.delegate.mkdirSync(p as never, options);
        }
        fs.mkdirSync(p as string, options);
    }

    rmdirSync(p: P): void {
        if (this.delegate) {
            return this.delegate.rmdirSync(p as never);
        }
        fs.rmdirSync(p as string);
    }

    unlinkSync(p: P): void {
        if (this.delegate) {
            return this.delegate.unlinkSync(p as never);
        }
        fs.unlinkSync(p as string);
    }

    copyFileSync(src: P, dest: P): void {
        if (this.delegate) {
            return this.delegate.copyFileSync(src as never, dest as never);
        }
        fs.copyFileSync(src as string, dest as string);
    }

    createReadStream(p: P): fs.ReadStream {
        return this.delegate
            ? (this.delegate.createReadStream(p as never) as fs.ReadStream)
            : fs.createReadStream(p as string);
    }

    createWriteStream(p: P): fs.WriteStream {
        return this.delegate
            ? (this.delegate.createWriteStream(p as never) as fs.WriteStream)
            : fs.createWriteStream(p as string);
    }
}

export class PosixFS extends FakeFS<NativePath> {
    constructor(delegate: FakeFS<PortablePath>) {
        super(delegate as FakeFS<unknown>);
    }

    mapToBase(p: NativePath): PortablePath {
        return p;
    }

    mapFromBase(p: PortablePath): NativePath {
        return p;
    }
}

export class VirtualFS extends FakeFS<PortablePath> {
    constructor(options: { baseFs: FakeFS<PortablePath> }) {
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
export class ZipOpenFS extends FakeFS<PortablePath> {
    public readonly baseFs: FakeFS<PortablePath>;
    public readonly filter: RegExp | null;
    public readonly isZip = new Set<PortablePath>();
    public readonly notZip = new Set<PortablePath>();
    public readonly pathUtils = ppath;

    constructor(options?: ZipOpenFSOptions) {
        super();
        this.baseFs = new FakeFS<PortablePath>();
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
