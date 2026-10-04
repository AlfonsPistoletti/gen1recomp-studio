// What the editor needs to know about one game generation. The editor core
// (store, canvas, inspector, save) only talks to records through this
// interface, so Gen 2 and Gen 3 are new adapters rather than forks.

import type { Rgb } from "../render/color.ts";
import type { Direction, EntityRecord, MapDef, SpriteDef, TilesetDef } from "../core/types.ts";

export type GameId = "gen1" | "gen2" | "gen3";

// The loaded base data of one ROM version.
export interface Dataset {
  maps: Record<string, MapDef>;
  tilesets: Record<string, TilesetDef>;
  sprites: Record<string, SpriteDef>;
  // registries declared in GameAdapter.content (pokemon, encounters, ...),
  // keyed by registry name
  content: Record<string, Record<string, unknown>>;
  // anything else the adapter loaded (palettes, type names, ...)
  extra: Record<string, unknown>;
}

// What adapter callbacks get to look at: the dataset, the live maps and
// the live records of every editable registry.
export interface GameContext {
  data: Dataset;
  maps: Record<string, MapDef>;
  records: Record<string, Record<string, unknown>>;
}

// A content registry the adapter loads besides maps/tilesets/sprites. Mod
// registrations apply to all of them; `editable` ones are saved by the
// studio, the rest are lookups (moves, items, ...).
export interface ContentSpec {
  registry: string;
  // data/generated/<file>; without one the records come from build({}) alone
  // (vanilla tables that live in the engine, not in the imported dataset)
  file?: string;
  editable: boolean;
  // key order in the generated Lua, before the remaining keys (alphabetical)
  fieldOrder?: string[];
  // values are written whole with override, never patched/registered: for
  // "deep" registries (constants) whose merge would append to a list
  replace?: boolean;
  // turns the file's table into the registry's records when they differ
  // (type_chart.lua holds a matchups list; the registry keys "A>B")
  build?: (file: Record<string, unknown>) => Record<string, unknown>;
  // records kept as a plain data file in the mod (mods/<id>/<studioFile>)
  // instead of registry calls; `generates` names the registry the studio
  // file registers from it (its ops there are regenerated, never kept)
  studioFile?: string;
  generates?: string;
}

// ------------------------------------------------------------------ moves

// A custom move effect built from blocks (written to studio_effects.lua and
// turned into a move_effects record by src/lua/effectRuntime.ts).
export interface EffectStep {
  act: "stage" | "status" | "confuse" | "flinch" | "heal";
  who?: "user" | "target";
  chance?: number; // out of 256; missing = always
  stat?: string;
  delta?: number;
  status?: string;
  percent?: number;
}

export interface EffectSpec {
  kind: "status" | "damaging";
  canMiss?: boolean;
  neverMiss?: boolean;
  hits?: number | "2-5";
  damage?: "normal" | "level" | { fixed: number };
  recoil?: number;
  drain?: number;
  steps: EffectStep[];
}

export interface MoveSpec {
  registry: string;
  nameMax: number;
  maxPp: number;
  // effect ids moves may use (behaviour lives in the engine)
  effects(ctx: GameContext): string[];
  categories: string[];
  // battle animations as references to another move's ({ __ref })
  animRegistry?: string;
  // custom effects built from blocks
  custom?: {
    registry: string; // where the specs live (studio_effects)
    stats: string[];
    statuses: { id: string; label: string }[];
    // what a vanilla effect does, and its blocks when it is one
    describe(effect: string): string;
    template(effect: string): EffectSpec | null;
  };
}

// ------------------------------------------------------------------ trainers

export interface TrainerSlot {
  species: string;
  level: number;
  moves?: string[];
}

