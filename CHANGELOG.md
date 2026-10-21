# Changelog

What changed in each release of G1R Studio. Releases before 0.3.5 are described on the
[GitHub releases page](https://github.com/AlfonsPistoletti/gen1recomp-studio/releases).

## 0.3.5

### New
- **Events > Flags:** a second view in the Events workspace (drop-down at the top of the list).
  - It lists every event flag the game and your mod use, with what uses each one: set / cleared / checked by an
    event, a trainer's "beaten" flag, a person shown or hidden by it. Each use links to the person or event.
  - Give any flag a short note to remember what it's for. Notes are only for you; the game never reads them.
  - "+ New flag" notes down a flag for your events. Flag fields in the event editor show the flag's note and
    link to it.
- **Entity properties in fixed cards:** Looks, Movement, What it does, When it's there, Advanced. Changing a role
  only changes what's inside "What it does"; nothing jumps around any more. What a person or sign says is now part
  of its role, and the raw fields are folded away under Advanced.
- **When a person is there:**
  - "Starts hidden".
  - Every place where the game shows or hides that person.
  - A rule of your own: shown only while a flag is (or isn't) set.
- **Trainer lines of sight** are drawn on the map for every trainer (faint orange squares), in every direction it
  can face. The Sight field is now a number (0-15) instead of a short drop-down.
- **Hidden events the game runs as code** (binoculars, posters, switches, the Cinnabar quiz …) show a cog marker
  on the map and a read-only row with their texts.
- **New event commands:**
  - Show Pokédex entry;
  - Show a Pokémon's picture;
  - Open a screen;
  - Fade to a song, Stop the music, Back to the map's music.
- **Gift Pokémon:** nickname, original trainer name and trainer ID.
- **Tilesets:**
  - "+ Tiles from another tileset…".
  - Any unused added block can be deleted (later blocks are renumbered), not only the last one.
- **Texts:** "Use an existing text…" for people and signs (search the game's and your mod's texts by their words).
- **Events:**
  - Event texts no longer need a typed `{DONE}` at the end; it's added for you.
  - The Role box shows an event's commands, read-only.
- **Custom move effects:** the effect list says what each effect does.
- **Map view:**
  - The globe button (and Shift+0) jumps from an interior to the town or route outside.
  - Double-clicking a "back where you came from" (LAST_MAP) warp opens the map outside.
- **Pokémon header:** back sprite on the left, front on the right, each at its battle size, no longer dimmed.
- **Town Map editor:** a cleaner layout (mode picker, ring markers).

### Fixed
- A patch whose keys happened to be 1, 2, 3 … could replace the whole table in the game. It now changes only what
  you changed.
- The Events workspace no longer keeps showing an event that was removed elsewhere ("This event no longer exists").
- The flag of a new "shown only while a flag is set" rule appears right away. Its default name is now specific:
  `<MOD>_<MAP>_NPC_<number>`.
- Dragging a person, sign or warp is faster and stays on its map.
- Save keeps what you were typing in the field you were still in.
- Validate and Pack say so when modkit couldn't start at all, instead of showing an empty result.
