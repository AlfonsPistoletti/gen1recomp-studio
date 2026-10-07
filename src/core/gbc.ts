// RED++ (pokered-gbc) overworld colors, the way gen1recomp's COLORS=RED++
// mode draws them (src/render/PaletteFX.lua worldGroupAt/worldGroupColors):
// every tileset has 8 four-color palettes ("groups") and each tile graphic
// uses one of them; the ROOF group's two middle colors follow the town.
//
// The data is gen1recomp's data/palettes_gbc.lua (+ the Yellow deltas), which
// only a source checkout has as a file: without it RED++ colors are not
// offered. The few single-tile fixes the engine keeps as code are restated
// below. Not reproduced: the Celadon diner table-top alias, dark caves.
//
// A mod colors its own tiles through studio_tilesets: `gbc.groups` (tile ->
// group) for tiles added to a game tileset, plus `gbc.palettes` (its 8
// groups) for a tileset of its own (src/lua/tilesetRuntime.ts puts both into
// the engine's table when the mod loads).

import type { Host } from "../host/types.ts";
import { loadLuaData } from "../lua/vm.ts";
import type { Rgb } from "../render/color.ts";
import { store } from "./store.ts";

type Table<T> = Record<string, T> | T[];

interface GbcWorld {
  tileGroups: Record<string, Table<number>>;
  groupColors: Record<string, Rgb[][]>;
  roofGroup: Record<string, number>;
  roofByMapIndex: Table<Rgb[]>;
  // overworld sprites: ROM picture number -> palette (or "random"), palettes
  spriteAssignment: Table<number | string>;
  spritePalettes: Table<Rgb[]>;
  // battle pics and screens: palettes by name (lightest first) and each
  // species' palette name (PaletteFX.pack: palettes_gbc, Yellow: palettes_yellow)
  named: Record<string, Rgb[]>;
  monPalettes: Record<string, string>;
}

// pokered-gbc is Red's: Blue's versions of these come from the ROM (PaletteFX BLUE_VERSIONED)
const BLUE_VERSIONED = ["LOGO1", "SLOTS2", "SLOTS3", "SLOTS4"];

// what a mod adds (a studio_tilesets record's `gbc`): groups as [tile, group]
// pairs; palettes = 8 groups x 4 colors, lightest first (a tileset of its own)
export interface GbcColoring {
  groups?: [number, number][];
  palettes?: Rgb[][];
}

export const GROUP_NAMES = ["Gray", "Red", "Green", "Blue", "Yellow", "Brown", "Roof", "Text"];
const ROOF_GROUP = 6;

// PaletteFX.lua TILE_GROUP_EXCEPTIONS (per map) and TILESET_GROUP_EXCEPTIONS
const MAP_EXCEPTIONS: Record<string, { tiles: number[]; group: number }> = {
  CELADON_MART_ROOF: { tiles: [0x4b, 0x4c, 0x4d, 0x4e, 0x4f], group: 3 },
  CELADON_MART_3F: { tiles: [0x37], group: 5 },
  CELADON_MART_1F: { tiles: [0x07, 0x08, 0x17, 0x18], group: 4 },
};
const TILESET_EXCEPTIONS: Record<string, { tiles: number[]; group: number }> = {
  CEMETERY: { tiles: [0x22], group: 0 },
};

// a Lua table read as JSON: arrays are 1-based in Lua
function at<T>(t: Table<T> | undefined, k: number): T | undefined {
  if (!t) return undefined;
  return Array.isArray(t) ? t[k - 1] : t[k];
}

const loaded = new Map<string, Promise<GbcWorld | null>>();

