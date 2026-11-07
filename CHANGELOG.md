# Changelog

What changed in each release of G1R Studio. Releases before 0.3.5 are described on the
[GitHub releases page](https://github.com/AlfonsPistoletti/gen1recomp-studio/releases).

## 0.4.0

### Gold, Silver and Crystal
The studio now makes mods for the second generation. Import your Gold, Silver or Crystal ROM in gen1recomp, pick
the game in the top bar and start a mod as usual. One Gen 2 mod works in Gold, Silver and Crystal.

**Requires gen1recomp 0.3.96 or later.** On an older gen1recomp, Gen 2 mods don't load. Red/Blue/Yellow mods work
as before.

- **Maps:**
  - Edit blocks, warps, connections, people, signs and step triggers.
  - Time of day (morning, day, night) and the town roofs in the map view; tiles animate.
  - **Scenes:** a map's story stages. Step triggers and the "on entering" event belong to a scene, and a scene
    can change blocks.
  - **When a person is there:** event flags, the days of the week, and what on the map shows or hides them.
- **Roles for people and signs:** Normal text, Event, Trainer, Item ball, Hidden item, Shop clerk, Nurse, Fruit
  tree, Prize counter, Coin seller, Cutscene person and Standard object. A game person keeps the game's own script
  until you change it.
- **Events:** the game's scripts read as blocks and run as the game runs them.
  - "Edit a copy" makes a game event your own.
  - Conditions: flags, items, money, coins, time of day, today is (weekday), has badges, engine flags (badges,
    Pokégear cards, fly points).
  - Choice menus, battles, walking paths, Pokémon pictures, name slots ({STRBUF}), phone numbers, and the screens
    the game opens.
- **Encounters:**
  - Grass for morning, day and night; water and fishing.
  - Headbutt trees and Rock Smash.
  - Swarms, where the game has them.
- **Pokémon:**
  - Stats, types, learnsets, TMs/HMs, evolutions and breeding.
  - Held items, menu icons and cries.
  - Pokédex entries, and **footprints** you can draw or import.
  - **New species** get their own number, so starters, gifts and events can give them.
  - Happiness evolutions can need any amount of happiness.
- **Moves and items:**
  - Edit the game's moves and items, and make new ones.
  - Custom move effects.
  - Item effects (what using an item does) and **held effects of your own** (heal, boost, cure, raise a stat …),
    optionally used up after one use.
- **Trainers:**
  - Teams with items and moves, and the AI.
  - New trainers and trainer classes.
  - People on the map as trainers.
- **Global:**
  - Start values and the player's names.
  - Oak's speech, starters, gift Pokémon, in-game trades.
  - Status conditions, HM badges, slot machines, fruit trees and Kurt's balls.
  - Shops and the bargain shop.
  - **Game Corner prizes and coin sellers** (up to four prizes or packs).
  - **Phone contacts:**
    - Where they stand and when they call.
    - What they say, with each line in the shared talk or the contact's own.
    - Gifts by phone.
    - New contacts.
- **Graphics:**
  - Tilesets (your own, or new blocks on the game's) with collision, palette slots and animated tiles.
  - Sprites.
  - Replacing the game's images, including the town roofs.
  - Palettes for every place and time of day.
  - The Pokégear Town Map.
- **Text:** the game's script texts and its other texts, with where each one is used.
- **Play from here** starts the game on the map you're looking at.

### New for every game
- **"Today is" and "Has badges"** conditions in events (Red/Blue/Yellow get "Has badges").
- **Prize counters:** the shared prize editor; Gold adds or removes prizes.
- Map markers (warps, signs, step triggers, sight squares) have rounded corners, so they stand apart from the
  tiles; the map sits on a faint dotted background.
- All "Back to the game's …" and "Revert" buttons look the same (red outline).

### Faster
- Typing in an event or a text no longer re-renders the pages you can't see: about 15× faster per key. Pages catch
  up when you open them.
- Global > Phone contacts: the map box searches instead of listing every map, and line folds are built when you
  open them.

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
