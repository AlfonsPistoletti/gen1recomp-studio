// Mirrors src/mods/Registry.lua + src/mods/Merge.lua for "record" registries
// (maps, tilesets): register/override replace, patch deep-merges where lists
// replace wholesale and nested objects merge key by key, mod.DELETE unsets.

import type { RegistryOp } from "./types.ts";

// mod.DELETE travels through JSON as this marker.
export const DELETE_KEY = "__delete";

export function isDelete(value: unknown): boolean {
  return isPlainObject(value) && (value as Record<string, unknown>)[DELETE_KEY] === true;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function deepMerge(dst: unknown, src: unknown): unknown {
  if (isDelete(src)) return undefined;
  if (!isPlainObject(src)) return clone(src);
  if (!isPlainObject(dst)) return stripDeletes(clone(src));
  const out: Record<string, unknown> = { ...dst };
  for (const [key, value] of Object.entries(src)) {
    if (isDelete(value)) {
      delete out[key];
    } else if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = stripDeletes(clone(value));
    }
  }
  return out;
}

function stripDeletes(value: unknown): unknown {
  if (!isPlainObject(value)) return value;
  for (const [key, inner] of Object.entries(value)) {
    if (isDelete(inner)) delete value[key];
    else stripDeletes(inner);
  }
  return value;
}

export function applyOps<T>(table: Record<string, T>, ops: RegistryOp[], registry: string): void {
  for (const op of ops) {
    if (op.registry !== registry || typeof op.id !== "string") continue;
    let next: unknown;
    if (op.op === "remove" || isDelete(op.value)) next = undefined;
    else if (op.op === "patch") next = deepMerge(table[op.id] ?? {}, op.value);
    else next = stripDeletes(clone(op.value));
    if (next === undefined) delete table[op.id];
    else {
      const record = next as Record<string, unknown>;
      // a reference to another record ({ __ref }) stays exactly that
      if (isPlainObject(record) && record.id === undefined && !("__ref" in record)) record.id = op.id;
      table[op.id] = record as T;
    }
  }
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (!deepEqual(a[k], b[k])) return false;
    return true;
  }
  // an empty Lua table arrives as [] even where the field is a map
  if (isEmpty(a) && isEmpty(b)) return true;
  return false;
}

function isEmpty(v: unknown): boolean {
  return (Array.isArray(v) && v.length === 0) || (isPlainObject(v) && Object.keys(v).length === 0);
}

// The smallest patch that turns `base` into `next` under deepMerge: lists and
// scalars replace, objects recurse, vanished keys become DELETE markers.
// Returns undefined when nothing changed.
export function diffRecord(base: unknown, next: unknown): unknown {
  if (deepEqual(base, next)) return undefined;
  if (!isPlainObject(base) || !isPlainObject(next)) return clone(next);
  const out: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(base), ...Object.keys(next)]);
  for (const key of keys) {
    const b = base[key];
    const n = next[key];
    if (n === undefined) {
      if (b !== undefined) out[key] = { [DELETE_KEY]: true };
      continue;
    }
    const d = isPlainObject(b) && isPlainObject(n) ? diffRecord(b, n) : deepEqual(b, n) ? undefined : clone(n);
    if (d !== undefined) out[key] = d;
  }
  return Object.keys(out).length ? out : undefined;
}
