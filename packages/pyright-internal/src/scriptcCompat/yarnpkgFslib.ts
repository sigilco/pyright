// Thin scriptc-native stand-in for @yarnpkg/fslib over node:fs.
//
// pyright-internal only consumes fslib through realFileSystem.ts, which stacks
// YarnFS extends PosixFS -> VirtualFS -> EggZipOpenFS extends ZipOpenFS ->
// NodeFS. The real fslib's class tower exists for zip archives (out of scope
// for the native typechecker), so this port keeps the layering shape but as
// pure inheritance: NodeFS provides the real node:fs implementation and every
// layer above it is a subclass, because scriptc cannot dispatch calls that
// return builtin objects (fs.Stats, Buffer, Dirent) through an untyped member
// reference (SC2020/SC1101). `baseFs`/`filter`/`isZip`/`notZip`/`pathUtils`
// remain as data members for realFileSystem's EggZipOpenFS.findZip, which
// short-circuits on non-zip paths anyway.

import type { FilePath } from '../common/filePath';
import * as fs from 'fs';
import * as path from 'path';

export type PortablePath = string;
export type NativePath = string;

export const PortablePath = {
    root: '/' as PortablePath,
};

export const ppath = path.posix;
export const npath = path;

export function toPortablePath(p: string): PortablePath {
    return p;
}

export function fromPortablePath(p: PortablePath): NativePath {
    return p;
}

export interface ReadFileOptions {
    encoding?: string | null;
}

// scriptc can only dispatch methods through untyped receivers when they
// return scriptc-native values; builtin fs.Stats/fs.Dirent objects refuse
// (SC2020/SC1101). These thin wrappers keep the same structural surface.
export class ScrStats {
    _isFile = false;
    _isDirectory = false;
    _isBlockDevice = false;
    _isCharacterDevice = false;
    _isSymbolicLink = false;
    _isFIFO = false;
    _isSocket = false;
    _isZipDirectory = false;
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
    atime = new Date(0);
    mtime = new Date(0);
    ctime = new Date(0);
    birthtime = new Date(0);
}

// A builtin fs.Stats can only live in a local variable — passing it into a
// scriptc class/function converts typed -> unknown (SC1101). statSync inlines
// the fill instead.

export class ScrDirent {
    name = '';
    _isFile = false;
    _isDirectory = false;
    _isBlockDevice = false;
    _isCharacterDevice = false;
    _isSymbolicLink = false;
    _isFIFO = false;
    _isSocket = false;
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
    parentPath = '';
}

function wrapDirent(d: fs.Dirent): ScrDirent {
    const e = new ScrDirent();
    e.name = d.name;
    e._isFile = d.isFile();
    e._isDirectory = d.isDirectory();
    e._isBlockDevice = d.isBlockDevice();
    e._isCharacterDevice = d.isCharacterDevice();
    e._isSymbolicLink = d.isSymbolicLink();
    e._isFIFO = d.isFIFO();
    e._isSocket = d.isSocket();
    e.parentPath = d.parentPath;
    return e;
}

// Real filesystem implementation over node:fs.
export class NodeFS {
    readonly pathUtils = path.posix;

    mapToBase(p: FilePath): FilePath {
        return p;
    }

    mapFromBase(p: FilePath): FilePath {
        return p;
    }

    existsSync(p: FilePath): boolean {
        return fs.existsSync(p);
    }

    mkdirSync(p: FilePath, options?: any): void {
        fs.mkdirSync(p, options);
    }

    chdir(p: FilePath): void {
        process.chdir(p);
    }

    readdirSync(p: FilePath, options?: any): any {
        if (options && options.withFileTypes) {
            // scriptc: node:fs.readdirSync only lowers literal options objects,
            // so the { withFileTypes: true } call must be spelled out here.
            const dirents: any = fs.readdirSync(p, { withFileTypes: true });
            const wrapped: ScrDirent[] = [];
            for (const e of dirents) {
                wrapped.push(wrapDirent(e));
            }
            return wrapped;
        }
        const entries: any = fs.readdirSync(p);
        return entries;
    }

