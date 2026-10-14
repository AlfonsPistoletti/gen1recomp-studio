// Gold / Silver / Crystal: a read-only map viewer for now (ROADMAP Gen 2,
// step 1). The data is gen1recomp's Gen 2 extraction (data/generated):
// maps with numeric NPC movement, bgEvents (signs) and coordEvents (step
// triggers) whose scripts are cart bytecode; tilesets with per-block
// collision quads and a palette slot per tile; colors per map environment
// and time of day (palettes.lua environments -> bg palettes).

import type { Rgb } from "../../render/color.ts";
import { MONO } from "../../render/color.ts";
import type { Direction, MapDef, SpriteDef, TilesetDef } from "../../core/types.ts";
import type { CellInfo, ConnectionRef, Dataset, Facing, GameAdapter, GameContext } from "../types.ts";

// roofs.lua: which roof tiles each map group draws
interface Roofs {
  mapGroupRoofs?: Record<string, string>;
  roofs?: Record<string, { image?: string }>;
}

interface Palettes {
  bg?: [number, number, number][][];
  environments?: Record<string, Record<string, number[]>>;
  objects?: Record<string, [number, number, number][][]>;
  // keyed by map group from 0 (Lua [0]..): an array or an object
  roofs?: Record<string, { mornDay?: [number, number, number][]; nite?: [number, number, number][] }>;
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
// variable sprite slots (see load): the new game's sprite per slot, the one
// other maps' scripts give it later, and the slots each map's scripts set
const variableSprites = { start: new Map<number, string>(), later: new Map<number, string>(), own: new Map<string, Set<number>>() };

// first facing per movement (gen1recomp src/world/gen2/Npc.lua FACING_FROM_MOVE;
// the rest face down) and the movements that walk around
const FACING: Record<number, Facing> = { 5: "left", 7: "up", 8: "left", 9: "right", 0x1e: "left", 0x1f: "right" };
const WALKS = new Set([2, 4, 5, 0x24]);

// PAL_OW_* in order (constants/sprite_data_constants.asm)
const OW_PALETTES = ["RED", "BLUE", "GREEN", "BROWN", "PINK", "EMOTE", "TREE", "ROCK"];
// the map view shows the day colors
const TIME = "DAY";
const asList = (v: unknown) => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : []);

// Crystal tilesets carry GBC attributes per tile id (`tileAttrs`, 1-based
// keys: palette slot and VRAM bank) and a 256-tile sheet (bank 0 at 0-127,
// bank 1 at 128-255). Restates gen1recomp src/world/gen2/MapAttrGrid.lua
// normalizeTile: a block's raw id (bit 7 = bank) -> its attrs -> the sheet
// tile it draws and that tile's palette. Blocks are rewritten to sheet tiles
// and tilePalettes to the palette per sheet tile, which is what the view
// reads (Gold keeps its own tilePalettes and raw ids).
// shortcut: one palette per sheet tile (two raw ids on the same sheet tile with different palettes keep the last); per-tile flips aren't drawn (Crystal's data has none)
function crystalTiles(t: TilesetDef): void {
  const attrs = t.tileAttrs as Record<string, { palette?: number; vramBank?: number }> | undefined;
  if (!attrs || typeof attrs !== "object") return;
  const at = (i: number) => attrs[String(i + 1)];
  const pals = t.tilePalettes as Record<string, number> | number[] | undefined;
  const palOf = (i: number) => (Array.isArray(pals) ? pals[i] : pals?.[String(i + 1)]) ?? 1;
  const out: number[] = [];
  t.blocks = t.blocks.map((b) => b.map((raw) => {
    const norm = raw % 0x80;
    const bank = raw >= 0x80 ? 1 : 0;
    const a = bank ? at(0x80 + norm) ?? at(norm) : at(norm) ?? at(0x80 + norm);
    const vram = a?.vramBank ? a.vramBank : bank;
    const sheet = vram === 1 ? 0x80 + norm : norm;
    out[sheet] = a?.palette ?? palOf(raw);
    return sheet;
  }));
  t.tilePalettes = Array.from(out, (p) => p ?? 1);
}

