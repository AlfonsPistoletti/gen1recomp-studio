// Map math shared by the block-based games: block lookup, fills, resizing,
// and connection placement as OverworldController.computeNeighbors does it
// (via tools/tiled_export.py). Collision is per game (adapter.cell).

import type { GameAdapter } from "../games/types.ts";
import type { Direction, MapDef } from "./types.ts";

export const BLOCK_PX = 32;

export interface Placed {
  id: string;
  x: number; // pixels, relative to the root map's top-left
  y: number;
}

// Breadth-first placement of every map reachable through connections, with
// `rootId` at (0, 0). Offsets are in blocks.
export function placeConnected(adapter: GameAdapter, maps: Record<string, MapDef>, rootId: string, limit = 400): Placed[] {
  const root = maps[rootId];
  if (!root) return [];
  const placed = new Map<string, Placed>([[rootId, { id: rootId, x: 0, y: 0 }]]);
  const queue = [rootId];
  while (queue.length && placed.size < limit) {
    const current = queue.shift()!;
    const def = maps[current];
    const at = placed.get(current)!;
    for (const conn of adapter.connections(def)) {
      const other = conn.map;
      const otherDef = maps[other];
      if (!otherDef || placed.has(other)) continue;
      const [dx, dy] = neighborOffset(def, otherDef, conn.dir, conn.offset);
      placed.set(other, { id: other, x: at.x + dx, y: at.y + dy });
      queue.push(other);
    }
  }
  return [...placed.values()];
}

export function neighborOffset(def: MapDef, other: MapDef, dir: Direction, offsetBlocks: number): [number, number] {
  const offset = offsetBlocks * BLOCK_PX;
  switch (dir) {
    case "north": return [offset, -other.height * BLOCK_PX];
    case "south": return [offset, def.height * BLOCK_PX];
    case "west": return [-other.width * BLOCK_PX, offset];
    default: return [def.width * BLOCK_PX, offset];
  }
}

export const OPPOSITE: Record<Direction, Direction> = { north: "south", south: "north", east: "west", west: "east" };

export function blockAt(map: MapDef, bx: number, by: number): number {
  if (bx < 0 || by < 0 || bx >= map.width || by >= map.height) return map.borderBlock ?? 0;
  return map.blocks[by * map.width + bx] ?? 0;
}

export function floodFill(map: MapDef, bx: number, by: number, value: number): number[] {
  const { width, height } = map;
  const blocks = map.blocks.slice();
  const target = blocks[by * width + bx];
  if (target === value) return blocks;
  const stack = [[bx, by]];
  while (stack.length) {
    const [x, y] = stack.pop()!;
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const i = y * width + x;
    if (blocks[i] !== target) continue;
    blocks[i] = value;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return blocks;
}

// Resizes a block grid, keeping the content anchored at (anchorX, anchorY)
// in {0, 0.5, 1} and filling new space with `fill`.
export function resizeBlocks(map: MapDef, width: number, height: number, anchorX: number, anchorY: number, fill: number): number[] {
  const ox = Math.round((width - map.width) * anchorX);
  const oy = Math.round((height - map.height) * anchorY);
  const out = new Array(width * height).fill(fill);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const nx = x + ox;
      const ny = y + oy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height) out[ny * width + nx] = map.blocks[y * map.width + x];
    }
  }
  return out;
}
