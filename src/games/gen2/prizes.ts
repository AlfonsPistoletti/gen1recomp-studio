// Gold's Game Corner prize counters. Unlike Gen 1's (a table the engine
// reads), each counter is its clerk's own script (gen1recomp
// src/ui/gen2/PrizeMenu.lua says so: the VM runs the map script): a menu of
// prizes plus CANCEL, then one `ifequal n` branch per prize that checks the
// coins, asks, gives the item or Pokémon, takes the coins and goes back to
// the menu. counterOf reads such rows (the game's, followed through its
// jumps, or the studio's), counterRows writes them the game's way, with the
// menu in a labelled block (sjump { label = "menu" }) the save turns into a
// key of its own so a branch can jump back (scriptKeys.ts).

import type { Prize } from "../types.ts";
import type { GameContext } from "../types.ts";
import { idOf, numberOf, orders, placeIn } from "./events.ts";

type Row = Record<string, unknown> & { op: string };

export const PRIZE_LABEL = "menu";
const BACK = `studio:label:${PRIZE_LABEL}`;
export const GOLD_PRIZES_MAX = 4; // the menu box: 4 prizes and CANCEL, two rows each
export const GOLD_COINS_MAX = 9999;

// what a counter says: hello, which prize, "<prize>. Is that right?", here
// you go, not enough coins, no room, come again, no coin case
export const PRIZE_TEXTS = ["hello", "which", "confirm", "here", "poor", "full", "bye", "noCase"] as const;
export type PrizeText = (typeof PRIZE_TEXTS)[number];

export interface GoldCounter {
  prizes: Prize[];
  texts: Partial<Record<PrizeText, string>>;
}

// prizes as the rows name them (item / species numbers)
interface Shape {
  prizes: { item?: number; species?: number; level?: number; cost: number }[];
  texts: Partial<Record<PrizeText, string>>;
}

const list = (v: unknown): Row[] | null => (Array.isArray(v) ? (v as Row[]) : null);
const coins = (args: unknown) => {
  const a = (Array.isArray(args) ? args : []) as number[];
  return (Number(a[0]) || 0) + (Number(a[1]) || 0) * 256;
};

// The rows' prizes and texts, or null when they are no prize counter.
// `scripts` resolves a called script's text (the game asks through scall).
function shape(rows: Row[], scripts: Record<string, unknown> = {}): Shape | null {
  const textOf = (v: unknown): string | undefined => {
    const l = list(v) ?? (typeof v === "string" ? list(scripts[v]) : null);
    const r = l?.find((x) => x.op === "writetext" || x.op === "scall");
    if (!r) return undefined;
    return r.op === "writetext" ? String(r.text) : textOf(r.script);
  };
  // the menu: in the rows or in a block they jump into
  let at = rows.findIndex((r) => r.op === "loadmenu");
  let menu = rows;
  if (at < 0) {
    const jump = rows.find((r) => r.op === "sjump" && list(r.script)?.some((x) => x.op === "loadmenu"));
    if (!jump) return null;
    menu = jump.script as Row[];
    at = menu.findIndex((r) => r.op === "loadmenu");
  }
  const items = (menu[at].menu as { items?: unknown } | undefined)?.items;
  if (!Array.isArray(items) || menu[at + 1]?.op !== "verticalmenu" || menu[at + 2]?.op !== "closewindow") return null;
  const arms: Row[][] = [];
  let j = at + 3;
  while (menu[j]?.op === "ifequal" && menu[j].value === arms.length + 1 && list(menu[j].script)) arms.push(menu[j++].script as Row[]);
  if (!arms.length || arms.length !== items.length - 1) return null;
  const texts: Shape["texts"] = {};
  const before = menu === rows ? rows.slice(0, at) : rows.slice(0, rows.findIndex((r) => r.op === "sjump"));
  const writes = before.filter((r) => r.op === "writetext");
  texts.hello = writes.length > 1 ? String(writes[0].text) : undefined;
  texts.which = writes.length ? String(writes[writes.length - 1].text) : undefined;
  const caseCheck = before.findIndex((r) => r.op === "checkitem");
  if (caseCheck >= 0 && before[caseCheck + 1]?.op === "iffalse") texts.noCase = textOf(before[caseCheck + 1].script);
  texts.bye = textOf(menu.slice(j));
  const prizes: Shape["prizes"] = [];
  for (const arm of arms) {
    const check = arm.find((r) => r.op === "checkcoins");
    const item = arm.find((r) => r.op === "giveitem");
    const mon = arm.find((r) => r.op === "givepoke");
    if (!check || !arm.some((r) => r.op === "takecoins") || !(item || mon)) return null;
    prizes.push(item ? { item: Number(item.item), cost: coins(check.args) } : { species: Number(mon!.species), level: Number(mon!.level ?? 5), cost: coins(check.args) });
    const poor = arm.find((r) => r.op === "ifequal" && r.value === 2);
    const giveAt = item ? arm.indexOf(item) : -1;
    const full = item ? (arm[giveAt + 1]?.op === "iffalse" ? arm[giveAt + 1] : undefined) : arm.find((r) => r.op === "ifequal" && r.value === 6);
    const ask = arm.findIndex((r) => r.op === "yesorno" || r.op === "scall");
    texts.poor ??= poor && textOf(poor.script);
    texts.full ??= full && textOf(full.script);
    texts.confirm ??= ask < 0 ? undefined : arm[ask].op === "scall" ? textOf(arm[ask].script) : arm[ask - 1]?.op === "writetext" ? String(arm[ask - 1].text) : undefined;
    const sound = arm.findIndex((r) => r.op === "playsound");
    texts.here ??= sound < 0 ? undefined : textOf(arm.slice(sound + 1));
  }
  return { prizes, texts };
}

