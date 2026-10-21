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
import { GEN2_EVENTS } from "./events.ts";
import { setWeekdays, WEEKDAYS, weekdaysOf } from "./weekdays.ts";
import { visibilityNote } from "./visibility.ts";
import { GEN2_IMAGES } from "./images.ts";
import { blocksInScene, clearSceneBlocks, scenesWithScripts, sceneBlocks, sceneNames, sceneScriptOf, scenesOf, setSceneBlock, setSceneName, setSceneScript } from "./scenes.ts";
import { gen2EffectTemplate, gen2EffectText, GEN2_STATS, GEN2_STATUSES } from "./moveEffects.ts";
import { EFFECT_RUNTIME2 } from "../../lua/effectRuntime2.ts";
import { effectRegistration } from "../../lua/effectRuntime.ts";
import { ITEM_EFFECT_RUNTIME2, itemEffectRegistration2 } from "../../lua/itemEffectRuntime2.ts";
import type { GameGift } from "../../project/gameEvents.ts";
import { START_RUNTIME2, startRegistration2 } from "../../lua/startRuntime2.ts";
import { giftRegistration2, STARTER_RUNTIME2, starterRegistration2 } from "../../lua/starterRuntime2.ts";
import { TRADE_RUNTIME2, tradeRegistration2 } from "../../lua/tradeRuntime2.ts";
import { FIELD_RUNTIME2, fruitTreeRegistration2, hmBadgeRegistration2, slotRegistration2, townMapRegistration2 } from "../../lua/fieldRuntime2.ts";
import { INTRO_RUNTIME } from "../../lua/introRuntime.ts";
import { INTRO_TEXT_RUNTIME2, introRegistration2, introTextRegistration2 } from "../../lua/introRuntime2.ts";
import { GEN2_EXP_STATS, GEN2_ITEM_STATUSES, gen2ItemTemplate, gen2ItemText, gen2PicksMove, gen2SpecialItem } from "./items.ts";
import { playtestMain2 } from "../../lua/playRuntime.ts";
import type { Direction, MapDef, SpriteDef, TilesetDef } from "../../core/types.ts";
import { gen2TileAnimations, OWN_PATTERNS, type TileAnimSheets } from "./tileAnim.ts";
import { inlineScripts, outlineScripts, ownsScript } from "./scriptKeys.ts";
import type { CellInfo, ConnectionRef, ContentSpec, Dataset, Facing, FieldSpec, GameAdapter, GameContext, GlobalNumber, GlobalsSpec, ItemSpec, ItemUse, MoveSpec, PokemonSpec, TimedEncounterSpec, TrainerSlot, TrainerSpec } from "../types.ts";

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
  // named engine texts (battle, menus, Mom …): rom_text merges into data.text,
  // the table gen1recomp RomText reads
  { registry: "rom_text", file: "rom_text.lua", editable: true, build: (f) => Object.fromEntries(Object.entries(f).filter(([, v]) => typeof v === "string")) },
  // palettes.lua subtables are the registry's ids (trainers, pokemon, ...);
  // the studio edits trainers (a new class's portrait colors)
  // trainers[class] / pokemon[species] colors: a copied class or species takes its source's
  { registry: "palettes", file: "palettes.lua", editable: true, build: (f) => Object.fromEntries(Object.entries(f).filter(([k, v]) => (k === "trainers" || k === "pokemon" || k === "bg" || k === "environments") && !!v && typeof v === "object")) },
  // sprites (filled from Dataset.sprites in load): the game's art is replaced
  // by patching `image`, the mod's own are registered whole
  { registry: "sprites", editable: true, build: () => ({}), fieldOrder: ["id", "image", "frames", "walker", "spriteType", "palette", "paletteId", "trueColor"] },
  // custom move effects: plain data in studio_effects.lua, registered as
  // move_effects records by the generated helper (Gold's shapes)
  {
    registry: "studio_effects", editable: true, build: () => ({}), studioFile: "studio_effects.lua",
    generator: { what: "custom move effects", order: ["kind", "canMiss", "steps"], runtime: EFFECT_RUNTIME2, registration: effectRegistration, writes: ["move_effects"] },
  },
  // start values: Gold has no data for them (Save.newGame money 3000,
  // landmarks.lua spawns.SPAWN_HOME = PLAYERS_HOUSE_2F 3, 3 in all three games)
  {
    // names: the naming menu's player names (data/player_names.asm PlayerNameArray, per edition)
    registry: "studio_start", editable: true, studioFile: "studio_start.lua",
    build: () => ({ start: { map: "PLAYERS_HOUSE_2F", x: 3, y: 3, money: 3000 }, names: { player: [...(PLAYER_NAMES[gameVersion] ?? PLAYER_NAMES.gold)] } }),
    generator: { what: "start values", order: ["map", "x", "y", "money", "player"], runtime: START_RUNTIME2, registration: startRegistration2, writes: [] },
  },
  // Oak's speech: the step list (Gen 1's helper) and the Pokémon he shows
  // (record "demo"); its texts are oak_speech.lua's own (speech.texts)
  {
    registry: "studio_intro", editable: true, build: () => ({}), studioFile: "studio_intro.lua",
    generator: { what: "Oak's speech", order: ["speech", "demo", "steps", "id", "kind", "textKey", "pic", "reveal", "cry", "choices", "flags", "species"], runtime: INTRO_RUNTIME, registration: introRegistration2, writes: [] },
  },
  {
    registry: "studio_intro_text", file: "oak_speech.lua", editable: true, studioFile: "studio_intro_text.lua",
    build: (f) => Object.fromEntries(Object.entries((f as { text?: Record<string, unknown> }).text ?? {}).filter(([, v]) => typeof v === "string")),
    generator: { what: "Oak's speech texts", order: [], runtime: INTRO_TEXT_RUNTIME2, registration: introTextRegistration2, writes: [] },
  },
  // the Town Map: places (the landmarks registry) and the regions' tile grids
  // (menu_gfx.lua pokegear.maps, set by a helper: no registry reaches them)
  { registry: "landmarks", file: "landmarks.lua", editable: true, build: (f) => structuredClone((f as { landmarks?: Record<string, unknown> }).landmarks ?? {}) },
  {
    registry: "studio_townmap", file: "menu_gfx.lua", editable: true, studioFile: "studio_townmap.lua",
    build: (f) => structuredClone((f as { pokegear?: { maps?: Record<string, unknown> } }).pokegear?.maps ?? {}),
    generator: { what: "Town Map tiles", order: [], runtime: FIELD_RUNTIME2, registration: townMapRegistration2, writes: [] },
  },
  // replaced game images: files in mods/<id>/overrides/ (not registry calls)
  { registry: "image_overrides", editable: true, build: () => ({}), files: true },
  // move animations: only "moves" (move id -> script pointer); a new move borrows one
  { registry: "battle_anims", file: "battle_anims.lua", editable: true, build: (f) => ({ moves: structuredClone((f as { moves?: Record<string, string> }).moves ?? {}) }) },
  // status numbers the battle and catching read off the merged records
  // (gen1recomp src/battle/gen2/Battle.lua STATUSES; patched, the records carry code)
  { registry: "statuses", editable: true, build: () => structuredClone(GOLD_STATUSES) },
  // HM badges and slot reels: module tables, set by a helper (engine_internals)
  {
    registry: "studio_field_moves", editable: true, build: () => ({ badges: structuredClone(GOLD_HM_BADGES) }), studioFile: "studio_field_moves.lua",
    generator: { what: "HM badges", order: ["badge"], runtime: FIELD_RUNTIME2, registration: hmBadgeRegistration2, writes: [], internals: true },
  },
  {
    registry: "studio_fruit_trees", editable: true, build: () => ({ trees: [...GOLD_FRUIT_TREES] }), studioFile: "studio_fruit_trees.lua",
    generator: { what: "fruit trees", order: [], runtime: FIELD_RUNTIME2, registration: fruitTreeRegistration2, writes: [], internals: true },
  },
  // Kurt's apricorn balls: the engine's own registry (patched)
  { registry: "apricorns", editable: true, build: () => structuredClone(GOLD_APRICORNS) },
  // the Pokégear phone book: events.lua `phone` rows by their PHONE_* id
  // (gen1recomp Phone.lua applies registry rows onto its table by `index`; no new rows)
  {
    registry: "phone_contacts", file: "events.lua", editable: true,
    build: (f) => {
      const out: Record<string, unknown> = {};
      for (const r of asList((f as { phone?: unknown }).phone) as Record<string, unknown>[]) {
        if (typeof r?.contact !== "string" || r.contact === "PHONE_UNUSED") continue;
        out[r.contact] = { index: r.id, map: r.map, calleeTime: r.calleeTime, callerTime: r.callerTime, calleeKey: r.callee, callerKey: r.caller };
      }
      return out;
    },
  },
  {
    registry: "studio_slots", editable: true, build: () => ({ reels: structuredClone(GOLD_REELS) }), studioFile: "studio_slots.lua",
    generator: { what: "slot machine reels", order: [], runtime: FIELD_RUNTIME2, registration: slotRegistration2, writes: [], internals: true },
  },
  // in-game trades: events.lua `trades` as one list record
  {
    registry: "studio_trades", file: "events.lua", editable: true, studioFile: "studio_trades.lua",
    build: (f) => ({ trades: structuredClone((f as { trades?: unknown[] }).trades ?? []) }),
    generator: { what: "in-game trades", order: ["give", "get", "nickname", "item", "otName", "otId", "gender", "dialog", "dvs"], runtime: TRADE_RUNTIME2, registration: tradeRegistration2, writes: [] },
  },
  // gift Pokémon: "<MAP>:<SPECIES>" -> { species, level } (same helper as the starters)
  {
    registry: "studio_gifts", editable: true, build: () => ({}), studioFile: "studio_gifts.lua",
    generator: { what: "gift Pokémon", order: ["species", "level", "nickname", "otName", "otId"], runtime: STARTER_RUNTIME2, registration: giftRegistration2, writes: [] },
  },
  // starter balls: the game's ball species -> { species, level }
  {
    registry: "studio_starters", editable: true, build: () => ({}), studioFile: "studio_starters.lua",
    generator: { what: "starter Pokémon", order: ["species", "level"], runtime: STARTER_RUNTIME2, registration: starterRegistration2, writes: [] },
  },
  // custom item effects, keyed by the item they belong to (Gold's
  // item_effects are), registered by the generated helper
  {
    registry: "studio_item_effects", editable: true, build: () => ({}), studioFile: "studio_item_effects.lua",
    generator: {
      what: "custom item effects",
      order: ["target", "steps", "act", "amount", "percent", "full", "statuses", "all", "stat"],
      runtime: ITEM_EFFECT_RUNTIME2, registration: itemEffectRegistration2, writes: ["item_effects"],
    },
  },
  // tilesets (filled from Dataset.tilesets in load): the mod's own are
  // registered whole (sheet in assets/studio, a collision quad per block, a
  // palette slot per tile); the game's are only extended, through studio_tilesets
  { registry: "tilesets", editable: true, build: () => ({}), fieldOrder: ["id", "image", "imageWidth", "imageHeight", "tilesPerRow", "blocks", "collision", "tilePalettes"] },
  // blocks (and their collision quads) added to the game's tilesets: plain
  // data in studio_tilesets.lua, patched in by the generated helper
  {
    registry: "studio_tilesets", editable: true, build: () => ({}), studioFile: "studio_tilesets.lua",
    generator: { what: "tileset extensions", order: ["first", "tiles", "palettes", "blocks", "collision", "anim", "func", "tile", "sheet", "frames"], runtime: TILESET_RUNTIME2, registration: tilesetRegistration2, writes: ["tilesets"] },
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
  // species id -> the name of an ICON_ sheet; ICON_ ids are the sheets
  // (gen1recomp Schemas R.icons gen2Value)
  { registry: "icons", file: "icons.lua", editable: true, build: (f) => {
    const file = f as { species?: Record<string, unknown>; icons?: Record<string, unknown> };
    return { ...(file.species ?? {}), ...(file.icons ?? {}) };
  } },
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
// the event flags a new game starts with set (initial_events.lua): people with
// one of them are hidden until a script shows them (see load)
const startFlags = new Set<number>();
// scripts.lua (decoded script rows by pointer) and the texts each script
// shows, worked out on first ask (scriptTexts)
let scriptRows: Record<string, unknown> = {};
const scriptTextMemo = new Map<string, string[]>();
// constants/event_flags.asm: NUM_EVENTS = $800 (gen1recomp Save.EVENT_BYTES)
const NUM_EVENTS = 0x800;

// "<class index>:<member>" -> where a script starts that battle (see load)
const scriptFights = new Map<string, { mapId: string; index: number }[]>();
// gen1recomp src/battle/gen2/Battle.lua STATUSES: the numbers a mod can patch
const GOLD_STATUSES: Record<string, Record<string, unknown>> = {
  sleep: { catchBonus: 10 }, poison: { catchBonus: 0 }, toxic: { catchBonus: 0 },
  paralyze: { catchBonus: 0, statPenalty: { stat: "speed", div: 4 } },
  burn: { catchBonus: 0, statPenalty: { stat: "attack", div: 2 } },
  freeze: { catchBonus: 10 },
};
// src/world/gen2/FieldMoves.lua BADGE and JOHTO_BADGES (the check reads only Johto's)
const GOLD_HM_BADGES: Record<string, { badge: string }> = {
  CUT: { badge: "HIVE" }, FLASH: { badge: "ZEPHYR" }, SURF: { badge: "FOG" }, FLY: { badge: "STORM" },
  STRENGTH: { badge: "PLAIN" }, WHIRLPOOL: { badge: "GLACIER" }, WATERFALL: { badge: "RISING" },
};
const JOHTO_BADGES = ["ZEPHYR", "HIVE", "PLAIN", "FOG", "MINERAL", "STORM", "GLACIER", "RISING"];
// gen1recomp src/core/gen2/Apricorns.lua FRUIT_TREES (data/items/fruit_trees.asm),
// tree number n = entry n (FRUITTREE_*, 1-based)
const GOLD_FRUIT_TREES = [
  "BERRY", "BERRY", "BERRY", "BERRY", "PSNCUREBERRY", "PSNCUREBERRY", "BITTER_BERRY", "BITTER_BERRY",
  "PRZCUREBERRY", "PRZCUREBERRY", "MYSTERYBERRY", "MYSTERYBERRY", "ICE_BERRY", "ICE_BERRY", "MINT_BERRY", "BURNT_BERRY",
  "RED_APRICORN", "BLU_APRICORN", "BLK_APRICORN", "WHT_APRICORN", "PNK_APRICORN", "GRN_APRICORN", "YLW_APRICORN",
  "BERRY", "PSNCUREBERRY", "BITTER_BERRY", "PRZCUREBERRY", "ICE_BERRY", "MINT_BERRY", "BURNT_BERRY",
];
// Kurt's apricorn balls: the engine's `apricorns` registry seeded from
// Apricorns.BALLS (data/items/apricorn_balls.asm); `index` = Kurt's menu order,
// `event` = its EVENT_GAVE_KURT_* flag
const GOLD_APRICORNS: Record<string, { apricorn: string; ball: string; event: number; index: number }> = {
  RED_APRICORN: { apricorn: "RED_APRICORN", ball: "LEVEL_BALL", event: 600, index: 1 },
  BLU_APRICORN: { apricorn: "BLU_APRICORN", ball: "LURE_BALL", event: 601, index: 2 },
  YLW_APRICORN: { apricorn: "YLW_APRICORN", ball: "MOON_BALL", event: 602, index: 3 },
  GRN_APRICORN: { apricorn: "GRN_APRICORN", ball: "FRIEND_BALL", event: 603, index: 4 },
  WHT_APRICORN: { apricorn: "WHT_APRICORN", ball: "FAST_BALL", event: 604, index: 5 },
  BLK_APRICORN: { apricorn: "BLK_APRICORN", ball: "HEAVY_BALL", event: 605, index: 6 },
  PNK_APRICORN: { apricorn: "PNK_APRICORN", ball: "LOVE_BALL", event: 606, index: 7 },
};
// src/ui/gen2/SlotMachine.lua REELS by symbol name (15 + the first 3 again)
const GOLD_REELS = [
  ["SEVEN", "CHERRY", "STARYU", "PIKACHU", "SQUIRTLE", "SEVEN", "CHERRY", "STARYU", "PIKACHU", "SQUIRTLE", "POKEBALL", "CHERRY", "STARYU", "PIKACHU", "SQUIRTLE", "SEVEN", "CHERRY", "STARYU"],
  ["SEVEN", "PIKACHU", "CHERRY", "SQUIRTLE", "STARYU", "POKEBALL", "PIKACHU", "CHERRY", "SQUIRTLE", "STARYU", "POKEBALL", "PIKACHU", "CHERRY", "SQUIRTLE", "STARYU", "SEVEN", "PIKACHU", "CHERRY"],
  ["SEVEN", "PIKACHU", "CHERRY", "SQUIRTLE", "STARYU", "PIKACHU", "CHERRY", "SQUIRTLE", "STARYU", "PIKACHU", "POKEBALL", "CHERRY", "SQUIRTLE", "STARYU", "PIKACHU", "SEVEN", "PIKACHU", "CHERRY"],
];
const STATUS_NAMES2: [string, string][] = [["sleep", "Sleep"], ["poison", "Poison"], ["toxic", "Bad poison"], ["paralyze", "Paralysis"], ["burn", "Burn"], ["freeze", "Freeze"]];

// the edition load() was called for, and its naming menu's player names
// (gen1recomp src/ui/gen2/NamePick.lua PRESETS; Crystal's girl has her own,
// but the engine's namePresets override is one list for both)
let gameVersion = "gold";
const PLAYER_NAMES: Record<string, string[]> = {
  gold: ["GOLD", "HIRO", "TAYLOR", "KARL"],
  silver: ["SILVER", "KAMON", "OSCAR", "MAX"],
  crystal: ["CHRIS", "MAT", "ALLAN", "JON"],
};
// mart number -> the map people whose script opens it (see load)
const martClerks = new Map<number, { mapId: string; index: number }[]>();

// variable sprite slots (see load): the new game's sprite per slot, the one
// other maps' scripts give it later, and the slots each map's scripts set
const variableSprites = { start: new Map<number, string>(), later: new Map<number, string>(), own: new Map<string, Set<number>>() };

// first facing per movement (gen1recomp src/world/gen2/Npc.lua FACING_FROM_MOVE;
// the rest face down) and the movements that walk around
const FACING: Record<number, Facing> = { 5: "left", 7: "up", 8: "left", 9: "right", 0x1e: "left", 0x1f: "right" };
const WALKS = new Set([2, 4, 5, 0x24]);

// PAL_OW_* in order (constants/sprite_data_constants.asm)
const OW_PALETTES = ["RED", "BLUE", "GREEN", "BROWN", "PINK", "EMOTE", "TREE", "ROCK"];
// the time of day a map is drawn in: the one it pins (its header's PALETTE_*,
// gen1recomp Palettes.daytimeFor), else the one the view shows. A PALETTE_DARK
// cave is drawn as after Flash (night), since pitch black can't be edited.
const PINNED: Record<string, string> = { PALETTE_DAY: "DAY", PALETTE_NITE: "NITE", PALETTE_MORN: "MORN", PALETTE_DARK: "NITE" };
const daytimeOf = (map: MapDef, time: string | undefined) => PINNED[String(map.palette ?? "")] ?? time ?? "DAY";
const asList = (v: unknown) => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : []);
// the next free object number on a map (people's `index`)
const nextObjectIndex = (map: MapDef) => 1 + Math.max(0, ...(asList(map.objects) as { index?: number }[]).map((o) => Number(o.index) || 0));
// an item's number in Gold's rows and records (its record's `index`)
const itemIndex = (ctx: GameContext, id: string) => Number(((ctx.records.items ?? ctx.data.content.items ?? {})[id] as { index?: number } | undefined)?.index ?? 0);

