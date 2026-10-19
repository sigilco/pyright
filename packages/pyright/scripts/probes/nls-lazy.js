// Probe: localize.ts lazy-nls seam — fs.readFileSync + JSON.parse + dynamic
// `any`-map walk with a miss-then-hit candidate loop (mirrors
// loadLocaleStrings in localization/localize.ts).
import * as fs from 'fs';
import * as os from 'os';

const base = `${os.tmpdir()}/nls-probe`;
fs.mkdirSync(`${base}/nls`, { recursive: true });
fs.writeFileSync(
    `${base}/nls/package.nls.en-us.json`,
    JSON.stringify({ Diagnostic: { symbolIsUndefined: '"{name}" is not defined' } })
);

const root = `${base}/`;
const candidates = [root && `${root}/nls`, `${base}/nls`, `${base}/missing`];
let strings;
for (const dir of candidates) {
    if (!dir) {
        continue;
    }
    try {
        strings = JSON.parse(fs.readFileSync(`${dir}/package.nls.en-us.json`, 'utf8'));
        break;
    } catch {
        // Try the next candidate directory.
    }
}

let cur = strings;
for (const part of 'Diagnostic.symbolIsUndefined'.split('.')) {
    if (!cur[part]) {
        cur = undefined;
        break;
    }
    cur = cur[part];
}
console.log(typeof cur === 'string' ? cur : cur && cur.message);
