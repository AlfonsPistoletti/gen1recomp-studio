// Gold / Silver / Crystal: maps are view-only for now (ROADMAP Gen 2, step 1);
// Pokémon, moves, items, the type chart and audio are the registries Gold
// shares with Red (step 2). The data is gen1recomp's Gen 2 extraction (data/generated):
// maps with numeric NPC movement, bgEvents (signs) and coordEvents (step
// triggers) whose scripts are cart bytecode; tilesets with per-block
// collision quads and a palette slot per tile; colors per map environment
// and time of day (palettes.lua environments -> bg palettes).

import type { Rgb } from "../../render/color.ts";
import { MONO } from "../../render/color.ts";
import { TILESET_RUNTIME2, tilesetRegistration2 } from "../../lua/tilesetRuntime2.ts";
import type { Direction, MapDef, SpriteDef, TilesetDef } from "../../core/types.ts";
import type { CellInfo, ConnectionRef, ContentSpec, Dataset, Facing, FieldSpec, GameAdapter, GameContext, GlobalsSpec, ItemSpec, MoveSpec, PokemonSpec, TimedEncounterSpec, TrainerSlot, TrainerSpec } from "../types.ts";

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

// ------------------------------------------------------------------ map editing

// constants/map_data_constants.asm environments
const ENVIRONMENTS = ["TOWN", "ROUTE", "INDOOR", "CAVE", "ENVIRONMENT_5", "GATE", "DUNGEON"];

// SPRITEMOVEDATA_* (gen1recomp src/world/gen2/Npc.lua MOVE)
const MOVEMENTS: Record<number, string> = {
  1: "Still (fixed facing)", 2: "Wanders", 3: "Turns around (slow)", 4: "Walks up and down", 5: "Walks left and right",
  6: "Stands, facing down", 7: "Stands, facing up", 8: "Stands, facing left", 9: "Stands, facing right",
  10: "Turns around (fast)", 0x16: "Pokémon (fixed)", 0x1e: "Spins counterclockwise", 0x1f: "Spins clockwise",
  0x24: "Swims around",
};

// a script pointer picked from the same kind of entity on the open map: the
// studio can't write cart scripts, so a new person says what another one says
function scriptField(layer: string, label: string, hint: string): FieldSpec {
  const list = (map?: MapDef) => asList(map?.[layer]) as Record<string, unknown>[];
  return {
    kind: "select", key: "scriptKey", label, hint, emptyLabel: "Nothing (no script)",
    options: (_ctx, map) => [...new Set(list(map).map((e) => e.scriptKey).filter((k): k is string => typeof k === "string"))],
    labels: (v, _ctx, map) => {
      const users = list(map).map((e, i) => ({ e, i })).filter(({ e }) => e.scriptKey === v);
      const first = users[0];
      // "YOUNGSTER 3" for a person, "#2" for a sign or trigger
      const who = !first ? "" : layer === "objects" ? `${String(first.e.sprite ?? "?").replace(/^SPRITE_/, "")} ${first.i + 1}` : `#${first.i + 1}`;
      return `${who}'s script${users.length > 1 ? ` (also ${users.length - 1} more)` : ""}`;
    },
  };
}

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
  // script text by key ("55:515e"); new keys (a studio trainer's texts) work too
  { registry: "text", file: "text.lua", editable: true, build: (f) => Object.fromEntries(Object.entries(f).filter(([, v]) => typeof v === "string")) },
  // palettes.lua subtables are the registry's ids (trainers, pokemon, ...);
  // the studio edits trainers (a new class's portrait colors)
  { registry: "palettes", file: "palettes.lua", editable: true, build: (f) => Object.fromEntries(Object.entries(f).filter(([k, v]) => k === "trainers" && !!v && typeof v === "object")) },
  // blocks (and their collision quads) added to the game's tilesets: plain
  // data in studio_tilesets.lua, patched in by the generated helper
  {
    registry: "studio_tilesets", editable: true, build: () => ({}), studioFile: "studio_tilesets.lua",
    generator: { what: "tileset extensions", order: ["first", "tiles", "palettes", "blocks", "collision"], runtime: TILESET_RUNTIME2, registration: tilesetRegistration2, writes: ["tilesets"] },
  },
  // trainer classes (gen1recomp writes the registry one level into `classes`)
  {
    registry: "trainers", file: "trainers.lua", editable: true,
    build: (f) => ({ ...((f as { classes?: Record<string, unknown> }).classes ?? {}) }),
    fieldOrder: ["id", "name", "index", "baseMoney", "encounterMusic", "pic", "items", "attributes", "trainers"],
  },
  // ids are kinds (grass, water, fishGroups, ...), each holding every map or
  // group; only the edited entries are written (gen1recomp Schemas gen2Keys)
  { registry: "encounters", file: "encounters.lua", editable: true, build: (f) => Object.fromEntries(Object.entries(f).filter(([, v]) => !!v && typeof v === "object")) },
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
// event flags the game's data uses (see load)
const usedFlags = new Set<number>();
// constants/event_flags.asm: NUM_EVENTS = $800 (gen1recomp Save.EVENT_BYTES)
const NUM_EVENTS = 0x800;

