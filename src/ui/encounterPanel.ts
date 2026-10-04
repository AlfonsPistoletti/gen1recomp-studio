// ENCOUNTERS tab of the Maps workspace's right panel: the current map's
// wild tables (the "encounters" registry, id = map id) and the slot chances.

import { clone } from "../core/merge.ts";
import { store } from "../core/store.ts";
import type { EncounterSpec, EncounterTerrain } from "../games/types.ts";
import { comboInput, field, h, numberInput, onFocusLeave, rerender } from "./dom.ts";
import { nav } from "./nav.ts";
import { spriteUrl } from "./pokemonEditor.ts";

type Slot = { level: number; species: string };
type Table = { rate: number; slots: Slot[] };
type Wild = Record<string, unknown> & Partial<Record<string, Table>>;

const REG = "encounters";

export function wildTable(mapId: string): Wild | undefined {
  return store.table(REG)[mapId] as Wild | undefined;
}

// Whether a map rolls any wild encounters at all (for the map list).
export function hasWild(mapId: string): boolean {
  const spec = store.adapter?.encounters;
  const w = wildTable(mapId);
  return !!spec && !!w && spec.terrains.some((t) => (w[t.key] as Table | undefined)?.rate);
}

// Edits the map's record; one with no tables left that the base does not
// have either disappears instead of being saved empty.
function editWild(mapId: string, label: string, mutate: (w: Wild) => void): void {
  const current = wildTable(mapId);
  const draft: Wild = current ? clone(current) : {};
  mutate(draft);
  const spec = store.adapter.encounters!;
  const empty = !spec.terrains.some((t) => draft[t.key]);
  const inBase = store.baseTable(REG)[mapId] !== undefined;
  store.setRecord(REG, mapId, label, empty && !inBase ? undefined : draft);
  store.seal();
}

// The ENCOUNTERS pane: a head with the map id and a scrolling body that
// follows the current map and every edit that changes what it shows.
export function mountEncounterPane(host: HTMLElement): { render(): void } {
  const title = h("span", { class: "muted head-title" });
  const body = h("div", { class: "inspector" });
  host.append(h("div", { class: "panel-head" }, h("span", {}, "Wild Pokémon"), title), body);
  let scheduled = false;
  const render = () => {
    scheduled = false;
    if (host.hidden || !store.project) return;
    title.textContent = store.map?.id ?? "";
    rerender(body, encounterPanel);
  };
  const schedule = () => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(render);
    }
  };
  store.on((reason, _id, registry) => {
    if (["project", "map", "edit", "overlays", "saved"].includes(reason)) schedule();
    if (reason === "content" && (registry === REG || registry === "pokemon" || registry === store.adapter?.encounters?.sharedOdds?.registry)) schedule();
  });
  onFocusLeave(body, schedule);
  return { render };
}

// The pane's content for the current map.
export function encounterPanel(): HTMLElement[] {
  const spec = store.adapter.encounters;
  const map = store.map;
  if (!map) return [];
  if (!spec) return [h("p", { class: "hint" }, "This game has no encounter editor yet.")];
  const ctx = store.ctx;
  const notes = spec.notes(map, ctx);
  const edited = store.isRecordEdited(REG, map.id);
  return [
    h(
      "div",
      { class: "row" },
      h("span", { class: "kv" }, h("span", {}, "Wild Pokémon on"), h("code", {}, map.id)),
      edited ? h("span", { class: "tag edited" }, "edited") : null,
    ),
    ...notes.map((n) => h("p", { class: "hint warn" }, n)),
    ...spec.terrains.map((t) => terrainCard(map.id, t, spec)),
    spec.sharedOdds
      ? h(
          "div",
          { class: "row" },
          h("span", { class: "hint" }, "Slot chances are the same for every map."),
          h("button", { class: "btn small ghost", onclick: () => nav.setWorkspace("global") }, "Edit in Global →"),
        )
      : null,
    h(
      "div",
      { class: "row" },
      h("button", { class: `btn small${store.overlays.wild ? " active" : ""}`, title: "Show cells that roll encounters (W)", onclick: () => store.toggleOverlay("wild") }, store.overlays.wild ? "Hide wild cells" : "Show wild cells"),
      edited ? h("button", { class: "btn small danger", onclick: () => store.revertRecord(REG, map.id, "Revert wild Pokémon") }, "Revert to base") : null,
    ),
  ].filter((e): e is HTMLElement => !!e);
}

