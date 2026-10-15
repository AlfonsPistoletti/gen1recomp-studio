# G1R Studio (Gen1Recomp Studio)

Map/content editor for gen1recomp (sibling repo `../gen1recomp`, or a release
build). Tauri 2 desktop app; the whole editor runs in the web view.

## Commands

- `npm run tauri dev`: desktop app with hot reload
- `npm run tauri build`: installers in `src-tauri/target/release/bundle/`
- `npm run dev`: browser mode on http://localhost:5178 (Node host via Vite middleware)
- `npm run typecheck`, `npm run build`
- `npm run selftest`: round-trip check on the real imported dataset (never writes to `mods/`)
- Rust: `cargo build` in `src-tauri/` (needs `~/.cargo/bin` on PATH in fresh shells)

## Architecture

- `src/host/types.ts`: the only machine access: read/write (text and binary)/delete/list files, image
  URLs, run modkit. `tauriHost` (Rust commands + `studio://` image protocol in
  `src-tauri/src/main.rs`) or `httpHost` (`server/nodeHost.ts` behind `server/api.ts`).
  Root `"game"` = folder holding `mods/`; `"cache:<version>"` = imported dataset.
- Install detection (checkout vs release, mods dir, dataset lookup) exists twice and
  must stay in sync: `src-tauri/src/paths.rs` and `server/paths.ts`.
  A version counts as imported only with `data/generated/maps.lua` and `rom-cache.complete`
  (the source tree's own stale dataset has no marker).
- `src/games/`: one `GameAdapter` per generation (data files, entity layers +
  declarative inspector fields, connections, collision, colors, new-map defaults,
  `content` registries, `pokemon`/`encounters` specs). `gen1` is complete; `gen2`
  (`src/games/gen2`) is in progress: maps/tilesets/sprites are `viewOnly` (store.record refuses those edits and
  emits "viewonly"), content registries Gold shares with Red save into mods with `"games": ["gen2"]`;
  `workspaces` lists the editors done so far. Play on Gen 2 (`playFromHere: false`) starts the game as usual
  with a saving-off helper (`playtestSavingOff`). `npm run selftest:gen2` round-trips a Gold dataset.
  The Pokémon editor reads shape differences from `PokemonSpec` (`keys`: levelMoves/startMoves/evolveInto/picSize,
  `typesTwice`, `breeding` (eggGroupsRaw kept in sync: the engine compares the byte), `heldItems` (`items[1]` common,
  `[2]` rare; a rare-only list loads as `{ "2": id }` and is written `[2] = id`), `monColors`, `without`).
  Moves/Items the same way: `MoveSpec` battleDetails/effectChance/description (<NEXT> lines)/rawBytes (accuracyRaw and
  effectChanceRaw kept in sync: Gold's battle reads the bytes first)/newMoves; `ItemSpec` effects/newItems/pockets
  (pocketId synced)/description/heldEffects/machineOf (Gold TMs: `teaches` + `tmLabel`)/machineEdit. Gold's type chart
  build takes the file's own type records (plain ids, PSYCHIC_TYPE) plus the Foresight rows as matchups.
  Gen 2 maps are editable (tilesets/sprites still view-only, so the tile brush is hidden): warps use
  `warpTarget.backWarp` 255 ("back where the player came from", World:resolveWarp), connections are `{ mapId, offset }`,
  `normalizeMap` drops the extractor's destGroup/destMapNum and connection extras (never read). NPC/sign/trigger
  scripts are cart bytecode: the studio only lets an entity reuse a scriptKey of the same layer on that map. Inspector
  field keys may be dotted paths (`radius.x`, `hours.0`); selects can be `numeric` with `labels`.
  Gen 2 encounters (`adapter.timedEncounters`, `src/ui/timedEncounterPanel.ts`): registry ids are kinds (grass,
  water, fishGroups, ...) holding every map/group; the panel edits one map's entries inside them (grass per
  MORN/DAY/NITE, water, the map's `fishGroup` and that group's rods), so a save patches only those entries.
  Also headbutt trees / rock smash (`trees`/`rocks` map -> set name, `treeSets` shared lists with a % chance per row;
  Gold/Silver never roll the CITY/NONE/UNUSED sets) and swarm tables (shown only where the game has one). The Bug
  Contest list is not offered: the engine reads data.encounters, not gen2Encounters (ISSUES #5).
  Gen 2 trainers: a class record holds `trainers` [{ name, trainerType, party }]; `TrainerSpec.teams` reads/writes
  them as the editor's teams (trainerType follows the slots: item/moves), slots may hold an `item`; usage counts,
  AI, colors, portrait borrowing and new classes/teams are off (`usage`/`ai`/`colors`/`basePic`/`newTeams` false):
  New Gold trainers: "+ Trainer" appends to a class (member = index), and a map person gets a `trainer` record
  (`TrainerSpec.objectTrainer`, `src/ui/mapTrainer.ts`): class index, member, a free "beaten" event flag (from 2047 down,
  past every flag the game data uses: Gold 1931, Crystal 1999) and new `text` keys STUDIO_TRAINER_<n>_SEEN/_WIN;
  the game fights it through its standard trainer script. After-battle talk reuses another trainer's scriptKey.
  New Gold classes ("+ Class"): the engine finds a class by its `index` (Trainers.classIndex over the merged table), so
  a copy gets the next number, the source's first trainer, its portrait (mod art, or the ROM's through asset
  transforms) and its colors (`palettes` registry id "trainers"). `TrainerSpec.limits` (index <= 255, 255 trainers
  per class: bytes in the schema) is enforced by the editor: never offer more than the engine holds.
  Gen 2 tilesets (Gold/Silver; Crystal view-only, its blocks are rewritten by crystalTiles): `studio_tilesets` holds
  `{ first, tiles, palettes, blocks, collision }` (a collision quad per added block, a palette slot per added tile),
  patched in at load by `src/lua/tilesetRuntime2.ts`. `adapter.tileCollision` switches the Tilesets editor to that
  model (per-quarter collision codes, palette slot per tile; editTileset keeps collision/palettes the length of
  blocks/tiles); `adapter.graphicsViews` limits Graphics to Tilesets. Limits: 256 blocks, 256 tiles (LimitError).
  Gold Pokédex entries: pokedex.lua `entries` are loaded into each species' `dexEntry` (base), edited inline
  (`PokemonSpec.dexInline`: pages of <NEXT> lines, height ft*100+in, weight 0.1 lb); gen1recomp
  PokedexText.apply copies the saved patch onto the entry (engine f8eafdb0 or later). Gen 2 colors: `palettes.lua` environments[env].DAY -> 8 bg palettes (1-based ids), a tile's slot =
  tileset `tilePalettes[tile]` (1-based), roof slot colors from `roofs[group]` in TOWN/ROUTE; walls from per-block
  `collision` quads via gen1recomp's CollPermissions table (restated). The map panel shows music/roof/rules only when
  the game has those registries (`has()` in inspector.ts). Gen 3 shows as "coming soon".
- Content registries: the adapter's `content` list (pokemon, encounters, text,
  text_pointers editable; moves, items lookup-only) loads into `Dataset.content`.
  `store.ts` keeps every editable registry (maps included) as records with one undo
  history. Map edits emit `"edit"`, other registries `"content"`, and undo/redo of a
  non-map record emits `"reveal"`. Save writes every editable registry; ops of
  registries the studio doesn't edit are kept verbatim.
