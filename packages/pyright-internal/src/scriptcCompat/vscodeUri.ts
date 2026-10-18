/*
 * scriptc-compat vendored port of `vscode-uri` (MIT, microsoft/vscode-uri).
 *
 * The published package's ESM entry is a bundled file that vendors a minified
 * `path` polyfill whose emitted forms (webpack runtime, chained assignments,
 * uninitialized namespace vars) are runtime fences under scriptc. This file
 * ports the readable `lib/umd/uri.js` + `lib/umd/utils.js` implementation to
 * modern TypeScript against `node:path.posix`, preserving URI semantics:
 * percent-encoding in toString(), graceful decoding in parse(), UNC handling
 * in file(), drive-letter normalization in fsPath, and the $mid revive format.
 * Windows-only behavior (isWindows path conversions) is compiled away since
 * the native typechecker targets POSIX hosts.
 */

import * as nodePath from 'node:path';

const _schemePattern = /^\w[\w\d+.-]*$/;
const _singleSlashStart = /^\//;
const _doubleSlashStart = /^\/\//;

interface UriComponents {
    scheme: string;
    authority: string;
    path: string;
    query: string;
    fragment: string;
}

interface UriChange {
    scheme?: string | null;
    authority?: string | null;
    path?: string | null;
    query?: string | null;
    fragment?: string | null;
}

function _validateUri(ret: UriComponents, _strict: boolean): void {
    if (!ret.scheme && _strict) {
        throw new Error(
            `[UriError]: Scheme is missing: {scheme: "", authority: "${ret.authority}", path: "${ret.path}", query: "${ret.query}", fragment: "${ret.fragment}"}`
        );
    }
    if (ret.scheme && !_schemePattern.test(ret.scheme)) {
        throw new Error('[UriError]: Scheme contains illegal characters.');
    }
    if (ret.path) {
        if (ret.authority) {
            if (!_singleSlashStart.test(ret.path)) {
                throw new Error(
                    '[UriError]: If a URI contains an authority component, then the path component must either be empty or begin with a slash ("/") character'
                );
            }
        } else {
            if (_doubleSlashStart.test(ret.path)) {
                throw new Error(
                    '[UriError]: If a URI does not contain an authority component, then the path cannot begin with two slash characters ("//")'
                );
            }
        }
    }
}

function _schemeFix(scheme: string, _strict: boolean): string {
    if (!scheme && !_strict) {
        return 'file';
    }
    return scheme;
}

function _referenceResolution(scheme: string, path: string): string {
    switch (scheme) {
        case 'https':
        case 'http':
        case 'file':
            if (!path) {
                path = _slash;
            } else if (path[0] !== _slash) {
                path = _slash + path;
            }
            break;
    }
    return path;
}

