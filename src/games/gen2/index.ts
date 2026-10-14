// Gold / Silver / Crystal: maps are view-only for now (ROADMAP Gen 2, step 1);
// Pokémon, moves, items, the type chart and audio are the registries Gold
// shares with Red (step 2). The data is gen1recomp's Gen 2 extraction (data/generated):
// maps with numeric NPC movement, bgEvents (signs) and coordEvents (step
// triggers) whose scripts are cart bytecode; tilesets with per-block
// collision quads and a palette slot per tile; colors per map environment
// and time of day (palettes.lua environments -> bg palettes).

import type { Rgb } from "../../render/color.ts";
import { MONO } from "../../render/color.ts";
import type { Direction, MapDef, SpriteDef, TilesetDef } from "../../core/types.ts";
import type { CellInfo, ConnectionRef, ContentSpec, Dataset, Facing, GameAdapter, GameContext, GlobalsSpec, ItemSpec, MoveSpec, PokemonSpec } from "../types.ts";

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

// ------------------------------------------------------------------ content

// gen1recomp src/mods/Schemas.lua gen2Fields: same registries as Gen 1, Gold's
// record shapes (Pokémon: levelMoves, evolutions `into`, the breeding block)
const content: ContentSpec[] = [
  {
    registry: "pokemon",
    file: "pokemon.lua",
    editable: true,
    build: records,
    fieldOrder: [
      "id", "name", "dex", "index", "types", "baseStats", "catchRate", "baseExp", "growthRate",
      "evolutions", "levelMoves", "eggMoves", "eggGroups", "eggSteps", "genderRatio", "items", "tmhm",
    ],
  },
  { registry: "moves", file: "moves.lua", editable: true, build: records, fieldOrder: ["id", "name", "index", "type", "power", "accuracy", "pp", "effect", "effectChance", "description"] },
  { registry: "items", file: "items.lua", editable: true, build: records, fieldOrder: ["id", "name", "index", "price", "pocket", "description"] },
  { registry: "type_chart", file: "type_chart.lua", editable: true, build: typeChartRecords },
  { registry: "map_songs", file: "audio.lua", editable: true, build: (f) => ((f as { mapSongs?: Record<string, unknown> }).mapSongs ?? {}) },
  { registry: "cries", file: "audio.lua", editable: true, replace: true, build: (f) => ((f as { cries?: Record<string, unknown> }).cries ?? {}) },
  { registry: "sfx", file: "audio.lua", editable: true, replace: true, build: (f) => ((f as { sfx?: Record<string, unknown> }).sfx ?? {}), fieldOrder: ["file"] },
  { registry: "music", file: "audio.lua", editable: true, replace: true, build: (f) => ((f as { songs?: Record<string, unknown> }).songs ?? {}), fieldOrder: ["file", "loopFile"] },
];

