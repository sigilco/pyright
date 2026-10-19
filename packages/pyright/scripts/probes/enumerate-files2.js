// Probe: real source-enumeration path — RealTempFile + Uri.file + getFileSpec + SourceEnumerator.
import { Uri } from '../../pyright-internal/src/common/uri/uri';
import { getFileSpec, FileSpec } from '../../pyright-internal/src/common/uri/uriUtils';
import { createFromRealFileSystem, RealTempFile } from '../../pyright-internal/src/common/realFileSystem';
import { PyrightFileSystem } from '../../pyright-internal/src/pyrightFileSystem';
import { SourceEnumerator } from '../../pyright-internal/src/analyzer/sourceEnumerator';
import { NullConsole } from '../../pyright-internal/src/common/console';

const tempFile = new RealTempFile();
const fs = new PyrightFileSystem(createFromRealFileSystem(tempFile));
const includeSpec = getFileSpec(Uri.file(process.cwd(), tempFile), '.');
console.log('wildcardRoot:', includeSpec.wildcardRoot.toUserVisibleString());
console.log('scheme:', includeSpec.wildcardRoot.scheme);
const enumerator = new SourceEnumerator([includeSpec], [], false, fs, new NullConsole());
const results = enumerator.enumerate(0);
const matches = Array.from(results.matches.values());
console.log('matches:', matches.length);
for (const m of matches) {
    console.log('  ', m.toUserVisibleString());
}

// Second pass with the real default excludes — checks isInPath(root, excludes).
import { defaultExcludes } from '../../pyright-internal/src/common/pathConsts';
const root = Uri.file(process.cwd(), tempFile);
const excludes = defaultExcludes.map((e) => getFileSpec(root, e));
console.log('isInPath root->excludes:', FileSpec.isInPath(includeSpec.wildcardRoot, excludes));
const enumerator2 = new SourceEnumerator([includeSpec], excludes, true, fs, new NullConsole());
const r2 = enumerator2.enumerate(0);
console.log('matches2:', Array.from(r2.matches.values()).length);
