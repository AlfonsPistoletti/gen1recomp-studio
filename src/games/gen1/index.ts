// Gen 1 (Red/Blue/Yellow): data/generated/*.lua as written by the importer.
//   map:      blocks (32px), warps/objects/signs on the 16px cell grid,
//             connections { dir = { map, offset } }, optional `palette`
//   tileset:  4x4 tile ids per block, `walkable` tile list (collision is the
//             tile at each cell's feet, src/world/Map.lua)
//   color:    one SGB palette per map (vanilla cascade, see palette.ts)

import type { Direction, EntityRecord, MapDef, SpriteDef, TilesetDef } from "../../core/types.ts";
import type { CellInfo, ConnectionRef, ContentSpec, Dataset, EncounterSpec, FieldSpec, GameAdapter, GameContext, GlobalsSpec, MoveSpec, PokemonSpec, TrainerSlot, TrainerSpec } from "../types.ts";
import { GEN1_EFFECTS } from "./effects.ts";
import { paletteColors, paletteNames, resolveMapPalettes, type PaletteData } from "./palette.ts";

interface Gen1Map extends MapDef {
  warps: EntityRecord[];
  objects: EntityRecord[];
  signs: EntityRecord[];
  connections: Partial<Record<Direction, { map: string; offset?: number; [k: string]: unknown }>>;
  palette?: string;
}

const MOVEMENTS = ["STAY", "WALK"];
const RANGES = ["DOWN", "UP", "LEFT", "RIGHT", "NONE", "ANY_DIR", "UP_DOWN", "LEFT_RIGHT"];

const g = (map: MapDef) => map as Gen1Map;

// Every value an object field takes anywhere in the loaded maps, after `seed`.
function objectValues(ctx: GameContext, key: string, seed: string[]): string[] {
  const seen = new Set(seed);
  for (const m of Object.values(ctx.maps)) {
    for (const o of g(m).objects ?? []) if (typeof o[key] === "string") seen.add(o[key] as string);
  }
  return [...seen];
}

function nextObjectIndex(map: MapDef): number {
  return g(map).objects.reduce((m, o) => Math.max(m, typeof o.index === "number" ? o.index : 0), 0) + 1;
}

function palettes(ctx: GameContext): PaletteData {
  return ctx.data.extra.palettes as PaletteData;
}

// What the cascade would pick if the map named no palette of its own.
function autoPalette(id: string, ctx: GameContext): string {
  const map = ctx.maps[id];
  if (!map || !g(map).palette) return resolveMapPalettes(ctx.maps)[id] ?? "ROUTE";
  const { palette: _drop, ...rest } = g(map);
  return resolveMapPalettes({ ...ctx.maps, [id]: rest as MapDef })[id] ?? "ROUTE";
}

// ------------------------------------------------------------------ content

const content: ContentSpec[] = [
  {
    registry: "pokemon",
    file: "pokemon.lua",
    editable: true,
    fieldOrder: [
      "id", "name", "dex", "index", "types", "baseStats", "catchRate", "baseExp", "growthRate",
      "evolutions", "level1Moves", "learnset", "tmhm", "dexEntry",
    ],
  },
  { registry: "encounters", file: "encounters.lua", editable: true, fieldOrder: ["grass", "water"] },
  { registry: "text", file: "text.lua", editable: true },
  { registry: "text_pointers", file: "text_pointers.lua", editable: true },
  // the Global workspace edits a few keys (levelCap, world, ...); written
  // whole with override because the registry merges "deep"
  { registry: "constants", file: "constants.lua", editable: true, replace: true },
  { registry: "type_chart", file: "type_chart.lua", editable: true, build: typeChartRecords },
  {
    registry: "trainers",
    file: "trainers.lua",
    editable: true,
    fieldOrder: ["id", "name", "index", "baseMoney", "aiClass", "aiMods", "pic", "basePic", "partyNames", "parties"],
  },
  // item/switch AI per trainer class; vanilla records live in the engine
  // (data/scripts/ai_classes.lua), which a release cannot read, so they are
  // restated here
  { registry: "ai_classes", editable: true, build: () => structuredClone(AI_CLASSES), fieldOrder: ["item", "uses", "chance", "hpBelow", "onStatus", "switch", "switchBelow", "switchChance"] },
  {
    registry: "moves",
    file: "moves.lua",
    editable: true,
    fieldOrder: ["id", "name", "index", "type", "power", "accuracy", "pp", "effect", "priority", "highCrit", "category", "anim"],
  },
  // "use another move's battle animation": { __ref = "battle_anims:<move>" },
  // written as a get() so no animation data is copied (the real table stays
  // in the game). Written with override so vanilla moves can switch too.
  { registry: "battle_anims", editable: true, replace: true, build: () => ({}) },
  // custom move effects built in the studio: plain data in the mod's
  // studio_effects.lua, registered as move_effects by the generated helper
  { registry: "studio_effects", editable: true, build: () => ({}), studioFile: "studio_effects.lua", generates: "move_effects" },
  { registry: "items", file: "items.lua", editable: false },
];

