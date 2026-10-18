// Parity harness: run several pyright CLI binaries over the same sample
// project and diff --version / default / --outputjson output after
// normalizing volatile bits (paths, versions, timing).
//
// Usage:
//   node scripts/parity-check.mjs [sampleDir]
//   node scripts/parity-check.mjs --save-fixtures [fixturesDir]
//
// Binaries are parameterized via env (each is a shell-split command line):
//   PARITY_REF     reference   (default: node <repo>/packages/pyright/dist-cli/pyright.js)
//   PARITY_BUN     bun binary   (default: /tmp/parity-bin/pyright-bun)
//   PARITY_NATIVE  scriptc bin  (default: /tmp/native-test/pyright-native)
// Any of the above may be set to the literal `skip` to omit a binary.
//
// A binary that is missing on disk or fails to spawn is reported as
// `pending` and does not affect the exit code. Exit 0 = parity (or pending),
// 1 = at least one divergence against the reference.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const SAMPLE_DIR = '/tmp/parity2';
const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'parity-fixtures');

const BINARIES = [
    {
        name: 'reference',
        env: 'PARITY_REF',
        defaultCmd: ['node', join(repoRoot, 'packages/pyright/dist-cli/pyright.js')],
        // reference never counts as pending-for-exit purposes, but a missing
        // dist-cli build is still reported rather than crashing.
        required: true,
    },
    { name: 'bun', env: 'PARITY_BUN', defaultCmd: ['/tmp/parity-bin/pyright-bun'], required: false },
    { name: 'native', env: 'PARITY_NATIVE', defaultCmd: ['/tmp/native-test/pyright-native'], required: false },
];

function parseArgs(argv) {
    const opts = { sampleDir: SAMPLE_DIR, saveFixtures: false, fixturesDir: FIXTURES_DIR };
    const rest = [];
    for (const a of argv) {
        if (a === '--save-fixtures') opts.saveFixtures = true;
        else rest.push(a);
    }
    if (rest[0]) opts.sampleDir = resolve(rest[0]);
    if (rest[1]) opts.fixturesDir = resolve(rest[1]);
    return opts;
}