const _empty = '';
const _slash = '/';
const _regexp = /^(([^:/?#]+?):)?(\/\/([^/?#]*))?([^?#]*)(\?([^#]*))?(#(.*))?/;

export class URI implements UriComponents {
    static isUri(thing: any): thing is URI {
        if (thing instanceof URI) {
            return true;
        }
        if (!thing) {
            return false;
        }
        return (
            typeof thing.authority === 'string' &&
            typeof thing.fragment === 'string' &&
            typeof thing.path === 'string' &&
            typeof thing.query === 'string' &&
            typeof thing.scheme === 'string' &&
            typeof thing.fsPath === 'string' &&
            typeof thing.with === 'function' &&
            typeof thing.toString === 'function'
        );
    }

    scheme: string;
    authority: string;
    path: string;
    query: string;
    fragment: string;

    constructor(
        schemeOrData: string | Partial<UriComponents>,
        authority?: string,
        path?: string,
        query?: string,
        fragment?: string,
        _strict = false
    ) {
        if (typeof schemeOrData === 'object') {
            this.scheme = schemeOrData.scheme || _empty;
            this.authority = schemeOrData.authority || _empty;
            this.path = schemeOrData.path || _empty;
            this.query = schemeOrData.query || _empty;
            this.fragment = schemeOrData.fragment || _empty;
        } else {
            this.scheme = _schemeFix(schemeOrData, _strict);
            this.authority = authority || _empty;
            this.path = _referenceResolution(this.scheme, path || _empty);
            this.query = query || _empty;
            this.fragment = fragment || _empty;
            _validateUri(this, _strict);
        }
    }

    get fsPath(): string {
        return uriToFsPath(this, false);
    }

    with(change: UriChange): URI {
        if (!change) {
            return this;
        }
        let { scheme, authority, path, query, fragment } = change;
        if (scheme === undefined) {
            scheme = this.scheme;
        } else if (scheme === null) {
            scheme = _empty;
        }
        if (authority === undefined) {
            authority = this.authority;
        } else if (authority === null) {
            authority = _empty;
        }
        if (path === undefined) {
            path = this.path;
        } else if (path === null) {
            path = _empty;
        }
        if (query === undefined) {
            query = this.query;
        } else if (query === null) {
            query = _empty;
        }
        if (fragment === undefined) {
            fragment = this.fragment;
        } else if (fragment === null) {
            fragment = _empty;
        }
        if (
            scheme === this.scheme &&
            authority === this.authority &&
            path === this.path &&
            query === this.query &&
            fragment === this.fragment
        ) {
            return this;
        }
        return new _Uri(scheme, authority, path, query, fragment);
    }

    static parse(value: string, _strict = false): URI {
        const match = _regexp.exec(value);
        if (!match) {
            return new _Uri(_empty, _empty, _empty, _empty, _empty);
        }
        return new _Uri(
            match[2] || _empty,
            percentDecode(match[4] || _empty),
            percentDecode(match[5] || _empty),
            percentDecode(match[7] || _empty),
            percentDecode(match[9] || _empty),
            _strict
        );
    }

    static file(path: string): URI {
        let authority = _empty;
        // POSIX-only build: backslashes are valid filename characters and are
        // left untouched (upstream replaces them only on Windows).
        if (path[0] === _slash && path[1] === _slash) {
            const idx = path.indexOf(_slash, 2);
            if (idx === -1) {
                authority = path.substring(2);
                path = _slash;
            } else {
                authority = path.substring(2, idx);
                path = path.substring(idx) || _slash;
            }
        }
        return new _Uri('file', authority, path, _empty, _empty);
    }

    static from(components: UriComponents): URI {
        const result = new _Uri(components.scheme, components.authority, components.path, components.query, components.fragment);
        _validateUri(result, true);
        return result;
    }

    toString(skipEncoding = false): string {
        return _asFormatted(this, skipEncoding);
    }

    toJSON(): this {
        return this;
    }

    static revive(data: any): URI {
        if (!data) {
            return data;
        } else if (data instanceof URI) {
            return data;
        } else {
            const result = new _Uri(data);
            result._formatted = data.external;
            result._fsPath = data.fsPath || null;
            return result;
        }
    }
}

class _Uri extends URI {
    _formatted: string | null = null;
    _fsPath: string | null = null;

    override get fsPath(): string {
        if (!this._fsPath) {
            this._fsPath = uriToFsPath(this, false);
        }
        return this._fsPath;
    }

    override toString(skipEncoding = false): string {
        if (!skipEncoding) {
            if (!this._formatted) {
                this._formatted = _asFormatted(this, false);
            }
            return this._formatted;
        }
        return _asFormatted(this, true);
    }

    override toJSON(): any {
        const res: any = {
            $mid: 1,
        };
        if (this._fsPath) {
            res.fsPath = this._fsPath;
        }
        if (this._formatted) {
            res.external = this._formatted;
        }
        if (this.path) {
            res.path = this.path;
        }
        if (this.scheme) {
            res.scheme = this.scheme;
        }
        if (this.authority) {
            res.authority = this.authority;
        }
        if (this.query) {
            res.query = this.query;
        }
        if (this.fragment) {
            res.fragment = this.fragment;
        }
        return res;
    }
}

const encodeTable: { [ch: number]: string | undefined } = {
    [58 /* CharCode.Colon */]: '%3A',
    [47 /* CharCode.Slash */]: '%2F',
    [63 /* CharCode.QuestionMark */]: '%3F',
    [35 /* CharCode.Hash */]: '%23',
    [91 /* CharCode.OpenSquareBracket */]: '%5B',
    [93 /* CharCode.CloseSquareBracket */]: '%5D',
    [64 /* CharCode.AtSign */]: '%40',
    [33 /* CharCode.ExclamationMark */]: '%21',
    [36 /* CharCode.DollarSign */]: '%24',
    [38 /* CharCode.Ampersand */]: '%26',
    [39 /* CharCode.SingleQuote */]: '%27',
    [40 /* CharCode.OpenParen */]: '%28',
    [41 /* CharCode.CloseParen */]: '%29',
    [42 /* CharCode.Asterisk */]: '%2A',
    [43 /* CharCode.Plus */]: '%2B',
    [44 /* CharCode.Comma */]: '%2C',
    [59 /* CharCode.Semicolon */]: '%3B',
    [61 /* CharCode.Equals */]: '%3D',
    [32 /* CharCode.Space */]: '%20',
};

function encodeURIComponentFast(uriComponent: string, isPath: boolean, isAuthority: boolean): string {
    let res: string | undefined = undefined;
    let nativeEncodePos = -1;
    for (let pos = 0; pos < uriComponent.length; pos++) {
        const code = uriComponent.charCodeAt(pos);
        if (
            (code >= 97 /* CharCode.a */ && code <= 122 /* CharCode.z */) ||
            (code >= 65 /* CharCode.A */ && code <= 90 /* CharCode.Z */) ||
            (code >= 48 /* CharCode.Digit0 */ && code <= 57 /* CharCode.Digit9 */) ||
            code === 45 /* CharCode.Dash */ ||
            code === 46 /* CharCode.Period */ ||
            code === 95 /* CharCode.Underline */ ||
            code === 126 /* CharCode.Tilde */ ||
            (isPath && code === 47 /* CharCode.Slash */) ||
            (isAuthority && code === 91 /* CharCode.OpenSquareBracket */) ||
            (isAuthority && code === 93 /* CharCode.CloseSquareBracket */) ||
            (isAuthority && code === 58 /* CharCode.Colon */)
        ) {
            if (nativeEncodePos !== -1) {
                res += encodeURIComponent(uriComponent.substring(nativeEncodePos, pos));
                nativeEncodePos = -1;
            }
            if (res !== undefined) {
                res += uriComponent.charAt(pos);
            }
        } else {
            if (res === undefined) {
                res = uriComponent.slice(0, pos);
            }
            const escaped = encodeTable[code];
            if (escaped !== undefined) {
                if (nativeEncodePos !== -1) {
                    res += encodeURIComponent(uriComponent.substring(nativeEncodePos, pos));
                    nativeEncodePos = -1;
                }
                res += escaped;
            } else if (nativeEncodePos === -1) {
                nativeEncodePos = pos;
            }
        }
    }
    if (nativeEncodePos !== -1) {
        res += encodeURIComponent(uriComponent.substring(nativeEncodePos));
    }
    return res !== undefined ? res : uriComponent;
}

function encodeURIComponentMinimal(path: string): string {
    let res: string | undefined = undefined;
    for (let pos = 0; pos < path.length; pos++) {
        const code = path.charCodeAt(pos);
        if (code === 35 /* CharCode.Hash */ || code === 63 /* CharCode.QuestionMark */) {
            if (res === undefined) {
                res = path.slice(0, pos);
            }
            res += encodeTable[code];
        } else {
            if (res !== undefined) {
                res += path[pos];
            }
        }
    }
    return res !== undefined ? res : path;
}

function uriToFsPath(uri: UriComponents, keepDriveLetterCasing: boolean): string {
    let value;
    if (uri.authority && uri.path.length > 1 && uri.scheme === 'file') {
        value = `//${uri.authority}${uri.path}`;
    } else if (
        uri.path.charCodeAt(0) === 47 /* CharCode.Slash */ &&
        ((uri.path.charCodeAt(1) >= 65 /* CharCode.A */ && uri.path.charCodeAt(1) <= 90) /* CharCode.Z */ ||
            (uri.path.charCodeAt(1) >= 97 /* CharCode.a */ && uri.path.charCodeAt(1) <= 122)) /* CharCode.z */ &&
        uri.path.charCodeAt(2) === 58 /* CharCode.Colon */
    ) {
        if (!keepDriveLetterCasing) {
            value = uri.path[1].toLowerCase() + uri.path.slice(2);
        } else {
            value = uri.path.slice(1);
        }
    } else {
        value = uri.path;
    }
    return value;
}

function _asFormatted(uri: UriComponents, skipEncoding: boolean): string {
    const encoder = !skipEncoding ? encodeURIComponentFast : encodeURIComponentMinimal;
    let res = '';
    let { scheme, authority, path, query, fragment } = uri;
    if (scheme) {
        res += scheme;
        res += ':';
    }
    if (authority || scheme === 'file') {
        res += _slash;
        res += _slash;
    }
    if (authority) {
        let idx = authority.indexOf('@');
        if (idx !== -1) {
            const userinfo = authority.slice(0, idx);
            authority = authority.slice(idx + 1);
            idx = userinfo.lastIndexOf(':');
            if (idx === -1) {
                res += encoder(userinfo, false, false);
            } else {
                res += encoder(userinfo.slice(0, idx), false, false);
                res += ':';
                res += encoder(userinfo.slice(idx + 1), false, true);
            }
            res += '@';
        }
        authority = authority.toLowerCase();
        idx = authority.lastIndexOf(':');
        if (idx === -1) {
            res += encoder(authority, false, true);
        } else {
            res += encoder(authority.slice(0, idx), false, true);
            res += authority.slice(idx);
        }
    }
    if (path) {
        // lower-case windows drive letters in /C:/fff or C:/fff
        if (path.length >= 3 && path.charCodeAt(0) === 47 /* CharCode.Slash */ && path.charCodeAt(2) === 58 /* CharCode.Colon */) {
            const code = path.charCodeAt(1);
            if (code >= 65 /* CharCode.A */ && code <= 90 /* CharCode.Z */) {
                path = `/${String.fromCharCode(code + 32)}:${path.slice(3)}`;
            }
        } else if (path.length >= 2 && path.charCodeAt(1) === 58 /* CharCode.Colon */) {
            const code = path.charCodeAt(0);
            if (code >= 65 /* CharCode.A */ && code <= 90 /* CharCode.Z */) {
                path = `${String.fromCharCode(code + 32)}:${path.slice(2)}`;
            }
        }
        res += encoder(path, true, false);
    }
    if (query) {
        res += '?';
        res += encoder(query, false, false);
    }
    if (fragment) {
        res += '#';
        res += !skipEncoding ? encodeURIComponentFast(fragment, false, false) : fragment;
    }
    return res;
}

function decodeURIComponentGraceful(str: string): string {
    try {
        return decodeURIComponent(str);
    } catch {
        if (str.length > 3) {
            return str.slice(0, 3) + decodeURIComponentGraceful(str.slice(3));
        }
        return str;
    }
}

const _rEncodedAsHex = /(%[0-9A-Za-z][0-9A-Za-z])+/g;
function percentDecode(str: string): string {
    if (!str.match(_rEncodedAsHex)) {
        return str;
    }
    return str.replace(_rEncodedAsHex, (match) => decodeURIComponentGraceful(match));
}

// --- Utils (ported from lib/umd/utils.js) ---

// scriptc: nodePath.posix.* member calls have no lowering; use nodePath.* directly (POSIX-only build).
const slash = '/';

// Object literal rather than a namespace: scriptc refuses the class-value
// static assignments that namespace merging emits.
function joinPath(uri: URI, ...paths: string[]): URI {
    return uri.with({ path: nodePath.join(uri.path, ...paths) });
}

function resolvePath(uri: URI, ...paths: string[]): URI {
    let path = uri.path;
    let slashAdded = false;
    if (path[0] !== slash) {
        path = slash + path; // first segment must be absolute so join+normalize behaves like resolve.
        slashAdded = true;
    }
    // scriptc: nodePath.resolve has no lowering; `path` is absolute here, so
    // join + normalize is equivalent (upstream used resolve).
    let resolvedPath = nodePath.normalize(nodePath.join(path, ...paths));
    if (slashAdded && resolvedPath[0] === slash && !uri.authority) {
        resolvedPath = resolvedPath.substring(1);
    }
    return uri.with({ path: resolvedPath });
}

function dirname(uri: URI): URI {
    if (uri.path.length === 0 || uri.path === slash) {
        return uri;
    }
    let path = nodePath.dirname(uri.path);
    if (path.length === 1 && path.charCodeAt(0) === 46 /* CharCode.Period */) {
        path = '';
    }
    return uri.with({ path });
}

function basename(uri: URI): string {
    return nodePath.basename(uri.path);
}

function extname(uri: URI): string {
    return nodePath.extname(uri.path);
}

export const Utils = {
    joinPath,
    resolvePath,
    dirname,
    basename,
    extname,
};
