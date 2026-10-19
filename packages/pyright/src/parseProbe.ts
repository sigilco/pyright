import * as fs from 'fs';
import { Parser, ParseOptions } from 'pyright-internal/parser/parser';
import { DiagnosticSink } from 'pyright-internal/common/diagnosticSink';
import { ModuleNode } from 'pyright-internal/parser/parseNodes';
import { TokenType } from 'pyright-internal/parser/tokenizerTypes';
import { createStringAnnotationInfo } from 'pyright-internal/parser/stringAnnotationInfo';

const sink = new DiagnosticSink();
const opts = new ParseOptions();
function mkParser(text: string): any {
    const p: any = new Parser();
    p._hasTypeAnnotations = false;
    p._stringAnnotations = createStringAnnotationInfo();
    p._startNewParse(text, 0, text.length, opts, sink);
    const m = ModuleNode.create({ start: 0, length: text.length });
    p._ownerKey = m.a;
    p._createdOwnerKey = true;
    return p;
}

// 'x[0]' — consume name + bracket, then drill into the expression chain.
const p: any = mkParser('x[0]');
try {
    const atom = p._parseAtom();
    console.log('atom ok:', atom.nodeType);
    p._consumeTokenIfType(TokenType.OpenBracket);
    console.log('bracket consumed; next token type:', p._peekTokenType());
    for (const [name, call] of [
        ['_parseAtom', () => p._parseAtom()],
    ] as const) {
        try {
            const r = call();
            console.log(name, '->', r ? r.nodeType : 'null');
        } catch (e) { console.log(name, 'THREW:', (e as Error).message); break; }
    }
} catch (e) { console.log('outer THREW:', (e as Error).message); }

// Fresh parser, then call the chain functions directly one by one.
for (const fn of ['_parseTestExpression', '_parseExpression', '_parseBinaryOperation', '_parseComparison', '_parseBitwiseOrExpression', '_parseAtomExpression']) {
    const q: any = mkParser('0');
    try {
        const r = q[fn](false);
        console.log(fn, '->', r ? r.nodeType : 'null');
    } catch (e) {
        console.log(fn, 'THREW:', (e as Error).message);
    }
}
