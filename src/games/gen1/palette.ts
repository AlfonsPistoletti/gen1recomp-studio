// Which SGB palette a map renders with. Mirrors tools/tiled_export.py
// resolve_map_palettes: the vanilla cascade (by map, by tileset, by prefix)
// and, for interiors, the palette of the outdoor map their warps lead to.

import type { MapDef } from "../../core/types.ts";
import { MONO, type Rgb } from "../../render/color.ts";

export interface PaletteData {
  order: string[];
  // lightest first, as palettes.lua stores them
  palettes: Record<string, [number, number, number][]>;
}

interface Gen1Map extends MapDef {
  palette?: string;
  warps: { destMap: string }[];
}

const PALETTE_BY_MAP: Record<string, string> = {
  PALLET_TOWN: "PALLET", VIRIDIAN_CITY: "VIRIDIAN", PEWTER_CITY: "PEWTER", CERULEAN_CITY: "CERULEAN",
  LAVENDER_TOWN: "LAVENDER", VERMILION_CITY: "VERMILION", CELADON_CITY: "CELADON", FUCHSIA_CITY: "FUCHSIA",
  CINNABAR_ISLAND: "CINNABAR", INDIGO_PLATEAU: "INDIGO", SAFFRON_CITY: "SAFFRON",
  LORELEIS_ROOM: "PALLET", BRUNOS_ROOM: "CAVE",
};
const PALETTE_BY_TILESET: Record<string, string> = { CEMETERY: "GRAYMON", CAVERN: "CAVE" };
const PALETTE_BY_PREFIX: [string, string][] = [["ROUTE_", "ROUTE"]];
const PALETTE_DEFAULT = "ROUTE";

function cascade(id: string, map: Gen1Map): string | undefined {
  if (PALETTE_BY_MAP[id]) return PALETTE_BY_MAP[id];
  if (PALETTE_BY_TILESET[map.tileset]) return PALETTE_BY_TILESET[map.tileset];
  for (const [prefix, palette] of PALETTE_BY_PREFIX) if (id.startsWith(prefix)) return palette;
  return undefined;
}

export function resolveMapPalettes(input: Record<string, MapDef>): Record<string, string> {
  const maps = input as Record<string, Gen1Map>;
  const resolved: Record<string, string> = {};
  for (const [id, map] of Object.entries(maps)) {
    const p = map.palette || cascade(id, map);
    if (p) resolved[id] = p;
  }
  const neighbors: Record<string, Set<string>> = {};
  for (const id of Object.keys(maps)) neighbors[id] = new Set();
  for (const [id, map] of Object.entries(maps)) {
    for (const warp of map.warps || []) {
      const other = warp.destMap;
      if (other && other !== id && neighbors[other]) {
        neighbors[id].add(other);
        neighbors[other].add(id);
      }
    }
  }
  const queue = Object.keys(resolved).sort();
  while (queue.length) {
    const current = queue.shift()!;
    for (const other of [...neighbors[current]].sort()) {
      if (!resolved[other]) {
        resolved[other] = resolved[current];
        queue.push(other);
      }
    }
  }
  for (const id of Object.keys(maps)) resolved[id] ??= PALETTE_DEFAULT;
  return resolved;
}

// Four colors, DARKEST first (palettes.lua stores them lightest first).
export function paletteColors(data: PaletteData, name: string | undefined): Rgb[] {
  const entry = name ? data.palettes?.[name] : undefined;
  if (!entry || entry.length !== 4) return MONO;
  return [...entry].reverse().map((c) => [c[0], c[1], c[2]] as Rgb);
}

export function paletteNames(data: PaletteData): string[] {
  return data.order?.length ? data.order : Object.keys(data.palettes || {}).sort();
}
