// In-game trades (Global > In-game trades): field.trades, the list an NPC's
// `trade <n> <flag>` event row indexes (1-based; gen1recomp
// src/script/Commands.lua Commands.trade). Each trade: the Pokémon the NPC
// wants (`give`), the one the player gets (`get`) with its nickname, and the
// dialogue family (`dialogset` 1-3: the _WannaTrade<N>Text ... texts).
// field is a deep registry: a changed trade overrides the whole list, added
// trades are appended.

import { store } from "../core/store.ts";
import { clone } from "../core/merge.ts";
import { gameEvents } from "../project/gameEvents.ts";
import { field, h, toast } from "./dom.ts";
import { nav } from "./nav.ts";

export const TRADES_REGISTRY = "field";
export const TRADES_ID = "trades";
const NICK_MAX = 10;

export interface Trade {
  give: string;
  get: string;
  nickname: string;
  dialogset?: number;
  [extra: string]: unknown;
}

export function trades(): Trade[] {
  const t = store.table(TRADES_REGISTRY)[TRADES_ID];
  return Array.isArray(t) ? (t as Trade[]) : [];
}

function baseCount(): number {
  const t = store.baseTable(TRADES_REGISTRY)[TRADES_ID];
  return Array.isArray(t) ? t.length : 0;
}

export function tradesEdited(): boolean {
  return store.isRecordEdited(TRADES_REGISTRY, TRADES_ID);
}

function editTrades(label: string, mutate: (list: Trade[]) => void): void {
  store.editRecord<Trade[]>(TRADES_REGISTRY, TRADES_ID, label, mutate, { create: () => [] });
  store.seal();
}

const speciesName = (id: string) => String((store.table("pokemon")[id] as { name?: unknown } | undefined)?.name ?? id);

// species ids in Pokédex order
function speciesIds(): string[] {
  const all = store.table("pokemon") as Record<string, { dex?: number }>;
  return Object.keys(all).sort((a, b) => (all[a]?.dex ?? 999) - (all[b]?.dex ?? 999) || a.localeCompare(b));
}

export function tradeLabel(i: number): string {
  const t = trades()[i - 1];
  return t ? `#${i} ${speciesName(t.give)} → ${speciesName(t.get)} (${t.nickname})` : `#${i} (no such trade)`;
}

// Who offers each trade: the game's own NPCs (checkout) and studio events.
// trade index -> ["MAP · TEXT_ID", open]
type Offer = { label: string; open: () => void };
let offersCache: Promise<Map<number, Offer[]>> | null = null;
let offersVersion = "";

function offers(): Promise<Map<number, Offer[]>> {
  const p = store.project;
  if (!offersCache || offersVersion !== p.version) {
    offersVersion = p.version;
    offersCache = (async () => {
      const out = new Map<number, Offer[]>();
      const add = (n: unknown, o: Offer) => {
        if (typeof n !== "number") return;
        out.set(n, [...(out.get(n) ?? []), o]);
      };
      const game = await gameEvents(p.host, p.version).catch(() => null);
      for (const [mapId, ev] of Object.entries(game ?? {})) {
        for (const [key, rows] of Object.entries(ev.talk ?? {})) {
          if (!Array.isArray(rows)) continue;
          for (const r of rows) if (Array.isArray(r) && r[0] === "trade") add(r[1], { label: `${mapId} · ${key}`, open: () => nav.openEvent(`game:${mapId}:talk:${key}`) });
        }
      }
      return out;
    })();
  }
  return offersCache;
}

// studio events that run a trade (live, not cached)
function studioOffers(n: number): Offer[] {
  const out: Offer[] = [];
  for (const [id, ev] of Object.entries(store.table("studio_events"))) {
    const rows = (ev as { rows?: unknown[] })?.rows ?? [];
    const has = (list: unknown[]): boolean => list.some((r) => Array.isArray(r) && (r[0] === "trade" ? r[1] === n : r.some((x) => Array.isArray(x) && has(x))));
    if (has(rows)) out.push({ label: id.replace(/:talk:|:step:|:enter:/, " · "), open: () => nav.openEvent(id) });
  }
  return out;
}