- UI workspaces (Maps / Pokémon / Moves / Items / Trainers / Text / Events / Graphics / Global; Graphics has views Tilesets, Sprites, Images, Palettes and Town Map, picked in a drop-down on top of the left panel: panels carry `data-view`, `nav.showGraphics`): `index.html` has one panel set per
  workspace (`data-ws`), switched in `main.ts`. Cross-links go through `src/ui/nav.ts`;
  the top-bar changes dropdown (`src/ui/changesMenu.ts`) maps each changed record to a nav call.
  Encounters live in the Maps right panel, not in a workspace: its bottom tab bar
  (`src/ui/rightTabs.ts`) switches BASE (palette + properties) and ENCOUNTERS.
  Global (`src/ui/globalWorkspace.ts`) edits what `adapter.globals` lists, and only
  settings the engine really reads (several documented constants such as partyMax are
  seeded but never read in Gen 1). Defaults are the engine's, and values equal to the
  default are dropped. `constants` is a `replace` registry (override; "deep" merge
  appends lists). `type_chart` records are built from type_chart.lua via
  `ContentSpec.build` ("ATK>DEF" -> {multiplier}, type id -> {category}); type ids are
  record ids (PSYCHIC_TYPE), not display names.
- Trainers (`src/ui/trainerEditor.ts`, `adapter.trainers`): `trainers` records hold
  `parties`; a slot's optional `moves` is the only per-mon setting the engine reads
  (DVs are one global set, no Stat Exp). Default moves = Pokemon.movesAtLevel plus the
  engine's signature-move tables (restated in the gen1 adapter). Item/switch AI is the
  `ai_classes` registry; its vanilla records live in gen1recomp `data/scripts`, so
  the adapter restates them (`ContentSpec` without `file`, built by `build`). "Unused" counts map NPCs plus
  battles scripts start: the game's (`scriptBattles`, rival_battle/start_battle rows in data/scripts, checkout
  only) and the mod's events.
