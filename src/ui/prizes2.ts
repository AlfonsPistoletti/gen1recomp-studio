// Gold's Game Corner prize counters in the studio: a person or sign (Celadon's
// counters are signs behind the desk) whose script is a counter (src/games/gen2/prizes.ts reads and writes the rows). The game's
// counters keep their key until the first edit, which writes the clerk's own
// rows with copies of the game's texts (STUDIO_EVENT_*, so rewording one
// changes this counter only). Used by the Shop-like "Prize counter" role
// (roles2.ts) and Global > Game Corner prizes. Coin sellers (the game's
// GameCornerCoinVendorScript) work the same way: role "Coin seller".

import { newEventText, syncEventTexts } from "../core/inlineEvents.ts";
import { store } from "../core/store.ts";
import type { EntityRecord } from "../core/types.ts";
import { gameScriptRows } from "../games/gen2/events.ts";
import { counterOf, counterRows, GOLD_COINS_MAX, GOLD_MONEY_MAX, GOLD_OFFERS_MAX, GOLD_PRIZES_MAX, PRIZE_TEXTS, SELLER_TEXTS, sellerOf, sellerRows, type CoinOffer, type GoldCoinSeller, type GoldCounter, type PrizeText, type SellerText } from "../games/gen2/prizes.ts";
import type { Prize } from "../games/types.ts";
import { h, numberInput } from "./dom.ts";
import { prizeEditor } from "./prizeEditor.ts";
import { textEditor } from "./textField.ts";

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

