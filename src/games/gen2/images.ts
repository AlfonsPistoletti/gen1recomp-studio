// Gold's images a mod may replace (Graphics > Images): gen1recomp Assets.resolve
// loads mods/<id>/overrides/<rel> before assets/generated/<rel>, in both games.
// Sprites, tilesets and Pokémon / trainer pics have their own editors.

import type { ImageSpec } from "../types.ts";

export const GEN2_IMAGES: ImageSpec = {
  skip: ["sprites/", "tilesets/", "battle/front/", "battle/back/", "battle/trainers/", "audio/"],
  groups: [
    ["battle/player_back.png", "The player"],
    ["battle/dude_back.png", "The player"],
    ["intro/cal.png", "The player"],
    ["title/", "Title screen"],
    ["splash/", "Title screen"],
    ["intro/", "Intro"],
    ["battle_anims/", "Move animations"],
    ["battle/", "Battle screen"],
    ["trainer_card/", "Trainer card"],
    ["pokegear/", "Pokégear"],
    ["pokedex/", "Pokédex"],
    ["pack/", "Bag"],
    ["pc/", "PC"],
    ["menu/", "Menus"],
    ["naming/", "Naming screen"],
    ["slots/", "Slot machine"],
    ["card_flip/", "Card flip game"],
    ["trade/", "Trade"],
    ["diploma/", "Diploma"],
    ["emotes/", "Emotion bubbles"],
    ["fonts/", "Fonts"],
    ["credits/", "Credits"],
    ["icons/", "Party icons"],
  ],
  hints: {
    "battle/player_back.png": "The player's back in battle.",
    "battle/dude_back.png": "The Dude's back in the catching tutorial.",
    "intro/cal.png": "The player in Oak's speech.",
    "intro/oak.png": "Professor Oak in his speech.",
    "fonts/font.png": "The text font: keep every glyph in its cell, the game cuts the sheet into 8×8 letters.",
    "fonts/font_extra.png": "Extra glyphs of the font, cut into 8×8 cells.",
    "fonts/frames.png": "The text box frames (one per frame option).",
    "slots/gold_slots_2.png": "The slot reel symbols: six 16×16 symbols stacked.",
    "pokegear/gear.png": "The Pokégear's screens and the Town Map's tiles.",
    "pokedex/footprints.png": "The Pokédex footprints, one 16×16 per species in Pokédex order.",
    "trainer_card/badges.png": "The badges on the trainer card.",
  },
};
