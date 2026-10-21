// Gen 2 phone calls of a contact's own, and gifts by phone (Global > Phone
// contacts). Crystal's Gina, Alan, Dana … sometimes call to say they found an
// item: the call sets a flag (an engine flag there), and talking to them on
// their route checks it, hands the item over (verbosegiveitem) and clears it.
// The studio writes the same pair for any contact, with an event flag:
//   the contact's call       random N; ifequal 0 [setevent F; writetext T; end]
//   the person who gave the  checkevent F; iftrue [writetext T2; waitbutton;
//   number (after battle)      verbosegiveitem item; iffalse [full…]; clearevent F; closetext; end]
// Both are inline events (phone call / the trainer's after-battle talk).

import { newEventText, writeInline } from "../core/inlineEvents.ts";
import { clone } from "../core/merge.ts";
import { store } from "../core/store.ts";
import type { EntityRecord } from "../core/types.ts";
import type { EventRow } from "../games/types.ts";

type Row = Record<string, unknown>;

const gameRows = (key: string) => (store.adapter.events?.gameRows?.(store.ctx, key) as unknown as Row[] | null) ?? null;
const scripts = () => (store.ctx.data.extra as { scripts?: Record<string, unknown> }).scripts ?? {};

// The game's call `key` as rows of the contact's own: every line a new text
// with the same words (so editing it changes this contact only), and called
// scripts spliced in with each of their ends replaced by the rest of the call
// (what the scall came back to), the shape events compile to. `copies`:
// original text key -> new key (their words are set once the rows are written).
export function copyCall(key: string): { rows: Row[]; copies: Map<string, string> } | null {
  const rows = gameRows(key);
  if (!rows?.length) return null;
  const texts = store.table("text");
  const copies = new Map<string, string>();
  const own = (v: unknown): unknown => {
    if (typeof v === "string" && typeof texts[v] === "string") {
      if (!copies.has(v)) copies.set(v, newEventText());
      return copies.get(v);
    }
    return v;
  };
  const withTail = (list: Row[], rest: Row[]): Row[] => {
    const out: Row[] = [];
    for (const r of list) {
      if (r.op === "end") return [...out, ...structuredClone(rest)];
      out.push(Array.isArray(r.script) ? { ...r, script: withTail(r.script as Row[], rest) } : r);
    }
    return [...out, ...structuredClone(rest)];
  };
  // rows in a list and its branches, and its endings
  const size = (list: Row[]): { rows: number; ends: number } => {
    const n = { rows: 0, ends: 0 };
    for (const r of list) {
      const sub = Array.isArray(r.script) ? size(r.script as Row[]) : { rows: 0, ends: 0 };
      n.rows += 1 + sub.rows;
      n.ends += (r.op === "end" ? 1 : 0) + sub.ends;
    }
    return n;
  };
  const copyList = (list: Row[], depth: number): Row[] => {
    const out: Row[] = [];
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      const called = (r.op === "scall" || r.op === "farscall") && typeof r.script === "string" && depth < 6 ? gameRows(r.script) : null;
      if (called) {
        const body = copyList(called, depth + 1);
        const rest = list.slice(i + 1);
        // the rest copied onto every ending: only while that stays small (Crystal's
        // greetings end once per caller type, 9 times; spliced into each other they
        // would multiply), else the call keeps its own rows as a list (Vm runList takes one).
        // Measured on the rows as they are: copying them twice doubles per call.
        if (Math.max(1, size(body).ends) * size(rest).rows <= 120) return [...out, ...withTail(body, copyList(rest, depth))];
        out.push({ ...r, script: body });
        continue;
      }
      out.push(Object.fromEntries(Object.entries(r).map(([k, x]) => [k, k === "script" && Array.isArray(x) ? copyList(x as Row[], depth) : own(x)])));
    }
    return out;
  };
  return { rows: copyList(rows, 0), copies };
}

// the words of copied texts, joined to the last undo step
export function followCopies(copies: Map<string, string>): void {
  const texts = store.table("text");
  for (const [from, to] of copies) store.follow("text", to, texts[from]);
}

// ------------------------------------------------------------------ gifts

export interface PhoneGift {
  kind: "studio" | "game";
  flag: number;
  item?: string; // item id (the one handed over)
  chance?: number; // studio: 1 in this many calls
  callText?: string; // studio: what the call says
  handText?: string; // studio: what the person says handing it over
}

const PREFIX_OPS = ["endifjustbattled", "faceplayer", "opentext"];
const itemId = (n: unknown) => Object.entries(store.table("items") as Record<string, { index?: number }>).find(([, r]) => r.index === Number(n))?.[0];
const itemNo = (id: string) => (store.table("items")[id] as { index?: number } | undefined)?.index ?? 0;

// the person the contact stands for: the trainer whose script asks for the number
export interface Giver {
  map: string;
  list: number; // place in the map's objects
  object: EntityRecord;
  eventId: string; // its after-battle (or talk) inline event
  field: "after" | "talk";
}

