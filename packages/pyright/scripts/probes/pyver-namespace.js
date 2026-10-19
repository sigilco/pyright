// Probe: exact emitted shape of pythonVersion.ts init + ExecutionEnvironment ctor `??`.
var PythonVersion;
(function (PythonVersion) {
    function create(major, minor) {
        return { major: major, minor: minor };
    }
    PythonVersion.create = create;
    function toString(v) {
        return v.major + '.' + v.minor;
    }
    PythonVersion.toString = toString;
    function mm2(v) {
        return v.major + '.' + v.minor;
    }
    PythonVersion.mm2 = mm2;
})(PythonVersion || (PythonVersion = {}));
var pythonVersion3_14 = PythonVersion.create(3, 14);
var latestStablePythonVersion = pythonVersion3_14;
class ExecutionEnvironment {
    constructor(defaultPythonVersion) {
        this.pythonVersion = defaultPythonVersion ?? latestStablePythonVersion;
    }
}
const e = new ExecutionEnvironment(undefined);
console.log('ver:', e.pythonVersion.major, e.pythonVersion.minor);
PythonVersion.toMajorMinor = function (v) {
    return v.major + '.' + v.minor;
};
console.log('mm:', PythonVersion.toMajorMinor(e.pythonVersion));
console.log('mm2:', PythonVersion.mm2(e.pythonVersion));
console.log('str:', PythonVersion.toString(e.pythonVersion));
