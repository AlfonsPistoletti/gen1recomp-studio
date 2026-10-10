# Gen1Recomp Studio: technical notes

For people building or changing the studio. User documentation is in [README.md](README.md);
the detailed engine-facing rules the code follows are in [CLAUDE.md](CLAUDE.md).

The studio reads the game's own Lua data through a real Lua VM (wasmoon), renders maps from cached
block atlases, and saves edits as a normal mod that passes `modkit validate --strict` and `lint`.

## Run from source

Desktop app (needs Rust and, on Windows, the Visual Studio C++ Build Tools; see
https://v2.tauri.app/start/prerequisites/):

```sh
npm install
npm run tauri dev      # desktop window, hot-reloads the front end
npm run tauri build    # installers in src-tauri/target/release/bundle/
```

In the browser, without Rust:

```sh
npm run dev            # http://localhost:5178
```

Other scripts:
- `npm run typecheck`, `npm run build`;
- `npm run selftest`: a round-trip check on the real imported dataset, which never writes to
  `mods/`. Every vanilla map must diff to nothing, and edited records written to Lua and read back
  must come out identical;
- `cargo build` in `src-tauri/` (needs `~/.cargo/bin` on PATH in fresh shells).

## Which gen1recomp

The studio works with a **source checkout** of gen1recomp or a **release build**: the folder with
`gen1recomp.exe`, `gen1recomp.app` or the Linux binary/AppImage.
- **Desktop app:** asks for the folder on first start; the gear menu switches it later.
- **Browser:** set `GEN1RECOMP_ROOT`, or create `studio.config.json`:

```json
{ "gameRoot": "D:/code/gen1recomp" }
```

|  | Source checkout | Release build |
|---|---|---|
| Mods are read and written in | `<repo>/mods` | the game's save folder, `%APPDATA%\pokemon-love2d\mods` on Windows (`~/Library/Application Support/pokemon-love2d` on macOS, `~/.local/share/pokemon-love2d` on Linux), or next to the executable in portable mode (`portable.txt`) |
| Imported ROM data | `POKEPORT_DATA_DIR`, `<repo>/<version>`, the LÖVE save folder (`…/LOVE/pokemon-love2d/<version>`), then for Gen 1 `<repo>/data/generated`: the same lookup as `tools/modkit.py` | `<save folder>/<version>`, or `<release>/<version>` in portable mode |
| New mod | `tools/modkit.py scaffold` | the studio writes the same manifest itself |
| Validate / Pack | `modkit validate --strict` + `lint`, `modkit pack` | unavailable (releases ship no Python tools) |
| RED++ colors, the game's own events | read from `data/palettes_gbc.lua`, `data/scripts` | unavailable |
| Play from here | LÖVE (`love` on PATH, or `Program Files\LOVE`, `%LOCALAPPDATA%\Programs\LOVE`) with the checkout | the release's executable |

**Strays:** a release only loads mods from its save folder. A mod dropped next to a non-portable
executable is a "stray" the launcher copies into the save folder once, so the studio always edits
the save folder's copy.

**Keep in sync:** install detection exists twice and must stay in sync: `src-tauri/src/paths.rs`
and `server/paths.ts`. A version counts as imported only with `data/generated/maps.lua` and
`rom-cache.complete`.

## How saving works

A save writes `mods/<id>/studio_content.lua` (plus the data files below):
- **Maps:** a vanilla map you changed becomes `mod.content.maps:patch(...)` carrying only the
  changed fields; a removed key becomes `mod.DELETE`, so the patch composes with other mods. A new
  map becomes `mod.content.maps:register(...)` at index 1000 or above.
- **Records:** other records are patched field by field. Lists such as learnsets and encounter
  slots are written whole, because lists replace when merged. Changed strings become
  `text:override(...)`, new ones `register(...)`.
- **"Deep" registries** (`text_pointers`, `field`) append patched lists, so only a grown list's
  tail is written, and a shrunk list overrides the record. `constants` and the other `replace`
  registries are written whole with `override`.
- **Engine defaults:** values the engine fills in itself are restated as the base, so a change
  becomes a small patch:
  - the new-game start (`field.boot`);
  - balls, statuses, AI classes and signature moves;
  - the vanilla prize counters.
- **Studio data files:** custom move and item effects, events, prize counters, tileset additions
  and RED++ roof colors are plain data in `studio_*.lua` files. A fixed helper written into
  `studio_content.lua` turns them into engine records (`src/lua/*Runtime.ts`).
- **Hand-written code:** `main.lua` is never rewritten. The studio runs `main.lua` (without its own
  file) to build the base it diffs against, so hand-written patches are part of what the user
  sees. If `main.lua` doesn't load the studio file yet, the studio offers to add
  `require("mods.<id>.studio_content")(mod)` before its final `end`.
- **Art and sounds:** imported files go to `mods/<id>/assets/studio/`, and unreferenced files there
  are deleted on save.
  - Replaced game images are `mods/<id>/overrides/<path>`.
  - Reused game art is never copied into a mod (modkit MK301). Instead the studio writes
    `studio_transforms.lua` (the manifest's `assets_transforms`), and records point at
    `save/mod-derived/<mod>/studio/...`, which the game builds from the player's own data.
- **Permissions:** `engine_internals` is added to the manifest when a helper needs engine modules,
  and removed again when nothing does: prize counters and RED++ colors.

## Play from here

- **Helper mod:** the studio writes a small helper, `mods/studio_playtest/`. It is `experimental`,
  with `force_enable_env: GEN1RECOMP_STUDIO_PLAY`, so it is off in normal play.
- **Launch:** the studio starts the game with `--game=<version>` and that variable set to `1`. The
  edited mod's manifest gets the same `force_enable_env`.
- **What the helper does:**
  1. loads the active save (the title screen's CONTINUE), moves the player to the picked cell, and
     calls `restoreSave`;
  2. starts a new game at the cell when there is no save;
  3. vetoes every save write (the `save.write` hook).

## Sharing (Export .zip, Publish on GitHub)

Both follow the gen1recomp wiki's
[Guide-Publishing](https://github.com/bryanthaboi/gen1recomp/wiki/Guide-Publishing).

- **Export .zip:** `src/ui/share.ts` with `src/core/zip.ts`.
  - The zip writer deflates with the platform's `CompressionStream` and has its own CRC32, so there
    is no dependency.
  - Files are listed by `archiveFiles` in `src/project/publish.ts`, which leaves out what the
    release workflow strips (`.git`, `.github`, `.gitignore`, `.gitattributes`, `.luarc.json`).
    They are read through `host.imageUrl` and sit at the archive root, as the game's MODS > Import
    mod .zip expects.
  - `host.saveExport` offers the file: a save dialog plus the `save_export` command (`.zip` paths
    only) in the desktop app, a download in the browser.
- **Publish on GitHub:** `publishMod` in `src/project/publish.ts`.
  - It sets the manifest's `github` and `version`.
  - It writes `.github/workflows/release.yml` once, from the checkout's
    `tools/mod_release_workflow.yml`, or the studio's copy `src/project/mod_release_workflow.yml`
    (keep it in sync). `{{MOD_ID}}` is stamped.
  - Then it runs `git init -b main` / `remote` / `add -A` / `commit` / `push -u origin main` in
    `mods/<id>/`. The workflow builds `<id>-<version>.zip` and publishes the release on every push.
  - **The host's `git`:** it runs only in `mods/<id>/` and only these subcommands: `--version`,
    `init`, `remote`, `add`, `commit`, `push`, `config`, `rev-parse`, `status`.
    `GIT_TERMINAL_PROMPT=0` is set, and Git Credential Manager does the sign-in.
  - **Commit identity:** without a configured email, commits use `<owner>` and
    `<owner>@users.noreply.github.com`.
  - **Checkout:** the mod becomes a nested repository inside the gen1recomp checkout.

## Blocks from another tileset

An extension's added tile is either 64 shade digits (the mod's own pixels) or a reference
`"CAVERN:37"`, an original tile of another cache tileset. `sheetRecipes` turns a reference into
`{ from = "tilesets/cavern.png", x, y }`, and the recipe `blit`s that 8×8 region from the player's
own sheet (`ImageWriter.blit` takes a source region), so the mod holds tile numbers only. The editor
previews the same in `compose`. Copied tiles keep their walkability, water/shore and RED++ group.

## Mod page and DIFFERENCES.md

- **README.md:** edited in **Mod page…** (`src/ui/modPage.ts`) and written straight to disk, like
  Mod details. A missing README, or modkit scaffold's developer README, starts from an outline built
  from the manifest. The preview is a small markdown subset rendered with DOM nodes (no innerHTML).
- **DIFFERENCES.md:** rewritten on every save (`differencesMarkdown` in `src/ui/changesMenu.ts`)
  from `store.changed()`. It is grouped like the changes menu, where everything edited in Global
  joins "Global settings", with the changed top-level fields of each record (labels in `KEY_NAMES`).

## Layout

```
src/host/      Host: the few things the studio needs from the machine (read/write/list files,
               image URLs, run modkit, start the game). httpHost talks to the dev server.
src/lua/       Lua VM (wasmoon), the Lua writer, and the fixed helpers written into mods
src/project/   load a version + mod, save studio_content.lua, scaffold/wire-up/validate
src/games/     one adapter per generation: data files, entity layers and their inspector
               fields, connections, collision, colors, content registries, engine restatements
src/core/      game-independent model: records, merge/diff (mirrors gen1recomp src/mods/Merge.lua),
               store with undo, geometry, assets, tilesets, sprites, RED++ colors
src/render/    block atlases, sprite frames, the map canvas
src/ui/        the workspaces and shared UI (record lists, menus, text fields, splitters)
server/        Node host (paths, fs, modkit, play), the HTTP API for the dev server, selftest
src-tauri/     the desktop shell: the same host as Tauri commands, plus a studio:// image protocol
```

- **Web view:** everything except `server/` and `src-tauri/` runs in the web view. Each shell
  implements `src/host/types.ts` (`httpHost` for the dev server, `tauriHost` for the desktop app),
  and the front end picks one at startup.
- **New generation:** a new adapter in `src/games/`. Gen 2 and Gen 3 show up in the game picker as
  "coming soon" until theirs exists.

## Rules

- gen1recomp itself is read-only: the studio only writes mods.
- Saved mods must pass `modkit validate <id> --strict` and `modkit lint <id>`.
- Release builds pack the engine's scripts into the executable, so the studio must not depend on
  reading gen1recomp `src/` or `data/scripts` at runtime (the checkout-only features above are the
  exceptions, and they degrade gracefully).

## Releases

Two GitHub Actions workflows (`.github/workflows/`):
- **ci:** on every push to `main` and every pull request. Runs typecheck, the web build and
  `cargo check` on Linux.
- **release:** when a version tag (`v0.2.0`) is pushed. Builds the Windows installers (`.msi` and
  `-setup.exe`) and attaches them to a **draft** GitHub Release. Publish the draft when it looks
  right.

```sh
npm run release -- 0.2.0   # sets the version everywhere, runs typecheck + selftest, commits, tags v0.2.0
git push && git push origin v0.2.0
```

The selftest needs an imported ROM dataset, so it only runs locally (the release script runs it).
The installers are not code-signed yet, so Windows SmartScreen asks for confirmation on first
launch.
