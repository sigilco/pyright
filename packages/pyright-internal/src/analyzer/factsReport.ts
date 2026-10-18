/*
 * factsReport.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Emits a machine-readable "facts" document for a checked file: the
 * evaluator's resolved type for every expression node, plus structured
 * signatures for every function and class it defines. Unlike hover or
 * the verifytypes report, types are serialized structurally (category +
 * names + type args) so a consumer never has to re-parse printed type
 * strings.
 */

import { convertOffsetToPosition } from '../common/positionUtils';
import { TextRange } from '../common/textRange';
import { TextRangeCollection } from '../common/textRangeCollection';
import { Uri } from '../common/uri/uri';
import {
    ClassNode,
    ExpressionNode,
    FunctionNode,
    ParamCategory,
    ParseNode,
    isExpressionNode,
} from '../parser/parseNodes';
import { ParseTreeWalker } from './parseTreeWalker';
import { Program } from './program';
import { TypeEvaluator } from './typeEvaluatorTypes';
import { ClassType, FunctionType, OverloadedType, Type, TypeCategory, isInstantiableClass } from './types';

export const FACTS_SCHEMA = 'pyright-facts';
export const FACTS_SCHEMA_VERSION = 1;

export interface FactsType {
    kind: string;
    name?: string;
    fullName?: string;
    moduleName?: string;
    typeArgs?: FactsType[];
    tupleArgs?: FactsType[];
    literalValue?: string | number | boolean | undefined;
    options?: FactsType[];
    overloads?: FactsSignature[];
    signature?: FactsSignature;
    boundTypeVarScopeId?: string;
    printed?: string;
    incomplete?: boolean;
}

export interface FactsParam {
    name?: string;
    category: 'simple' | 'args' | 'kwargs';
    type?: FactsType;
    defaultType?: FactsType;
    hasDefault: boolean;
}

export interface FactsSignature {
    fullName?: string;
    params: FactsParam[];
    returnType?: FactsType;
}

export interface FactsExpression {
    start: number;
    end: number;
    line: number;
    col: number;
    type: FactsType;
}

export interface FactsClass {
    fullName: string;
    fields: { name: string; type?: FactsType }[];
}

export interface FactsFileReport {
    file: string;
    expressions: FactsExpression[];
    callables: { [name: string]: FactsSignature };
    overloads: { [name: string]: FactsSignature[] };
    classes: { [name: string]: FactsClass };
}

function serializeParamCategory(category: ParamCategory): 'simple' | 'args' | 'kwargs' {
    switch (category) {
        case ParamCategory.ArgsList:
            return 'args';
        case ParamCategory.KwargsDict:
            return 'kwargs';
        default:
            return 'simple';
    }
}

class FactsSerializer {
    constructor(private _evaluator: TypeEvaluator, private _maxDepth = 12) {}

    serialize(type: Type | undefined, depth = 0): FactsType {
        if (type === undefined) {
            return { kind: 'unbound' };
        }
        if (depth > this._maxDepth) {
            return { kind: 'other', printed: this._printed(type) };
        }

        const incomplete = (type.priv as { isIncomplete?: boolean } | undefined)?.isIncomplete;
        const base = incomplete ? { incomplete: true } : {};

        switch (type.category) {
            case TypeCategory.Unbound:
                return { ...base, kind: 'unbound' };
            case TypeCategory.Unknown:
                return { ...base, kind: 'unknown' };
            case TypeCategory.Any:
                return { ...base, kind: 'any' };
            case TypeCategory.Never:
                return { ...base, kind: 'never' };
            case TypeCategory.Module:
                return { ...base, kind: 'module', name: type.priv.moduleName };
            case TypeCategory.TypeVar:
                return {
                    ...base,
                    kind: 'typevar',
                    name: type.shared.name,
                    boundTypeVarScopeId: type.priv.scopeId as string | undefined,
                };
            case TypeCategory.Union:
                return {
                    ...base,
                    kind: 'union',
                    options: type.priv.subtypes.map((t) => this.serialize(t, depth + 1)),
                };
            case TypeCategory.Function:
                return { ...base, kind: 'callable', signature: this.signature(type) };
            case TypeCategory.Overloaded:
                return {
                    ...base,
                    kind: 'overloaded',
                    overloads: type.priv._overloads.map((f) => this.signature(f, depth + 1)),
                };
            case TypeCategory.Class: {
                const out: FactsType = {
                    ...base,
                    kind: isInstantiableClass(type) ? 'type' : 'class',
                    name: type.shared.name,
                    fullName: type.shared.fullName,
                    moduleName: type.shared.moduleName,
                };
                if (type.priv.literalValue !== undefined) {
                    out.literalValue = type.priv.literalValue as string | number | boolean;
                }
                if (type.priv.tupleTypeArgs) {
                    out.tupleArgs = type.priv.tupleTypeArgs.map((t) => this.serialize(t.type, depth + 1));
                } else if (type.priv.typeArgs) {
                    out.typeArgs = type.priv.typeArgs.map((t) => this.serialize(t, depth + 1));
                }
                return out;
            }
            default:
                return { ...base, kind: 'other', printed: this._printed(type) };
        }
    }

