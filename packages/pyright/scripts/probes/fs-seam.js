// fs-seam probe: fs.statSync called with a value produced by a class method —
// the branded-FilePath pattern. Verifies statSync lowering + Stats predicates.
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

class FileUri {
    constructor(path) {
        this._filePath = path;
    }
    getFilePath() {
        return this._filePath;
    }
}

const uri = new FileUri(fileURLToPath(import.meta.url));
const st = statSync(uri.getFilePath());
console.log('isFile:', st.isFile(), 'size>0:', st.size > 0);
// Expected: "isFile: true size>0: true"
