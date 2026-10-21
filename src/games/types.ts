// What the editor needs to know about one game generation. The editor core
// (store, canvas, inspector, save) only talks to records through this
// interface, so Gen 2 and Gen 3 are new adapters rather than forks.

import type { Rgb } from "../render/color.ts";
import type { IntroStep } from "../lua/introRuntime.ts";
import type { GameGift } from "../project/gameEvents.ts";
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
  // the time of day the map view shows (one of `GameAdapter.times`)
  time?: string;
  // the scene the map view shows (Gen 2), 0 = as the map is
  scene?: number;
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
  build?: (file: Record<string, unknown>, version?: string) => Record<string, unknown>;
  // records kept as a plain data file in the mod (mods/<id>/<studioFile>)
  // instead of registry calls
  studioFile?: string;
  // the fixed helper written into studio_content.lua that turns the data
  // file's records into engine records
  generator?: Generator;
  // the engine merges this registry "deep": patched lists append
  deep?: boolean;
  // records are files the studio writes itself (image overrides), never
  // registry calls
  files?: boolean;
}

// The helper code of a studio data file (src/lua/*Runtime.ts).
export interface Generator {
  what: string; // the data file's header comment
  order: string[]; // key order in the data file
  runtime: string;
  registration: (modId: string, file: string) => string;
  // every registry the helper registers into: its ops there are regenerated
  // on save, never kept
  writes: string[];
  // the helper reaches into the engine (always, or for these records)
  internals?: boolean | ((records: Record<string, unknown>) => boolean);
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
  // false: the moves have no priority / damage category / high-crit fields
  // (Gen 2 keeps those in the effect)
  battleDetails?: boolean;
  // the secondary effect's chance in % (effectChance)
  effectChance?: boolean;
  // the move screen's description: lines joined with <NEXT>
  description?: { lines: number; lineMax: number };
  // percent fields the engine reads as a byte (0-255) too: kept in sync
  rawBytes?: Record<string, string>;
  // false: no "+ New" (a new move needs data the studio doesn't make yet)
  newMoves?: boolean;
  // records of other registries a copied move takes along (Gen 2: its
  // animation), and the same without a deleted move (value undefined: remove)
  moveExtras?(sourceId: string, newId: string, ctx: GameContext): { registry: string; id: string; value: unknown }[];
  // Gen 2: the animations are one record mapping move id -> animation (the
  // Battle animation card copies another move's value)
  animTable?: { registry: string; id: string };
  dropMoveExtras?(id: string, ctx: GameContext): { registry: string; id: string; value: unknown }[];
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
    // Gen 2: a damaging move's custom effect can only add one status (rolled
    // with the move's effect chance): no hits / damage / recoil / drain / flinch
    secondaryOnly?: boolean;
  };
}

// ------------------------------------------------------------------ items

// A custom item effect built from blocks (written to studio_item_effects.lua
// and turned into an item_effects record by src/lua/itemEffectRuntime.ts).
export interface ItemEffectStep {
  act:
    | "heal" | "cure" | "revive" | "pp" | "statexp" | "level" | "evolve" // on a party Pokémon
    | "stage" | "focus" | "mist" | "xaccuracy" | "escape" | "ball" // in battle
    | "repel"; // in the field
  amount?: number; // heal / pp / statexp
  percent?: number; // heal / revive (of max HP)
  full?: boolean; // heal / pp
  statuses?: string[]; // cure; missing = every status
  all?: boolean; // pp: every move (false = the move the player picks)
  stat?: string; // statexp / stage
  delta?: number; // stage
  cap?: number; // statexp
  steps?: number; // repel
}

export interface ItemEffectSpec {
  target: "party" | "none"; // pick a party Pokémon first
  where?: "both" | "battle" | "field"; // missing = both
  keep?: boolean; // never used up
  steps: ItemEffectStep[];
}

// A ball's catch numbers (gen1recomp src/battle/Catching.lua BALLS).
export interface BallRecord {
  randMax: number;
  hpFactor?: number;
  wobbleFactor?: number;
  autoCatch?: boolean;
  flicker?: boolean;
  tossAnim?: string;
}

// A shop clerk whose stock the Items workspace can edit.
export interface MartRef {
  registry: string; // text_pointers
  map: string; // the registry record (map label)
  text: string; // the TEXT_* key inside it
  label: string; // shown to the user
  mapId?: string;
}

