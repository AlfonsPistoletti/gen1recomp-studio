// The commands the Events workspace offers for Gen 1: a friendly face for
// gen1recomp's script verbs (src/script/Commands.lua). Each one writes a row
// { verb, ...fixed, ...params } the engine's ScriptRunner runs as is. Checks
// (check_flag, ask, ...) are used as If conditions: they set the "last
// result" a jump_if_true/false reads.

import type { EventCommand, EventSpec } from "../types.ts";

const s = (v: unknown, fallback = "?") => (v === undefined || v === null || v === "" ? fallback : String(v));
const short = (v: unknown, n = 40) => {
  const t = s(v, "…").replace(/\n|\f|\v/g, " ");
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const nice = (v: unknown) => s(v).replace(/_/g, " ").toLowerCase().replace(/(^| )\w/g, (c) => c.toUpperCase());

const commands: EventCommand[] = [
  // ---- Message
  { id: "show_text", verb: "show_text", label: "Show text", category: "Message", help: "Shows a text box. Type the line, or use a text key (_SomeText) from the Text workspace.", params: [{ key: "text", label: "Text", type: "text", default: "Hello!" }], describe: (a) => `Text: "${short(a.text)}"` },
  { id: "emote", verb: "emote", label: "Emotion bubble", category: "Message", help: "Pops a bubble over the player or an NPC (! ? or happy).", params: [{ key: "who", label: "Over", type: "npcIndex", default: "player" }, { key: "bubble", label: "Bubble", type: "bubble", default: "shock" }], describe: (a) => `Bubble ${s(a.bubble)} over ${a.who === "player" ? "the player" : `NPC ${s(a.who)}`}` },

  // ---- Flags
  { id: "set_flag", verb: "set_flag", label: "Set flag", category: "Flags", help: "Turns a flag on. Flags remember that something happened (saved with the game).", params: [{ key: "flag", label: "Flag", type: "flag" }], describe: (a) => `Set flag ${s(a.flag)}` },
  { id: "clear_flag", verb: "clear_flag", label: "Clear flag", category: "Flags", help: "Turns a flag off.", params: [{ key: "flag", label: "Flag", type: "flag" }], describe: (a) => `Clear flag ${s(a.flag)}` },

  // ---- Conditions (used by If)
  { id: "check_flag", verb: "check_flag", label: "Flag is set", category: "Conditions", help: "True when the flag is on.", params: [{ key: "flag", label: "Flag", type: "flag" }], condition: "flag {flag} is set", describe: (a) => `flag ${s(a.flag)} is set` },
  { id: "check_item", verb: "check_item", label: "Has item", category: "Conditions", help: "True when the bag holds at least one.", params: [{ key: "item", label: "Item", type: "item", default: "POTION" }], condition: "the player has {item}", describe: (a) => `the player has ${nice(a.item)}` },
  { id: "check_money", verb: "check_money", label: "Has money", category: "Conditions", help: "True when the player has at least this much money.", params: [{ key: "amount", label: "Money", type: "number", default: 500, min: 0, max: 999999 }], condition: "the player has ¥{amount}", describe: (a) => `the player has ¥${s(a.amount)}` },
  { id: "check_dex_owned", verb: "check_dex_owned", label: "Caught Pokémon", category: "Conditions", help: "True when the player owns at least this many species.", params: [{ key: "count", label: "Species", type: "number", default: 10, min: 1, max: 251 }], condition: "the player owns {count} species", describe: (a) => `the player owns ${s(a.count)} species` },
  { id: "ask", verb: "ask", label: "Ask yes/no", category: "Conditions", help: "Shows a question with YES/NO; true when the player picks YES.", params: [{ key: "text", label: "Question", type: "text", default: "Do you want it?" }], condition: "the player answers YES to \"{text}\"", describe: (a) => `the player answers YES to "${short(a.text, 30)}"` },
  { id: "check_battle_result", verb: "check_battle_result", label: "Won the battle", category: "Conditions", help: "True when the last battle of this event was won.", params: [], fixed: ["win"], condition: "the last battle was won", describe: () => "the last battle was won" },

  // ---- Items & money
  { id: "give_item", verb: "give_item", label: "Give item", category: "Items & money", help: "Puts an item in the bag with the 'got' jingle (stops the event if the bag is full).", params: [{ key: "item", label: "Item", type: "item", default: "POTION" }, { key: "count", label: "Count", type: "number", default: 1, min: 1, max: 99 }], describe: (a) => `Give ${s(a.count, "1")}× ${nice(a.item)}` },
  { id: "take_item", verb: "take_item", label: "Take item", category: "Items & money", help: "Removes items from the bag.", params: [{ key: "item", label: "Item", type: "item", default: "POTION" }, { key: "count", label: "Count", type: "number", default: 1, min: 1, max: 99 }], describe: (a) => `Take ${s(a.count, "1")}× ${nice(a.item)}` },
  { id: "give_money", verb: "give_money", label: "Give money", category: "Items & money", help: "Adds money.", params: [{ key: "amount", label: "Money", type: "number", default: 100, min: 0, max: 999999 }], describe: (a) => `Give ¥${s(a.amount)}` },
  { id: "take_money", verb: "take_money", label: "Take money", category: "Items & money", help: "Removes money (never below 0).", params: [{ key: "amount", label: "Money", type: "number", default: 100, min: 0, max: 999999 }], describe: (a) => `Take ¥${s(a.amount)}` },
  { id: "take_coins", verb: "take_coins", label: "Take coins", category: "Items & money", help: "Removes Game Corner coins.", params: [{ key: "amount", label: "Coins", type: "number", default: 10, min: 0, max: 9999 }], describe: (a) => `Take ${s(a.amount)} coins` },

  // ---- Pokémon
  { id: "give_pokemon", verb: "give_pokemon", label: "Give Pokémon", category: "Pokémon", help: "Adds a Pokémon to the party (or the PC box), asking for a nickname.", params: [{ key: "species", label: "Pokémon", type: "species", default: "PIKACHU" }, { key: "level", label: "Level", type: "number", default: 5, min: 1, max: 100 }], describe: (a) => `Give ${nice(a.species)} Lv ${s(a.level)}` },
  { id: "heal_party", verb: "heal_party", label: "Heal party", category: "Pokémon", help: "Fully heals the player's Pokémon.", params: [], describe: () => "Heal the party" },
  { id: "play_cry", verb: "play_cry", label: "Play cry", category: "Pokémon", help: "Plays a Pokémon's cry.", params: [{ key: "species", label: "Pokémon", type: "species", default: "PIKACHU" }], describe: (a) => `Cry of ${nice(a.species)}` },

  // ---- Battle
  { id: "battle_trainer", verb: "start_battle", fixed: ["trainer"], label: "Trainer battle", category: "Battle", help: "Fights a trainer class with one of its teams. Use 'Won the battle' in an If right after.", params: [{ key: "trainer", label: "Trainer", type: "trainer", default: "OPP_YOUNGSTER" }, { key: "team", label: "Team", type: "number", default: 1, min: 1, max: 99 }], describe: (a) => `Battle ${nice(String(a.trainer ?? "").replace(/^OPP_/, ""))} (team ${s(a.team)})` },
  { id: "save_end_battle_text", verb: "save_end_battle_text", label: "Trainer's lost line", category: "Battle", help: "The line the next trainer battle's opponent says inside the battle when it loses; put it right before the battle. Use a text key (_SomeText) from the Text workspace.", params: [{ key: "text", label: "Text key", type: "text", default: "_" }], describe: (a) => `Lost line: "${short(a.text, 30)}"` },
  { id: "battle_wild", verb: "start_battle", fixed: ["wild"], label: "Wild battle", category: "Battle", help: "Starts a wild battle.", params: [{ key: "species", label: "Pokémon", type: "species", default: "PIKACHU" }, { key: "level", label: "Level", type: "number", default: 10, min: 1, max: 100 }], describe: (a) => `Wild ${nice(a.species)} Lv ${s(a.level)}` },

  // ---- Movement
  { id: "face_player", verb: "face_player", label: "NPC faces the player", category: "Movement", help: "The NPC who was talked to turns to the player.", params: [], describe: () => "NPC faces the player" },
  { id: "face", verb: "face", label: "NPC turns", category: "Movement", help: "The NPC who was talked to turns.", params: [{ key: "dir", label: "Direction", type: "dir", default: "down" }], describe: (a) => `NPC turns ${s(a.dir)}` },
  { id: "move_player", verb: "move_player", label: "Move player", category: "Movement", help: "Walks the player.", params: [{ key: "dir", label: "Direction", type: "dir", default: "down" }, { key: "tiles", label: "Steps", type: "number", default: 1, min: 1, max: 20 }], describe: (a) => `Player walks ${s(a.dir)} ${s(a.tiles, "1")}` },
  { id: "move_npc", verb: "move_npc", label: "Move NPC", category: "Movement", help: "Walks an NPC of this map.", params: [{ key: "npc", label: "NPC", type: "npcIndex", default: 1 }, { key: "dir", label: "Direction", type: "dir", default: "down" }, { key: "tiles", label: "Steps", type: "number", default: 1, min: 1, max: 20 }], describe: (a) => `NPC ${s(a.npc)} walks ${s(a.dir)} ${s(a.tiles, "1")}` },
  { id: "show_object", verb: "show_object", label: "Show NPC", category: "Movement", help: "Makes a hidden NPC appear (remembered in the save).", params: [{ key: "map", label: "Map", type: "map" }, { key: "name", label: "NPC", type: "npcName" }], describe: (a) => `Show ${s(a.name)}` },
  { id: "hide_object", verb: "hide_object", label: "Hide NPC", category: "Movement", help: "Makes an NPC disappear (remembered in the save).", params: [{ key: "map", label: "Map", type: "map" }, { key: "name", label: "NPC", type: "npcName" }], describe: (a) => `Hide ${s(a.name)}` },
  { id: "warp", verb: "warp", label: "Warp", category: "Movement", help: "Moves the player to a cell of a map.", params: [{ key: "map", label: "Map", type: "map" }, { key: "x", label: "X", type: "number", default: 0, min: 0, max: 255 }, { key: "y", label: "Y", type: "number", default: 0, min: 0, max: 255 }, { key: "facing", label: "Facing", type: "dir", default: "down" }], describe: (a) => `Warp to ${s(a.map)} (${s(a.x)}, ${s(a.y)})` },

  // ---- Screen & sound
  { id: "wait", verb: "wait", label: "Wait", category: "Screen & sound", help: "Pauses (60 frames = 1 second).", params: [{ key: "frames", label: "Frames", type: "number", default: 30, min: 1, max: 600 }], describe: (a) => `Wait ${s(a.frames)} frames` },
  { id: "fade", verb: "fade", label: "Fade", category: "Screen & sound", help: "Fades the screen out (to black) or back in.", params: [{ key: "dir", label: "Fade", type: "fade", default: "out" }], describe: (a) => `Fade ${s(a.dir)}` },
  { id: "play_music", verb: "play_music", label: "Play music", category: "Screen & sound", help: "Switches the music.", params: [{ key: "song", label: "Song", type: "song" }], describe: (a) => `Music: ${s(a.song).replace(/^Music_/, "")}` },
  { id: "play_sound", verb: "play_sound", label: "Play sound", category: "Screen & sound", help: "Plays a sound effect.", params: [{ key: "sound", label: "Sound", type: "sound" }], describe: (a) => `Sound: ${s(a.sound)}` },
];

export const GEN1_EVENTS: EventSpec = {
  registry: "studio_events",
  categories: ["Message", "Flags", "Conditions", "Items & money", "Pokémon", "Battle", "Movement", "Screen & sound"],
  commands,
  choiceVerb: "studio:check_choice",
  stopVerb: "jump",
};