// "<class index>:<member>" -> where a script starts that battle (see load)
const scriptFights = new Map<string, { mapId: string; index: number }[]>();

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
  without: ["newSpecies", "cry", "iconImport"],
  // gen1recomp PokedexText.apply copies pokemon.dexEntry onto pokedex.lua's entry
  dexInline: { lines: 3, lineMax: 18 },
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

// ------------------------------------------------------------------ encounters

// gen1recomp src/battle/gen2/Encounter.lua: slot chances (% of 100), and the
// cells that roll (FieldMoves.canEncounterWildMon: tall/long grass and water
// collision; every walkable cell in a CAVE or DUNGEON)
const ENCOUNTER_COLL = new Set([0x08, 0x14, 0x18, 0x28, 0x48, 0x49, 0x4a, 0x4b]);
const timedEncounters: TimedEncounterSpec = {
  registry: "encounters",
  times: [{ key: "MORN", label: "Morning" }, { key: "DAY", label: "Day" }, { key: "NITE", label: "Night" }],
  grassOdds: [30, 30, 20, 10, 5, 4, 1],
  waterOdds: [60, 30, 10],
  fish: { mapKey: "fishGroup", kind: "fishGroups", rods: [{ key: "old", label: "Old Rod" }, { key: "good", label: "Good Rod" }, { key: "super", label: "Super Rod" }] },
  wildCell(map, tileset, cx, cy) {
    const id = map.blocks[Math.floor(cy / 2) * map.width + Math.floor(cx / 2)] ?? 0;
    const quad = (tileset?.collision as number[][] | undefined)?.[id];
    const coll = !quad ? -1 : quad[(cy % 2) * 2 + (cx % 2)] ?? -1;
    if (coll < 0) return null;
    if (COLL_PERMISSIONS[coll % 256] === 1) return "water";
    if (ENCOUNTER_COLL.has(coll)) return "grass";
    const env = String(map.environment ?? "");
    return (env === "CAVE" || env === "DUNGEON") && COLL_PERMISSIONS[coll % 256] === 0 ? "any" : null;
  },
};

// ------------------------------------------------------------------ trainers

// a class's trainers as teams: [{ id, name, trainerType, party }]; the type
// says which optional party fields the cart stores, so it follows the slots
type Gen2Trainer = { name?: string; trainerType?: string; party?: TrainerSlot[] } & Record<string, unknown>;
const classTrainers = (r: Record<string, unknown>) => asList(r.trainers) as Gen2Trainer[];
function trainerType(slots: TrainerSlot[]): string {
  const item = slots.some((m) => m.item);
  const moves = slots.some((m) => Array.isArray(m.moves));
  return item && moves ? "TRAINERTYPE_ITEM_MOVES" : item ? "TRAINERTYPE_ITEM" : moves ? "TRAINERTYPE_MOVES" : "TRAINERTYPE_NORMAL";
}