interface Field {
  waterTilesets?: string[];
  indoorEncounters?: { firstIndoorMap: number; excludedTileset: string };
}

// src/battle/TypeChart.lua TYPES: the type records the engine registers
// (Gen 1 splits physical/special by type). Kept in the game's type order.
const TYPE_RECORDS: Record<string, { name: string; category: "physical" | "special" }> = {
  NORMAL: { name: "NORMAL", category: "physical" },
  FIGHTING: { name: "FIGHTING", category: "physical" },
  FLYING: { name: "FLYING", category: "physical" },
  POISON: { name: "POISON", category: "physical" },
  GROUND: { name: "GROUND", category: "physical" },
  ROCK: { name: "ROCK", category: "physical" },
  BUG: { name: "BUG", category: "physical" },
  GHOST: { name: "GHOST", category: "physical" },
  FIRE: { name: "FIRE", category: "special" },
  WATER: { name: "WATER", category: "special" },
  GRASS: { name: "GRASS", category: "special" },
  ELECTRIC: { name: "ELECTRIC", category: "special" },
  PSYCHIC_TYPE: { name: "PSYCHIC", category: "special" },
  ICE: { name: "ICE", category: "special" },
  DRAGON: { name: "DRAGON", category: "special" },
};

// The registry's records (TypeChart.registerInto): one per type, one per
// matchup row keyed "ATTACKER>DEFENDER" with its x10 multiplier.
function typeChartRecords(file: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [id, rec] of Object.entries(TYPE_RECORDS)) out[id] = { ...rec };
  const rows = Array.isArray(file.matchups) ? (file.matchups as { attacker: string; defender: string; multiplier: number }[]) : [];
  for (const r of rows) out[`${r.attacker}>${r.defender}`] = { multiplier: r.multiplier };
  return out;
}

// type ids (records without ">"), vanilla order first
function typeIds(ctx: GameContext): string[] {
  const ids = Object.keys(recordsOf(ctx, "type_chart")).filter((k) => !k.includes(">"));
  const order = Object.keys(TYPE_RECORDS);
  return ids.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b));
}

const field = (ctx: GameContext) => (ctx.data.extra.field ?? {}) as Field;
const recordsOf = (ctx: GameContext, registry: string) =>
  (ctx.records[registry] ?? ctx.data.content[registry] ?? {}) as Record<string, Record<string, unknown>>;

// src/pokemon/Growth.lua: the vanilla six curves
const GROWTH_RATES = ["MEDIUM_FAST", "SLIGHTLY_FAST", "SLIGHTLY_SLOW", "MEDIUM_SLOW", "FAST", "SLOW"];

type Machine = { kind: string; move: string; number: number };

