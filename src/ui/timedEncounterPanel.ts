// ENCOUNTERS tab for games whose wild tables are keyed by kind and timed
// (Gen 2, adapter.timedEncounters): the registry's "grass" record holds every
// map's { rates: {MORN, DAY, NITE}, slots: {MORN: [...], ...} }, "water" every
// map's { rate, slots }, and fishing is a group (map field fishGroup) whose
// rods list (cumulative chance out of 256, species, level) rows, some with
// day/nite species of their own. One map's entries are edited inside those
// records; a save patches only what changed (gen1recomp Schemas encounters).

import { clone, deepEqual } from "../core/merge.ts";
import { store } from "../core/store.ts";
import type { TimedEncounterSpec } from "../games/types.ts";
import { comboInput, field, h, numberInput, selectInput } from "./dom.ts";
import { nav } from "./nav.ts";
import { spriteUrl } from "./pokemonEditor.ts";

type Rec = Record<string, unknown>;
type Slot = { level: number; species: string };
type Grass = { map?: string; rates: Record<string, number>; slots: Record<string, Slot[]> };
type Water = { map?: string; rate: number; slots: Slot[] };
type FishRow = { chance: number; level?: number; species?: string; day?: Slot; nite?: Slot; timeGroup?: number };

const kindTable = (spec: TimedEncounterSpec, kind: string) => (store.table(spec.registry)[kind] ?? {}) as Record<string, unknown>;
const baseKind = (spec: TimedEncounterSpec, kind: string) => (store.baseTable(spec.registry)[kind] ?? {}) as Record<string, unknown>;

// one entry (a map's table, a fish group) inside a kind record
function setEntry(spec: TimedEncounterSpec, kind: string, id: string, label: string, mutate: (e: Rec | undefined) => Rec | undefined): void {
  store.editRecord<Rec>(spec.registry, kind, label, (d) => {
    const next = mutate(d[id] === undefined ? undefined : (clone(d[id]) as Rec));
    if (next === undefined) delete d[id];
    else d[id] = next;
  }, { create: () => ({}) });
  store.seal();
}

function entryEdited(spec: TimedEncounterSpec, kind: string, id: string): boolean {
  return !deepEqual(kindTable(spec, kind)[id], baseKind(spec, kind)[id]);
}

// whether the map has a wild table (the map list's swords icon)
export function hasTimedWild(spec: TimedEncounterSpec, mapId: string): boolean {
  const g = kindTable(spec, "grass")[mapId] as Grass | undefined;
  const w = kindTable(spec, "water")[mapId] as Water | undefined;
  return !!(g && Object.values(g.rates ?? {}).some((r) => r > 0)) || !!w?.rate;
}

// a map's entries in every kind the panel edits (fishing groups are shared, so not here)
const mapKinds = (spec: TimedEncounterSpec) => ["grass", "water", ...(spec.trees ? [spec.trees.map, spec.trees.rocks] : []), ...(spec.swarms ? [spec.swarms.grass, spec.swarms.water] : [])];

export function timedWildEdited(spec: TimedEncounterSpec, id: string): boolean {
  return mapKinds(spec).some((k) => entryEdited(spec, k, id));
}

// back to the game's entries; the caller makes it one undo step (store.group)
export function revertTimedWild(spec: TimedEncounterSpec, id: string): void {
  for (const k of mapKinds(spec)) {
    const base = baseKind(spec, k)[id];
    if (entryEdited(spec, k, id)) setEntry(spec, k, id, "Revert wild Pokémon", () => (base === undefined ? undefined : (clone(base) as Rec)));
  }
}

// which time of day the grass card shows (kept while switching maps)
let time = "DAY";

