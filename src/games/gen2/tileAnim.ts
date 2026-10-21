// Gold's animated map tiles, as gen1recomp's World animates them
// (src/world/gen2/World.lua animLayers / animRow / pollTileAnim): a tileset's
// `anim` program (extracted from data/tileset_anims.asm) names the tiles it
// rewrites; one pass of the program is `period` frames and moves a 0..7 timer
// on by one, and each kind picks its strip row from that timer.
import type { MapAnimation } from "../../core/tilesets.ts";

interface AnimFrame { func?: string; tile?: number; sheet?: string; frames?: number; scroll?: { h?: number; v?: number } }
export interface TileAnimSheets { waterFrames?: string; flowerFrames?: string; flowerCgbFrames?: number[] }

// strip row (1-based) per timer value 0..7, per kind (World:animRow)
const WATER = [1, 1, 2, 2, 3, 3, 4, 4];
const WHIRLPOOL = [1, 2, 3, 4, 1, 2, 3, 4];
const TOWER = [1, 2, 3, 4, 5, 4, 3, 2];
const LAVA2 = [1, 1, 2, 2, 3, 3, 4, 4];
const LAVA1 = [3, 3, 4, 4, 1, 1, 2, 2];
const SCROLL = [1, 2, 3, 4, 5, 6, 7, 8];

// An animation a mod gives its own tile: one of the engine's strip patterns
// with the mod's frames (a row appended to the tileset's `anim` program)
export interface OwnAnimRow { func: string; tile: number; sheet: string; frames: number }
export const OWN_PATTERNS = [
  { func: "AnimateWhirlpoolTile", frames: 4, label: "4 frames" },
  { func: "AnimateLavaBubbleTile2", frames: 4, label: "4 frames, half speed" },
  { func: "AnimateTowerPillarTile", frames: 5, label: "5 frames, there and back" },
];

// `strip` is a game or mod path: mapAnimations makes it a URL (`source` keeps
// the path); `own`: the frames are the mod's (not under assets/generated/)
export function gen2TileAnimations(anim: unknown, sheets: TileAnimSheets): MapAnimation[] {
  const a = anim as { period?: number; frames?: AnimFrame[] } | undefined;
  if (!a?.period || !Array.isArray(a.frames)) return [];
  const period = a.period;
  const out = new Map<number, MapAnimation>();
  const add = (tile: number | undefined, strip: string | undefined, sequence: number[]) => {
    if (tile !== undefined && strip) out.set(tile, { tile, period, sequence, strip, source: strip, own: !strip.startsWith("assets/generated/") });
  };
  // AnimateFlowerTile on CGB writes only two of the four rows (World:flowerFrameFor)
  const [f1, f2] = sheets.flowerCgbFrames?.length === 2 ? sheets.flowerCgbFrames : [2, 4];
  for (const f of a.frames) {
    if (f.func === "AnimateWaterTile") add(f.tile, sheets.waterFrames, WATER);
    // it takes no argument: always tile 3 (tileset_anims.asm:222)
    else if (f.func === "AnimateFlowerTile") add(3, sheets.flowerFrames, [f1, f1, f2, f2, f1, f1, f2, f2]);
    else if (f.func === "AnimateWhirlpoolTile") add(f.tile, f.sheet, WHIRLPOOL);
    else if (f.func === "AnimateTowerPillarTile") add(f.tile, f.sheet, TOWER);
    else if (f.func === "AnimateLavaBubbleTile1") add(f.tile, f.sheet, LAVA1);
    else if (f.func === "AnimateLavaBubbleTile2") add(f.tile, f.sheet, LAVA2);
    // the tileset's own tile rotated in place (ScrollTile*)
    else if (f.func === "WriteTileFromAnimBuffer" && f.scroll && f.tile !== undefined) out.set(f.tile, { tile: f.tile, period, sequence: SCROLL, scroll: { h: f.scroll.h ?? 0, v: f.scroll.v ?? 0 } });
  }
  return [...out.values()];
}