// What the Trainers workspace needs to know about a generation.
export interface TrainerSpec {
  registry: string; // trainer classes, each with a list of parties
  picSize: number; // portrait, square
  maxPartySize: number;
  nameMax: number;
  // trainer battle portrait (asset path) for a class
  pic(id: string, ctx: GameContext): string | undefined;
  // the moves a slot gets in battle when it names none of its own
  defaultMoves(trainerId: string, partyIndex: number, slotIndex: number, party: TrainerSlot[], ctx: GameContext): string[];
  // map objects that fight as this trainer: object field names
  objectClassKey: string;
  objectPartyKey: string;
  // move-choice layers (aiMods numbers)
  aiLayers: { value: number; label: string; about: string }[];
  // item/switch behaviour records, keyed by aiClass or the trainer id
  aiClasses?: { registry: string; items: string[] };
  notes(trainerId: string, ctx: GameContext): string[];
}

// ------------------------------------------------------------------ globals

// One number the engine reads from a global record: the whole record
// (`constants.levelCap`) or one key of it (`constants.world.stepFrames`).
export interface GlobalNumber {
  section: string;
  registry: string;
  id: string;
  key?: string;
  label: string;
  hint: string;
  min: number;
  max: number;
  // offered as a dropdown instead of a free number
  choices?: { value: number; label: string }[];
}

export interface GlobalsSpec {
  sections: { id: string; label: string; hint: string }[];
  numbers: GlobalNumber[];
  // what the engine uses for a global record nobody set (registry -> id ->
  // value); the studio compares against these and drops records that match
  defaults: Record<string, Record<string, unknown>>;
  // which badge each HM's field use needs (constants.hmBadges)
  hmBadges?: { registry: string; id: string; moves: string[]; badges: string[] };
  // type effectiveness rows ("ATK>DEF" -> { multiplier } x10) and type
  // records ({ category }) in one registry
  typeChart?: { registry: string; multipliers: { value: number; label: string }[]; categories?: string[] };
}

// ------------------------------------------------------------------ pokemon

export interface StatSpec {
  key: string; // baseStats.<key>
  label: string;
}

// What the Pokémon editor needs to know about a generation's records.
export interface PokemonSpec {
  stats: StatSpec[];
  maxTypes: number;
  typeNames(ctx: GameContext): string[];
  growthRates(ctx: GameContext): string[];
  // evolution methods and which extra fields each one uses
  evolutionMethods: { id: string; label: string; level?: boolean; item?: boolean }[];
  // TM/HM moves in machine order, labelled "TM01 MEGA_PUNCH"
  machines(ctx: GameContext): { move: string; label: string }[];
  moveNames(ctx: GameContext): string[];
  itemNames(ctx: GameContext): string[];
  // asset paths are relative to the imported dataset
  frontSprite(record: Record<string, unknown>): string | undefined;
  backSprite(record: Record<string, unknown>): string | undefined;
  // sprite sizes in pixels: front is frontSize x 8 square
  frontSizes: number[];
  backSize: number;
  // menu icons: built-in shapes by name, or { image } sheets of 2 frames
  icon: {
    width: number;
    height: number;
    frames: number;
    names(ctx: GameContext): string[];
    // asset path of a built-in shape
    path(ctx: GameContext, name: string): string | undefined;
    // what a record shows: its own icon, else the dex-number default
    resolve(ctx: GameContext, record: Record<string, unknown>): { name?: string; image?: string };
  };
}

// ------------------------------------------------------------------ encounters

export interface EncounterTerrain {
  key: string; // field of the encounters record ("grass", "water")
  label: string;
  hint: string;
}

// Wild tables per map (the encounters registry, id = map id).
export interface EncounterSpec {
  terrains: EncounterTerrain[];
  slotCount: number;
  // chance per slot out of 256, in slot order
  slotOdds(ctx: GameContext): number[];
  // where the slot chances live when they are one table for the whole game
  // (Gen 1: constants.encounterBuckets, cumulative out of 256)
  sharedOdds?: { registry: string; id: string; defaults: number[] };
  // cells that roll grass/water encounters on this map's tileset
  // "any" = every walkable cell rolls (Gen 1 indoor maps)
  wildCell(map: MapDef, tileset: TilesetDef | undefined, cx: number, cy: number, ctx: GameContext): "grass" | "water" | "any" | null;
  // a sentence when the map's tileset has no grass tile, etc.
  notes(map: MapDef, ctx: GameContext): string[];
}