// What the Items workspace needs to know about a generation.
export interface ItemSpec {
  registry: string;
  nameMax: number;
  maxPrice: number;
  // custom effects built from blocks
  effectRegistry: string; // studio_item_effects
  ballRegistry?: string; // balls
  stats: string[]; // battle stages
  expStats: string[]; // stat exp
  statuses: { id: string; label: string }[];
  tossAnims: string[];
  // what a vanilla item does ("" = nothing), and its blocks when it has some
  describe(id: string, item: Record<string, unknown>): string;
  template(id: string, item: Record<string, unknown>): ItemEffectSpec | null;
  // items whose built-in behaviour blocks can't rebuild (bicycle, rods, ...)
  special(id: string, item: Record<string, unknown>): boolean;
  // items the game uses for something else (elevator floors, ...): why
  internal(id: string, item?: Record<string, unknown>): string | null;
  // which ids the engine gives a move picker (Ether-style)
  picksMove(id: string): boolean;
  marts(ctx: GameContext): MartRef[];
  // false: no custom effects or ball numbers (Gen 2 items act by id and held effect)
  effects?: boolean;
  // Gen 2: a custom effect is the effect registry's record under the item's own
  // id (no sharing), on a party Pokémon only, never kept, vitamins at the game's
  // numbers; where it can be used = the item's menu fields (on/off values)
  byItem?: { field: string; battle: string; on: string; off: string };
  // false: no "+ New Item" / "+ TM/HM"
  newItems?: boolean;
  // the number a new item gets (Gen 2: a free byte; undefined: none left, and
  // `noIndex` says what the item then can't do)
  newIndex?(ctx: GameContext): number | undefined;
  noIndex?: string;
  // bag pockets (replaces the Key item switch)
  pockets?: string[];
  // the bag's description: lines joined with <NEXT>
  description?: { lines: number; lineMax: number };
  // what the item does when held (heldEffect), and what its number
  // (heldParameter) means for an effect: unset amount = the engine ignores it
  heldEffects?: { ids: string[]; info(effect: string): { note?: string; amount?: { label: string; hint: string; max: number } } };
  // a TM/HM's kind, move and number (unset: the item's `machine` record);
  // machineEdit false: shown, not changed
  machineOf?(item: Record<string, unknown>): { kind?: string; move?: string; number?: number } | undefined;
  machineEdit?: boolean;
  // where else the game uses an item (Gen 2: shops, trainers, held items,
  // item balls); the editor adds evolutions, trainer AI, shops and prizes
  uses?(ctx: GameContext, id: string): ItemUse[];
}

// one "Used by" row: what opens on click (a map entity, a trainer, a species)
export interface ItemUse {
  label: string;
  map?: { id: string; layer?: string; index?: number };
  trainer?: { id: string; team?: number };
  pokemon?: string;
}

// ------------------------------------------------------------------ ids

// Where a registry's ids are referenced, so a mod's own record can get a new
// id with every reference following: string values under `fields`, entries of
// arrays under `lists`, records of `keyed` registries stored under the same
// id, and an optional text key derived from the id.
export interface RenameSpec {
  fields: string[];
  lists: string[];
  keyed: string[];
  prefix?: string; // new ids must start with it (OPP_ for trainer classes)
  derivedText?: { field: string[]; key: (id: string) => string };
}

// ------------------------------------------------------------------ towns

// One Game Corner prize: an item or a Pokémon at a level, for coins.
export interface Prize {
  item?: string;
  species?: string;
  level?: number;
  cost: number;
}

export interface PrizeCounter {
  prizes: Prize[];
}

// Something on a map the player can interact with that is not a map entity:
// a list per map id inside the field registry (field[path...][MAP] = {x, y, ...}).
export interface HiddenKind {
  id: "pc" | "bench" | "item" | "coins" | "statue";
  label: string;
  path: string[];
  hint: string;
}

// NPC roles, Pokémon Center PCs, landing spots and prize counters.
export interface TownSpec {
  pointerRegistry: string; // text_pointers: roles are flags on an NPC's text pointer
  fieldRegistry: string; // field: pcTiles, flyWarps
  prizeRegistry: string; // prize counters, id "<MAP_ID>:<TEXT_ID>"
  prizesPerCounter: number; // the prize window's rows
  maxCoins: number;
  hidden: HiddenKind[];
  // a bench guy's text label -> its text key (the engine maps a few by hand)
  benchText(label: string): string;
  // which maps may get a landing spot (outdoor ones)
  isTown(map: MapDef): boolean;
  // a game trainer's header (line of sight, text keys): fixed game data, shown
  // so its lines can be reworded; null when the game has none for it
  gameTrainer?(ctx: GameContext, map: MapDef, entity: Record<string, unknown>): GameTrainerHeader | null;
  // hidden events the engine runs as code (fixed cells; only their texts change)
  codeHidden?: CodeHidden[];
  // where the game's scripts show / hide map people (Gen 1, restated)
  toggles?: ObjectToggle[];
}

export interface ObjectToggle {
  map: string;
  objects: string[]; // object names
  show: boolean;
  when: string; // in words, after "Shown/Hidden when"
  versions?: string[];
}

export interface CodeHidden {
  map: string;
  cells: [number, number][];
  facing?: string; // the way the player must look (none: any side)
  what: string; // what it does, in words
  texts: string[]; // the text keys it shows
  versions?: string[]; // only in these versions
}

export interface IconMotion {
  rest: number; // 16x16 frame shown at rest
  alt: number; // and the one it switches to
  mirror: boolean; // only the left half, mirrored onto the right
  bob: boolean; // nudges one pixel down instead of switching frames
}

export interface GameTrainerHeader {
  battle?: string; // spots the player
  won?: string; // in the battle, when it loses
  after?: string; // talked to after losing
  range?: number;
}

// ------------------------------------------------------------------ trainers