const trainers: TrainerSpec = {
  registry: "trainers",
  picSize: 56,
  maxPartySize: 6,
  nameMax: 10,
  // the class's own pic, else menu_gfx battleHud.trainerPics (BattleState)
  pic: (id, ctx) => {
    const own = recordsOf(ctx, "trainers")[id]?.pic;
    return typeof own === "string" ? own : (ctx.data.extra.trainerPics as Record<string, string> | undefined)?.[id];
  },
  // gen1recomp Mon.movesAtLevel: the last four distinct level-up moves
  defaultMoves: (_t, _p, i, party, ctx) => {
    const slot = party[i];
    const known: string[] = [];
    for (const e of asList(recordsOf(ctx, "pokemon")[slot.species]?.levelMoves) as { level: number; move: string }[]) {
      if (e.level > slot.level || known.includes(e.move)) continue;
      known.push(e.move);
      if (known.length > 4) known.shift();
    }
    return known;
  },
  objectClassKey: "trainerClass",
  objectPartyKey: "trainerParty",
  aiLayers: [],
  notes: () => [],
  teams: {
    read: (r) => classTrainers(r).map((t) => asList(t.party) as TrainerSlot[]),
    write: (d, parties) => {
      const old = classTrainers(d);
      // a new trainer gets the next member number (its index)
      d.trainers = parties.map((slots, i) => ({ ...(old[i] ?? { id: `TRAINER_${i + 1}`, name: "TRAINER", index: i + 1 }), party: slots, trainerType: trainerType(slots) }));
    },
    name: (r, p) => String(classTrainers(r)[p]?.name ?? ""),
    setName: (d, p, name) => {
      d.trainers = classTrainers(d).map((t, i) => (i === p ? { ...t, name: name || String(t.name ?? "") } : t));
    },
  },
  heldItems: true,
  // gen1recomp Schemas gen2Fields: a class's `index` and a trainer's are bytes
  limits: { classIndex: 255, teams: 255 },
  classPrefix: "",
  // its portrait colors (palettes.lua trainers[class]) go with a copied class
  classExtras: (sourceId, newId, ctx) => {
    const table = recordsOf(ctx, "palettes").trainers as Record<string, unknown> | undefined;
    const colors = table?.[sourceId];
    return colors && table ? [{ registry: "palettes", id: "trainers", value: { ...table, [newId]: structuredClone(colors) } }] : [];
  },
  objectTrainer: {
    key: "trainer",
    // OBJECTTYPE_TRAINER (constants/map_object_constants.asm)
    typeKey: "type",
    typeValue: 2,
    sightKey: "sight",
    textRegistry: "text",
    classIndex: (ctx, id) => {
      const i = recordsOf(ctx, "trainers")[id]?.index;
      return typeof i === "number" ? i : undefined;
    },
    classOf: (ctx, index) => Object.entries(recordsOf(ctx, "trainers")).find(([, r]) => r.index === index)?.[0],
    // from the top of the flag array down: past every flag the game uses
    freeFlag: (ctx) => {
      const taken = new Set(usedFlags);
      for (const m of Object.values(ctx.maps)) {
        for (const o of asList(m.objects) as { eventFlag?: number; trainer?: { event?: number } }[]) {
          if (typeof o.trainer?.event === "number") taken.add(o.trainer.event);
          if (typeof o.eventFlag === "number") taken.add(o.eventFlag);
        }
      }
      for (let f = NUM_EVENTS - 1; f > Math.max(0, ...usedFlags); f--) if (!taken.has(f)) return f;
      return null;
    },
    afterScripts: (map) => {
      const seen = new Map<string, string>();
      for (const o of asList(map.objects) as { sprite?: unknown; trainer?: { scriptKey?: string } }[]) {
        const k = o.trainer?.scriptKey;
        if (k && !seen.has(k)) seen.set(k, `Same as ${String(o.sprite ?? "").replace(/^SPRITE_/, "")} (${k})`);
      }
      return [...seen].map(([key, label]) => ({ key, label }));
    },
  },
  // map objects that are trainers (their `trainer` = { class, member }: the
  // class's index and the 1-based trainer), and the battles scripts start
  uses: (ctx, classId) => {
    const out = new Map<number, { mapId: string; index: number }[]>();
    const cls = recordsOf(ctx, "trainers")[classId]?.index;
    if (typeof cls !== "number") return out;
    const add = (member: number, at: { mapId: string; index: number }) => {
      const list = out.get(member) ?? [];
      if (!list.some((u) => u.mapId === at.mapId && u.index === at.index)) list.push(at);
      out.set(member, list);
    };
    for (const [mapId, m] of Object.entries(ctx.maps)) {
      (asList(m.objects) as { trainer?: { class?: number; member?: number } }[]).forEach((o, index) => {
        if (o.trainer?.class === cls) add(o.trainer.member ?? 1, { mapId, index });
      });
    }
    for (const [key, list] of scriptFights) {
      const [c, member] = key.split(":").map(Number);
      if (c === cls) for (const at of list) add(member, at);
    }
    return out;
  },
  // palettes.lua trainers[class]: the two middle colors between white and black
  picColors: (ctx, classId) => {
    // the palettes registry (a mod's new class has its own entry), else the file's
    const own = recordsOf(ctx, "palettes").trainers as Record<string, [number, number, number][]> | undefined;
    const pair = own?.[classId] ?? (palettes(ctx) as { trainers?: Record<string, [number, number, number][]> }).trainers?.[classId];
    return pair?.length === 2 ? [[255, 255, 255], pair[0], pair[1], [0, 0, 0]].map((c) => [c[0], c[1], c[2]] as Rgb) : null;
  },
  ai: false,
  colors: false,
  basePic: false,
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
  viewOnly: { registries: ["tilesets", "sprites"], reason: "Gen 2 tilesets and sprites can be looked at, not changed yet." },
  workspaces: ["maps", "pokemon", "moves", "items", "trainers", "graphics", "global"],
  graphicsViews: ["tilesets"],
  // pokecrystal constants/collision_constants.asm (the codes a block's quarter
  // takes); walk/water/wall from gen1recomp's CollPermissions table
  tileCollision: {
    // pure: release builds (no Gen 2) drop it
    codes: /* @__PURE__ */ ([
      [0x00, "floor"], [0x07, "wall"], [0x18, "tall grass"], [0x14, "long grass"], [0x12, "cut tree"], [0x15, "headbutt tree"],
      [0x29, "water"], [0x24, "whirlpool"], [0x33, "waterfall"], [0x23, "ice"], [0x60, "pit (hole)"],
      [0x71, "door"], [0x7a, "stairs"], [0x7b, "cave"], [0x72, "ladder"], [0x7c, "warp panel"],
      [0x70, "warp mat ↓"], [0x76, "warp mat ←"], [0x78, "warp mat ↑"], [0x7e, "warp mat →"],
      [0xa0, "ledge →"], [0xa1, "ledge ←"], [0xa2, "ledge ↑"], [0xa3, "ledge ↓"],
      [0xa4, "ledge ↘"], [0xa5, "ledge ↙"], [0xa6, "ledge ↗"], [0xa7, "ledge ↖"],
      [0x90, "counter"], [0x91, "bookshelf"], [0x93, "PC"], [0x94, "radio"], [0x95, "town map"], [0x96, "mart shelf"], [0x97, "TV"],
      [0x9d, "window"], [0x9f, "incense burner"],
    ] as [number, string][]).map(([code, label]) => ({ code, label })),
    permission: (code) => COLL_PERMISSIONS[code % 256] ?? 15,
    // PAL_BG_* (constants/tileset_constants.asm), tilePalettes is 1-based
    paletteSlots: ["Gray", "Red", "Green", "Water", "Yellow", "Brown", "Roof", "Text"],
    defaultSlot: 1,
  },
  playFromHere: false,

  async load(read, version): Promise<Dataset> {
    // Crystal's blocks are rewritten to sheet tiles below (crystalTiles), so
    // an extension made on them couldn't be patched back: its tilesets stay
    // view-only (Gold/Silver get blocks and the tile brush)
    gen2.viewOnly = version === "crystal"
      ? { registries: ["tilesets", "sprites", "studio_tilesets"], reason: "Crystal's tilesets can be looked at, not changed yet." }
      : { registries: ["sprites"], reason: "Gen 2 sprites can be looked at, not changed yet." };
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
    // (the same walk notes `loadtrainer class, member` rows: who fights whom)
    let fights: string[] = [];
    const slotsSetFrom = (roots: string[]): Set<number> => {
      const seen = new Set<string>();
      const slots = new Set<number>();
      fights = [];
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
          const t = v as { class?: number; member?: number };
          if (row.op === "loadtrainer" && typeof t.class === "number") fights.push(`${t.class}:${t.member ?? 1}`);
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
    scriptFights.clear();
    // every event flag the game's data names (map people, scripts, new-game
    // flags): a studio trainer's "beaten" flag must be none of them
    usedFlags.clear();
    for (const src of [maps, scripts, initial]) {
      JSON.stringify(src, (k, v: unknown) => {
        if ((k === "event" || k === "eventFlag" || k === "flag") && typeof v === "number" && v < 0xffff) usedFlags.add(v);
        return v;
      });
    }
    const fight = (key: string, at: { mapId: string; index: number }) => {
      const list = scriptFights.get(key) ?? [];
      if (!list.some((u) => u.mapId === at.mapId && u.index === at.index)) list.push(at);
      scriptFights.set(key, list);
    };
    for (const [id, m] of Object.entries(maps)) {
      const keys: string[] = [];
      JSON.stringify(m, (_k, v: unknown) => (typeof v === "string" && v in scripts && keys.push(v), v));
      const slots = slotsSetFrom(keys);
      if (slots.size) variableSprites.own.set(id, slots);
      // battles an object's own script starts (gym leaders, ...) belong to it;
      // the rest to the map (step triggers, scenes)
      const objectKeys = new Set<string>();
      (asList(m.objects) as Record<string, unknown>[]).forEach((o, i) => {
        const own: string[] = [];
        JSON.stringify(o, (_k, v: unknown) => (typeof v === "string" && v in scripts && own.push(v), v));
        own.forEach((k) => objectKeys.add(k));
        slotsSetFrom(own);
        for (const f of fights) fight(f, { mapId: id, index: i });
      });
      slotsSetFrom(keys.filter((k) => !objectKeys.has(k)));
      for (const f of fights) fight(f, { mapId: id, index: -1 });
    }
    for (const m of Object.values(maps)) gen2.normalizeMap(m);
    // tilesets.lua also holds the animation frame sheets (animFrames,
    // waterFrames, ...): only records with a sheet and blocks are tilesets
    for (const [k, t] of Object.entries(tilesets)) if (!t || typeof t !== "object" || typeof t.image !== "string" || !t.blocks) delete tilesets[k];
    for (const t of Object.values(tilesets)) crystalTiles(t);
    const monFile = tables[content.findIndex((c) => c.registry === "pokemon")] as { growthRates?: Record<string, unknown> } | undefined;
    const icons = await (read("icons.lua") as Promise<Icons>).catch(() => ({}) as Icons);
    const menuGfx = await (read("menu_gfx.lua") as Promise<{ battleHud?: { trainerPics?: Record<string, string> } }>).catch(() => ({}) as { battleHud?: { trainerPics?: Record<string, string> } });
    type Dex = { newOrder?: string[]; entries?: Record<string, { kind?: string; height?: number; weight?: number; text?: string; text2?: string }> };
    const pokedex = await (read("pokedex.lua") as Promise<Dex>).catch(() => ({}) as Dex);
    const contentTables: Dataset["content"] = {};
    content.forEach((c, i) => (contentTables[c.registry] = c.build ? c.build(tables[i] ?? {}) : tables[i] ?? {}));
    // the Pokédex entries (pokedex.lua) as each species' dexEntry, so an
    // edit is saved as a patch of what changed (gen1recomp PokedexText)
    for (const [sp, e] of Object.entries(pokedex.entries ?? {})) {
      const rec = contentTables.pokemon?.[sp] as Record<string, unknown> | undefined;
      if (rec) rec.dexEntry = { kind: e.kind ?? "", height: e.height ?? 0, weight: e.weight ?? 0, text: e.text ?? "", text2: e.text2 ?? "" };
    }
    contentTables.tilesets = { ...tilesets };
    contentTables.sprites = { ...sprites };
    return { maps, tilesets, sprites, content: contentTables, extra: { palettes: pal, roofs, growthRates: Object.keys(monFile?.growthRates ?? {}), icons, johtoDex: asList(pokedex.newOrder), trainerPics: menuGfx.battleHud?.trainerPics ?? {} } };
  },

  // Empty Lua tables arrive as []; the lists the view reads become arrays
  // also drops what the engine never reads (World:resolveWarp and the
  // connection code use destMap/destWarp and mapId/offset only), so edits
  // don't leave the extractor's map-group numbers stale
  normalizeMap(map) {
    const m = map as Record<string, unknown>;
    const conns = !m.connections || Array.isArray(m.connections) ? {} : (m.connections as Record<string, { mapId?: string; offset?: number }>);
    m.connections = Object.fromEntries(Object.entries(conns).filter(([, c]) => c?.mapId).map(([dir, c]) => [dir, { mapId: c.mapId, offset: c.offset ?? 0 }]));
    for (const key of ["warps", "objects", "bgEvents", "coordEvents"]) m[key] = asList(m[key]);
    for (const w of m.warps as Record<string, unknown>[]) {
      delete w.destGroup;
      delete w.destMapNum;
    }
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
      fields: [{
        kind: "warpTarget", label: "Destination", mapKey: "destMap", warpKey: "destWarp", specialMaps: [], backWarp: 255,
        hint: "Back where the player came from: rooms reached from several doors (Pokémon Center 2F, elevators) lead back this way.",
      }],
      // a new door leads back the way the player came until it's connected
      create: (map, x, y) => ({ x, y, destMap: map.id, destWarp: 255 }),
    },
    {
      key: "objects",
      kind: "npc",
      label: "Objects",
      singular: "NPC / object",
      color: "#3cc8e6",
      fields: [
        { kind: "select", key: "sprite", label: "Sprite", options: (ctx) => Object.keys(ctx.data.sprites).sort(), labels: (v) => (/^\d+$/.test(v) ? `Changes during the game (${v})` : undefined) },
        { kind: "select", key: "movement", label: "Movement", numeric: true, options: () => Object.keys(MOVEMENTS), labels: (v) => MOVEMENTS[Number(v)] },
        {
          kind: "pair",
          fields: [
            { kind: "int", key: "radius.x", label: "Walk range ←→", min: 0, max: 15, hint: "Cells it may wander from its spot" },
            { kind: "int", key: "radius.y", label: "Walk range ↑↓", min: 0, max: 15 },
          ],
        },
        {
          kind: "pair",
          fields: [
            { kind: "int", key: "hours.0", label: "From hour", min: -1, max: 23, hint: "-1 in both: there all day" },
            { kind: "int", key: "hours.1", label: "To hour", min: -1, max: 23 },
          ],
        },
        { kind: "int", key: "eventFlag", label: "Event flag", min: 0, max: 65535, hint: "Hidden while this event flag is set; 65535 = always there" },
        { kind: "select", key: "palette", label: "Colors", numeric: true, options: () => ["0", ...OW_PALETTES.map((_, i) => String(8 + i))], labels: (v) => (v === "0" ? "The sprite's own" : OW_PALETTES[Number(v) - 8]?.toLowerCase()) },
        scriptField("objects", "Talking to it", "What it says or does: one of the scripts of the people here (the game's scripts can't be written in the studio)."),
        { kind: "extras", label: "Other fields", hint: "type, sight range, item, script number (cart data)" },
      ],
      create: (_map, x, y) => ({ x, y, sprite: "SPRITE_YOUNGSTER", movement: 6, radius: { x: 0, y: 0 }, hours: [-1, -1], eventFlag: 0xffff, palette: 0 }),
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
      fields: [
        scriptField("bgEvents", "Reading it", "What it says: one of the scripts of the signs here."),
        { kind: "extras", label: "Other fields", hint: "kind (cart data)" },
      ],
      create: (_map, x, y) => ({ x, y, kind: 0 }),
    },
    {
      key: "coordEvents",
      kind: "trigger",
      label: "Step triggers",
      singular: "Step trigger",
      color: "#ff7a45",
      fields: [
        { kind: "int", key: "sceneId", label: "Scene", min: 0, max: 255, hint: "Runs only while the map is in this scene" },
        scriptField("coordEvents", "Stepping on it", "What happens: one of the scripts of the step triggers here."),
        { kind: "extras", label: "Other fields" },
      ],
      create: (_map, x, y) => ({ x, y, sceneId: 0 }),
    },
  ],

  mapFields: [
    { kind: "select", key: "environment", label: "Environment", options: () => ENVIRONMENTS, hint: "The colors, and what Fly, Dig and Escape Rope may do here" },
    { kind: "int", key: "group", label: "Map group", min: 0, max: 26, hint: "Towns and routes: which roof tiles and roof colors it shows" },
  ],

  connections(map): ConnectionRef[] {
    const out: ConnectionRef[] = [];
    const conns = (map.connections ?? {}) as Record<string, { mapId?: string; offset?: number }>;
    for (const [dir, c] of Object.entries(conns)) if (c?.mapId) out.push({ dir: dir as Direction, map: c.mapId, offset: c.offset ?? 0 });
    return out;
  },
  // World.lua reads only mapId and offset
  setConnection(draft, dir, target, offset) {
    const conns = { ...((draft.connections ?? {}) as Record<string, unknown>) };
    if (target) conns[dir] = { mapId: target, offset };
    else delete conns[dir];
    draft.connections = conns;
  },

  // gen1recomp src/world/gen2/Map.lua cellCollision: block 0 is a wall; a
  // cell is a quarter of its block's collision quad
  cell(map, tileset, cx, cy): CellInfo {
    const bx = Math.floor(cx / 2);
    const by = Math.floor(cy / 2);
    const id = map.blocks[by * map.width + bx] ?? 0;
    const quad = (tileset?.collision as number[][] | undefined)?.[id];
    const coll = id === 0 || !quad ? 0xff : quad[(cy % 2) * 2 + (cx % 2)] ?? 0xff;
    // gen1recomp Permissions.isWarpCollision: COLL_PIT/$68 and the $7x row
    // (doors, stairs, caves, warp mats); a warp elsewhere is never taken
    const warp = coll === 0x60 || coll === 0x68 || coll >> 4 === 7;
    return { walkable: COLL_PERMISSIONS[coll % 256] === 0, warp, label: `coll $${coll.toString(16).padStart(2, "0")}` };
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

  // outdoor tilesets start as a route, the rest indoors; map group 0 has no
  // roof (set one in the map panel)
  newMap({ id, tileset, width, height, fill, index }) {
    const outdoor = tileset === "TILESET_JOHTO" || tileset === "TILESET_JOHTO_MODERN" || tileset === "TILESET_KANTO";
    return {
      id, label: id, index, tileset, width, height,
      blocks: new Array(width * height).fill(fill),
      borderBlock: fill,
      environment: outdoor ? "ROUTE" : "INDOOR",
      group: 0,
      connections: {},
      warps: [], objects: [], bgEvents: [], coordEvents: [],
    } as MapDef;
  },

  content,
  pokemon,
  timedEncounters,
  moves,
  items,
  trainers,
  globals,
};
