// The commands the Events workspace offers for Gold/Silver/Crystal, and how
// its blocks become Gold script rows and back.
//
// A Gold event is a list of the decoded script rows data/generated/scripts.lua
// holds ({ op = "writetext", text = "..." }), stored inline as the map
// person's / sign's / step trigger's `scriptKey` (gen1recomp src/script/gen2
// Vm.lua: Vm:start and runList take "a scripts.lua key, or a command list
// itself"; mods can't add keys to data.gen2Scripts, ISSUES #4).
//
// compile() wraps the text box around the whole script (opentext after the
// leading faceplayer, closetext + end at every end) and puts a waitbutton after
// each text. An If is the cart's shape: the check, then `iftrue` with the
// then-branch as a nested list. A taken iftrue never comes back (it is a tail
// call), so what follows the If is copied onto the end of both branches;
// parse() takes that shared tail back off.
// shortcut: Ifs in a row copy the tail into every branch (2^n rows); fine for
// talk scripts, a scall-based layout would be needed for long ones.

import { studioMovementSteps } from "./scriptKeys.ts";
import type { Block } from "../../core/eventBlocks.ts";
import type { EventCommand, EventRow, EventSpec, GameContext } from "../types.ts";

type Row = Record<string, unknown> & { op: string };
type Args = Record<string, unknown>;

const recordsOf = (ctx: GameContext, registry: string) =>
  (ctx.records[registry] ?? ctx.data.content[registry] ?? {}) as Record<string, { index?: number; name?: string }>;
// items and species are numbers in Gold's rows (their records' `index`)
const numberOf = (ctx: GameContext, registry: string, id: unknown) => recordsOf(ctx, registry)[String(id)]?.index ?? 0;
const idOf = (ctx: GameContext, registry: string, n: unknown) =>
  Object.entries(recordsOf(ctx, registry)).find(([, r]) => r?.index === n)?.[0] ?? String(n);