// a coin seller's words when the game has none to copy
const SELLER_DEFAULTS: Record<SellerText, string> = {
  hello: "Welcome to the\nGAME CORNER.{DONE}",
  noCase: "Oh? You don't have\na COIN CASE.{DONE}",
  which: "Do you need game\ncoins?{DONE}",
  full: "Whoops! Your COIN\nCASE is full.{DONE}",
  poor: "You don't have\nenough money.{DONE}",
  here: "Thank you!\nHere are your coins.{DONE}",
  bye: "No coins for you?\nCome play sometime!{DONE}",
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

// The texts as the mod's own: game keys get new keys, and `words` what to put
// in them once rows use them (syncEventTexts creates them blank).
function ownTexts<K extends string>(texts: Partial<Record<K, string>>, slots: readonly K[], defaults: Record<K, string>): { texts: Partial<Record<K, string>>; words: Map<string, string> } {
  const all = store.table("text");
  const out: Partial<Record<K, string>> = {};
  const words = new Map<string, string>();
  for (const slot of slots) {
    const key = texts[slot];
    if (key?.startsWith(OWN_TEXT)) {
      out[slot] = key;
      continue;
    }
    const copy = newEventText();
    words.set(copy, key && typeof all[key] === "string" ? (all[key] as string) : defaults[slot]);
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
  const own = ownTexts(model, PRIZE_TEXTS, DEFAULT_TEXTS);
  write(counterRows({ prizes, texts: own.texts }, store.ctx));
  settle(own.words);
}

// the base script, when it plays the same part in the game (people by their index, signs by place)
const baseKey = (mapId: string, layer: string, index: number, e: EntityRecord, is: (b: EntityRecord) => boolean = (b) => !!counterOfEntity(b)): string | undefined => {
  const base = store.base[mapId];
  const list = base ? store.entities(base, layer) : [];
  const b = layer === "objects" ? list.find((x) => x.index === e.index) : list[index];
  return typeof b?.scriptKey === "string" && is(b) ? b.scriptKey : undefined;
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
        const own = ownTexts(counter.texts, PRIZE_TEXTS, DEFAULT_TEXTS);
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

// ------------------------------------------------------------- coin sellers

export function sellerOfEntity(e: EntityRecord | undefined): GoldCoinSeller | null {
  const rows = rowsOf(e);
  return rows ? sellerOf(rows, scripts(), (k) => gameScriptRows(scripts(), k) as Row[] | null) : null;
}

export interface SellerPlace { mapId: string; layer: string; index: number; seller: GoldCoinSeller; game: boolean }

export function goldSellers(): SellerPlace[] {
  const out: SellerPlace[] = [];
  for (const [mapId, map] of Object.entries(store.maps)) {
    if (!map) continue;
    store.entities(map, "objects").forEach((e, index) => {
      const seller = sellerOfEntity(e);
      if (seller) out.push({ mapId, layer: "objects", index, seller, game: typeof e.scriptKey === "string" });
    });
  }
  return out;
}

// Makes the person a new seller: the game's packs and words
export function makeSeller(write: (rows: Row[]) => void): void {
  const model = goldSellers().find((c) => c.game)?.seller;
  const offers: CoinOffer[] = model?.offers.map((o) => ({ ...o })) ?? [{ coins: 50, price: 1000 }, { coins: 500, price: 10000 }];
  const own = ownTexts(model?.texts ?? {}, SELLER_TEXTS, SELLER_DEFAULTS);
  write(sellerRows({ offers, texts: own.texts }, store.ctx));
  settle(own.words);
}

// coins for money, one row per pack (up to four: the menu box), and the way back
export function coinSellerEditor(mapId: string, layer: string, index: number): HTMLElement | null {
  const map = store.maps[mapId];
  const e = map ? store.entities(map, layer)[index] : undefined;
  const seller = sellerOfEntity(e);
  if (!e || !seller) return null;
  const game = baseKey(mapId, layer, index, e, (b) => !!sellerOfEntity(b));
  const edit = (label: string, mutate: (offers: CoinOffer[]) => void) => {
    store.group(label, () => {
      const offers = seller.offers.map((o) => ({ ...o }));
      mutate(offers);
      const own = ownTexts(seller.texts, SELLER_TEXTS, SELLER_DEFAULTS);
      store.edit(mapId, label, (d) => {
        const x = store.entities(d, layer)[index];
        if (x) x.scriptKey = sellerRows({ offers, texts: own.texts }, store.ctx);
      });
      settle(own.words);
    });
    store.seal();
  };
  const rows = seller.offers.map((o, i) =>
    h("div", { class: "row nowrap" },
      numberInput(o.coins, (v) => edit("Coins in a pack", (l) => (l[i].coins = Math.max(1, Math.min(GOLD_COINS_MAX, v)))), 1, GOLD_COINS_MAX),
      h("span", { class: "muted" }, "coins for \u00a5"),
      numberInput(o.price, (v) => edit("Price of a pack", (l) => (l[i].price = Math.max(0, Math.min(GOLD_MONEY_MAX, v)))), 0, GOLD_MONEY_MAX),
      seller.offers.length > 1 ? h("button", { class: "btn small ghost", title: "Remove this pack", onclick: () => edit("Remove coin pack", (l) => l.splice(i, 1)) }, "\u2715") : null));
  const back = () => {
    store.group("Back to the game's seller", () => {
      store.edit(mapId, "Back to the game's seller", (d) => {
        const x = store.entities(d, layer)[index];
        if (x) x.scriptKey = game;
      });
      syncEventTexts();
    });
    store.seal();
  };
  // the game's question names its prices: reworded here once the texts are the mod's
  const which = seller.texts.which;
  const offer = which?.startsWith(OWN_TEXT)
    ? textEditor(which, { rows: 3, compact: true, label: "What it asks (it names the prices)" })
    : h("p", { class: "hint" }, "Its question names the game's prices: once a pack changes, the texts are your mod's and the question can be reworded here.");
  return h("div", { class: "prize-counter" },
    ...rows,
    seller.offers.length < GOLD_OFFERS_MAX ? h("button", { class: "btn small ghost", onclick: () => edit("Add coin pack", (l) => l.push({ coins: 100, price: 2000 })) }, "+ Pack") : null,
    game && e.scriptKey !== game ? h("button", { class: "btn small danger", onclick: back }, "Back to the game's seller") : null,
    offer);
}