export function timedEncounterPanel(spec: TimedEncounterSpec): HTMLElement[] {
  const map = store.map;
  if (!map) return [];
  const id = map.id;
  const edited = timedWildEdited(spec, id);
  return [
    h(
      "div",
      { class: "row" },
      h("span", { class: "kv" }, h("span", {}, "Wild Pokémon on"), h("code", {}, id)),
      edited ? h("span", { class: "tag edited" }, "edited") : null,
    ),
    grassCard(spec, id),
    waterCard(spec, id),
    fishCard(spec, id),
    ...(spec.trees ? [treeCard(spec, id, spec.trees.map, "Headbutt trees", "Headbutting a tree on this map")] : []),
    ...(spec.trees ? [treeCard(spec, id, spec.trees.rocks, "Rock Smash", "Smashing a rock on this map")] : []),
    // a swarm table works only on the maps the game has a swarm for
    ...(spec.swarms && kindTable(spec, spec.swarms.grass)[id] ? [grassCard(spec, id, spec.swarms.grass, "Swarm (grass)", "Used instead of the grass table while a swarm is on (a phone call announces it).")] : []),
    ...(spec.swarms && kindTable(spec, spec.swarms.water)[id] ? [waterCard(spec, id, spec.swarms.water, "Swarm (water)", "Used instead of the water table while a swarm is on.")] : []),
    h(
      "div",
      { class: "row" },
      h("button", { class: `btn small${store.overlays.wild ? " active" : ""}`, title: "Show cells that roll encounters (W)", onclick: () => store.toggleOverlay("wild") }, store.overlays.wild ? "Hide wild cells" : "Show wild cells"),
      edited
        ? h("button", {
            class: "btn small danger",
            onclick: () => store.group(`Revert wild Pokémon on ${id}`, () => revertTimedWild(spec, id)),
          }, "Revert to base")
        : null,
    ),
  ];
}

// a slot: chance, picture, species, level
// (no `edit`: shown, not editable; `extra`: one more control before the arrow)
function slotRow(chance: string, s: Slot, edit?: (label: string, mutate: (x: Slot) => void) => void, extra?: HTMLElement): HTMLElement {
  const pokemon = store.table("pokemon") as Record<string, Rec>;
  const icon = pokemon[s.species] ? spriteUrl(store.adapter.pokemon?.frontSprite(pokemon[s.species])) : "";
  return h(
    "div",
    { class: `slot-row${extra ? " with-extra" : ""}` },
    h("span", { class: "slot-odds" }, chance),
    icon ? h("img", { class: "slot-icon", src: icon, alt: "" }) : h("span", { class: "slot-icon" }),
    edit
      ? comboInput(s.species, "dl-species", Object.keys(pokemon).sort(), (v) => edit("Wild species", (x) => (x.species = v)))
      : h("span", {}, String(pokemon[s.species]?.name ?? s.species)),
    h("span", { class: "muted" }, "Lv"),
    edit ? numberInput(s.level, (n) => edit("Wild level", (x) => (x.level = Math.max(1, Math.min(100, n)))), 1, 100) : h("span", {}, String(s.level)),
    extra ?? null,
    pokemon[s.species] ? h("button", { class: "btn small ghost", title: `Open ${s.species} in the Pokémon workspace`, onclick: () => nav.openPokemon(s.species) }, "→") : h("span", {}),
  );
}

const pctPerStep = (rate: number) => (rate ? `≈ ${((rate / 256) * 100).toFixed(1)}% per step` : "never (rate 0)");

// a table on another map to copy, or a fresh one
function emptyCard(spec: TimedEncounterSpec, kind: string, id: string, label: string, hint: string, fresh: () => Rec): HTMLElement {
  const all = kindTable(spec, kind);
  const sources = Object.keys(all).filter((m) => m !== id).sort();
  const copy = h("select", {}, h("option", { value: "" }, "Copy from map…"), ...sources.map((m) => h("option", { value: m }, m)));
  copy.addEventListener("change", () => {
    const from = all[copy.value] as Rec | undefined;
    if (from) setEntry(spec, kind, id, `Copy ${label.toLowerCase()} table`, () => ({ ...clone(from), map: id }));
  });
  const add = h("button", { class: "btn small", onclick: () => setEntry(spec, kind, id, `Add ${label.toLowerCase()} table`, () => fresh()) }, `+ ${label} table`);
  return h("section", { class: "card" }, h("h4", {}, label), h("p", { class: "hint" }, `No ${label.toLowerCase()} encounters. ${hint}`), h("div", { class: "row" }, add, copy));
}

function starter(): string {
  const pokemon = store.table("pokemon");
  return ["SENTRET", "RATTATA", "PIDGEY"].find((s) => pokemon[s]) ?? Object.keys(pokemon)[0] ?? "RATTATA";
}

