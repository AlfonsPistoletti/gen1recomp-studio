// Game-independent shapes. A map record is the engine's own record, kept
// as-is so a save can diff it field by field; only the fields every game
// shares are typed here. Game-specific fields are read through the game's
// adapter (src/games).

export type Direction = "north" | "south" | "east" | "west";
export const DIRECTIONS: Direction[] = ["north", "south", "west", "east"];

export interface MapDef {
  id: string;
  tileset: string;
  width: number; // blocks
  height: number; // blocks
  blocks: number[];
  borderBlock?: number;
  index?: number;
  [extra: string]: unknown;
}

export interface TilesetDef {
  id: string;
  image: string;
  tilesPerRow?: number;
  blocks: number[][];
  [extra: string]: unknown;
}

export interface SpriteDef {
  id: string;
  image: string;
  frames?: number;
  walker?: boolean;
  frameWidth?: number;
  frameHeight?: number;
  [extra: string]: unknown;
}

// An entity on the cell grid (warp, NPC, sign, trigger, ...).
export interface EntityRecord {
  x: number;
  y: number;
  [extra: string]: unknown;
}

export interface ModInfo {
  id: string;
  name: string;
  games: string[];
  hasStudioContent: boolean;
  wiredUp: boolean;
}

// Registry calls captured while running a mod's entry point.
export interface RegistryOp {
  registry: string;
  op: "register" | "patch" | "override" | "remove";
  id: string;
  value: unknown;
  owner: string;
}

export interface SaveResult {
  file: string;
  patched: string[];
  registered: string[];
  wiredUp: boolean;
  snippet?: string;
}

export const MOD_MAP_INDEX_BASE = 1000;