export interface TrainerSlot {
  species: string;
  level: number;
  moves?: string[];
  // a held item (Gen 2)
  item?: string;
}

// What the Trainers workspace needs to know about a generation.
export interface TrainerSpec {
  registry: string; // trainer classes, each with a list of parties
  // the song the game plays when a trainer of this class spots the player
  // (null: none, e.g. rivals); the choices offered to override it
  meetTheme?(cls: string): string | null;
  meetThemes?: { id: string; label: string }[];
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
  // how a class record stores its teams (unset: Gen 1's `parties` lists and
  // `partyNames` { "1": name }); Gen 2: `trainers` [{ name, party }]
  teams?: {
    read(r: Record<string, unknown>): TrainerSlot[][];
    write(draft: Record<string, unknown>, parties: TrainerSlot[][]): void;
    name(r: Record<string, unknown>, p: number): string;
    setName(draft: Record<string, unknown>, p: number, name: string): void;
  };
  // a slot may hold an item (Gen 2)
  heldItems?: boolean;
  // false: no new teams; newClasses false: no new classes (Gen 2: a class
  // is a ROM constant scripts and map people refer to by number)
  newTeams?: boolean;
  newClasses?: boolean;
  // what the engine can hold: a class's number (`index`, Gen 2's trainer
  // structs and loadtrainer name classes by it) and trainers per class
  limits?: { classIndex: number; teams: number };
  // a new class's id prefix (Gen 1: OPP_)
  classPrefix?: string;
  // records that go with a new class copied from `sourceId` (Gen 2: its
  // portrait colors in palettes.trainers)
  classExtras?(sourceId: string, newId: string, ctx: GameContext): { registry: string; id: string; value: unknown }[];
  // map people that are trainers through a record of their own (Gen 2:
  // object.trainer = { class (index), member, event, seenText, winText,
  // scriptKey }); the map inspector builds and edits it (src/ui/mapTrainer.ts)
  objectTrainer?: {
    key: string;
    typeKey: string;
    typeValue: number;
    sightKey: string;
    textRegistry: string;
    classIndex(ctx: GameContext, classId: string): number | undefined;
    classOf(ctx: GameContext, index: number): string | undefined;
    // an event flag no game script or other trainer uses, or null
    freeFlag(ctx: GameContext): number | null;
    // after-battle scripts to reuse: other trainers' on this map
    afterScripts(map: MapDef): { key: string; label: string }[];
  };
  // who fights each team of a class (1-based team -> map objects; index -1:
  // a map script); unset: Gen 1's objectClassKey/objectPartyKey on objects
  uses?(ctx: GameContext, classId: string): Map<number, { mapId: string; index: number }[]>;
  // false: no AI panel / colors choice / portrait borrowing (Gen 2 for now)
  ai?: boolean;
  // Gen 2: a class's AI is bits in its `attributes` bytes (move layers in the
  // little-endian word at aiByte, switching in the word at switchByte, 0-based)
  // plus its `items` list (what it may use in battle, tried in `items` order)
  aiAttributes?: {
    aiByte: number;
    switchByte: number;
    layers: { bit: number; label: string; about: string }[];
    switching: { bit: number; label: string; about: string }[];
    items: string[];
    itemSlots: number;
  };
  colors?: boolean;
  basePic?: boolean;
  // a class's portrait colors (lightest first) when the game has its own
  // per-class palettes (Gen 2) instead of the palettes registry
  picColors?(ctx: GameContext, classId: string): Rgb[] | null;
  // Gen 2: a class's portrait colors are a record of the class id -> its two
  // middle colors (light, dark; white and black around them), edited in place
  colorPairs?: { registry: string; id: string };
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
  // shown in the left list in this order, under a heading per group
  sections: { id: string; group?: string; label: string; hint: string }[];
  numbers: GlobalNumber[];
  // what the engine uses for a global record nobody set (registry -> id ->
  // value); the studio compares against these and drops records that match
  defaults: Record<string, Record<string, unknown>>;
  // which badge each HM's field use needs (constants.hmBadges)
  hmBadges?: { registry: string; id: string; moves: string[]; badges: string[] };
  // Gen 2: the item each fruit tree number gives (record `id` = the list, tree n = entry n)
  fruitTrees?: { registry: string; id: string };
  // Gen 2: Kurt's apricorn -> ball records (the engine's `apricorns` registry)
  apricorns?: { registry: string };
  // Gen 2: the Pokégear phone book (the engine's `phone_contacts` registry, one
  // record per PHONE_* id with its row `index`); `givers`: the map people whose
  // script asks for a contact's number (askforphonenumber <index>)
  // `lines`: the texts a call script (a key or inline rows) says, in order
  phone?: { registry: string; givers(ctx: GameContext): Map<number, { map: string; index: number }[]>; lines(ctx: GameContext, script: unknown): PhoneLine[] };
  // type effectiveness rows ("ATK>DEF" -> { multiplier } x10) and type
  // records ({ category }) in one registry
  typeChart?: { registry: string; multipliers: { value: number; label: string }[]; categories?: string[] };
  // Gen 2's start values: one record { map, x, y, money } (no facing, the
  // blackout point is the same cell); `note` says what the cell also is
  start?: { registry: string; id: string; maxMoney: number; note: string; names?: { id: string; max: number; note: string } };
  // Gen 2's starter balls (Gen 1's are restated in the UI): each ball's game
  // species, its question text key and level; the question for a new species;
  // the rival classes to open; which species a script can give
  // Gen 2's Oak's speech (Gen 1's is restated in the UI): the game's steps, the
  // ones that can't go, the registry holding the step texts, where the demo
  // Pokémon is stored, the pictures and reveals the speech knows; flags false:
  // answers set no flags (the game's events check numbered flags)
  intro?: {
    steps: (IntroStep & { label: string })[];
    required: string[];
    textRegistry: string;
    demo: { registry: string; id: string; key: string; game: string };
    pics: string[];
    reveals: string[];
    flags: boolean;
  };
  // the slot machine reels (unset: Gen 1's field.slotWheels): a record holding
  // the three strips of symbol names, the symbols in menu order, the payouts
  slots?: { registry: string; id: string; order: string[]; payouts: string; art?: Record<string, { sheet: string; x: number; y: number; w: number; h: number }> };
  // Gen 2's gift Pokémon, read from the game's scripts (Gen 1's: gameGifts)
  gifts?(ctx: GameContext): GameGift[];
  // Gen 2's in-game trades (Gen 1's: field.trades, restated in tradeEditor):
  // the list record, its dialogue key and values, the received mon's extras,
  // who offers trade n (1-based); no "+ New trade"
  trades?: {
    registry: string;
    id: string;
    dialogKey: string;
    dialogs: { value: string; label: string }[];
    nickMax: number;
    otMax: number;
    offers(ctx: GameContext): Map<number, { label: string; map: string; layer: string; index: number }[]>;
    // what the person says when offering this trade (its dialogue style's line)
    offerLine(ctx: GameContext, trade: Record<string, unknown>): string;
    dialogNote: string;
  };
  starters?: {
    balls(ctx: GameContext): { ball: string; ask: string; level: number }[];
    question(name: string, typeName: string): string;
    rivals: { id: string; label: string }[];
    canGive(rec: Record<string, unknown>): boolean;
    note: string;
  };
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
  // a single type is stored twice ([GRASS, GRASS], Gen 2's base data)
  typesTwice?: boolean;
  typeNames(ctx: GameContext): string[];
  growthRates(ctx: GameContext): string[];
  // record keys that differ by generation (unset: Gen 1's learnset,
  // level1Moves, evolutions[].species, frontSize); startMoves null: none
  keys?: { levelMoves?: string; startMoves?: string | null; evolveInto?: string; picSize?: string };
  // evolution methods and which extra fields each one uses (item "optional":
  // a trade with or without a held item; time/comparison: the choices)
  evolutionMethods: { id: string; label: string; level?: boolean; item?: boolean | "optional"; time?: string[]; comparison?: { id: string; label: string }[] }[];
  // Gen 1's importer writes level 1 for evolutions without a level: keep that shape
  evolutionLevelAlways?: boolean;
  // breeding block (Gen 2): egg groups in nibble order (index + 1), written
  // with the raw byte the engine compares (eggGroupsRaw)
  breeding?: { eggGroups: string[] };
  // the two wild held items (`items`: rare, common)
  heldItems?: boolean;
  // battle pic colors from the game's per-species palettes (lightest first);
  // unset: the palettes registry and the Colors choice
  monColors?(ctx: GameContext, id: string, shiny?: boolean): Rgb[] | null;
  // Gen 2: a record of species id -> { normal, shiny } two middle colors each
  // (light, dark), edited in place
  colorPairs?: { registry: string; id: string };
  // a regional Pokédex besides the national one (Gen 2: Johto), species in order
  regionalDex?: { label: string; order(ctx: GameContext): string[] };
  // the Pokédex entry is stored in the record itself (Gen 2: dexEntry
  // { kind, height = ft*100+in, weight in 0.1 lb, text, text2 }, each page
  // `lines` lines joined with <NEXT>) instead of Gen 1's text key
  dexInline?: { lines: number; lineMax: number };
  // what this generation can't edit yet
  without?: ("newSpecies" | "dexEntry" | "cry" | "iconImport")[];
  // records of other registries a copied species takes along (Gen 2: its
  // menu icon row and its colors), as whole new values
  speciesExtras?(sourceId: string, newId: string, ctx: GameContext): { registry: string; id: string; value: unknown }[];
  // the same records without a deleted species (value undefined = remove)
  dropExtras?(id: string, ctx: GameContext): { registry: string; id: string; value: unknown }[];
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
  // back sprites may also be bigger, drawn 1:1 instead of doubled
  backSizes: number[];
  // the scales the game draws battle pics at (pokemon.battleScaleFront/Back)
  battleScale: { front: number; back: number; choices: number[] };
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
    // icons live in this registry (species id -> sheet name) instead of the
    // pokemon record's `icon`; an imported image becomes a sheet record there
    registry?: string;
    // how the party menu animates an icon (`name` unset: the mod's own image),
    // from its sheet's height; unset: frame 1 <-> frame 2 of a 16-wide strip
    motion?(name: string | undefined, sheetHeight: number): IconMotion;
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

// Wild tables keyed by kind, each holding every map (Gen 2: the encounters
// registry's ids are "grass", "water", "fishGroups", ...), grass per time
// of day. The panel edits one map's entries inside the kind records.
export interface TimedEncounterSpec {
  registry: string;
  times: { key: string; label: string }[];
  // chance of each slot in %, in slot order
  grassOdds: number[];
  waterOdds: number[];
  // fishing: the map field naming its group, the group records' kind, rods
  fish: { mapKey: string; kind: string; rods: { key: string; label: string }[] };
  // headbutt trees / rock smash: kinds mapping map -> set name, and the sets
  // ({ common, rare } lists of { chance %, species, level }); sets a version
  // never rolls from
  trees?: { map: string; rocks: string; sets: string; unused(version: string): string[] };
  // swarm tables (grass/water shape), only for the maps the game has them
  swarms?: { grass: string; water: string };
  wildCell(map: MapDef, tileset: TilesetDef | undefined, cx: number, cy: number, ctx: GameContext): "grass" | "water" | "any" | null;
}

// ------------------------------------------------------------------ fields
// Declarative inspector fields; the inspector renders them generically.

// a text a phone call says: the time of day its branch runs in (unset: any),
// and what fills its {STRBUF} there, in words
export type PhoneTime = "Morning" | "Day" | "Night";
export interface PhoneLine {
  text: string;
  time?: PhoneTime;
  fills: string[];
}

// Events > Flags. A flag's key is its name (Gen 1) or its number as a string (Gen 2).
export type FlagUseKind = "set" | "clear" | "check" | "hides" | "shows" | "beaten" | "item" | "hidden" | "start";
export interface FlagUse {
  kind: FlagUseKind;
  label: string; // who, in words ("ROUTE_30 NPC 3")
  map?: string;
  layer?: string; // with `index`: the map entity (its place in the layer's list)
  index?: number;
  eventId?: string; // the event to open (game events: "game:" ids)
  contact?: string; // a phone contact
  own?: boolean; // the mod's own (an edited or new script, a studio record)
}
export interface FlagSpec {
  notes: string; // the studio-only registry of notes: key -> { note }
  numeric: boolean; // Gen 2: flags are numbers (new ones from trainers.objectTrainer.freeFlag)
  // the game's name for a flag (Gen 2 Gold/Silver: EVENT_*), when it has one
  name?(ctx: GameContext, key: string): string | undefined;
  // every use of every flag, from the live maps and records (`gameTalk`: Gen 1's game
  // talk events, read by the Events workspace from a checkout)
  uses(ctx: GameContext, gameTalk?: Record<string, { talk: Record<string, unknown[][] | false> }>): Map<string, FlagUse[]>;
}

// the card of an entity's properties a field sits in (the inspector shows the
// cards in this order); unset: "advanced" for extras, "role" otherwise
export type EntityGroup = "looks" | "movement" | "role" | "when" | "advanced";
interface FieldBase {
  label: string;
  hint?: string;
  group?: EntityGroup;
}
// a field's `key` may be a dotted path into the record ("radius.x", "hours.0")

export type FieldSpec =
  | (FieldBase & { kind: "text"; key: string })
  | (FieldBase & { kind: "int"; key: string; min?: number; max?: number })
  // a yes/no key (unchecked: the key is dropped)
  | (FieldBase & { kind: "check"; key: string })
  | (FieldBase & {
      kind: "select";
      key: string;
      // the open map, for choices taken from it
      options: (ctx: GameContext, map?: MapDef) => string[];
      // stored as a number (the options are number strings)
      numeric?: boolean;
      // what an option shows (unset or undefined: the value itself)
      labels?: (value: string, ctx: GameContext, map?: MapDef) => string | undefined;
      // offered as the first choice; picking it deletes the key
      // undefined from the function = no empty choice
      emptyLabel?: string | ((record: Record<string, unknown>, ctx: GameContext) => string | undefined);
    })
  // a warp's destination: map + warp on that map, with "go to" and a
  // reciprocity check
  // specialMaps: map ids that resolve at runtime (Gen 1 LAST_MAP); backWarp:
  // a warp number that does (Gen 2's 255: back where the player came from)
  | (FieldBase & { kind: "warpTarget"; mapKey: string; warpKey: string; specialMaps: string[]; backWarp?: number })
  // the days of the week an entity is there (null: every day); set edits the
  // draft map (Gen 2: the map's objects callback)
  | (FieldBase & {
      kind: "weekdays";
      days: string[];
      get(map: MapDef, index: number, ctx: GameContext): number[] | null;
      set(map: MapDef, index: number, days: number[] | null, ctx: GameContext): void;
    })
  // a line of information about the entity (null: nothing to say), not edited
  | (FieldBase & { kind: "info"; text(map: MapDef, index: number, ctx: GameContext): string | null })
  // JSON for every key no other field (and not x/y) claims
  // (hide: keys kept in the record but not shown, e.g. cart data the Role box edits)
  | (FieldBase & { kind: "extras"; hide?: string[] })
  // two fields side by side
  | { kind: "pair"; fields: [FieldSpec, FieldSpec]; group?: EntityGroup };

// ------------------------------------------------------------------ entities

export type Facing = "down" | "up" | "left" | "right";

export interface SpriteRef {
  sprite: string;
  facing: Facing;
  ghost: boolean; // drawn faded (hidden until a script shows it)
  moving: boolean; // wanders; drawn with a dashed outline
  range?: { x: number; y: number }; // cells it may wander from its spot (Gen 2 radius; Gen 1 has no limit)
  looks?: Facing[]; // the ways it can face (turns, walks); missing = only `facing`
}

// ------------------------------------------------------------------ events

// An event's command list in the engine's own format: { "verb", args... }.
export type EventRow = unknown[];

export type EventParamType =
  | "text" // a line of text, or a text key ("_SomeText")
  | "flag"
  | "flagNumber" // Gen 2: an event flag by number (0-2047)
  | "goldObject" // Gen 2: the player (0) or a person of the event's map (its index + 1)
  | "item"
  | "species"
  | "number"
  | "trainer" // trainer class id
  | "map"
  | "dir" // up / down / left / right
  | "npcIndex" // an NPC of the event's map, by object index
  | "npcName" // an NPC (of any map), by object name
  | "song"
  | "sound"
  | "bubble"
  | "fade"
  | "path" // a list of directions, one step each
  | "together" // walk options: { wait = false } (don't wait), stepFrames (NPC speed)
  | "cellX" // a map cell (x, then a "cellY" param right after)
  | "cellY"
  | "trade" // an in-game trade, by its number (field.trades)
  | "screen" // one of EventSpec.screens
  | "choice" // one of the param's own `options`
  | "word" // a few letters typed as they are (Gold getstring)
  | "ext"; // a mod command's parameter (studio extensions): `ext` says its field type

export interface EventParam {
  key: string;
  label: string;
  type: EventParamType;
  default?: unknown;
  min?: number;
  max?: number;
  // type "choice": the values offered, in words
  options?: { value: string | number; label: string }[];
  ext?: import("../project/extensions.ts").ExtField;
}

// One command the event editor offers.
export interface EventCommand {
  id: string; // unique in the catalog
  verb: string; // row[0]
  fixed?: unknown[]; // arguments that always follow the verb (start_battle "trainer")
  label: string;
  category: string;
  help: string;
  params: EventParam[];
  // a check that sets the "last result" an If tests (check_flag, ask, ...)
  condition?: string; // how an If reads it: "{flag} is set"
  describe(args: Record<string, unknown>): string;
  // Gen 2: the row's fields (besides `op` = verb) from the arguments, and the
  // arguments back from a row (null: not this command's row); unset: by key
  pack?(args: Record<string, unknown>, ctx: GameContext): Record<string, unknown>;
  unpack?(row: Record<string, unknown>, ctx: GameContext): Record<string, unknown> | null;
  // Gen 2: a command written as several rows (a battle), and found again in
  // them (its arguments and how many rows it took), instead of pack/unpack
  rows?(args: Record<string, unknown>, ctx: GameContext): Record<string, unknown>[];
  match?(rows: Record<string, unknown>[], at: number, ctx: GameContext): { args: Record<string, unknown>; length: number } | null;
  // Gen 2: the If row that reads this check, and its opposite (unset:
  // iftrue / iffalse): checkmoney answers 0 more, 1 the amount, 2 less
  // (no `value`: the command's own "value" argument)
  branch?: { op: string; not: string; value?: number };
}

// What the Events workspace needs to know about a generation.
export interface EventSpec {
  registry: string; // the studio's own events (studio_events)
  categories: string[];
  commands: EventCommand[];
  // the helper's command for "the player picked option N" (choices of 3+)
  choiceVerb: string;
  stopVerb: string; // jump
  // Gen 2: no registry; an event is the script list stored inline as a map
  // person's / sign's / step trigger's `scriptKey` (src/core/inlineEvents.ts).
  // Talk and step events only, no Choice / follow / preview / game events.
  inline?: boolean;
  // rows <-> blocks in this game's script format (unset: Gen 1's, eventBlocks.ts)
  // `mode` "phone": a Pokégear call (Gen 2: no text box of its own, promptbutton between texts)
  compile?(blocks: import("../core/eventBlocks.ts").Block[], ctx: GameContext, mode?: "phone"): EventRow[];
  parse?(rows: EventRow[], ctx: GameContext, mode?: "phone"): import("../core/eventBlocks.ts").Block[];
  // Gen 2: a script a Role made (a person's text, a nurse, a shop), not an event
  preset?(rows: EventRow[]): boolean;
  // Gen 2: the game's script of this key as one row list (branches and jumps
  // to other keys read in as nested lists), for showing / copying it
  gameRows?(ctx: GameContext, key: string): EventRow[] | null;
  // Gen 2: a game row the editor has no form for, in words (`help`: what it is for)
  describeRaw?(row: Record<string, unknown>, ctx: GameContext): { text: string; help: string };
  // the game's screens an event may open ("Open a screen"): the id its row names, in words
  screens?: { id: string; label: string }[];
}

export interface EntityLayer {
  key: string; // the map record field holding the list
  kind: "warp" | "npc" | "sign" | "trigger";
  label: string; // "Warps"
  singular: string; // "Warp"
  color: string; // marker color
  numbered?: boolean; // draw the 1-based index
  // a marker of its own for some entities ("item": a hidden item, drawn like
  // Gen 1's hidden items) instead of the layer's
  marker?(e: EntityRecord): "item" | undefined;
  fields: FieldSpec[];
  create(map: MapDef, cx: number, cy: number, ctx: GameContext): EntityRecord;
  // fix up a duplicated record (fresh ids and the like)
  duplicate?(map: MapDef, copy: EntityRecord): void;
  // ready-made kinds of this layer with their own add button (an item ball)
  variants?: { id: string; label: string; create(map: MapDef, cx: number, cy: number, ctx: GameContext): EntityRecord }[];
  sprite?(record: EntityRecord, mapId: string): SpriteRef | null;
  // this layer holds the mods' own placed kinds (studio extensions): the
  // plain record such an entity starts from, before its `custom` table
  custom?: { create(map: MapDef, cx: number, cy: number): EntityRecord };
}

// ------------------------------------------------------------------ adapter

export interface ConnectionRef {
  dir: Direction;
  map: string;
  offset: number; // blocks
}

// Graphics > Images: which cache images are offered, in which group
export interface ImageSpec {
  // folders left out (prefixes of paths below assets/generated)
  skip: string[];
  // [path prefix or exact path, group label], first match wins
  groups: [string, string][];
  // path -> what the image is for
  hints: Record<string, string>;
}

export interface CellInfo {
  walkable: boolean;
  // whether a warp here is taken (Gen 2: only on door/stairs/cave/mat/pit
  // collision); unset = not known
  warp?: boolean;
  tile?: number;
  label?: string;
}

export interface GameAdapter {
  id: GameId;
  name: string;
  // the manifest "games" value mods for this generation declare
  manifestGame: string;
  // the map the studio opens first (the player's home town)
  startMap: string;
  // registries the studio only shows for this generation (no edits), and why
  viewOnly?: { registries: string[]; reason: string };
  // the workspaces this generation has; unset = all of them
  workspaces?: string[];
  // the Graphics views it has (unset: all)
  graphicsViews?: string[];
  // Gen 2 sprites: the spriteType each kind is written with, and the OBJ
  // palettes a sprite draws with by default (palette name; paletteId = place)
  // `player`: the sprite the Sprites view opens on (Gen 1: SPRITE_RED)
  // `players`: the sprites the player wears, per player and role (Gen 2: fixed
  // in the engine, so a mod changes their art, not which sprite is worn)
  spriteModel?: {
    types: Record<"walker" | "turner" | "object", string>;
    palettes: string[];
    player(version: string): string;
    players(version: string): { who: string; roles: [label: string, sprite: string][] }[];
  };
  // tilesets whose collision is a quad of codes per block (Gen 2) instead of
  // walkable tiles, and whose tiles each pick one of 8 palette slots
  tileCollision?: {
    // named codes (others show as their number); `permission` from the
    // engine's table: 0 walk, 1 water, 15 wall
    codes: { code: number; label: string }[];
    permission(code: number): number;
    paletteSlots: string[];
    // the slot an added tile starts on (1-based)
    defaultSlot: number;
  };
  // false: Play starts the game as usual (the studio can't put the player on
  // a picked cell in this generation yet)
  playFromHere?: boolean;
  // the Play-from-here helper's main.lua for this generation (unset: Gen 1's,
  // src/lua/playRuntime.ts playtestMain)
  playtestMain?(t: { map: string; x: number; y: number }): string;
  // map scenes (Gen 2): a map's story stages; scenes above 0 may change blocks
  // (all edits work on a draft map). Scene 0 is the map as it is.
  scenes?: {
    list(map: MapDef, ctx: GameContext): number[];
    // the scenes with an entering script (no script walk: for event lists)
    withScripts(map: MapDef): number[];
    names(map: MapDef): Record<string, string>;
    setName(map: MapDef, n: number, name: string): void;
    blocksIn(map: MapDef, n: number): number[];
    changedBlocks(map: MapDef, n: number): number;
    setBlock(map: MapDef, n: number, bx: number, by: number, id: number | null): void;
    clearBlocks(map: MapDef, n: number): void;
    // what entering the map in scene n runs (a game key, inline rows, nothing)
    script(map: MapDef, n: number): unknown;
    setScript(map: MapDef, n: number, script: unknown): void;
  };
  // Gen 2's Town Map (Graphics > Town Map, townMapEditor2.ts): the landmarks
  // registry (name, pixel x/y), the registry of the regions' 20x18 tile grids
  // (record per region), the tile sheet, and which region a landmark is on
  townMap2?: {
    landmarks: string;
    grids: string;
    sheet: string;
    nameMax: number;
    regionOf(ctx: GameContext, landmarkId: string): "johto" | "kanto";
    // the sheet's colors: a palette number per tile (1-based), the palettes
    // (4 colors, lightest first); tiles from `fontFrom` on use the first
    colors(ctx: GameContext): { palMap: number[]; palettes: [number, number, number][][]; fontFrom: number } | null;
  };
  // Gen 2's map colors (Graphics > Palettes): one record holds every bg palette
  // (4 colors, lightest first); an environment picks 8 of them per time of day
  // (1-based ids). Unset: Gen 1's named palettes.
  bgPalettes?: {
    registry: string;
    id: string;
    // the record holding the environments' palette numbers (editable: an
    // environment can get its own copy of a shared palette)
    envsId: string;
    envs(ctx: GameContext): Record<string, Record<string, number[]>>;
    times: { key: string; label: string }[];
  };
  // Gen 2: the editors keep studio scripts inline (a holder's scriptKey is the
  // row list); a save registers each in `registry` and names its key, a load
  // reads the mod's own (`owns`) back inline (src/games/gen2/scriptKeys.ts)
  // Events > Flags: the event flags the game and the mod use (Gen 1 names, Gen 2 numbers as strings)
  flags?: FlagSpec;
  scripts?: {
    registry: string;
    outline(maps: Record<string, MapDef>): { maps: Record<string, MapDef>; registrations: { id: string; value: unknown }[] };
    inline(maps: Record<string, MapDef>, scripts: Record<string, unknown>): void;
    owns(id: string): boolean;
    // other records holding inline scripts (Gen 2: phone contacts' calls)
    records?: {
      registry: string;
      outline(table: Record<string, unknown>): { table: Record<string, unknown>; registrations: { id: string; value: unknown }[] };
      inline(table: Record<string, unknown>, scripts: Record<string, unknown>): void;
    };
  };

