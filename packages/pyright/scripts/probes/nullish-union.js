// Probe: `??` on a union-typed ctor param vs a plain local.
class E {
    constructor(v) {
        this.f = v ?? { major: 3, minor: 14 };
    }
}
const a = new E(undefined);
console.log('ctor??undefined:', a.f.major);
const b = new E({ major: 3, minor: 8 });
console.log('ctor??defined:', b.f.minor);
const local = undefined;
console.log('local??:', (local ?? { x: 1 }).x);
