// probe-expect: diverge
// dyn-leak probe: a class instance that crosses an `unknown`/any boundary and
// is then interpolated into a template literal — the Uri→string leak shape.
// Node prints the custom toString; a native fence shows up as [object Object]
// or a build-time SC diagnostic.

class Uri {
    constructor(path) {
        this._path = path;
    }
    toString() {
        return `file://${this._path}`;
    }
}

function describe(thing /* intentionally untyped boundary */) {
    return `uri is ${thing}`;
}

const u = new Uri('/tmp/x.py');
console.log(describe(u));
// Expected (both lanes): "uri is file:///tmp/x.py"
