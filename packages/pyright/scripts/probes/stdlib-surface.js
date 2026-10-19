// std-lib surface probe: a spread of node:fs/node:path calls pyright's fs seam
// relies on. Any unlowered member surfaces as SC2020 at build time.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, normalize } from 'node:path';
import { tmpdir } from 'node:os';

const dir = join(tmpdir(), 'probe-stdlib-surface');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const f = join(dir, 'a.txt');
writeFileSync(f, 'hello');
const ok =
    existsSync(f) &&
    readFileSync(f, 'utf8') === 'hello' &&
    readdirSync(dir).includes('a.txt') &&
    basename(dirname(normalize(f))) === basename(dir);
console.log('ok:', ok);
rmSync(dir, { recursive: true, force: true });
// Expected: "ok: true"