// Crystal tilesets carry GBC attributes per tile id (`tileAttrs`, 1-based
// keys: palette slot and VRAM bank) and a 256-tile sheet (bank 0 at 0-127,
// bank 1 at 128-255). Restates gen1recomp src/world/gen2/MapAttrGrid.lua
// normalizeTile: a block's raw id (bit 7 = bank) -> its attrs -> the sheet
// tile it draws and that tile's palette. Blocks are rewritten to sheet tiles
// and tilePalettes to the palette per sheet tile, which is what the view
// reads (Gold keeps its own tilePalettes and raw ids). In Crystal's data a
// raw id already is its sheet tile (the rewrite changes none), so blocks a mod
// adds with sheet tile ids draw the same in the engine; added tiles go into
// the sheet's blank slots 0xE0-0xFF (tilesets.ts firstAddedTile).
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

const recordsOf = (ctx: GameContext, registry: string) =>
  (ctx.records[registry] ?? ctx.data.content[registry] ?? {}) as Record<string, Record<string, unknown>>;

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
  colorPairs: { registry: "palettes", id: "pokemon" },
  monColors: (ctx, id, shiny) => {
    // the live record first: a new species' colors are only there
    type MonPal = Record<string, { normal?: [number, number, number][]; shiny?: [number, number, number][] }>;
    const pal = (recordsOf(ctx, "palettes").pokemon as MonPal | undefined)?.[id] ?? (palettes(ctx) as { pokemon?: MonPal }).pokemon?.[id];
    const pair = shiny ? pal?.shiny : pal?.normal;
    return pair?.length === 2 ? [[255, 255, 255], pair[0], pair[1], [0, 0, 0]].map((c) => [c[0], c[1], c[2]] as Rgb) : null;
  },
  // menu icons are the icons registry: species -> ICON_* sheet name
  icon: {
    width: 16,
    height: 16,
    frames: 2,
    registry: "icons",
    names: (ctx) => Object.keys(ctx.records.icons ?? {}).filter((k) => k.startsWith("ICON_")).sort(),
    path: (ctx, name) => (ctx.records.icons?.[name] as { image?: string } | undefined)?.image,
    resolve: (ctx, r) => {
      const name = typeof r.id === "string" ? ctx.records.icons?.[r.id] : undefined;
      return typeof name === "string" ? { name } : {};
    },
  },
  // a copy keeps its source's menu icon (icons[species] = sheet name) and colors
  speciesExtras: (sourceId, newId, ctx) => {
    const out: { registry: string; id: string; value: unknown }[] = [];
    const icon = ctx.records.icons?.[sourceId];
    if (typeof icon === "string") out.push({ registry: "icons", id: newId, value: icon });
    const table = recordsOf(ctx, "palettes").pokemon as Record<string, unknown> | undefined;
    if (table?.[sourceId]) out.push({ registry: "palettes", id: "pokemon", value: { ...table, [newId]: structuredClone(table[sourceId]) } });
    return out;
  },
  dropExtras: (id, ctx) => {
    const out: { registry: string; id: string; value: unknown }[] = [];
    if (ctx.records.icons?.[id] !== undefined) out.push({ registry: "icons", id, value: undefined });
    const table = recordsOf(ctx, "palettes").pokemon as Record<string, unknown> | undefined;
    if (table?.[id]) {
      const rest = { ...table };
      delete rest[id];
      out.push({ registry: "palettes", id: "pokemon", value: rest });
    }
    return out;
  },
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
  effects: (ctx) => [...new Set([
    ...Object.values(recordsOf(ctx, "moves")).map((m) => m.effect).filter((e): e is string => typeof e === "string"),
    ...Object.keys(recordsOf(ctx, "studio_effects")),
  ])].sort(),
  categories: [],
  battleDetails: false,
  effectChance: true,
  description: { lines: 2, lineMax: 18 },
  // gen1recomp Battle.lua reads accuracyRaw / effectChanceRaw first
  rawBytes: { accuracy: "accuracyRaw", effectChance: "effectChanceRaw" },
  animTable: { registry: "battle_anims", id: "moves" },
  // a copy has no number (Gold's battle, party and TMs go by move id) and plays its
  // source's animation: battle_anims "moves" maps a move id to a script pointer
  moveExtras: (sourceId, newId, ctx) => {
    const table = recordsOf(ctx, "battle_anims").moves as Record<string, unknown> | undefined;
    return table?.[sourceId] !== undefined ? [{ registry: "battle_anims", id: "moves", value: { ...table, [newId]: table[sourceId] } }] : [];
  },
  dropMoveExtras: (id, ctx) => {
    const table = recordsOf(ctx, "battle_anims").moves as Record<string, unknown> | undefined;
    if (table?.[id] === undefined) return [];
    const rest = { ...table };
    delete rest[id];
    return [{ registry: "battle_anims", id: "moves", value: rest }];
  },
  // studio_effects.lua -> src/lua/effectRuntime2.ts (Gold's record shapes)
  custom: {
    registry: "studio_effects",
    stats: GEN2_STATS,
    statuses: GEN2_STATUSES,
    describe: gen2EffectText,
    template: gen2EffectTemplate,
    secondaryOnly: true,
  },
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
  // custom effects on a party Pokémon, one per item (src/lua/itemEffectRuntime2.ts);
  // no balls or shops here yet
  effectRegistry: "studio_item_effects",
  byItem: { field: "fieldMenu", battle: "battleMenu", on: "ITEMMENU_PARTY", off: "ITEMMENU_NOUSE" },
  stats: [],
  expStats: GEN2_EXP_STATS,
  statuses: GEN2_ITEM_STATUSES,
  tossAnims: [],
  describe: gen2ItemText,
  template: gen2ItemTemplate,
  special: gen2SpecialItem,
  // the cart's unused slots are all named TERU-SAMA (ITEM_19 ..., and Gold's
  // POKE_FLUTE / TOWN_MAP, which the Pokégear replaced)
  internal: (id, item) => (item?.name === "TERU-SAMA" || /^ITEM_[0-9A-F]{2}$/.test(id) ? "An unused item slot of the game (named TERU-SAMA)." : null),
  picksMove: gen2PicksMove,
  marts: () => [],
  // Gold's items are numbered 1-250; 251-254 are free (0 = none, 255 ends a list)
  newIndex: (ctx) => {
    const used = new Set(Object.values(recordsOf(ctx, "items")).map((r) => r.index));
    for (let n = 251; n <= 254; n++) if (!used.has(n)) return n;
    return undefined;
  },
  noIndex: "Gold's free item numbers (251-254) are used up: this item has no number, so item balls, hidden items and give-item commands can't hand it out. It works in shops, the bag, as a held item and in trainer AI.",
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
  uses: (ctx, id) => {
    const out: ItemUse[] = [];
    const rec = (reg: string) => (ctx.records[reg] ?? {}) as Record<string, Record<string, unknown>>;
    const mapName = (m: string) => String(ctx.maps[m]?.label ?? m);
    // the game's shops (stock read-only, ISSUES #6), at the clerks that open them
    const lists = (ctx.data.extra as { marts?: string[][] }).marts ?? [];
    lists.forEach((list, n) => {
      if (!list.includes(id)) return;
      const clerks = martClerks.get(n) ?? [];
      if (!clerks.length) out.push({ label: `Shop ${n}` });
      // a clerk opening two marts (stock before/after an event) shows once
      for (const c of clerks) if (!out.some((u) => u.map?.id === c.mapId && u.map.index === c.index)) out.push({ label: `Shop: ${mapName(c.mapId)}`, map: { id: c.mapId, layer: "objects", index: c.index } });
    });
    // trainers: the class's battle items (AI) and held items in its teams
    for (const [cls, r] of Object.entries(rec("trainers"))) {
      const name = String(r.name ?? cls);
      // class ids, not names: every gym leader class is named LEADER
      if (asList(r.items).includes(id)) out.push({ label: `Trainer AI: ${cls}`, trainer: { id: cls } });
      (asList(r.trainers) as { name?: string; party?: unknown }[]).forEach((t, i) => {
        if ((asList(t.party) as { item?: string }[]).some((s) => s.item === id)) out.push({ label: `Held: ${name} ${t.name ?? i + 1}`, trainer: { id: cls, team: i } });
      });
    }
    // wild Pokémon holding it
    for (const [pid, m] of Object.entries(rec("pokemon"))) {
      if (Object.values((m.items ?? {}) as Record<string, string>).includes(id)) out.push({ label: `Wild ${String(m.name ?? pid)} holds it`, pokemon: pid });
    }
    // item balls and hidden items (by item number)
    const n = itemIndex(ctx, id);
    for (const [mid, m] of Object.entries(ctx.maps)) {
      (asList(m.objects) as { itemball?: { item?: number } }[]).forEach((o, i) => {
        if (o.itemball?.item === n) out.push({ label: `Item ball: ${mapName(mid)}`, map: { id: mid, layer: "objects", index: i } });
      });
      (asList(m.bgEvents) as { hiddenItem?: { item?: number } }[]).forEach((b, i) => {
        if (b.hiddenItem?.item === n) out.push({ label: `Hidden: ${mapName(mid)}`, map: { id: mid, layer: "bgEvents", index: i } });
      });
    }
    return out;
  },
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
  // Encounter.treeSetUsable: Gold/Silver skip these sets (GS_DEAD_SETS)
  trees: { map: "trees", rocks: "rocks", sets: "treeSets", unused: (v) => (v === "crystal" ? ["TREEMON_SET_NONE"] : ["TREEMON_SET_NONE", "TREEMON_SET_UNUSED", "TREEMON_SET_CITY"]) },
  swarms: { grass: "swarmGrass", water: "swarmWater" },
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
      // the game's flags, plus every flag a map names now: people's
      // visibility flags, studio trainers' and the studio's inline events'
      const taken = new Set(usedFlags);
      JSON.stringify(Object.values(ctx.maps), (k, v: unknown) => {
        if ((k === "event" || k === "eventFlag") && typeof v === "number") taken.add(v);
        return v;
      });
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
  colorPairs: { registry: "palettes", id: "trainers" },
  picColors: (ctx, classId) => {
    // the palettes registry (a mod's new class has its own entry), else the file's
    const own = recordsOf(ctx, "palettes").trainers as Record<string, [number, number, number][]> | undefined;
    const pair = own?.[classId] ?? (palettes(ctx) as { trainers?: Record<string, [number, number, number][]> }).trainers?.[classId];
    return pair?.length === 2 ? [[255, 255, 255], pair[0], pair[1], [0, 0, 0]].map((c) => [c[0], c[1], c[2]] as Rgb) : null;
  },
  ai: false,
  // gen1recomp src/battle/gen2/Ai.lua: FLAGS (TRNATTR_AI_MOVE_WEIGHTS, attribute
  // bytes 4-5), SWITCH_FLAGS / SWITCH_CHANCES (bytes 6-7), ITEM_ORDER (AI_TryItem)
  aiAttributes: {
    aiByte: 3,
    switchByte: 5,
    layers: [
      { bit: 0x0001, label: "Basic", about: "Avoids moves that would do nothing: a status move on a Pokémon that already has one, an effect that already landed." },
      { bit: 0x0002, label: "Setup", about: "Uses stat-changing moves on its first turn, and hardly ever later." },
      { bit: 0x0004, label: "Types", about: "Prefers super-effective moves, avoids not-very-effective ones and never uses moves the target is immune to." },
      { bit: 0x0008, label: "Offensive", about: "Avoids moves that do no damage." },
      { bit: 0x0010, label: "Smart", about: "Move-by-move tactics: healing when low, Dream Eater on a sleeping target, and many more." },
      { bit: 0x0020, label: "Opportunist", about: "Stops stalling (Toxic, Reflect, Substitute …) when its Pokémon is nearly fainted." },
      { bit: 0x0040, label: "Aggressive", about: "Prefers the move that hits hardest." },
      { bit: 0x0080, label: "Cautious", about: "Usually stops using lasting moves (Toxic, Leech Seed …) after its first turn." },
      { bit: 0x0100, label: "Status", about: "Never uses a status move on a target that already has that status." },
      { bit: 0x0200, label: "Risky", about: "Goes for a knockout whenever one is possible." },
    ],
    switching: [
      { bit: 0x0001, label: "Often", about: "Switches out half the time when its Pokémon is at a disadvantage, nearly always when it's badly off." },
      { bit: 0x0004, label: "Sometimes", about: "Switches out a fifth of the time at a disadvantage, half the time when badly off." },
      { bit: 0x0002, label: "Rarely", about: "Switches out only now and then (8–21%)." },
    ],
    items: ["FULL_RESTORE", "MAX_POTION", "HYPER_POTION", "SUPER_POTION", "POTION", "X_ACCURACY", "FULL_HEAL", "GUARD_SPEC", "DIRE_HIT", "X_ATTACK", "X_DEFEND", "X_SPEED", "X_SPECIAL"],
    itemSlots: 2,
  },
  colors: false,
  basePic: false,
};