// The RED++ world colors for a game version, or null without the file.
export function loadGbc(host: Host, version: string): Promise<GbcWorld | null> {
  let p = loaded.get(version);
  if (!p) {
    p = (async () => {
      const text = await host.readText("game", "data/palettes_gbc.lua").catch(() => null);
      if (!text) return null;
      type Pack = { world?: GbcWorld; palettes?: Record<string, Rgb[]>; pokemon?: Record<string, string>; cgbBase?: Record<string, Rgb[]> };
      const pack = await loadLuaData<Pack>(text, "palettes_gbc.lua");
      const w = pack?.world;
      if (!w?.tileGroups || !w.groupColors) return null;
      const world: GbcWorld = {
        tileGroups: { ...w.tileGroups },
        groupColors: { ...w.groupColors },
        roofGroup: w.roofGroup ?? {},
        roofByMapIndex: w.roofByMapIndex ?? {},
        spriteAssignment: w.spriteAssignment ?? {},
        spritePalettes: { ...(w.spritePalettes ?? {}) },
        named: { ...(pack.palettes ?? {}) },
        monPalettes: pack.pokemon ?? {},
      };
      if (/blue/i.test(version)) for (const n of BLUE_VERSIONED) delete world.named[n];
      // Yellow replaces some tilesets' tables (PaletteFX.worldPack)
      if (/yellow/i.test(version)) {
        const y = await host.readText("game", "data/palettes_gbc_yellow.lua").catch(() => null);
        const yw = y ? (await loadLuaData<{ world?: Partial<GbcWorld> }>(y, "palettes_gbc_yellow.lua"))?.world : undefined;
        Object.assign(world.tileGroups, yw?.tileGroups ?? {});
        Object.assign(world.groupColors, yw?.groupColors ?? {});
        if (yw?.spriteAssignment) world.spriteAssignment = yw.spriteAssignment;
        Object.assign(world.spritePalettes, yw?.spritePalettes ?? {});
        // battle pics: Yellow's own table, colored with CGBBasePalettes
        // (PaletteFX.monPal / yellowCgbNamedPal)
        const yp = await host.readText("game", "data/palettes_yellow.lua").catch(() => null);
        const ypack = yp ? await loadLuaData<Pack>(yp, "palettes_yellow.lua") : null;
        world.named = { ...(ypack?.palettes ?? {}), ...(ypack?.cgbBase ?? {}) };
        world.monPalettes = ypack?.pokemon ?? {};
      }
      return world;
    })().catch(() => null);
    loaded.set(version, p);
  }
  return p;
}

let world: GbcWorld | null = null;
export function setGbc(w: GbcWorld | null): void {
  world = w;
}
// the Graphics views' color choices besides a palette name
export const GRAYS = "__grays";
export const REDPP = "__redpp";

export function gbcAvailable(): boolean {
  return world !== null;
}

// RED++ colors of a named palette (lightest first), or null when RED++ has no
// such palette (the engine then uses the game's own, a mod's palettes too)
export function gbcPalette(name: string): Rgb[] | null {
  const p = world?.named[name];
  return p?.length === 4 ? p : null;
}

// the palette RED++ gives a species' battle pics (PaletteFX.monPalName)
export function gbcMonPalette(species: string): string | undefined {
  return world?.monPalettes[species];
}

function coloringOf(tilesetId: string): GbcColoring | undefined {
  return (store.table("studio_tilesets")[tilesetId] as { gbc?: GbcColoring } | undefined)?.gbc;
}

// the 8 groups of a tileset (lightest color first): the game's, or a mod
// tileset's own; null when it has none (the engine then draws it the
// non-RED++ way)
export function groupColors(tilesetId: string): Rgb[][] | null {
  const own = coloringOf(tilesetId)?.palettes;
  if (own?.length === 8) return own;
  return world?.groupColors[tilesetId] ?? null;
}

// the group a tile uses (`mapId`: the per-map fixes); mod tiles default to 7
export function groupOf(tilesetId: string, tile: number, mapId?: string | null): number {
  const exc = mapId ? MAP_EXCEPTIONS[mapId] : undefined;
  if (exc?.tiles.includes(tile)) return exc.group;
  const tsExc = TILESET_EXCEPTIONS[tilesetId];
  if (tsExc?.tiles.includes(tile)) return tsExc.group;
  const mine = coloringOf(tilesetId)?.groups?.find(([t]) => t === tile);
  if (mine) return mine[1];
  const g = world?.tileGroups[tilesetId];
  const v = at(g, tile);
  return typeof v === "number" ? v : 7;
}

export const ROOFS = "studio_roofs";

// a roof the mod sets for a map: { index, colors } (index: the map's, which
// the engine's roof table is keyed by)
export interface RoofRecord {
  index: number;
  colors: Rgb[];
}

export function tilesetHasRoof(tilesetId: string): boolean {
  return !!world && world.roofGroup[tilesetId] !== undefined;
}

// the game's roof colors for a map index (its town's)
export function gameRoof(index: number | undefined): Rgb[] | null {
  if (!world || typeof index !== "number") return null;
  return at(world.roofByMapIndex, index) ?? null;
}

// the towns whose roofs a map can copy: map id -> its 2 roof colors
export function townRoofs(): [string, Rgb[]][] {
  const out: [string, Rgb[]][] = [];
  for (const [id, m] of Object.entries(store.base)) {
    const r = gameRoof(m.index);
    if (r && /_(CITY|TOWN|PLATEAU|ISLAND)$/.test(id)) out.push([id, r]);
  }
  return out.sort((a, b) => a[0].localeCompare(b[0]));
}

// the roof's 2 middle colors a map gets (the mod's, else its town's; null:
// the tileset's own roof group)
export function roofColors(tilesetId: string, mapId: string | null): Rgb[] | null {
  if (!tilesetHasRoof(tilesetId) || !mapId) return null;
  const mine = store.table(ROOFS)[mapId] as RoofRecord | undefined;
  if (mine?.colors?.length === 2) return mine.colors;
  return gameRoof(store.maps[mapId]?.index);
}

