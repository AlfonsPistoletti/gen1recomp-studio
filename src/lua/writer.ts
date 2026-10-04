// Writes the studio's generated mod file: plain registry calls with Lua table
// literals laid out the way the repo's own data files are, so the output is
// reviewable in a diff.

import { isDelete, isPlainObject } from "../core/merge.ts";

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const LUA_KEYWORDS = new Set([
  "and", "break", "do", "else", "elseif", "end", "false", "for", "function", "goto", "if",
  "in", "local", "nil", "not", "or", "repeat", "return", "then", "true", "until", "while",
]);

// Map fields first in the order a reader expects, the rest alphabetically.
const MAP_FIELD_ORDER = [
  "id", "label", "index", "tileset", "width", "height", "borderBlock", "palette",
  "blocks", "connections", "warps", "objects", "signs",
];
const ENTITY_FIELD_ORDER = ["index", "name", "x", "y", "sprite", "movement", "range", "text", "destMap", "destWarp"];

function luaString(s: string): string {
  return (
    '"' +
    s.replace(/[\\"\n\r\t\x00-\x1f]/g, (c) => {
      switch (c) {
        case "\\": return "\\\\";
        case '"': return '\\"';
        case "\n": return "\\n";
        case "\r": return "\\r";
        case "\t": return "\\t";
        default: return "\\" + c.charCodeAt(0).toString().padStart(3, "0");
      }
    }) +
    '"'
  );
}

function luaKey(key: string): string {
  if (IDENT.test(key) && !LUA_KEYWORDS.has(key)) return key;
  if (/^-?\d+$/.test(key)) return `[${key}]`;
  return `[${luaString(key)}]`;
}

function orderedKeys(obj: Record<string, unknown>, order: string[]): string[] {
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
  return keys.sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 1e9 : ia) - (ib === -1 ? 1e9 : ib);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function isScalar(v: unknown): boolean {
  return v === null || ["string", "number", "boolean"].includes(typeof v);
}

function scalar(v: unknown): string {
  if (v === null || v === undefined) return "nil";
  if (typeof v === "string") return luaString(v);
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "0";
  return String(v);
}

interface Ctx {
  order: string[];
  rowWidth?: number;
}

// A value that is another record of the same game, read when the mod loads
// (`mod.content.<registry>:get(id)`), so no data is copied into the mod.
export const REF_KEY = "__ref";
// what a reference falls back to when the game has no such record
const REF_FALLBACK: Record<string, string> = { battle_anims: "{ seq = {} }" };

// (an `id` next to it is tolerated: merges stamp record ids)
export function isRef(value: unknown): value is { __ref: string } {
  return isPlainObject(value) && typeof value[REF_KEY] === "string" && Object.keys(value).every((k) => k === REF_KEY || k === "id");
}

function refCall(ref: string): string {
  const [registry, ...rest] = ref.split(":");
  const call = `mod.content.${registry}:get(${luaString(rest.join(":"))})`;
  return REF_FALLBACK[registry] ? `${call} or ${REF_FALLBACK[registry]}` : call;
}

export function luaValue(value: unknown, indent: string, ctx: Ctx = { order: MAP_FIELD_ORDER }): string {
  if (isDelete(value)) return "mod.DELETE";
  if (isRef(value)) return refCall(value.__ref);
  if (isScalar(value)) return scalar(value);
  const inner = indent + "  ";
  if (Array.isArray(value)) {
    if (value.length === 0) return "{}";
    if (value.every(isScalar)) {
      const parts = value.map(scalar);
      const perRow = ctx.rowWidth && ctx.rowWidth > 0 ? ctx.rowWidth : 20;
      const oneLine = `{ ${parts.join(", ")} }`;
      if (oneLine.length + indent.length <= 100) return oneLine;
      const rows: string[] = [];
      for (let i = 0; i < parts.length; i += perRow) rows.push(inner + parts.slice(i, i + perRow).join(", ") + ",");
      return `{\n${rows.join("\n")}\n${indent}}`;
    }
    const items = value.map((v) => inner + luaValue(v, inner, { order: ENTITY_FIELD_ORDER }) + ",");
    return `{\n${items.join("\n")}\n${indent}}`;
  }
  if (isPlainObject(value)) {
    const keys = orderedKeys(value, ctx.order);
    if (keys.length === 0) return "{}";
    const flat = keys.every((k) => isScalar(value[k]) || isDelete(value[k]));
    if (flat) {
      const oneLine = `{ ${keys.map((k) => `${luaKey(k)} = ${luaValue(value[k], inner)}`).join(", ")} }`;
      if (oneLine.length + indent.length <= 100) return oneLine;
    }
    const width = typeof value.width === "number" ? value.width : ctx.rowWidth;
    const lines = keys.map((k) => {
      const sub: Ctx = { order: ENTITY_FIELD_ORDER, rowWidth: k === "blocks" ? width : undefined };
      return `${inner}${luaKey(k)} = ${luaValue(value[k], inner, sub)},`;
    });
    return `{\n${lines.join("\n")}\n${indent}}`;
  }
  return "nil";
}

export interface ContentCall {
  registry: string;
  op: "register" | "patch" | "override" | "remove";
  id: string;
  // a record, or a plain value for registries like text (null for remove)
  value: unknown;
  // the map's width, so a blocks list wraps one map row per line
  rowWidth?: number;
}

// `orders` gives the top-level key order per registry (maps have their own);
// `before` is generated code placed ahead of the registry calls (the custom
// move-effect helper and its registration loop).
export function studioContentFile(modId: string, calls: ContentCall[], orders: Record<string, string[]> = {}, before = ""): string {
  const body = calls
    .map((c) => {
      if (c.op === "remove") return `  mod.content.${c.registry}:remove(${luaString(c.id)})`;
      const order = c.registry === "maps" ? MAP_FIELD_ORDER : orders[c.registry] ?? [];
      const value = luaValue(c.value, "  ", { order, rowWidth: c.rowWidth });
      return `  mod.content.${c.registry}:${c.op}(${luaString(c.id)}, ${value})`;
    })
    .join("\n\n");
  return [
    `-- ${modId}: generated by gen1recomp-studio. Do not hand-edit this file;`,
    "-- reopen the mod in the studio and save again. Hand-written content",
    "-- belongs in main.lua, which loads this file.",
    "return function(mod)",
    ...(before ? [before.replace(/\n+$/, ""), ""] : []),
    body,
    "end",
    "",
  ].join("\n");
}

export function requireLine(modId: string): string {
  return `require("mods.${modId}.studio_content")(mod)`;
}

// A plain data file of records (studio_effects.lua): `return { id = {...} }`.
export function dataFile(modId: string, what: string, records: Record<string, unknown>, order: string[] = []): string {
  const ids = Object.keys(records).sort();
  const body = ids.map((id) => `  ${luaKey(id)} = ${luaValue(records[id], "  ", { order })},`).join("\n");
  return [
    `-- ${modId}: ${what}, written by gen1recomp-studio. Plain data;`,
    "-- edit it in the studio (studio_content.lua turns it into game records).",
    "return {",
    body,
    "}",
    "",
  ].join("\n");
}
