// Publish ~/.cache/scriptc/build/native-v1 to a rolling GitHub Release
// (`scriptc-cache` on sigilco/pyright), keyed by scriptc version + the sha256
// of the scriptc input bundle.
//
// What native-v1 contains (measured 2026-10-19, scriptc 0.3.6):
//   frontend/   serialized program — THE reuse lever: a hit replays the whole
//               build in ~5s. partitions alone give ZERO speedup (measured:
//               49min warm vs 47min cold — emit re-runs regardless).
//   object/     per-object .o + .sha256 pairs (hash-addressed, inert).
//   partitions/ per-partition .bc/.o (content-keyed; only helps on EDITED
//               inputs, not byte-identical rebuilds).
// All entries are content-hash-named — stale entries waste disk, never corrupt.
//
// RangeError caveat: the frontend entry is the same "cached program" that can
// throw `RangeError: Invalid string length` in compileTracked on very large
// inputs (>512MB). Our 533MB entry restored+replayed fine; if a restored build
// crashes with that error, `rm -rf ~/.cache/scriptc/build` and rebuild cold.
//
// Usage: node scripts/cache-publish.mjs [path-to-bundle] [--key-only]
// Env:    SCRIPTC (default `scriptc`), GH_REPO (default sigilco/pyright),
//         SCRIPTC_CACHE_DIR (default ~/.cache/scriptc), RELEASE_TAG.

import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = process.env.GH_REPO || 'sigilco/pyright';
const TAG = process.env.RELEASE_TAG || 'scriptc-cache';
const CACHE = process.env.SCRIPTC_CACHE_DIR || join(process.env.HOME, '.cache', 'scriptc');
const KEEP = 3;

const DEFAULT_BUNDLE = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist-cli-dev', 'pyright-native.js');
const bundle = process.argv.find((a, i) => i > 1 && !a.startsWith('--')) || DEFAULT_BUNDLE;
const keyOnly = process.argv.includes('--key-only');

export function scriptcVersion() {
    return execFileSync(process.env.SCRIPTC || 'scriptc', ['--version'], { encoding: 'utf8' }).trim();
}

export function cacheKey(bundlePath, version) {
    const sha = createHash('sha256').update(readFileSync(bundlePath)).digest('hex').slice(0, 16);
    return `scriptc-${version}-${sha}`;
}

// The reusable subtree: build/native-v1 (frontend + object + partitions),
// relative to the cache root.
function cacheDirs(root) {
    const rel = join('build', 'native-v1');
    return existsSync(join(root, rel)) ? [rel] : [];
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main(bundle, keyOnly);

function main(bundlePath, keyOnlyFlag) {
    const version = scriptcVersion();
    const key = cacheKey(bundlePath, version);
    if (keyOnlyFlag) {
        console.log(key);
        return;
    }

    const dirs = cacheDirs(CACHE);
    if (dirs.length === 0) {
        console.error(`no ${join('build', 'native-v1')} under ${CACHE} — run a scriptc build first`);
        process.exit(1);
    }
    console.log(`key ${key} — caching: ${dirs.join(', ')}`);

    const tmp = mkdtempSync(join(tmpdir(), 'scriptc-cache-'));
    const useZstd = (() => {
        try {
            execSync('zstd --version', { stdio: 'ignore' });
            return true;
        } catch {
            return false;
        }
    })();
    const asset = `${key}.tar.${useZstd ? 'zst' : 'gz'}`;
    const tarPath = join(tmp, asset);
    const tarArgs = ['-C', CACHE, ...(useZstd ? ['-I', 'zstd -19 -T0'] : ['-z']), '-cf', tarPath, ...dirs];
    execFileSync('tar', tarArgs, { stdio: 'inherit' });
    const size = statSync(tarPath).size;
    console.log(`tarball ${asset}: ${(size / 1048576).toFixed(1)} MB`);

    try {
        execFileSync('gh', ['release', 'view', TAG, '-R', REPO], { stdio: 'ignore' });
    } catch {
        execFileSync(
            'gh',
            [
                'release',
                'create',
                TAG,
                '-R',
                REPO,
                '--title',
                'scriptc build cache (rolling)',
                '--notes',
                'Rolling release holding keyed ~/.cache/scriptc build/native-v1 tarballs. Assets are content-keyed; safe to delete and regenerate.',
            ],
            { stdio: 'inherit' }
        );
    }
    execFileSync('gh', ['release', 'upload', TAG, tarPath, '-R', REPO, '--clobber'], { stdio: 'inherit' });
    console.log(`uploaded ${asset} to ${REPO} release ${TAG}`);

    // Prune to the newest KEEP cache assets.
    const assets = JSON.parse(
        execFileSync('gh', ['release', 'view', TAG, '-R', REPO, '--json', 'assets'], { encoding: 'utf8' })
    )
        .assets.filter((a) => /^scriptc-.*\.tar\.(zst|gz)$/.test(a.name))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    for (const a of assets.slice(KEEP)) {
        console.log(`pruning old asset ${a.name}`);
        execFileSync('gh', ['release', 'delete-asset', TAG, a.name, '-R', REPO, '--yes'], { stdio: 'inherit' });
    }
    rmSync(tmp, { recursive: true, force: true });
    console.log('done');
}
