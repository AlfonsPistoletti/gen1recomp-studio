# G1R Studio

A visual editor for making mods for [gen1recomp](https://github.com/bryanthaboi/gen1recomp), the
Pokémon Red, Blue and Yellow recompilation. Paint maps, place people and signs, change Pokémon,
moves, items and trainers, write dialogue and small cutscenes, and replace graphics and music,
all without writing code. Try your changes in the game with one click, and share them as a
normal gen1recomp mod.

Your edits are saved into a mod: the game and your ROM are never changed, and a mod never
contains the game's own data or art.

**[📖 Read the guides in the wiki](https://github.com/AlfonsPistoletti/gen1recomp-studio/wiki)**

## Install

1. **gen1recomp:** get the **developer copy** (its source code) and import your Red, Blue or
   Yellow ROM once. A normal gen1recomp download works too, but only the developer copy can
   check a mod before you share it. See
   [Getting started](https://github.com/AlfonsPistoletti/gen1recomp-studio/wiki/Getting-started).
2. **G1R Studio:** download the installer from the
   **[latest release](https://github.com/AlfonsPistoletti/gen1recomp-studio/releases/latest)**
   (Windows: the `-setup.exe` or the `.msi`). The installer isn't signed yet: if Windows shows
   "Windows protected your PC", click **More info**, then **Run anyway**.
3. **Start it,** pick your gen1recomp folder if asked, choose a game and click **+ New mod…**
   in the mod picker.

## Working with your own Lua

The studio and hand-written Lua work side by side in the same mod:

- When it opens a mod, the studio reads what your `main.lua` registers and patches and shows it in its
  editors, so you can keep editing on top of your own changes.
- The studio only writes its own files (`studio_content.lua`, `studio_*.lua`). It never touches `main.lua`
  or your other Lua files. Don't edit `studio_content.lua` by hand: it's rewritten on every save.
- Keep `require("mods.<your mod>.studio_content")(mod)` as the last line of `main.lua`, so the game ends up
  with what the studio shows. If your Lua and the studio change the same record, the one loaded last wins.
- Put `require("src.…")` of engine modules inside the functions that use them: the studio reads `main.lua`
  in a sandbox that only loads your mod's own files.
- Your mod can add its own map kinds, painted areas and event commands to the studio:
  see [Extending the studio](https://github.com/AlfonsPistoletti/gen1recomp-studio/wiki/Extending-the-studio).

## Help

- [Wiki](https://github.com/AlfonsPistoletti/gen1recomp-studio/wiki): every editor explained, with screenshots.
- Found a bug? In the studio: gear menu → **Report a bug…**, or open an
  [issue](https://github.com/AlfonsPistoletti/gen1recomp-studio/issues).

## For developers

Building from source, how the studio works inside, and how releases are made:
see [TECHNICAL.md](TECHNICAL.md).

## License

[MIT](LICENSE).