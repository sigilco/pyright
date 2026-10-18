// map-union probe: Map.get returning a `V | undefined` union, then a member
// read on the result — the nls/locale-map fence class.
const strings = new Map([
    ['a', { message: 'alpha' }],
    ['b', { message: 'beta' }],
]);

function lookup(map, key) {
    const entry = map.get(key);
    return entry === undefined ? '<missing>' : entry.message;
}

console.log(lookup(strings, 'a'), lookup(strings, 'zzz'));
// Expected: "alpha <missing>"