const hex = (c: Rgb) => c.map((v) => v.toString(16).padStart(2, "0")).join("");

// A palette key for caches: "GBC|<roof colors or ->|<mapId of fixes>".
export function gbcKey(tilesetId: string, mapId: string | null): string | null {
  if (!groupColors(tilesetId)) return null;
  const fixes = mapId && MAP_EXCEPTIONS[mapId] ? mapId : "";
  const roof = roofColors(tilesetId, mapId);
  return `GBC|${roof ? roof.map(hex).join(",") : "-"}|${fixes}`;
}

export function isGbcKey(key: string): boolean {
  return key.startsWith("GBC|");
}

// Per-tile colors (darkest first, as the block atlas wants them) for a key
// from gbcKey.
export function gbcColorsFor(tilesetId: string, key: string): (tile: number) => Rgb[] {
  const [, roofPart, fixes] = key.split("|");
  const groups = groupColors(tilesetId) ?? [];
  const roof = roofPart && roofPart !== "-"
    ? roofPart.split(",").map((x) => [0, 2, 4].map((k) => parseInt(x.slice(k, k + 2), 16)) as Rgb)
    : undefined;
  const byGroup = groups.map((c, g) => {
    const four = g === ROOF_GROUP && roof ? [c[0], roof[0], roof[1], c[3]] : c;
    return [...four].reverse();
  });
  const gray: Rgb[] = [[0, 0, 0], [85, 85, 85], [170, 170, 170], [255, 255, 255]];
  return (tile) => byGroup[groupOf(tilesetId, tile, fixes || null)] ?? gray;
}

// ------------------------------------------------------------------ sprites
// PaletteFX.spriteObp: a sprite's ROM picture number (its `source`, or
// `paletteSource` for mod art that borrows one) picks a palette; "random"
// ones hash the NPC's id ("<MAP>_obj_<index>", the player "player") into one
// of the first four. The bike sheet (no number) wears the player's. Mod
// sprites without a source stay in plain shades.

export interface SpriteSource {
  source?: unknown;
  paletteSource?: unknown;
}

function seedGroup(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 4294967296;
  return h % 4;
}

// the color set a sprite's picture number picks (a number, or "random":
// one of the first four per NPC), or undefined
export function spriteGroup(def: (SpriteSource & Record<string, unknown>) | undefined, yellow = false): number | "random" | undefined {
  if (!world) return undefined;
  const src = typeof def?.paletteSource === "string" ? def.paletteSource : typeof def?.source === "string" ? def.source : "";
  if (!src) return undefined;
  const m = /\[(\d+)\]/.exec(src);
  let idx = m ? Number(m[1]) : null;
  if (idx === null && src.includes("RedBikeSprite")) idx = 0;
  if (idx === null && src.includes("SurfingPikachuSprite")) idx = yellow ? 60 : 0;
  if (idx === null) return undefined;
  const group = at(world.spriteAssignment, idx + 1 - (Array.isArray(world.spriteAssignment) ? 0 : 1));
  return typeof group === "number" || group === "random" ? group : undefined;
}

// The color sets a sprite can wear: each with the first ROM picture number
// that has it (what `paletteSource` names) and its colors (lightest first;
// none for "random").
export function spriteColorSets(): { group: number | "random"; source: string; colors: Rgb[] | null }[] {
  if (!world) return [];
  const out: { group: number | "random"; source: string; colors: Rgb[] | null }[] = [];
  for (let idx = 0; idx < 256; idx++) {
    const group = spriteGroup({ source: `[${idx}]` });
    if (group === undefined || out.some((o) => o.group === group)) continue;
    const pal = group === "random" ? null : at(world.spritePalettes, group + (Array.isArray(world.spritePalettes) ? 1 : 0));
    out.push({ group, source: `ROM:SpriteSheetPointerTable[${idx}]`, colors: pal && pal.length >= 4 ? pal : null });
  }
  return out.sort((a, b) => (a.group === "random" ? 99 : a.group) - (b.group === "random" ? 99 : b.group));
}

// RED++ colors of a sprite (darkest first, as spriteFrame wants them) and a
// cache key, or null when the sprite has none
export function spriteGbcColors(def: (SpriteSource & Record<string, unknown>) | undefined, seed: string, yellow = false): { colors: Rgb[]; key: string } | null {
  if (!world) return null;
  let group = spriteGroup(def, yellow);
  if (group === undefined) return null;
  if (group === "random") group = seedGroup(seed);
  const pal = at(world.spritePalettes, Number(group) + (Array.isArray(world.spritePalettes) ? 1 : 0));
  if (!pal || pal.length < 4) return null;
  // sheet shades darkest first: black, dark gray, light gray, white (clear)
  return { colors: [pal[3], pal[2], pal[1], pal[0]], key: `GBCS|${group}` };
}
