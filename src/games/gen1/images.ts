// The game images Graphics > Images offers (everything below assets/generated
// a mod can replace through overrides/), grouped, with what each is for.
// Pokémon and trainer pictures, overworld sprites and tilesets have editors
// of their own, so their folders are left out.

import type { ImageSpec } from "../types.ts";

export const GEN1_IMAGES: ImageSpec = {
  skip: ["sprites/", "tilesets/", "battle/front/", "battle/back/", "battle/trainers/"],
  // first matching prefix wins; a file can also be named exactly
  groups: [
    ["title/player.png", "The player"],
    ["battle/redb.png", "The player"],
    ["battle/oldmanb.png", "The player"],
    ["trainer_card/red.png", "The player"],
    ["fx/red_fish_", "The player"],
    ["title/", "Title screen"],
    ["intro/", "Intro"],
    ["battle/anims/", "Move animations"],
    ["battle/", "Battle screen"],
    ["trainer_card/", "Trainer card"],
    ["townmap/", "Town Map"],
    ["slots/", "Slot machine"],
    ["fonts/", "Fonts"],
    ["fx/", "Effects"],
    ["credits/", "Credits"],
    ["icons/", "Party icons"],
  ],
  hints: {
    "title/player.png": "The player on the title screen (the front pic).",
    "battle/redb.png": "The player's back in battle, while throwing Poké Balls.",
    "battle/oldmanb.png": "The Old Man's back in the catching tutorial in Viridian City.",
    "trainer_card/red.png": "The player's picture on the trainer card.",
    "fx/red_fish_back.png": "The player fishing, facing up.",
    "fx/red_fish_front.png": "The player fishing, facing down.",
    "fx/red_fish_side.png": "The player fishing, facing sideways.",
    "title/pokemon_logo.png": "The POKéMON logo on the title screen.",
    "title/red_version.png": "The version name under the title logo.",
    "title/copyright.png": "The copyright line on the first screen.",
    "title/gamefreak_inc.png": "The GAME FREAK inc. line on the title screen.",
    "intro/gengar_1.png": "The Gengar of the intro fight (frame 1 of 3).",
    "intro/red_nidorino_1.png": "The Nidorino of the intro fight (frame 1 of 3).",
    "battle/balls.png": "The party Poké Ball row and the thrown ball.",
    "fonts/font.png": "The text font: keep every glyph in its cell, the game cuts the sheet into 8×8 letters.",
    "fonts/font_extra.png": "Extra glyphs of the font, cut into 8×8 cells.",
    "townmap/tiles.png": "The Town Map's tiles (the map is laid out from them).",
    "townmap/cursor.png": "The player marker on the Town Map.",
    "slots/symbols.png": "The slot machine reel symbols.",
    "fx/heal_machine.png": "The Poké Ball lights of the Pokémon Center's healing machine.",
    "credits/the_end.png": "THE END after the credits.",
  },
};