// prize counter rows (the role box and the Events list leave them to the prize editor)
export const isCounter = (rows: Row[]): boolean => shape(rows) !== null;

export function counterOf(rows: Row[], ctx: GameContext): GoldCounter | null {
  const s = shape(rows, (ctx.data.extra as { scripts?: Record<string, unknown> }).scripts);
  if (!s) return null;
  const prizes = s.prizes.map((p): Prize => (p.item !== undefined ? { item: idOf(ctx, "items", p.item), cost: p.cost } : { species: idOf(ctx, "pokemon", p.species), level: p.level, cost: p.cost }));
  return { prizes, texts: s.texts };
}

// a prize's menu name: the record's (TMs read "TM25")
const nameOf = (ctx: GameContext, p: Prize): string => {
  const reg = p.species ? "pokemon" : "items";
  const id = String(p.species ?? p.item ?? "");
  const rec = (ctx.records[reg] ?? ctx.data.content[reg] ?? {})[id] as { name?: unknown } | undefined;
  return String(rec?.name ?? id).toUpperCase();
};

// The counter as Gold rows. Texts are keys (missing ones are left out).
export function counterRows(c: GoldCounter, ctx: GameContext): Row[] {
  const t = c.texts;
  const say = (key: string | undefined): Row[] => (key ? [{ op: "writetext", text: key }, { op: "waitbutton" }] : []);
  const stop = (key: string | undefined): Row[] => [...say(key), { op: "closetext" }, { op: "end" }];
  const special = (name: string): Row => ({ op: "special", id: placeIn(orders(ctx).specialOrder, name) });
  const word = (n: number) => [n & 255, (n >> 8) & 255];
  const prizes = c.prizes.slice(0, GOLD_PRIZES_MAX);
  // names left, coins right (the game's columns); the box ends on row 11
  const names = prizes.map((p) => nameOf(ctx, p));
  const width = Math.min(16, Math.max(6, ...prizes.map((p, i) => names[i].length + 1 + String(p.cost).length)));
  const labels = prizes.map((p, i) => {
    const cost = String(p.cost);
    const name = names[i].slice(0, width - 1 - cost.length);
    return name + " ".repeat(width - name.length - cost.length) + cost;
  });
  const items = [...labels, "CANCEL"];
  const arms = prizes.map((p, i): Row => {
    const cost = word(Math.max(0, Math.min(GOLD_COINS_MAX, p.cost)));
    const ask: Row[] = [...(t.confirm ? [{ op: "writetext", text: t.confirm }] : []), { op: "yesorno" }, { op: "iffalse", script: stop(t.bye) }];
    const here: Row[] = [{ op: "waitsfx" }, { op: "playsound", id: placeIn(orders(ctx).sfxOrder, "Sfx_Transaction") }, ...say(t.here)];
    const rows: Row[] = p.species
      ? [
          { op: "checkcoins", args: cost }, { op: "ifequal", value: 2, script: stop(t.poor) },
          { op: "readvar", var: 1 }, { op: "ifequal", value: 6, script: stop(t.full) }, // VAR_PARTYCOUNT
          { op: "getmonname", buffer: 0, species: numberOf(ctx, "pokemon", p.species) }, ...ask, ...here,
          { op: "setval", args: [numberOf(ctx, "pokemon", p.species)] }, special("GameCornerPrizeMonCheckDex"),
          { op: "givepoke", species: numberOf(ctx, "pokemon", p.species), level: Math.max(1, Math.min(100, p.level ?? 5)), item: 0, trainer: 0 },
          { op: "takecoins", args: cost }, { op: "sjump", script: BACK },
        ]
      : [
          { op: "checkcoins", args: cost }, { op: "ifequal", value: 2, script: stop(t.poor) },
          { op: "getitemname", buffer: 0, item: numberOf(ctx, "items", p.item) }, ...ask,
          { op: "giveitem", item: numberOf(ctx, "items", p.item), quantity: 1 }, { op: "iffalse", script: stop(t.full) },
          { op: "takecoins", args: cost }, ...here, { op: "sjump", script: BACK },
        ];
    return { op: "ifequal", value: i + 1, script: rows };
  });
  const menu: Row[] = [
    special("DisplayCoinCaseBalance"),
    { op: "loadmenu", menu: { top: 11 - (2 * items.length + 1), left: 0, bottom: 11, right: width + 3, flags: 64, dataFlags: 128, cursor: 1, items } },
    { op: "verticalmenu" },
    { op: "closewindow" },
    ...arms,
    ...stop(t.bye),
  ];
  return [
    { op: "faceplayer" },
    { op: "opentext" },
    ...say(t.hello),
    { op: "checkitem", args: [numberOf(ctx, "items", "COIN_CASE")] },
    { op: "iffalse", script: stop(t.noCase) },
    ...(t.which ? [{ op: "writetext", text: t.which }] : []),
    { op: "sjump", label: PRIZE_LABEL, script: menu },
  ];
}
