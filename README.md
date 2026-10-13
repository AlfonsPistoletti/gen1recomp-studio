# Gen1Recomp Studio

A visual editor for making mods for [gen1recomp](https://github.com/bryanthaboi/gen1recomp), the
Pokémon Red, Blue and Yellow recompilation. Paint maps, place people and signs, change Pokémon,
moves, items and trainers, write dialogue and small cutscenes, and replace graphics and music,
all without writing code. What you make is saved as a normal gen1recomp mod.

## Download

Get the installer from the **[latest release](https://github.com/AlfonsPistoletti/gen1recomp-studio/releases/latest)**
(Windows: the `-setup.exe` or the `.msi`).

The installer isn't signed yet, so Windows may show a blue "Windows protected your PC" box on the
first start. Click **More info**, then **Run anyway**.

## Before you start

- **gen1recomp:** the normal download (a release) works, and so does a developer copy of its
  source code.
- **Your game imported once:** start gen1recomp, pick Red, Blue or Yellow and give it your ROM.
  gen1recomp reads the data it needs out of your own ROM; the studio works from that.

  Every version you imported shows up in the studio's game picker. Gold, Silver and Crystal are
  **view only** for now: their maps can be looked at, but not changed or saved yet.

Some features need the developer copy of gen1recomp, because the tools for them only come with it:
- **Validate** and **Pack**, the tools that check a mod and package it for sharing;
- the **RED++** (Game Boy Color) colors;
- showing the game's own events in the Events workspace.

With a normal gen1recomp download, those parts are greyed out.

## First start

1. **Folder:** the studio asks for your gen1recomp folder (the one with `gen1recomp.exe`, or the
   source code folder). It remembers it; to switch later, open the gear menu next to the mod picker.
2. **Game:** pick the game at the top left (for example "Red · Gen 1").
3. **Mod:** pick a mod in the mod picker, or **+ New mod…** to start one.

   Without a mod you can look around, but you can't save.
4. **Edit:** edit anything, then **Save** (the disk icon, or Ctrl+S). Your changes go into the mod;
   the game's own files are never touched.

The tabs along the top are the workspaces (keys 1 to 9). One **Undo** and one **Save** cover all
of them. The page icon next to **Play** shows how many things your mod changes; click it for a list
you can jump into.

## What you can edit

### Maps
- **Painting:** paint maps with blocks from the panel on the right. Right-click a block on the map
  to pick it up; right-drag to copy a whole area as a stamp.
- **Tile brush** (T): paints single 8×8 tiles. Pick a tile in the panel's **Tiles** view (drag for
  several), or right-click one on the map. The studio makes the blocks this needs (or reuses ones the tileset
  already has).
  - A map can use at most 256 different blocks per tileset; the panel shows how many there are.
  - Where the player can walk depends on tiles, so painting one can change that spot.
- **Neighbours:** the neighbouring maps are drawn around the open one, so towns and routes read as
  one world. Double-click a neighbour to open it.
- **Items on the map:** the **+ Item ball** button puts a Poké Ball down; pick its item in the panel
  (Role: Item ball). Any sprite works, a fossil for example. The game picks it up once and says
  "<player> found <item>!", so it needs no text.
- **Doors:** select a warp, then **Connect to a door…**: pick the other map and click the spot. Both
  sides are set at once (a warp is made there if needed), and a two-cell mat or double door follows
  along. One connect per door or staircase, also for buildings with many floors.
- **Warps, people and signs:** add them with the **+** buttons in the toolbar, or drag them around.
  Select one to edit it on the right, including what a person or sign says.
- **New text:** **Create text** gives a person new lines. **New text for this one** gives them
  their own copy of a game line to change; the game's line stays as it is.
- **Roles:** a person can be a **shop clerk** (with what the shop sells), a **nurse**, a **PC**, a
  **Game Corner prize counter**, a **trainer** (class, team, how far they see, what they say), or
  run an **event**.
- **Map properties:** music, color palette, the RED++ roof color, and **Rules**:
  - dark until Flash;
  - bike allowed;
  - a badge check that turns the player back;
  - whether the map counts as outdoors.
- **Hidden things:** PCs, people drawn into the tiles (like the man on the Pokémon Center bench),
  hidden items and coins, and gym statues.
- **Landing spot:** for towns, where Teleport, Dig and blacking out bring the player back.
- **Wild Pokémon:** the **Encounters** tab at the bottom of the right panel edits grass, water and
  Super Rod Pokémon. The swords button in the toolbar shows which cells can start a wild battle.
- **New maps:** **+ New** in the map list starts an empty map, or a copy of another one (handy
  for a new Pokémon Center or shop). For a copy, "Its door is on" picks the town: click the door
  there and both sides are connected.

### Pokémon
- Stats, types, catch rate, growth, evolutions, moves, TMs/HMs and the Pokédex entry.
- **Art:** import front and back pictures and a menu icon, or borrow another Pokémon's.
  - Pictures are turned into the 4 Game Boy shades unless you tick **Full color**.
  - **Battle palette** sets the colors the game paints them in.
- **Cry:** import a sound file (WAV, OGG, MP3, FLAC) or borrow another Pokémon's cry.
- **+ New** adds a Pokémon as a copy of an existing one.

### Moves and items
- Moves: power, accuracy, PP, type, priority and their effect. Items: price, what they do, and which
  shops sell them.
- **New TMs and HMs:** **+ TM/HM** in the item list makes one that teaches any move. Its page lists
  who can learn it: tick Pokémon, or use All / None / "Same as" another TM. Then sell it in a shop
  or give it out with an event.
- **Effects from blocks:** effects can be built from blocks instead of code:
  - for a move: lower a stat, poison, heal, hit 2–5 times, …;
  - for an item: heal, cure, revive, raise a stat, act as a Poké Ball, …

  Start from the game's own effect with **Customize this effect**.
- Each move and item lists who uses it.

### Trainers
- **Teams:** each trainer's teams (Pokémon, levels, order) and the maps where they are fought.
- **Moves:** each team member shows the moves the game gives it; **Custom moves** sets your own.
- **AI:** how clever their move choices are, and when they use items or switch.
- **Portrait:** import a portrait or borrow another trainer's, and pick its palette.

### Text
Every line of dialogue in the game, with a preview of the text box and a list of who says it.
Buttons insert things like the player's name (`{PLAYER}`) or a page break.

### Events
Small cutscenes, built from a list of commands instead of code: say something, ask yes/no, give
items or Pokémon, start a battle, walk people around, warp, play music, and so on.
- **When it runs:** when the player talks to someone, steps on a cell, or enters a map.
- **Choices:** **If** and **Choice** blocks let the event react to flags, items or answers.
- **▶ Preview** plays a sketch of the event on its map. It isn't the real game; use
  **Play from here** for that.

### Graphics
- **Tilesets:** the tiles and blocks maps are built from.
  - Add your own tiles and blocks after the game's, and set which tiles you can walk on, surf on or
    cut.
  - **+ Blocks from another tileset…** copies blocks of another game tileset into this one (cave
    blocks on an outdoor map, for example). The game takes their tiles from the player's own files,
    so your mod contains no game art.
  - Make animated tiles.
  - Start a whole new tileset from a picture.
- **Sprites:** the people and objects walking around the overworld.
  - Replace their art, add new ones, and choose which sprites the player uses on foot, on the bike,
    surfing and flying.
  - In RED++ mode, pick their colors.
- **Images:** any other picture: title screen, battle screen, Town Map, fonts, and so on. Replace
  one with your own picture of the same size.
- **Palettes:** the 4-color Game Boy palettes. Recolor one, or add one a map can use.
- **Town Map:** the map you open from the START menu.
  - Paint it with the game's tiles or your own (**+ Import tiles** cuts a picture into tiles).
  - Pick a map on the left to place it on the Town Map, rename its place, give a building its
    town's spot ("Same spot as…"), or choose where the cursor stops at it.
  - The top row stays as it is: the game writes the place name on it.
  - New towns can be shown on the Town Map, but not flown to (see below).

The color menu at the top of these views (and of Pokémon and Trainers) only changes how things are
shown in the studio, so you can preview any palette or the RED++ colors.

### Global
Game-wide settings:
- **Wild encounters:** how likely each wild slot is, and the Old and Good Rod.
- **Type chart:** type matchups, plus your own new types.
- **Limits:** level cap and bag size.
- **Status conditions:** the catch bonus of each status.
- **Overworld:** walking and bike speed, poison steps.
- **Field moves:** which badge each HM needs.
- **Badges:** the badges in order, as the trainer card shows them. A badge is an item whose id contains
  BADGE (it never shows in the bag); make one in Items and give it out with an event. Only the first
  eight have a picture on the trainer card.
- **Starter Pokémon** (Red and Blue): which Pokémon each of the three balls in Oak's Lab holds, at
  which level, and Oak's question about it. The rival takes the matching ball in the cutscene, but
  his teams don't change by themselves: edit them in Trainers (each rival team says which ball
  the player took for it).
