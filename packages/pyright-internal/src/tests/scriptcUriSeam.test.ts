/*
 * scriptcUriSeam.test.ts
 *
 * Fork-local seam-isolation test (work/scriptc-native): catches the
 * "Uri→string leak" fence class WITHOUT a scriptc build. The native fence is
 * any site that relies on implicit (or unlisted explicit) `Uri.prototype`
 * toString/valueOf coercion after the value crosses a dyn boundary — under
 * scriptc the prototype toString is invisible there and the site prints
 * `[object Object]` or throws.
 *
 * This test instruments every concrete Uri's `toString` to record its call
 * site while a real analysis runs over a small sample. Under Node all sites
 * work; the point is the INVENTORY: any call site not on the baseline below
 * is a new implicit-coercion dependency that the native build will fence or
 * silently mis-print. Add the baseline entry only after deciding how the site
 * is handled upstream (e.g. `key`, `getFilePath()`, `toUserVisibleString()`).
 *
 * Run: PYLANCE_JEST_TRANSPILE_ONLY=1 npx jest scriptcUriSeam --runInBand
 */

import assert from 'assert';

import { FileUri } from '../common/uri/fileUri';
import { WebUri } from '../common/uri/webUri';
import { ConstantUri } from '../common/uri/constantUri';
import { EmptyUri } from '../common/uri/emptyUri';
import * as TestUtils from './testUtils';

// call sites known and triaged (second stack frame, "file:line:col" with the
// src/… prefix trimmed). Keep sorted; the test fails when a NEW site appears.
const BASELINE: string[] = [
    // Implicit `<`-style comparisons of Uri objects (OrdinaryToPrimitive →
    // toString) — e.g. uri sort comparators such as
    // program.ts `fs.getOriginalUri(a.uri) < fs.getOriginalUri(b.uri)`.
    'at Array.sort (<anonymous>)',
    // `${...uri}` template-literal coercions in _logTracker.log messages.
    'src/analyzer/program.ts:2375:63',
    'src/analyzer/sourceFile.ts:1013:55',
    'src/analyzer/sourceFile.ts:729:54',
    'src/analyzer/sourceFile.ts:925:54',
];

function callerSite(): string {
    const stack = new Error().stack ?? '';
    const frames = stack.split('\n');
    // frame 0: "Error"; frame 1: callerSite; frame 2: the instrumented
    // toString; frame 3: the real caller.
    const frame = frames[3] ?? '';
    const m = frame.match(/(?:\(|at )([^()]+\.(?:ts|js)):(\d+):(\d+)/);
    if (!m) return frame.trim();
    const file = m[1].replace(/^.*pyright-internal[\\/]/, '');
    return `${file}:${m[2]}:${m[3]}`;
}

test('uri toString call-site inventory during analysis', () => {
    const sites = new Map<string, number>();
    const protos = [FileUri.prototype, WebUri.prototype, ConstantUri.prototype, EmptyUri.prototype];
    const originals = protos.map((p) => {
        const original = p.toString;
        const uriClass = p;
        uriClass.toString = function (this: object) {
            const site = callerSite();
            sites.set(site, (sites.get(site) ?? 0) + 1);
            return original.call(this);
        };
        return original;
    });

    try {
        TestUtils.typeAnalyzeSampleFiles(['badToken1.py', 'unicode1.py']);
    } finally {
        protos.forEach((p, i) => {
            p.toString = originals[i];
        });
    }

    const observed = [...sites.keys()].sort();
    const unexpected = observed.filter((s) => !BASELINE.includes(s));
    if (unexpected.length > 0) {
        console.log('Uri toString call sites (new first):\n' + observed.map((s) => `  ${unexpected.includes(s) ? 'NEW ' : '    '}${s} x${sites.get(s)}`).join('\n'));
    }
    assert.deepStrictEqual(unexpected, []);
});