const pokemon: PokemonSpec = {
  stats: [
    { key: "hp", label: "HP" },
    { key: "attack", label: "Attack" },
    { key: "defense", label: "Defense" },
    { key: "speed", label: "Speed" },
    { key: "special", label: "Special" },
  ],
  maxTypes: 2,
  // ids as records use them (PSYCHIC_TYPE, not the display name PSYCHIC)
  typeNames: typeIds,
  growthRates: () => GROWTH_RATES,
  evolutionMethods: [
    { id: "LEVEL", label: "Level", level: true },
    { id: "ITEM", label: "Item", item: true },
    { id: "TRADE", label: "Trade" },
  ],
  machines: (ctx) =>
    Object.values(recordsOf(ctx, "items"))
      .map((i) => i.machine as Machine | undefined)
      .filter((m): m is Machine => !!m?.move)
      .sort((a, b) => (a.kind === b.kind ? a.number - b.number : a.kind === "TM" ? -1 : 1))
      .map((m) => ({ move: m.move, label: `${m.kind}${String(m.number).padStart(2, "0")}` })),
  moveNames: (ctx) => Object.keys(recordsOf(ctx, "moves")).sort(),
  itemNames: (ctx) => Object.keys(recordsOf(ctx, "items")).sort(),
  frontSprite: (r) => (typeof r.spriteFront === "string" ? r.spriteFront : undefined),
  backSprite: (r) => (typeof r.spriteBack === "string" ? r.spriteBack : undefined),
  frontSizes: [5, 6, 7],
  backSize: 32,
  // src/ui/PartyMenu.lua drawIcon: record.icon (a shape name or { image }),
  // else icons.byDex[dex]
  icon: {
    width: 16,
    height: 16,
    frames: 2,
    names: (ctx) => Object.keys(iconData(ctx).icons ?? {}).sort(),
    path: (ctx, name) => iconData(ctx).icons?.[name],
    resolve: (ctx, r) => {
      const own = r.icon;
      if (typeof own === "string") return { name: own };
      if (own && typeof own === "object" && typeof (own as { image?: unknown }).image === "string") return { image: (own as { image: string }).image };
      const name = typeof r.dex === "number" ? iconData(ctx).byDex?.[r.dex - 1] : undefined;
      return name ? { name } : {};
    },
  },
};

interface IconData {
  byDex?: string[];
  icons?: Record<string, string>;
}
const iconData = (ctx: GameContext) => (ctx.data.extra.icons ?? {}) as IconData;

// src/world/Map.lua fallbacks for tilesets that name no water/shore tiles
const WATER_TILES = [0x14];
const SHORE_TILES = [0x32, 0x48];
// engine/battle/wild_encounters.asm slot thresholds, cumulative out of 256
const ENCOUNTER_BUCKETS = [51, 102, 141, 166, 191, 216, 229, 242, 253, 256];

// Indoor maps (index past the last outdoor one, tileset not FOREST) roll
// their grass table on every step, not only on grass.
function rollsEverywhere(map: MapDef, ctx: GameContext): boolean {
  const indoor = field(ctx).indoorEncounters;
  return !!indoor && (map.index ?? 0) >= indoor.firstIndoorMap && map.tileset !== indoor.excludedTileset;
}

const encounters: EncounterSpec = {
  terrains: [
    { key: "grass", label: "Grass", hint: "Rolled on each step in tall grass (on indoor maps: on every step)." },
    { key: "water", label: "Water", hint: "Rolled on each step while surfing." },
  ],
  slotCount: 10,
  slotOdds: (ctx) => {
    const stored = recordsOf(ctx, "constants").encounterBuckets as unknown;
    const buckets = Array.isArray(stored) && stored.length ? (stored as number[]) : ENCOUNTER_BUCKETS;
    return buckets.map((b, i) => b - (i ? buckets[i - 1] : 0));
  },
  // a per-table `buckets` field exists in the engine, but the mod schema
  // rejects it, so the chances can only change for every map at once
  sharedOdds: { registry: "constants", id: "encounterBuckets", defaults: ENCOUNTER_BUCKETS },
  wildCell(map, tileset, cx, cy, ctx) {
    const tile = tileAt(map, tileset, cx * 2, cy * 2 + 1);
    if (tile === undefined) return null;
    if (typeof tileset?.grassTile === "number" && tile === tileset.grassTile) return "grass";
    if ((field(ctx).waterTilesets ?? []).includes(map.tileset)) {
      const water = (tileset?.waterTiles as number[] | undefined) ?? WATER_TILES;
      const shore = (tileset?.shoreTiles as number[] | undefined) ?? (map.tileset === "SHIP_PORT" ? [] : SHORE_TILES);
      if (water.includes(tile) || shore.includes(tile)) return "water";
    }
    if (rollsEverywhere(map, ctx) && Array.isArray(tileset?.walkable) && (tileset.walkable as number[]).includes(tile)) return "any";
    return null;
  },
  notes(map, ctx) {
    const out: string[] = [];
    const tileset = ctx.data.tilesets[map.tileset];
    if (rollsEverywhere(map, ctx)) {
      out.push(`Indoor map (index ${map.index ?? "?"}): the grass table rolls on every step, not just in grass.`);
    } else if (typeof tileset?.grassTile !== "number") {
      out.push(`The ${map.tileset} tileset has no tall grass tile, so a grass table never triggers here.`);
    }
    if (!(field(ctx).waterTilesets ?? []).includes(map.tileset)) out.push(`The ${map.tileset} tileset has no surfable water.`);
    return out;
  },
};