// the species/move/item records of a file: its other top-level keys
// (generation, source, pokemon.lua's growthRates and tmhmMoves) are not
// records (gen1recomp Schemas gen2BaseIds)
function records(file: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(file).filter(([, v]) => !!v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string"));
}

// type_chart.lua -> registry records: Gold ships its type records (gen1recomp
// Builtins seeds them from the file); the Foresight rows are matchups too
// (Game2 appends them before mods load)
function typeChartRecords(file: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const types = (file.types ?? {}) as Record<string, { name?: string; category?: string; index?: number }>;
  for (const [id, t] of Object.entries(types)) out[id] = { name: t.name ?? id, category: t.category ?? "physical", ...(t.index !== undefined ? { index: t.index } : {}) };
  type Row = { attacker: string; defender: string; multiplier: number };
  for (const r of [...(asList(file.matchups) as Row[]), ...(asList(file.foresightMatchups) as Row[])]) out[`${r.attacker}>${r.defender}`] = { multiplier: r.multiplier };
  return out;
}

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

// ------------------------------------------------------------------ pokemon

interface Icons {
  icons?: Record<string, { image?: string }>;
  species?: Record<string, string>;
}
const recordsOf = (ctx: GameContext, registry: string) =>
  (ctx.records[registry] ?? ctx.data.content[registry] ?? {}) as Record<string, Record<string, unknown>>;
const icons = (ctx: GameContext) => (ctx.data.extra.icons ?? {}) as Icons;

// constants/pokemon_data_constants.asm egg groups, nibble value = index + 1
const EGG_GROUPS = [
  "EGG_MONSTER", "EGG_WATER_1", "EGG_BUG", "EGG_FLYING", "EGG_GROUND", "EGG_FAIRY", "EGG_PLANT", "EGG_HUMANSHAPE",
  "EGG_WATER_3", "EGG_MINERAL", "EGG_INDETERMINATE", "EGG_WATER_2", "EGG_DITTO", "EGG_DRAGON", "EGG_NONE",
];

const pokemon: PokemonSpec = {
  stats: [
    { key: "hp", label: "HP" },
    { key: "attack", label: "Attack" },
    { key: "defense", label: "Defense" },
    { key: "speed", label: "Speed" },
    { key: "specialAttack", label: "Sp. Atk" },
    { key: "specialDefense", label: "Sp. Def" },
  ],
  maxTypes: 2,
  typesTwice: true,
  // type records in the game's order; the game's unused BIRD and Curse's
  // ??? (CURSE_TYPE) aren't types a Pokémon or move should get
  typeNames: (ctx) => {
    const all = recordsOf(ctx, "type_chart");
    const at = (id: string) => (typeof all[id].index === "number" ? (all[id].index as number) : 99);
    return Object.keys(all).filter((k) => !k.includes(">") && k !== "CURSE_TYPE" && k !== "BIRD")
      .sort((a, b) => at(a) - at(b) || a.localeCompare(b));
  },
  growthRates: (ctx) => (ctx.data.extra.growthRates as string[] | undefined) ?? [],
  keys: { levelMoves: "levelMoves", startMoves: null, evolveInto: "into", picSize: "picSize" },
  // gen1recomp src/core/gen2/Evolution.lua
  evolutionMethods: [
    { id: "EVOLVE_LEVEL", label: "Level", level: true },
    { id: "EVOLVE_ITEM", label: "Item", item: true },
    { id: "EVOLVE_TRADE", label: "Trade", item: "optional" },
    { id: "EVOLVE_HAPPINESS", label: "Happiness", time: ["ANYTIME", "MORNDAY", "NITE"] },
    {
      id: "EVOLVE_STAT", label: "Level + stats", level: true,
      comparison: [{ id: "ATK_LT_DEF", label: "Atk < Def" }, { id: "ATK_GT_DEF", label: "Atk > Def" }, { id: "ATK_EQ_DEF", label: "Atk = Def" }],
    },
  ],
  breeding: { eggGroups: EGG_GROUPS },
  heldItems: true,
  machines: (ctx) =>
    Object.values(recordsOf(ctx, "items"))
      .filter((i) => typeof i.teaches === "string" && typeof i.tmLabel === "string")
      .map((i) => ({ move: String(i.teaches), label: String(i.tmLabel) }))
      // TMs, then HMs, by number
      .sort((a, b) => Number(a.label.startsWith("HM")) - Number(b.label.startsWith("HM")) || a.label.localeCompare(b.label, undefined, { numeric: true })),
  moveNames: (ctx) => Object.keys(recordsOf(ctx, "moves")).sort(),
  itemNames: (ctx) => Object.keys(recordsOf(ctx, "items")).sort(),
  frontSprite: (r) => (typeof r.spriteFront === "string" ? r.spriteFront : undefined),
  backSprite: (r) => (typeof r.spriteBack === "string" ? r.spriteBack : undefined),
  frontSizes: [5, 6, 7],
  backSize: 48,
  backSizes: [48],
  // Gold's 48x48 back pics fill their box at 1x (docs/mod-api-gen2-compat.md)
  battleScale: { front: 1, back: 1, choices: [1, 1.5, 2] },
  // palettes.lua pokemon[id].normal: the two middle colors between white and black
  monColors: (ctx, id) => {
    const pair = (palettes(ctx) as { pokemon?: Record<string, { normal?: [number, number, number][] }> }).pokemon?.[id]?.normal;
    return pair?.length === 2 ? [[255, 255, 255], pair[0], pair[1], [0, 0, 0]].map((c) => [c[0], c[1], c[2]] as Rgb) : null;
  },
  // menu icons are the icons registry (species -> ICON_*): shown, not edited yet
  icon: {
    width: 16,
    height: 16,
    frames: 2,
    names: (ctx) => Object.keys(icons(ctx).icons ?? {}).sort(),
    path: (ctx, name) => icons(ctx).icons?.[name]?.image,
    resolve: (ctx, r) => {
      const name = typeof r.id === "string" ? icons(ctx).species?.[r.id] : undefined;
      return name ? { name } : {};
    },
  },
  without: ["newSpecies", "dexEntry", "cry", "iconImport"],
  // pokedex.lua newOrder: the Pokédex's New (Johto) mode
  regionalDex: { label: "Johto dex", order: (ctx) => (ctx.data.extra.johtoDex as string[] | undefined) ?? [] },
};

// ------------------------------------------------------------------ moves

const moves: MoveSpec = {
  registry: "moves",
  nameMax: 12,
  maxPp: 40,
  // EFFECT_* of the game's moves (behaviour lives in the engine)
  effects: (ctx) => [...new Set(Object.values(recordsOf(ctx, "moves")).map((m) => m.effect).filter((e): e is string => typeof e === "string"))].sort(),
  categories: [],
  battleDetails: false,
  effectChance: true,
  description: { lines: 2, lineMax: 18 },
  // gen1recomp Battle.lua reads accuracyRaw / effectChanceRaw first
  rawBytes: { accuracy: "accuracyRaw", effectChance: "effectChanceRaw" },
  newMoves: false,
};

// ------------------------------------------------------------------ items

const chance = (what: string) => ({ label: "Chance (of 256)", hint: `How often it ${what}: 256 = always, 30 ≈ 12%.`, max: 255 });
const HELD_INFO: Record<string, { note?: string; amount?: { label: string; hint: string; max: number } }> = {
  HELD_BERRY: { note: "Heals once the holder is below half HP, then is used up.", amount: { label: "HP healed", hint: "0 counts as 10.", max: 255 } },
  HELD_LEFTOVERS: { note: "Heals 1/16 of max HP every turn: a fixed amount (the game ignores the item's number)." },
  HELD_QUICK_CLAW: { note: "Sometimes lets the holder move first.", amount: chance("moves first") },
  HELD_FOCUS_BAND: { note: "Sometimes survives a hit that would knock it out, with 1 HP.", amount: chance("holds on") },
  HELD_FLINCH: { note: "The holder's hits sometimes make the target flinch (King's Rock).", amount: chance("makes the target flinch") },
  HELD_BRIGHTPOWDER: { note: "Lowers the accuracy of moves used on the holder.", amount: { label: "Accuracy cut (of 256)", hint: "Taken off the attacker's hit chance: 20 ≈ 8%.", max: 255 } },
  HELD_CRITICAL_UP: { note: "Raises the holder's critical-hit chance one step (Scope Lens)." },
};

// the effect's note, and what heldParameter means for it (type boosts: % more damage)
function heldInfo(effect: string): { note?: string; amount?: { label: string; hint: string; max: number } } {
  const boost = /^HELD_(\w+)_BOOST$/.exec(effect);
  if (boost) return { note: `Moves of the ${boost[1].toLowerCase()} type do more damage.`, amount: { label: "Damage boost %", hint: "10 = 10% more damage.", max: 255 } };
  return HELD_INFO[effect] ?? (effect === "HELD_NONE" ? {} : { note: "What it does is fixed in the game; it has no number to change." });
}

const items: ItemSpec = {
  registry: "items",
  nameMax: 12,
  maxPrice: 65535,
  // Gold's items act by id (engine code) and by held effect: no custom
  // effect blocks, balls or shops here yet
  effectRegistry: "studio_item_effects",
  stats: [],
  expStats: [],
  statuses: [],
  tossAnims: [],
  describe: () => "",
  template: () => null,
  special: () => false,
  // the cart's unused slots are all named TERU-SAMA (ITEM_19 ..., and Gold's
  // POKE_FLUTE / TOWN_MAP, which the Pokégear replaced)
  internal: (id, item) => (item?.name === "TERU-SAMA" || /^ITEM_[0-9A-F]{2}$/.test(id) ? "An unused item slot of the game (named TERU-SAMA)." : null),
  picksMove: () => false,
  marts: () => [],
  effects: false,
  newItems: false,
  // pocketId order (constants/item_constants.asm)
  pockets: ["ITEM", "KEY_ITEM", "BALL", "TM_HM"],
  description: { lines: 2, lineMax: 18 },
  // gen1recomp src/core/gen2/ItemEffects.lua HELD_*; which ones read
  // heldParameter: src/battle/gen2/Battle.lua (heldEffect callers)
  heldEffects: { ids: [
    "HELD_NONE", "HELD_BERRY", "HELD_LEFTOVERS", "HELD_RESTORE_PP", "HELD_HEAL_STATUS", "HELD_HEAL_SLEEP", "HELD_HEAL_POISON",
    "HELD_HEAL_PARALYZE", "HELD_HEAL_FREEZE", "HELD_HEAL_BURN", "HELD_HEAL_CONFUSION", "HELD_QUICK_CLAW", "HELD_FOCUS_BAND",
    "HELD_FLINCH", "HELD_CRITICAL_UP", "HELD_BRIGHTPOWDER", "HELD_METAL_POWDER", "HELD_ESCAPE", "HELD_CLEANSE_TAG",
    "HELD_AMULET_COIN", "HELD_NORMAL_BOOST", "HELD_FIGHTING_BOOST", "HELD_FLYING_BOOST", "HELD_POISON_BOOST",
    "HELD_GROUND_BOOST", "HELD_ROCK_BOOST", "HELD_BUG_BOOST", "HELD_GHOST_BOOST", "HELD_STEEL_BOOST", "HELD_FIRE_BOOST",
    "HELD_WATER_BOOST", "HELD_GRASS_BOOST", "HELD_ELECTRIC_BOOST", "HELD_PSYCHIC_BOOST", "HELD_ICE_BOOST",
    "HELD_DRAGON_BOOST", "HELD_DARK_BOOST",
  ], info: heldInfo },
  machineOf: (r) =>
    typeof r.teaches === "string" && typeof r.tmLabel === "string"
      ? { kind: r.tmLabel.slice(0, 2), move: r.teaches, number: Number(r.tmLabel.slice(2)) }
      : undefined,
  machineEdit: false,
};

// ------------------------------------------------------------------ global

const globals: GlobalsSpec = {
  sections: [
    { id: "types", group: "Game", label: "Type chart", hint: "Type effectiveness, and which types are physical or special (Gold decides by type, like Red)." },
    { id: "sounds", group: "Other", label: "Music & sounds", hint: "Your own songs and sound effects (sound files), and game songs or sounds replaced by files. A map's song is picked in its properties." },
  ],
  numbers: [],
  defaults: {},
  typeChart: {
    registry: "type_chart",
    multipliers: [
      { value: 0, label: "0×" },
      { value: 5, label: "½×" },
      { value: 10, label: "1×" },
      { value: 20, label: "2×" },
    ],
    categories: ["physical", "special"],
  },
};

export const gen2: GameAdapter = {
  id: "gen2",
  name: "Gen 2",
  manifestGame: "gen2",
  startMap: "NEW_BARK_TOWN",
  viewOnly: { registries: ["maps", "tilesets", "sprites"], reason: "Gen 2 maps can be looked at, not changed yet." },
  workspaces: ["maps", "pokemon", "moves", "items", "global"],
  playFromHere: false,

  async load(read): Promise<Dataset> {
    const [maps, tilesets, sprites, pal, roofs, initial, constants, ...tables] = await Promise.all([
      read("maps.lua") as Promise<Record<string, MapDef>>,
      read("tilesets.lua") as Promise<Record<string, TilesetDef>>,
      read("sprites.lua") as Promise<Record<string, SpriteDef>>,
      read("palettes.lua") as Promise<Palettes>,
      read("roofs.lua") as Promise<Roofs>,
      read("initial_events.lua") as Promise<{ sprites?: { slot: number; sprite: number }[] }>,
      read("constants.lua") as Promise<{ spriteOrder?: string[] }>,
      ...content.map((c) => (c.file ? (read(c.file) as Promise<Record<string, unknown>>) : Promise.resolve({}))),
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
    const monFile = tables[content.findIndex((c) => c.registry === "pokemon")] as { growthRates?: Record<string, unknown> } | undefined;
    const icons = await (read("icons.lua") as Promise<Icons>).catch(() => ({}) as Icons);
    const pokedex = await (read("pokedex.lua") as Promise<{ newOrder?: string[] }>).catch(() => ({}) as { newOrder?: string[] });
    const contentTables: Dataset["content"] = {};
    content.forEach((c, i) => (contentTables[c.registry] = c.build ? c.build(tables[i] ?? {}) : tables[i] ?? {}));
    contentTables.tilesets = { ...tilesets };
    contentTables.sprites = { ...sprites };
    return { maps, tilesets, sprites, content: contentTables, extra: { palettes: pal, roofs, growthRates: Object.keys(monFile?.growthRates ?? {}), icons, johtoDex: asList(pokedex.newOrder) } };
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

  content,
  pokemon,
  moves,
  items,
  globals,
};
