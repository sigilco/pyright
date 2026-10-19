/*
 * realFileSystem.ts
 *
 * Helper functions that require real filesystem access.
 */

import { FakeFS, NativePath, PortablePath, PosixFS, ppath, VirtualFS, ZipFS, ZipOpenFS } from '@yarnpkg/fslib';
import { getLibzipSync } from '@yarnpkg/libzip';
import * as fs from 'fs';
import * as os from 'os';
import * as tmp from 'tmp';
import { isMainThread } from 'worker_threads';

import { Disposable } from 'vscode-jsonrpc';
import { CaseSensitivityDetector } from './caseSensitivityDetector';
import { ConsoleInterface, NullConsole } from './console';
import { randomBytesHex } from './crypto';
import { FileSystem, MkDirOptions, TempFile, TmpfileOptions } from './fileSystem';
import {
    FileWatcher,
    FileWatcherEventHandler,
    FileWatcherEventType,
    FileWatcherHandler,
    FileWatcherProvider,
    nullFileWatcherProvider,
} from './fileWatcher';
import { combinePaths, getRootLength } from './pathUtils';
import { FileUri, FileUriSchema } from './uri/fileUri';
import { Uri } from './uri/uri';
import { getRootUri, UriEx } from './uri/uriUtils';

// Automatically remove files created by tmp at process exit.
tmp.setGracefulCleanup();

// Callers can specify a different file watcher provider if desired.
// By default, we'll use the file watcher based on chokidar.
export function createFromRealFileSystem(
    caseSensitiveDetector: CaseSensitivityDetector,
    console?: ConsoleInterface,
    fileWatcherProvider?: FileWatcherProvider
): FileSystem {
    return new RealFileSystem(
        caseSensitiveDetector,
        console ?? new NullConsole(),
        fileWatcherProvider ?? nullFileWatcherProvider
    );
}

const DOT_ZIP = `.zip`;
const DOT_EGG = `.egg`;
const DOT_JAR = `.jar`;

const zipPathRegEx = /[^\\/]\.(?:egg|zip|jar)[\\/]/;

// Exactly the same as ZipOpenFS's getArchivePart, but supporting .egg files.
// https://github.com/yarnpkg/berry/blob/64a16b3603ef2ccb741d3c44f109c9cfc14ba8dd/packages/yarnpkg-fslib/sources/ZipOpenFS.ts#L23
function getArchivePart(path: string) {
    let idx = path.indexOf(DOT_ZIP);
    if (idx <= 0) {
        idx = path.indexOf(DOT_EGG);
        if (idx <= 0) {
            idx = path.indexOf(DOT_JAR);
            if (idx <= 0) {
                return null;
            }
        }
    }

    // Disallow files named ".zip"
    if (path[idx - 1] === ppath.sep) return null;

    const nextCharIdx = idx + DOT_ZIP.length; // DOT_ZIP and DOT_EGG are the same length.

    // The path either has to end in ".zip" or contain an archive subpath (".zip/...")
    if (path.length > nextCharIdx && path[nextCharIdx] !== ppath.sep) return null;

    return path.slice(0, nextCharIdx) as PortablePath;
}

function hasZipExtension(p: string): boolean {
    return p.endsWith(DOT_ZIP) || p.endsWith(DOT_EGG) || p.endsWith(DOT_JAR);
}

// "Magic" values for the zip file type. https://en.wikipedia.org/wiki/List_of_file_signatures
const zipMagic = [
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
    Buffer.from([0x50, 0x4b, 0x07, 0x08]),
];