function terrainCard(mapId: string, t: EncounterTerrain, spec: EncounterSpec): HTMLElement {
  const ctx = store.ctx;
  const table = wildTable(mapId)?.[t.key] as Table | undefined;
  if (!table) {
    // offer a fresh table or a copy of another map's
    const sources = Object.keys(store.table(REG))
      .filter((id) => id !== mapId && (wildTable(id)?.[t.key] as Table | undefined)?.slots?.length)
      .sort();
    const copy = h("select", {}, h("option", { value: "" }, "Copy from map…"), ...sources.map((id) => h("option", { value: id }, id)));
    copy.addEventListener("change", () => {
      const from = wildTable(copy.value)?.[t.key] as Table | undefined;
      if (from) editWild(mapId, `Copy ${t.label.toLowerCase()} table`, (w) => (w[t.key] = clone(from)));
    });
    const add = h("button", { class: "btn small", onclick: () => editWild(mapId, `Add ${t.label.toLowerCase()} table`, (w) => (w[t.key] = freshTable(spec))) }, `+ ${t.label} table`);
    return h("section", { class: "card" }, h("h4", {}, t.label), h("p", { class: "hint" }, `No ${t.label.toLowerCase()} encounters. ${t.hint}`), h("div", { class: "row" }, add, copy));
  }

  const odds = spec.slotOdds(ctx);
  const speciesIds = Object.keys(store.table("pokemon")).sort();
  const pokemon = store.table("pokemon") as Record<string, Record<string, unknown>>;
  const front = (id: string) => (pokemon[id] ? spriteUrl(store.adapter.pokemon?.frontSprite(pokemon[id])) : "");
  const editSlot = (i: number, label: string, mutate: (s: Slot) => void) =>
    editWild(mapId, label, (w) => {
      const tb = w[t.key] as Table;
      tb.slots = tb.slots.map((s, j) => (j === i ? { ...s } : s));
      mutate(tb.slots[i]);
    });

  const rate = numberInput(table.rate, (n) => editWild(mapId, "Encounter rate", (w) => ((w[t.key] as Table).rate = Math.max(0, Math.min(255, n)))), 0, 255);
  const perStep = table.rate ? `≈ ${((table.rate / 256) * 100).toFixed(1)}% per step` : "never (rate 0)";

  // the same species can sit in several slots; show the combined odds too
  const totals = new Map<string, number>();
  table.slots.forEach((s, i) => totals.set(s.species, (totals.get(s.species) ?? 0) + (odds[i] ?? 0)));

  const rows = table.slots.map((s, i) => {
    const pct = ((odds[i] ?? 0) / 256) * 100;
    const icon = front(s.species);
    return h(
      "div",
      { class: "slot-row" },
      h("span", { class: "slot-odds", title: `Slot ${i + 1}: ${odds[i] ?? 0}/256` }, `${pct.toFixed(1)}%`),
      icon ? h("img", { class: "slot-icon", src: icon, alt: "" }) : h("span", { class: "slot-icon" }),
      comboInput(s.species, "dl-species", speciesIds, (v) => editSlot(i, "Wild species", (x) => (x.species = v))),
      h("span", { class: "muted" }, "Lv"),
      numberInput(s.level, (n) => editSlot(i, "Wild level", (x) => (x.level = Math.max(1, Math.min(100, n)))), 1, 100),
      pokemon[s.species] ? h("button", { class: "btn small ghost", title: `Open ${s.species} in the Pokémon workspace`, onclick: () => nav.openPokemon(s.species) }, "→") : h("span", {}),
    );
  });

  const summary = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([sp, o]) => `${sp} ${((o / 256) * 100).toFixed(0)}%`)
    .join(" · ");

  return h(
    "section",
    { class: "card" },
    h(
      "div",
      { class: "card-head" },
      h("h4", {}, t.label),
      h("button", { class: "btn small ghost danger", title: `Remove the ${t.label.toLowerCase()} table`, onclick: () => editWild(mapId, `Remove ${t.label.toLowerCase()} table`, (w) => delete w[t.key]) }, "Remove"),
    ),
    h("div", { class: "row" }, field("Encounter rate", rate), h("span", { class: "hint" }, `${perStep}. ${t.hint}`)),
    ...rows,
    h("p", { class: "hint" }, summary),
  );
}

