/*
 * uriMap.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Map specifically made to support a URI as a key.
 */

import { Uri } from './uri';

// scriptc: `implements Map` would force symbol-keyed members
// ([Symbol.toStringTag]/[Symbol.dispose]) which have no lowering.
export class UriMap<T> {
    private _keys = new Map<string, Uri>();
    private _values = new Map<string, T>();

    get size(): number {
        return this._values.size;
    }
    clear(): void {
        this._keys.clear();
        this._values.clear();
    }
    forEach(callbackfn: (value: T, key: Uri, map: Map<Uri, T>) => void, thisArg?: any): void {
        this._keys.forEach((v, k) => {
            callbackfn(this._values.get(k)!, v, this as unknown as Map<Uri, T>);
        });
    }
    values(): MapIterator<T> {
        return this._values.values();
    }
    [Symbol.iterator](): MapIterator<[Uri, T]> {
        return this.entries();
    }
    get(key: Uri | undefined): T | undefined {
        return key ? this._values.get(key.key) : undefined;
    }

    set(key: Uri | undefined, value: T): this {
        if (key) {
            this._keys.set(key.key, key);
            this._values.set(key.key, value);
        }
        return this;
    }

    has(key: Uri): boolean {
        return this._values.has(key.key);
    }

    delete(key: Uri): boolean {
        this._keys.delete(key.key);
        return this._values.delete(key.key);
    }

    entries(): MapIterator<[Uri, T]> {
        const keys = this._keys.entries();
        const values = this._values.entries();

        return new UriMapIterator<Uri, T>(keys, values) as unknown as MapIterator<[Uri, T]>;
    }

    keys(): MapIterator<Uri> {
        return this._keys.values();
    }
}

class UriMapIterator<K extends Uri, V> {
    constructor(
        private _keys: MapIterator<[string, K]>,
        private _values: MapIterator<[string, V]>
    ) {}

    [Symbol.iterator](): MapIterator<[K, V]> {
        return this as unknown as MapIterator<[K, V]>;
    }

    next(...args: [] | [undefined]): IteratorResult<[K, V], any> {
        const key = this._keys.next(...args);
        const value = this._values.next(...args);
        if (key.done || value.done) {
            return { done: true, value: undefined };
        }
        return { done: false, value: [key.value[1], value.value[1]] };
    }
}
