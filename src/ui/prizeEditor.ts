// A Game Corner prize counter: the three prizes its window shows, each an
// item or a Pokémon at a level, for coins. Used by the Global "Game Corner
// prizes" section and by the inspector of an NPC/sign that is a counter.
// Records live in adapter.towns.prizeRegistry, id "<MAP_ID>:<TEXT_ID>".

import { clone, deepEqual } from "../core/merge.ts";
import { store } from "../core/store.ts";
import type { Prize, PrizeCounter, TownSpec } from "../games/types.ts";
import { comboInput, h, numberInput, selectInput } from "./dom.ts";
import { nav } from "./nav.ts";

export const counterId = (mapId: string, textId: string): string => `${mapId}:${textId}`;

export function splitCounterId(id: string): { mapId: string; textId: string } {
  const i = id.indexOf(":");
  return { mapId: id.slice(0, i), textId: id.slice(i + 1) };
}

// three ordinary prizes for a new counter
export function freshCounter(spec: TownSpec): PrizeCounter {
  const prizes: Prize[] = [
    { item: "POKE_BALL", cost: 50 },
    { item: "GREAT_BALL", cost: 150 },
    { item: "ULTRA_BALL", cost: 300 },
  ];
  return { prizes: prizes.slice(0, spec.prizesPerCounter) };
}

export function counters(spec: TownSpec): Record<string, PrizeCounter> {
  return store.table(spec.prizeRegistry) as Record<string, PrizeCounter>;
}

// counter ids that give this item or Pokémon
export function countersGiving(spec: TownSpec, id: string): string[] {
  return Object.entries(counters(spec))
    .filter(([, c]) => c.prizes.some((p) => p.item === id || p.species === id))
    .map(([cid]) => cid);
}

// "Celadon prize room · counter 1" style label
export function counterLabel(id: string): string {
  const { mapId, textId } = splitCounterId(id);
  const label = String(store.maps[mapId]?.label ?? "").toUpperCase();
  const what = textId.replace(/^TEXT_/, "").replace(new RegExp(`^${label}_`), "").replace(/_/g, " ").toLowerCase();
  return `${mapId} · ${what}`;
}

// select the NPC/sign that is this counter on its map
export function showCounter(id: string): void {
  const { mapId, textId } = splitCounterId(id);
  const map = store.maps[mapId];
  if (!map) return;
  for (const layer of store.adapter.layers) {
    const index = store.entities(map, layer.key).findIndex((e) => e.text === textId);
    if (index >= 0) return nav.selectEntity(mapId, layer.key, index);
  }
  nav.openMap(mapId);
}

export function prizeCounterEditor(spec: TownSpec, id: string): HTMLElement {
  const counter = counters(spec)[id] ?? freshCounter(spec);
  const base = store.baseTable(spec.prizeRegistry)[id] as PrizeCounter | undefined;
  const editPrize = (i: number, label: string, mutate: (p: Prize) => void) => {
    store.editRecord<PrizeCounter>(spec.prizeRegistry, id, label, (d) => {
      d.prizes = d.prizes.map((p, j) => (j === i ? { ...p } : p));
      mutate(d.prizes[i]);
    }, { create: () => clone(counter) });
    store.seal();
  };
  const species = Object.keys(store.table("pokemon")).sort();
  const itemIds = Object.keys(store.table("items")).sort();
  const rows = counter.prizes.slice(0, spec.prizesPerCounter).map((p, i) => {
    const kind = selectInput(p.species ? "mon" : "item", ["item", "mon"], (v) =>
      editPrize(i, "Prize kind", (x) => {
        if (v === "mon") {
          delete x.item;
          x.species = species[0] ?? "ABRA";
          x.level = 10;
        } else {
          delete x.species;
          delete x.level;
          x.item = "POKE_BALL";
        }
      }),
    );
    kind.options[0].textContent = "Item";
    kind.options[1].textContent = "Pokémon";
    const what = p.species
      ? [
          comboInput(p.species, "dl-prize-species", species, (v) => species.includes(v) && editPrize(i, "Prize Pokémon", (x) => (x.species = v))),
          h("span", { class: "muted" }, "Lv"),
          numberInput(p.level ?? 5, (v) => editPrize(i, "Prize level", (x) => (x.level = Math.max(1, Math.min(100, v)))), 1, 100),
        ]
      : [comboInput(p.item ?? "", "dl-prize-items", itemIds, (v) => itemIds.includes(v) && editPrize(i, "Prize item", (x) => (x.item = v)))];
    return h(
      "div",
      { class: "prize-row" },
      kind,
      h("div", { class: "row nowrap" }, ...what),
      h("div", { class: "row nowrap" }, numberInput(p.cost, (v) => editPrize(i, "Prize cost", (x) => (x.cost = Math.max(0, Math.min(spec.maxCoins, v)))), 0, spec.maxCoins), h("span", { class: "muted" }, "coins")),
    );
  });
  const edited = base ? !deepEqual(base, counter) : true;
  return h(
    "div",
    { class: "prize-counter" },
    ...rows,
    edited && base
      ? h("button", { class: "btn small ghost", onclick: () => (store.revertRecord(spec.prizeRegistry, id), store.seal()) }, "Revert to vanilla")
      : null,
  );
}