function freshTable(spec: EncounterSpec): Table {
  const pokemon = store.table("pokemon");
  const pick = ["RATTATA", "PIDGEY"].find((id) => pokemon[id]) ?? Object.keys(pokemon)[0] ?? "RATTATA";
  return { rate: 20, slots: Array.from({ length: spec.slotCount }, (_, i) => ({ level: 2 + Math.floor(i / 3), species: pick })) };
}

// The chance of each slot, out of 256. In Gen 1 this is one table for every
// map (the mod schema has no per-table chances), so edits apply game-wide.
// The last slot takes whatever the others leave, so the total is always 256.
export function chancesCard(spec: EncounterSpec, shared: NonNullable<EncounterSpec["sharedOdds"]>): HTMLElement {
  const odds = spec.slotOdds(store.ctx);
  const n = odds.length;
  const write = (next: number[], label: string) => {
    let sum = 0;
    const cumulative = next.map((o) => (sum += o));
    const vanilla = cumulative.every((c, i) => c === shared.defaults[i]) && cumulative.length === shared.defaults.length;
    // back at the vanilla spread: drop the record instead of saving a copy
    const inBase = store.baseTable(shared.registry)[shared.id] !== undefined;
    store.setRecord(shared.registry, shared.id, label, vanilla && !inBase ? undefined : cumulative);
    store.seal();
  };
  const setSlot = (i: number, v: number) => {
    const next = [...odds];
    next[i] = v;
    const rest = 256 - next.slice(0, n - 1).reduce((a, b) => a + b, 0);
    if (rest < 0) {
      next[i] = v + rest;
      next[n - 1] = 0;
    } else next[n - 1] = rest;
    if (next[0] < 1) next[0] = 1;
    write(next, "Slot chances");
  };
  const rows = odds.map((o, i) => {
    const last = i === n - 1;
    const input = last
      ? h("span", { class: "chance-rest", title: "The last slot gets what the others leave" }, String(o))
      : numberInput(o, (v) => setSlot(i, Math.max(i === 0 ? 1 : 0, Math.min(256, v))), i === 0 ? 1 : 0, 255);
    return h(
      "div",
      { class: "chance-row" },
      h("span", { class: "muted" }, `Slot ${i + 1}`),
      input,
      h("span", { class: "chance-pct" }, `${((o / 256) * 100).toFixed(1)}%`),
      h("div", { class: "stat-bar" }, h("div", { class: "stat-fill", style: `width:${Math.min(100, (o / 64) * 100)}%;background:var(--accent)` })),
    );
  });
  const changed = store.isRecordEdited(shared.registry, shared.id);
  return h(
    "section",
    { class: "card" },
    h(
      "div",
      { class: "card-head" },
      h("h4", {}, "Slot chances · all maps"),
      changed ? h("button", { class: "btn small ghost", onclick: () => write(shared.defaults.map((c, i) => c - (i ? shared.defaults[i - 1] : 0)), "Vanilla slot chances") }, "Vanilla") : null,
    ),
    h("p", { class: "hint" }, "How likely each slot is, out of 256. The game uses one set of chances for every map and terrain, so a change here applies everywhere. The last slot gets whatever the others leave."),
    ...rows,
  );
}
