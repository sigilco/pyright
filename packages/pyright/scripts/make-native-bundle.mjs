// Post-process dist-cli-dev/pyright-flat.js into a scriptc-native-targeting
// bundle: strip the createRequire banner and replace every __require("builtin")
// with a lookup over real ESM imports (scriptc has no CJS require at runtime).
import { readFileSync, writeFileSync } from 'node:fs';

const src = 'dist-cli-dev/pyright-flat.js';
const out = 'dist-cli-dev/pyright-native.js';
let code = readFileSync(src, 'utf8');

// Drop the createRequire/__dirname banner (first line).
const nl = code.indexOf('\n');
if (!code.startsWith('import{createRequire}')) throw new Error('banner not found');
code = code.slice(nl + 1);

const builtins = [...new Set([...code.matchAll(/__require\("([^"]+)"\)/g)].map((m) => m[1]))].sort();
const UNSUPPORTED = new Set(['v8']); // scriptc-refused builtins -> empty stub (callers feature-detect via try/catch)
const imports = builtins
    .filter((b) => !UNSUPPORTED.has(b))
    .map((b, i) => `import * as __builtin_${b.replace(/[^a-zA-Z0-9]/g, '_')} from 'node:${b}';`)
    .join('\n');
const map = `const __builtinRequire = (x) => ({${builtins.map((b) => `${JSON.stringify(b)}: ${UNSUPPORTED.has(b) ? '{}' : `__builtin_${b.replace(/[^a-zA-Z0-9]/g, '_')}`}`).join(', ')}})[x];`;
// import.meta-free __dirname for the native target; the runtime resolves
// typeshed via process.execPath's directory anyway.
const shim = `${imports}\nconst __dirname = '';\n${map}\n`;

// scriptc has no for-in over checked-dynamic kinds (functions, Maps, class
// values); rewrite `for (k in expr)` -> `for (k of Object.keys(expr))` for the
// dep-internal sites that actually execute. Own-enumerable-keys semantics are
// sufficient for all of them.
code = code.replace(
    /for \((var|let|const) ([A-Za-z_$][A-Za-z0-9_$]*) in ([A-Za-z_$][A-Za-z0-9_$.]*)\)/g,
    'for ($1 $2 of Object.keys($3))'
);

// scriptc fences `class X extends <member-expr>` (SC1090). Every such site in
// the bundle is `var X = class [N] extends A.B.C` inside a __commonJS body or
// at module top level; rewrite to `var __extN = A.B.C, X = class [N] extends
// __extN` — the alias declarator keeps the same scope and evaluation order.
{
    let n = 0;
    code = code.replace(
        /(var|let|const) ([A-Za-z_$][A-Za-z0-9_$]*) = (class(?: [A-Za-z_$][A-Za-z0-9_$]*)? extends )([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+)/g,
        (_m, kw, name, classHead, base) => {
            const alias = `__extendsBase${n++}`;
            return `${kw} ${alias} = ${base}, ${name} = ${classHead}${alias}`;
        }
    );
    console.log(`rewrote ${n} member-expression extends clauses`);
}

// scriptc does not lower `string.prototype.substr` (SC2020). Rewrite
// `X.substr(a, b)` -> `X.substring(a, (a) + (b))` and `X.substr(a)` ->
// `X.substring(a)` — equivalent for string receivers (negative-start
// semantics never occur in this bundle).
{
    let n = 0;
    let out2 = '';
    let i = 0;
    while (i < code.length) {
        const j = code.indexOf('.substr(', i);
        if (j < 0) break;
        // Find the matching close paren.
        let depth = 1;
        let k = j + '.substr('.length;
        const argStart = k;
        while (k < code.length && depth > 0) {
            const ch = code[k];
            if (ch === '(') depth++;
            else if (ch === ')') depth--;
            else if (ch === '"' || ch === "'" || ch === '`') {
                // skip string/template literals (naive: no `${` tracking)
                const q = ch;
                k++;
                while (k < code.length && code[k] !== q) {
                    if (code[k] === '\\') k++;
                    k++;
                }
            }
            k++;
        }
        const args = code.slice(argStart, k - 1);
        // Split top-level commas.
        const parts = [];
        let d = 0;
        let last = 0;
        for (let m = 0; m < args.length; m++) {
            const ch = args[m];
            if (ch === '(' || ch === '[' || ch === '{') d++;
            else if (ch === ')' || ch === ']' || ch === '}') d--;
            else if (ch === ',' && d === 0) {
                parts.push(args.slice(last, m));
                last = m + 1;
            }
        }
        parts.push(args.slice(last));
        out2 += code.slice(i, j);
        if (parts.length === 2) {
            out2 += `.substring(${parts[0]}, (${parts[0]}) + (${parts[1]}))`;
        } else {
            out2 += `.substring(${args})`;
        }
        n++;
        i = k;
    }
    out2 += code.slice(i);
    code = out2;
    console.log(`rewrote ${n} .substr( call sites`);
}

code = shim + code.replace(/__require\(/g, '__builtinRequire(');
writeFileSync(out, code);
console.log(`wrote ${out} (${builtins.length} builtins mapped: ${builtins.join(', ')})`);
