// Restore the scriptc partition cache for the CURRENT bundle from the rolling
// `scriptc-cache` GitHub Release. Idempotent: prints hit/miss; a miss exits 0
// so callers can just proceed with a cold build.
//
// Run BEFORE your first `scriptc build` on a cold machine:
//   node scripts/cache-restore.mjs            # restore for dist-cli-dev/pyright-native.js
//   node scripts/cache-restore.mjs <bundle>   # different bundle
//
// The tarball contains build/native-v1 (frontend + object + partitions — see
// cache-publish.mjs). On a HIT a byte-identical rebuild replays in ~5s.
// If a restored build crashes with `RangeError: Invalid string length`
// (compileTracked >512MB cached-program bug), `rm -rf ~/.cache/scriptc/build`
// and rebuild cold.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cacheKey, scriptcVersion } from './cache-publish.mjs';

const REPO = process.env.GH_REPO || 'sigilco/pyright';
const TAG = process.env.RELEASE_TAG || 'scriptc-cache';
const CACHE = process.env.SCRIPTC_CACHE_DIR || join(process.env.HOME, '.cache', 'scriptc');

const DEFAULT_BUNDLE = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist-cli-dev', 'pyright-native.js');
const bundle = process.argv.find((a, i) => i > 1 && !a.startsWith('--')) || DEFAULT_BUNDLE;
const key = cacheKey(bundle, scriptcVersion());
console.log(`cache key ${key}`);

let assets;
try {
    assets = JSON.parse(
        execFileSync('gh', ['release', 'view', TAG, '-R', REPO, '--json', 'assets'], { encoding: 'utf8' })
    ).assets;
} catch {
    console.log(`MISS — no ${TAG} release on ${REPO}; proceed with a cold build`);
    process.exit(0);
}
const asset = assets.find((a) => a.name === `${key}.tar.zst`) || assets.find((a) => a.name === `${key}.tar.gz`);
if (!asset) {
    console.log(`MISS — no asset ${key}.tar.* on ${REPO}@${TAG}; proceed with a cold build`);
    process.exit(0);
}

const tmp = mkdtempSync(join(tmpdir(), 'scriptc-cache-'));
const tarPath = join(tmp, asset.name);
execFileSync('gh', ['release', 'download', TAG, '-R', REPO, '-p', asset.name, '-D', tmp, '--clobber'], {
    stdio: 'inherit',
});
// Extract relative paths (build/native-v1/...) at the cache root.
mkdirSync(CACHE, { recursive: true });
execFileSync('tar', ['-C', CACHE, '-xf', tarPath], { stdio: 'inherit' });
rmSync(tmp, { recursive: true, force: true });
console.log(`HIT — restored ${asset.name} into ${CACHE}`);
