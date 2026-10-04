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
- UI workspaces (Maps / Pokémon / Moves / Trainers / Text / Global): `index.html` has one panel set per
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