    signature(functionType: FunctionType, depth = 0): FactsSignature {
        const params = functionType.shared.parameters.map((param, i) => {
            let paramType: Type | undefined;
            try {
                paramType = FunctionType.getParamType(functionType, i);
            } catch {
                paramType = param._type;
            }
            return {
                name: param.name,
                category: serializeParamCategory(param.category),
                type: paramType ? this.serialize(paramType, depth + 1) : undefined,
                defaultType: param._defaultType ? this.serialize(param._defaultType, depth + 1) : undefined,
                hasDefault: param._defaultType !== undefined || param.defaultExpr !== undefined,
            };
        });
        const returnType =
            functionType.priv.specializedTypes?.returnType ??
            functionType.shared.declaredReturnType ??
            functionType.shared.inferredReturnType?.type;
        return {
            fullName: functionType.shared.fullName,
            params,
            returnType: returnType ? this.serialize(returnType, depth + 1) : undefined,
        };
    }

    private _printed(type: Type): string {
        try {
            return this._evaluator.printType(type) as string;
        } catch {
            return '<unprintable>';
        }
    }
}

class FactsWalker extends ParseTreeWalker {
    readonly expressions: FactsExpression[] = [];
    readonly callables: { [name: string]: FactsSignature } = {};
    readonly overloads: { [name: string]: FactsSignature[] } = {};
    readonly classes: { [name: string]: FactsClass } = {};

    private _seenExprStarts = new Set<number>();

    constructor(
        private _evaluator: TypeEvaluator,
        private _serializer: FactsSerializer,
        private _lines: TextRangeCollection<TextRange>
    ) {
        super();
    }

    override visit(node: ParseNode): boolean {
        if (isExpressionNode(node)) {
            this._recordExpression(node);
        }
        return super.visit(node);
    }

    override visitFunction(node: FunctionNode): boolean {
        const result = this._evaluator.getTypeOfFunction(node);
        if (result) {
            const type = result.decoratedType ?? result.functionType;
            if (type.category === TypeCategory.Overloaded) {
                const name = type.priv._overloads[0]?.shared.fullName ?? node.d.name?.d.value;
                if (name) {
                    this.overloads[name] = type.priv._overloads.map((f) => this._serializer.signature(f));
                }
            } else if (type.category === TypeCategory.Function) {
                const name = type.shared.fullName ?? node.d.name?.d.value;
                if (name) {
                    this.callables[name] = this._serializer.signature(type);
                }
            }
        }
        return true;
    }

    override visitClass(node: ClassNode): boolean {
        const result = this._evaluator.getTypeOfClass(node);
        if (result) {
            const classType = result.classType as ClassType;
            const fields: FactsClass['fields'] = [];
            classType.shared.fields.forEach((symbol, name) => {
                let fieldType: Type | undefined;
                try {
                    fieldType = this._evaluator.getEffectiveTypeOfSymbol(symbol);
                } catch {
                    fieldType = undefined;
                }
                fields.push({ name, type: this._serializer.serialize(fieldType) });
            });
            this.classes[classType.shared.fullName] = { fullName: classType.shared.fullName, fields };
        }
        return true;
    }

    private _recordExpression(node: ExpressionNode) {
        if (this._seenExprStarts.has(node.start)) {
            return;
        }
        let type: Type | undefined;
        try {
            type = this._evaluator.getTypeResult(node)?.type ?? this._evaluator.getType(node);
        } catch {
            type = undefined;
        }
        if (type === undefined) {
            return;
        }
        this._seenExprStarts.add(node.start);
        const pos = convertOffsetToPosition(node.start, this._lines);
        this.expressions.push({
            start: node.start,
            end: node.start + node.length,
            line: pos.line,
            col: pos.character,
            type: this._serializer.serialize(type),
        });
    }
}

export function generateFactsForFile(program: Program, fileUri: Uri): FactsFileReport | undefined {
    const parseResults = program.getParseResults(fileUri);
    const evaluator = program.evaluator;
    if (!parseResults || !evaluator) {
        return undefined;
    }

    const lines = parseResults.tokenizerOutput.lines;
    const serializer = new FactsSerializer(evaluator);
    const walker = new FactsWalker(evaluator, serializer, lines);
    walker.walk(parseResults.parserOutput.parseTree);

    return {
        file: fileUri.getFilePath(),
        expressions: walker.expressions,
        callables: walker.callables,
        overloads: walker.overloads,
        classes: walker.classes,
    };
}