// ------------------------------------------------------------------ global

const globals: GlobalsSpec = {
  sections: [
    { id: "types", group: "Game", label: "Type chart", hint: "Type effectiveness, and which types are physical or special (Gold decides by type, like Red)." },
    { id: "status", group: "Game", label: "Status conditions", hint: "How much each status helps catching, and the stat Burn and Paralysis cut. What the statuses do in battle (damage, skipped turns) is the engine's code." },
    { id: "fieldmoves", group: "Game", label: "HM badges", hint: "Which badge each field move needs before it can be used on the map." },
    { id: "fishing", group: "Wild Pokémon", label: "Fishing groups", hint: "What bites on each rod. Maps with the same water share a group; a map picks its group in its Encounters tab." },
    { id: "treesets", group: "Wild Pokémon", label: "Headbutt & Rock Smash sets", hint: "What falls out of trees and rocks. Many maps share a set; a map picks its sets in its Encounters tab." },
    { id: "intro", group: "New game", label: "Oak's speech", hint: "What Oak says before the game starts, the Pokémon he shows, and steps of your own." },
    { id: "start", group: "New game", label: "Start values", hint: "Where a new game starts and the money the player has." },
    { id: "starters", group: "New game", label: "Starter Pokémon", hint: "What the three balls in Elm's lab give, at which level." },
    { id: "gifts", group: "Other", label: "Gift Pokémon", hint: "The Pokémon people give the player: which Pokémon and at which level. What they say about it are texts: the buttons open them." },
    { id: "trades", group: "Other", label: "In-game trades", hint: "What each trading person wants, what they give, and how it arrives: nickname, held item, original trainer." },
    { id: "slots", group: "Other", label: "Slot machines", hint: "The symbols on the Game Corner's three slot reels." },
    { id: "fruittrees", group: "Other", label: "Fruit trees", hint: "The item each fruit tree gives once a day. A tree on the map is a person whose role is Fruit tree, with its number." },
    { id: "apricorns", group: "Other", label: "Kurt's apricorn balls", hint: "Which ball Kurt makes from each apricorn." },
    { id: "phone", group: "Other", label: "Phone contacts", hint: "The Pokégear phone book: where each contact stands, when calls happen, who gives the number and what is said on the phone. The game has a fixed set of contacts: a mod changes them but can't add new ones." },
    { id: "sounds", group: "Other", label: "Music & sounds", hint: "Your own songs and sound effects (sound files), and game songs or sounds replaced by files. A map's song is picked in its properties." },
  ],
  numbers: [
    ...STATUS_NAMES2.map(([id, name]): GlobalNumber => ({ section: "status", registry: "statuses", id, key: "catchBonus", label: `${name}: catch bonus`, hint: `Makes a ${name.toLowerCase()} Pokémon easier to catch: added to the ball's catch rate (out of 255; higher is easier).`, min: 0, max: 255 })),
    { section: "status", registry: "statuses", id: "burn", key: "statPenalty.div", label: "Burn: Attack divided by", hint: "A burned Pokémon's Attack is divided by this (1 = no cut).", min: 1, max: 255 },
    { section: "status", registry: "statuses", id: "paralyze", key: "statPenalty.div", label: "Paralysis: Speed divided by", hint: "A paralyzed Pokémon's Speed is divided by this (1 = no cut).", min: 1, max: 255 },
  ],
  defaults: { statuses: GOLD_STATUSES },
  hmBadges: { registry: "studio_field_moves", id: "badges", moves: Object.keys(GOLD_HM_BADGES), badges: JOHTO_BADGES },
  fruitTrees: { registry: "studio_fruit_trees", id: "trees" },
  phone: {
    registry: "phone_contacts",
    // the VM has one string buffer: {STRBUF} shows what the last of these rows
    // put there (gen1recomp Vm:setStringBuffer; specials 90-92 = Specials.lua's
    // phone name-drops). Rows are walked in order, calls return, jumps don't.
    buffers: (ctx, keys) => {
      const out = new Map<string, Set<string>>();
      const text = ctx.data.content.text ?? {};
      const specials = (ctx.data.extra as { specialOrder?: string[] }).specialOrder ?? [];
      const fills = (r: Record<string, unknown>): string | undefined => {
        switch (r.op) {
          case "getmonname": return "a Pokémon's name";
          case "getitemname": case "verbosegiveitem": case "verbosegiveitemvar": case "fruittree": return "an item's name";
          case "gettrainername": return "a trainer's name";
          case "gettrainerclassname": return "a trainer class";
          case "getlandmarkname": case "getcurlandmarkname": return "a place name";
          case "getstring": return typeof r.string === "string" ? `“${r.string}”` : "a word";
          case "getname": return "a name";
          case "getnum": return "a number";
          case "getmoney": case "getcoins": return "an amount";
          case "describedecoration": return "a decoration's name";
          case "special": {
            const name = specials[Number(r.id)];
            if (name === "RandomPhoneMon") return "one of the caller's own Pokémon";
            if (name === "RandomPhoneWildMon") return "a wild Pokémon from the caller's map";
            if (name === "RandomUnseenWildMon") return "a rare wild Pokémon from the caller's map";
            return undefined;
          }
        }
        return undefined;
      };
      const visited = new Set<string>();
      // returns the buffer after the rows ran (undefined: nothing set yet)
      const run = (key: string, cur: string | undefined, depth: number): string | undefined => {
        const rows = scriptRows[key];
        if (!Array.isArray(rows) || depth > 12 || visited.has(`${key}|${cur}`)) return cur;
        visited.add(`${key}|${cur}`);
        for (const r of rows as Record<string, unknown>[]) {
          cur = fills(r) ?? cur;
          for (const v of Object.values(r)) {
            if (typeof v !== "string") continue;
            if (typeof text[v] === "string" && text[v].includes("{STRBUF}")) {
              const set = out.get(v) ?? new Set<string>();
              set.add(cur ?? "whatever an earlier script left there");
              out.set(v, set);
            }
          }
          const target = typeof r.script === "string" ? r.script : undefined;
          if (!target) continue;
          if (r.op === "sjump" || r.op === "farsjump") return run(target, cur, depth + 1);
          if (r.op === "scall" || r.op === "farscall") cur = run(target, cur, depth + 1);
          else run(target, cur, depth + 1);
        }
        return cur;
      };
      for (const k of keys) run(k, undefined, 0);
      return out;
    },
    // every map person whose script (followed through calls) runs askforphonenumber n
    givers: (ctx) => {
      const out = new Map<number, { map: string; index: number }[]>();
      for (const [mapId, m] of Object.entries(ctx.maps)) {
        (asList(m.objects) as { scriptKey?: unknown; trainer?: { scriptKey?: unknown } }[]).forEach((o, index) => {
          const seen = new Set<string>();
          const found = new Set<number>();
          const walk = (v: unknown): void => {
            JSON.stringify(v, (_k, x: unknown) => {
              if (typeof x === "string" && x in scriptRows && !seen.has(x)) {
                seen.add(x);
                walk(scriptRows[x]);
              } else if (x && typeof x === "object" && (x as { op?: unknown }).op === "askforphonenumber") {
                const n = ((x as { args?: number[] }).args ?? [])[0];
                if (typeof n === "number") found.add(n);
              }
              return x;
            });
          };
          walk([o.scriptKey, o.trainer?.scriptKey]);
          for (const n of found) out.set(n, [...(out.get(n) ?? []), { map: mapId, index }]);
        });
      }
      return out;
    },
  },
  apricorns: { registry: "apricorns" },
  // the reel sheet: symbol byte n is the 16x16 at (0, n / 4 * 16) (SlotMachine:drawReels)
  slots: {
    registry: "studio_slots", id: "reels", order: ["SEVEN", "POKEBALL", "CHERRY", "PIKACHU", "SQUIRTLE", "STARYU"],
    payouts: "SEVEN pays 300, POKéBALL 50, CHERRY 6, PIKACHU 8, SQUIRTLE 10, STARYU 15",
    // a plain literal: a module-level call would survive tree shaking (release builds)
    art: {
      SEVEN: { sheet: "assets/generated/slots/gold_slots_2.png", x: 0, y: 0, w: 16, h: 16 },
      POKEBALL: { sheet: "assets/generated/slots/gold_slots_2.png", x: 0, y: 16, w: 16, h: 16 },
      CHERRY: { sheet: "assets/generated/slots/gold_slots_2.png", x: 0, y: 32, w: 16, h: 16 },
      PIKACHU: { sheet: "assets/generated/slots/gold_slots_2.png", x: 0, y: 48, w: 16, h: 16 },
      SQUIRTLE: { sheet: "assets/generated/slots/gold_slots_2.png", x: 0, y: 64, w: 16, h: 16 },
      STARYU: { sheet: "assets/generated/slots/gold_slots_2.png", x: 0, y: 80, w: 16, h: 16 },
    },
  },
  // gen1recomp src/ui/gen2/OakSpeech.lua defaultSteps (Crystal adds gender_select
  // in front at run time; the helper keeps steps it doesn't know in place)
  intro: {
    steps: [
      { id: "init_clock", kind: "initclock", label: "Setting the clock" },
      { id: "oak_welcome", kind: "say", textKey: "_OakText1", pic: "oak", reveal: "rotate", label: "Oak's welcome" },
      { id: "demo_mon", kind: "demo", textKey: "_OakText2", label: "Oak shows a Pokémon" },
      { id: "world_spiel", kind: "say", textKey: "_OakText4", label: "The world of Pokémon" },
      { id: "oak_study", kind: "say", textKey: "_OakText5", pic: "oak", reveal: "rotate", label: "Oak's research" },
      { id: "ask_player_name", kind: "say", textKey: "_OakText6", pic: "player", reveal: "rotate", label: "Asks the player's name" },
      { id: "name_player", kind: "name", label: "Naming the player" },
      { id: "legend", kind: "say", textKey: "_OakText7", pic: "player", label: "Your story begins" },
      { id: "shrink", kind: "shrink", label: "The player shrinks into the world" },
    ],
    required: ["init_clock", "name_player", "shrink"],
    textRegistry: "studio_intro_text",
    demo: { registry: "studio_intro", id: "demo", key: "species", game: "MARILL" },
    pics: ["", "oak", "player", "pokemon"],
    reveals: ["", "fade", "wipe", "rotate"],
    flags: false,
  },
  // gen1recomp src/core/gen2/NpcTrade.lua; who offers trade n: map people whose
  // script (followed through calls) runs `trade` with id n - 1
  trades: {
    registry: "studio_trades", id: "trades", dialogKey: "dialog", nickMax: 10, otMax: 7,
    dialogNote: "Which set of lines the person speaks: the offer, the answer to a no or to the wrong Pokémon, the thanks, and what they say on a later visit.",
    // gen1recomp src/ui/gen2/TradeMenu.lua fill: wStringBuffer1 = the wanted mon (+ its gender sign),
    // wStringBuffer2 = the one you get, wMonOrItemNameBuffer = the wanted mon again
    offerLine: (ctx, t) => {
      const intro = ctx.data.extra.tradeIntro as { texts: Record<string, string>; buffers: Record<string, string[]> } | undefined;
      const set = String(t.dialog ?? "");
      const body = intro?.texts[set];
      if (typeof body !== "string") return "";
      const name = (id: unknown) => String((recordsOf(ctx, "pokemon")[String(id)] as { name?: unknown } | undefined)?.name ?? id);
      const sign = t.gender === "TRADE_GENDER_MALE" ? "♂" : t.gender === "TRADE_GENDER_FEMALE" ? "♀" : "";
      const by: Record<string, string> = { wStringBuffer1: name(t.give) + sign, wStringBuffer2: name(t.get), wMonOrItemNameBuffer: name(t.give) };
      const bufs = intro?.buffers[set] ?? [];
      let n = 0;
      return body.replace(/\{STRBUF\}/g, () => by[bufs[n++] ?? "wStringBuffer1"] ?? "").replace(/\{[A-Z_]+\}/g, "").replace(/[\n\v\f\u000b\u000c]/g, " ").replace(/\s+/g, " ").trim();
    },
    dialogs: [
      { value: "TRADE_DIALOGSET_COLLECTOR", label: "Collector" },
      { value: "TRADE_DIALOGSET_HAPPY", label: "Happy" },
      // (Crystal also has TRADE_DIALOGSET_GIRL: Gold has no texts for it)
      { value: "TRADE_DIALOGSET_NEWBIE", label: "Newbie" },
    ],
    offers: (ctx) => {
      const out = new Map<number, { label: string; map: string; layer: string; index: number }[]>();
      for (const [mapId, m] of Object.entries(ctx.maps)) {
        (asList(m.objects) as { scriptKey?: unknown }[]).forEach((o, index) => {
          if (typeof o.scriptKey !== "string") return;
          const seen = new Set<string>();
          const walk = (k: string) => {
            if (seen.has(k) || !(k in scriptRows)) return;
            seen.add(k);
            JSON.stringify(scriptRows[k], (_p, v: unknown) => {
              if (typeof v === "string" && v in scriptRows) walk(v);
              else if (v && typeof v === "object" && (v as { op?: unknown }).op === "trade") {
                const id = Number((v as { trade?: number }).trade);
                if (Number.isFinite(id)) out.set(id + 1, [...(out.get(id + 1) ?? []), { label: mapId, map: mapId, layer: "objects", index }]);
              }
              return v;
            });
          };
          walk(o.scriptKey);
        });
      }
      return out;
    },
  },
  // every map person whose script (followed through calls) gives a Pokémon;
  // Elm's lab is the starters
  gifts: (ctx) => {
    const mons = recordsOf(ctx, "pokemon");
    const byNumber = (n: unknown) => Object.keys(mons).find((id) => mons[id].index === n);
    const out: GameGift[] = [];
    for (const [mapId, m] of Object.entries(ctx.maps)) {
      if (mapId === "ELMS_LAB") continue;
      (asList(m.objects) as { scriptKey?: unknown }[]).forEach((o, index) => {
        if (typeof o.scriptKey !== "string") return;
        const seen = new Set<string>();
        const gives: Record<string, unknown>[] = [];
        let coins = false;
        const walk = (k: string) => {
          if (seen.has(k) || !(k in scriptRows)) return;
          seen.add(k);
          JSON.stringify(scriptRows[k], (_p, v: unknown) => {
            if (typeof v === "string" && v in scriptRows) walk(v);
            else if (v && typeof v === "object" && (v as { op?: unknown }).op === "givepoke") gives.push(v as Record<string, unknown>);
            else if (v && typeof v === "object" && (v as { op?: unknown }).op === "takecoins") coins = true;
            return v;
          });
        };
        walk(o.scriptKey);
        for (const g of gives) {
          const species = byNumber(g.species);
          if (!species || out.some((x) => x.map === mapId && x.species === species)) continue;
          out.push({
            map: mapId, text: null, species, level: Number(g.level ?? 5),
            texts: gen2.scriptTexts?.(ctx, o.scriptKey as string) ?? [],
            at: { layer: "objects", index },
            note: coins ? "A Game Corner prize, bought with coins." : undefined,
            // givepoke's trainer arm (the extractor reads name / otName)
            // (the World gives every gift with a trainer RANDY_OT_ID 1001)
            named: { nickname: g.trainer && typeof g.name === "string" ? g.name : "", otName: g.trainer && typeof g.otName === "string" ? g.otName : "", otId: 1001 },
          });
        }
      });
    }
    return out.sort((a, b) => a.map.localeCompare(b.map) || a.species.localeCompare(b.species));
  },
  starters: {
    // the ELMS_LAB objects whose script gives a Pokémon (givepoke), read from
    // the game's own rows: the species number, the question before yesorno
    balls: (ctx) => {
      const mons = recordsOf(ctx, "pokemon");
      const byNumber = (n: unknown) => Object.keys(mons).find((id) => mons[id].index === n);
      const out: { ball: string; ask: string; level: number }[] = [];
      for (const o of asList(ctx.maps.ELMS_LAB?.objects) as { scriptKey?: unknown }[]) {
        const rows = typeof o.scriptKey === "string" ? (scriptRows[o.scriptKey] as Record<string, unknown>[] | undefined) : undefined;
        const give = rows?.find((r) => r.op === "givepoke");
        const ask = rows?.[rows.findIndex((r) => r.op === "yesorno") - 1]?.text;
        const ball = give && byNumber(give.species);
        if (ball && typeof ask === "string" && !out.some((b) => b.ball === ball)) out.push({ ball, ask, level: Number(give.level ?? 5) });
      }
      return out;
    },
    question: (name, type) => `ELM: Do you want\n${name}, the\v${type.toLowerCase()} POKéMON?{DONE}`,
    rivals: [{ id: "RIVAL1", label: "Rival (early)" }, { id: "RIVAL2", label: "Rival (later)" }],
    // the World gives a mon by its number (givepoke): a new species has none
    canGive: (r) => typeof r.index === "number",
    note: "He steals the ball strong against yours, but his teams are trainer data: change the rival's teams to match.",
  },
  start: {
    names: { id: "names", max: 7, note: "The names the player can pick when Oak asks for one; NEW NAME, the last entry, lets them type one. A mod's names are used in Gold, Silver and Crystal alike (Crystal's girl too). The rival is always typed, so he has none." },
    registry: "studio_start", id: "start", maxMoney: 999999, note: "The game starts in the bedroom upstairs (PLAYERS_HOUSE_2F 3, 3). The same cell is where the player wakes up after blacking out before visiting a Pokémon Center. The player faces the way the game's start does." },
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
  workspaces: ["maps", "pokemon", "moves", "items", "trainers", "text", "events", "graphics", "global"],
  events: GEN2_EVENTS,
  roles: "gen2",
  textSets: [{ registry: "text", label: "Script texts" }, { registry: "rom_text", label: "Game texts" }],
  scriptTexts(ctx, key) {
    if (!(key in scriptRows)) return undefined;
    const known = scriptTextMemo.get(key);
    if (known) return known;
    const text = ctx.data.content.text ?? {};
    const out = new Set<string>();
    const seen = new Set<string>();
    // a row names texts (writetext, trainer lines, ...) and other scripts
    // (scall, jump, ...) by the same kind of pointer string
    const walk = (k: string) => {
      if (seen.has(k)) return;
      seen.add(k);
      JSON.stringify(scriptRows[k], (_p, v: unknown) => {
        if (typeof v === "string") {
          if (typeof text[v] === "string") out.add(v);
          else if (v in scriptRows) walk(v);
        }
        return v;
      });
    };
    walk(key);
    const list = [...out];
    scriptTextMemo.set(key, list);
    return list;
  },
  graphicsViews: ["tilesets", "sprites", "images", "palettes", "townmap"],
  // gen1recomp Pokegear:region: from PALLET_TOWN's number on it is Kanto, the FAST_SHIP excepted
  townMap2: {
    landmarks: "landmarks", grids: "studio_townmap", sheet: "assets/generated/pokegear/gear.png", nameMax: 11,
    regionOf: (ctx, id) => {
      const all = recordsOf(ctx, "landmarks") as Record<string, { index?: number }>;
      const n = Number(all[id]?.index ?? 0);
      const pallet = Number(all.LANDMARK_PALLET_TOWN?.index ?? 0x2e);
      const ship = Number(all.LANDMARK_FAST_SHIP?.index ?? 0x5e);
      return n !== ship && n >= pallet ? "kanto" : "johto";
    },
    // Pokegear:colorsFor (TownMapPals): a nybble per tile id below $60, palette 0 from there
    colors: (ctx) => {
      const c = ctx.data.extra.pokegearColors as { palMap: number[]; palettes: [number, number, number][][] } | undefined;
      return c?.palettes.length ? { ...c, fontFrom: 0x60 } : null;
    },
  },
  images: GEN2_IMAGES,
  // gen1recomp Schemas sprites.gen2Fields: spriteType, palette + paletteId (0-7)
  spriteModel: {
    types: { walker: "WALKING_SPRITE", turner: "STANDING_SPRITE", object: "STILL_SPRITE" },
    palettes: OW_PALETTES.map((n) => `PAL_OW_${n}`),
    // Crystal's player picks a girl (Kris) or a boy; Gold/Silver have Chris only
    player: (version) => (version === "crystal" ? "SPRITE_KRIS" : "SPRITE_CHRIS"),
    // gen1recomp src/world/gen2/FieldMoves.lua STATE_SPRITE / STATE_SPRITE_FEMALE
    // (Kris: Crystal only); the surfing sprites are shared
    players: (version) => [
      { who: "Chris", roles: [["On foot", "SPRITE_CHRIS"], ["On the bike", "SPRITE_CHRIS_BIKE"], ["Surfing", "SPRITE_SURF"], ["Surfing on Pikachu", "SPRITE_SURFING_PIKACHU"]] },
      ...(version === "crystal" ? [{ who: "Kris", roles: [["On foot", "SPRITE_KRIS"], ["On the bike", "SPRITE_KRIS_BIKE"], ["Surfing", "SPRITE_SURF"], ["Surfing on Pikachu", "SPRITE_SURFING_PIKACHU"]] as [string, string][] }] : []),
    ],
  },
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
  // Game2:continueGame on the picked cell (src/lua/playRuntime.ts)
  playtestMain: playtestMain2,
  scenes: {
    list: (map) => scenesOf(map, scriptRows),
    withScripts: scenesWithScripts,
    names: sceneNames,
    setName: setSceneName,
    blocksIn: blocksInScene,
    changedBlocks: (map, n) => sceneBlocks(map).get(n)?.size ?? 0,
    setBlock: setSceneBlock,
    clearBlocks: clearSceneBlocks,
    script: sceneScriptOf,
    setScript: setSceneScript,
  },
  // studio scripts and movements as map_scripts records (engine 070ca01+)
  scripts: { registry: "map_scripts", outline: outlineScripts, inline: inlineScripts, owns: ownsScript },

  async load(read, version): Promise<Dataset> {
    gameVersion = version ?? "gold";
    gen2.viewOnly = undefined;
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
    scriptRows = scripts;
    scriptTextMemo.clear();
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
    let martsOpened: number[] = [];
    const slotsSetFrom = (roots: string[]): Set<number> => {
      const seen = new Set<string>();
      const slots = new Set<number>();
      fights = [];
      martsOpened = [];
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
          // pokemart args: type, mart number low/high byte
          if (row.op === "pokemart") martsOpened.push(Number(args[1] ?? 0) + Number(args[2] ?? 0) * 256);
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
    martClerks.clear();
    // every event flag the game's data names (map people, scripts, new-game
    // flags): a studio trainer's "beaten" flag must be none of them
    usedFlags.clear();
    startFlags.clear();
    for (const f of asList((initial as { flags?: unknown }).flags) as number[]) startFlags.add(f);
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
        for (const n of martsOpened) martClerks.set(n, [...(martClerks.get(n) ?? []), { mapId: id, index: i }]);
      });
      slotsSetFrom(keys.filter((k) => !objectKeys.has(k)));
      for (const f of fights) fight(f, { mapId: id, index: -1 });
    }
    for (const m of Object.values(maps)) gen2.normalizeMap(m);
    // tilesets.lua also holds the animation frame sheets (animFrames,
    // waterFrames, ...): only records with a sheet and blocks are tilesets
    const animSheets = tilesets as unknown as TileAnimSheets;
    const tileAnim: TileAnimSheets = { waterFrames: animSheets.waterFrames, flowerFrames: animSheets.flowerFrames, flowerCgbFrames: asList(animSheets.flowerCgbFrames) as number[] };
    for (const [k, t] of Object.entries(tilesets)) if (!t || typeof t !== "object" || typeof t.image !== "string" || !t.blocks) delete tilesets[k];
    for (const t of Object.values(tilesets)) crystalTiles(t);
    const monFile = tables[content.findIndex((c) => c.registry === "pokemon")] as { growthRates?: Record<string, unknown> } | undefined;
    // the trades' offer lines per dialogue style, and which name goes in each {STRBUF}
    type TradeTables = { tradeTexts?: Record<string, unknown>; tradeBuffers?: Record<string, unknown> };
    const eventsFile = tables[content.findIndex((c) => c.registry === "studio_trades")] as TradeTables | undefined;
    const tradeIntro = { texts: eventsFile?.tradeTexts?.TRADE_DIALOG_INTRO ?? {}, buffers: eventsFile?.tradeBuffers?.TRADE_DIALOG_INTRO ?? {} };
    type MenuGfx = { battleHud?: { trainerPics?: Record<string, string> }; pokegear?: { palMap?: unknown; palettes?: unknown } };
    const menuGfx = await (read("menu_gfx.lua") as Promise<MenuGfx>).catch(() => ({}) as MenuGfx);
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
    // the Roles' scripts: the game's std scripts by name (jumpstd rows name
    // them with their scripts.lua key) and its shops' stock lists
    const stdScripts: Record<string, string> = {};
    JSON.stringify(scripts, (_k, v: { op?: unknown; std?: unknown; script?: unknown } | unknown) => {
      const r = v as { op?: unknown; std?: unknown; script?: unknown };
      if (r && r.op === "jumpstd" && typeof r.std === "string" && typeof r.script === "string") stdScripts[r.std] ??= r.script;
      return v;
    });
    const marts = await (read("marts.lua") as Promise<{ lists?: string[][] }>).catch(() => ({}) as { lists?: string[][] });
    // events' sounds, songs and specials go by their place in these lists
    const lists = constants as { sfxOrder?: string[]; musicOrder?: string[]; specialOrder?: string[] };
    return {
      maps, tilesets, sprites, content: contentTables,
      extra: {
        palettes: pal, roofs, tradeIntro, pokegearColors: { palMap: asList(menuGfx.pokegear?.palMap), palettes: asList(menuGfx.pokegear?.palettes).map((p) => asList(p)) }, growthRates: Object.keys(monFile?.growthRates ?? {}), johtoDex: asList(pokedex.newOrder), trainerPics: menuGfx.battleHud?.trainerPics ?? {}, stdScripts, marts: asList(marts.lists),
        sfxOrder: asList(lists.sfxOrder), musicOrder: asList(lists.musicOrder), specialOrder: asList(lists.specialOrder),
        // the game's scripts, shown read-only (and copied) in Events
        scripts,
        // the shared water / flower frame strips the tileset animations name
        tileAnim,
      },
    };
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
        { kind: "select", key: "sprite", label: "Sprite", group: "looks", options: (ctx) => Object.keys(ctx.data.sprites).sort(), labels: (v) => (/^\d+$/.test(v) ? `Changes during the game (${v})` : undefined) },
        { kind: "select", key: "movement", label: "Movement", group: "movement", numeric: true, options: () => Object.keys(MOVEMENTS), labels: (v) => MOVEMENTS[Number(v)] },
        {
          kind: "pair",
          group: "movement",
          fields: [
            { kind: "int", key: "radius.x", label: "Walk range ←→", min: 0, max: 15, hint: "Cells it may wander from its spot" },
            { kind: "int", key: "radius.y", label: "Walk range ↑↓", min: 0, max: 15 },
          ],
        },
        {
          kind: "pair",
          group: "when",
          fields: [
            { kind: "int", key: "hours.0", label: "From hour", min: -1, max: 23, hint: "-1 in both: there all day" },
            { kind: "int", key: "hours.1", label: "To hour", min: -1, max: 23 },
          ],
        },
        {
          kind: "weekdays", label: "Days", group: "when", days: WEEKDAYS,
          hint: "The days of the week it is there (the map's objects script). It needs an event flag: one is picked when it has none.",
          get: (map, i) => weekdaysOf(map, Number((asList(map.objects)[i] as { index?: number } | undefined)?.index ?? i), scriptRows),
          set: (map, i, days, ctx) => {
            const objs = asList(map.objects) as Record<string, unknown>[];
            const o = objs[i];
            if (!o) return;
            // appear / disappear work through the object's event flag
            if (days && (o.eventFlag === undefined || o.eventFlag === 0xffff)) {
              const flag = gen2.trainers?.objectTrainer?.freeFlag(ctx);
              if (typeof flag === "number") map.objects = objs.map((x, j) => (j === i ? { ...x, eventFlag: flag } : x)) as typeof map.objects;
            }
            setWeekdays(map, Number(o.index ?? i), days, scriptRows);
          },
        },
        { kind: "int", key: "eventFlag", label: "Event flag", group: "when", min: 0, max: 65535, hint: "Hidden while this event flag is set; 65535 = always there" },
        { kind: "info", label: "When it's there", group: "when", text: (map, i) => visibilityNote(map, Number((asList(map.objects)[i] as { index?: number } | undefined)?.index ?? i), scriptRows, startFlags) },
        { kind: "select", key: "palette", label: "Colors", group: "looks", numeric: true, options: () => ["0", ...OW_PALETTES.map((_, i) => String(8 + i))], labels: (v) => (v === "0" ? "The sprite's own" : OW_PALETTES[Number(v) - 8]?.toLowerCase()) },
        // the Role box edits the script, type, trainer and item ball; the rest is the cart's own bookkeeping
        { kind: "extras", label: "Other fields", hide: ["index", "script", "scriptKey", "spriteId", "type", "sight", "trainer", "itemball"] },
      ],
      // `index`: the object's number (events find people by it)
      create: (map, x, y) => ({ index: nextObjectIndex(map), x, y, sprite: "SPRITE_YOUNGSTER", movement: 6, radius: { x: 0, y: 0 }, hours: [-1, -1], eventFlag: 0xffff, palette: 0 }),
      variants: [{
        id: "item",
        label: "Item ball",
        // OBJECTTYPE_ITEMBALL: picked up once (its eventFlag is the taken flag)
        create: (map, x, y, ctx) => ({
          index: nextObjectIndex(map), x, y, sprite: "SPRITE_POKE_BALL", movement: 1, radius: { x: 0, y: 0 }, hours: [-1, -1], palette: 0,
          type: 1, itemball: { item: itemIndex(ctx, "POTION"), quantity: 1 }, eventFlag: gen2.trainers?.objectTrainer?.freeFlag(ctx) ?? 0xffff,
        }),
      }],
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
        // hidden at the start of a new game (its flag is set): it only appears through a script
        const ghost = !always && startFlags.has(Number(o.eventFlag));
        const r = (o.radius ?? {}) as { x?: number; y?: number };
        // walkers and spinners turn (gen1recomp Npc.lua MOVE): up/down, left/right or every way
        const looks: Facing[] | undefined = move === 4 ? ["up", "down"] : move === 5 ? ["left", "right"] : [2, 3, 10, 0x1e, 0x1f, 0x24].includes(move) ? ["down", "up", "left", "right"] : undefined;
        return id ? { sprite: id, facing: FACING[move] ?? "down", ghost, moving: WALKS.has(move), range: { x: Number(r.x ?? 0), y: Number(r.y ?? 0) }, looks } : null;
      },
    },
    {
      key: "bgEvents",
      kind: "sign",
      label: "Signs",
      singular: "Sign",
      color: "#ffc828",
      // kind 7 (BGEVENT_ITEM): a hidden item, not something to read
      marker: (e) => (e.hiddenItem ? "item" : undefined),
      fields: [
        { kind: "extras", label: "Other fields", hide: ["kind", "script", "scriptKey", "hiddenItem"] },
      ],
      create: (_map, x, y) => ({ x, y, kind: 0 }),
      variants: [{
        id: "hidden",
        label: "Hidden item",
        // BGEVENT_ITEM: found once by checking the cell
        create: (_map, x, y, ctx) => ({ x, y, kind: 7, hiddenItem: { event: gen2.trainers?.objectTrainer?.freeFlag(ctx) ?? 0, item: itemIndex(ctx, "POTION") } }),
      }],
    },
    {
      key: "coordEvents",
      kind: "trigger",
      label: "Step triggers",
      singular: "Step trigger",
      color: "#ff7a45",
      fields: [
        {
          kind: "select", key: "sceneId", label: "Scene", numeric: true, hint: "Runs only while the map is in this scene (the map's Scenes card and the toolbar's Scene menu)",
          options: (_ctx, map) => (map ? scenesOf(map, scriptRows) : [0]).map(String),
          labels: (v, _ctx, map) => { const name = map ? sceneNames(map)[v] : undefined; return `Scene ${v}${v === "0" ? " (start)" : ""}${name ? ` · ${name}` : ""}`; },
        },
        scriptField("coordEvents", "Stepping on it", "What happens: one of the scripts of the step triggers here."),
        { kind: "extras", label: "Other fields" },
      ],
      // a new trigger belongs to the scene the map is shown in
      create: (_map, x, y, ctx) => ({ x, y, sceneId: ctx.scene ?? 0 }),
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

  times: [{ key: "MORN", label: "Morning" }, { key: "DAY", label: "Day" }, { key: "NITE", label: "Night" }],
  bgPalettes: {
    registry: "palettes", id: "bg",
    envsId: "environments",
    envs: (ctx) => (recordsOf(ctx, "palettes").environments as unknown as Record<string, Record<string, number[]>> | undefined) ?? palettes(ctx).environments ?? {},
    times: [{ key: "MORN", label: "Morning" }, { key: "DAY", label: "Day" }, { key: "NITE", label: "Night" }, { key: "DARK", label: "Dark (before Flash)" }],
  },
  // one key per environment, map group (the roof colors) and time of day
  paletteKeys(ctx) {
    const out: Record<string, string> = {};
    for (const [id, m] of Object.entries(ctx.maps)) out[id] = `${String(m.environment ?? "TOWN")}|${Number(m.group ?? 0)}|${daytimeOf(m, ctx.time)}`;
    return out;
  },
  // gen1recomp src/world/gen2/Palettes.lua bgSet: the environment's 8 bg
  // palettes for the daytime, a tile's slot from its tileset's tilePalettes
  // (1-based, like the palette ids), and in towns and routes the roof slot's
  // two middle colors from roofs[map group]. Darkest first, like Gen 1's.
  tileAnimPatterns: OWN_PATTERNS,
  regions: [{ label: "Johto", map: "NEW_BARK_TOWN" }, { label: "Kanto", map: "PALLET_TOWN" }],
  tileAnimations: (ctx, tileset, id) => {
    // the game's program plus the rows a mod's extension appends (later rows win)
    const anim = (tileset as { anim?: { period?: number; frames?: unknown[] } }).anim;
    const rows = (ctx.records.studio_tilesets?.[id] as { anim?: unknown[] } | undefined)?.anim ?? [];
    const merged = anim && rows.length ? { ...anim, frames: [...(anim.frames ?? []), ...rows] } : anim;
    return gen2TileAnimations(merged, (ctx.data.extra as { tileAnim?: TileAnimSheets }).tileAnim ?? {});
  },
  tileColors(ctx, tileset, key) {
    const p = palettes(ctx);
    const [env, group, time = "DAY"] = key.split("|");
    const envs = (recordsOf(ctx, "palettes").environments as unknown as typeof p.environments) ?? p.environments;
    const row = envs?.[env] ?? envs?.TOWN;
    const ids = row?.[time] ?? row?.DAY ?? [];
    // the mod's colors (Graphics > Palettes), else the game's
    const bg = (recordsOf(ctx, "palettes").bg as unknown as [number, number, number][][] | undefined) ?? p.bg;
    const set = Array.from({ length: 8 }, (_, slot) => (bg?.[(ids[slot] ?? 1) - 1] ?? MONO).map((c) => [c[0], c[1], c[2]] as Rgb));
    const roofs = p.roofs?.[group];
    const roof = env === "TOWN" || env === "ROUTE" ? (time === "NITE" ? roofs?.nite : roofs?.mornDay) : undefined;
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
  spriteColors(ctx, key, sprite, entity) {
    const objects = palettes(ctx).objects;
    const set = objects?.[key.split("|")[2] ?? "DAY"] ?? objects?.DAY;
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
