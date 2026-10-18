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

const s = (v: unknown, fallback = "?") => (v === undefined || v === null || v === "" ? fallback : String(v));
const short = (v: unknown, n = 40) => {
  const t = s(v, "…").replace(/\{(DONE|PROMPT)\}/g, "").replace(/\n|\f|\v/g, " ");
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const nice = (v: unknown) => s(v).replace(/_/g, " ").toLowerCase().replace(/(^| )\w/g, (c) => c.toUpperCase());

const commands: EventCommand[] = [
  // ---- Message
  { id: "show_text", verb: "writetext", label: "Show text", category: "Message", help: "Shows a text box (the player presses A to go on).", params: [{ key: "text", label: "Text", type: "text" }], describe: (a) => `Text: "${short(a.text)}"` },

  // ---- Flags (event flags are numbers in Gold, 0-2047)
  { id: "set_flag", verb: "setevent", label: "Set flag", category: "Flags", help: "Turns an event flag on. Flags remember that something happened (saved with the game).", params: [{ key: "event", label: "Flag", type: "flagNumber" }], describe: (a) => `Set flag ${s(a.event)}` },
  { id: "clear_flag", verb: "clearevent", label: "Clear flag", category: "Flags", help: "Turns an event flag off.", params: [{ key: "event", label: "Flag", type: "flagNumber" }], describe: (a) => `Clear flag ${s(a.event)}` },

  // ---- Conditions (used by If)
  { id: "check_flag", verb: "checkevent", label: "Flag is set", category: "Conditions", help: "True when the event flag is on.", params: [{ key: "event", label: "Flag", type: "flagNumber" }], condition: "flag {event} is set", describe: (a) => `flag ${s(a.event)} is set` },
  {
    id: "check_item", verb: "checkitem", label: "Has item", category: "Conditions", help: "True when the bag holds at least one.",
    params: [{ key: "item", label: "Item", type: "item", default: "POTION" }], condition: "the player has {item}", describe: (a) => `the player has ${nice(a.item)}`,
    pack: (a, ctx) => ({ args: [numberOf(ctx, "items", a.item)] }),
    unpack: (r, ctx) => ({ item: idOf(ctx, "items", (r.args as number[] | undefined)?.[0]) }),
  },
  // compiled as the question's text, then yesorno
  { id: "ask", verb: "yesorno", label: "Ask yes/no", category: "Conditions", help: "Shows a question with YES/NO; true when the player picks YES.", params: [{ key: "text", label: "Question", type: "text" }], condition: "the player answers YES to \"{text}\"", describe: (a) => `the player answers YES to "${short(a.text, 30)}"` },

  // ---- Items
  {
    id: "give_item", verb: "verbosegiveitem", label: "Give item", category: "Items", help: "Puts an item in the bag and says so (\"PLAYER received …\").",
    params: [{ key: "item", label: "Item", type: "item", default: "POTION" }, { key: "quantity", label: "Count", type: "number", default: 1, min: 1, max: 99 }],
    describe: (a) => `Give ${s(a.quantity, "1")}× ${nice(a.item)}`,
    pack: (a, ctx) => ({ item: numberOf(ctx, "items", a.item), quantity: Number(a.quantity ?? 1) }),
    unpack: (r, ctx) => ({ item: idOf(ctx, "items", r.item), quantity: r.quantity }),
  },
  {
    id: "take_item", verb: "takeitem", label: "Take item", category: "Items", help: "Removes items from the bag.",
    params: [{ key: "item", label: "Item", type: "item", default: "POTION" }, { key: "quantity", label: "Count", type: "number", default: 1, min: 1, max: 99 }],
    describe: (a) => `Take ${s(a.quantity, "1")}× ${nice(a.item)}`,
    pack: (a, ctx) => ({ args: [numberOf(ctx, "items", a.item), Number(a.quantity ?? 1)] }),
    unpack: (r, ctx) => ({ item: idOf(ctx, "items", (r.args as number[] | undefined)?.[0]), quantity: (r.args as number[] | undefined)?.[1] }),
  },

  // ---- Pokémon
  {
    id: "give_pokemon", verb: "givepoke", label: "Give Pokémon", category: "Pokémon", help: "Adds a Pokémon to the party (or the PC box).",
    params: [{ key: "species", label: "Pokémon", type: "species", default: "CHIKORITA" }, { key: "level", label: "Level", type: "number", default: 5, min: 1, max: 100 }],
    describe: (a) => `Give ${nice(a.species)} Lv ${s(a.level)}`,
    pack: (a, ctx) => ({ species: numberOf(ctx, "pokemon", a.species), level: Number(a.level ?? 5), item: 0, trainer: 0 }),
    unpack: (r, ctx) => (r.item || r.trainer ? null : { species: idOf(ctx, "pokemon", r.species), level: r.level }),
  },
  {
    id: "play_cry", verb: "cry", label: "Play cry", category: "Pokémon", help: "Plays a Pokémon's cry.",
    params: [{ key: "species", label: "Pokémon", type: "species", default: "CHIKORITA" }], describe: (a) => `Cry of ${nice(a.species)}`,
    pack: (a, ctx) => ({ id: numberOf(ctx, "pokemon", a.species) }),
    unpack: (r, ctx) => ({ species: idOf(ctx, "pokemon", r.id) }),
  },

  // ---- Movement & time
  { id: "face_player", verb: "faceplayer", label: "Face the player", category: "Movement", help: "The person who was talked to turns to the player.", params: [], describe: () => "Face the player" },
  { id: "wait", verb: "pause", label: "Wait", category: "Movement", help: "Pauses (60 frames = 1 second).", params: [{ key: "frames", label: "Frames", type: "number", default: 30, min: 1, max: 255 }], describe: (a) => `Wait ${s(a.frames)} frames` },
];

export const GEN2_EVENTS: EventSpec = {
  registry: "",
  inline: true,
  categories: ["Message", "Flags", "Conditions", "Items", "Pokémon", "Movement"],
  commands,
  choiceVerb: "",
  stopVerb: "end",
  compile: (blocks, ctx) => compile(blocks, ctx),
  preset: (rows) => presetOf(rows as unknown as Row[]),
  parse: (rows, ctx) => parse(rows as unknown as Row[], ctx),
};

// a script one of the Roles writes (src/ui/roles2.ts): one line of text, a
// std script (nurse, bookshelf …), a shop
export function presetOf(rows: Row[]): boolean {
  if (rows.length === 1 && ["jumptextfaceplayer", "jumptext", "jumpstd"].includes(rows[0].op)) return true;
  return rows.some((r) => r.op === "pokemart") && rows.every((r) => ["faceplayer", "opentext", "pokemart", "closetext", "end"].includes(r.op));
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
      out.push({ op: b.not ? "iffalse" : "iftrue", script: emit(b.then, rest, ctx) });
      return [...out, ...emit(b.else ?? [], rest, ctx)];
    }
    // Choice / follow / labels are not offered for Gold
  }
  return [...out, ...tail];
}