- **Gift Pokémon:** the Pokémon people give the player (Eevee, Lapras, the Magikarp salesman, the
  Fighting Dojo, the fossils, and Yellow's extra gifts): which Pokémon and at which level, with
  buttons to the giver on the map and to their texts.
- **Oak's speech:** the intro before a new game, as a list of steps. Change what Oak says and shows
  (and the Pokémon he presents), move steps around, and add your own: lines, pictures, and
  questions. An answer can set a flag that your events check later.
- **Start values:**
  - where a new game starts;
  - the starting money;
  - where the player wakes up after blacking out before the first Pokémon Center;
  - the names Oak offers.
- **In-game trades.**
- **Music & sounds:** import your own songs and sound effects.
- **Slot machines** and **Game Corner prizes.**

Only settings the game really uses are offered here.

## Testing and sharing your mod

- **Test:** **Play** (▷ next to Save) starts the game right where you click on the map, with your
  mod, continuing your current save game. Unsaved changes are saved first.

  Saving inside the game is switched off during these test runs, so your real save is never
  touched.
- **Check:** **Validate** (gear menu, or Ctrl+V) checks the mod the same way gen1recomp's mod
  tools do.
- **Details:** **Mod details…** (gear menu) sets the mod's name, description, version and
  category.
- **Mod page:** **Mod page…** (gear menu) is where you write the page people see on your mod's
  GitHub repository (`README.md`). It starts from an outline: what the mod is, features, how to
  install it, credits. A preview next to it shows roughly how it will look.
- **Change list:** on every save the studio also writes `DIFFERENCES.md`, the list of everything
  your mod adds or changes compared with the original game (for example
  "BULBASAUR: base stats, learnset"). The mod page links to it.

### Sharing
Players install mods from a `.zip` file (in gen1recomp: **MODS > Import mod .zip**). There are two
ways to give them one.

**Export .zip…** (gear menu) saves that `.zip` on your computer. Send it to people directly, for
example on Discord.

**Publish on GitHub…** (gear menu) puts the mod online the way gen1recomp recommends. GitHub then
builds the `.zip` for you on every update, and gen1recomp's launcher can update the mod for
players.
1. **Account:** you need a free [GitHub](https://github.com) account and
   [Git for Windows](https://git-scm.com/download/win).
2. **Repository, the first time:** click **Create it on GitHub…** in the dialog and create an
   **empty** repository (don't add a README), named after your mod.
3. **Enter it:** type it as `your-name/repository`.
4. **Version:** raise the version when you want to release a new one (1.0.0 → 1.0.1).
5. **Publish:** click **Publish**. The first time, a GitHub sign-in window opens.
6. **Share:** after a minute or two the `.zip` appears under **Releases** on your repository's
   page. Share that page.

Next time, open the dialog again, write what changed and click **Publish**.

**Pack…** (gear menu, or Ctrl+P) makes a `.modpkg`, an older package format that is rarely used
now.

Your mod lives in gen1recomp's `mods` folder; **Open mod folder** (gear menu) shows it in Explorer. The studio writes its changes into a file called
`studio_content.lua`. Anything you write by hand in the mod's `main.lua` is left alone.

## Good to know

- **Game art:** a mod may not contain the game's own pictures. When you reuse game art (for example a
  new Pokémon that looks like an old one), the studio sets things up so the game copies the art
  from the player's own ROM when it loads the mod.
- **Renaming:** the game's own Pokémon, moves, items and trainers keep their names inside the
  game data (their "id"). Your own new ones can be renamed, as long as nobody plays with the mod
  yet.
- **Story scenes:** the game's story scenes are programmed inside gen1recomp. The studio can change
  what people say in them, but not what happens.
- **Not possible yet:**
  - flying to new towns;
  - a different chance per wild slot on each map;
  - individual stats for trainer Pokémon.

  gen1recomp itself doesn't offer these to mods yet.
- **Sprites known issue:** gen1recomp's mod check sometimes mistakes a new person sprite for a
  copy of a game sprite, so Validate can fail for mods with new sprites. This has been reported
  to gen1recomp.

## Keyboard shortcuts

| Key | What it does |
|---|---|
| Ctrl+S | Save |
| Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) | Undo / redo |
| Ctrl+F | Jump to the search box |
| Ctrl+V / Ctrl+P | Validate / Pack the mod (Ctrl+V still pastes inside text fields) |
| 1 … 9 | Maps, Pokémon, Moves, Items, Trainers, Text, Events, Graphics, Global |
| S / B / R / F / T | Map tools: select, block brush, rectangle, fill, tile brush |
| Right-click, right-drag (or Alt+click) | Pick up a block, or copy an area |
| G / C / E / N / W / A | Show or hide: grid, walkable cells, warps & people, neighbouring maps, wild cells, animation |
| Middle-drag or Space+drag | Move the map |
| Mouse wheel, + / − | Zoom |
| 0 / Shift+0 | Fit the map / fit the whole connected world |
| Arrows, Delete, Esc | Move, delete or deselect the selected warp, person or sign |

## For developers

Building from source, how the studio works inside, and how releases are made:
see [TECHNICAL.md](TECHNICAL.md).
