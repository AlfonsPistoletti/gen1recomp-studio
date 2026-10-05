# Gen1Recomp Studio

A content editor for [gen1recomp](../gen1recomp): maps, wild encounters,
Pokémon data and in-game text. It reads the game's own Lua data through a real
Lua VM, renders maps from cached block atlases, and saves edits as a normal mod
that passes `modkit validate --strict` and `lint`.

## Run

Desktop app (needs Rust and, on Windows, the Visual Studio C++ Build Tools;
see https://v2.tauri.app/start/prerequisites/):

```sh
npm install
npm run tauri dev      # desktop window, hot-reloads the front end
npm run tauri build    # installers in src-tauri/target/release/bundle/
```

In the browser, without Rust:

```sh
npm run dev            # opens http://localhost:5178
```

### Which gen1recomp

The studio works with either a **source checkout** of gen1recomp or a
**release build** (the folder with `gen1recomp.exe`, `gen1recomp.app` or the
Linux binary/AppImage). The desktop app asks for the folder on first start
and remembers it; the button at the left of the top bar switches folders. In
the browser, set `GEN1RECOMP_ROOT` or create `studio.config.json`:

```json
{ "gameRoot": "D:/code/gen1recomp" }
```

|  | Source checkout | Release build |
|---|---|---|
| Mods are read and written in | `<repo>/mods` | the game's save folder, `%APPDATA%\pokemon-love2d\mods` on Windows (`~/Library/Application Support/pokemon-love2d` on macOS, `~/.local/share/pokemon-love2d` on Linux), or next to the executable in portable mode (`portable.txt`) |
| Imported ROM data | `POKEPORT_DATA_DIR`, `<repo>/<version>`, the LÖVE save folder (`…/LOVE/pokemon-love2d/<version>`), then for Gen 1 `<repo>/data/generated`, the same lookup as `tools/modkit.py` | `<save folder>/<version>`, or `<release>/<version>` in portable mode |
| New mod | `tools/modkit.py scaffold` | the studio writes the same manifest itself |
| Validate | `modkit validate --strict` + `lint` | unavailable (releases ship no Python tools) |

A release only loads mods from its save folder; a mod dropped next to a
non-portable executable is a "stray" the launcher copies into the save folder
once, so editing that copy would not reach the game. The studio therefore
always edits the save folder's copy.

Boot the game once with your ROM so its dataset exists. Every imported
version shows up in the game picker.

`npm run selftest` checks the round trip without touching `mods/`. Every
vanilla map must diff to nothing, and edited maps, Pokémon, encounter tables
and text written to Lua and read back must come out identical.

## Workspaces

The tabs in the top bar switch between workspaces (Alt+1 to Alt+7). Game, mod,
undo/redo and Save are shared: one undo history and one save cover every tab.

The changes button next to Validate shows how many records differ from the
game, with a dot while something is unsaved. Click it for the list, grouped by
kind (maps, wild tables, Pokémon, moves, …). Click an entry to open it.


Records a mod adds (Pokémon, moves, items, trainer classes) can get a new
**id** in their editor's Id field; when the display name suggests another id
(STEELIX renamed to ICELIX), a button offers it. Every reference follows:
evolutions, trainer teams, wild slots, shops, prizes, NPCs on maps, the
Pokédex text key. Vanilla ids never change, and a mod's own id should only be
renamed before players have saves with it.

- **Maps**: the map editor. The tabs at the bottom of the right panel switch
  what the panel shows. **Base** has the block palette and the properties of
  the map or the selected warp/NPC/sign. For NPCs and signs it also shows and
  edits what they say. **Encounters** edits the map's wild Pokémon: grass and
  water tables, rate, and the species and level of the ten slots. How likely
  each slot is lives in **Global**.
  - An NPC or sign without text gets a **Create text** button. It makes a new
    text id, pointer and string; existing texts are never changed. An NPC that
    shows an original game line can get **New text for this one**: its own
    copy to edit, while the original stays as it is.
  - **New map** starts empty or as a **copy of a map**: blocks, warps, NPCs,
    signs with their texts and roles, PC tiles, music and wild Pokémon come
    along (e.g. copy a Pokémon Center or Mart for a new town). Connections and
    the game's hand-written scripts for the original are not copied.
  - **Role** (NPCs and signs): normal, **shop clerk** (with its stock list,
    the same one the Items workspace's "Sold at" edits), **nurse** (heals;
    the town outside becomes the Teleport/Dig/blackout return point), **PC**,
    or **prize counter** (signs too).
  - Map properties, **Music**: the song the map plays (bike and surf songs
    still take over while riding or surfing).
  - Map properties, **Hidden events**: things the player can interact with
    that aren't NPCs or signs, shown with an icon on the map: PC tiles, bench
    guys (people drawn into the tiles, like the man on a Pokémon Center bench,
    with their text), hidden items, hidden coins and gym statues. Add one with
    "+ Add (pick on map)". For outdoor
    towns, a **landing spot**: where Teleport, Dig, Escape Rope and blacking
    out put the player after healing at a center in the town. Flying to new
    towns isn't supported yet (it would also need the Town Map).
  - The **Wild** overlay (W) shows which cells roll encounters.
  - A green dot in the map list marks maps with wild Pokémon.
- **Pokémon** (battle sprites): back sprites can be imported at 32×32 (Gen 1,
  drawn doubled) or 48/56/64 px (full resolution, drawn 1:1, like Gen 2).
  Each sprite has a **drawn at** size (the engine's `battleScaleFront` /
  `battleScaleBack`), and a battle preview shows both sprites the way the game
  places them (the player's Pokémon stands on the text box at any size).
  Transparent pixels stay transparent so the game can ground the sprite.
- **Pokémon** (cries): the **Cry** card imports a WAV, OGG, MP3 or FLAC
  file, or borrows another Pokémon's cry; imported sounds can be played in
  the studio. The game's own cries are synthesized by the game while it runs,
  so they can't be previewed. For a new Gen 1 style cry, the card links to the
  Gen 1 cry synthesizer (export a .wav there, import it here). New Pokémon
  start with the cry of the one they were copied from.
- **Pokémon**: base stats, types, catch rate, EXP, growth, evolutions,
  starting and level-up moves, TM/HM compatibility and the Pokédex entry.
- **New Pokémon and trainers**: **+ New** in the Pokémon or Trainers list
  starts as a copy of an existing one.
  - A new Pokémon gets the next dex number, borrows the original's cry and
    menu icon, and gets its own copy of the Pokédex text. It keeps the
    original's sprites through asset transforms (below).
  - **Reusing game art:** a mod may not point at the game's own files
    (modkit MK301). So the studio writes `studio_transforms.lua` (and the
    manifest's `assets_transforms`) on save, and records point at
    `save/mod-derived/<mod>/studio/...`. The game copies the art out of the
    player's own imported data when it loads, and the mod ships no ROM
    pixels.
  - In a mod that already has its own `assets_transforms` file, new
    Pokémon start with "?" placeholders, and only mod art can be reused.
  - A new trainer borrows the original's portrait (`basePic`).
  - New ones can be deleted again; the studio warns if something still uses
    them.
- **Art**: the Art card (Pokémon) and the portrait (trainers) can **Import…**
  an image. A Pokémon can also borrow another new Pokémon's art from the same
  mod, and a trainer can borrow any portrait (`basePic`, which is allowed).
  Save warns about anything that would point at the game's own files.
  - Imports are fitted to the game's sizes: front 40–56 px, back 32 px,
    portrait 56 px, and a 16×16 menu icon with 2 frames.
  - They are converted to the 4 Game Boy shades (coloured by the game's
    palettes), or kept in full colour (`trueColor`, per Pokémon/trainer).
  - On save, images go to `mods/<id>/assets/studio/`, and images nothing uses
    any more are removed from there.
- **Moves**: name, type, power, accuracy, PP, effect, priority, damage
  category override and high critical-hit ratio.
  - "Used by" lists the Pokémon that learn the move (level-up, start, TM/HM)
    and trainers who give it as a custom move.
  - **+ New** copies a move. Its battle animation is another move's, written
    as `mod.content.battle_anims:get("…")`, so the mod carries no animation
    data.
  - **Effects:** every built-in effect has a short description. **Custom
    effect** (or **Customize this effect** on a built-in one) opens a builder:
    - status moves: a list of steps (stat change, status, confuse, heal),
      can miss or not;
    - damaging moves: hits (1–5 or 2–5), normal, fixed or level damage,
      recoil %, drain %, never miss, and side effects with a chance
      (stat change, status, confuse, flinch, heal).
  - Custom effects are plain data in `mods/<id>/studio_effects.lua`. A fixed
    helper in `studio_content.lua` registers them as `move_effects` and
    follows the vanilla rules (Substitute, Mist, type immunity to secondary
    statuses, 2–5 hit spread). Special effects (charge turns, trapping,
    Transform, Metronome, …) stay built-in only.
- **Items**: name, price, key item, TM/HM move, effect, catch numbers for
  balls, and the shops that sell it.
  - Gen 1 items have no categories. Their effects are built into the game
    per item id, and every built-in effect has a short description.
  - **Customize this effect** turns a built-in effect into blocks, and
    **Custom effect** starts one from scratch. The blocks:
    - on a party Pokémon: restore HP (amount, % or full), cure statuses,
      revive, restore PP, stat EXP (vitamin), level up, evolve (stone);
    - in battle or the field: raise a stat (X item), Dire Hit, Guard Spec,
      X Accuracy, escape a wild battle, throw as a ball, Repel;
    - plus where the item works (battle, field, both) and "never used up".
  - Custom effects are plain data in `mods/<id>/studio_item_effects.lua`. A
    fixed helper in `studio_content.lua` registers them as `item_effects`
    with the vanilla refusals, texts and menus (HP bar, level-up screen,
    evolution).
  - Missing from custom effects, because a mod can't reach them: the heal
    sound (the item jingle plays instead), Yellow's Pikachu reactions, and
    Gen 1's par/burn stat quirk after an X item.
  - Special items (Bicycle, rods, Town Map, Escape Rope, Poké Flute, PP Up,
    TMs/HMs, …) keep their built-in behaviour.
  - **+ New** copies an item. A built-in effect comes along as a custom one,
    and a copied ball gets its own catch numbers. New items are saved by id
    and need no ROM slot.
  - **Sold at** adds or removes the item from any shop's stock.
- **Trainers**: every trainer class with its portrait.
  - **Teams**: species, level and order of each team, plus the maps where
    each one is fought. Each Pokémon shows the moves the game gives it: its
    last four level-up moves, plus the signature move some leaders put in
    slot 3. **Custom moves** sets up to four of your own.
  - **AI**: the three move-choice layers, and the item/switch behaviour
    (item, uses, chance, HP limit, switching).
  - Only the last team can be removed, because NPCs pick a team by number.
  - Classes no NPC fights are marked "unused" (e.g. CHIEF and the first JUGGLER).
  - On the map, a trainer NPC's properties show its class and team. **Open
    team in Trainers** jumps to that team.
  - Trainer Pokémon all use the same fixed DVs and no Stat Exp. The engine
    has no per-Pokémon setting for either, so the studio doesn't offer one.
- **Text**: every string of the game's text table, with a text-box preview
  and the maps, NPCs and Pokédex entries that use it. Write one line per row,
  with a blank line between pages. Buttons insert `{PLAYER}`, `{RIVAL}`,
  `{DONE}`, `{PROMPT}` and the like, and "What the commands do" explains each.
- **Global**: game-wide settings, limited to the ones the Gen 1 engine actually
  reads.
  - Wild slot chances.
  - Game Corner prizes: three prizes per counter (items or Pokémon with a
    level, any coin price), for the vanilla counters and any NPC/sign made a
    prize counter. They use the game's own prize window, so a mod with prize
    counters gets the `engine_internals` permission (the mod manager shows
    "PATCHES ENGINE CODE" for that; nothing in the engine is changed).
  - The type chart: every matchup, and physical/special per type.
  - Level cap and bag size.
  - Walking and bike speed, the turn window, poison, blackout money and
    Day-Care EXP.
  - Which badge each HM needs outside battle.
  - Custom types (Type chart → New type): an id, a display name of up to 8
    letters, and physical/special. Set their matchups in the chart.
    Pokémon and moves can use them right away.

  Values set back to vanilla are dropped. Gen 1 has one set of slot chances
  for every map: the engine supports per-table chances, but the mod schema
  rejects them.

Gen 1 cutscenes are hand-written Lua inside the game. The studio edits the
text they show, not their logic.

## Map editing

| Key | |
|---|---|
| V / B / R / F / I | Select, Brush, Rectangle, Fill, Pick |
| G / C / E / N / W | Toggle grid, collision, entities, neighbouring maps, wild cells |
| Right-click / right-drag (or Alt+click) | Pick a block from any tool; dragging copies a region as a stamp |
| Middle-drag, Space+drag | Pan |
| Wheel, + / − | Zoom |
| 0 / Shift+0 | Fit map / fit the whole connected world |
| Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y | Undo / redo |
| Ctrl+S | Save into the selected mod |
| Ctrl+P | Jump to the search of the current workspace |
| Alt+1 … 6 | Maps / Pokémon / Moves / Trainers / Text / Global workspace |
| Arrows, Delete, Esc | Nudge, delete or deselect the selected warp/NPC/sign |

- The open map is drawn with every map connected to it, so the overworld
  reads as one surface. Double-click a neighbouring map to open it.
- Drag across the block palette, or right-drag on a map, to make a multi-block
  stamp. The brush paints the stamp, and Rect tiles it across a rectangle.
- In the Select tool, double-click a warp to jump to its destination.
- Setting a connection also writes the return connection on the other map,
  with the offset mirrored (`back.offset == -offset`, as in vanilla).
- Collision is derived the way `src/world/Map.lua` derives it: from the tile
  at each cell's feet, checked against the tileset's `walkable` list.

## How saving works

Pick a mod in the top bar, or choose **+ New mod…**, which runs
`tools/modkit.py scaffold`. A save writes exactly one file,
`mods/<id>/studio_content.lua`:

- A vanilla map you changed becomes `mod.content.maps:patch(...)` carrying
  only the fields that changed. A removed key becomes `mod.DELETE`, so the
  patch composes with other mods.
- A new map becomes `mod.content.maps:register(...)` at index 1000 or above.
- Pokémon, encounter tables and text pointers are patched the same way, field
  by field. Lists such as learnsets and encounter slots are written whole
  (lists replace when merged). Changed strings become `text:override(...)`;
  new ones become `register(...)`.
- Global settings in `constants` are written whole with
  `constants:override(...)`, because that registry merges lists by appending.
  Type chart rows are `type_chart:patch("FIRE>GRASS", ...)`, or `register` for
  a new pair.
- Hand-written code in `main.lua` is never rewritten. The studio runs
  `main.lua` (without its own file) to build the base it diffs against, so
  hand-written patches such as `bills_garden`'s are part of what you see.
- If `main.lua` does not load the studio file yet, the studio offers to add
  `require("mods.<id>.studio_content")(mod)` before its final `end`.

**Validate** saves first, then runs `modkit validate <id> --strict` and
`modkit lint <id>`.

## Layout

```
src/host/      Host: the few things the studio needs from the machine (read/write/list
               files, image URLs, run modkit). httpHost talks to the dev server.
src/lua/       Lua VM (wasmoon, runs in the browser) and the Lua writer
src/project/   load a version + mod, save studio_content.lua, scaffold/wire-up/validate
src/games/     one adapter per generation: data files, entity layers and their
               inspector fields, connections, collision, colors, new-map defaults
src/core/      game-independent model: records, merge/diff (mirrors src/mods/Merge.lua),
               store with undo, block geometry
src/render/    block atlases, sprite frames, the map canvas
src/ui/        workspaces: map list, block palette, inspector (BASE/ENCOUNTERS tabs),
               Pokémon editor, text workspace; shared list, text box editor, splitters
server/        Node host (paths, fs, modkit), the HTTP API for the dev server, selftest
src-tauri/     the desktop shell: the same host as Tauri commands, plus a studio://
               protocol for images
```

Everything except `server/` and `src-tauri/` runs in the web view. Each shell
implements `src/host/types.ts` (`httpHost` for the dev server, `tauriHost` for
the desktop app) and the front end picks one at startup. A new generation is a new adapter in
`src/games/`; Gen 2 and Gen 3 show up in the game picker as "coming soon"
until theirs exists.

## Releases

The repo has two GitHub Actions workflows (`.github/workflows/`):

- **ci**: on every push to `main` and every pull request. Runs typecheck, the
  web build and `cargo check` on Linux (a few minutes).
- **release**: when a version tag (`v0.2.0`) is pushed. Builds the Windows
  installers (`.msi` and `-setup.exe`) and attaches them to a **draft** GitHub
  Release. Publish the draft on GitHub when it looks right.

To release:

```sh
npm run release -- 0.2.0   # sets the version everywhere, runs typecheck + selftest, commits, tags v0.2.0
git push && git push origin v0.2.0
```

The selftest needs an imported ROM dataset, so it only runs locally (the
release script runs it). The installers are not code-signed yet, so Windows
SmartScreen asks for confirmation on first launch.
