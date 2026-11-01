// Gold's Pokédex footprints of a mod (studio_footprints: species -> { pixels }
// | { copy }), without the DOM: what a drawing is stored as, and the tiles the
// asset recipe appends to the player's strip (src/ui/footprints.ts edits them,
// src/lua/footprintRuntime2.ts points the Pokédex at the strip).

import type { SheetRecipe } from "../../core/assets.ts";

export type Footprint = { pixels?: string; copy?: string };

export const FOOTPRINT_SHEET = "pokedex/footprints.png";
export const FOOTPRINT_SIZE = 16;

// A drawing (256 "0"/"1", 1 = the print) as a record: none when it is the species' own
// game footprint, a copy when it is another game species' (the mod ships no ROM
// pixels), else its pixels. `rows` = the game strip's rows, in `order`.
export function footprintRecord(species: string, pixels: string, rows: string[], order: string[]): Footprint | undefined {
  const own = order.indexOf(species);
  if (own >= 0 && rows[own] === pixels) return undefined;
  const same = rows.indexOf(pixels);
  if (same >= 0 && order[same]) return { copy: order[same] };
  return { pixels };
}

// The tiles below the strip, 2x2 per record in sorted id order (the helper
// gives the species those rows in the same order): shade digits (the strip holds
// the print white on black: 1 -> white, 0 -> black),
// or the copied species' tiles from the player's own strip
export function footprintTiles(records: Record<string, Footprint>, order: string[]): SheetRecipe["tiles"] {
  const tiles: SheetRecipe["tiles"] = [];
  const S = FOOTPRINT_SIZE;
  for (const id of Object.keys(records).sort()) {
    const p = records[id];
    const row = p.copy ? order.indexOf(p.copy) : -1;
    for (const [tx, ty] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      if (row >= 0) {
        tiles.push({ from: FOOTPRINT_SHEET, x: tx * 8, y: row * S + ty * 8 });
        continue;
      }
      const px = p.pixels ?? "";
      let digits = "";
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) digits += px[(ty * 8 + y) * S + tx * 8 + x] === "1" ? "0" : "3";
      tiles.push(digits);
    }
  }
  return tiles;
}