// ------------------------------------------------------------------ moves

const moves: MoveSpec = {
  registry: "moves",
  // the battle menu's move names (THUNDERSHOCK)
  nameMax: 12,
  maxPp: 64,
  effects: (ctx) =>
    [
      ...new Set([
        ...Object.keys(GEN1_EFFECTS),
        ...Object.values(recordsOf(ctx, "moves")).map((m) => m.effect).filter((e): e is string => typeof e === "string"),
        ...Object.keys(recordsOf(ctx, "studio_effects")),
      ]),
    ].sort(),
  categories: ["physical", "special", "status"],
  animRegistry: "battle_anims",
  custom: {
    registry: "studio_effects",
    stats: ["attack", "defense", "speed", "special", "accuracy", "evasion"],
    statuses: [
      { id: "SLP", label: "Sleep" },
      { id: "PSN", label: "Poison" },
      { id: "TOX", label: "Bad poison" },
      { id: "PAR", label: "Paralysis" },
      { id: "BRN", label: "Burn" },
      { id: "FRZ", label: "Freeze" },
    ],
    describe: (effect) => GEN1_EFFECTS[effect]?.text ?? "",
    template: (effect) => (GEN1_EFFECTS[effect]?.spec ? structuredClone(GEN1_EFFECTS[effect].spec!) : null),
  },
};

// ------------------------------------------------------------------ trainers

// gen1recomp data/scripts/ai_classes.lua (from pokered ai_pointers.asm):
// item use and switching per trainer class. chance is out of 256; hpBelow
// N means "only below max HP / N"; onStatus = only with a status condition.
const AI_CLASSES: Record<string, Record<string, unknown>> = {
  OPP_JUGGLER: { uses: 3, chance: 64, switch: true },
  OPP_BLACKBELT: { uses: 2, chance: 32, item: "X_ATTACK" },
  OPP_GIOVANNI: { uses: 1, chance: 64, item: "GUARD_SPEC" },
  OPP_COOLTRAINER_M: { uses: 2, chance: 64, item: "X_ATTACK" },
  OPP_COOLTRAINER_F: { uses: 1, item: "HYPER_POTION", hpBelow: 10, switchBelow: 5 },
  OPP_BRUNO: { uses: 2, chance: 64, item: "X_DEFEND" },
  OPP_BROCK: { uses: 5, onStatus: true, item: "FULL_HEAL" },
  OPP_MISTY: { uses: 1, chance: 64, item: "X_DEFEND" },
  OPP_LT_SURGE: { uses: 1, chance: 64, item: "X_SPEED" },
  OPP_ERIKA: { uses: 1, chance: 128, item: "SUPER_POTION", hpBelow: 10 },
  OPP_KOGA: { uses: 2, chance: 64, item: "X_ATTACK" },
  OPP_BLAINE: { uses: 2, chance: 64, item: "SUPER_POTION" },
  OPP_SABRINA: { uses: 1, chance: 64, item: "HYPER_POTION", hpBelow: 10 },
  OPP_RIVAL2: { uses: 1, chance: 32, item: "POTION", hpBelow: 5 },
  OPP_RIVAL3: { uses: 1, chance: 32, item: "FULL_RESTORE", hpBelow: 5 },
  OPP_LORELEI: { uses: 2, chance: 128, item: "SUPER_POTION", hpBelow: 5 },
  OPP_AGATHA: { uses: 2, switchChance: 20, chance: 128, item: "SUPER_POTION", hpBelow: 4 },
  OPP_LANCE: { uses: 1, chance: 128, item: "HYPER_POTION", hpBelow: 5 },
};

