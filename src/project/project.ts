// "One ROM version's dataset + one mod being edited", on top of a Host and
// a game adapter.
//
// Base   = the imported dataset + everything the mod's main.lua registers,
//          except the studio's own generated file.
// Studio = base + mods/<id>/studio_content.lua.
// Saving diffs the editor's records against Base and rewrites only
// studio_content.lua, so hand-written mod code is never touched.

import { applyOps, clone, deepEqual, diffDeep, diffRecord, isPlainObject, OVERRIDE } from "../core/merge.ts";
import { MOD_MAP_INDEX_BASE, type MapDef, type ModInfo, type RegistryOp, type SaveResult } from "../core/types.ts";
import type { Dataset, GameAdapter } from "../games/types.ts";
import type { Host, ProcessResult } from "../host/types.ts";
import { loadLuaData, runMod } from "../lua/vm.ts";
import { EFFECT_RUNTIME, effectRegistration } from "../lua/effectRuntime.ts";
import { ITEM_EFFECT_RUNTIME, itemEffectRegistration } from "../lua/itemEffectRuntime.ts";
import { PRIZE_RUNTIME, prizeRegistration } from "../lua/prizeRuntime.ts";
import { EVENT_RUNTIME, eventRegistration } from "../lua/eventRuntime.ts";
import { TILESET_RUNTIME, tilesetRegistration } from "../lua/tilesetRuntime.ts";
import { dataFile, requireLine, studioContentFile, type ContentCall } from "../lua/writer.ts";

export const MOD_ID_RE = /^[\w-]+$/;

export interface Project {
  host: Host;
  version: string;
  adapter: GameAdapter;
  mod: string | null;
  // base data: dataset + the mod's hand-written registrations
  data: Dataset;
  // what studio_content.lua makes of each record it touches, per registry
  // (null = removed)
  studio: Record<string, Record<string, unknown>>;
  tilesetImages: Record<string, string>;
  spriteImages: Record<string, string>;
  warnings: string[];
  // the manifest's assets_transforms file, if the mod has one
  transforms: string | null;
}

// ------------------------------------------------------------------ dataset

const datasets = new Map<string, Promise<Dataset>>();

function loadDataset(host: Host, version: string, adapter: GameAdapter): Promise<Dataset> {
  let p = datasets.get(version);
  if (!p) {
    p = adapter.load(async (file) => {
      const text = await host.readText(`cache:${version}`, `data/generated/${file}`);
      if (text === null) throw new Error(`${version}: data/generated/${file} is missing`);
      return loadLuaData(text, file);
    }, version);
    p.catch(() => datasets.delete(version));
    datasets.set(version, p);
  }
  return p;
}

// ------------------------------------------------------------------ mods

function studioModule(modId: string): string {
  return `mods.${modId}.studio_content`;
}

function checkId(modId: string): string {
  if (!MOD_ID_RE.test(modId)) throw new Error(`bad mod id ${modId}`);
  return modId;
}

interface Manifest {
  name?: string;
  entry?: string;
  games?: string[];
  assets_transforms?: string;
}

async function readManifest(host: Host, modId: string): Promise<Manifest | null> {
  const text = await host.readText("game", `mods/${modId}/manifest.json`);
  if (text === null) return null;
  try {
    return JSON.parse(text) as Manifest;
  } catch {
    return null;
  }
}

function entryPath(modId: string, manifest: Manifest | null): string {
  return `mods/${modId}/${manifest?.entry || "main.lua"}`;
}

async function isWiredUp(host: Host, modId: string, manifest: Manifest | null): Promise<boolean> {
  const src = await host.readText("game", entryPath(modId, manifest));
  return !!src && src.includes(studioModule(modId));
}

