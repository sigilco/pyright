/*
 * factsReport.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Tests for the --facts structural type report.
 */

import assert from 'assert';

import { FACTS_SCHEMA, FACTS_SCHEMA_VERSION, FactsFileReport, generateFactsForFile } from '../analyzer/factsReport';
import { Program } from '../analyzer/program';
import { Uri } from '../common/uri/uri';
import * as TestUtils from './testUtils';

function analyzeFacts(fileName: string): FactsFileReport {
    let report: FactsFileReport | undefined;
    const observer: TestUtils.SampleAnalysisObserver = {
        onComplete: (program: Program, fileUris: Uri[]) => {
            report = generateFactsForFile(program, fileUris[0]);
        },
    };
    TestUtils.typeAnalyzeSampleFiles([fileName], undefined, undefined, observer);
    assert(report, 'generateFactsForFile returned undefined');
    return report;
}

test('facts schema constants', () => {
    assert.strictEqual(FACTS_SCHEMA, 'pyright-facts');
    assert.strictEqual(FACTS_SCHEMA_VERSION, 1);
});

test('facts: typed function signature', () => {
    const report = analyzeFacts('facts1.py');
    const area = report.callables['facts1.area'];
    assert(area, 'expected facts1.area in callables');

    const [w, h] = area.params;
    assert.strictEqual(w.name, 'w');
    assert.strictEqual(w.category, 'simple');
    assert.strictEqual(w.type?.kind, 'class');
    assert.strictEqual(w.type?.fullName, 'builtins.int');
    assert.strictEqual(h.type?.fullName, 'builtins.int');
    assert.strictEqual(area.returnType?.fullName, 'builtins.int');
});

test('facts: overloads are split into per-signature entries', () => {
    const report = analyzeFacts('facts1.py');
    const pick = report.overloads['facts1.pick'];
    assert(pick, 'expected facts1.pick in overloads');
    assert(pick.length >= 2, `expected at least 2 overloads, got ${pick.length}`);
    assert.strictEqual(pick[0].returnType?.fullName, 'builtins.int');
    assert.strictEqual(pick[1].returnType?.fullName, 'builtins.str');
});

test('facts: class fields are structurally typed', () => {
    const report = analyzeFacts('facts1.py');
    const point = report.classes['facts1.Point'];
    assert(point, 'expected facts1.Point in classes');

    const fieldTypes = new Map(point.fields.map((f) => [f.name, f.type?.fullName]));
    assert.strictEqual(fieldTypes.get('x'), 'builtins.int');
    assert.strictEqual(fieldTypes.get('y'), 'builtins.int');
});

test('facts: expressions carry structural types and positions', () => {
    const report = analyzeFacts('facts1.py');
    assert(report.expressions.length > 0, 'expected expression facts');
    for (const expr of report.expressions) {
        assert(expr.end > expr.start, 'end must follow start');
        assert(expr.line >= 0 && expr.col >= 0, 'position must be zero-based non-negative');
        assert(expr.type && typeof expr.type.kind === 'string', 'type must have a kind');
    }

    const intFact = report.expressions.find((e) => e.type.kind === 'class' && e.type.fullName === 'builtins.int');
    assert(intFact, 'expected at least one int-typed expression');
});

test('facts: separator params and literal defaults', () => {
    const report = analyzeFacts('facts1.py');
    const kitchen = report.callables['facts1.kitchen'];
    assert(kitchen, 'expected facts1.kitchen in callables');

    // The positional-only '/' marker serializes as an unnamed simple param.
    assert.strictEqual(kitchen.params[1].name, undefined);
    assert.strictEqual(kitchen.params[1].category, 'simple');

    const d = kitchen.params.find((p) => p.name === 'd');
    assert(d?.hasDefault, 'expected d to have a default');
    assert.strictEqual(d?.defaultType?.literalValue, 2);

    const kwargs = kitchen.params.find((p) => p.name === 'kwargs');
    assert.strictEqual(kwargs?.category, 'kwargs');
});
