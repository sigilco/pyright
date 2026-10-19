import * as fs from 'fs';
import * as path from 'path';
import { main } from 'pyright-internal/pyright';
import { setScriptcRootDirectory } from 'pyright-internal/common/uri/uriUtils';

// The npm wrapper (index.js) sets __rootDirectory before loading the bundle.
// A standalone single-file bundle (or a compiled native binary) has no such
// wrapper, so locate the directory containing typeshed-fallback ourselves:
// beside the bundle (__dirname) or beside the executable (process.execPath).
if (!(global as any).__rootDirectory) {
    const candidates = [__dirname, path.dirname(process.execPath)];
    const root = candidates.find((dir) => fs.existsSync(path.join(dir, 'typeshed-fallback'))) ?? __dirname;
    (global as any).__rootDirectory = root + path.sep;
    setScriptcRootDirectory(root + path.sep);
}

main();