export async function listMods(host: Host): Promise<ModInfo[]> {
  const entries = (await host.list("game", "mods")).filter((e) => e.dir && MOD_ID_RE.test(e.name));
  const mods = await Promise.all(
    entries.map(async ({ name }) => {
      const manifest = await readManifest(host, name);
      if (!manifest) return null;
      const [studio, wiredUp] = await Promise.all([
        host.readText("game", `mods/${name}/studio_content.lua`),
        isWiredUp(host, name, manifest),
      ]);
      return {
        id: name,
        name: manifest.name || name,
        games: Array.isArray(manifest.games) ? manifest.games : [],
        hasStudioContent: studio !== null,
        wiredUp,
      } satisfies ModInfo;
    }),
  );
  return mods.filter((m): m is ModInfo => m !== null).sort((a, b) => a.id.localeCompare(b.id));
}

// Every .lua file of a mod, so its require calls can be served synchronously.
async function modFiles(host: Host, modId: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 4) return;
    for (const e of await host.list("game", dir)) {
      const rel = `${dir}/${e.name}`;
      if (e.dir) {
        if (!e.name.startsWith(".")) await walk(rel, depth + 1);
      } else if (e.name.endsWith(".lua")) {
        const text = await host.readText("game", rel);
        if (text !== null) files.set(rel, text);
      }
    }
  };
  await walk(`mods/${modId}`, 0);
  return files;
}

// ------------------------------------------------------------------ layers

interface Layers {
  data: Dataset;
  studioOps: RegistryOp[];
  warnings: string[];
}

async function buildLayers(host: Host, version: string, adapter: GameAdapter, modId: string | null): Promise<Layers> {
  const base = await loadDataset(host, version, adapter);
  // content records are never mutated in place (merges build new objects,
  // the store edits copies), so a shallow copy per table is enough
  const content: Dataset["content"] = {};
  for (const [registry, table] of Object.entries(base.content)) content[registry] = { ...table };
  const data: Dataset = { maps: clone(base.maps), tilesets: clone(base.tilesets), sprites: clone(base.sprites), content, extra: base.extra };
  const warnings: string[] = [];
  let studioOps: RegistryOp[] = [];
  if (modId) {
    const manifest = await readManifest(host, checkId(modId));
    if (!manifest) throw new Error(`mods/${modId} has no readable manifest.json`);
    const files = await modFiles(host, modId);
    const main = await runMod(files, modId, entryPath(modId, manifest), studioModule(modId));
    warnings.push(...main.errors.map((e) => `main.lua: ${e}`));
    applyOps(data.maps, main.ops, "maps");
    applyOps(data.tilesets, main.ops, "tilesets");
    applyOps(data.sprites, main.ops, "sprites");
    for (const [registry, table] of Object.entries(data.content)) applyOps(table, main.ops, registry, isDeep(adapter, registry));
    const studioFile = `mods/${modId}/studio_content.lua`;
    if (files.has(studioFile)) {
      const studio = await runMod(files, modId, studioFile, null);
      warnings.push(...studio.errors.map((e) => `studio_content.lua: ${e}`));
      studioOps = studio.ops;
    }
  }
  for (const map of Object.values(data.maps)) adapter.normalizeMap(map);
  return { data, studioOps, warnings };
}

// whether the engine merges a registry "deep" (patched lists append)
export function isDeep(adapter: GameAdapter, registry: string): boolean {
  return !!adapter.content.find((c) => c.registry === registry)?.deep;
}

// Registries the studio edits (and so rewrites on save).
export function editableRegistries(adapter: GameAdapter): string[] {
  return ["maps", ...adapter.content.filter((c) => c.editable).map((c) => c.registry)];
}