function grassCard(spec: TimedEncounterSpec, id: string, kind = "grass", title = "Grass", hint = "Rolled on each step in tall grass (in caves: on every step)."): HTMLElement {
  const g = kindTable(spec, kind)[id] as Grass | undefined;
  if (!g) {
    return emptyCard(spec, kind, id, title, hint, () => {
      const slots = Array.from({ length: spec.grassOdds.length }, (_, i) => ({ level: 2 + Math.floor(i / 2), species: starter() }));
      return { map: id, rates: Object.fromEntries(spec.times.map((t) => [t.key, 10])), slots: Object.fromEntries(spec.times.map((t) => [t.key, clone(slots)])) };
    });
  }
  const edit = (label: string, mutate: (d: Grass) => void) => setEntry(spec, kind, id, label, (e) => {
    const d = e as Grass;
    mutate(d);
    return d as unknown as Rec;
  });
  const slots = g.slots?.[time] ?? [];
  const rate = g.rates?.[time] ?? 0;
  const tabs = h("div", { class: "seg" }, ...spec.times.map((t) =>
    h("button", { class: `btn small${t.key === time ? " active" : ""}`, onclick: (e: Event) => {
      time = t.key;
      // redraw just this card
      (e.target as HTMLElement).closest("section")?.replaceWith(grassCard(spec, id, kind, title, hint));
    } }, t.label)));
  const others = spec.times.filter((t) => t.key !== time);
  return h(
    "section",
    { class: "card" },
    h(
      "div",
      { class: "card-head" },
      h("h4", {}, title),
      kind === "grass" || kind === "water"
        ? h("button", { class: "btn small ghost danger", title: `Remove the ${title.toLowerCase()} table`, onclick: () => setEntry(spec, kind, id, `Remove ${title.toLowerCase()} table`, () => undefined) }, "Remove")
        : null,
    ),
    tabs,
    h("div", { class: "row" }, field("Encounter rate", numberInput(rate, (n) => edit("Encounter rate", (d) => (d.rates = { ...d.rates, [time]: Math.max(0, Math.min(255, n)) })), 0, 255)), h("span", { class: "hint" }, `${pctPerStep(rate)}. ${hint}`)),
    ...slots.map((s, i) => slotRow(`${spec.grassOdds[i] ?? 0}%`, s, (label, mutate) => edit(label, (d) => {
      const list = (d.slots[time] ?? []).map((x) => ({ ...x }));
      mutate(list[i]);
      d.slots = { ...d.slots, [time]: list };
    }))),
    h(
      "div",
      { class: "row" },
      h("button", {
        class: "btn small",
        title: `Use this list (and rate) for ${others.map((t) => t.label.toLowerCase()).join(" and ")} too`,
        onclick: () => edit(`Same grass table all day`, (d) => {
          for (const t of others) {
            d.slots = { ...d.slots, [t.key]: clone(slots) };
            d.rates = { ...d.rates, [t.key]: rate };
          }
        }),
      }, "Use for all times"),
    ),
  );
}

function waterCard(spec: TimedEncounterSpec, id: string, kind = "water", title = "Water", hint = "Rolled on each step while surfing."): HTMLElement {
  const w = kindTable(spec, kind)[id] as Water | undefined;
  if (!w) {
    return emptyCard(spec, kind, id, title, hint, () => ({ map: id, rate: 10, slots: Array.from({ length: spec.waterOdds.length }, (_, i) => ({ level: 10 + i * 5, species: store.table("pokemon").TENTACOOL ? "TENTACOOL" : starter() })) }));
  }
  const edit = (label: string, mutate: (d: Water) => void) => setEntry(spec, kind, id, label, (e) => {
    const d = e as Water;
    mutate(d);
    return d as unknown as Rec;
  });
  return h(
    "section",
    { class: "card" },
    h(
      "div",
      { class: "card-head" },
      h("h4", {}, title),
      kind === "grass" || kind === "water"
        ? h("button", { class: "btn small ghost danger", title: `Remove the ${title.toLowerCase()} table`, onclick: () => setEntry(spec, kind, id, `Remove ${title.toLowerCase()} table`, () => undefined) }, "Remove")
        : null,
    ),
    h("div", { class: "row" }, field("Encounter rate", numberInput(w.rate, (n) => edit("Encounter rate", (d) => (d.rate = Math.max(0, Math.min(255, n)))), 0, 255)), h("span", { class: "hint" }, `${pctPerStep(w.rate)}. ${hint}`)),
    ...(w.slots ?? []).map((s, i) => slotRow(`${spec.waterOdds[i] ?? 0}%`, s, (label, mutate) => edit(label, (d) => {
      d.slots = d.slots.map((x) => ({ ...x }));
      mutate(d.slots[i]);
    }))),
  );
}

