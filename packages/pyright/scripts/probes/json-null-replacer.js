// Probe: JSON.stringify null replacer + Number.toString(radix).
const s = JSON.stringify({ a: 1, b: [2] }, null, 2);
console.log('json:', JSON.parse(s).b[0]);
const n = 255;
console.log('hex:', n.toString(16));
