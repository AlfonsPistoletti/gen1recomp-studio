// Gold's Game Corner prize counters in the studio: a person or sign (Celadon's
// counters are signs behind the desk) whose script is a counter (src/games/gen2/prizes.ts reads and writes the rows). The game's
// counters keep their key until the first edit, which writes the clerk's own
// rows with copies of the game's texts (STUDIO_EVENT_*, so rewording one
// changes this counter only). Used by the Shop-like "Prize counter" role
// (roles2.ts) and Global > Game Corner prizes.

import { newEventText, syncEventTexts } from "../core/inlineEvents.ts";
import { store } from "../core/store.ts";
import type { EntityRecord } from "../core/types.ts";
import { gameScriptRows } from "../games/gen2/events.ts";
import { counterOf, counterRows, GOLD_COINS_MAX, GOLD_PRIZES_MAX, PRIZE_TEXTS, type GoldCounter, type PrizeText } from "../games/gen2/prizes.ts";
import type { Prize } from "../games/types.ts";
import { prizeEditor } from "./prizeEditor.ts";

type Row = Record<string, unknown> & { op: string };

const LAYERS = ["objects", "bgEvents"];
const OWN_TEXT = "STUDIO_EVENT_";
const scripts = () => (store.ctx.data.extra as { scripts?: Record<string, unknown> }).scripts ?? {};

// a counter's words when the game has none to copy
const DEFAULT_TEXTS: Record<PrizeText, string> = {
  hello: "Welcome!\fWe exchange your\ncoins for fabulous\vprizes!{DONE}",
  which: "Which prize would\nyou like?{DONE}",
  confirm: "{STRBUF}.\nIs that right?{DONE}",
  here: "Here you go!{DONE}",
  poor: "Sorry! You need\nmore coins.{DONE}",
  full: "Sorry. You can't\ncarry any more.{DONE}",
  bye: "OK. Please save\nyour coins and\vcome again!{DONE}",
  noCase: "Oh? You don't have\na COIN CASE.{DONE}",
};

// what the person runs, its jumps followed
const rowsOf = (e: EntityRecord | undefined): Row[] | null =>
  !e ? null : Array.isArray(e.scriptKey) ? (e.scriptKey as Row[]) : typeof e.scriptKey === "string" ? (gameScriptRows(scripts(), e.scriptKey) as Row[] | null) : null;

export function counterOfEntity(e: EntityRecord | undefined): GoldCounter | null {
  const rows = rowsOf(e);
  return rows ? counterOf(rows, store.ctx) : null;
}

export interface CounterPlace { mapId: string; layer: string; index: number; counter: GoldCounter; game: boolean }

// every person or sign on the maps that is a prize counter
export function goldCounters(): CounterPlace[] {
  const out: CounterPlace[] = [];
  for (const [mapId, map] of Object.entries(store.maps)) {
    if (!map) continue;
    for (const layer of LAYERS) {
      store.entities(map, layer).forEach((e, index) => {
        const counter = counterOfEntity(e);
        if (counter) out.push({ mapId, layer, index, counter, game: typeof e.scriptKey === "string" });
      });
    }
  }
  return out;
}

// The counter's texts as the mod's own: game keys get new keys, and `words`
// what to put in them once rows use them (syncEventTexts creates them blank).
function ownTexts(texts: GoldCounter["texts"]): { texts: GoldCounter["texts"]; words: Map<string, string> } {
  const all = store.table("text");
  const out: GoldCounter["texts"] = {};
  const words = new Map<string, string>();
  for (const slot of PRIZE_TEXTS) {
    const key = texts[slot];
    if (key?.startsWith(OWN_TEXT)) {
      out[slot] = key;
      continue;
    }
    const copy = newEventText();
    words.set(copy, key && typeof all[key] === "string" ? (all[key] as string) : DEFAULT_TEXTS[slot]);
    out[slot] = copy;
  }
  return { texts: out, words };
}

// after the rows are written: the new texts exist, with their words
function settle(words: Map<string, string>): void {
  syncEventTexts();
  for (const [key, w] of words) store.follow("text", key, w);
}

// Makes the person a new counter: three balls, and the words of the game's first counter
export function makeCounter(write: (rows: Row[]) => void): void {
  const model = goldCounters().find((c) => c.game)?.counter.texts ?? {};
  const prizes: Prize[] = [
    { item: "POKE_BALL", cost: 50 },
    { item: "GREAT_BALL", cost: 150 },
    { item: "ULTRA_BALL", cost: 300 },
  ];
  const own = ownTexts(model);
  write(counterRows({ prizes, texts: own.texts }, store.ctx));
  settle(own.words);
}

// the base script, when it is one of the game's counters (people by their index, signs by place)
const baseKey = (mapId: string, layer: string, index: number, e: EntityRecord): string | undefined => {
  const base = store.base[mapId];
  const list = base ? store.entities(base, layer) : [];
  const b = layer === "objects" ? list.find((x) => x.index === e.index) : list[index];
  return typeof b?.scriptKey === "string" && counterOfEntity(b) ? b.scriptKey : undefined;
};

export function goldPrizeEditor(mapId: string, layer: string, index: number): HTMLElement | null {
  const map = store.maps[mapId];
  const e = map ? store.entities(map, layer)[index] : undefined;
  const counter = counterOfEntity(e);
  if (!e || !counter) return null;
  const game = baseKey(mapId, layer, index, e);
  return prizeEditor({
    prizes: counter.prizes,
    maxCoins: GOLD_COINS_MAX,
    count: { min: 1, max: GOLD_PRIZES_MAX },
    edit: (label, mutate) => {
      store.group(label, () => {
        const prizes = counter.prizes.map((p) => ({ ...p }));
        mutate(prizes);
        const own = ownTexts(counter.texts);
        store.edit(mapId, label, (d) => {
          const x = store.entities(d, layer)[index];
          if (x) x.scriptKey = counterRows({ prizes, texts: own.texts }, store.ctx);
        });
        settle(own.words);
      });
      store.seal();
    },
    revert: game && e.scriptKey !== game
      ? {
          label: "Back to the game's counter",
          run: () => {
            store.group("Back to the game's counter", () => {
              store.edit(mapId, "Back to the game's counter", (d) => {
                const x = store.entities(d, layer)[index];
                if (x) x.scriptKey = game;
              });
              syncEventTexts();
            });
            store.seal();
          },
        }
      : undefined,
  });
}