const listName = (v: string) => v.replace(/^(FISHGROUP|TREEMON_SET)_/, "").replace(/_/g, " ").toLowerCase();
const mapCount = (n: number) => `${n} map${n === 1 ? "" : "s"}`;

// The lists of a fishing group / tree set are shared by many maps, so the map
// panel only shows them; they are edited in Global (fishGroupCards,
// treeSetCards). Opening Global scrolls to the list's card.
function sharedNote(text: string, section: string, label: string, list: string): HTMLElement {
  return h("p", { class: "hint" }, `${text} `, h("button", {
    class: "linkish",
    onclick: () => {
      nav.openGlobal(section);
      requestAnimationFrame(() => document.querySelector(`[data-shared-list="${list}"]`)?.scrollIntoView({ block: "start" }));
    },
  }, `Edit in Global › ${label}`));
}

// the map's choice back to the game's (the lists themselves: in Global)
function choiceBack(now: string | undefined, base: string | undefined, choose: (v: string | undefined) => void): HTMLElement | null {
  if (now === base) return null;
  return h("button", { class: "btn small danger", onclick: () => choose(base) }, base ? `Back to the game's (${listName(base)})` : "Back to none");
}

// ------------------------------------------------------------------ fishing

const fishUsers = (spec: TimedEncounterSpec, group: string) => Object.values(store.maps).filter((m) => m[spec.fish.mapKey] === group);

// a fishing group's rods; `editable` in Global only
function fishRods(spec: TimedEncounterSpec, group: string, editable: boolean): HTMLElement[] {
  const g = kindTable(spec, spec.fish.kind)[group] as Record<string, FishRow[]> | undefined;
  if (!g) return [h("p", { class: "hint" }, "No fish here.")];
  const editRow = (rod: string, i: number, label: string, mutate: (r: FishRow) => void) =>
    setEntry(spec, spec.fish.kind, group, label, (e) => {
      const d = e as Record<string, FishRow[]>;
      d[rod] = d[rod].map((r) => ({ ...r }));
      mutate(d[rod][i]);
      return d as unknown as Rec;
    });
  const rods = spec.fish.rods.map((rod) => {
    const rows = g[rod.key] ?? [];
    let prev = 0;
    return h(
      "div",
      { class: "fish-rod" },
      h("span", { class: "field-label" }, rod.label),
      ...rows.map((r, i) => {
        // chance is cumulative out of 256: this row's share is the step
        const share = `${(((r.chance - prev) / 256) * 100).toFixed(0)}%`;
        prev = r.chance;
        const editSlot = (key: "day" | "nite") => editable
          ? (label: string, mutate: (x: Slot) => void) =>
              editRow(rod.key, i, label, (row) => {
                const x = { ...(row[key] as Slot) };
                mutate(x);
                row[key] = x;
                // the row's own species mirrors the day one (the extractor's shape)
                if (key === "day") Object.assign(row, { species: x.species, level: x.level });
              })
          : undefined;
        if (r.timeGroup !== undefined) {
          // a shared day/night pair (timeFishGroups): shown, not edited here
          const tg = (kindTable(spec, "timeFishGroups")[String(r.timeGroup)] ?? {}) as { day?: Slot; nite?: Slot };
          const name = (x?: Slot) => (x ? `${x.species} Lv ${x.level}` : "?");
          return h(
            "div",
            { class: "slot-row" },
            h("span", { class: "slot-odds" }, share),
            h("span", { class: "hint slot-wide", title: `Time group ${r.timeGroup}: shared by other fishing groups` }, `Day: ${name(tg.day)} · Night: ${name(tg.nite)} (shared)`),
          );
        }
        if (r.day && r.nite && (r.day.species !== r.nite.species || r.day.level !== r.nite.level)) {
          return h("div", {}, slotRow(`${share} day`, r.day, editSlot("day")), slotRow("night", r.nite, editSlot("nite")));
        }
        const slot = { species: String(r.species ?? r.day?.species ?? ""), level: Number(r.level ?? r.day?.level ?? 1) };
        return slotRow(share, slot, editable
          ? (label, mutate) =>
              editRow(rod.key, i, label, (row) => {
                const x = { species: String(row.species ?? ""), level: Number(row.level ?? 1) };
                mutate(x);
                Object.assign(row, x);
                // a day/nite pair with the same Pokémon follows along
                if (row.day) row.day = { ...x };
                if (row.nite) row.nite = { ...x };
              })
          : undefined);
      }),
    );
  });
  const bite = (g as unknown as { chance?: number }).chance;
  return [h("p", { class: "hint" }, `A cast bites ${bite !== undefined ? `${((bite / 256) * 100).toFixed(0)}% of the time` : "sometimes"}; then the rod's list picks by the chances shown.`), ...rods];
}

