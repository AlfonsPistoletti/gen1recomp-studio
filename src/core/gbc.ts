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
}

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
      const pack = await loadLuaData<{ world?: GbcWorld }>(text, "palettes_gbc.lua");
      const w = pack?.world;
      if (!w?.tileGroups || !w.groupColors) return null;
      const world: GbcWorld = { tileGroups: { ...w.tileGroups }, groupColors: { ...w.groupColors }, roofGroup: w.roofGroup ?? {}, roofByMapIndex: w.roofByMapIndex ?? {} };
      // Yellow replaces some tilesets' tables (PaletteFX.worldPack)
      if (/yellow/i.test(version)) {
        const y = await host.readText("game", "data/palettes_gbc_yellow.lua").catch(() => null);
        const yw = y ? (await loadLuaData<{ world?: Partial<GbcWorld> }>(y, "palettes_gbc_yellow.lua"))?.world : undefined;
        Object.assign(world.tileGroups, yw?.tileGroups ?? {});
        Object.assign(world.groupColors, yw?.groupColors ?? {});
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
export function gbcAvailable(): boolean {
  return world !== null;
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

// the roof colors a map's town gives (null: no roof group on this tileset)
export function roofIndex(tilesetId: string, mapId: string | null): number | null {
  if (!world || world.roofGroup[tilesetId] === undefined || !mapId) return null;
  const index = store.maps[mapId]?.index;
  return typeof index === "number" && at(world.roofByMapIndex, index) ? index : null;
}

// A palette key for caches: "GBC|<roof map index or ->|<mapId of fixes>".
export function gbcKey(tilesetId: string, mapId: string | null): string | null {
  if (!groupColors(tilesetId)) return null;
  const fixes = mapId && MAP_EXCEPTIONS[mapId] ? mapId : "";
  return `GBC|${roofIndex(tilesetId, mapId) ?? "-"}|${fixes}`;
}

export function isGbcKey(key: string): boolean {
  return key.startsWith("GBC|");
}

// Per-tile colors (darkest first, as the block atlas wants them) for a key
// from gbcKey.
export function gbcColorsFor(tilesetId: string, key: string): (tile: number) => Rgb[] {
  const [, roofPart, fixes] = key.split("|");
  const groups = groupColors(tilesetId) ?? [];
  const roof = roofPart && roofPart !== "-" && world ? at(world.roofByMapIndex, Number(roofPart)) : undefined;
  const byGroup = groups.map((c, g) => {
    const four = g === ROOF_GROUP && roof ? [c[0], roof[0], roof[1], c[3]] : c;
    return [...four].reverse();
  });
  const gray: Rgb[] = [[0, 0, 0], [85, 85, 85], [170, 170, 170], [255, 255, 255]];
  return (tile) => byGroup[groupOf(tilesetId, tile, fixes || null)] ?? gray;
}