- Imported art (`src/core/assets.ts`, `src/ui/artImport.ts`): kept in memory until Save, records
  point at `mods/<mod>/assets/studio/<name>_<hash>.png` immediately; Save writes the ones
  the studio file references and deletes unreferenced files in assets/studio/ only.
  Encode PNGs with `toDataURL` (sync): `canvas.toBlob`'s callback was seen to never arrive.
  New species need an `icon` (dex 152+ has no byDex default); `cry` = a species id.
  A mod may never contain the string `assets/generated/` (modkit MK301 is a text search
  over its .lua/.json): copies get placeholder art, and Save checks the written diff
  (`romReferences`). Trainers reuse portraits through `basePic`. The only sanctioned way
  to reuse ROM art is the manifest's `assets_transforms` recipe: the studio writes
  `studio_transforms.lua` on save (`syncTransforms`) from the `save/mod-derived/<mod>/studio/`
  paths its file uses, and previews them from the cache (`derivedSource`). Mods with their
  own transforms file can't use it (one recipe per manifest).
- References: the VM's `registry:get(id)` returns a stand-in carrying `{ __ref = "reg:id" }`;
  the writer turns `{ __ref }` values back into `mod.content.<reg>:get(id)` (+ a per-registry
  fallback). Used for move animations (`battle_anims`, a `replace` registry with no file) so
  no ROM animation data is copied into mods.
- Custom move effects: specs (EffectSpec in `src/games/types.ts`) live in the mod's
  `studio_effects.lua` (a `ContentSpec` with `studioFile`, written whole by `dataFile`);
  `src/lua/effectRuntime.ts` is the fixed Lua helper written into studio_content.lua that turns
  them into `move_effects` records. Its `move_effects` ops are never kept on save (`generator.writes`).
  The engine iterates `run()`'s result with ipairs: it must always return a list. Vanilla effect
  descriptions/block templates: `src/games/gen1/effects.ts`.
- Custom item effects follow the same design: `studio_item_effects` registry ->
  `studio_item_effects.lua`, `src/lua/itemEffectRuntime.ts` -> `item_effects` (Gen 1's
  ItemEffects.use runs `data.item_effects[item.effect]` before its id-based code). Vanilla
  descriptions/templates: `src/games/gen1/items.ts`. Each studio-file `ContentSpec`
  carries its helper as `generator` (`writes`: registries its ops are regenerated in). The helper may only `require` `src.pokemon.Stats`
  (modkit MK006). `balls` is a `replace` registry restated from the engine. Shop stock is
  `text_pointers[<map label>][TEXT_*].mart`.
- "deep" registries (`ContentSpec.deep`: text_pointers, field): the engine APPENDS patched
  lists. `diffDeep` writes only a grown list's tail; any other changed list becomes a
  `{ __replace }` marker that `recordCall` splits (`splitReplaced`) into two patches: the list set
  to `mod.DELETE`, then the new list (an override would copy `assets/generated/` paths: MK301).
  `applyOps(..., deep)` appends the same way when reading a mod back.
- Town Map (Graphics > Town Map, `src/ui/townMapEditor.ts`): edits the `field` record `townMap`
  (grid `background.map`, `locations`, `cursorOrder`). Own tiles are shade digits in
  `background.tiles.studioTiles` (schema `any`), `path` then points at the recipe's
  `studio/townmap/tiles.png` (`townMapSheets`). Fly to new towns: blocked (Map.isFlyTown).
- Item balls: any map object with `item` (not pokered's "0") is picked up (gen1recomp talkTo; its text id is never
  shown, vanilla ones point at asm PickUpItemText). Role "Item ball" in `roleSection` (`isItemBall`, inspector.ts keeps
  `item` out of the JSON extras); toolbar "+ Item ball" = the objects layer's `variants` (EntityLayer).