// scriptc note: the object literal upstream returned here carried method
// values; under scriptc that unrepresentable union member made the whole
// statSync return type unboxable (SC2020). statSync must also return ONE
// concrete class from every branch — a union of two class types cannot
// cross the dynamic dispatch boundary — so yarnFS results are wrapped into
// this same class too. Predicates must be real methods: reading a
// function-valued field off a class value that crossed a dynamic boundary
// materializes its class view and throws
// "class fields cannot be represented as checked-dynamic properties".
class EmptyStats {
    private _isFile = false;
    private _isDirectory = false;
    private _isBlockDevice = false;
    private _isCharacterDevice = false;
    private _isSymbolicLink = false;
    private _isFIFO = false;
    private _isSocket = false;
    private _isZipDirectory = false;
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
    ) {
        this._isFile = isFile;
        this._isDirectory = isDirectory;
        this._isBlockDevice = isBlockDevice;
        this._isCharacterDevice = isCharacterDevice;
        this._isSymbolicLink = isSymbolicLink;
        this._isFIFO = isFIFO;
        this._isSocket = isSocket;
        this._isZipDirectory = isZipDirectory;
    }
    dev = 0;
    atimeMs = 0;
    mtimeMs = 0;
    ctimeMs = 0;
    birthtimeMs = 0;
    size = 0;
    blksize = 0;
    blocks = 0;
    ino = 0;
    mode = 0;
    nlink = 0;
    uid = 0;
    gid = 0;
    rdev = 0;
    atime = new Date(0);
    mtime = new Date(0);
    ctime = new Date(0);
    birthtime = new Date(0);
}

// scriptc: wraps any stat result (native fs.Stats or shim ScrStats) into the
// single concrete class statSync returns.
function wrapStats(stat: fs.Stats): EmptyStats {
    const s = new EmptyStats();
    s.setPredicates(
        stat.isFile(),
        stat.isDirectory(),
        stat.isBlockDevice(),
        stat.isCharacterDevice(),
        stat.isSymbolicLink(),
        stat.isFIFO(),
        stat.isSocket(),
        false
    );
    s.dev = stat.dev;
    s.ino = stat.ino;
    s.mode = stat.mode;
    s.nlink = stat.nlink;
    s.uid = stat.uid;
    s.gid = stat.gid;
    s.rdev = stat.rdev;
    s.size = stat.size;
    s.blksize = stat.blksize;
    s.blocks = stat.blocks;
    s.atimeMs = stat.atimeMs;
    s.mtimeMs = stat.mtimeMs;
    s.ctimeMs = stat.ctimeMs;
    s.birthtimeMs = stat.birthtimeMs;
    // scriptc: copying a builtin Date out of a class field and into another
    // class throws — nothing in pyright reads the Date fields (only *Ms),
    // so they stay at the epoch defaults.
    return s;
}

// scriptc: same single-class rule for dirents — every element of
// readdirEntriesSync must be this class, not a union of Dirent impls.
// Predicates are real methods for the same classview reason as EmptyStats.
class DirentEntry {
    name = '';
    parentPath = '';
    private _isFile = false;
    private _isDirectory = false;
    private _isBlockDevice = false;
    private _isCharacterDevice = false;
    private _isSymbolicLink = false;
    private _isFIFO = false;
    private _isSocket = false;
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
    setPredicates(
        isFile: boolean,
        isDirectory: boolean,
        isBlockDevice: boolean,
        isCharacterDevice: boolean,
        isSymbolicLink: boolean,
        isFIFO: boolean,
        isSocket: boolean
    ) {
        this._isFile = isFile;
        this._isDirectory = isDirectory;
        this._isBlockDevice = isBlockDevice;
        this._isCharacterDevice = isCharacterDevice;
        this._isSymbolicLink = isSymbolicLink;
        this._isFIFO = isFIFO;
        this._isSocket = isSocket;
    }
}

function wrapDirentEntry(entry: fs.Dirent): DirentEntry {
    const d = new DirentEntry();
    d.name = entry.name;
    d.parentPath = entry.parentPath;
    d.setPredicates(
        entry.isFile(),
        entry.isDirectory(),
        entry.isBlockDevice(),
        entry.isCharacterDevice(),
        entry.isSymbolicLink(),
        entry.isFIFO(),
        entry.isSocket()
    );
    return d;
}

function hasZipMagic(fs: FakeFS<PortablePath>, p: PortablePath): boolean {
    let fd: number | undefined;
    try {
        fd = fs.openSync(p, 'r');
        const buffer = Buffer.alloc(4);
        const bytesRead = fs.readSync(fd, buffer, 0, 4, 0);
        if (bytesRead < 4) {
            return false;
        }

        for (const magic of zipMagic) {
            if (buffer.compare(magic) === 0) {
                return true;
            }
        }

        return false;
    } catch {
        return false;
    } finally {
        if (fd !== undefined) {
            fs.closeSync(fd);
        }
    }
}

