# Portable scriptc build cache (2026-10-18)

Session ergonomics for future agents on `work/scriptc-native`:

**Run `node scripts/cache-restore.mjs` (from `packages/pyright/`) BEFORE your
first `scriptc build`.** On a hit it restores the partition cache and your first
build is ~4min instead of ~44min. A MISS is fine — proceed cold, then publish.

- Key = `scriptc-<version>-<sha256(dist-cli-dev/pyright-native.js)[:16]>` —
  rebuild the flat bundle + `make-native-bundle.mjs` first if `dist-cli-dev/`
  is absent, since the key is over the *current* bundle bytes.
- The tarball ships all of `build/native-v1/` (frontend + object +
  partitions, all content-hash-named). Measured: partitions-only restore =
  ZERO speedup (49min ≈ cold); full restore = 5.8s replay. `frontend/` is
  the lever; partitions only pay on edited inputs.
- RangeError caveat: `frontend/` is the "cached program" behind the >512MB
  `compileTracked` RangeError — ours (533MB) replayed fine, but if a
  restored build crashes with it, `rm -rf ~/.cache/scriptc/build`, rebuild
  cold, republish.
- Publish after a successful cold build or bundle change:
  `node scripts/cache-publish.mjs` → uploads to the rolling `scriptc-cache`
  release on sigilco/pyright, keeps newest 3 assets.
- Keep `-o` stable across builds (`/tmp/pyright-native`) — the exe cache keys
  on outPath, and the warm path assumes a stable output.
- Blueprint note for the orchestrator: sessions should run
  `node packages/pyright/scripts/cache-restore.mjs` after deps install /
  bundle build. Do NOT edit the blueprint YAML from the session.