// src/battle/BattleState.lua: signature moves the game puts in the third
// move slot of one party member (data/trainers/special_moves.asm)
const LONE_MOVES: Record<string, { slot: number; move: string; onlyParty?: number }> = {
  OPP_BROCK: { slot: 2, move: "BIDE" },
  OPP_MISTY: { slot: 2, move: "BUBBLEBEAM" },
  OPP_LT_SURGE: { slot: 3, move: "THUNDERBOLT" },
  OPP_ERIKA: { slot: 3, move: "MEGA_DRAIN" },
  OPP_KOGA: { slot: 4, move: "TOXIC" },
  OPP_SABRINA: { slot: 4, move: "PSYWAVE" },
  OPP_BLAINE: { slot: 4, move: "FIRE_BLAST" },
  OPP_GIOVANNI: { slot: 5, move: "FISSURE", onlyParty: 3 },
};
const TEAM_MOVES: Record<string, string> = { OPP_LORELEI: "BLIZZARD", OPP_BRUNO: "FISSURE", OPP_AGATHA: "TOXIC", OPP_LANCE: "BARRIER" };
const RIVAL_STARTER_MOVES: Record<string, string> = { VENUSAUR: "MEGA_DRAIN", CHARIZARD: "FIRE_BLAST", BLASTOISE: "BLIZZARD" };

// src/pokemon/Pokemon.lua movesAtLevel: level-1 moves, then the learnset up
// to the level, keeping the last four
function movesAtLevel(mon: Record<string, unknown> | undefined, level: number): string[] {
  if (!mon) return [];
  const out: string[] = [];
  const add = (m: string) => {
    if (!out.includes(m)) out.push(m);
  };
  for (const m of (mon.level1Moves as string[] | undefined) ?? []) add(m);
  for (const e of (mon.learnset as { level: number; move: string }[] | undefined) ?? []) if (e.level <= level) add(e.move);
  return out.slice(-4);
}

const trainers: TrainerSpec = {
  registry: "trainers",
  picSize: 56,
  maxPartySize: 6,
  nameMax: 13,
  pic: (id, ctx) => {
    const all = recordsOf(ctx, "trainers");
    const rec = all[id];
    if (typeof rec?.pic === "string") return rec.pic;
    const base = typeof rec?.basePic === "string" ? all[rec.basePic] : undefined;
    return typeof base?.pic === "string" ? base.pic : undefined;
  },
  defaultMoves(trainerId, partyIndex, slotIndex, party: TrainerSlot[], ctx) {
    const mons = recordsOf(ctx, "pokemon");
    const slot = party[slotIndex];
    const moves = movesAtLevel(mons[slot?.species ?? ""], slot?.level ?? 1);
    // BattleState applySpecialMoves / setThirdMove
    const third = (move: string) => {
      moves[Math.min(2, moves.length)] = move;
    };
    const lone = LONE_MOVES[trainerId];
    if (lone) {
      if ((!lone.onlyParty || lone.onlyParty === partyIndex + 1) && lone.slot === slotIndex + 1) third(lone.move);
    } else if (TEAM_MOVES[trainerId]) {
      if (slotIndex === 4) third(TEAM_MOVES[trainerId]);
    } else if (trainerId === "OPP_RIVAL3") {
      if (slotIndex === 0) third("SKY_ATTACK");
      if (slotIndex === 5 && RIVAL_STARTER_MOVES[slot?.species ?? ""]) third(RIVAL_STARTER_MOVES[slot.species]);
    }
    return moves;
  },
  objectClassKey: "trainerClass",
  objectPartyKey: "trainerParty",
  aiLayers: [
    { value: 1, label: "Avoid useless status moves", about: "Strongly avoids sleep/poison/paralysis moves when your Pokémon already has a status condition." },
    { value: 2, label: "Set up on the 2nd turn", about: "Prefers stat-changing moves (and a few neighbours like Swift, Haze, Reflect) on its Pokémon's second move choice." },
    { value: 3, label: "Prefer super-effective moves", about: "Prefers moves that are super effective against your Pokémon, and avoids not-very-effective ones when it has something better." },
  ],
  aiClasses: {
    registry: "ai_classes",
    // the items TrainerAI.useItem gives an effect
    items: ["POTION", "SUPER_POTION", "HYPER_POTION", "FULL_RESTORE", "FULL_HEAL", "X_ATTACK", "X_DEFEND", "X_SPEED", "X_SPECIAL", "GUARD_SPEC"],
  },
  notes(id) {
    const out: string[] = [];
    if (/^OPP_RIVAL[123]$/.test(id)) out.push("In battle the rival is called by the name the player gave him, not this name.");
    if (LONE_MOVES[id] || TEAM_MOVES[id] || id === "OPP_RIVAL3") out.push("The game gives one team member a signature move in slot 3 (shown in its moves). Custom moves replace it.");
    return out;
  },
};