  load(read: (file: string) => Promise<unknown>, version?: string): Promise<Dataset>;
  normalizeMap(map: MapDef): MapDef;

  layers: EntityLayer[];
  mapFields: FieldSpec[];

  connections(map: MapDef): ConnectionRef[];
  setConnection(draft: MapDef, dir: Direction, target: string | null, offset: number): void;

  cell(map: MapDef, tileset: TilesetDef | undefined, cx: number, cy: number): CellInfo;
  // ledge tiles of a tileset -> the direction the player hops over them
  // (not walkable, but jumped down)
  ledgeTiles?(ctx: GameContext, tilesetId: string): Map<number, string>;
  // game images a mod can replace (Graphics > Images)
  images?: ImageSpec;

  // the Text workspace's sets when a game has several text registries (Gen 2:
  // script texts and named engine texts); unset: the "text" registry, with
  // Gen 1's "On maps" filter, "+ New" and "Used by"
  textSets?: { registry: string; label: string }[];
  // which Role box a person / sign gets (src/ui/roles.ts): Gen 1's (unset) or
  // Gen 2's (roles2.ts: inline scripts and object fields)
  roles?: "gen2";
  // the "text" keys a script shows (its rows, followed through calls and
  // jumps), undefined when `key` is no script: the Text workspace's labels and
  // Used by for a game whose texts are named after their place in the ROM (Gen 2)
  scriptTexts?(ctx: GameContext, key: string): string[] | undefined;
  // times of day the map view can show (Gen 2: morning, day, night); the
  // chosen one reaches paletteKeys as ctx.time. Unset: no choice offered.
  times?: { key: string; label: string }[];
  // palette key per map (what an atlas is colored with)
  paletteKeys(ctx: GameContext): Record<string, string>;
  // tiles a map draws from another image than its tileset's sheet (Gen 2's
  // roof tiles per map group): copied over `first`.. of the sheet
  sheetOverlay?(ctx: GameContext, tilesetId: string, paletteKey: string): { image: string; first: number; count: number } | null;
  // 4 colors, darkest first, for one 8x8 tile of a tileset under a palette key
  tileColors(ctx: GameContext, tileset: TilesetDef, paletteKey: string): (tile: number) => Rgb[];
  // the map view's region buttons (Gen 2: Johto, Kanto): the map each jumps to
  regions?: { label: string; map: string }[];
  // Gen 2: the tileset's animated tiles (unset: Gen 1's, from its `animation`)
  tileAnimations?(ctx: GameContext, tileset: TilesetDef, id: string): import("../core/tilesets.ts").MapAnimation[];
  // Gen 2: the engine's strip patterns a mod's own tile can be animated with
  tileAnimPatterns?: { func: string; frames: number; label: string }[];
  // the sprite and the map object it stands for, when the game colors sprites one by one (Gen 2)
  spriteColors(ctx: GameContext, paletteKey: string, sprite?: SpriteDef, entity?: EntityRecord): Rgb[];

  newMap(init: { id: string; tileset: string; width: number; height: number; fill: number; index: number }): MapDef;

  content: ContentSpec[];
  pokemon?: PokemonSpec;
  encounters?: EncounterSpec;
  timedEncounters?: TimedEncounterSpec;
  globals?: GlobalsSpec;
  trainers?: TrainerSpec;
  moves?: MoveSpec;
  items?: ItemSpec;
  towns?: TownSpec;
  renames?: Record<string, RenameSpec>;
  events?: EventSpec;
}
