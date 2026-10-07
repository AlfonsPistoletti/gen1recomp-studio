# Gen1Recomp Studio

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
  `content` registries, `pokemon`/`encounters` specs). Only `gen1` exists; Gen 2/3
  show as "coming soon" in the game picker.
- Content registries: the adapter's `content` list (pokemon, encounters, text,
  text_pointers editable; moves, items lookup-only) loads into `Dataset.content`.
  `store.ts` keeps every editable registry (maps included) as records with one undo
  history. Map edits emit `"edit"`, other registries `"content"`, and undo/redo of a
  non-map record emits `"reveal"`. Save writes every editable registry; ops of
  registries the studio doesn't edit are kept verbatim.
- UI workspaces (Maps / Pokémon / Moves / Items / Trainers / Text / Events / Graphics / Global; Graphics has two views, Tilesets and Sprites: panels carry `data-view`, `nav.showGraphics`): `index.html` has one panel set per
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
  the adapter restates them (`ContentSpec` without `file`, built by `build`).
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
  them into `move_effects` records. Its `move_effects` ops are never kept on save (`generates`).
  The engine iterates `run()`'s result with ipairs: it must always return a list. Vanilla effect
  descriptions/block templates: `src/games/gen1/effects.ts`.
- Custom item effects follow the same design: `studio_item_effects` registry ->
  `studio_item_effects.lua`, `src/lua/itemEffectRuntime.ts` -> `item_effects` (Gen 1's
  ItemEffects.use runs `data.item_effects[item.effect]` before its id-based code). Vanilla
  descriptions/templates: `src/games/gen1/items.ts`. `project.ts` GENERATORS maps each
  `generates` registry to its helper. The helper may only `require` `src.pokemon.Stats`
  (modkit MK006). `balls` is a `replace` registry restated from the engine. Shop stock is
  `text_pointers[<map label>][TEXT_*].mart`.
- "deep" registries (`ContentSpec.deep`: text_pointers, field): the engine APPENDS patched
  lists. `diffDeep` writes only a grown list's tail and overrides the record when a list
  shrank; `applyOps(..., deep)` appends the same way when reading a mod back.
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
  `backSizes` and sets battleScaleBack = 1 for > 32 px; the Art card's battle preview restates the
  placement math. Battle-sprite imports keep alpha-0 pixels (`ArtTarget.keepTransparent`).
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
  `loadGameScripts` (checkout only, stubbed GameVersion/MapScripts). GENERATORS are keyed by
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
  must not shift). RED++ colors tiles past the vanilla count with palette group 7.
  Animated tiles: the engine's `animatedTiles` ("frames": one 8x8 image per frame) replaces the
  built-ins of `animation`, so they are restated (water hshift; flower frames = recipe copies of
  the cache's). Extensions keep frames as digits (`animated`, recipe writes them); mod tilesets keep
  engine entries with mod asset images (`ownAnimations`/`setOwnAnimations`). Never on GYM/FACILITY.
- Sprites (`src/core/sprites.ts`, `src/ui/spriteEditor.ts`): `sprites` is an editable registry (dataset
  sprites as base records). Vanilla art is replaced by patching `image` only; a game sheet is never
  composed into a mod asset (Replace frame needs the mod's own sheet). Read sprites through
  `liveSprite`/`spriteUrl`, never `data.sprites`. Walk preview restates movement.asm (walk frame on
  ticks 4..11 of 16, up/down mirrored every other step; NPC 32 frames a step, player 16).
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
  into `require("data.palettes_gbc").world` at load (no API), GENERATORS `internals` predicate.
  Roofs: `studio_roofs` (map id -> { index, colors }) -> `world.roofByMapIndex[index]` (mod maps have
  index >= 1000 and no town roof otherwise).
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
- Rendering: block atlas per (tileset, palette) and one cached canvas per map;
  never redraw per tile per frame.

## Rules

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