// ------------------------------------------------------------------ fields
// Declarative inspector fields; the inspector renders them generically.

interface FieldBase {
  label: string;
  hint?: string;
}

export type FieldSpec =
  | (FieldBase & { kind: "text"; key: string })
  | (FieldBase & { kind: "int"; key: string; min?: number; max?: number })
  | (FieldBase & {
      kind: "select";
      key: string;
      options: (ctx: GameContext) => string[];
      // offered as the first choice; picking it deletes the key
      // undefined from the function = no empty choice
      emptyLabel?: string | ((record: Record<string, unknown>, ctx: GameContext) => string | undefined);
    })
  // a warp's destination: map + warp on that map, with "go to" and a
  // reciprocity check
  | (FieldBase & { kind: "warpTarget"; mapKey: string; warpKey: string; specialMaps: string[] })
  // JSON for every key no other field (and not x/y) claims
  | (FieldBase & { kind: "extras" })
  // two fields side by side
  | { kind: "pair"; fields: [FieldSpec, FieldSpec] };

// ------------------------------------------------------------------ entities

export type Facing = "down" | "up" | "left" | "right";

export interface SpriteRef {
  sprite: string;
  facing: Facing;
  ghost: boolean; // drawn faded (hidden until a script shows it)
  moving: boolean; // wanders; drawn with a dashed outline
}

export interface EntityLayer {
  key: string; // the map record field holding the list
  kind: "warp" | "npc" | "sign" | "trigger";
  label: string; // "Warps"
  singular: string; // "Warp"
  color: string; // marker color
  numbered?: boolean; // draw the 1-based index
  fields: FieldSpec[];
  create(map: MapDef, cx: number, cy: number, ctx: GameContext): EntityRecord;
  // fix up a duplicated record (fresh ids and the like)
  duplicate?(map: MapDef, copy: EntityRecord): void;
  sprite?(record: EntityRecord): SpriteRef | null;
}

// ------------------------------------------------------------------ adapter

export interface ConnectionRef {
  dir: Direction;
  map: string;
  offset: number; // blocks
}

export interface CellInfo {
  walkable: boolean;
  tile?: number;
  label?: string;
}

export interface GameAdapter {
  id: GameId;
  name: string;
  // the manifest "games" value mods for this generation declare
  manifestGame: string;
  // whether this adapter can edit yet
  ready: boolean;

  load(read: (file: string) => Promise<unknown>): Promise<Dataset>;
  normalizeMap(map: MapDef): MapDef;

  layers: EntityLayer[];
  mapFields: FieldSpec[];

  connections(map: MapDef): ConnectionRef[];
  setConnection(draft: MapDef, dir: Direction, target: string | null, offset: number): void;

  cell(map: MapDef, tileset: TilesetDef | undefined, cx: number, cy: number): CellInfo;

  // palette key per map (what an atlas is colored with)
  paletteKeys(ctx: GameContext): Record<string, string>;
  // 4 colors, darkest first, for one 8x8 tile of a tileset under a palette key
  tileColors(ctx: GameContext, tileset: TilesetDef, paletteKey: string): (tile: number) => Rgb[];
  spriteColors(ctx: GameContext, paletteKey: string): Rgb[];

  newMap(init: { id: string; tileset: string; width: number; height: number; fill: number; index: number }): MapDef;

  content: ContentSpec[];
  pokemon?: PokemonSpec;
  encounters?: EncounterSpec;
  globals?: GlobalsSpec;
  trainers?: TrainerSpec;
  moves?: MoveSpec;
}