export async function openProject(host: Host, version: string, adapter: GameAdapter, modId: string | null): Promise<Project> {
  const { data, studioOps, warnings } = await buildLayers(host, version, adapter, modId);
  const studio: Record<string, Record<string, unknown>> = {};
  if (studioOps.length) {
    // what the studio file says about records the studio cannot edit (a
    // sprite it registered earlier, ...) is part of the base
    applyOps(data.sprites, studioOps, "sprites");
    for (const c of adapter.content) if (!c.editable) applyOps(data.content[c.registry], studioOps, c.registry, !!c.deep);
    for (const registry of editableRegistries(adapter)) {
      const source = (registry === "maps" ? data.maps : data.content[registry]) as Record<string, unknown>;
      const working = { ...source };
      applyOps(working, studioOps, registry, isDeep(adapter, registry));
      for (const op of studioOps) {
        if (op.registry !== registry) continue;
        const value = working[op.id];
        (studio[registry] ??= {})[op.id] =
          value === undefined ? null : registry === "maps" ? adapter.normalizeMap(clone(value) as MapDef) : value;
      }
    }
  }
  const tilesetImages: Record<string, string> = {};
  for (const [id, ts] of Object.entries(data.tilesets)) tilesetImages[id] = ts.image ? host.imageUrl(version, ts.image) : "";
  const spriteImages: Record<string, string> = {};
  for (const [id, sp] of Object.entries(data.sprites)) spriteImages[id] = sp.image ? host.imageUrl(version, sp.image) : "";
  // records the studio keeps as plain data files in the mod (custom effects)
  if (modId) {
    for (const c of adapter.content) {
      if (!c.studioFile) continue;
      const text = await host.readText("game", `mods/${modId}/${c.studioFile}`);
      if (text === null) continue;
      try {
        const table = await loadLuaData<Record<string, unknown>>(text, c.studioFile);
        if (table && typeof table === "object" && !Array.isArray(table)) studio[c.registry] = { ...table };
      } catch (err) {
        warnings.push(`${c.studioFile}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  const manifest = modId ? await readManifest(host, modId) : null;
  const transforms = typeof manifest?.assets_transforms === "string" ? manifest.assets_transforms : null;
  return { host, version, adapter, mod: modId, data, studio, tilesetImages, spriteImages, warnings, transforms };
}

// ------------------------------------------------------------------ save

// The base tables of every editable registry.
function baseTables(adapter: GameAdapter, data: Dataset): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const registry of editableRegistries(adapter)) {
    out[registry] = (registry === "maps" ? data.maps : data.content[registry] ?? {}) as Record<string, unknown>;
  }
  return out;
}

export interface CallSummary {
  calls: ContentCall[];
  patched: string[];
  registered: string[];
}

// Turns edited records into registry calls against the base: patches with
// only what changed for base records, registrations for new ones, overrides
// for plain values (text strings), removals for records the editor dropped.
// `edited` maps registry -> id -> record (null = removed).
export function contentCalls(
  adapter: GameAdapter,
  base: Record<string, Record<string, unknown>>,
  edited: Record<string, Record<string, unknown>>,
): CallSummary {
  const out: CallSummary = { calls: [], patched: [], registered: [] };
  const replacing = new Set(adapter.content.filter((c) => c.replace).map((c) => c.registry));
  const deep = new Set(adapter.content.filter((c) => c.deep).map((c) => c.registry));
  // records kept in their own data file are not registry calls
  const dataFiles = new Set(adapter.content.filter((c) => c.studioFile).map((c) => c.registry));
  for (const registry of editableRegistries(adapter)) {
    if (dataFiles.has(registry)) continue;
    const ids = Object.keys(edited[registry] ?? {}).sort();
    for (const id of ids) {
      const value = edited[registry][id];
      if (registry === "maps") mapCall(adapter, base.maps ?? {}, id, value as MapDef | null, out);
      else recordCall(registry, (base[registry] ?? {})[id], id, value, out, !!replacing.has(registry), deep.has(registry));
    }
  }
  return out;
}

function mapCall(adapter: GameAdapter, base: Record<string, unknown>, id: string, value: MapDef | null, out: CallSummary): void {
  const old = base[id] as MapDef | undefined;
  if (value === null) {
    if (old) out.calls.push({ registry: "maps", op: "remove", id, value: null });
    return;
  }
  const next = adapter.normalizeMap(clone(value));
  next.id = id;
  if (!old) {
    if (typeof next.index !== "number" || next.index < MOD_MAP_INDEX_BASE) next.index = MOD_MAP_INDEX_BASE;
    // every list stays, empty or not: the engine indexes def.warps & co.
    // without a nil check (src/world/Warp.lua crashed on a map without warps)
    out.calls.push({ registry: "maps", op: "register", id, value: { ...next }, rowWidth: next.width });
    out.registered.push(id);
    return;
  }
  const diff = diffRecord(old, next) as Record<string, unknown> | undefined;
  if (!diff) return;
  // the engine checks #blocks == width * height on the merged record, so a
  // resize always carries all three together
  if ("width" in diff || "height" in diff || "blocks" in diff) {
    diff.width = next.width;
    diff.height = next.height;
    diff.blocks = next.blocks;
  }
  out.calls.push({ registry: "maps", op: "patch", id, value: diff, rowWidth: next.width });
  out.patched.push(id);
}

function recordCall(registry: string, old: unknown, id: string, value: unknown, out: CallSummary, replace: boolean, deep = false): void {
  if (value === null || value === undefined) {
    if (old !== undefined) out.calls.push({ registry, op: "remove", id, value: null });
    return;
  }
  // deep registries append patched lists: a grown list is written as its new
  // tail, anything a patch can't say (a list shrank) overrides the record
  if (deep && old !== undefined) {
    const diff = diffDeep(old, value);
    if (diff === undefined) return;
    if (diff === OVERRIDE) out.calls.push({ registry, op: "override", id, value: clone(value) });
    else out.calls.push({ registry, op: "patch", id, value: diff });
    out.patched.push(`${registry} ${id}`);
    return;
  }
  if (replace) {
    if (deepEqual(old, value)) return;
    out.calls.push({ registry, op: "override", id, value: clone(value) });
    out.patched.push(`${registry} ${id}`);
    return;
  }
  if (old === undefined) {
    out.calls.push({ registry, op: "register", id, value: clone(value) });
    out.registered.push(`${registry} ${id}`);
    return;
  }
  if (!isPlainObject(old) || !isPlainObject(value)) {
    if (deepEqual(old, value)) return;
    out.calls.push({ registry, op: "override", id, value: clone(value) });
  } else {
    const diff = diffRecord(old, value);
    if (diff === undefined) return;
    out.calls.push({ registry, op: "patch", id, value: diff });
  }
  out.patched.push(`${registry} ${id}`);
}

export async function saveProject(project: Project, edited: Record<string, Record<string, unknown>>): Promise<SaveResult> {
  const { host, version, adapter } = project;
  const modId = checkId(project.mod ?? "");
  const file = `mods/${modId}/studio_content.lua`;
  const layers = await buildLayers(host, version, adapter, modId);
  const bases = baseTables(adapter, layers.data);
  const { calls, patched, registered } = contentCalls(adapter, bases, edited);
  // keep what the studio file says about registries the studio does not
  // edit (a tileset it registered earlier, ...) exactly as it was
  const editable = new Set(editableRegistries(adapter));
  // registries the generated helper code writes (custom move effects) are
  // regenerated below, never copied from the old file
  const kept = keptOps(adapter, layers.studioOps);
  const order = [...editable];
  calls.sort((a, b) => order.indexOf(a.registry) - order.indexOf(b.registry) || rank(a) - rank(b) || a.id.localeCompare(b.id));
  // data-file registries: write the file whole (or remove it) and the code
  // that registers its records (before the calls, which may refer to them).
  // Only records that differ from the base go in (vanilla prize counters).
  let before = "";
  let internals = false;
  for (const c of adapter.content) {
    if (!c.studioFile) continue;
    const records: Record<string, unknown> = {};
    const base = bases[c.registry] ?? {};
    for (const [id, value] of Object.entries(edited[c.registry] ?? {})) {
      if (value !== null && value !== undefined && !deepEqual(base[id], value)) records[id] = value;
    }
    const path = `mods/${modId}/${c.studioFile}`;
    if (Object.keys(records).length) {
      const gen = GENERATORS[c.registry];
      await host.writeText(path, dataFile(modId, gen?.what ?? c.registry, records, gen?.order ?? []));
      if (gen) before += gen.runtime + "\n" + gen.registration(modId, c.studioFile) + "\n";
      if (gen?.internals) internals = true;
    } else if ((await host.readText("game", path)) !== null) {
      await host.deleteFile(path);
    }
  }
  await host.writeText(file, studioContentFile(modId, [...kept, ...calls], fieldOrders(adapter), before));
  await syncPermissions(host, modId, internals);
  const wiredUp = await isWiredUp(host, modId, await readManifest(host, modId));
  return { file, patched, registered, wiredUp, snippet: wiredUp ? undefined : requireLine(modId) };
}

// What the old studio file says that saving must carry over unchanged: calls
// to registries the studio doesn't edit (a tileset it registered earlier, ...).
// Never what the generated helpers register (re-generated on every save):
// those values hold functions, which can't be written back as data.
export function keptOps(adapter: GameAdapter, ops: RegistryOp[]): ContentCall[] {
  const editable = new Set(editableRegistries(adapter));
  const generated = new Set(adapter.content.map((c) => c.generates).filter((g): g is string => !!g));
  for (const g of Object.values(GENERATORS)) for (const r of g.writes) generated.add(r);
  return ops
    .filter((op) => !editable.has(op.registry) && !generated.has(op.registry))
    .map((op) => ({ registry: op.registry, op: op.op, id: op.id, value: op.value }));
}

// the fixed helpers that turn a data file's specs into engine records, by
// the studio registry that holds the specs; `writes`: every registry the
// helper's code registers into
export const GENERATORS: Record<string, { what: string; order: string[]; runtime: string; registration: (modId: string, file: string) => string; writes: string[]; internals?: boolean }> = {
  // map events: talk rows, step/enter triggers (plain Lua)
  studio_events: {
    what: "map events",
    order: ["x", "y", "once", "rows"],
    runtime: EVENT_RUNTIME,
    registration: eventRegistration,
    writes: ["map_scripts", "commands"],
  },
  // prize counters use the engine's prize window: engine_internals
  prize_counters: {
    what: "Game Corner prize counters",
    order: ["prizes", "item", "species", "level", "cost"],
    runtime: PRIZE_RUNTIME,
    registration: prizeRegistration,
    writes: ["map_scripts"],
    internals: true,
  },
  // tiles and blocks added to vanilla tilesets (the sheet itself is built
  // by the assets_transforms recipe, see src/core/assets.ts)
  studio_tilesets: {
    what: "tileset extensions",
    order: ["first", "walkable", "tiles", "blocks"],
    runtime: TILESET_RUNTIME,
    registration: tilesetRegistration,
    writes: ["tilesets"],
  },
  studio_effects: {
    what: "custom move effects",
    order: ["kind", "canMiss", "neverMiss", "hits", "damage", "recoil", "drain", "steps"],
    runtime: EFFECT_RUNTIME,
    registration: effectRegistration,
    writes: ["move_effects"],
  },
  studio_item_effects: {
    what: "custom item effects",
    order: ["target", "where", "keep", "steps", "act", "amount", "percent", "full", "statuses", "all", "stat", "delta", "cap"],
    runtime: ITEM_EFFECT_RUNTIME,
    registration: itemEffectRegistration,
    writes: ["item_effects"],
  },
};

// The engine_internals permission (the engine's mod manager labels it "PATCHES
// ENGINE CODE") follows what the studio's helpers need. It is only taken away
// again when nothing else in the mod reaches into the engine (src.*).
const INTERNALS = "engine_internals";

async function syncPermissions(host: Host, modId: string, needed: boolean): Promise<void> {
  const path = `mods/${modId}/manifest.json`;
  const text = await host.readText("game", path);
  if (text === null) return;
  const manifest = JSON.parse(text) as Record<string, unknown>;
  const list = Array.isArray(manifest.permissions) ? (manifest.permissions as unknown[]).filter((p): p is string => typeof p === "string") : [];
  const has = list.includes(INTERNALS);
  if (needed === has) return;
  if (!needed) {
    const files = await modFiles(host, modId);
    for (const [rel, body] of files) {
      if (/\/studio_[a-z_]+\.lua$/.test(rel)) continue;
      if (/require\s*\(?\s*["']src\./.test(body)) return;
    }
  }
  const next = needed ? [...list, INTERNALS] : list.filter((p) => p !== INTERNALS);
  if (next.length) manifest.permissions = next;
  else delete manifest.permissions;
  await host.writeText(path, JSON.stringify(manifest, null, 2) + "\n");
}

// within a registry: registrations first (a patch may refer to them)
function rank(c: ContentCall): number {
  return c.op === "register" ? 0 : c.op === "remove" ? 2 : 1;
}

export function fieldOrders(adapter: GameAdapter): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const c of adapter.content) if (c.fieldOrder) out[c.registry] = c.fieldOrder;
  return out;
}

// ------------------------------------------------------------------ mod files

// Creates a new mod whose main.lua loads the studio's generated file.
// With tools/modkit.py available (a source checkout) this is `modkit
// scaffold`; a release ships no Python tools, so the studio writes the same
// manifest itself (game_version is optional, so it is left out).
export async function createMod(host: Host, modId: string, game: string, useModkit: boolean): Promise<void> {
  checkId(modId);
  if (await readManifest(host, modId)) throw new Error(`mods/${modId} already exists`);
  if (useModkit) {
    const result = await host.modkit(["scaffold", modId, "--games", game]);
    if (!(await readManifest(host, modId))) throw new Error(`modkit scaffold failed:\n${result.output}`);
  } else {
    const name = modId.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const manifest = {
      id: modId,
      name,
      version: "0.1.0",
      api: 2,
      entry: "main.lua",
      profile: "content",
      category: "GAMEPLAY",
      priority: 100,
      dependencies: [],
      optional_dependencies: [],
      conflicts: [],
      incompatible: [],
      games: [game],
      experimental: false,
      description: `TODO: one line about ${modId}`,
    };
    await host.writeText(`mods/${modId}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
  }
  await host.writeText(
    `mods/${modId}/main.lua`,
    [
      `-- ${modId}: a content-profile mod (api 2).`,
      "-- Map edits live in studio_content.lua, written by gen1recomp-studio.",
      "return function(mod)",
      `  ${requireLine(modId)}`,
      "end",
      "",
    ].join("\n"),
  );
  await host.writeText(`mods/${modId}/studio_content.lua`, studioContentFile(modId, []));
}

// Adds the require line to an existing mod's entry point, just before the
// entry function's final `end`. Returns an error message when it cannot.
export async function wireUp(host: Host, modId: string): Promise<string | null> {
  const manifest = await readManifest(host, checkId(modId));
  const entry = entryPath(modId, manifest);
  const src = await host.readText("game", entry);
  if (src === null) return `${entry} not found`;
  if (src.includes(studioModule(modId))) return null;
  const match = /\bend\s*$/.exec(src);
  if (!match || !/^return\s+function\s*\(\s*mod\s*\)/m.test(src)) {
    return "main.lua does not end in `return function(mod) ... end`; add the line yourself.";
  }
  await host.writeText(entry, src.slice(0, match.index) + `  ${requireLine(modId)}\n` + src.slice(match.index));
  return null;
}

export async function validateMod(host: Host, modId: string): Promise<{ ok: boolean; output: string }> {
  checkId(modId);
  const validate: ProcessResult = await host.modkit(["validate", modId, "--strict"]);
  const lint: ProcessResult = await host.modkit(["lint", modId]);
  return {
    ok: validate.code === 0 && lint.code === 0,
    output: `$ modkit validate ${modId} --strict\n${validate.output.trim()}\n\n$ modkit lint ${modId}\n${lint.output.trim()}`,
  };
}