// ------------------------------------------------------------------ globals
// Only settings the Gen 1 engine actually reads. Defaults are the engine's
// own (src/core/Data.lua CONSTANT_DEFAULTS, src/world/FieldDefaults.lua
// CONSTANTS), which is what a game without the setting uses.

const WORLD_DEFAULTS = {
  poisonStepInterval: 4,
  poisonDamage: 1,
  blackoutMoneyDivisor: 2,
  daycareExpPerStep: 1,
  neighborHops: 2,
  stepFrames: 16,
  bikeStepFrames: 8,
  turnFrames: 4,
};

const HM_BADGES = {
  CUT: { badge: "CASCADEBADGE" },
  SURF: { badge: "SOULBADGE" },
  STRENGTH: { badge: "RAINBOWBADGE" },
  FLY: { badge: "THUNDERBADGE" },
  FLASH: { badge: "BOULDERBADGE" },
};

const BADGES = ["BOULDERBADGE", "CASCADEBADGE", "THUNDERBADGE", "RAINBOWBADGE", "SOULBADGE", "MARSHBADGE", "VOLCANOBADGE", "EARTHBADGE"];

// frames per step: fewer is faster; divisors of 16 keep movement on whole pixels
const SPEEDS = [
  { value: 4, label: "4 (very fast)" },
  { value: 8, label: "8 (fast, vanilla bike)" },
  { value: 16, label: "16 (vanilla walk)" },
];