/* eslint-disable @typescript-eslint/naming-convention */

// Patch fslib's ZipOpenFS to also consider .egg files to be .zip files.
//
// For now, override findZip (even though it's private), with the intent
// to upstream a change to allow overriding getArchivePart or add some
// other mechanism to support more extensions as zips (or, to remove this
// hack in favor of a full ZipOpenFS fork).
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
//@ts-expect-error
class EggZipOpenFS extends ZipOpenFS {
    override findZip(p: PortablePath) {
        // Access private fields from parent via any cast since they're not accessible in subclass
        const baseFs = (this as any).baseFs as FakeFS<PortablePath>;
        const filter = (this as any).filter as RegExp | null;
        const isZip = (this as any).isZip as Set<PortablePath>;
        const notZip = (this as any).notZip as Set<PortablePath>;

        if (filter && !filter.test(p)) return null;

        let filePath = `` as PortablePath;

        while (true) {
            const archivePart = getArchivePart(p.slice(filePath.length));
            if (!archivePart) return null;

            filePath = this.pathUtils.join(filePath, archivePart);

            if (isZip.has(filePath) === false) {
                if (notZip.has(filePath)) continue;

                try {
                    if (!baseFs.lstatSync(filePath).isFile()) {
                        notZip.add(filePath);
                        continue;
                    }

                    if (!hasZipMagic(baseFs, filePath)) {
                        notZip.add(filePath);
                        continue;
                    }

                    try {
                        // We're pretty sure that it's a zip at this point (it has the magic), but
                        // try accessing the zipfile anyway; if it's corrupt in some way, this will throw.
                        // We don't need to do anything with the ZipFS instance given to the callback
                        // below; ZipOpenFS already manages their lifetimes and we're very likely to
                        // immediately call back into the FS to obtain info from the zip anyway.
                        // eslint-disable-next-line @typescript-eslint/no-empty-function
                        this.getZipSync(filePath, () => {});
                    } catch {
                        notZip.add(filePath);
                        continue;
                    }
                } catch {
                    return null;
                }

                isZip.add(filePath);
            }

            return {
                archivePath: filePath,
                subPath: this.pathUtils.join(PortablePath.root, p.slice(filePath.length) as PortablePath),
            };
        }
    }

    // Hack to provide typed access to this private method.
    private override getZipSync<T>(p: PortablePath, accept: (zipFs: ZipFS) => T): T {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-expect-error
        return super.getZipSync(p, accept);
    }
}

/* eslint-enable @typescript-eslint/naming-convention */

class YarnFS extends PosixFS {
    private readonly _eggZipOpenFS: EggZipOpenFS;

    constructor() {
        const eggZipOpenFS = new EggZipOpenFS({
            libzip: () => getLibzipSync(),
            useCache: true,
            maxOpenFiles: 80,
            readOnlyArchives: true,
        });

        super(
            new VirtualFS({
                baseFs: eggZipOpenFS,
            })
        );

        this._eggZipOpenFS = eggZipOpenFS;
    }

    isZip(p: NativePath): boolean {
        return !!this._eggZipOpenFS.findZip(this.mapToBase(p));
    }
}

const yarnFS = new YarnFS();

// Use `createFromRealFileSystem` instead of `new RealFileSystem`
// unless you are creating a new file system that inherits from `RealFileSystem`
export class RealFileSystem implements FileSystem {
    constructor(
        private readonly _caseSensitiveDetector: CaseSensitivityDetector,
        private readonly _console: ConsoleInterface,
        private readonly _fileWatcherProvider: FileWatcherProvider
    ) {
        // Empty
    }

    existsSync(uri: Uri) {
        if (uri.isEmpty() || !FileUri.isFileUri(uri)) {
            return false;
        }
        const path = uri.getFilePath();
        try {
            // Catch zip open errors. existsSync is assumed to never throw by callers.
            return yarnFS.existsSync(path);
        } catch {
            return false;
        }
    }

    mkdirSync(uri: Uri, options?: MkDirOptions) {
        const path = uri.getFilePath();
        yarnFS.mkdirSync(path, options);
    }