    readFileSync(p: FilePath, encoding?: any): any {
        // Union `string | Buffer` returns collapse to a single arm under
        // scriptc; every real caller reads utf8, so decode unconditionally.
        return fs.readFileSync(p, 'utf8');
    }

    openSync(p: FilePath, flags?: any): number {
        return fs.openSync(p, flags);
    }

    readSync(fd: number, buffer: any, offset: number, length: number, position: any): number {
        return fs.readSync(fd, buffer, offset, length, position);
    }

    closeSync(fd: number): void {
        fs.closeSync(fd);
    }

    writeFileSync(p: FilePath, content: any, options?: any): void {
        fs.writeFileSync(p, content, options);
    }

    statSync(p: FilePath): ScrStats {
        const s = fs.statSync(p);
        const st = new ScrStats();
        st._isFile = s.isFile();
        st._isDirectory = s.isDirectory();
        st._isBlockDevice = s.isBlockDevice();
        st._isCharacterDevice = s.isCharacterDevice();
        st._isSymbolicLink = s.isSymbolicLink();
        st._isFIFO = s.isFIFO();
        st._isSocket = s.isSocket();
        st.dev = s.dev;
        st.ino = s.ino;
        st.mode = s.mode;
        st.nlink = s.nlink;
        st.uid = s.uid;
        st.gid = s.gid;
        st.rdev = s.rdev;
        st.size = s.size;
        st.blksize = s.blksize;
        st.blocks = s.blocks;
        st.atimeMs = s.atimeMs;
        st.mtimeMs = s.mtimeMs;
        st.ctimeMs = s.ctimeMs;
        st.birthtimeMs = s.birthtimeMs;
        st.atime = s.atime;
        st.mtime = s.mtime;
        st.ctime = s.ctime;
        st.birthtime = s.birthtime;
        return st;
    }

    lstatSync(p: FilePath): ScrStats {
        const s = fs.lstatSync(p);
        const st = new ScrStats();
        st._isFile = s.isFile();
        st._isDirectory = s.isDirectory();
        st._isBlockDevice = s.isBlockDevice();
        st._isCharacterDevice = s.isCharacterDevice();
        st._isSymbolicLink = s.isSymbolicLink();
        st._isFIFO = s.isFIFO();
        st._isSocket = s.isSocket();
        st.dev = s.dev;
        st.ino = s.ino;
        st.mode = s.mode;
        st.nlink = s.nlink;
        st.uid = s.uid;
        st.gid = s.gid;
        st.rdev = s.rdev;
        st.size = s.size;
        st.blksize = s.blksize;
        st.blocks = s.blocks;
        st.atimeMs = s.atimeMs;
        st.mtimeMs = s.mtimeMs;
        st.ctimeMs = s.ctimeMs;
        st.birthtimeMs = s.birthtimeMs;
        st.atime = s.atime;
        st.mtime = s.mtime;
        st.ctime = s.ctime;
        st.birthtime = s.birthtime;
        return st;
    }

    rmdirSync(p: FilePath): void {
        fs.rmdirSync(p);
    }

    unlinkSync(p: FilePath): void {
        fs.unlinkSync(p);
    }

    realpathSync(p: FilePath): FilePath {
        return fs.realpathSync(p) as FilePath;
    }

    createReadStream(p: FilePath, options?: any): any {
        return fs.createReadStream(p, options);
    }

    createWriteStream(p: FilePath, options?: any): any {
        return fs.createWriteStream(p, options);
    }

    copyFileSync(source: FilePath, dest: FilePath): void {
        fs.copyFileSync(source, dest);
    }

    async readFilePromise(p: FilePath, encoding?: any): Promise<any> {
        return fs.promises.readFile(p, encoding);
    }

    watchFile(p: FilePath, a: any, b?: any): any {
        throw new Error('watchFile is not supported in the scriptc native build');
    }

    unwatchFile(p: string, cb?: any): void {
        // no-op
    }

    unwatchAllFiles(): void {
        // no-op
    }

    getExtractHint(href: any): boolean {
        return false;
    }

    getRealPath(): string {
        return ppath.resolve('.');
    }
}