export function giverOf(at: { map: string; index: number } | undefined): Giver | null {
  const map = at ? store.maps[at.map] : undefined;
  const o = map ? store.entities(map, "objects")[at!.index] : undefined;
  if (!at || !o) return null;
  const after = !!(o.trainer && typeof o.trainer === "object");
  return { map: at.map, list: at.index, object: o, eventId: `${at.map}:${after ? "after" : "talk"}:obj${String(o.index)}`, field: after ? "after" : "talk" };
}

const giverScript = (g: Giver): unknown => (g.field === "after" ? (g.object.trainer as { scriptKey?: unknown }).scriptKey : g.object.scriptKey);

// every row of a script and its branches; `keys`: also into the game's scripts
// it names (reading only: those are the game's data)
function walk(body: unknown, visit: (r: Row, list: Row[], i: number) => void, keys = true, seen = new Set<string>()): void {
  const list = typeof body === "string" ? (!keys || seen.has(body) ? null : (seen.add(body), scripts()[body])) : body;
  if (!Array.isArray(list)) return;
  (list as Row[]).forEach((r, i) => {
    visit(r, list as Row[], i);
    if (typeof r.script === "string" || Array.isArray(r.script)) walk(r.script, visit, keys, seen);
  });
}

// what the person hands over once flag F is set (the branch after its check)
function handOver(body: unknown, flag: number, op: "checkevent" | "checkflag"): { item?: string; text?: string } | null {
  let found: { item?: string; text?: string } | null = null;
  walk(body, (r, list, i) => {
    if (found || r.op !== op || Number(op === "checkevent" ? r.event : r.flag) !== flag) return;
    const br = list[i + 1];
    if (!br || br.op !== "iftrue") return;
    const out: { item?: string; text?: string } = {};
    walk(br.script, (x) => {
      if (out.item === undefined && x.op === "verbosegiveitem") out.item = itemId(x.item);
      if (out.text === undefined && (x.op === "writetext" || x.op === "farwritetext") && typeof x.text === "string") out.text = x.text;
    });
    found = out;
  });
  return found;
}

// A contact's gift: the studio's (an own call starting with the gift branch)
// or the game's (Crystal: the call sets an engine flag the person checks)
export function giftOf(callerKey: unknown, g: Giver | null): PhoneGift | null {
  if (Array.isArray(callerKey)) {
    const rows = callerKey as Row[];
    const at = rows.findIndex((r, i) => r.op === "random" && rows[i + 1]?.op === "ifequal" && rows[i + 1].value === 0 && Array.isArray(rows[i + 1].script) && (rows[i + 1].script as Row[])[0]?.op === "setevent");
    if (at >= 0) {
      const branch = rows[at + 1].script as Row[];
      const flag = Number(branch[0].event);
      const hand = g ? handOver(giverScript(g), flag, "checkevent") : null;
      return { kind: "studio", flag, chance: Number((rows[at].args as number[] | undefined)?.[0] ?? 2), callText: branch.find((r) => r.op === "writetext")?.text as string | undefined, item: hand?.item, handText: hand?.text };
    }
  }
  if (!g) return null;
  // the game's: an engine flag the call sets and the person checks
  const flags = new Set<number>();
  walk(callerKey, (r) => r.op === "setflag" && flags.add(Number(r.flag)));
  for (const flag of flags) {
    const hand = handOver(giverScript(g), flag, "checkflag");
    if (hand?.item) return { kind: "game", flag, item: hand.item };
  }
  return null;
}

// the person's script as rows of its own (a copy of the game's when it still has its key)
function giverRows(g: Giver): { rows: Row[]; copies: Map<string, string> } {
  const s = giverScript(g);
  if (Array.isArray(s)) return { rows: clone(s) as Row[], copies: new Map() };
  return typeof s === "string" ? (copyGame(s) ?? { rows: [], copies: new Map() }) : { rows: [], copies: new Map() };
}

// a person's game script copied (texts stay the game's: the person keeps its words)
function copyGame(key: string): { rows: Row[]; copies: Map<string, string> } | null {
  const rows = gameRows(key);
  return rows ? { rows: clone(rows), copies: new Map() } : null;
}

const itemName = (id: string) => String((store.table("items")[id] as { name?: unknown } | undefined)?.name ?? id.replace(/_/g, " "));