// the map's fishing group (picked here) and what bites (shown; edited in Global)
function fishCard(spec: TimedEncounterSpec, id: string): HTMLElement {
  const groups = kindTable(spec, spec.fish.kind);
  const group = String(store.maps[id]?.[spec.fish.mapKey] ?? "");
  const base = ((store.baseTable("maps")[id] as Rec | undefined)?.[spec.fish.mapKey] as string | undefined) || undefined;
  const choose = (v: string | undefined) => {
    store.edit(id, "Fishing group", (d) => (v === undefined ? delete d[spec.fish.mapKey] : (d[spec.fish.mapKey] = v)));
    store.seal();
  };
  const groupSelect = h("select", {}, ...Object.keys(groups).sort().map((g) => h("option", { value: g, selected: g === group }, listName(g))));
  if (!groups[group]) groupSelect.prepend(h("option", { value: group, selected: true }, group || "(none)"));
  groupSelect.addEventListener("change", () => choose(groupSelect.value));
  const others = fishUsers(spec, group).length - 1;
  return h(
    "section",
    { class: "card" },
    h("h4", {}, "Fishing"),
    h("div", { class: "row" }, field("Fishing group", groupSelect), choiceBack(group || undefined, base, choose)),
    groups[group] ? sharedNote(`What bites belongs to the ${listName(group)} group${others > 0 ? `, shared with ${others} other map${others === 1 ? "" : "s"}` : ""}.`, "fishing", "Fishing groups", group) : null,
    ...fishRods(spec, group, false),
  );
}

// Global › Fishing groups: every group with the maps using it
export function fishGroupCards(spec: TimedEncounterSpec): HTMLElement[] {
  const groups = kindTable(spec, spec.fish.kind);
  return Object.keys(groups).sort().map((group) => {
    const users = fishUsers(spec, group).map((m) => String(m.id));
    return h(
      "section",
      { class: "card", "data-shared-list": group },
      h("h4", {}, listName(group)),
      usedBy(users.map((m) => [m, m])),
      ...fishRods(spec, group, true),
      listBack(spec, spec.fish.kind, group, `Fishing group ${listName(group)}`, users.length),
    );
  });
}

// "Used by:" and a button per map ([label, map id])
function usedBy(maps: [string, string][]): HTMLElement {
  return h("div", { class: "row wrap" },
    h("span", { class: "hint" }, maps.length ? "Used by:" : "No map uses it."),
    ...maps.sort((a, b) => a[0].localeCompare(b[0])).map(([label, m]) => h("button", { class: "btn small ghost", onclick: () => nav.openMap(m) }, label)),
  );
}

// a shared list back to the game's (every map using it changes along)
function listBack(spec: TimedEncounterSpec, kind: string, id: string, label: string, users: number): HTMLElement | null {
  if (!entryEdited(spec, kind, id)) return null;
  const base = baseKind(spec, kind)[id];
  return h("div", { class: "row" },
    h("button", { class: "btn small danger", onclick: () => setEntry(spec, kind, id, `${label}: the game's`, () => (base === undefined ? undefined : (clone(base) as Rec))) }, "Back to the game's"),
    users > 1 ? h("span", { class: "hint" }, `Changes all ${mapCount(users)} using it.`) : null,
  );
}

// ------------------------------------------------------------------ trees

// Headbutt trees / Rock Smash (gen1recomp Encounter.treeSlot): the map names a
// shared set (its common and rare lists: a chance in % per row); the rare list
// is for the few trees the player's ID favors. Rocks use the common list.
type TreeRow = { chance: number; level: number; species: string };