    chdir(uri: Uri) {
        const path = uri.getFilePath();
        // If this file system happens to be running in a worker thread,
        // then we can't call 'chdir'.
        if (isMainThread) {
            process.chdir(path);
        }
    }

    readdirSync(uri: Uri): string[] {
        const path = uri.getFilePath();
        return yarnFS.readdirSync(path);
    }

    readdirEntriesSync(uri: Uri): fs.Dirent[] {
        const path = uri.getFilePath();
        return yarnFS.readdirSync(path, { withFileTypes: true }).map((entry): fs.Dirent => {
            const wrapped = wrapDirentEntry(entry);
            // Treat zip/egg files as directories.
            // See: https://github.com/yarnpkg/berry/blob/master/packages/vscode-zipfs/sources/ZipFSProvider.ts
            if (hasZipExtension(entry.name)) {
                if (entry.isFile() && yarnFS.isZip(path)) {
                    wrapped.setPredicates(false, true, false, false, false, false, false);
                    wrapped.parentPath = path;
                }
            }
            return wrapped;
        });
    }

    readFileSync(uri: Uri, encoding?: null): Buffer;
    readFileSync(uri: Uri, encoding: BufferEncoding): string;
    readFileSync(uri: Uri, encoding?: BufferEncoding | null): Buffer | string;
    readFileSync(uri: Uri, encoding: BufferEncoding | null = null) {
        const path = uri.getFilePath();
        if (encoding === 'utf8' || encoding === 'utf-8') {
            return yarnFS.readFileSync(path, 'utf8');
        }
        return yarnFS.readFileSync(path);
    }

    readFileRangeSync(uri: Uri, offset: number, length: number): Buffer {
        const path = uri.getFilePath();
        const buffer = Buffer.alloc(length);
        const fd = yarnFS.openSync(path, 'r');
        try {
            const bytesRead = yarnFS.readSync(fd, buffer, 0, length, offset);
            return buffer.subarray(0, bytesRead);
        } finally {
            yarnFS.closeSync(fd);
        }
    }

    writeFileSync(uri: Uri, data: string | Buffer, encoding: BufferEncoding | null) {
        const path = uri.getFilePath();
        yarnFS.writeFileSync(path, data, encoding || undefined);
    }

    statSync(uri: Uri): fs.Stats {
        if (FileUri.isFileUri(uri)) {
            const path = uri.getFilePath();
            const stat = wrapStats(yarnFS.statSync(path));
            // Treat zip/egg files as directories.
            // See: https://github.com/yarnpkg/berry/blob/master/packages/vscode-zipfs/sources/ZipFSProvider.ts
            if (hasZipExtension(path)) {
                if (stat.isFile() && yarnFS.isZip(path)) {
                    stat.setPredicates(false, true, false, false, false, false, false, true);
                    return stat;
                }
            }
            return stat;
        } else {
            // scriptc: a function-bearing record cannot cross the dynamic
            // dispatch boundary; a class instance can.
            return new EmptyStats();
        }
    }

    rmdirSync(uri: Uri): void {
        const path = uri.getFilePath();
        yarnFS.rmdirSync(path);
    }

    unlinkSync(uri: Uri) {
        const path = uri.getFilePath();
        yarnFS.unlinkSync(path);
    }

    realpathSync(uri: Uri) {
        try {
            const path = uri.getFilePath();
            return Uri.file(yarnFS.realpathSync(path), this._caseSensitiveDetector);
        } catch (e: any) {
            return uri;
        }
    }

    getModulePath(): Uri {
        // The entry point to the tool should have set the __rootDirectory
        // global variable to point to the directory that contains the
        // typeshed-fallback directory.
        return getRootUri(this._caseSensitiveDetector) || Uri.empty();
    }

    createFileSystemWatcher(paths: Uri[], listener: FileWatcherEventHandler): FileWatcher {
        return this._fileWatcherProvider.createFileWatcher(
            paths.map((p) => p.getFilePath()),
            listener
        );
    }

    createReadStream(uri: Uri): fs.ReadStream {
        const path = uri.getFilePath();
        return yarnFS.createReadStream(path);
    }

