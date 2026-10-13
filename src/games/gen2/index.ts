// Gold / Silver / Crystal: a read-only map viewer for now (ROADMAP Gen 2,
// step 1). The data is gen1recomp's Gen 2 extraction (data/generated):
// maps with numeric NPC movement, bgEvents (signs) and coordEvents (step
// triggers) whose scripts are cart bytecode; tilesets with per-block
// collision quads and a palette slot per tile; colors per map environment
// and time of day (palettes.lua environments -> bg palettes).

import type { Rgb } from "../../render/color.ts";
import { MONO } from "../../render/color.ts";
import type { Direction, MapDef, SpriteDef, TilesetDef } from "../../core/types.ts";
import type { CellInfo, ConnectionRef, Dataset, GameAdapter, GameContext } from "../types.ts";

interface Palettes {
  bg?: [number, number, number][][];
  environments?: Record<string, Record<string, number[]>>;
  objects?: Record<string, [number, number, number][][]>;
  roofs?: { mornDay?: [number, number, number][]; nite?: [number, number, number][] }[];
  roofSlot?: number;
}

// gen1recomp src/core/CollPermissions.lua TABLE: a COLL_* byte -> LAND (0),
// WATER (1) or WALL (15); the player walks on LAND
const COLL_PERMISSIONS = [
  0, 0, 0, 0, 0, 0, 0, 15, 0, 0, 0, 0, 0, 0, 0, 15,
  0, 0, 15, 0, 0, 15, 0, 0, 0, 0, 15, 0, 0, 15, 0, 0,
  1, 1, 1, 0, 1, 1, 1, 15, 1, 1, 1, 0, 1, 1, 1, 15,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 15, 0, 0, 0, 0, 0, 0, 0, 15, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  15, 15, 15, 15, 15, 0, 0, 0, 15, 15, 15, 15, 15, 0, 0, 0,
  15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 15,
];

const palettes = (ctx: GameContext) => (ctx.data.extra.palettes ?? {}) as Palettes;
// the map view shows the day colors
const TIME = "DAY";
const asList = (v: unknown) => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : []);