export const gen2: GameAdapter = {
  id: "gen2",
  name: "Gen 2",
  manifestGame: "gen2",
  startMap: "NEW_BARK_TOWN",
  readOnly: "Gen 2 is view-only in the studio for now: maps can be looked at, not changed or saved.",
  workspaces: ["maps"],

  async load(read): Promise<Dataset> {
    const [maps, tilesets, sprites, pal, roofs, initial, constants] = await Promise.all([
      read("maps.lua") as Promise<Record<string, MapDef>>,
      read("tilesets.lua") as Promise<Record<string, TilesetDef>>,
      read("sprites.lua") as Promise<Record<string, SpriteDef>>,
      read("palettes.lua") as Promise<Palettes>,
      read("roofs.lua") as Promise<Roofs>,
      read("initial_events.lua") as Promise<{ sprites?: { slot: number; sprite: number }[] }>,
      read("constants.lua") as Promise<{ spriteOrder?: string[] }>,
    ]);
    const scripts = ((await read("scripts.lua").catch(() => null)) ?? {}) as Record<string, unknown>;
    // gen1recomp World:resolveSprite: object sprite $F0+slot = the slot's
    // sprite (a new game's: initial_events.lua sprites) by number in
    // constants.spriteOrder (1-based); `variablesprite` script rows change it
    const order = asList(constants.spriteOrder) as string[];
    const name = (byte: number) => order[byte - 1];
    variableSprites.start.clear();
    variableSprites.later.clear();
    variableSprites.own.clear();
    for (const row of asList(initial.sprites) as { slot: number; sprite: number }[]) {
      if (name(row.sprite)) variableSprites.start.set(row.slot, name(row.sprite));
    }
    // the slots each map's own scripts set (followed through calls/jumps), and
    // a value other maps' scripts give a slot: the Olivine rival's slot holds a
    // swimmer once the rival has left, which is what Route 41 shows in play
    const slotsSetFrom = (roots: string[]): Set<number> => {
      const seen = new Set<string>();
      const slots = new Set<number>();
      const walk = (v: unknown): void => {
        if (typeof v === "string") {
          if (v in scripts && !seen.has(v)) {
            seen.add(v);
            walk(scripts[v]);
          }
        } else if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === "object") {
          const row = v as { op?: string; args?: unknown };
          const args = asList(row.args) as number[];
          if (row.op === "variablesprite" && typeof args[0] === "number") {
            slots.add(args[0]);
            const later = name(args[1]);
            if (later && later !== variableSprites.start.get(args[0]) && !variableSprites.later.has(args[0])) {
              variableSprites.later.set(args[0], later);
            }
          }
          Object.values(v).forEach(walk);
        }
      };
      roots.forEach(walk);
      return slots;
    };
    for (const [id, m] of Object.entries(maps)) {
      const keys: string[] = [];
      JSON.stringify(m, (_k, v: unknown) => (typeof v === "string" && v in scripts && keys.push(v), v));
      const slots = slotsSetFrom(keys);
      if (slots.size) variableSprites.own.set(id, slots);
    }
    for (const m of Object.values(maps)) gen2.normalizeMap(m);
    for (const t of Object.values(tilesets)) crystalTiles(t);
    return { maps, tilesets, sprites, content: { tilesets: { ...tilesets }, sprites: { ...sprites } }, extra: { palettes: pal, roofs } };
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
      // a number is a variable sprite (shown as a new game starts it); the
      // Day-Care Pokémon ($E0/$E1) depend on the save: a marker
      sprite: (o, mapId) => {
        const slot = Number(o.sprite) - 0xf0;
        // the new game's sprite, unless the object is always there (no event
        // flag) on a map whose scripts don't set the slot: then as other maps'
        // scripts leave it (Azalea's rockets are flagged and stay rockets)
        const v = variableSprites;
        const always = o.eventFlag === undefined || o.eventFlag === -1 || o.eventFlag === 0xffff;
        const id = typeof o.sprite === "string" ? o.sprite
          : (always && !v.own.get(mapId)?.has(slot) ? v.later.get(slot) : undefined) ?? v.start.get(slot);
        const move = Number(o.movement);
        return id ? { sprite: id, facing: FACING[move] ?? "down", ghost: false, moving: WALKS.has(move) } : null;
      },
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
  tileColors(ctx, tileset, key) {
    const p = palettes(ctx);
    const [env, group] = key.split("|");
    const row = p.environments?.[env] ?? p.environments?.TOWN;
    const ids = row?.[TIME] ?? row?.DAY ?? [];
    const set = Array.from({ length: 8 }, (_, slot) => (p.bg?.[(ids[slot] ?? 1) - 1] ?? MONO).map((c) => [c[0], c[1], c[2]] as Rgb));
    const roof = (env === "TOWN" || env === "ROUTE") ? p.roofs?.[group]?.mornDay : undefined;
    const roofSlot = (p.roofSlot ?? 7) - 1;
    if (roof?.[0] && roof[1] && set[roofSlot]) set[roofSlot] = [set[roofSlot][0], [roof[0][0], roof[0][1], roof[0][2]], [roof[1][0], roof[1][1], roof[1][2]], set[roofSlot][3]];
    const darkFirst = set.map((pal) => [...pal].reverse());
    const per = (tileset.tilePalettes as number[] | undefined) ?? [];
    return (tile) => darkFirst[((per[tile] ?? 1) - 1) & 7] ?? MONO;
  },
  // the map group's roof tiles over sheet tiles $0A-$12 (gen1recomp
  // World.applyRoofOverlay; roofs.lua mapGroupRoofs)
  // only on the outdoor Johto tilesets (World.lua ROOF_TILESETS): elsewhere
  // those tile ids are floors, counters, ...
  sheetOverlay(ctx, tilesetId, key) {
    if (tilesetId !== "TILESET_JOHTO" && tilesetId !== "TILESET_JOHTO_MODERN") return null;
    const roofs = ctx.data.extra.roofs as Roofs | undefined;
    const name = roofs?.mapGroupRoofs?.[key.split("|")[1]];
    const image = name ? roofs?.roofs?.[name]?.image : undefined;
    return image ? { image, first: 0x0a, count: 9 } : null;
  },
  // gen1recomp src/world/gen2/Palettes.lua spritePalette: the object's own
  // palette when it sets one (its low three bits), else the sprite's
  // (paletteId, or its PAL_OW_* name); one of the daytime's 8 OBJ palettes
  spriteColors(ctx, _key, sprite, entity) {
    const set = palettes(ctx).objects?.[TIME];
    const own = typeof entity?.palette === "number" && entity.palette !== 0 ? entity.palette % 8 : undefined;
    const byName = typeof sprite?.palette === "string" ? OW_PALETTES.indexOf(sprite.palette.replace(/^PAL_OW_/, "")) : -1;
    const id = own ?? (typeof sprite?.paletteId === "number" ? sprite.paletteId : Math.max(0, byName));
    const pal = set?.[id] ?? set?.[0];
    return pal ? [...pal].reverse().map((c) => [c[0], c[1], c[2]] as Rgb) : MONO;
  },

  newMap() {
    throw new Error("Gen 2 maps can't be made in the studio yet");
  },

  content: [],
};
