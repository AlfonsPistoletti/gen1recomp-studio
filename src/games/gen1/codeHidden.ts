// Hidden events the engine runs as code (gen1recomp data/scripts: a map's
// `onInteract`), restated because release builds can't read those scripts.
// Cells, facing and texts follow the handlers; they can't move, only their
// texts can be reworded. pokered data/events/hidden_events.asm has the rest
// as data (field.hiddenExtras / hiddenItems / hiddenCoins).
import type { CodeHidden } from "../types.ts";

const MANSION_2F = ["_PokemonMansion2FSwitchText", "_PokemonMansion2FSwitchPressedText", "_PokemonMansion2FSwitchNotPressedText"];
const MANSION = "A secret switch: asks, then opens or closes the mansion's gates.";

// texts only some versions have (a row shows the ones the open version has)
export const CODE_HIDDEN_OPTIONAL = ["_CinnabarGymQuizShortIntroText"];

export const CODE_HIDDEN: CodeHidden[] = [
  // data/scripts/flavor/route_15_gate_2f.lua
  { map: "ROUTE_15_GATE_2F", cells: [[1, 2]], facing: "up", what: "Binoculars: a text, then ARTICUNO's picture with its cry.", texts: ["_Route15UpstairsBinocularsText"] },
  // data/scripts/flavor/reds_house_2f.lua
  { map: "REDS_HOUSE_2F", cells: [[3, 5]], what: "The SNES: a text.", texts: ["_RedBedroomSNESText"] },
  // data/scripts/flavor/oaks_lab.lua
  { map: "OAKS_LAB", cells: [[4, 0]], what: "Poster: a text.", texts: ["_PushStartText"] },
  { map: "OAKS_LAB", cells: [[5, 0]], what: "Poster: one text, another once the player owns 2 Pokémon.", texts: ["_SaveOptionText", "_StrengthsAndWeaknessesText"] },
  { map: "OAKS_LAB", cells: [[0, 1], [1, 1]], facing: "up", what: "Computer: a text.", texts: ["_OakLabEmailText"] },
  // data/scripts/flavor/bike_shop.lua
  { map: "BIKE_SHOP", cells: [[1, 0], [2, 1], [1, 2], [3, 2], [0, 4], [1, 5]], what: "Bicycles on display: a text.", texts: ["_NewBicycleText"] },
  // data/scripts/flavor/mr_fujis_house.lua
  { map: "MR_FUJIS_HOUSE", cells: [[0, 1], [1, 1], [7, 1]], what: "Magazines: a text.", texts: ["_MagazinesText"] },
  // data/scripts/celadon_eevee.lua
  { map: "CELADON_MANSION_ROOF_HOUSE", cells: [[3, 0], [4, 0]], what: "Link Cable tips: texts, then a menu of headings.", texts: ["_LinkCableHelpText1", "_LinkCableHelpText2"] },
  { map: "CELADON_MANSION_ROOF_HOUSE", cells: [[3, 4]], what: "Notebook: a text.", texts: ["TMNotebookText"] },
  // data/scripts/flavor/viridian_school_house.lua
  { map: "VIRIDIAN_SCHOOL_HOUSE", cells: [[3, 0]], what: "Blackboard: texts, then a menu of status conditions.", texts: ["_ViridianSchoolBlackboardText1", "_ViridianSchoolBlackboardText2"] },
  { map: "VIRIDIAN_SCHOOL_HOUSE", cells: [[3, 4]], what: "Notebook: pages, asking before each next one.", texts: ["_ViridianSchoolNotebookText1", "_ViridianSchoolNotebookText2", "_ViridianSchoolNotebookText3", "_ViridianSchoolNotebookText4", "_ViridianSchoolNotebookText5", "_TurnPageText"] },
  // data/scripts/story4.lua M.FIGHTING_DOJO
  { map: "FIGHTING_DOJO", cells: [[3, 9], [6, 9]], facing: "up", what: "Sign: a text.", texts: ["_FightingDojoText"] },
  { map: "FIGHTING_DOJO", cells: [[4, 0]], facing: "up", what: "Scroll: a text.", texts: ["_EnemiesOnEverySideText"] },
  { map: "FIGHTING_DOJO", cells: [[5, 0]], facing: "up", what: "Scroll: a text.", texts: ["_WhatGoesAroundComesAroundText"] },
  // data/scripts/story5.lua M.MUSEUM_1F
  { map: "MUSEUM_1F", cells: [[2, 3]], facing: "up", what: "Fossil: the AERODACTYL fossil picture with a text.", texts: ["_AerodactylFossilText"] },
  { map: "MUSEUM_1F", cells: [[2, 6]], facing: "up", what: "Fossil: the KABUTOPS fossil picture with a text.", texts: ["_KabutopsFossilText"] },
  // data/scripts/story6.lua mansionFloor (3F and B1F reuse the 2F texts)
  { map: "POKEMON_MANSION_1F", cells: [[2, 5]], facing: "up", what: MANSION, texts: ["_PokemonMansion1FSwitchText", "_PokemonMansion1FSwitchPressedText", "_PokemonMansion1FSwitchNotPressedText"] },
  { map: "POKEMON_MANSION_2F", cells: [[2, 11]], facing: "up", what: MANSION, texts: MANSION_2F },
  { map: "POKEMON_MANSION_3F", cells: [[10, 5]], facing: "up", what: MANSION, texts: MANSION_2F },
  { map: "POKEMON_MANSION_B1F", cells: [[20, 3], [18, 25]], facing: "up", what: MANSION, texts: MANSION_2F },
  // data/scripts/story6.lua M.CINNABAR_GYM (GYM_MACHINES, in order)
  ...[[15, 7], [10, 1], [9, 7], [9, 13], [1, 13], [1, 7]].map(([x, y], i): CodeHidden => ({
    map: "CINNABAR_GYM", cells: [[x, y]], facing: "up",
    what: `Quiz machine ${i + 1}: a yes/no question; the right answer opens its gate, a wrong one starts a battle.`,
    // machines 2-6 open with the short intro (Yellow only; Red/Blue repeat the long one)
    texts: [...(i === 0 ? [] : ["_CinnabarGymQuizShortIntroText"]), "_CinnabarGymQuizIntroText", `_CinnabarQuizQuestionsText${i + 1}`, "_CinnabarGymQuizCorrectText", "_CinnabarGymQuizIncorrectText"],
  })),
  // data/scripts/yellow_npcs.lua M.POKEMON_FAN_CLUB (Yellow only)
  { map: "POKEMON_FAN_CLUB", cells: [[1, 0]], what: "Picture: RAPIDASH's picture with a text.", texts: ["_FanClubPicture1Text"], versions: ["yellow"] },
  { map: "POKEMON_FAN_CLUB", cells: [[6, 0]], what: "Picture: FEAROW's picture with a text.", texts: ["_FanClubPicture2Text"], versions: ["yellow"] },
];