const globals: GlobalsSpec = {
  sections: [
    { id: "wild", label: "Wild encounters", hint: "How likely each of the ten slots of a wild table is. The tables themselves are per map (Maps, Encounters tab)." },
    { id: "types", label: "Type chart", hint: "Type effectiveness, and which types are physical or special." },
    { id: "battle", label: "Pokémon & items", hint: "Level cap and bag size." },
    { id: "overworld", label: "Overworld", hint: "Walking and biking speed, poison, blacking out, Day-Care." },
    { id: "fieldmoves", label: "Field moves", hint: "Which badge each HM needs outside of battle." },
  ],
  numbers: [
    { section: "battle", registry: "constants", id: "levelCap", label: "Level cap", hint: "Pokémon stop gaining levels here.", min: 1, max: 100 },
    { section: "battle", registry: "constants", id: "bagSize", label: "Bag size", hint: "How many different items the bag holds.", min: 1, max: 99 },
    { section: "overworld", registry: "constants", id: "world", key: "stepFrames", label: "Walking speed", hint: "Frames per step on foot; fewer is faster.", min: 1, max: 32, choices: SPEEDS },
    { section: "overworld", registry: "constants", id: "world", key: "bikeStepFrames", label: "Bike speed", hint: "Frames per step on the bicycle; fewer is faster.", min: 1, max: 32, choices: SPEEDS },
    { section: "overworld", registry: "constants", id: "world", key: "turnFrames", label: "Turn window", hint: "Frames a tap may last to only turn instead of stepping.", min: 1, max: 16 },
    { section: "overworld", registry: "constants", id: "world", key: "poisonStepInterval", label: "Poison: steps per hit", hint: "Poisoned party members lose HP every this many steps.", min: 1, max: 255 },
    { section: "overworld", registry: "constants", id: "world", key: "poisonDamage", label: "Poison: damage per hit", hint: "HP lost each time.", min: 0, max: 255 },
    { section: "overworld", registry: "constants", id: "world", key: "blackoutMoneyDivisor", label: "Blackout money divisor", hint: "Blacking out costs your money divided by this (2 = half).", min: 1, max: 255 },
    { section: "overworld", registry: "constants", id: "world", key: "daycareExpPerStep", label: "Day-Care EXP per step", hint: "EXP the Day-Care Pokémon gains for each step you walk.", min: 0, max: 255 },
  ],
  defaults: {
    constants: { levelCap: 100, bagSize: 20, world: WORLD_DEFAULTS, hmBadges: HM_BADGES, encounterBuckets: ENCOUNTER_BUCKETS },
  },
  hmBadges: { registry: "constants", id: "hmBadges", moves: Object.keys(HM_BADGES), badges: BADGES },
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

const mapFields: FieldSpec[] = [
  { kind: "text", key: "label", label: "Label" },
  {
    kind: "select",
    key: "palette",
    label: "Palette",
    options: (ctx) => paletteNames(palettes(ctx)),
    emptyLabel: (rec, ctx) => `(auto: ${autoPalette(String(rec.id), ctx)})`,
  },
];

export const gen1: GameAdapter = {
  id: "gen1",
  name: "Gen 1",
  manifestGame: "gen1",
  ready: true,

  async load(read): Promise<Dataset> {
    const [maps, tilesets, sprites, pal, fieldData, icons, ...tables] = await Promise.all([
      read("maps.lua") as Promise<Record<string, MapDef>>,
      read("tilesets.lua") as Promise<Record<string, TilesetDef>>,
      read("sprites.lua") as Promise<Record<string, SpriteDef>>,
      read("palettes.lua") as Promise<PaletteData>,
      read("field.lua") as Promise<Field>,
      read("icons.lua") as Promise<IconData>,
      ...content.map((c) => (c.file ? (read(c.file) as Promise<Record<string, unknown>>) : Promise.resolve({}))),
    ]);
    for (const m of Object.values(maps)) gen1.normalizeMap(m);
    const contentTables: Dataset["content"] = {};
    content.forEach((c, i) => (contentTables[c.registry] = c.build ? c.build(tables[i] ?? {}) : tables[i] ?? {}));
    // only what the editor reads from the big field table
    const fieldExtra: Field = { waterTilesets: fieldData.waterTilesets, indoorEncounters: fieldData.indoorEncounters };
    return { maps, tilesets, sprites, content: contentTables, extra: { palettes: pal, field: fieldExtra, icons } };
  },

  // Empty Lua tables arrive as []; give each field the shape it has in use.
  normalizeMap(map) {
    const m = map as Record<string, unknown>;
    if (!m.connections || Array.isArray(m.connections)) m.connections = {};
    for (const key of ["warps", "objects", "signs"]) {
      const v = m[key];
      if (!Array.isArray(v)) m[key] = v && typeof v === "object" ? Object.values(v) : [];
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
      fields: [{ kind: "warpTarget", label: "Destination", mapKey: "destMap", warpKey: "destWarp", specialMaps: ["LAST_MAP", "UNUSED_MAP_ED"], hint: "LAST_MAP returns to the map the player came from; UNUSED_MAP_ED is a placeholder the Silph Co. elevator script fills in." }],
      create: (_map, x, y) => ({ x, y, destMap: "LAST_MAP", destWarp: 1 }),
    },
    {
      key: "objects",
      kind: "npc",
      label: "Objects",
      singular: "NPC / object",
      color: "#3cc8e6",
      fields: [
        { kind: "text", key: "name", label: "Name" },
        { kind: "select", key: "sprite", label: "Sprite", options: (ctx) => Object.keys(ctx.data.sprites).sort() },
        {
          kind: "pair",
          fields: [
            { kind: "select", key: "movement", label: "Movement", options: (ctx) => objectValues(ctx, "movement", MOVEMENTS) },
            {
              kind: "select",
              key: "range",
              label: "Range / facing",
              options: (ctx) => objectValues(ctx, "range", RANGES),
              // every vanilla object sets one; only offer "unset" when it is
              // (the engine reads a missing range as NONE, src/world/NPC.lua)
              emptyLabel: (rec) => (rec.range === undefined ? "(not set: same as NONE)" : undefined),
            },
          ],
        },
        { kind: "text", key: "text", label: "Text id", hint: "TEXT_* label; trainers and items use the extra fields below" },
        { kind: "extras", label: "Extra fields (JSON)", hint: "trainerClass, trainerParty, item, pokemon, level, hidden…" },
      ],
      create: (map, x, y) => {
        const index = nextObjectIndex(map);
        return { index, name: `${map.id}_NPC_${index}`, sprite: "SPRITE_YOUNGSTER", movement: "STAY", range: "DOWN", text: "TEXT_", x, y };
      },
      duplicate: (map, copy) => {
        copy.index = nextObjectIndex(map);
      },
      sprite: (o) => {
        if (typeof o.sprite !== "string") return null;
        const still = o.movement === "STAY";
        const range = still ? o.range : "DOWN";
        const facing = range === "UP" ? "up" : range === "LEFT" ? "left" : range === "RIGHT" ? "right" : "down";
        return { sprite: o.sprite, facing, ghost: o.hidden === true, moving: !!o.movement && !still };
      },
    },
    {
      key: "signs",
      kind: "sign",
      label: "Signs",
      singular: "Sign",
      color: "#ffc828",
      fields: [{ kind: "text", key: "text", label: "Text id", hint: "A TEXT_* label from text.lua" }],
      create: (_map, x, y) => ({ x, y, text: "TEXT_" }),
    },
  ],

  mapFields,

  connections(map): ConnectionRef[] {
    const out: ConnectionRef[] = [];
    for (const [dir, c] of Object.entries(g(map).connections ?? {})) {
      if (c?.map) out.push({ dir: dir as Direction, map: c.map, offset: c.offset ?? 0 });
    }
    return out;
  },

  setConnection(draft, dir, target, offset) {
    const conns = g(draft).connections;
    if (target) conns[dir] = { ...(conns[dir] ?? {}), map: target, offset };
    else delete conns[dir];
  },

  cell(map, tileset, cx, cy): CellInfo {
    const tile = tileAt(map, tileset, cx * 2, cy * 2 + 1);
    const walkable = Array.isArray(tileset?.walkable) && tile !== undefined && (tileset.walkable as number[]).includes(tile);
    return { tile, walkable };
  },

  paletteKeys: (ctx) => resolveMapPalettes(ctx.maps),
  tileColors: (ctx, _tileset, key) => {
    const colors = paletteColors(palettes(ctx), key);
    return () => colors;
  },
  // Overworld sprites go through rOBP0 = $D0 (gen1recomp PaletteFX.OBP0_SHADES):
  // white is transparent, light gray shows as the lightest color, dark gray
  // as the light one, black stays black. Indexed by sheet shade, darkest first.
  spriteColors: (ctx, key) => {
    const c = paletteColors(palettes(ctx), key);
    return [c[0], c[2], c[3], c[3]];
  },

  newMap({ id, tileset, width, height, fill, index }) {
    const label = id.toLowerCase().replace(/(^|_)(\w)/g, (_m, _s, c: string) => c.toUpperCase());
    return {
      id, label, index, tileset, width, height,
      borderBlock: fill,
      blocks: new Array(width * height).fill(fill),
      warps: [], objects: [], signs: [], connections: {},
    };
  },

  content,
  pokemon,
  encounters,
  globals,
  trainers,
  moves,
};

function blockAt(map: MapDef, bx: number, by: number): number {
  if (bx < 0 || by < 0 || bx >= map.width || by >= map.height) return map.borderBlock ?? 0;
  return map.blocks[by * map.width + bx] ?? 0;
}

function tileAt(map: MapDef, tileset: TilesetDef | undefined, tx: number, ty: number): number | undefined {
  const block = tileset?.blocks?.[blockAt(map, Math.floor(tx / 4), Math.floor(ty / 4))];
  return block?.[(ty % 4) * 4 + (tx % 4)];
}