// Gives `item` by phone: the call's branch and the person's hand-over, one undo step
export function addGift(contactId: string, registry: string, g: Giver, item: string, chance: number, flag: number): void {
  const contact = store.table(registry)[contactId] as Row;
  const place = String(store.maps[g.map]?.id ?? g.map).replace(/_/g, " ");
  store.group("Gift by phone", () => {
    // the call: its own rows (a copy of the game's), the gift branch first
    const own = Array.isArray(contact.callerKey) ? { rows: clone(contact.callerKey) as Row[], copies: new Map<string, string>() } : copyCall(String(contact.callerKey ?? ""));
    if (!own) return;
    const callText = newEventText();
    const call = [{ op: "random", args: [chance] }, { op: "ifequal", value: 0, script: [{ op: "setevent", event: flag }, { op: "writetext", text: callText }, { op: "end" }] }, ...own.rows];
    writeInline(`PHONE:caller:${contactId}`, "Gift by phone", { rows: call as unknown as EventRow[] });
    followCopies(own.copies);
    // lines of at most 18 letters (the text box); item names fit 12
    store.follow("text", callText, `Hi, {PLAYER}!\nI found something!\fA ${itemName(item)}!\nCome get it at\f${place}!{DONE}`);
    // the person: check the flag first thing (after it turned and opened the text box)
    const { rows } = giverRows(g);
    let at = 0;
    while (PREFIX_OPS.includes(String(rows[at]?.op))) at++;
    const opened = rows.slice(0, at).some((r) => r.op === "opentext");
    const handText = newEventText();
    const fullText = newEventText();
    const branch: Row[] = [
      ...(opened ? [] : [{ op: "opentext" }]),
      { op: "writetext", text: handText }, { op: "waitbutton" },
      { op: "verbosegiveitem", item: itemNo(item), quantity: 1 },
      { op: "iffalse", script: [{ op: "writetext", text: fullText }, { op: "waitbutton" }, { op: "closetext" }, { op: "end" }] },
      { op: "clearevent", event: flag }, { op: "closetext" }, { op: "end" },
    ];
    rows.splice(at, 0, { op: "checkevent", event: flag }, { op: "iftrue", script: branch });
    writeInline(g.eventId, "Gift by phone", { rows: rows as unknown as EventRow[] });
    store.follow("text", handText, `Here you go!\nThe ${itemName(item)}!{DONE}`);
    store.follow("text", fullText, `Your PACK is full?\nCome back later!{DONE}`);
  });
  store.seal();
}

// Takes a studio gift out again (both halves); the call and the person keep the rest
export function removeGift(contactId: string, registry: string, g: Giver | null, flag: number): void {
  const contact = store.table(registry)[contactId] as Row;
  store.group("No gift by phone", () => {
    if (Array.isArray(contact.callerKey)) {
      const rows = (clone(contact.callerKey) as Row[]).filter((r, i, all) => !(r.op === "random" && (all[i + 1]?.script as Row[] | undefined)?.[0]?.event === flag) && !(r.op === "ifequal" && (r.script as Row[] | undefined)?.[0]?.event === flag));
      writeInline(`PHONE:caller:${contactId}`, "No gift by phone", { rows: rows as unknown as EventRow[] });
    }
    const s = g ? giverScript(g) : undefined;
    if (g && Array.isArray(s)) {
      const rows = (clone(s) as Row[]).filter((r, i, all) => !(r.op === "checkevent" && r.event === flag && all[i + 1]?.op === "iftrue") && !(r.op === "iftrue" && all[i - 1]?.op === "checkevent" && all[i - 1].event === flag));
      // nothing else changed: the game's script again
      const base = giverOf({ map: g.map, index: g.list }) && store.base[g.map] ? store.entities(store.base[g.map]!, "objects").find((o) => o.index === g.object.index) : undefined;
      const baseKey = base ? (g.field === "after" ? (base.trainer as { scriptKey?: unknown } | undefined)?.scriptKey : base.scriptKey) : undefined;
      const same = typeof baseKey === "string" && JSON.stringify(gameRows(baseKey)) === JSON.stringify(rows);
      writeInline(g.eventId, "No gift by phone", same ? undefined : { rows: rows as unknown as EventRow[] });
    }
  });
  store.seal();
}

// The item handed over: changes the verbosegiveitem in the person's branch for
// flag F (a game gift's person gets a copy of its script first)
export function setGiftItem(g: Giver, gift: PhoneGift, item: string): void {
  const { rows } = giverRows(g);
  const op = gift.kind === "game" ? "checkflag" : "checkevent";
  let done = false;
  walk(rows, (r, list, i) => {
    if (done || r.op !== op || Number(op === "checkevent" ? r.event : r.flag) !== gift.flag || list[i + 1]?.op !== "iftrue") return;
    const br = list[i + 1];
    if (!Array.isArray(br.script)) return;
    walk(br.script, (x) => {
      if (!done && x.op === "verbosegiveitem") {
        x.item = itemNo(item);
        done = true;
      }
    }, false);
  }, false);
  if (!done) return;
  writeInline(g.eventId, "Gift item", { rows: rows as unknown as EventRow[] });
}

// How often the call brings the gift (1 in n)
export function setGiftChance(contactId: string, registry: string, flag: number, n: number): void {
  const contact = store.table(registry)[contactId] as Row;
  if (!Array.isArray(contact.callerKey)) return;
  const rows = clone(contact.callerKey) as Row[];
  const at = rows.findIndex((r, i) => r.op === "random" && (rows[i + 1]?.script as Row[] | undefined)?.[0]?.event === flag);
  if (at < 0) return;
  rows[at] = { ...rows[at], args: [Math.max(1, Math.min(255, n))] };
  writeInline(`PHONE:caller:${contactId}`, "Gift chance", { rows: rows as unknown as EventRow[] });
}
