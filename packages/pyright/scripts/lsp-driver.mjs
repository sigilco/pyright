// stdio LSP driver: node /tmp/lsp-driver.mjs <cmd...>
// e.g. node /tmp/lsp-driver.mjs node /path/langserver.cjs --stdio --cancellationReceive=file:/tmp/lsp-cancel
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const [, , ...cmd] = process.argv;
const root = 'file:///tmp/lsp-ws';
const fileUri = `${root}/test.py`;

const proc = spawn(cmd[0], cmd.slice(1), { stdio: ['pipe', 'pipe', 'inherit'] });

let buf = Buffer.alloc(0);
const pending = new Map();
let nextId = 0;
const events = [];

proc.stdout.on('data', (d) => {
  buf = Buffer.concat([buf, d]);
  for (;;) {
    const hdrEnd = buf.indexOf('\r\n\r\n');
    if (hdrEnd < 0) return;
    const hdr = buf.slice(0, hdrEnd).toString();
    const m = /Content-Length: (\d+)/i.exec(hdr);
    if (!m) { buf = buf.slice(hdrEnd + 4); continue; }
    const len = parseInt(m[1], 10);
    if (buf.length < hdrEnd + 4 + len) return;
    const body = buf.slice(hdrEnd + 4, hdrEnd + 4 + len).toString();
    buf = buf.slice(hdrEnd + 4 + len);
    const msg = JSON.parse(body);
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const r = pending.get(msg.id);
      if (r) { pending.delete(msg.id); r(msg); }
    } else if (msg.method) {
      events.push(msg);
      const short = JSON.stringify(msg.params).slice(0, 300);
      console.log(`[notify] ${msg.method} ${short}`);
    }
  }
});
proc.on('error', (e) => console.log('[proc error]', e));
proc.on('exit', (c) => console.log('[exit]', c));

function send(obj) {
  const s = JSON.stringify(obj);
  proc.stdin.write(`Content-Length: ${Buffer.byteLength(s)}\r\n\r\n${s}`);
}
function request(method, params) {
  const id = ++nextId;
  send({ jsonrpc: '2.0', id, method, params });
  return new Promise((res) => pending.set(id, res));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const init = await request('initialize', {
  processId: process.pid,
  rootUri: root,
  capabilities: { workspace: { workspaceFolders: true }, textDocument: { publishDiagnostics: {} } },
  workspaceFolders: [{ uri: root, name: 'lsp-ws' }],
  initializationOptions: {},
});
console.log('[init] serverInfo:', JSON.stringify(init.result?.serverInfo || null), 'err:', JSON.stringify(init.error || null));

send({ jsonrpc: '2.0', method: 'initialized', params: {} });
send({
  jsonrpc: '2.0', method: 'textDocument/didOpen',
  params: { textDocument: { uri: fileUri, languageId: 'python', version: 1, text: fs.readFileSync('/tmp/lsp-ws/test.py', 'utf8') } },
});

await sleep(3000);

const sym = await request('textDocument/documentSymbol', { textDocument: { uri: fileUri } });
console.log('[documentSymbol]', JSON.stringify(sym.result || sym.error).slice(0, 400));

const hover = await request('textDocument/hover', { textDocument: { uri: fileUri }, position: { line: 0, character: 5 } });
console.log('[hover]', JSON.stringify(hover.result || hover.error).slice(0, 400));

await sleep(1500);
console.log('[bg-log-count]', events.filter(e => e.method === 'window/logMessage' && /BG:/.test(JSON.stringify(e.params))).length);
console.log('[diag-count]', events.filter(e => e.method === 'textDocument/publishDiagnostics').length);

await request('shutdown', null);
send({ jsonrpc: '2.0', method: 'exit' });
await sleep(500);
process.exit(0);
