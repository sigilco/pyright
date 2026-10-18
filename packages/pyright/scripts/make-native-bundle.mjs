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
code = shim +
    code.replace(/__require\(/g, '__builtinRequire(').replace(
        /for \((var|let|const) ([A-Za-z_$][A-Za-z0-9_$]*) in ([A-Za-z_$][A-Za-z0-9_$.]*)\)/g,
        'for ($1 $2 of Object.keys($3))'
    );
writeFileSync(out, code);
console.log(`wrote ${out} (${builtins.length} builtins mapped: ${builtins.join(', ')})`);
