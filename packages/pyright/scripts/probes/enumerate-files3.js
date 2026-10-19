// Probe: exact positional-arg spec path — combinePaths(cwd,'.') -> Uri.file -> getFileSpec -> SourceEnumerator.
import { Uri } from '../../pyright-internal/src/common/uri/uri';
import { getFileSpec } from '../../pyright-internal/src/common/uri/uriUtils';
import { combinePaths } from '../../pyright-internal/src/common/pathUtils';
import { createFromRealFileSystem, RealTempFile } from '../../pyright-internal/src/common/realFileSystem';
import { PyrightFileSystem } from '../../pyright-internal/src/pyrightFileSystem';
import { SourceEnumerator } from '../../pyright-internal/src/analyzer/sourceEnumerator';
import { NullConsole } from '../../pyright-internal/src/common/console';

const tempFile = new RealTempFile();
const fs = new PyrightFileSystem(createFromRealFileSystem(tempFile));
const includeArg = combinePaths(process.cwd(), '.');
console.log('includeArg:', includeArg);
const root = Uri.file(includeArg, tempFile);
const spec = getFileSpec(root, '.');
console.log('wildcardRoot:', spec.wildcardRoot.toUserVisibleString(), 'scheme:', spec.wildcardRoot.scheme);
console.log('regexp:', spec.regExp.source);
const enumerator = new SourceEnumerator([spec], [], false, fs, new NullConsole());
const r = enumerator.enumerate(0);
const m = Array.from(r.matches.values());
console.log('matches:', m.length);
m.forEach((x) => console.log('  ', x.toUserVisibleString()));