    createWriteStream(uri: Uri): fs.WriteStream {
        const path = uri.getFilePath();
        return yarnFS.createWriteStream(path);
    }

    copyFileSync(src: Uri, dst: Uri): void {
        const srcPath = src.getFilePath();
        const destPath = dst.getFilePath();
        yarnFS.copyFileSync(srcPath, destPath);
    }

    readFile(uri: Uri): Promise<Buffer> {
        const path = uri.getFilePath();
        return yarnFS.readFilePromise(path);
    }

    async readFileText(uri: Uri, encoding: BufferEncoding): Promise<string> {
        const path = uri.getFilePath();
        if (encoding === 'utf8' || encoding === 'utf-8') {
            return yarnFS.readFilePromise(path, 'utf8');
        }
        const buffer = await yarnFS.readFilePromise(path);
        return buffer.toString(encoding);
    }

    realCasePath(uri: Uri): Uri {
        try {
            // If it doesn't exist in the real FS, then just use this path.
            if (!this.existsSync(uri)) {
                return uri;
            }

            // realpathSync.native will return casing as in OS rather than
            // trying to preserve casing given.
            const realCase = fs.realpathSync.native(uri.getFilePath());

            // If the original and real case paths differ by anything other than case,
            // then there's a symbolic link or something of that sort involved. Return
            // the original path instead.
            if (uri.getFilePath().toLowerCase() !== realCase.toLowerCase()) {
                return uri;
            }

            // On UNC mapped drives we want to keep the original drive letter.
            if (getRootLength(realCase) !== getRootLength(uri.getFilePath())) {
                return uri;
            }

            return Uri.file(realCase, this._caseSensitiveDetector);
        } catch (e: any) {
            // Return as it is, if anything failed.
            this._console.log(`Failed to get real file system casing for ${uri}: ${e}`);

            return uri;
        }
    }

    isMappedUri(uri: Uri): boolean {
        return false;
    }

    getOriginalUri(mappedUri: Uri) {
        return mappedUri;
    }

    getMappedUri(originalUri: Uri) {
        return originalUri;
    }

    mapDirectory(mappedUri: Uri, originalUri: Uri, filter?: (originalUri: Uri, fs: FileSystem) => boolean): Disposable {
        // Not supported at this level.
        return {
            dispose: () => {
                // Do nothing.
            },
        };
    }

    isInZip(uri: Uri): boolean {
        const path = uri.getFilePath();
        return zipPathRegEx.test(path) && yarnFS.isZip(path);
    }
}

interface WorkspaceFileWatcher extends FileWatcher {
    // Paths that are being watched within the workspace
    workspacePaths: string[];

    // Event handler to call
    eventHandler: FileWatcherEventHandler;
}

export class WorkspaceFileWatcherProvider implements FileWatcherProvider, FileWatcherHandler {
    private _fileWatchers: WorkspaceFileWatcher[] = [];

    createFileWatcher(workspacePaths: string[], listener: FileWatcherEventHandler): FileWatcher {
        const self = this;
        const fileWatcher: WorkspaceFileWatcher = {
            close() {
                // Stop listening for workspace paths.
                self._fileWatchers = self._fileWatchers.filter((watcher) => watcher !== fileWatcher);
            },
            workspacePaths,
            eventHandler: listener,
        };

        // Record the file watcher.
        self._fileWatchers.push(fileWatcher);

        return fileWatcher;
    }

    onFileChange(eventType: FileWatcherEventType, fileUri: Uri): void {
        // Since file watcher is a server wide service, we don't know which watcher is
        // for which workspace (for multi workspace case), also, we don't know which watcher
        // is for source or library. so we need to solely rely on paths that can cause us
        // to raise events both for source and library if .venv is inside of workspace root
        // for a file change. It is event handler's job to filter those out.
        this._fileWatchers.forEach((watcher) => {
            const dirUris = watcher.workspacePaths.map((d) => UriEx.file(d, fileUri.isCaseSensitive));
            if (dirUris.some((dir) => fileUri.startsWithUri(dir))) {
                watcher.eventHandler(eventType, fileUri.getFilePath());
            }
        });
    }
}

export class RealTempFile implements TempFile, CaseSensitivityDetector {
    private _caseSensitivity?: boolean;
    private _tmpdir?: tmp.DirResult;