export const gen2: GameAdapter = {
  id: "gen2",
  name: "Gen 2",
  manifestGame: "gen2",
  readOnly: "Gen 2 is view-only in the studio for now: maps can be looked at, not changed or saved.",
  workspaces: ["maps"],

  async load(read): Promise<Dataset> {
    const [maps, tilesets, sprites, pal] = await Promise.all([
      read("maps.lua") as Promise<Record<string, MapDef>>,
      read("tilesets.lua") as Promise<Record<string, TilesetDef>>,
      read("sprites.lua") as Promise<Record<string, SpriteDef>>,
      read("palettes.lua") as Promise<Palettes>,
    ]);
    for (const m of Object.values(maps)) gen2.normalizeMap(m);
    return { maps, tilesets, sprites, content: { tilesets: { ...tilesets }, sprites: { ...sprites } }, extra: { palettes: pal } };
  },

  // Empty Lua tables arrive as []; the lists the view reads become arrays
  normalizeMap(map) {
    const m = map as Record<string, unknown>;
    if (!m.connections || Array.isArray(m.connections)) m.connections = {};
    for (const key of ["warps", "objects", "bgEvents", "coordEvents"]) m[key] = asList(m[key]);
    return map;
  },

  layers: [
    {
      key: "warps",
      kind: "warp",
      label: "Warps",
      singular: "Warp",
      color: "#b07cff",
      numbered: true,
      fields: [{ kind: "warpTarget", label: "Destination", mapKey: "destMap", warpKey: "destWarp", specialMaps: [] }],
      create: (_map, x, y) => ({ x, y, destMap: "", destWarp: 1 }),
    },
    {
      key: "objects",
      kind: "npc",
      label: "Objects",
      singular: "NPC / object",
      color: "#3cc8e6",
      fields: [
        { kind: "select", key: "sprite", label: "Sprite", options: (ctx) => Object.keys(ctx.data.sprites).sort() },
        { kind: "extras", label: "Other fields", hint: "movement, radius, hours, event flag, palette, script pointer (cart bytecode)" },
      ],
      create: (_map, x, y) => ({ x, y, sprite: "SPRITE_CHRIS" }),
      sprite: (o) => (typeof o.sprite === "string" ? { sprite: o.sprite, facing: "down", ghost: false, moving: false } : null),
    },
    {
      key: "bgEvents",
      kind: "sign",
      label: "Signs",
      singular: "Sign",
      color: "#ffc828",
      fields: [{ kind: "extras", label: "Fields", hint: "kind and script pointer (cart bytecode)" }],
      create: (_map, x, y) => ({ x, y, kind: 0 }),
    },
    {
      key: "coordEvents",
      kind: "trigger",
      label: "Step triggers",
      singular: "Step trigger",
      color: "#ff7a45",
      fields: [{ kind: "extras", label: "Fields", hint: "scene and script pointer (cart bytecode)" }],
      create: (_map, x, y) => ({ x, y, sceneId: 0 }),
    },
  ],

  mapFields: [
    { kind: "text", key: "environment", label: "Environment", hint: "Picks the colors (TOWN, ROUTE, INDOOR, CAVE, ...)" },
  ],

  connections(map): ConnectionRef[] {
    const out: ConnectionRef[] = [];
    const conns = (map.connections ?? {}) as Record<string, { mapId?: string; offset?: number }>;
    for (const [dir, c] of Object.entries(conns)) if (c?.mapId) out.push({ dir: dir as Direction, map: c.mapId, offset: c.offset ?? 0 });
    return out;
  },
  setConnection() {
    // view-only for now
  },

  // gen1recomp src/world/gen2/Map.lua cellCollision: block 0 is a wall; a
  // cell is a quarter of its block's collision quad
  cell(map, tileset, cx, cy): CellInfo {
    const bx = Math.floor(cx / 2);
    const by = Math.floor(cy / 2);
    const id = map.blocks[by * map.width + bx] ?? 0;
    const quad = (tileset?.collision as number[][] | undefined)?.[id];
    const coll = id === 0 || !quad ? 0xff : quad[(cy % 2) * 2 + (cx % 2)] ?? 0xff;
    return { walkable: COLL_PERMISSIONS[coll % 256] === 0, label: `coll $${coll.toString(16).padStart(2, "0")}` };
  },

  // one key per environment and map group (the roof colors), day palettes
  paletteKeys(ctx) {
    const out: Record<string, string> = {};
    for (const [id, m] of Object.entries(ctx.maps)) out[id] = `${String(m.environment ?? "TOWN")}|${Number(m.group ?? 0)}`;
    return out;
  },
  // gen1recomp src/world/gen2/Palettes.lua bgSet: the environment's 8 bg
  // palettes for the daytime, a tile's slot from its tileset's tilePalettes
  // (1-based, like the palette ids), and in towns and routes the roof slot's
  // two middle colors from roofs[map group]. Darkest first, like Gen 1's.
  // shortcut: Crystal's per-tile attribute palettes (TileAttrs) aren't read; its tiles use tilePalettes too
  tileColors(ctx, tileset, key) {
    const p = palettes(ctx);
    const [env, group] = key.split("|");
    const row = p.environments?.[env] ?? p.environments?.TOWN;
    const ids = row?.[TIME] ?? row?.DAY ?? [];
    const set = Array.from({ length: 8 }, (_, slot) => (p.bg?.[(ids[slot] ?? 1) - 1] ?? MONO).map((c) => [c[0], c[1], c[2]] as Rgb));
    const roof = (env === "TOWN" || env === "ROUTE") ? p.roofs?.[Number(group) - 1]?.mornDay : undefined;
    const roofSlot = (p.roofSlot ?? 7) - 1;
    if (roof?.[0] && roof[1] && set[roofSlot]) set[roofSlot] = [set[roofSlot][0], [roof[0][0], roof[0][1], roof[0][2]], [roof[1][0], roof[1][1], roof[1][2]], set[roofSlot][3]];
    const darkFirst = set.map((pal) => [...pal].reverse());
    const per = (tileset.tilePalettes as number[] | undefined) ?? [];
    return (tile) => darkFirst[((per[tile] ?? 1) - 1) & 7] ?? MONO;
  },
  // sprites: the first daytime object palette (per-sprite palettes later)
  spriteColors(ctx) {
    const pal = palettes(ctx).objects?.[TIME]?.[0];
    return pal ? [...pal].reverse().map((c) => [c[0], c[1], c[2]] as Rgb) : MONO;
  },

  newMap() {
    throw new Error("Gen 2 maps can't be made in the studio yet");
  },

  content: [],
};
