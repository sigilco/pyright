// probe-expect: diverge
// class-shape probe: a local class inside a function that captures the closure
// environment, has a static member and a computed accessor — the SC9001/SC1090
// class-capture fence family.

function makeCounter(step) {
    class Counter {
        static kind = 'counter';
        constructor() {
            this.n = 0;
        }
        get ['dou' + 'bled']() {
            return this.n * 2;
        }
        bump() {
            this.n += step;
            return this.n;
        }
    }
    return new Counter();
}

const c = makeCounter(3);
console.log(c.bump(), c.bump(), c.doubled, c.constructor.kind);
// Expected: "3 6 6 counter"
// Known divergence: static-member read via `c.constructor.kind` throws
// natively (class statics don't survive the dyn boundary); computed accessor
// and closure capture work on 0.3.6.