export function compile(blocks: Block[], ctx: GameContext): EventRow[] {
  const rows = emit(blocks, END, ctx);
  // the text box opens once, after the person turned to the player
  let at = 0;
  while (rows[at]?.op === "faceplayer") at++;
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
    if (r.op === "closetext" && (!next || next.op === "end")) continue;
    // a condition: [writetext q, yesorno] or a check, then iftrue/iffalse
    let cond: EventRow | null = null;
    let j = i;
    if (r.op === "writetext" && next?.op === "yesorno") {
      cond = ["yesorno", r.text];
      j = i + 2;
    } else if (CHECKS.has(r.op)) {
      cond = blockRow(r, ctx);
      j = i + 1;
    }
    const branch = rows[j];
    const script = branch?.script as Row[] | undefined;
    if ((branch?.op === "iftrue" || branch?.op === "iffalse") && Array.isArray(script) && (cond || j === i) && (endsWith(script, tail) || endsWith(script, END))) {
      const not = branch.op === "iffalse";
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
      out.push({ t: "cmd", row: r.op === "writetext" ? blockRow(r, ctx) : cond });
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

export function parse(input: Row[], ctx: GameContext): Block[] {
  const rows = [...input];
  // the opentext compile() puts after the leading faceplayer
  let at = 0;
  while (rows[at]?.op === "faceplayer") at++;
  if (rows[at]?.op === "opentext") rows.splice(at, 1);
  return endsWith(rows, END) ? parseList(rows.slice(0, -END.length), END, ctx) : parseList(rows, [], ctx);
}
