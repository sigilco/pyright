// Probe: fslib shim's statSync/lstatSync/readdirSync must unwrap native
// fs.Stats/fs.Dirent handles inline (SC1101 — typed -> 'unknown' crossing).
import { FakeFS } from '../../pyright-internal/src/scriptcCompat/fslib';

const fsx = new FakeFS();

const st = fsx.statSync('/tmp');
console.log('stat dir:', st.isDirectory(), 'isFile:', st.isFile(), 'mode:', st.mode > 0);

const lst = fsx.lstatSync('/tmp');
console.log('lstat dir:', lst.isDirectory(), 'size ok:', lst.size >= 0);

const entries = fsx.readdirSync('/tmp', { withFileTypes: true });
const first = entries[0];
console.log('readdir:', entries.length > 0, typeof first.name === 'string', typeof first.isDirectory() === 'boolean');

console.log('existsSync:', fsx.existsSync('/tmp'), fsx.existsSync('/nonexistent-probe-path'));