function speciesSelect(value: string, onChange: (v: string) => void, disabled: boolean): HTMLSelectElement {
  const sel = h("select", { disabled }, ...speciesIds().map((id) => h("option", { value: id, selected: id === value }, speciesName(id))));
  sel.addEventListener("change", () => onChange(sel.value));
  return sel;
}

// the dialogue family's offer, with this trade's Pokémon filled in
function offerText(t: Trade): string {
  const raw = String(store.table("text")[`_WannaTrade${t.dialogset ?? 1}Text`] ?? "");
  return raw
    .replace(/\{RAM:wInGameTradeGiveMonName\}/g, speciesName(t.give))
    .replace(/\{RAM:wInGameTradeReceiveMonName\}/g, speciesName(t.get))
    .replace(/\{[A-Z_]+\}/g, "")
    .replace(/[\n\v\f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tradeCards(): HTMLElement[] {
  const list = trades();
  const base = baseCount();
  const cards = list.map((t, i) => {
    const n = i + 1;
    const who = h("div", { class: "row wrap" }, h("span", { class: "hint" }, "Looking for who offers it…"));
    void offers().then((m) => {
      const all = [...(m.get(n) ?? []), ...studioOffers(n)];
      who.replaceChildren(
        all.length
          ? h("span", { class: "hint" }, "Offered by:")
          : h("span", { class: "hint" }, n > base ? "No NPC offers it yet: add the Trade command to an NPC's event (Events)." : "Offered by an NPC of the game."),
        ...all.map((o) => h("button", { class: "btn small ghost", onclick: o.open }, o.label)),
      );
    });
    const nick = h("input", { type: "text", value: t.nickname, maxLength: NICK_MAX, spellcheck: false });
    nick.addEventListener("change", () => {
      const v = nick.value.trim().toUpperCase().slice(0, NICK_MAX);
      if (!v) return toast("The traded Pokémon needs a nickname", "error");
      editTrades(`Trade #${n}: nickname`, (l) => (l[i].nickname = v));
    });
    const style = h("select", {},
      ...[1, 2, 3].map((d) => h("option", { value: String(d), selected: (t.dialogset ?? 1) === d }, `Dialogue ${d}`)),
    );
    style.addEventListener("change", () => editTrades(`Trade #${n}: dialogue`, (l) => (l[i].dialogset = Number(style.value))));
    const removable = n > base && n === list.length;
    return h("section", { class: "card trade-card" },
      h("div", { class: "card-head" }, h("h4", {}, `Trade #${n}`), n > base ? h("span", { class: "tag new" }, "yours") : null),
      h("div", { class: "row wrap trade-row" },
        field("The NPC wants", speciesSelect(t.give, (v) => editTrades(`Trade #${n}: wants`, (l) => (l[i].give = v)), false)),
        h("span", { class: "trade-arrow" }, "⇄"),
        field("The player gets", speciesSelect(t.get, (v) => editTrades(`Trade #${n}: gives`, (l) => (l[i].get = v)), false)),
        field("Nickname", nick),
        field("Dialogue", style),
      ),
      h("p", { class: "hint trade-offer" }, `“${offerText(t)}”`),
      who,
      removable ? h("button", { class: "btn small danger", onclick: () => editTrades(`Remove trade #${n}`, (l) => l.pop()) }, "Remove trade") : null,
    );
  });
  return [
    ...cards,
    h("div", { class: "row" },
      h("button", {
        class: "btn small",
        onclick: () => editTrades("New trade", (l) => l.push(clone({ give: "PIKACHU", get: "EEVEE", nickname: "TRADEY", dialogset: 1 }))),
      }, "+ New trade"),
      h("span", { class: "hint" }, "A new trade is offered by an NPC whose event runs the Trade command with its number. The received Pokémon keeps the level of the one sent."),
    ),
  ];
}
