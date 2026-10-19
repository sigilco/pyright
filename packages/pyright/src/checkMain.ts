// Reduced-scope entry for fence iteration: single-threaded typecheck only.
// Supports: <files...>, --project, --outputjson, --verbose, --pythonversion,
// --pythonplatform, --pythonpath, --venvpath, --typeshedpath, --skipunannotated,
// --level, --warnings, --version.
// Dropped vs pyright.ts: --watch, --threads, --verifytypes, --createstub,
// --dependencies, --stats, stdin file list — so PackageTypeVerifier,
// typeStubGeneration, worker/LSP machinery stay out of the bundle.
import * as fs from 'fs';
import * as path from 'path';
import { main } from 'pyright-internal/checkMain';
import { setScriptcRootDirectory } from 'pyright-internal/common/uri/uriUtils';

if (!(global as any).__rootDirectory) {
    const candidates = [__dirname, path.dirname(process.execPath)];
    const root = candidates.find((dir) => fs.existsSync(path.join(dir, 'typeshed-fallback'))) ?? __dirname;
    (global as any).__rootDirectory = root + path.sep;
    setScriptcRootDirectory(root + path.sep);
}

main();