- Towns (`src/ui/mapTown.ts`, `adapter.towns`): NPC roles are text_pointer flags (mart list,
  nurse, pc); hidden events (`towns.hidden`: PC tiles, bench guys, hidden items/coins, gym
  statues) are per-map lists in `field` (`hiddenExtras.*`, `hiddenItems`, `hiddenCoins`); bench
  guy texts resolve via `towns.benchText` (the engine's BENCH_GUY_TEXT, restated); landing spots `field.flyWarps[MAP]`
  (Teleport/Dig/blackout land there via lastHeal.outdoor). Fly to new towns is deferred:
  `Map.isFlyTown` rejects index >= 11 and the Town Map would need a hook too.
- Prize counters: `prize_counters` registry ("<MAP_ID>:<TEXT_ID>", vanilla three restated per
  version in `src/games/gen1/prizes.ts`; `adapter.load` gets the version) -> `studio_prizes.lua`
  (only records differing from base) -> `src/lua/prizeRuntime.ts` map_scripts talk functions.
  It requires engine modules inside the handler, so `syncPermissions` adds `engine_internals`
  (removed again only if no other mod file requires `src.*`).
- Renaming a mod's own record id (`src/ui/renameId.ts`, `adapter.renames`): references are found
  only through each registry's RenameSpec fields/lists (never blind string replacement), plus
  `keyed` registries, an id-derived text key and `{ __ref }`s; maps included, `text` prose never.
- Battle sprite sizes: the engine draws a battle pic of any size at `battle_sprite_scales[path]` >
  `pokemon.battleScaleFront/Back` > default (front 1x, back 2x), grounded by its transparent rows
  (BattleState resolveBattleScale/backPlacement/frontPlacement). The studio's back import offers
  `backSizes` and sets battleScaleBack = 1 for > 32 px. Battle-sprite imports keep alpha-0 pixels (`ArtTarget.keepTransparent`).
- Cries: the engine plays `cries[<species id>]` (the pokemon record's `cry` field is not read in
  Gen 1), so new species get a `cries` record (`{ base }` or a copied `{ file }`). `cries` is a
  `replace` registry (chip data / base / file shapes). Imported sounds use the art asset pipeline
  (`addAsset(..., ext)`, `ASSET_TYPES`); `host.openUrl` opens https links (Tauri `open_url`).
- Music & sounds (Global, `src/ui/soundEditor.ts`): `music` / `sfx` are `replace` registries; the
  game's records are chip data, a mod's are `{ file, loopFile? }` (Music.lua: intro once, loop part
  repeats; `loopSeconds` is accepted but never read, so no loop point inside one file). New songs
  appear in map Music menus and Play music/sound events; deleting a used one is refused.
- Events (`src/ui/eventEditor.ts`, `adapter.events` catalog in `src/games/gen1/events.ts`):
  `studio_events` records `<MAP>:talk|step|enter:<key>` -> `{ x?, y?, once?, rows }`, rows in the
  engine's script format. `src/core/eventBlocks.ts` compile/parse rows <-> blocks (If/Else,
  Choice; numeric jumps become `step<N>` labels; unstructured jumps stay Go to/Label blocks).
  `src/lua/eventRuntime.ts` registers talk rows, builds onStep/onEnter, and the
  `studio:check_choice` command. The game's own events come from `data/scripts` via
  `loadGameScripts` (checkout only, stubbed GameVersion/MapScripts). Generators belong to the
  studio registry (prize counters and events both write map_scripts).