function treeLists(spec: TimedEncounterSpec, setId: string, rocks: boolean, editable: boolean): HTMLElement[] {
  const set = (kindTable(spec, spec.trees!.sets) as Record<string, Record<string, TreeRow[]>>)[setId];
  if (!set) return [];
  const editRow = (list: string, i: number, label: string, mutate: (r: TreeRow) => void) =>
    setEntry(spec, spec.trees!.sets, setId, label, (e) => {
      const d = e as Record<string, TreeRow[]>;
      d[list] = d[list].map((r) => ({ ...r }));
      mutate(d[list][i]);
      return d as unknown as Rec;
    });
  return (["common", "rare"] as const).filter((k) => set[k]?.length && !(rocks && k === "rare")).map((k) => {
    const rows = set[k];
    const total = rows.reduce((n, r) => n + (Number(r.chance) || 0), 0);
    return h(
      "div",
      { class: "fish-rod" },
      h("span", { class: "field-label" }, rocks ? "Pokémon" : k === "common" ? "Most trees (and rocks)" : "Rare trees (a few, depending on the player's ID)"),
      ...rows.map((row, i) =>
        editable
          ? slotRow("", row, (label, mutate) => editRow(k, i, label, (r) => mutate(r)), h("label", { class: "slot-chance", title: "Chance in %" },
              numberInput(row.chance, (n) => editRow(k, i, "Tree chance", (r) => (r.chance = Math.max(0, Math.min(100, n)))), 0, 100),
              h("span", { class: "muted" }, "%")))
          : slotRow(`${row.chance}%`, row),
      ),
      total !== 100 ? h("p", { class: "hint warn" }, `The chances add up to ${total}%: ${total < 100 ? `the other ${100 - total}% of ${rocks ? "smashes" : "shakes"} find nothing` : "the rows past 100% are never picked"}.`) : null,
    );
  });
}

// [label, map id] for every map choosing the set (trees, rocks)
function treeUsers(spec: TimedEncounterSpec, setId: string): [string, string][] {
  const t = spec.trees!;
  const of = (kind: string, what: string) => Object.entries(kindTable(spec, kind)).filter(([, v]) => v === setId).map(([m]) => [`${m}${what}`, m] as [string, string]);
  return [...of(t.map, ""), ...of(t.rocks, " (rocks)")];
}

function treeCard(spec: TimedEncounterSpec, id: string, mapKind: string, title: string, what: string): HTMLElement {
  const t = spec.trees!;
  const sets = kindTable(spec, t.sets);
  const current = kindTable(spec, mapKind)[id] as string | undefined;
  const base = baseKind(spec, mapKind)[id] as string | undefined;
  const choose = (v: string | undefined) => setEntry(spec, mapKind, id, `${title} set`, () => v as unknown as Rec | undefined);
  const sel = selectInput(current ?? "", Object.keys(sets).sort(), (v) => choose(v || undefined), "None");
  for (const o of sel.options) if (o.value) o.textContent = listName(o.value);
  const dead = current && t.unused(store.project.version).includes(current);
  const others = current ? treeUsers(spec, current).length - 1 : 0;
  return h(
    "section",
    { class: "card" },
    h("h4", {}, title),
    h("div", { class: "row" }, field("Set", sel), choiceBack(current, base, choose)),
    dead ? h("p", { class: "hint warn" }, "Gold and Silver never use this set (only Crystal does): pick another for this game.") : null,
    current
      ? sharedNote(`${what} rolls from the ${listName(current)} set${others > 0 ? `, shared with the trees and rocks of ${others} other map${others === 1 ? "" : "s"}` : ""}.`, "treesets", "Headbutt & Rock Smash sets", current)
      : h("p", { class: "hint" }, `${what} finds nothing.`),
    ...(current ? treeLists(spec, current, mapKind === t.rocks, false) : []),
  );
}

// Global › Headbutt & Rock Smash sets
export function treeSetCards(spec: TimedEncounterSpec): HTMLElement[] {
  const t = spec.trees!;
  const unused = t.unused(store.project.version);
  return Object.keys(kindTable(spec, t.sets)).sort().map((setId) => {
    const users = treeUsers(spec, setId);
    return h(
      "section",
      { class: "card", "data-shared-list": setId },
      h("h4", {}, listName(setId)),
      unused.includes(setId) ? h("p", { class: "hint warn" }, "This game never rolls this set: a map using it finds nothing.") : null,
      usedBy(users),
      ...treeLists(spec, setId, false, true),
      listBack(spec, t.sets, setId, `Set ${listName(setId)}`, users.length),
    );
  });
}
