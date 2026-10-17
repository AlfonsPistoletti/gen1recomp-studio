// Studio extensions: a mod ships `studio_extensions.json` (next to its
// manifest) describing its own entity kinds and script commands; the Lua that
// makes them work lives in that mod's normal Lua files. The studio reads the
// edited mod's file, offers the kinds on the map and the commands in events,
// and saves plain data:
//   placed kind  -> a map object { ..., custom = { kind = "<mod>:<id>", <fields> } }
//   painted kind -> the map's customCells["<mod>:<id>"] = { { x, y, <fields> }, ... }
//   command      -> an event row { verb, <params in order> }
// The engine keeps unknown object fields and map keys (gen1recomp Schemas
// f.partial / map fields), and a mod registers its own verbs with
// mod.commands:register.

import type { Host } from "../host/types.ts";

export const EXTENSIONS_FILE = "studio_extensions.json";

export const FIELD_TYPES = ["text", "int", "bool", "select", "species", "item", "move", "map", "sprite", "flag"] as const;
export type ExtFieldType = (typeof FIELD_TYPES)[number];

export interface ExtField {
  key: string;
  label: string;
  type: ExtFieldType;
  options?: string[]; // select
  min?: number; // int
  max?: number;
  default?: unknown;
  hint?: string;
}

export interface ExtKind {
  id: string; // "<mod>:<id>"
  label: string;
  color: string;
  icon?: string; // a Lucide icon name ("sparkles")
  place: "object" | "cells";
  sprite?: string; // placed kinds: the object's sprite (the engine needs one)
  visible: boolean; // placed kinds: shown in the game (else hidden = true)
  fields: ExtField[];
  hint?: string;
  from: string; // the mod that defines it
}

export interface ExtCommand {
  verb: string;
  label: string;
  help?: string;
  params: ExtField[];
  from: string;
}

export interface Extensions {
  kinds: ExtKind[];
  commands: ExtCommand[];
}

export const NO_EXTENSIONS: Extensions = { kinds: [], commands: [] };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
// x/y are the cell, kind is the custom record's own tag
const RESERVED = new Set(["x", "y", "kind"]);

function parseField(raw: unknown, where: string, warn: (m: string) => void): ExtField | null {
  if (!isObj(raw)) return warn(`${where}: a field must be an object`), null;
  const key = str(raw.key);
  if (!key || !KEY.test(key)) return warn(`${where}: field key "${String(raw.key)}" must be a plain name (letters, digits, _)`), null;
  if (RESERVED.has(key)) return warn(`${where}: field key "${key}" is reserved`), null;
  const type = (str(raw.type) ?? "text") as ExtFieldType;
  if (!FIELD_TYPES.includes(type)) return warn(`${where}: field "${key}" has unknown type "${type}" (${FIELD_TYPES.join(", ")})`), null;
  const options = Array.isArray(raw.options) ? raw.options.filter((o): o is string => typeof o === "string") : undefined;
  if (type === "select" && !options?.length) return warn(`${where}: select field "${key}" needs options`), null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  return { key, label: str(raw.label) ?? key, type, options, min: num(raw.min), max: num(raw.max), default: raw.default, hint: str(raw.hint) };
}

function parseFields(raw: unknown, where: string, warn: (m: string) => void): ExtField[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return warn(`${where}: fields must be a list`), [];
  const seen = new Set<string>();
  const out: ExtField[] = [];
  raw.forEach((f, i) => {
    const field = parseField(f, `${where} field ${i + 1}`, warn);
    if (!field) return;
    if (seen.has(field.key)) return warn(`${where}: field "${field.key}" appears twice`);
    seen.add(field.key);
    out.push(field);
  });
  return out;
}

// One mod's file; problems become warnings and skip the entry, never throw.
export function parseExtensions(text: string, modId: string, warn: (m: string) => void): Extensions {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    warn(`${modId}/${EXTENSIONS_FILE}: not valid JSON (${err instanceof Error ? err.message : String(err)})`);
    return { kinds: [], commands: [] };
  }
  if (!isObj(json)) return warn(`${modId}/${EXTENSIONS_FILE}: must be a JSON object`), { kinds: [], commands: [] };
  const where = (what: string) => `${modId}/${EXTENSIONS_FILE} ${what}`;
  const kinds: ExtKind[] = [];
  for (const [i, raw] of (Array.isArray(json.kinds) ? json.kinds : []).entries()) {
    const w = where(`kind ${i + 1}`);
    if (!isObj(raw)) { warn(`${w}: must be an object`); continue; }
    const id = str(raw.id);
    if (!id || !KEY.test(id)) { warn(`${w}: id "${String(raw.id)}" must be a plain name (letters, digits, _)`); continue; }
    const place = raw.place === "cells" ? "cells" : "object";
    const color = str(raw.color) ?? "#e8a33d";
    kinds.push({
      id: `${modId}:${id}`,
      label: str(raw.label) ?? id,
      color: /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : "#e8a33d",
      icon: str(raw.icon),
      place,
      sprite: str(raw.sprite),
      visible: raw.visible === true,
      fields: parseFields(raw.fields, w, warn),
      hint: str(raw.hint),
      from: modId,
    });
  }
  const commands: ExtCommand[] = [];
  for (const [i, raw] of (Array.isArray(json.commands) ? json.commands : []).entries()) {
    const w = where(`command ${i + 1}`);
    if (!isObj(raw)) { warn(`${w}: must be an object`); continue; }
    const verb = str(raw.verb);
    if (!verb) { warn(`${w}: needs a verb (the name the mod registers with mod.commands:register)`); continue; }
    commands.push({ verb, label: str(raw.label) ?? verb, help: str(raw.help), params: parseFields(raw.params, w, warn), from: modId });
  }
  return { kinds, commands };
}

// The edited mod's own file (shortcut: dependencies' files aren't read, see
// ROADMAP "library mods"); a repeated kind id or verb keeps the first one.
export async function loadExtensions(host: Host, modId: string, warn: (m: string) => void): Promise<Extensions> {
  const out: Extensions = { kinds: [], commands: [] };
  const text = await host.readText("game", `mods/${modId}/${EXTENSIONS_FILE}`).catch(() => null);
  if (text === null) return out;
  const ext = parseExtensions(text, modId, warn);
  for (const k of ext.kinds) {
    if (out.kinds.some((o) => o.id === k.id)) warn(`${k.id} is defined twice; the first one is used`);
    else out.kinds.push(k);
  }
  for (const c of ext.commands) {
    if (out.commands.some((o) => o.verb === c.verb)) warn(`command ${c.verb} is defined twice; the first one is used`);
    else out.commands.push(c);
  }
  return out;
}

// A field's starting value: its default, else an empty value of its type.
export function fieldDefault(f: ExtField): unknown {
  if (f.default !== undefined) return f.default;
  if (f.type === "int") return f.min ?? 0;
  if (f.type === "bool") return false;
  if (f.type === "select") return f.options?.[0] ?? "";
  return "";
}