- Tilesets (`src/core/tilesets.ts`, `src/ui/tilesetEditor.ts`): `tilesets` is an editable registry
  (dataset tilesets as base records; the mod's own are registered whole, image in assets/studio).
  Vanilla tilesets are never patched by hand: additions live in `studio_tilesets`
  (`studio_tilesets.lua`: `{ first, tiles = 64 shade digits each, blocks, walkable }`), and
  `src/lua/tilesetRuntime.ts` patches the vanilla id in place (blocks/walkable = `get(id)` lists +
  additions; a copy under a new id would lose the engine's id-keyed rules). The engine draws one
  image per map, so the recipe (`syncTransforms` sheets) builds base sheet + added tiles into
  `save/mod-derived/<mod>/studio/tilesets/<id>.png`; the editor composes the same in memory
  (`tilesetUrl`). Read tilesets through `liveTileset`/`tilesetUrl`, never `data.tilesets`.
  Added tile ids start at the sheet's tile count; only the last block can be deleted (ids
  must not shift). An added tile is shade digits or a reference "<TILESET>:<tile>" to an original tile
  of a cache tileset (`parseTileRef`, `canCopyFrom`; "+ Blocks from another tileset…"): `sheetRecipes`
  turns it into `{ from, x, y }` and the recipe blits it from the player's sheet; `compose` draws it the same. RED++ colors tiles past the vanilla count with palette group 7.
  Animated tiles: the engine's `animatedTiles` ("frames": one 8x8 image per frame) replaces the
  built-ins of `animation`, so they are restated (water hshift; flower frames = recipe copies of
  the cache's). Extensions keep frames as digits (`animated`, recipe writes them); mod tilesets keep
  engine entries with mod asset images (`ownAnimations`/`setOwnAnimations`). Never on GYM/FACILITY.
- Sprites (`src/core/sprites.ts`, `src/ui/spriteEditor.ts`): `sprites` is an editable registry (dataset
  sprites as base records). Vanilla art is replaced by patching `image` only; a game sheet is never
  composed into a mod asset (Replace frame needs the mod's own sheet). Read sprites through
  `liveSprite`/`spriteUrl`, never `data.sprites`. Walk preview restates movement.asm (walk frame on
  ticks 4..11 of 16, up/down mirrored every other step; shown at NPC pace, 32 frames a step).
- Replaced game images (`src/ui/imageEditor.ts`, `adapter.images`): gen1recomp `Assets.resolve` loads
  `mods/<id>/overrides/<rel>` instead of `assets/generated/<rel>`. `image_overrides` records (rel ->
  content hash, "disk" for files found on load) are files, not registry calls (`ContentSpec.files`);
  `saveOverrides` writes new ones and deletes unrecorded override PNGs. Sprites/tilesets/Pokémon/
  trainer pics are skipped there (their editors patch records instead). "copy:<rel>" records show another
  game image: the recipe's ALIASES copy it to save/mod-derived/<mod>/<to> (Assets.resolve's second
  choice, so no overrides/ file may exist for it); reloaded from the recipe (`aliasesInRecipe`).
  `src/core/reuse.ts` (`canDerive`, `reusable`) decides when game art may be reused.
- RED++ colors (`src/core/gbc.ts`): read from gen1recomp `data/palettes_gbc.lua` (+ `_yellow`) via the
  "game" root, so checkout only (null otherwise: the toggle is disabled). Restates PaletteFX's
  per-map/per-tileset tile exceptions; not the LOBBY alias or dark caves. Map view keys are
  `GBC|<roof colors>|<map with fixes>`; sprites use `spriteGbcColors` (source picture number ->
  spriteAssignment, "random" hashed from `<MAP>_obj_<index>` like PaletteFX.spriteObp). A mod's choices live in
  `studio_tilesets[id].gbc` ({groups: [tile, group][], palettes?: 8x4 for its own tilesets}; a mod
  tileset's record holds only `gbc`, so `extensionOf` ignores non-base ids); the helper writes them
  into `require("data.palettes_gbc").world` at load (no API), `generator.internals` predicate.
  Battle pics/images (`src/ui/picColors.ts`): Pokémon/Trainers/Images preview in a palette, the pic's
  own (PaletteFX.monPalName / BattleState.trainerPalette) or RED++'s (`gbcPalette`, `gbcMonPalette`:
  palettes_gbc.lua, Yellow palettes_yellow.lua cgbBase); tinted by `showTinted` (render/graphics.ts).
  A mod sets them per record: pokemon/trainers `palette` (a palettes id, both color modes); sprites
  `paletteSource` (RED++ only: a ROM picture label whose color set it wears, `spriteColorSets`). In the
  Game Boy colors a sprite always takes the map's palette, and images have no per-image palette.
  Roofs: `studio_roofs` (map id -> { index, colors }) -> `world.roofByMapIndex[index]` (mod maps have
  index >= 1000 and no town roof otherwise).
- Top bar: game + mod pickers, the mod menu (gear: Mod details, Validate, Pack, install/switch folder),
  tabs, undo/redo, changes, Play, Save (icon-only so it fits 1280 px, a 1920 laptop at 150%). Map
  toolbar: tools | view toggles (icons, keys G C E N W A) + RED++ | add icons, one row. Menus use
  `dropdown()` (`src/ui/dom.ts`, `.menu`/`.menu-row`/`.menu-sep`).
- Sharing (gear menu, `src/ui/share.ts`): Export .zip (`src/core/zip.ts`, CompressionStream, files via
  `host.imageUrl`, `host.saveExport`) and Publish on GitHub (`publishMod` in `src/project/publish.ts`: manifest
  github/version, modkit's release workflow copied once (checkout `tools/mod_release_workflow.yml`, else the
  studio's copy in src/project/), then git in `mods/<id>/` through `host.git`, an allow-list of subcommands).
- Mod page (gear menu, `src/ui/modPage.ts`): README.md, written to disk directly (outline from the manifest;
  modkit's developer README counts as missing). DIFFERENCES.md is rewritten on every save from
  `store.changed()` (`differencesMarkdown`, changesMenu.ts). Changes are grouped by `grouped()`: Global-edited
  records join the constants group "Global settings".
- Starters (Global > Starter Pokémon, `starterCards`): `studio_starters` (ball species -> { species, level })
  -> `studio_starters.lua` -> `src/lua/starterRuntime.ts` wraps the public `script.command` hook and maps the
  Oak's Lab ball rows (dex entry, received texts, give_pokemon) in OAKS_LAB only; the questions are `text`
  records (`_OaksLabYouWant*Text`). Red/Blue only (Yellow's Pikachu is the follower).
- Gift Pokémon (Global > Gift Pokémon, `giftCards`): the list comes from the game's scripts (`gameGifts`:
  talk rows, literal give_pokemon rows under `M.<MAP>`, restated `CODE_GIFTS` for dojo/fossils; checkout only).
  `studio_gifts` ("<MAP>:<SPECIES>" -> { species, level }) -> `src/lua/giftRuntime.ts` wraps `script.command`
  and swaps give_pokemon rows on that map. Script files are per version (`loaded`, from init.lua's requires).
- Oak's speech (Global > Oak's speech, `src/ui/introEditor.ts`): `studio_intro` record `speech = { steps }`
  -> `studio_intro.lua` -> `src/lua/introRuntime.ts` wraps the public `intro.oak_speech.build` hook (game
  steps by id + changed keys, own steps whole, other mods' steps kept after their predecessor) and sets
  answer flags in the save on `intro.oak_speech.answered`. Game steps restated in `VANILLA_INTRO`; new
  texts `STUDIO_INTRO_<n>`; demo Pokémon = `field.oakSpeech.demoSpecies`. Answer flags feed the event
  editor's flag suggestions (`knownFlags`).
- Badges (Global > Badges, `badgesCard`): `constants.badges` (ordered { id }, position = trainer card slot; constants.lua
  has none, so the engine's VANILLA list is restated and an equal list isn't written). The engine's badge test is
  the id containing BADGE (Bag.isBadge: hidden from the bag), not `keyItem`; the card draws only 8 slots.
- Start values (Global > Start values, `newGameCard`; the Global list groups sections under Game / New game / Other headings, `GlobalsSpec.sections[].group`): `field.boot` start map/cell/facing, startMoney, lastHeal (unset = the
  engine derives it, SaveData.defaultHeal). boot is not in field.lua (Data.lua seeds it), so the gen1 adapter
  restates BOOT_DEFAULTS as the base record (field `build`) and a change is a patch of the changed keys.
- Play from here (`src/lua/playRuntime.ts`, `host.play`): the studio writes `mods/studio_playtest/`
  (experimental + `force_enable_env` = PLAY_ENV, engine_internals) and starts the game with
  `--game=<version>` and PLAY_ENV=1 (`gameCommand`/`game_command`: release exe, or love.exe + checkout,
  found like scripts/run.ps1). The helper continues the active save moved to the cell (SaveData.load ->
  game:restoreSave on the first `core.update`; new game via `field.boot` when there is none), lists itself
  in the loaded meta.mods (no load report about it) and vetoes `save.write` (Game:writeSave). The
  edited mod gets the same `force_enable_env` (`ensurePlayEnv`). listMods hides `studio_playtest`.
- Outdoor maps: `map.outdoor` (engine Oct 2026+, Map.isOutdoor; unset = tileset OVERWORLD) decides
  indoor every-step encounters (index >= firstIndoorMap, not FOREST) and Fly/Teleport; the studio
  mirrors it in `isOutdoorMap`/`rollsEverywhere` and offers it in map Rules (`mapRules.ts`).
- Status numbers (Global > Status conditions): `statuses` restated from the engine's Status.lua
  (catch/shake bonus, statPenalty.div; GlobalNumber keys may be dotted paths). Records carry battle
  code in the engine, so the registry is patched, never `replace`.
- Game Corner: coin price and win odds are engine code (field.coinPurchases is never read); the
  studio edits `field.slotWheels` (`src/ui/slotEditor.ts`, 15 symbols + first 3 again) and offers
  `studio:give_coins` / `studio:check_coins` event commands (eventRuntime) for coin sellers.
- Map view animation (overlay "Animate", A): `mapAnimations` (water shift tile 20, flowers from the
  cache, the mod's own) -> `animationFrames`; each cached map redraws only its animated 8x8 cells
  into its canvas when a frame changes (`stepAnim`), timed by a setTimeout to the next step.
- Mod trainers (`src/ui/trainerEvents.ts`): no registry writes trainer_headers, so a studio trainer
  is a talk event + one step event per sight cell (ids `<MAP>:step:trainer<objIndex>_<k>`); the
  settings live in the talk event's `trainer` field and the events are rebuilt from them.
- `applyOps` stamps `id` only in registries whose records carry one (an `id` in a
  text_pointers record broke the engine's schema); on load it drops such a stray id.
- `applyOps` must not stamp `id` onto `{ __ref }` values (a reloaded reference was re-saved as a
  broken table once).
- Custom types: `type_chart` type records ({name, category}) plus "A>B" rows; the engine reads
  types generically (TypeChart.category/displayName). Type names fit 8 letters.
- Forms: `rerender()` skips while the focused field has uncommitted typing and marks
  the container `deferred`; `onFocusLeave` only re-renders when something was deferred
  (an unconditional re-render on blur replaced the next field under fast typing).
  Forms re-render with `rerender()` (keeps focus, skips fields with uncommitted typing).
- Text format (`src/core/gbtext.ts`): `\n` second line, `\v` scroll, `\f` page break.
  The editor shows lines with a blank line between pages and only rewrites changed strings.
- `src/lua/vm.ts`: wasmoon Lua 5.4. Loads `data/generated/*.lua` and runs mod entry
  points against a stand-in mod API that records registry calls (memory/time capped,
  LuaJIT compat). Mods `require` only from preloaded files.
- `src/project/project.ts`: base = dataset + mod's main.lua ops (minus the studio file);
  save diffs every editable registry against base and rewrites only
  `mods/<id>/studio_content.lua` (patch / register / override for strings / remove).
- `src/core/merge.ts` mirrors gen1recomp `src/mods/Merge.lua` record semantics
  (lists replace, objects merge, `mod.DELETE`).
- Tile brush (tool "tile", `src/core/tileBrush.ts` `blockWithTile`): identical block, else the
  cell's own mod block in place (used nowhere else), else a new block (extension / own record);
  map block ids are 0..255 (Schemas), so 256 blocks max. Edits of different records with the same
  label in one unsealed gesture merge into one undo step (`store.record`).
- Rendering: block atlas per (tileset, palette) and one cached canvas per map;
  never redraw per tile per frame.

## Rules

- Unfinished features go behind `FEATURES` (`src/features.ts`): on in the dev server, off in release builds
  (`__EXPERIMENTAL__` is a Vite `define`, so builds drop the code); `VITE_EXPERIMENTAL=1 npm run tauri build`
  makes a test build with them. Gen 2 is gated there (`games/index.ts` ADAPTERS).

- gen1recomp itself is read-only: never edit its `src/` or `tools/`; only write mods.
- Saved mods must pass `py tools/modkit.py validate <id> --strict` and `lint` (checkout).
- Release builds pack the engine's scripts into the exe: never depend on reading
  gen1recomp `src/` or `data/scripts` at runtime. If a feature needs release-only
  workarounds, the plan is to drop release support rather than add them.
- Lua code inside JS template strings in `vm.ts` must not contain backticks.
- Test UI changes in a real browser: playwright-core from a scratch folder, driving
  the installed Chrome; for the desktop window launch the exe with
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>` and use
  `connectOverCDP`. Delete any throwaway mods created while testing.
