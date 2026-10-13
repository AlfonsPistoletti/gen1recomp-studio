// The tile brush: one 8x8 tile painted onto a map cell. The block there is
// swapped for one with that tile: an identical block of the tileset when
// there is one, else the cell's own added block changed in place (when no
// other cell uses it), else a new block appended to the tileset (its
// extension for a game tileset). Map block ids are 0..255 (gen1recomp
// Schemas.lua maps.blocks), so a tileset holds at most 256 blocks.

import { clone } from "./merge.ts";
import { store } from "./store.ts";
import { EXTENSIONS, isBaseTileset, liveTileset, sheetTiles, type TilesetExtension } from "./tilesets.ts";
import type { TilesetDef } from "./types.ts";

export const MAX_BLOCKS = 256;

export interface TileResult {
  block: number;
  // the tileset record to write first (registry, id, new value)
  write?: { registry: string; id: string; next: unknown };
}

// `slot`: the tile's place in the block, 0..15 row by row. null: the
// tileset is full.
export function blockWithTile(mapId: string, bx: number, by: number, slot: number, tile: number): TileResult | null {
  const map = store.maps[mapId];
  const ts = map && liveTileset(map.tileset);
  if (!map || !ts) return null;
  const at = by * map.width + bx;
  const cur = map.blocks[at];
  const tiles = [...(ts.blocks[cur] ?? new Array<number>(16).fill(0))];
  if (tiles[slot] === tile) return { block: cur };
  tiles[slot] = tile;

  const id = map.tileset;
  const vanilla = isBaseTileset(id);
  const rec = store.table("tilesets")[id] as TilesetDef;
  // the game's own blocks are never changed
  const firstOwn = vanilla ? rec.blocks.length : 0;
  // the cell's own block, used nowhere else: free to change or drop
  const ownHere = cur >= firstOwn && cur < ts.blocks.length && usedOnlyAt(id, cur, mapId, at);
  // the mod's blocks (the extension's, or the own tileset's), changed by `mutate`
  const write = (mutate: (blocks: number[][]) => void): TileResult["write"] => {
    if (vanilla) {
      const ext = clone((store.table(EXTENSIONS)[id] as TilesetExtension | undefined) ?? { first: sheetTiles(rec), tiles: [], blocks: [], walkable: [] });
      mutate(ext.blocks);
      return { registry: EXTENSIONS, id, next: ext };
    }
    const next = clone(rec);
    mutate(next.blocks);
    return { registry: "tilesets", id, next };
  };

  const same = ts.blocks.findIndex((b) => b.length === 16 && b.every((t, i) => t === tiles[i]));
  if (same >= 0) {
    // the cell leaves its own block: drop it when it is the last one (only
    // the last can go, ids must not shift); else it stays, unused
    if (ownHere && cur === ts.blocks.length - 1) return { block: same, write: write((blocks) => void blocks.pop()) };
    return { block: same };
  }
  const block = ownHere ? cur : ts.blocks.length;
  if (!ownHere && block >= MAX_BLOCKS) return null;
  return { block, write: write((blocks) => void (blocks[block - firstOwn] = tiles)) };
}

// After a map was reverted or deleted: the mod's blocks it used that no map
// uses any more go, from the end of the tileset only (ids must not shift).
// Blocks the map never used stay (a block made in Graphics > Tilesets and
// not placed yet).
export function dropUnusedBlocks(id: string, used: number[]): void {
  const rec = store.table("tilesets")[id] as TilesetDef | undefined;
  if (!rec) return;
  const vanilla = isBaseTileset(id);
  const ext = vanilla ? (store.table(EXTENSIONS)[id] as TilesetExtension | undefined) : undefined;
  if (vanilla && !ext) return;
  const firstOwn = vanilla ? rec.blocks.length : 0;
  const blocks = [...(vanilla ? ext!.blocks : rec.blocks)];
  const was = new Set(used);
  while (blocks.length && was.has(firstOwn + blocks.length - 1) && usedOnlyAt(id, firstOwn + blocks.length - 1, "", -1)) blocks.pop();
  if (blocks.length === (vanilla ? ext!.blocks.length : rec.blocks.length)) return;
  if (!vanilla) return store.setRecord("tilesets", id, "Drop unused blocks", { ...rec, blocks });
  const next: TilesetExtension = { ...ext!, blocks };
  // nothing left of an extension the game's data doesn't have: gone
  const empty = !next.tiles.length && !blocks.length && !(next.walkable ?? []).length && Object.keys(next).every((k) => ["first", "tiles", "blocks", "walkable"].includes(k));
  store.setRecord(EXTENSIONS, id, "Drop unused blocks", empty && store.baseTable(EXTENSIONS)[id] === undefined ? undefined : next);
}

// whether block `b` of tileset `id` appears on no map cell but `mapId`'s
// cell `at` (nor as a border block or a cut-tree swap)
function usedOnlyAt(id: string, b: number, mapId: string, at: number): boolean {
  for (const [mid, m] of Object.entries(store.maps)) {
    if (m.tileset !== id) continue;
    if (m.borderBlock === b) return false;
    for (let i = 0; i < m.blocks.length; i++) if (m.blocks[i] === b && !(mid === mapId && i === at)) return false;
  }
  const swaps = (store.table("field").cutTreeSwaps as { before: number; after: number }[] | undefined) ?? [];
  return !swaps.some((s) => s.before === b || s.after === b);
}