// sounds, songs and specials are their place in the game's name lists
const orders = (ctx: GameContext) => ctx.data.extra as { sfxOrder?: string[]; musicOrder?: string[]; specialOrder?: string[] };
const placeIn = (list: string[] | undefined, name: unknown) => Math.max(0, (list ?? []).indexOf(String(name)));
// money operands: an account byte, then the amount in 3 bytes, big-endian
const moneyArgs = (n: unknown) => {
  const v = Math.max(0, Math.min(999999, Number(n) || 0));
  return [0, (v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const moneyOf = (args: unknown) => {
  const a = (args as number[] | undefined) ?? [];
  return (a[1] ?? 0) * 0x10000 + (a[2] ?? 0) * 0x100 + (a[3] ?? 0);
};
const DIRS = ["down", "up", "left", "right"]; // Movement.DIR
const ARROW: Record<string, string> = { up: "↑", down: "↓", left: "←", right: "→" };
const arrowsOf = (p: unknown) => (Array.isArray(p) && p.length ? p.map((d) => ARROW[String(d)] ?? "?").join("") : "(no steps)");
// checktime's mask (MORN 1, DAY 2, NITE 4)
const TIMES: Record<number, string> = { 1: "morning", 2: "day", 4: "night", 3: "morning or day", 6: "day or night", 7: "any time" };
// a little-endian word operand (coins)
const wordArgs = (n: unknown) => { const v = Math.max(0, Math.min(65535, Number(n) || 0)); return [v & 255, v >> 8]; };
const wordOf = (args: unknown) => { const a = (args as number[] | undefined) ?? []; return (a[0] ?? 0) + (a[1] ?? 0) * 256; };
const EMOTES = ["shock", "question", "happy"]; // EMOTE_SHOCK 0, QUESTION 1, HAPPY 2
const who = (v: unknown) => (Number(v) === 0 ? "the player" : `NPC ${Number(v) - 1}`);
const ops = (rows: Record<string, unknown>[], at: number, list: string[]) => list.every((op, k) => rows[at + k]?.op === op);

const s = (v: unknown, fallback = "?") => (v === undefined || v === null || v === "" ? fallback : String(v));
const short = (v: unknown, n = 40) => {
  const t = s(v, "…").replace(/\{(DONE|PROMPT)\}/g, "").replace(/\n|\f|\v/g, " ");
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const nice = (v: unknown) => s(v).replace(/_/g, " ").toLowerCase().replace(/(^| )\w/g, (c) => c.toUpperCase());

// the game's specials that open a screen and come back to the script
// (gen1recomp src/script/gen2/Specials.lua handlers), by name
const SCREENS = [
  { id: "PokemonCenterPC", label: "Pokémon Center PC" },
  { id: "PlayersHousePC", label: "Player's PC" },
  { id: "OverworldTownMap", label: "Town Map" },
  { id: "SlotMachine", label: "slot machine" },
  { id: "CardFlip", label: "Card Flip game" },
  { id: "NameRater", label: "Name Rater" },
  { id: "MoveDeletion", label: "Move Deleter" },
  { id: "BankOfMom", label: "Mom's savings" },
  { id: "Diploma", label: "Diploma" },
];
const screenName = (id: unknown) => SCREENS.find((x) => x.id === id)?.label ?? s(id);

const commands: EventCommand[] = [
  // ---- Message
  { id: "say_end", verb: "jumptextfaceplayer", label: "Face the player, say and end", category: "Message", help: "The person turns to the player, says the text and the event ends (the game's people mostly do just this).", params: [{ key: "text", label: "Text", type: "text" }], describe: (a) => `Face the player, say "${short(a.text)}" and end` },
  { id: "read_end", verb: "jumptext", label: "Show text and end", category: "Message", help: "Shows the text and the event ends.", params: [{ key: "text", label: "Text", type: "text" }], describe: (a) => `Text: "${short(a.text)}", then end` },
  { id: "show_text", verb: "writetext", label: "Show text", category: "Message", help: "Shows a text box (the player presses A to go on).", params: [{ key: "text", label: "Text", type: "text" }], describe: (a) => `Text: "${short(a.text)}"` },

  // ---- Flags (event flags are numbers in Gold, 0-2047)
  { id: "set_flag", verb: "setevent", label: "Set flag", category: "Flags", help: "Turns an event flag on. Flags remember that something happened (saved with the game).", params: [{ key: "event", label: "Flag", type: "flagNumber" }], describe: (a) => `Set flag ${s(a.event)}` },
  { id: "clear_flag", verb: "clearevent", label: "Clear flag", category: "Flags", help: "Turns an event flag off.", params: [{ key: "event", label: "Flag", type: "flagNumber" }], describe: (a) => `Clear flag ${s(a.event)}` },

  // ---- Scenes: a map's story stage (step triggers run only in theirs; entering
  // runs the scene's event); a map's own scene changes its blocks on the next load
  {
    id: "set_scene", verb: "setscene", label: "Set this map's scene", category: "Scenes",
    help: "Moves this map on to another scene: its step triggers and what happens on entering change. Blocks the scene changes show the next time the map loads.",
    params: [{ key: "scene", label: "Scene", type: "number", default: 1, min: 0, max: 255 }], describe: (a) => `Set this map's scene to ${s(a.scene)}`,
  },
  {
    id: "set_map_scene", verb: "setmapscene", label: "Set another map's scene", category: "Scenes",
    help: "Moves another map on to a scene (the game does this to start a story beat somewhere else).",
    params: [{ key: "map", label: "Map", type: "map" }, { key: "scene", label: "Scene", type: "number", default: 1, min: 0, max: 255 }],
    // the game names a map by its group and number
    pack: (a, ctx) => {
      const m = ctx.maps[String(a.map)] as { group?: number; map?: number } | undefined;
      return { group: m?.group ?? 0, map: m?.map ?? 0, scene: Number(a.scene ?? 0) };
    },
    unpack: (r, ctx) => ({ map: Object.keys(ctx.maps).find((id) => (ctx.maps[id] as { group?: number; map?: number }).group === r.group && (ctx.maps[id] as { group?: number; map?: number }).map === r.map) ?? "", scene: r.scene }),
    describe: (a) => `Set ${String(a.map)}'s scene to ${s(a.scene)}`,
  },
  {
    id: "check_scene", verb: "checkscene", label: "This map's scene is", category: "Conditions", help: "True while this map is in the scene.",
    params: [{ key: "scene", label: "Scene", type: "number", default: 0, min: 0, max: 255 }], condition: "this map's scene is {scene}", describe: (a) => `this map's scene is ${s(a.scene)}`,
    // checkscene leaves the scene as the last result; its If row compares it
    rows: () => [{ op: "checkscene" }], branch: { op: "ifequal", not: "ifnotequal" },
  },

  // ---- Conditions (used by If)
  // the number a command before it left: a menu choice, a check's answer …
  {
    id: "last_is", verb: "#lastis", label: "Last result is", category: "Conditions", help: "Compares the number the command before left: the player's choice in a menu, a check's answer, a random number …",
    params: [{ key: "value", label: "Number", type: "number", default: 0, min: 0, max: 255 }], condition: "the last result is {value}", describe: (a) => `the last result is ${s(a.value)}`,
    rows: () => [], branch: { op: "ifequal", not: "ifnotequal" },
  },
  {
    id: "check_money", verb: "checkmoney", label: "Has money", category: "Conditions", help: "True when the player has at least this much money.",
    params: [{ key: "amount", label: "Money", type: "number", default: 500, min: 0, max: 999999 }], condition: "the player has ¥{amount}", describe: (a) => `the player has ¥${s(a.amount)}`,
    pack: (a) => ({ args: moneyArgs(a.amount) }), unpack: (r) => ({ amount: moneyOf(r.args) }),
    // HAVE_LESS = 2: "has at least" is "not less"
    branch: { op: "ifnotequal", not: "ifequal", value: 2 },
  },
  {
    id: "check_time", verb: "checktime", label: "Time of day is", category: "Conditions", help: "True in the morning, the day or the night (never in a pitch-black cave, as on the cart).",
    params: [{ key: "time", label: "Time", type: "choice", default: 1, options: [{ value: 1, label: "Morning" }, { value: 2, label: "Day" }, { value: 4, label: "Night" }, { value: 3, label: "Morning or day" }, { value: 6, label: "Day or night" }] }],
    condition: "it is {time}", describe: (a) => `it is ${TIMES[Number(a.time)] ?? `time ${s(a.time)}`}`,
    pack: (a) => ({ args: [Number(a.time ?? 1)] }), unpack: (r) => ({ time: (r.args as number[] | undefined)?.[0] ?? 1 }),
  },
  {
    id: "check_coins", verb: "checkcoins", label: "Has coins", category: "Conditions", help: "True when the player has at least this many Game Corner coins.",
    params: [{ key: "amount", label: "Coins", type: "number", default: 50, min: 0, max: 9999 }], condition: "the player has {amount} coins", describe: (a) => `the player has ${s(a.amount)} coins`,
    pack: (a) => ({ args: wordArgs(a.amount) }), unpack: (r) => ({ amount: wordOf(r.args) }),
    // HAVE_LESS = 2, as for money
    branch: { op: "ifnotequal", not: "ifequal", value: 2 },
  },
  { id: "check_flag", verb: "checkevent", label: "Flag is set", category: "Conditions", help: "True when the event flag is on.", params: [{ key: "event", label: "Flag", type: "flagNumber" }], condition: "flag {event} is set", describe: (a) => `flag ${s(a.event)} is set` },
  {
    id: "check_item", verb: "checkitem", label: "Has item", category: "Conditions", help: "True when the bag holds at least one.",
    params: [{ key: "item", label: "Item", type: "item", default: "POTION" }], condition: "the player has {item}", describe: (a) => `the player has ${nice(a.item)}`,
    pack: (a, ctx) => ({ args: [numberOf(ctx, "items", a.item)] }),
    unpack: (r, ctx) => ({ item: idOf(ctx, "items", (r.args as number[] | undefined)?.[0]) }),
  },
  // compiled as the question's text, then yesorno
  { id: "ask", verb: "yesorno", label: "Ask yes/no", category: "Conditions", help: "Shows a question with YES/NO; true when the player picks YES.", params: [{ key: "text", label: "Question", type: "text" }], condition: "the player answers YES to \"{text}\"", describe: (a) => `the player answers YES to "${short(a.text, 30)}"` },

  // ---- Items & money
  {
    id: "give_item", verb: "verbosegiveitem", label: "Give item", category: "Items & money", help: "Puts an item in the bag and says so (\"PLAYER received …\").",
    params: [{ key: "item", label: "Item", type: "item", default: "POTION" }, { key: "quantity", label: "Count", type: "number", default: 1, min: 1, max: 99 }],
    describe: (a) => `Give ${s(a.quantity, "1")}× ${nice(a.item)}`,
    pack: (a, ctx) => ({ item: numberOf(ctx, "items", a.item), quantity: Number(a.quantity ?? 1) }),
    unpack: (r, ctx) => ({ item: idOf(ctx, "items", r.item), quantity: r.quantity }),
  },
  {
    id: "give_item_quiet", verb: "giveitem", label: "Give item silently", category: "Items & money", help: "Puts an item in the bag without a message (the last result is NO when the bag is full).",
    params: [{ key: "item", label: "Item", type: "item", default: "POTION" }, { key: "quantity", label: "Count", type: "number", default: 1, min: 1, max: 99 }],
    describe: (a) => `Put ${s(a.quantity, "1")}× ${nice(a.item)} in the bag (no message)`,
    pack: (a, ctx) => ({ item: numberOf(ctx, "items", a.item), quantity: Number(a.quantity ?? 1) }),
    unpack: (r, ctx) => ({ item: idOf(ctx, "items", r.item), quantity: r.quantity }),
  },
  {
    id: "give_coins", verb: "givecoins", label: "Give coins", category: "Items & money", help: "Adds Game Corner coins (at most 9999).",
    params: [{ key: "amount", label: "Coins", type: "number", default: 50, min: 1, max: 9999 }], describe: (a) => `Give ${s(a.amount)} coins`,
    pack: (a) => ({ args: wordArgs(a.amount) }), unpack: (r) => ({ amount: wordOf(r.args) }),
  },
  {
    id: "take_coins", verb: "takecoins", label: "Take coins", category: "Items & money", help: "Takes Game Corner coins (never below 0).",
    params: [{ key: "amount", label: "Coins", type: "number", default: 50, min: 1, max: 9999 }], describe: (a) => `Take ${s(a.amount)} coins`,
    pack: (a) => ({ args: wordArgs(a.amount) }), unpack: (r) => ({ amount: wordOf(r.args) }),
  },
  {
    id: "take_item", verb: "takeitem", label: "Take item", category: "Items & money", help: "Removes items from the bag.",
    params: [{ key: "item", label: "Item", type: "item", default: "POTION" }, { key: "quantity", label: "Count", type: "number", default: 1, min: 1, max: 99 }],
    describe: (a) => `Take ${s(a.quantity, "1")}× ${nice(a.item)}`,
    pack: (a, ctx) => ({ args: [numberOf(ctx, "items", a.item), Number(a.quantity ?? 1)] }),
    unpack: (r, ctx) => ({ item: idOf(ctx, "items", (r.args as number[] | undefined)?.[0]), quantity: (r.args as number[] | undefined)?.[1] }),
  },

  {
    id: "give_money", verb: "givemoney", label: "Give money", category: "Items & money", help: "Adds money (up to ¥999,999).",
    params: [{ key: "amount", label: "Money", type: "number", default: 100, min: 0, max: 999999 }], describe: (a) => `Give ¥${s(a.amount)}`,
    pack: (a) => ({ args: moneyArgs(a.amount) }), unpack: (r) => ({ amount: moneyOf(r.args) }),
  },
  {
    id: "take_money", verb: "takemoney", label: "Take money", category: "Items & money", help: "Removes money (never below 0).",
    params: [{ key: "amount", label: "Money", type: "number", default: 100, min: 0, max: 999999 }], describe: (a) => `Take ¥${s(a.amount)}`,
    pack: (a) => ({ args: moneyArgs(a.amount) }), unpack: (r) => ({ amount: moneyOf(r.args) }),
  },

  // ---- Pokémon
  {
    id: "heal_party", verb: "#heal", label: "Heal party", category: "Pokémon", help: "Fully heals the player's Pokémon (the game's HealParty).", params: [], describe: () => "Heal the party",
    rows: (_a, ctx) => [{ op: "special", id: placeIn(orders(ctx).specialOrder, "HealParty") }],
    match: (rows, at, ctx) => (rows[at]?.op === "special" && rows[at].id === placeIn(orders(ctx).specialOrder, "HealParty") ? { args: {}, length: 1 } : null),
  },
  {
    id: "give_pokemon", verb: "givepoke", label: "Give Pokémon", category: "Pokémon", help: "Adds a Pokémon to the party (or the PC box).",
    params: [{ key: "species", label: "Pokémon", type: "species", default: "CHIKORITA" }, { key: "level", label: "Level", type: "number", default: 5, min: 1, max: 100 }],
    describe: (a) => `Give ${nice(a.species)} Lv ${s(a.level)}`,
    pack: (a, ctx) => ({ species: numberOf(ctx, "pokemon", a.species), level: Number(a.level ?? 5), item: 0, trainer: 0 }),
    unpack: (r, ctx) => (r.item || r.trainer ? null : { species: idOf(ctx, "pokemon", r.species), level: r.level }),
  },
  {
    id: "give_egg", verb: "giveegg", label: "Give an Egg", category: "Pokémon", help: "Adds an Egg of this Pokémon to the party; it hatches at this level. The last result is 2 when the party had room.",
    params: [{ key: "species", label: "Pokémon", type: "species", default: "TOGEPI" }, { key: "level", label: "Level", type: "number", default: 5, min: 1, max: 100 }],
    describe: (a) => `Give an Egg of ${nice(a.species)} (Lv ${s(a.level)})`,
    pack: (a, ctx) => ({ args: [numberOf(ctx, "pokemon", a.species), Number(a.level ?? 5)] }),
    unpack: (r, ctx) => { const a = (r.args as number[] | undefined) ?? []; return { species: idOf(ctx, "pokemon", a[0]), level: a[1] ?? 5 }; },
  },
  {
    id: "random", verb: "random", label: "Random number", category: "Flags", help: "Rolls 0 up to this many minus 1 into the last result; an If on \"Last result is\" then picks by it.",
    params: [{ key: "count", label: "Out of", type: "number", default: 2, min: 1, max: 255 }], describe: (a) => `Roll a random number from 0 to ${Number(a.count ?? 2) - 1}`,
    pack: (a) => ({ args: [Number(a.count ?? 2)] }), unpack: (r) => ({ count: (r.args as number[] | undefined)?.[0] ?? 2 }),
  },
  {
    id: "play_cry", verb: "cry", label: "Play cry", category: "Pokémon", help: "Plays a Pokémon's cry.",
    params: [{ key: "species", label: "Pokémon", type: "species", default: "CHIKORITA" }], describe: (a) => `Cry of ${nice(a.species)}`,
    pack: (a, ctx) => ({ id: numberOf(ctx, "pokemon", a.species) }),
    unpack: (r, ctx) => ({ species: idOf(ctx, "pokemon", r.id) }),
  },

  // ---- Battle (the text box closes for the battle and opens again after)
  {
    id: "trainer_battle", verb: "#trainerbattle", label: "Trainer battle", category: "Battle",
    help: "Fights one of a class's trainers (their team is edited in Trainers). Losing sends the player back to a Pokémon Center, so what follows only runs after a win.",
    params: [{ key: "trainer", label: "Class", type: "trainer", default: "YOUNGSTER" }, { key: "member", label: "Trainer", type: "number", default: 1, min: 1, max: 255 }, { key: "winText", label: "Says when it loses", type: "text" }],
    describe: (a) => `Battle ${nice(a.trainer)} #${s(a.member)}`,
    rows: (a, ctx) => [{ op: "closetext" }, { op: "winlosstext", winText: a.winText }, { op: "loadtrainer", class: numberOf(ctx, "trainers", a.trainer), member: Number(a.member ?? 1) }, { op: "startbattle" }, { op: "reloadmapafterbattle" }, { op: "opentext" }],
    match: (rows, at, ctx) => (ops(rows, at, ["closetext", "winlosstext", "loadtrainer", "startbattle", "reloadmapafterbattle", "opentext"])
      ? { args: { trainer: idOf(ctx, "trainers", rows[at + 2].class), member: rows[at + 2].member, winText: rows[at + 1].winText }, length: 6 } : null),
  },
  {
    id: "wild_battle", verb: "#wildbattle", label: "Wild battle", category: "Battle", help: "Fights a wild Pokémon (like the Sudowoodo or the red Gyarados).",
    params: [{ key: "species", label: "Pokémon", type: "species", default: "SUDOWOODO" }, { key: "level", label: "Level", type: "number", default: 20, min: 1, max: 100 }],
    describe: (a) => `Wild ${nice(a.species)} Lv ${s(a.level)}`,
    rows: (a, ctx) => [{ op: "closetext" }, { op: "loadwildmon", species: numberOf(ctx, "pokemon", a.species), level: Number(a.level ?? 5) }, { op: "startbattle" }, { op: "reloadmapafterbattle" }, { op: "opentext" }],
    match: (rows, at, ctx) => (ops(rows, at, ["closetext", "loadwildmon", "startbattle", "reloadmapafterbattle", "opentext"])
      ? { args: { species: idOf(ctx, "pokemon", rows[at + 1].species), level: rows[at + 1].level }, length: 5 } : null),
  },

  // ---- People
  { id: "face_player", verb: "faceplayer", label: "Face the player", category: "People", help: "The person who was talked to turns to the player.", params: [], describe: () => "Face the player" },
  {
    id: "turn", verb: "turnobject", label: "Turn someone", category: "People", help: "Turns the player or a person of this map.",
    params: [{ key: "object", label: "Who", type: "goldObject" }, { key: "dir", label: "Direction", type: "dir", default: "down" }],
    describe: (a) => `${who(a.object)} turns ${s(a.dir)}`,
    pack: (a) => ({ object: Number(a.object ?? 0), facing: Math.max(0, DIRS.indexOf(String(a.dir))) }),
    unpack: (r) => ({ object: r.object, dir: DIRS[Number(r.facing) % 4] }),
  },
  {
    id: "emote", verb: "showemote", label: "Emotion bubble", category: "People", help: "Pops a bubble (! ? or happy) over the player or a person.",
    params: [{ key: "object", label: "Over", type: "goldObject" }, { key: "bubble", label: "Bubble", type: "bubble", default: "shock" }, { key: "frames", label: "Frames", type: "number", default: 15, min: 1, max: 255 }],
    describe: (a) => `Bubble ${s(a.bubble)} over ${who(a.object)}`,
    pack: (a) => ({ emote: Math.max(0, EMOTES.indexOf(String(a.bubble))), object: Number(a.object ?? 0), frames: Number(a.frames ?? 15) }),
    unpack: (r) => (Number(r.emote) < EMOTES.length ? { object: r.object, bubble: EMOTES[Number(r.emote)], frames: r.frames } : null),
  },
  {
    id: "follow", verb: "follow", label: "Follow", category: "People", help: "One walks behind the other (the leader's moves are made with movement commands) until Stop following.",
    params: [{ key: "leader", label: "Leader", type: "goldObject" }, { key: "follower", label: "Follower", type: "goldObject" }], describe: (a) => `${who(a.follower)} follows ${who(a.leader)}`,
    pack: (a) => ({ a: Number(a.leader ?? 0), b: Number(a.follower ?? 0) }), unpack: (r) => ({ leader: r.a, follower: r.b }),
  },
  { id: "stop_follow", verb: "stopfollow", label: "Stop following", category: "People", help: "Ends a Follow.", params: [], describe: () => "Stop following" },
  {
    id: "walk", verb: "applymovement", label: "Walk along a path", category: "Movement", help: "The player or a person walks a drawn path, one cell per arrow; the event waits until it's done. A person whose movement has fixed facing walks without turning, as in the game.",
    params: [{ key: "who", label: "Who", type: "goldObject" }, { key: "path", label: "Path", type: "path", default: [] }, { key: "speed", label: "Speed", type: "choice", default: 0x0c, options: [{ value: 0x0c, label: "Walk" }, { value: 0x08, label: "Slowly" }, { value: 0x10, label: "Fast" }] }],
    describe: (a) => `${who(a.who)} walks ${arrowsOf(a.path)}${Number(a.speed) === 0x08 ? " slowly" : Number(a.speed) === 0x10 ? " fast" : ""}`,
    // the key spells the steps; a save registers it ("movement:<key>", scriptKeys.ts)
    pack: (a) => {
      const steps = [...(Array.isArray(a.path) ? a.path : []).map((d) => Number(a.speed ?? 0x0c) | Math.max(0, DIRS.indexOf(String(d)))), 0x47];
      return { object: Number(a.who ?? 0), movement: `studio:${steps.join(".")}` };
    },
    // a path of one speed (the game's own too); anything else stays a game row
    unpack: (r, ctx) => {
      const moves = (ctx.data.extra as { scripts?: { movements?: Record<string, number[]> } }).scripts?.movements;
      // older studio rows carried `steps`
      const steps = (Array.isArray(r.steps) ? r.steps : studioMovementSteps(r.movement) ?? moves?.[String(r.movement)]) as number[] | undefined;
      if (!steps || steps[steps.length - 1] !== 0x47 || steps.length < 2) return null;
      const body = steps.slice(0, -1);
      const speed = body[0] & 0xfc;
      if (![0x08, 0x0c, 0x10].includes(speed) || body.some((b) => (b & 0xfc) !== speed)) return null;
      return { who: r.object, path: body.map((b) => DIRS[b & 3]), speed };
    },
  },
  {
    id: "warp", verb: "warp", label: "Warp", category: "Movement", help: "Takes the player to a cell of a map at once (the event goes on there).",
    params: [{ key: "map", label: "Map", type: "map" }, { key: "x", label: "X", type: "number", default: 0, min: 0, max: 255 }, { key: "y", label: "Y", type: "number", default: 0, min: 0, max: 255 }],
    describe: (a) => `Warp to ${s(a.map)} (${s(a.x)}, ${s(a.y)})`,
    pack: (a, ctx) => {
      const m = ctx.maps[String(a.map)] as { group?: number; map?: number } | undefined;
      return { args: [m?.group ?? 0, m?.map ?? 0, Number(a.x ?? 0), Number(a.y ?? 0)] };
    },
    unpack: (r, ctx) => {
      const a = (r.args as number[] | undefined) ?? [];
      const map = Object.keys(ctx.maps).find((id) => (ctx.maps[id] as { group?: number; map?: number }).group === a[0] && (ctx.maps[id] as { group?: number; map?: number }).map === a[1]) ?? "";
      return { map, x: a[2] ?? 0, y: a[3] ?? 0 };
    },
  },
  {
    id: "hide", verb: "disappear", label: "Hide a person", category: "People", help: "Takes a person of this map away now. With its own event flag (Event flag in its properties) it stays away; without one it's back when the map loads again.",
    params: [{ key: "object", label: "Who", type: "goldObject" }], describe: (a) => `Hide ${who(a.object)}`,
    pack: (a) => ({ object: Number(a.object ?? 2) }), unpack: (r) => ({ object: r.object ?? (r.args as number[] | undefined)?.[0] }),
  },
  {
    id: "show", verb: "appear", label: "Show a person", category: "People", help: "Brings back a person of this map that its event flag hides (clears that flag).",
    params: [{ key: "object", label: "Who", type: "goldObject" }], describe: (a) => `Show ${who(a.object)}`,
    pack: (a) => ({ object: Number(a.object ?? 2), args: [Number(a.object ?? 2)] }), unpack: (r) => ({ object: r.object ?? (r.args as number[] | undefined)?.[0] }),
  },

  // ---- Name slot: the one string buffer {STRBUF} shows (gen1recomp Vm:setStringBuffer)
  {
    id: "slot_word", verb: "getstring", label: "Name slot: a word", category: "Name slot",
    help: "Puts these letters where a later text says {STRBUF}.",
    params: [{ key: "string", label: "Word", type: "word", default: "ROUTE 30" }], describe: (a) => `Name slot: "${s(a.string)}"`,
    pack: (a) => ({ buffer: 0, string: String(a.string ?? "") }), unpack: (r) => ({ string: r.string }),
  },
  {
    id: "slot_mon", verb: "getmonname", label: "Name slot: a Pokémon", category: "Name slot",
    help: "Puts a Pokémon's name where a later text says {STRBUF}.",
    params: [{ key: "species", label: "Pokémon", type: "species", default: "RATTATA" }], describe: (a) => `Name slot: ${nice(a.species)}`,
    pack: (a, ctx) => ({ species: numberOf(ctx, "pokemon", a.species), buffer: 0 }), unpack: (r, ctx) => ({ species: idOf(ctx, "pokemon", r.species) }),
  },
  {
    id: "slot_item", verb: "getitemname", label: "Name slot: an item", category: "Name slot",
    help: "Puts an item's name where a later text says {STRBUF}.",
    params: [{ key: "item", label: "Item", type: "item", default: "POTION" }], describe: (a) => `Name slot: ${nice(a.item)}`,
    pack: (a, ctx) => ({ item: numberOf(ctx, "items", a.item), buffer: 0 }), unpack: (r, ctx) => ({ item: idOf(ctx, "items", r.item) }),
  },
  {
    id: "slot_trainer", verb: "gettrainername", label: "Name slot: a trainer's name", category: "Name slot",
    help: "Puts a trainer's name where a later text says {STRBUF} (a phone call: the caller's own class and trainer).",
    params: [{ key: "trainer", label: "Class", type: "trainer", default: "YOUNGSTER" }, { key: "member", label: "Trainer", type: "number", default: 1, min: 1, max: 255 }],
    describe: (a) => `Name slot: ${nice(a.trainer)} #${s(a.member)}'s name`,
    pack: (a, ctx) => ({ group: numberOf(ctx, "trainers", a.trainer), trainer: Number(a.member ?? 1), buffer: 0 }), unpack: (r, ctx) => ({ trainer: idOf(ctx, "trainers", r.group), member: r.trainer }),
  },
  {
    id: "slot_phone", verb: "#slotphone", label: "Name slot: from the caller", category: "Name slot",
    help: "Phone calls: puts one of the caller's own Pokémon, or a wild Pokémon of the caller's map, where a later text says {STRBUF}.",
    params: [{ key: "what", label: "What", type: "choice", default: "RandomPhoneMon", options: [
      { value: "RandomPhoneMon", label: "one of the caller's Pokémon" },
      { value: "RandomPhoneWildMon", label: "a wild Pokémon of the caller's map" },
    ] }],
    describe: (a) => `Name slot: ${a.what === "RandomPhoneWildMon" ? "a wild Pokémon of the caller's map" : "one of the caller's Pokémon"}`,
    rows: (a, ctx) => [{ op: "special", id: placeIn(orders(ctx).specialOrder, a.what) }],
    match: (rows, at, ctx) => {
      const name = rows[at]?.op === "special" ? orders(ctx).specialOrder?.[Number(rows[at].id)] : undefined;
      return name === "RandomPhoneMon" || name === "RandomPhoneWildMon" ? { args: { what: name }, length: 1 } : null;
    },
  },

  // ---- Screens
  {
    id: "show_pic", verb: "#pokepic", label: "Show a Pokémon's picture", category: "Screens", help: "Shows a Pokémon's front picture until the player presses A.",
    params: [{ key: "species", label: "Pokémon", type: "species", default: "CHIKORITA" }], describe: (a) => `Show ${nice(a.species)}'s picture`,
    rows: (a, ctx) => [{ op: "pokepic", species: numberOf(ctx, "pokemon", a.species) }, { op: "waitbutton" }, { op: "closepokepic" }],
    match: (rows, at, ctx) => (ops(rows, at, ["pokepic", "waitbutton", "closepokepic"]) ? { args: { species: idOf(ctx, "pokemon", rows[at].species) }, length: 3 } : null),
  },
  {
    id: "open_screen", verb: "#screen", label: "Open a screen", category: "Screens", help: "Opens one of the game's screens (a special); the event goes on once the player closes it.",
    params: [{ key: "screen", label: "Screen", type: "screen", default: "PokemonCenterPC" }], describe: (a) => `Open the ${screenName(a.screen)}`,
    rows: (a, ctx) => [{ op: "special", id: placeIn(orders(ctx).specialOrder, a.screen) }],
    match: (rows, at, ctx) => {
      const name = rows[at]?.op === "special" ? orders(ctx).specialOrder?.[Number(rows[at].id)] : undefined;
      return name && SCREENS.some((x) => x.id === name) ? { args: { screen: name }, length: 1 } : null;
    },
  },

  // ---- Screen & sound
  { id: "wait", verb: "pause", label: "Wait", category: "Screen & sound", help: "Pauses (60 frames = 1 second).", params: [{ key: "frames", label: "Frames", type: "number", default: 30, min: 1, max: 255 }], describe: (a) => `Wait ${s(a.frames)} frames` },
  {
    id: "play_sound", verb: "playsound", label: "Play sound", category: "Screen & sound", help: "Plays one of the game's sound effects.",
    params: [{ key: "sound", label: "Sound", type: "sound", default: "Sfx_Item" }], describe: (a) => `Sound: ${s(a.sound).replace(/^Sfx_/, "")}`,
    pack: (a, ctx) => ({ id: placeIn(orders(ctx).sfxOrder, a.sound) }), unpack: (r, ctx) => ({ sound: orders(ctx).sfxOrder?.[Number(r.id)] ?? r.id }),
  },
  {
    id: "fade_music", verb: "musicfadeout", label: "Fade to a song", category: "Screen & sound", help: "Fades the music out, then starts this song (the game's songs only).",
    params: [{ key: "song", label: "Then play", type: "song", default: "Music_Route1" }], describe: (a) => `Fade the music, then ${s(a.song).replace(/^Music_/, "")}`,
    pack: (a, ctx) => { const n = placeIn(orders(ctx).musicOrder, a.song); return { args: [n & 255, n >> 8, 16] }; },
    unpack: (r, ctx) => { const a = (r.args as number[] | undefined) ?? []; return { song: orders(ctx).musicOrder?.[(a[0] ?? 0) + (a[1] ?? 0) * 256] ?? "" }; },
  },
  { id: "map_music", verb: "playmapmusic", label: "Back to the map's music", category: "Screen & sound", help: "Plays the map's own song again (after a song an event started).", params: [], describe: () => "Back to the map's music" },
  {
    id: "earthquake", verb: "earthquake", label: "Earthquake", category: "Screen & sound", help: "Shakes the screen. The game uses strength 80 (the shaking lasts strength mod 64 frames).",
    params: [{ key: "strength", label: "Strength", type: "number", default: 80, min: 1, max: 255 }], describe: (a) => `Earthquake (${s(a.strength)})`,
    pack: (a) => ({ args: [Number(a.strength ?? 80)] }), unpack: (r) => ({ strength: (r.args as number[] | undefined)?.[0] ?? 80 }),
  },
  {
    id: "play_music", verb: "playmusic", label: "Play music", category: "Screen & sound", help: "Switches to one of the game's songs (a mod's own songs can't be picked here: the game plays songs by number).",
    params: [{ key: "song", label: "Song", type: "song", default: "Music_Route1" }], describe: (a) => `Music: ${s(a.song).replace(/^Music_/, "")}`,
    pack: (a, ctx) => ({ id: placeIn(orders(ctx).musicOrder, a.song) }), unpack: (r, ctx) => ({ song: orders(ctx).musicOrder?.[Number(r.id)] ?? r.id }),
  },
];

export const GEN2_EVENTS: EventSpec = {
  registry: "",
  inline: true,
  categories: ["Message", "Name slot", "Flags", "Scenes", "Conditions", "Items & money", "Pokémon", "Battle", "People", "Movement", "Screen & sound", "Screens"],
  commands,
  screens: SCREENS,
  choiceVerb: "",
  stopVerb: "end",
  compile: (blocks, ctx, mode) => (mode === "phone" ? compilePhone(blocks, ctx) : compile(blocks, ctx)),
  preset: (rows) => presetOf(rows as unknown as Row[]),
  describeRaw: (row, ctx) => describeRaw(row as Row, ctx),
  gameRows: (ctx, key) => gameScriptRows((ctx.data.extra as { scripts?: Record<string, unknown> }).scripts ?? {}, key) as unknown as EventRow[] | null,
  parse: (rows, ctx, mode) => (mode === "phone" ? parsePhone(rows as unknown as Row[], ctx) : parse(rows as unknown as Row[], ctx)),
};

// ------------------------------------------------------------------ the game's other commands
// What the commands the editor has no form for do, in words (pokecrystal
// macros/scripts/events.asm and engine/overworld/scripting.asm; gen1recomp
// src/script/gen2/Vm.lua). A copy keeps them as they are.

const nums = (r: Row) => (r.args as number[] | undefined) ?? [];
const word = (r: Row, at = 0) => (nums(r)[at] ?? 0) + (nums(r)[at + 1] ?? 0) * 256;
const pretty = (v: unknown) => s(v).replace(/Script$/, "").replace(/^(Sfx|Music)_/, "").replace(/([a-z])([A-Z0-9])/g, "$1 $2");

function describeRaw(r: Row, ctx: GameContext): { text: string; help: string } {
  const item = (n: unknown) => nice(idOf(ctx, "items", n));
  const mon = (n: unknown) => nice(idOf(ctx, "pokemon", n));
  const special = (id: unknown) => orders(ctx).specialOrder?.[Number(id)] ?? s(id);
  const d = (text: string, help = "") => ({ text, help });
  switch (r.op) {
    case "scall": case "farscall": return Array.isArray(r.script)
      ? d(`Runs ${(r.script as unknown[]).length} steps of its own, then goes on`, "A copied part of the game's script with several endings (each comes back here); its lines are edited in Global > Phone contacts.")
      : d("Runs another of the game's scripts, then goes on", "A call: the game script runs and comes back here. Kept as the game's.");
    case "sjump": case "farsjump": return d("Goes on in another of the game's scripts", "A jump: nothing after it runs. Kept as the game's.");
    case "jumpstd": return d(`Runs the game's ${pretty(r.std)} script (and ends)`, "One of the game's standard scripts (nurse, bookshelves, phone calls …).");
    case "callstd": return d(`Runs the game's ${pretty(r.std)} script`, "One of the game's standard scripts, then goes on.");
    case "promptbutton": return d("Waits for A (the text box stays open)", "Like the wait after a text, but the next text continues in the same box.");
    case "applymovement": return d(`Moves ${who(r.object)} along one of the game's paths`, "The steps are the game's own movement data; mods can't add paths yet (ISSUES #4).");
    case "applymovementlasttalked": return d("Moves the person talked to along one of the game's paths");
    case "endifjustbattled": return d("Ends here right after a battle", "Used by trainers: what follows only runs when the player talks to them later.");
    case "setflag": return d(`Sets engine flag ${s(r.flag)}`, "Engine flags are the game's own switches (badges, Pokégear cards, the bike …), not event flags.");
    case "clearflag": return d(`Clears engine flag ${s(r.flag)}`, "Engine flags are the game's own switches (badges, Pokégear cards …).");
    case "checkflag": return d(`Checks engine flag ${s(r.flag)}`, "The last result is 1 when it is set (an If right after reads it).");
    case "waitsfx": return d("Waits until the sound effect has played");
    case "giveitem": return d(`Gives ${s(r.quantity, "1")}× ${item(r.item)} without a message`, "The last result says whether it fit in the bag.");
    case "getitemname": return d(`Puts the name ${item(r.item)} into text slot ${s(r.buffer)}`, "A later text shows it where it has {STRBUF…}.");
    case "getmonname": return d(`Puts the name ${mon(r.species)} into text slot ${s(r.buffer)}`);
    case "gettrainername": return d(`Puts a trainer's name into text slot ${s(r.buffer)}`);
    case "getstring": return d(`Puts "${s(r.string)}" into text slot ${s(r.buffer)}`);
    case "setval": return d(`Sets the last result to ${s(nums(r)[0] ?? r.value)}`);
    case "addval": return d(`Adds ${s(nums(r)[0])} to the last result`);
    case "random": return d(`Picks a random number below ${s(nums(r)[0])} as the last result`);
    case "readvar": return d(`Reads game value ${s(r.var)} as the last result`, "A value the game keeps (party size, badges, time of day …).");
    case "loadvar": case "writemem": return d("Sets one of the game's values");
    case "readmem": return d("Reads one of the game's values as the last result");
    case "itemnotify": return d("Says the item went into its pocket");
    case "reanchormap": return d("Redraws the map behind the text box");
    case "refreshmap": case "reloadmap": case "newloadmap": return d("Redraws the map");
    case "loadmenu": {
      const items = ((r.menu as { items?: string[] } | undefined)?.items ?? []).map((x) => x.trim()).filter(Boolean);
      return d(`Shows a menu: ${items.join(" / ") || "…"}`, "The player picks with the next command; the last result is the choice (1 = the first).");
    }
    case "verticalmenu": case "_2dmenu": return d("Lets the player pick from the menu", "The last result is the choice (1 = the first, 0 = B).");
    case "closewindow": return d("Closes the menu");
    case "setscene": return d(`Sets this map's scene to ${s(r.scene)}`, "Step triggers only run in their scene; scenes are how the game moves a story on.");
    case "setmapscene": return d(`Sets another map's scene to ${s(r.scene)}`);
    case "checkscene": return d("Reads this map's scene as the last result");
    case "askforphonenumber": return d("Asks for the player's phone number");
    case "checkcellnum": return d("Checks whether this phone number is registered");
    case "addcellnum": return d("Registers a phone number");
    case "specialphonecall": return d("Arranges a special phone call");
    case "checkcoins": return d(`Checks for ${word(r)} coins`, "The last result: 0 more, 1 exactly, 2 fewer.");
    case "takecoins": return d(`Takes ${word(r)} coins`);
    case "givecoins": return d(`Gives ${word(r)} coins`);
    case "pokemart": return d(`Opens shop ${nums(r)[1] ?? 0}`);
    case "moveobject": return d(`Puts NPC ${(nums(r)[0] ?? 1) - 1} on cell ${s(nums(r)[1])}, ${s(nums(r)[2])}`);
    case "setlasttalked": return d(`Treats ${who(r.object)} as the person talked to`);
    case "warp": return d(`Warps the player to cell ${s(nums(r)[2])}, ${s(nums(r)[3])} of map ${s(nums(r)[0])}:${s(nums(r)[1])}`);
    case "warpcheck": return d("Takes the warp the player stands on, if any");
    case "fruittree": return d(`A fruit tree (#${s(nums(r)[0])})`);
    case "playmapmusic": return d("Plays the map's own music again");
    case "dontrestartmapmusic": return d("Keeps the current music after the event");
    case "musicfadeout": return d("Fades the music out");
    case "variablesprite": return d(`Changes the look of the people using sprite slot ${s(nums(r)[0])}`);
    case "follow": return d(`${who(r.b)} follows ${who(r.a)}`);
    case "stopfollow": return d("Stops following");
    case "changeblock": return d(`Changes the block at ${s(nums(r)[0])}, ${s(nums(r)[1])} to block ${s(nums(r)[2])}`);
    case "ifgreater": return d(`If the last result is more than ${s(r.value)}: runs its own commands, then ends`);
    case "ifless": return d(`If the last result is less than ${s(r.value)}: runs its own commands, then ends`);
    case "iftrue": case "iffalse": return d(`If the last result is ${r.op === "iftrue" ? "true" : "false"}: runs its own commands, then ends`);
    case "givepoke": return d(`Gives ${mon(r.species)} Lv ${s(r.level)}${r.item ? ` holding ${item(r.item)}` : ""}`);
    case "showemote": return d(`Shows an emotion bubble over ${who(r.object)}`);
    case "ifequal": case "ifnotequal": return d(`If the last result is${r.op === "ifnotequal" ? " not" : ""} ${s(r.value)}: runs its own commands, then ends`);
    case "earthquake": return d("Shakes the screen");
    case "checkver": return d("Checks which game this is (Gold or Silver)");
    case "checktime": return d("Checks the time of day");
    case "trade": return d(`In-game trade #${s(r.trade)}`);
    case "describedecoration": return d("Describes a decoration in the player's room");
    case "catchtutorial": return d("Runs the catching tutorial");
    case "pokepic": return d(`Shows ${mon(r.species ?? nums(r)[0])}'s picture`);
    case "closepokepic": return d("Closes the picture");
    case "giveegg": return d(`Gives an egg of ${mon(nums(r)[0])}`);
    case "elevator": return d("Opens the elevator's floor menu");
    case "credits": return d("Rolls the credits");
    case "givepokemail": case "checkpokemail": return d(r.op === "givepokemail" ? "Gives a Pokémon with mail" : "Checks for a Pokémon with that mail");
    case "special": return d(`Runs the game's ${pretty(special(r.id))}`, "A special: game code run by name (HealParty, the bike shop …).");
    case "winlosstext": return d("Sets the trainer's lines for winning and losing");
    case "loadtrainer": return d(`Loads the trainer (class ${s(r.class)} #${s(r.member)}) for the battle`);
    case "loadwildmon": return d(`Loads a wild ${mon(r.species)} Lv ${s(r.level)} for the battle`);
    case "startbattle": return d("Starts the battle", "The last result is 0 after a win.");
    case "reloadmapafterbattle": return d("Back to the map after the battle");
    case "opentext": return d("Opens the text box");
    case "closetext": return d("Closes the text box");
    case "waitbutton": return d("Waits for A");
    case "end": return d("Ends the event");
  }
  return d(`Game command: ${r.op}`, "One of the game's script commands the studio has no description for yet.");
}

// a script one of the Roles writes (src/ui/roles2.ts): one line of text, a
// std script (nurse, bookshelf …), a shop
export function presetOf(rows: Row[]): boolean {
  if (rows.length === 1 && ["jumptextfaceplayer", "jumptext", "jumpstd", "fruittree"].includes(rows[0].op)) return true;
  return rows.some((r) => r.op === "pokemart") && rows.every((r) => ["faceplayer", "opentext", "pokemart", "closetext", "end"].includes(r.op));
}

// The game's script `key` with what it branches or jumps to read in: an If
// arm (iftrue ... "48:4095") becomes the nested list, a jump (sjump) is
// replaced by the rows it jumps to (nothing after a jump runs). Calls (scall,
// jumpstd …) stay keys: they come back, and run as they are. Rows stay the
// game's own, so a copy runs exactly as the game's script does.
const BRANCHES = new Set(["iftrue", "iffalse", "ifequal", "ifnotequal", "ifgreater", "ifless"]);
export function gameScriptRows(scripts: Record<string, unknown>, key: string, seen: string[] = []): Row[] | null {
  const list = scripts[key];
  if (!Array.isArray(list) || seen.includes(key) || seen.length > 8) return null;
  const out: Row[] = [];
  for (const r of list as Row[]) {
    if ((r.op === "sjump" || r.op === "farsjump") && typeof r.script === "string") {
      const rest = gameScriptRows(scripts, r.script, [...seen, key]);
      if (rest) return [...out, ...rest];
    }
    if (BRANCHES.has(r.op) && typeof r.script === "string") {
      const arm = gameScriptRows(scripts, r.script, [...seen, key]);
      out.push(arm ? { ...r, script: arm } : r);
      continue;
    }
    out.push(r);
  }
  return out;
}

// ------------------------------------------------------------------ compile

// looked up on use: a module-level Map would keep this module (and the
// catalog) in release builds, which drop Gen 2
const byVerb = { get: (verb: string) => commands.find((c) => c.verb === verb) };
const END: Row[] = [{ op: "closetext" }, { op: "end" }];

// a command block's row ([verb, ...params]) as Gold rows
function rowsOf(row: EventRow, ctx: GameContext): Row[] {
  if (row[0] === "#raw") return [row[1] as Row];
  const c = byVerb.get(String(row[0]));
  if (!c) return [];
  const args: Args = {};
  c.params.forEach((p, i) => (args[p.key] = row[1 + i] ?? p.default));
  if (c.rows) return c.rows(args, ctx) as Row[];
  if (c.verb === "writetext") return [{ op: "writetext", text: args.text }, { op: "waitbutton" }];
  if (c.verb === "yesorno") return [{ op: "writetext", text: args.text }, { op: "yesorno" }];
  return [{ op: c.verb, ...(c.pack ? c.pack(args, ctx) : args) }];
}

function emit(list: Block[], tail: Row[], ctx: GameContext): Row[] {
  const out: Row[] = [];
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (b.t === "cmd") out.push(...rowsOf(b.row, ctx));
    else if (b.t === "stop") return [...out, ...END];
    else if (b.t === "if") {
      const rest = emit(list.slice(i + 1), tail, ctx);
      if (b.cond) out.push(...rowsOf(b.cond, ctx));
      const br = b.cond ? byVerb.get(String(b.cond[0]))?.branch : undefined;
      out.push(br ? { op: b.not ? br.not : br.op, value: br.value ?? Number(b.cond![1] ?? 0), script: emit(b.then, rest, ctx) } : { op: b.not ? "iffalse" : "iftrue", script: emit(b.then, rest, ctx) });
      return [...out, ...emit(b.else ?? [], rest, ctx)];
    }
    // Choice / follow / labels are not offered for Gold
  }
  return [...out, ...tail];
}

const OPEN_AFTER = ["faceplayer", "endifjustbattled"];

export function compile(blocks: Block[], ctx: GameContext): EventRow[] {
  const rows = emit(blocks, END, ctx);
  // the text box opens once, after the person turned to the player (and after
  // a trainer's endifjustbattled, as the game's after-battle scripts have it)
  let at = 0;
  while (OPEN_AFTER.includes(String(rows[at]?.op))) at++;
  rows.splice(at, 0, { op: "opentext" });
  return rows as unknown as EventRow[];
}

// ------------------------------------------------------------------ parse

const CHECKS = { has: (op: string) => !!byVerb.get(op)?.condition };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// a Gold row as a command block's row, or a raw row kept as it is
function blockRow(r: Row, ctx: GameContext): EventRow {
  const c = byVerb.get(r.op);
  const args = c ? (c.unpack ? c.unpack(r, ctx) : r) : null;
  if (!c || !args) return ["#raw", r];
  return [c.verb, ...c.params.map((p) => args[p.key])];
}

const endsWith = (list: Row[], tail: Row[]) => list.length >= tail.length && tail.every((r, i) => same(r, list[list.length - tail.length + i]));

// `rows` without `tail`, the rows every branch in it ends with (what follows
// the enclosing Ifs, then closetext + end): compile() copied them there
function parseList(rows: Row[], tail: Row[], ctx: GameContext): Block[] {
  const out: Block[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const next = rows[i + 1];
    if (r.op === "end") break;
    // a command written as several rows (a battle)
    const multi = commands.find((c) => c.match?.(rows, i, ctx));
    if (multi) {
      const m = multi.match!(rows, i, ctx)!;
      out.push({ t: "cmd", row: [multi.verb, ...multi.params.map((p) => m.args[p.key])] });
      i += m.length - 1;
      continue;
    }
    if (r.op === "closetext" && (!next || next.op === "end")) continue;
    // a condition: [writetext q, yesorno] or a check, then iftrue/iffalse
    let cond: EventRow | null = null;
    let j = i;
    if (r.op === "writetext" && next?.op === "yesorno") {
      cond = ["yesorno", r.text];
      j = i + 2;
    } else if (r.op === "checkscene" && (next?.op === "ifequal" || next?.op === "ifnotequal") && typeof next.value === "number") {
      // the scene compared is the If row's value
      cond = ["checkscene", next.value];
      j = i + 1;
    } else if (CHECKS.has(r.op)) {
      cond = blockRow(r, ctx);
      j = i + 1;
    } else if ((r.op === "ifequal" || r.op === "ifnotequal") && typeof r.value === "number" && Array.isArray(r.script)) {
      // reads the last result on its own
      cond = ["#lastis", r.value];
    }
    const branch = rows[j];
    const script = branch?.script as Row[] | undefined;
    // the If row: iftrue/iffalse, or the check's own (checkmoney: ifnotequal 2)
    const br = cond ? byVerb.get(String(cond[0]))?.branch : undefined;
    const reads = br ? (branch?.op === br.op || branch?.op === br.not) && branch?.value === (br.value ?? Number(cond?.[1])) : branch?.op === "iftrue" || branch?.op === "iffalse";
    if (branch && reads && Array.isArray(script) && (cond || j === i) && (endsWith(script, tail) || endsWith(script, END))) {
      const not = br ? branch.op === br.not : branch.op === "iffalse";
      const after = rows.slice(j + 1);
      if (!endsWith(script, tail)) {
        // the then-branch stops the event: what follows the If is the rest
        out.push({ t: "if", cond, not, then: [...parseList(script.slice(0, -END.length), END, ctx), { t: "stop" }], else: null });
        return [...out, ...parseList(after, tail, ctx)];
      }
      const then = script.slice(0, script.length - tail.length);
      // what follows the If ends both branches (a text's waitbutton stays with it)
      let k = 0;
      while (k < then.length && k < after.length && same(then[then.length - 1 - k], after[after.length - 1 - k])) k++;
      while (k > 0 && after[after.length - k].op === "waitbutton") k--;
      const shared = after.slice(after.length - k);
      const inner = [...shared, ...tail];
      const elseRows = after.slice(0, after.length - k);
      out.push({ t: "if", cond, not, then: parseList(then.slice(0, then.length - k), inner, ctx), else: elseRows.length ? parseList(elseRows, inner, ctx) : null });
      return [...out, ...parseList(shared, tail, ctx)];
    }
    if (cond) {
      // a check or question no If reads: keep it as it is
      out.push({ t: "cmd", row: r.op === "writetext" || cond[0] === "#lastis" ? blockRow(r, ctx) : cond });
      continue;
    }
    if (r.op === "writetext") {
      out.push({ t: "cmd", row: ["writetext", r.text] });
      if (next?.op === "waitbutton") i++;
      continue;
    }
    out.push({ t: "cmd", row: blockRow(r, ctx) });
  }
  return out;
}

// A Pokégear call (gen1recomp PhoneRing.script rings, shows the caller box and
// hangs up around it): no text box of its own, and a promptbutton after each
// text, as the cart's phone scripts have it. Written as an event's rows with
// those swapped, so compile/parse stay one.
const mapRows = (rows: Row[], f: (r: Row) => Row[]): Row[] =>
  rows.flatMap((r) => f(Array.isArray(r.script) ? { ...r, script: mapRows(r.script as Row[], f) } : r));

function compilePhone(blocks: Block[], ctx: GameContext): EventRow[] {
  const rows = compile(blocks, ctx) as unknown as Row[];
  return mapRows(rows, (r) => (r.op === "opentext" || r.op === "closetext" ? [] : r.op === "waitbutton" ? [{ op: "promptbutton" }] : [r])) as unknown as EventRow[];
}

function parsePhone(input: Row[], ctx: GameContext): Block[] {
  // back to an event's shape: waitbutton after a text, closetext before each end
  const withClose = (rows: Row[]): Row[] => {
    const out = rows.map((r) => (Array.isArray(r.script) ? { ...r, script: withClose(r.script as Row[]) } : r.op === "promptbutton" ? { op: "waitbutton" } : r));
    const last = out[out.length - 1];
    if (last?.op === "end" && out[out.length - 2]?.op !== "closetext") out.splice(out.length - 1, 0, { op: "closetext" });
    return out;
  };
  return parse(withClose(input), ctx);
}

export function parse(input: Row[], ctx: GameContext): Block[] {
  const rows = [...input];
  // the opentext compile() puts after the leading faceplayer / endifjustbattled
  let at = 0;
  while (OPEN_AFTER.includes(String(rows[at]?.op))) at++;
  if (rows[at]?.op === "opentext") rows.splice(at, 1);
  return endsWith(rows, END) ? parseList(rows.slice(0, -END.length), END, ctx) : parseList(rows, [], ctx);
}