function shlex(s) {
    return s.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g).map((t) => t.replace(/^["']|["']$/g, ''));
}

function commandFor(bin) {
    const env = process.env[bin.env];
    if (env === 'skip') return null;
    return env ? shlex(env) : bin.defaultCmd;
}

function runnable(bin, cmd) {
    if (!cmd) return { ok: false, reason: 'skipped via env' };
    if (cmd[0] === 'node') {
        if (!existsSync(cmd[1])) return { ok: false, reason: `missing bundle ${cmd[1]}` };
        return { ok: true };
    }
    if (!existsSync(cmd[0])) return { ok: false, reason: `missing binary ${cmd[0]}` };
    return { ok: true };
}

function run(cmd, args, cwd) {
    const r = spawnSync(cmd[0], [...cmd.slice(1), ...args], { cwd, encoding: 'utf8', timeout: 120000 });
    if (r.error) return { spawnError: String(r.error.code || r.error), exit: null, stdout: '', stderr: '' };
    return { exit: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', signal: r.signal };
}

function normalize(text, sampleDir) {
    const repoEsc = repoRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const sampleEsc = sampleDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text
        .split('\n')
        .map((l) =>
            l
                .replace(new RegExp(sampleEsc, 'g'), '<SAMPLE>')
                .replace(new RegExp(repoEsc, 'g'), '<REPO>')
                .replace(/pyright \d+\.\d+\.\d+[^\s]*/g, 'pyright <VER>')
                .replace(/"version":\s*"[^"]*"/g, '"version": "<VER>"')
                .replace(/\d+\.\d+\.\d+/g, '<VER>')
                .replace(/"time":\s*[\d.]+/g, '"time": 0')
                .replace(/\(\d+ms\)/g, '(<MS>)')
                .replace(/\b\d+ms\b/g, '<MS>')
                .replace(/\d+ files?/g, (m) => m) // file counts are meaningful
                .replace(/Completed in [\d.]+sec/g, 'Completed in <SEC>sec')
        )
        .join('\n');
}

function normalizeJson(text, sampleDir) {
    let obj;
    try {
        obj = JSON.parse(text);
    } catch {
        return normalize(text, sampleDir);
    }
    const scrub = (v) => {
        if (typeof v === 'string')
            return v
                .replaceAll(sampleDir, '<SAMPLE>')
                .replaceAll(repoRoot, '<REPO>')
                .replace(/file:\/\/[^"']*/g, (m) => m) // keep normalized prefixes below
                .replace(/<SAMPLE>/g, '<SAMPLE>')
                .replace(/<REPO>/g, '<REPO>');
        if (Array.isArray(v)) return v.map(scrub);
        if (v && typeof v === 'object') {
            const out = {};
            for (const [k, val] of Object.entries(v)) {
                if (k === 'time' || k === 'version' || k === 'timeInSec') out[k] = 0;
                else out[k] = scrub(val);
            }
            return out;
        }
        return v;
    };
    return JSON.stringify(scrub(obj), null, 2);
}

function jsonSummary(text) {
    try {
        const o = JSON.parse(text);
        const s = o.summary ?? {};
        const rules = new Set((o.generalDiagnostics ?? []).map((d) => d.rule).filter(Boolean));
        return { errors: s.errorCount, warnings: s.warningCount, info: s.informationCount, rules: [...rules].sort() };
    } catch {
        return null;
    }
}

const opts = parseArgs(process.argv.slice(2));
const { sampleDir } = opts;

if (!existsSync(join(sampleDir, 'pyrightconfig.json'))) {
    console.error(`sample dir ${sampleDir} missing pyrightconfig.json — see fixtures/README for recreation`);
    process.exit(1);
}

const results = {};
for (const bin of BINARIES) {
    const cmd = commandFor(bin);
    const r = runnable(bin, cmd);
    if (!cmd || !r.ok) {
        results[bin.name] = { status: bin.required && cmd ? 'missing' : 'pending', reason: cmd ? r.reason : 'skipped' };
        continue;
    }
    results[bin.name] = {
        status: 'ran',
        cmd: cmd.join(' '),
        version: run(cmd, ['--version'], sampleDir),
        plain: run(cmd, [], sampleDir),
        json: run(cmd, ['--outputjson'], sampleDir),
    };
}

const ref = results.reference;
const rows = [];
let diverged = false;

function compare(name, a, b) {
    // a = reference text, b = candidate text (already normalized)
    return a === b;
}

for (const bin of BINARIES) {
    if (bin.name === 'reference') continue;
    const cand = results[bin.name];
    if (cand.status !== 'ran') {
        rows.push({
            binary: bin.name,
            verdict: cand.status === 'missing' ? 'MISSING' : 'PENDING',
            detail: cand.reason,
        });
        continue;
    }
    if (ref.status !== 'ran') {
        rows.push({ binary: bin.name, verdict: 'NO-REF', detail: 'reference run failed' });
        diverged = true;
        continue;
    }

    const issues = [];
    // --version
    const refVer = normalize(ref.version.stdout + ref.version.stderr, sampleDir);
    const candVer = normalize(cand.version.stdout + cand.version.stderr, sampleDir);
    if (!compare('version', refVer, candVer)) issues.push(`--version: ref=${refVer.trim()} cand=${candVer.trim()}`);

    // exit codes
    if (ref.plain.exit !== cand.plain.exit) issues.push(`exit(default): ref=${ref.plain.exit} cand=${cand.plain.exit}`);
    if (ref.json.exit !== cand.json.exit)
        issues.push(`exit(--outputjson): ref=${ref.json.exit} cand=${cand.json.exit}`);

    // stdout text parity
    const refOut = normalize(ref.plain.stdout, sampleDir);
    const candOut = normalize(cand.plain.stdout, sampleDir);
    if (refOut !== candOut) {
        const rl = refOut.split('\n');
        const cl = candOut.split('\n');
        const diffs = [];
        for (let i = 0; i < Math.max(rl.length, cl.length); i++) {
            if (rl[i] !== cl[i]) diffs.push(`L${i + 1}: ref|${rl[i] ?? '<none>'} cand|${cl[i] ?? '<none>'}`);
        }
        issues.push(`stdout(default) differs:\n    ${diffs.slice(0, 10).join('\n    ')}`);
    }

    // JSON parity
    const refJ = normalizeJson(ref.json.stdout, sampleDir);
    const candJ = normalizeJson(cand.json.stdout, sampleDir);
    const rs = jsonSummary(ref.json.stdout);
    const cs = jsonSummary(cand.json.stdout);
    if (rs && cs) {
        if (rs.errors !== cs.errors || rs.warnings !== cs.warnings || rs.info !== cs.info)
            issues.push(
                `summary: ref ${rs.errors}e/${rs.warnings}w/${rs.info}i cand ${cs.errors}e/${cs.warnings}w/${cs.info}i`
            );
        const missing = rs.rules.filter((x) => !cs.rules.includes(x));
        const extra = cs.rules.filter((x) => !rs.rules.includes(x));
        if (missing.length || extra.length)
            issues.push(`rules: missing=${missing.join(',') || '-'} extra=${extra.join(',') || '-'}`);
    } else if (rs || cs) {
        issues.push('one side emitted non-JSON --outputjson output');
    }
    if (refJ !== candJ && issues.length === 0) issues.push('--outputjson differs (normalized JSON mismatch)');
    else if (refJ !== candJ) issues.push('--outputjson also differs verbatim');

    if (issues.length) diverged = true;
    rows.push({ binary: bin.name, verdict: issues.length ? 'DIVERGED' : 'PARITY', detail: issues.join('; ') });
}

// ---- report ----
console.log(`\nparity-check over ${sampleDir}`);
console.log('binary      verdict   detail');
console.log('----------  --------  ------');
for (const bin of BINARIES) {
    if (bin.name === 'reference') {
        console.log(
            `reference   ${ref.status === 'ran' ? 'ran' : ref.status.toUpperCase()}      ${ref.cmd ?? ref.reason ?? ''}`
        );
    }
}
for (const r of rows) {
    console.log(`${r.binary.padEnd(10)}  ${r.verdict.padEnd(8)}  ${r.detail}`);
}

if (opts.saveFixtures) {
    mkdirSync(opts.fixturesDir, { recursive: true });
    for (const bin of BINARIES) {
        const r = results[bin.name];
        if (r.status !== 'ran') continue;
        writeFileSync(
            join(opts.fixturesDir, `${bin.name}.version.txt`),
            normalize(r.version.stdout + r.version.stderr, sampleDir)
        );
        writeFileSync(
            join(opts.fixturesDir, `${bin.name}.default.txt`),
            `exit=${r.plain.exit}\n` + normalize(r.plain.stdout + r.plain.stderr, sampleDir)
        );
        writeFileSync(join(opts.fixturesDir, `${bin.name}.outputjson.json`), normalizeJson(r.json.stdout, sampleDir));
    }
    console.log(`\nfixtures written to ${opts.fixturesDir}`);
}

process.exit(diverged ? 1 : 0);