// fslib layer base. Holds the data members realFileSystem.ts's EggZipOpenFS
// reaches via `(this as any)` casts; the fs methods are inherited from NodeFS
// and apply `mapToBase` in subclasses that need a path transform.
export class PassThroughFS extends NodeFS {
    readonly baseFs: any;
    filter: RegExp | null;

    constructor(options?: { baseFs?: any; filter?: RegExp | null }) {
        super();
        this.baseFs = options ? options.baseFs : null;
        this.filter = (options && options.filter) || null;
    }

    protected _zipUnsupported(op: string): Error {
        return new Error(`${op}: zip archives are not supported in the scriptc native build`);
    }
}

export class FakeFS extends PassThroughFS {}

export class VirtualFS extends PassThroughFS {}

export class ProxiedFS extends PassThroughFS {
    constructor(name: any, options?: { baseFs?: PassThroughFS }) {
        super(options);
    }
}

export class PosixFS extends ProxiedFS {
    constructor(base?: PassThroughFS) {
        super(PosixFS, { baseFs: base });
    }
}

// Applies a path transform (native <-> portable) around the inherited impls.
export class NodePathFS extends ProxiedFS {
    constructor(baseFs: PassThroughFS) {
        super({ baseFs });
    }

    override mapToBase(p: FilePath): FilePath {
        return fromPortablePath(p) as FilePath;
    }

    override mapFromBase(p: FilePath): FilePath {
        return toPortablePath(p) as FilePath;
    }

    override existsSync(p: FilePath): boolean {
        return super.existsSync(this.mapToBase(p));
    }

    override mkdirSync(p: FilePath, options?: any): void {
        super.mkdirSync(this.mapToBase(p), options);
    }

    override chdir(p: FilePath): void {
        super.chdir(this.mapToBase(p));
    }

    override readdirSync(p: FilePath, options?: any): any {
        return super.readdirSync(this.mapToBase(p), options);
    }

    override readFileSync(p: FilePath, encoding?: any): any {
        return super.readFileSync(this.mapToBase(p), encoding);
    }

    override openSync(p: FilePath, flags?: any): number {
        return super.openSync(this.mapToBase(p), flags);
    }

    override writeFileSync(p: FilePath, content: any, options?: any): void {
        super.writeFileSync(this.mapToBase(p), content, options);
    }

    override statSync(p: FilePath): ScrStats {
        return super.statSync(this.mapToBase(p));
    }

    override lstatSync(p: FilePath): ScrStats {
        return super.lstatSync(this.mapToBase(p));
    }

    override rmdirSync(p: FilePath): void {
        super.rmdirSync(this.mapToBase(p));
    }

    override unlinkSync(p: FilePath): void {
        super.unlinkSync(this.mapToBase(p));
    }

    override realpathSync(p: FilePath): FilePath {
        return super.realpathSync(this.mapToBase(p));
    }

    override createReadStream(p: FilePath, options?: any): any {
        return super.createReadStream(this.mapToBase(p), options);
    }

    override createWriteStream(p: FilePath, options?: any): any {
        return super.createWriteStream(this.mapToBase(p), options);
    }

    override copyFileSync(source: FilePath, dest: FilePath): void {
        super.copyFileSync(this.mapToBase(source), this.mapToBase(dest));
    }
}

// Zip archives are out of scope for the native typechecker; kept as a throwing
// stub so stack construction stays faithful to upstream.
export class ZipFS extends NodeFS {
    constructor(source: any, opts?: any) {
        super();
        throw new Error('zip archives are not supported in the scriptc native build');
    }
}

export class ZipOpenFS extends PassThroughFS {
    static readonly openPromise = null;

    readonly isZip = new Set<string>();
    readonly notZip = new Set<string>();

    constructor(options?: any) {
        super({ baseFs: new NodeFS() });
    }

    findZip(p: string): any {
        return null;
    }

    getZipSync<T>(p: PortablePath, accept: (zipFs: ZipFS) => T): T {
        throw this._zipUnsupported(`getZipSync`);
    }

    async getZipPromise<T>(p: PortablePath, accept: (zipFs: ZipFS) => Promise<T>): Promise<T> {
        throw this._zipUnsupported(`getZipPromise`);
    }
}

export const xfs = new NodeFS();
