// Probe runner: compile a tiny focused program through the same scriptc
// toolchain the native pyright build uses, in seconds instead of ~1h.
//
//   node scripts/probe.mjs <probe>          compile to .o (frontend + backend fences;
//                                          no runtime-pack link needed)
//   node scripts/probe.mjs <probe> --run    build an exe and diff `node probe.js`
//                                          against the compiled binary (stdout+exit)
//   node scripts/probe.mjs --all [--run]    every probe in scripts/probes/
//
// <probe> is a probe name (scripts/probes/<name>.js) or a path to a .js/.ts file.
//
// Toolchain:
//   SCRIPTC_CLI   repo cli main.js (default ~/repos/scriptc/packages/cli/dist/main.js).
//                 Used for the default .o compile — this is the fence surface.
//   SCRIPTC       native scriptc binary for --run linking (default: `scriptc` on PATH).
//                 The workspace compiler is often ahead of the published runtime
//                 pack, so repo-CLI exe links can fail on missing scr_* symbols;
//                 point SCRIPTC at the released npm binary for end-to-end runs.
//
// A probe file may contain `// probe-expect: diverge` — then --run success is
// reported as XPASS (fix landed, update the probe) and divergence as XFAIL.
// Exit 0 = all probes in their expected state; 1 = any failure/XPASS.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const probesDir = join(scriptDir, 'probes');
const outRoot = process.env.PROBE_OUT ?? '/tmp/pyright-probes';

const args = process.argv.slice(2);
const run = args.includes('--run');
const all = args.includes('--all');
const targets = args.filter((a) => a !== '--run' && a !== '--all');

function probePath(name) {
    if (name.endsWith('.js') || name.endsWith('.ts')) return resolve(name);
    const p = join(probesDir, `${name}.js`);
    return existsSync(p) ? p : null;
}

const DIAG_RE = /error (SC\d+): (.*)/;

function repoCli() {
    return [
        process.execPath,
        process.env.SCRIPTC_CLI ?? join(homedir(), 'repos/scriptc/packages/cli/dist/main.js'),
    ];
}

function buildObj(file, outDir) {
    const [cmd, cli] = repoCli();
    const out = join(outDir, `${basename(file, extname(file))}.o`);
    return {
        out,
        r: spawnSync(cmd, [cli, 'build', file, '--emit', 'obj', '-o', out], {
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
        }),
    };
}

function buildExe(file, outDir) {
    const bin = process.env.SCRIPTC ?? 'scriptc';
    const out = join(outDir, basename(file, extname(file)));
    return {
        out,
        r: spawnSync(bin, ['build', file, '-o', out], {
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
        }),
    };
}

function diagLine(log) {
    return log.split('\n').find((l) => DIAG_RE.test(l));
}

function runBoth(file, out) {
    const node = spawnSync('node', [file], { encoding: 'utf8' });
    const nat = spawnSync(out, [], { encoding: 'utf8' });
    return { match: node.status === nat.status && node.stdout === nat.stdout, node, nat };
}

const files = all
    ? readdirSync(probesDir)
          .filter((f) => f.endsWith('.js') && !f.startsWith('_'))
          .map((f) => join(probesDir, f))
    : targets.map(probePath);

if (files.length === 0 || files.some((f) => f === null)) {
    console.error('no matching probes; usage: probe.mjs <name|path> [--run] | --all [--run]');
    process.exit(2);
}

let failures = 0;
for (const file of files) {
    const name = basename(file, extname(file));
    const expectDiverge = readFileSync(file, 'utf8').includes('probe-expect: diverge');
    const outDir = join(outRoot, name);
    mkdirSync(outDir, { recursive: true });
    const started = Date.now();

    if (!run) {
        const { out, r } = buildObj(file, outDir);
        const secs = ((Date.now() - started) / 1000).toFixed(1);
        const log = `${r.stdout ?? ''}${r.stderr ?? ''}`;
        if (r.status === 0 && existsSync(out)) {
            console.log(`PASS ${name} (${secs}s, --emit obj)`);
        } else {
            failures++;
            const line = diagLine(log);
            console.log(`FAIL ${name} (${secs}s)`);
            if (line) console.log(`  ${line.trim()}`);
            else console.log(log.split('\n').slice(0, 12).join('\n'));
        }
        continue;
    }

    const { out, r } = buildExe(file, outDir);
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    const log = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    if (r.status !== 0 || !existsSync(out)) {
        failures++;
        const line = diagLine(log);
        console.log(`FAIL ${name} (${secs}s, exe build)`);
        if (line) console.log(`  ${line.trim()}`);
        else console.log(log.split('\n').slice(0, 12).join('\n'));
        continue;
    }
    const cmp = runBoth(file, out);
    if (cmp.match) {
        if (expectDiverge) {
            failures++;
            console.log(`XPASS ${name} (${secs}s) — expected divergence is gone; update the probe`);
        } else {
            console.log(`PASS ${name} (${secs}s, node==native)`);
        }
    } else if (expectDiverge) {
        console.log(`XFAIL ${name} (${secs}s) — known divergence pinned`);
        console.log(`  node:   ${JSON.stringify(cmp.node.stdout)}`);
        console.log(`  native: ${JSON.stringify(cmp.nat.stdout)}`);
    } else {
        failures++;
        console.log(`FAIL ${name} (${secs}s, output diverged)`);
        console.log(`  node: exit=${cmp.node.status} stdout=${JSON.stringify(cmp.node.stdout)}`);
        console.log(`  native: exit=${cmp.nat.status} stdout=${JSON.stringify(cmp.nat.stdout)}`);
    }
}
process.exit(failures === 0 ? 0 : 1);