    constructor(name?: string) {
        if (name) {
            this._tmpdir = {
                name,
                removeCallback: () => {
                    // If a name is provided, the temp folder is not managed by this instance.
                    // Do nothing.
                },
            };
        }
    }

    tmpdir(): Uri {
        return Uri.file(this._getTmpDir().name, this);
    }

    tmpfile(options?: TmpfileOptions): Uri {
        const f = tmp.fileSync({ dir: this._getTmpDir().name, discardDescriptor: true, ...options });
        return Uri.file(f.name, this);
    }

    mktmpdir(): Uri {
        const d = tmp.dirSync();
        return Uri.file(d.name, this);
    }

    dispose(): void {
        try {
            this._tmpdir?.removeCallback();
            this._tmpdir = undefined;
        } catch {
            // ignore
        }
    }

    isCaseSensitive(uri: string): boolean {
        if (uri.startsWith(FileUriSchema)) {
            return this._isLocalFileSystemCaseSensitive();
        }

        return true;
    }

    private _isLocalFileSystemCaseSensitive() {
        if (this._caseSensitivity === undefined) {
            this._caseSensitivity = this._isFileSystemCaseSensitiveInternal();
        }

        return this._caseSensitivity;
    }

    private _getTmpDir(): tmp.DirResult {
        if (this._tmpdir) {
            return this._tmpdir;
        }

        const osTempRoot = os.tmpdir();
        const configuredTmpRoot = process.env.PYRIGHT_TMPDIR?.trim();

        type TmpDirOutcome = {
            tmpdir?: tmp.DirResult;
            error?: unknown;
        };

        const createTmpDir = (options: tmp.DirOptions): TmpDirOutcome => {
            try {
                return { tmpdir: tmp.dirSync(options) };
            } catch (e: unknown) {
                return { error: e };
            }
        };

        const createTmpDirInRoot = (root: string): TmpDirOutcome => {
            try {
                fs.mkdirSync(root, { recursive: true });
            } catch (e: unknown) {
                return { error: e };
            }

            return createTmpDir({ prefix: 'pyright', tmpdir: root });
        };

        // Highest priority: explicit override.
        if (configuredTmpRoot) {
            const configuredOutcome = createTmpDirInRoot(configuredTmpRoot);
            if (configuredOutcome.tmpdir) {
                this._tmpdir = configuredOutcome.tmpdir;
                return this._tmpdir;
            }
        }

        // Default behavior: let tmp/os decide.
        const defaultOutcome = createTmpDir({ prefix: 'pyright' });
        if (defaultOutcome.tmpdir) {
            this._tmpdir = defaultOutcome.tmpdir;
            return this._tmpdir;
        }

        const defaultError = defaultOutcome.error as NodeJS.ErrnoException | undefined;

        const details = defaultError?.message ?? String(defaultOutcome.error);

        throw new Error(
            `Failed to create a temporary directory for Pyright. The OS temp directory root is "${osTempRoot}". ` +
                `If that path doesn't exist or isn't writable, set PYRIGHT_TMPDIR or TMPDIR/TMP/TEMP for the VS Code server/extension host process ` +
                `or ensure the env vars are inherited by the remote/server process. ` +
                `Original error: ${details}`
        );
    }

    private _isFileSystemCaseSensitiveInternal() {
        let filePath: string | undefined = undefined;
        try {
            // Make unique file name.
            let name: string;
            let mangledFilePath: string;
            do {
                name = `${randomBytesHex(21)}-a`;
                filePath = combinePaths(this._getTmpDir().name, name);
                mangledFilePath = combinePaths(this._getTmpDir().name, name.toUpperCase());
            } while (fs.existsSync(filePath) || fs.existsSync(mangledFilePath));

            fs.writeFileSync(filePath, '', 'utf8');

            // If file exists, then it is insensitive.
            return !fs.existsSync(mangledFilePath);
        } catch (e: any) {
            return false;
        } finally {
            if (filePath) {
                // remove temp file created
                try {
                    fs.unlinkSync(filePath);
                } catch (e: any) {
                    /* ignored */
                }
            }
        }
    }
}
