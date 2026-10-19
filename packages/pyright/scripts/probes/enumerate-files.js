// Probe: full source-enumeration chain (Uri -> getFileSpec -> readdirEntries -> matchIncludeFileSpec).
import { Uri } from '../../pyright-internal/src/common/uri/uri';
import {
    getFileSpec,
    getFileSystemEntriesWithSymlinkedDirectories,
    FileSpec,
} from '../../pyright-internal/src/common/uri/uriUtils';
import { createFromRealFileSystem } from '../../pyright-internal/src/common/realFileSystem';
import { tryStat } from '../../pyright-internal/src/common/uri/uriUtils';

const detector = { isCaseSensitive: () => true };
const root = Uri.file('/tmp/fixture-run', detector);
const spec = getFileSpec(root, '.');
console.log('wildcardRoot:', spec.wildcardRoot.toUserVisibleString(), 'rx:', spec.regExp.source);
const fs = createFromRealFileSystem(detector);
const st = tryStat(fs, spec.wildcardRoot);
console.log('stat isDir:', st ? st.isDirectory() : 'nostat');
const entries = getFileSystemEntriesWithSymlinkedDirectories(fs, spec.wildcardRoot);
console.log('files:', entries.files.length, 'dirs:', entries.directories.length);
for (const f of entries.files) {
    console.log('file:', f.toUserVisibleString(), 'match:', FileSpec.matchIncludeFileSpec(spec.regExp, [], f));
}
