// Fishing (gen1recomp OverworldController fishingPool / rollFishingGroup):
//   Old Rod   field.fishing.OLD_ROD.always: one Pokémon, every bite
//   Good Rod  field.fishing.GOOD_ROD.pool: a list for the whole game
//   Super Rod field.superRod[MAP]: a list per map (the rod finds nothing
//             on maps without one)
// A cast bites half the time; a list then picks one of its (up to 4)
// entries with equal chance. field.fishing is not in the imported data, so
// the engine's defaults (src/world/FieldDefaults.lua FISHING) are restated.

import { clone, deepEqual } from "../core/merge.ts";
import { store } from "../core/store.ts";
import { comboInput, field, h, numberInput } from "./dom.ts";
import { nav } from "./nav.ts";
import { spriteUrl } from "./pokemonEditor.ts";

export interface FishSlot {
  species: string;
  level: number;
}

interface Fishing {
  OLD_ROD: { always: FishSlot };
  GOOD_ROD: { pool: FishSlot[] };
  SUPER_ROD: { perMap: string };
}

const MAX_SLOTS = 4;
export const DEFAULT_FISHING: Fishing = {
  OLD_ROD: { always: { species: "MAGIKARP", level: 5 } },
  GOOD_ROD: { pool: [{ species: "GOLDEEN", level: 10 }, { species: "POLIWAG", level: 10 }] },
  SUPER_ROD: { perMap: "superRod" },
};

const superRods = () => (store.table("field").superRod ?? {}) as Record<string, FishSlot[]>;

export function fishing(): Fishing {
  return (store.table("field").fishing as Fishing | undefined) ?? DEFAULT_FISHING;
}

function editSuperRod(label: string, mutate: (all: Record<string, FishSlot[]>) => void): void {
  store.editRecord<Record<string, FishSlot[]>>("field", "superRod", label, mutate, { create: () => ({}) });
  store.seal();
}

function setFishing(label: string, mutate: (f: Fishing) => void): void {
  const next = clone(fishing());
  mutate(next);
  store.setRecord("field", "fishing", label, deepEqual(next, DEFAULT_FISHING) && store.baseTable("field").fishing === undefined ? undefined : next);
  store.seal();
}

// rows of species + level, with add/remove
function slotRows(slots: FishSlot[], change: (label: string, next: FishSlot[]) => void): HTMLElement[] {
  const ids = Object.keys(store.table("pokemon")).sort();
  const pct = slots.length ? `${(50 / slots.length).toFixed(1)}%` : "";
  const pokemon = store.table("pokemon") as Record<string, Record<string, unknown>>;
  const front = (id: string) => (pokemon[id] ? spriteUrl(store.adapter.pokemon?.frontSprite(pokemon[id])) : "");
  const rows = slots.map((s, i) =>
    h("div", { class: "slot-row" },
      h("span", { class: "slot-odds", title: "Chance per cast: half the casts bite, then each entry is equally likely" }, pct),
      front(s.species) ? h("img", { class: "slot-icon", src: front(s.species), alt: "" }) : h("span", { class: "slot-icon" }),
      comboInput(s.species, "dl-species", ids, (v) => change("Fishing species", slots.map((x, j) => (j === i ? { ...x, species: v } : x)))),
      h("span", { class: "muted" }, "Lv"),
      numberInput(s.level, (n) => change("Fishing level", slots.map((x, j) => (j === i ? { ...x, level: Math.max(1, Math.min(100, n)) } : x))), 1, 100),
      h("button", { class: "btn small ghost", title: "Remove", disabled: slots.length <= 1, onclick: () => change("Remove fishing slot", slots.filter((_x, j) => j !== i)) }, "✕"),
    ),
  );
  return [
    ...rows,
    h("button", {
      class: "btn small",
      disabled: slots.length >= MAX_SLOTS,
      title: slots.length >= MAX_SLOTS ? "The game picks among 4 entries at most" : "",
      onclick: () => change("Add fishing slot", [...slots, { ...(slots[slots.length - 1] ?? { species: "MAGIKARP", level: 15 }) }]),
    }, "+ Add"),
  ];
}

// the map's Super Rod list (Maps, Encounters tab)
export function superRodCard(mapId: string): HTMLElement {
  const list = superRods()[mapId];
  if (!list?.length) {
    const sources = Object.keys(superRods()).filter((m) => m !== mapId && superRods()[m]?.length).sort();
    const copy = h("select", {}, h("option", { value: "" }, "Copy from map…"), ...sources.map((m) => h("option", { value: m }, m)));
    copy.addEventListener("change", () => {
      const from = superRods()[copy.value];
      if (from) editSuperRod("Copy Super Rod list", (all) => (all[mapId] = clone(from)));
    });
    return h("section", { class: "card" },
      h("h4", {}, "Super Rod"),
      h("p", { class: "hint" }, "Nothing bites the Super Rod here. Fish from any water cell of the map."),
      h("div", { class: "row" },
        h("button", { class: "btn small", onclick: () => editSuperRod("Add Super Rod list", (all) => (all[mapId] = [{ species: "MAGIKARP", level: 15 }])) }, "+ Super Rod list"),
        copy,
      ),
    );
  }
  return h("section", { class: "card" },
    h("div", { class: "card-head" },
      h("h4", {}, "Super Rod"),
      h("button", { class: "btn small ghost danger", onclick: () => editSuperRod("Remove Super Rod list", (all) => delete all[mapId]) }, "Remove"),
    ),
    ...slotRows(list, (label, next) => editSuperRod(label, (all) => (all[mapId] = next))),
    h("div", { class: "row" },
      h("span", { class: "hint" }, "Half the casts bite; each entry is equally likely. Old and Good Rod are the same everywhere:"),
      h("button", { class: "btn small ghost", onclick: () => nav.openGlobal("wild") }, "Edit in Global →"),
    ),
  );
}

// Old Rod and Good Rod (Global > Wild encounters)
export function rodsCard(): HTMLElement {
  const f = fishing();
  const ids = Object.keys(store.table("pokemon")).sort();
  const old = f.OLD_ROD.always;
  return h("section", { class: "card" },
    h("h4", {}, "Old Rod and Good Rod"),
    h("p", { class: "hint" }, "The same on every map. The Super Rod has a list per map (Maps, Encounters tab)."),
    field("Old Rod (every bite)", h("div", { class: "row nowrap" },
      comboInput(old.species, "dl-species", ids, (v) => setFishing("Old Rod species", (x) => (x.OLD_ROD.always.species = v))),
      h("span", { class: "muted" }, "Lv"),
      numberInput(old.level, (n) => setFishing("Old Rod level", (x) => (x.OLD_ROD.always.level = Math.max(1, Math.min(100, n)))), 1, 100),
    )),
    h("span", { class: "field-label" }, "Good Rod"),
    ...slotRows(f.GOOD_ROD.pool, (label, next) => setFishing(label, (x) => (x.GOOD_ROD.pool = next))),
    store.table("field").fishing !== undefined
      ? h("button", { class: "btn small danger", onclick: () => setFishing("Rods: the game's", (x) => Object.assign(x, clone(DEFAULT_FISHING))) }, "Back to the game's rods")
      : null,
  );
}
