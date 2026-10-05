// Town pieces in the Maps inspector:
// - an NPC's or sign's Role: shop clerk (with its stock), nurse, PC, prize
//   counter. Gen 1 keeps the first three as flags on the text pointer
//   (text_pointers[<label>][TEXT_*] = { mart = {...} | nurse | pc }); a prize
//   counter is a record in the prize registry, played by the studio helper.
// - map properties: Pokémon Center PC tiles (field.hiddenExtras.pcTiles) and
//   the town's landing spot (field.flyWarps), where Teleport, Dig, Escape Rope
//   and blacking out put the player after healing at a center in the town.

import { clone } from "../core/merge.ts";
import { store } from "../core/store.ts";
import type { EntityRecord, MapDef } from "../core/types.ts";
import type { HiddenKind, TownSpec } from "../games/types.ts";
import type { MapView } from "../render/mapView.ts";
import { comboInput, h, numberInput, selectInput, toast } from "./dom.ts";
import { idBase, newTextId, pointerEntry, type PointerEntry } from "./mapText.ts";
import { nav } from "./nav.ts";
import { textEditor } from "./textField.ts";
import { counterId, counters, freshCounter, prizeCounterEditor } from "./prizeEditor.ts";
import { createEvent, eventId, gameTalkEvent, splitEventId, studioEvent, studioEventsOf } from "./eventEditor.ts";
import { buildTrainer, currentSetup, facingOf, isStale, removeTrainer, trainerEventOf, type TrainerSetup } from "./trainerEvents.ts";

type Role = "" | "mart" | "nurse" | "pc" | "prizes" | "event" | "trainer";

const ROLE_LABEL: Record<Role, string> = { "": "Normal (says its text)", trainer: "Trainer (battles)", event: "Event (runs commands)", mart: "Shop clerk", nurse: "Nurse (heals)", pc: "PC", prizes: "Prize counter" };

function spec(): TownSpec | undefined {
  return store.adapter?.towns;
}

function roleOf(s: TownSpec, mapId: string, label: string, textId: string): Role {
  if (studioEvent(eventId(mapId, "talk", textId))) return "event";
  const e = pointerEntry(label, textId);
  if (Array.isArray(e?.mart)) return "mart";
  if (e?.nurse) return "nurse";
  if (e?.pc) return "pc";
  if (counters(s)[counterId(mapId, textId)]) return "prizes";
  return "";
}

function editPointer(s: TownSpec, label: string, textId: string, what: string, mutate: (e: PointerEntry) => void): void {
  store.editRecord<Record<string, PointerEntry>>(s.pointerRegistry, label, what, (d) => {
    const e = { ...(d[textId] ?? {}) };
    mutate(e);
    d[textId] = e;
  }, { create: () => ({}) });
}

export function roleSection(map: MapDef, entity: EntityRecord, kind: string, index: number, setTextId: (id: string) => void, editEntity?: (label: string, mutate: (e: EntityRecord) => void) => void): HTMLElement | null {
  const s = spec();
  if (!s) return null;
  const label = typeof map.label === "string" ? map.label : "";
  const wrap = h("div", { class: "field-group" }, h("h4", {}, "Role"));
  if (!label) {
    wrap.append(h("p", { class: "hint warn" }, "Give the map a Label (map properties) to set a role."));
    return wrap;
  }
  const textId = typeof entity.text === "string" && /^TEXT_[A-Z0-9_]+$/.test(entity.text) ? entity.text : "";
  const role: Role = kind === "npc" && typeof entity.trainerClass === "string" ? "trainer" : textId ? roleOf(s, map.id, label, textId) : "";
  const cid = textId ? counterId(map.id, textId) : "";
  const vanillaCounter = !!cid && store.baseTable(s.prizeRegistry)[cid] !== undefined;
  const roles: Role[] = kind === "sign" ? ["", "event", "prizes"] : ["", "trainer", "event", "mart", "nurse", "pc", "prizes"];

  const setRole = (next: Role) => {
    if (next === "trainer" || role === "trainer") return setTrainerRole(map, entity, index, next === "trainer", setTextId, editEntity);
    store.group(`Role: ${ROLE_LABEL[next]}`, () => {
      let id = textId;
      if (!id) {
        id = newTextId(map, label, idBase(map, entity, kind, index));
        setTextId(id);
      }
      editPointer(s, label, id, "Role", (e) => {
        delete e.mart;
        delete e.nurse;
        delete e.pc;
        if (next === "mart") e.mart = [];
        if (next === "nurse") e.nurse = true;
        if (next === "pc") e.pc = true;
      });
      const c = counterId(map.id, id);
      // an event: starts by saying what the NPC said so far
      const ev = eventId(map.id, "talk", id);
      if (next === "event" && !studioEvent(ev)) {
        const said = pointerEntry(label, id)?.text;
        createEvent(map.id, "talk", id, { rows: [...(kind === "sign" ? [] : [["face_player"]]), ["show_text", typeof said === "string" ? said : "..."]] });
      }
      if (next !== "event" && studioEvent(ev)) store.setRecord(store.adapter.events!.registry, ev, "Remove event", undefined);
      if (next === "prizes" && !counters(s)[c]) store.setRecord(s.prizeRegistry, c, "Prize counter", freshCounter(s));
      if (next !== "prizes" && counters(s)[c] && store.baseTable(s.prizeRegistry)[c] === undefined) store.setRecord(s.prizeRegistry, c, "Remove prize counter", undefined);
    });
    store.seal();
  };

  if (vanillaCounter) {
    wrap.append(h("p", { class: "hint" }, "One of the game's prize counters."));
  } else {
    const sel = selectInput(role, roles, (v) => setRole(v as Role));
    for (const o of sel.options) o.textContent = ROLE_LABEL[o.value as Role];
    wrap.append(sel);
  }

  if (role === "trainer") wrap.append(...trainerFields(map, entity, index, setTextId, editEntity));
  if (role === "event") {
    const ev = studioEvent(eventId(map.id, "talk", textId));
    wrap.append(
      h(
        "div",
        { class: "row" },
        h("span", { class: "hint" }, `Runs ${ev?.rows.length ?? 0} command row(s) instead of just saying its text.`),
        h("button", { class: "btn small primary-ish", onclick: () => nav.openEvent(eventId(map.id, "talk", textId)) }, "Edit event →"),
      ),
    );
  }
  if (role === "" && textId && gameTalkEvent(map.id, textId) !== undefined) {
    wrap.append(
      h(
        "div",
        { class: "row" },
        h("span", { class: "hint" }, `The game runs its own event here${gameTalkEvent(map.id, textId) ? "" : " (code)"}.`),
        h("button", { class: "btn small ghost", onclick: () => nav.openEvent(`game:${map.id}:talk:${textId}`) }, "View →"),
      ),
    );
  }
  if (role === "mart") wrap.append(stockEditor(s, label, textId));
  if (role === "nurse") wrap.append(h("p", { class: "hint" }, "Heals the party. The town outside this center becomes where Teleport, Dig, Escape Rope and blacking out return to: set its landing spot in that town's map properties."));
  if (role === "pc") wrap.append(h("p", { class: "hint" }, "Opens the PC when talked to. A Pokémon Center's PC is usually a tile instead: add it in the map properties."));
  if (role === "prizes") {
    wrap.append(
      prizeCounterEditor(s, cid),
      h("p", { class: "hint" }, "Coins for prizes, in the game's prize window (three prizes). Mods with prize counters get the engine_internals permission."),
    );
  }
  return wrap;
}

// the clerk's stock: same list the Items workspace's "Sold at" edits
function stockEditor(s: TownSpec, label: string, textId: string): HTMLElement {
  const stock = (pointerEntry(label, textId)?.mart as string[] | undefined) ?? [];
  const items = store.table("items") as Record<string, { name?: string }>;
  const setStock = (what: string, next: string[]) => {
    editPointer(s, label, textId, what, (e) => (e.mart = next));
    store.seal();
  };
  const ids = Object.keys(items).sort();
  const rows = stock.map((id, i) =>
    h(
      "div",
      { class: "stock-row" },
      h("button", { class: "linkish", title: "Open in Items", onclick: () => nav.openItem(id) }, String(items[id]?.name ?? id)),
      h("button", { class: "btn small ghost", title: "Move up", disabled: i === 0, onclick: () => setStock("Shop stock", stock.map((x, j) => (j === i - 1 ? stock[i] : j === i ? stock[i - 1] : x))) }, "↑"),
      h("button", { class: "btn small ghost", title: "Remove", onclick: () => setStock("Shop stock", stock.filter((_, j) => j !== i)) }, "✕"),
    ),
  );
  const add = comboInput("", "dl-stock-items", ids, (v) => {
    if (ids.includes(v) && !stock.includes(v)) setStock("Shop stock", [...stock, v]);
  });
  add.placeholder = "Add an item…";
  return h(
    "div",
    { class: "stock" },
    ...(rows.length ? rows : [h("p", { class: "hint" }, "Sells nothing yet.")]),
    add,
  );
}

// ------------------------------------------------------------------ map properties

interface Spot {
  x: number;
  y: number;
  facing?: string;
  text?: string;
  textFacing?: string;
  item?: string;
  coins?: number;
}

interface FieldTable {
  flyWarps?: Record<string, Spot>;
  [key: string]: unknown;
}

function fieldTable(s: TownSpec): FieldTable {
  return store.table(s.fieldRegistry) as FieldTable;
}

// field[path...][mapId]: the map's events of one kind
function hiddenList(s: TownSpec, kind: HiddenKind, mapId: string): Spot[] {
  let node: unknown = fieldTable(s);
  for (const key of kind.path) node = (node as Record<string, unknown> | undefined)?.[key];
  return clone(((node as Record<string, Spot[]> | undefined)?.[mapId]) ?? []);
}

function setHidden(s: TownSpec, kind: HiddenKind, mapId: string, what: string, list: Spot[]): void {
  const [top, ...rest] = kind.path;
  store.editRecord<Record<string, unknown>>(s.fieldRegistry, top, what, (d) => {
    // copy the path down to the per-map table, then set or drop this map
    let node = d;
    for (const key of rest) {
      node[key] = { ...((node[key] as Record<string, unknown> | undefined) ?? {}) };
      node = node[key] as Record<string, unknown>;
    }
    if (list.length) node[mapId] = list;
    else delete node[mapId];
  }, { create: () => ({}) });
  store.seal();
}

function setLanding(s: TownSpec, mapId: string, spot: Spot | null): void {
  store.editRecord<Record<string, Spot>>(s.fieldRegistry, "flyWarps", "Landing spot", (d) => {
    if (spot) d[mapId] = spot;
    else delete d[mapId];
  }, { create: () => ({}) });
  store.seal();
}

function pick(view: MapView, what: string, onPick: (x: number, y: number) => void): void {
  toast(`Click the map to place the ${what} (Esc cancels)`, "info");
  view.pickCell(onPick);
}

export function townSection(map: MapDef, view: MapView): HTMLElement[] {
  const s = spec();
  if (!s) return [];
  const out: HTMLElement[] = [];
  const f = fieldTable(s);

  out.push(h("h4", {}, "Hidden events"), ...hiddenSection(s, map, view));
  if (store.adapter.events) out.push(h("h4", {}, "Events"), ...mapEventsSection(map, view));

  // landing spot (outdoor towns)
  if (s.isTown(map)) {
    const land = f.flyWarps?.[map.id];
    out.push(
      h("h4", {}, "Landing spot"),
      h(
        "div",
        { class: "row" },
        land ? h("span", {}, `x ${land.x}, y ${land.y}`) : h("span", { class: "muted" }, "none"),
        h("button", { class: "btn small", onclick: () => pick(view, "landing spot", (x, y) => setLanding(s, map.id, { x, y })) }, land ? "Move (pick on map)" : "Set (pick on map)"),
        land ? h("button", { class: "btn small ghost", onclick: () => setLanding(s, map.id, null) }, "Clear") : null,
      ),
      h("p", { class: "hint" }, "Where Teleport, Dig, Escape Rope and blacking out put the player after healing at a Pokémon Center in this town (usually in front of the center). Without one they land on the center's door. Flying to new towns isn't supported yet."),
    );
  }
  return out;
}

// ------------------------------------------------------------------ hidden events

const FACINGS = ["up", "down", "left", "right"];

// Everything on the map that is not an entity: PCs, bench guys, hidden items
// and coins, gym statues. One row each; "+ Add" picks the kind, then a cell.
function hiddenSection(s: TownSpec, map: MapDef, view: MapView): HTMLElement[] {
  const out: HTMLElement[] = [];
  const label = typeof map.label === "string" ? map.label : "";
  for (const kind of s.hidden) {
    const list = hiddenList(s, kind, map.id);
    list.forEach((e, i) => {
      const set = (what: string, patch: Partial<Spot>) => setHidden(s, kind, map.id, what, list.map((x, j) => (j === i ? { ...x, ...patch } : x)));
      const pos = [
        numberInput(e.x, (v) => set(`Move ${kind.label}`, { x: v }), 0, map.width * 2 - 1),
        h("span", { class: "x" }, ","),
        numberInput(e.y, (v) => set(`Move ${kind.label}`, { y: v }), 0, map.height * 2 - 1),
      ];
      const extra: HTMLElement[] = [];
      let below: HTMLElement | null = null;
      if (kind.id === "pc" || kind.id === "statue") {
        extra.push(selectInput(e.facing ?? "", FACINGS, (v) => set("Facing", { facing: v || undefined }), "any side"));
      } else if (kind.id === "item") {
        const ids = Object.keys(store.table("items")).sort();
        extra.push(comboInput(e.item ?? "", "dl-hidden-items", ids, (v) => ids.includes(v) && set("Hidden item", { item: v })));
      } else if (kind.id === "coins") {
        extra.push(selectInput(String(e.coins ?? 10), ["10", "20", "100"], (v) => set("Hidden coins", { coins: Number(v) })), h("span", { class: "muted" }, "coins"));
      } else if (kind.id === "bench") {
        // he talks when faced from this side (textFacing: the way the player looks)
        extra.push(selectInput(e.textFacing ?? e.facing ?? "left", FACINGS, (v) => set("Bench guy facing", { facing: v, textFacing: v })));
        below = benchText(s, map, label, e, (text) => set("Bench guy text", { text }));
      }
      const row = h(
        "div",
        { class: "hidden-row" },
        h("span", { class: "hidden-kind", title: kind.hint }, kind.label),
        h("div", { class: "row nowrap" }, ...pos, ...extra),
        h("button", { class: "btn small ghost", title: "Show it", onclick: () => view.centerOnCell(e.x, e.y) }, "◎"),
        h("button", { class: "btn small ghost", title: `Remove ${kind.label}`, onclick: () => setHidden(s, kind, map.id, `Remove ${kind.label}`, list.filter((_, j) => j !== i)) }, "✕"),
      );
      out.push(row);
      if (below) out.push(below);
    });
  }
  if (!out.length) out.push(h("p", { class: "hint" }, "None on this map."));

  const kinds = h("select", {}, ...s.hidden.map((k) => h("option", { value: k.id, title: k.hint }, k.label)));
  const hint = h("p", { class: "hint" }, s.hidden[0]?.hint ?? "");
  kinds.addEventListener("change", () => (hint.textContent = s.hidden.find((k) => k.id === kinds.value)?.hint ?? ""));
  out.push(
    h(
      "div",
      { class: "row" },
      kinds,
      h("button", {
        class: "btn small",
        onclick: () => {
          const kind = s.hidden.find((k) => k.id === kinds.value);
          if (!kind) return;
          pick(view, kind.label.toLowerCase(), (x, y) => {
            const list = hiddenList(s, kind, map.id);
            setHidden(s, kind, map.id, `Add ${kind.label}`, [...list, freshHidden(kind, map, label, x, y)]);
          });
        },
      }, "+ Add (pick on map)"),
    ),
    hint,
  );
  return out;
}

function freshHidden(kind: HiddenKind, map: MapDef, label: string, x: number, y: number): Spot {
  switch (kind.id) {
    case "pc":
    case "statue":
      return { x, y, facing: "up" };
    case "item":
      return { x, y, item: "POTION" };
    case "coins":
      return { x, y, coins: 10 };
    case "bench": {
      // a text label of its own: <MapLabel>BenchGuyText[N]
      const base = `${label || map.id}BenchGuyText`;
      const taken = new Set(benchLabels());
      let text = base;
      for (let n = 2; taken.has(text); n++) text = `${base}${n}`;
      return { x, y, facing: "left", textFacing: "left", text };
    }
  }
}

function benchLabels(): string[] {
  const s = spec()!;
  const kind = s.hidden.find((k) => k.id === "bench");
  if (!kind) return [];
  let node: unknown = fieldTable(s);
  for (const key of kind.path) node = (node as Record<string, unknown> | undefined)?.[key];
  return Object.values((node as Record<string, Spot[]> | undefined) ?? {}).flat().map((b) => b.text ?? "");
}

// what a bench guy says: his text in place, or a button that creates it
function benchText(s: TownSpec, map: MapDef, label: string, e: Spot, setLabel: (text: string) => void): HTMLElement {
  const wrap = h("div", { class: "hidden-text" });
  const textLabel = e.text ?? "";
  const key = textLabel ? s.benchText(textLabel) : "";
  const text = store.table("text");
  if (key && typeof text[key] === "string") {
    wrap.append(textEditor(key, { rows: 3, compact: true, label: key }));
    return wrap;
  }
  wrap.append(
    h(
      "div",
      { class: "row" },
      h("span", { class: "hint" }, textLabel ? `No text for ${textLabel} yet.` : "No text yet."),
      h("button", {
        class: "btn small primary-ish",
        onclick: () => {
          const name = textLabel || `${label || map.id}BenchGuyText`;
          store.group("Bench guy text", () => {
            if (!textLabel) setLabel(name);
            store.setRecord("text", s.benchText(name), "New text", "...{DONE}");
          });
          store.seal();
        },
      }, "Create text"),
    ),
  );
  return wrap;
}

// ------------------------------------------------------------------ map events

// The map's step and enter events (talk events live on their NPC or sign).
function mapEventsSection(map: MapDef, view: MapView): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const id of studioEventsOf(map.id)) {
    const { kind } = splitEventId(id);
    if (kind === "talk") continue;
    const ev = studioEvent(id)!;
    out.push(
      h(
        "div",
        { class: "row" },
        h("span", {}, kind === "step" ? `Step on ${ev.x}, ${ev.y}` : "On entering", ev.once ? h("span", { class: "muted" }, " · once") : null),
        kind === "step" ? h("button", { class: "btn small ghost", title: "Show it", onclick: () => view.centerOnCell(ev.x ?? 0, ev.y ?? 0) }, "◎") : null,
        h("button", { class: "btn small primary-ish", onclick: () => nav.openEvent(id) }, "Edit →"),
      ),
    );
  }
  out.push(
    h(
      "div",
      { class: "row" },
      h("button", {
        class: "btn small",
        onclick: () => pick(view, "step event", (x, y) => {
          const id = createEvent(map.id, "step", `at_${x}_${y}`, { x, y, once: true });
          if (id) nav.openEvent(id);
        }),
      }, "+ Step event (pick on map)"),
      h("button", {
        class: "btn small",
        onclick: () => {
          const n = studioEventsOf(map.id).filter((k) => splitEventId(k).kind === "enter").length + 1;
          const id = createEvent(map.id, "enter", `enter_${n}`);
          if (id) nav.openEvent(id);
        },
      }, "+ On enter"),
    ),
    h("p", { class: "hint" }, "Commands that run when the player steps on a cell or enters the map. NPC and sign events: select one, Role: Event."),
  );
  return out;
}

// ------------------------------------------------------------------ trainers

type EditEntity = ((label: string, mutate: (e: EntityRecord) => void) => void) | undefined;

const npcNow = (map: MapDef, index: number): EntityRecord | undefined => store.entities(store.maps[map.id] ?? map, "objects")[index];

// a trainer of the game itself: its header (sight, texts) comes from the game
function isGameTrainer(map: MapDef, e: EntityRecord): boolean {
  const base = store.base[map.id];
  return !!base && store.entities(base, "objects").some((o) => o.index === e.index && typeof o.trainerClass === "string");
}

function setTrainerRole(map: MapDef, entity: EntityRecord, index: number, on: boolean, setTextId: (id: string) => void, editEntity: EditEntity): void {
  if (!editEntity) return;
  const classes = Object.keys(store.table(store.adapter.trainers?.registry ?? "trainers")).sort();
  store.group(on ? "Make trainer" : "Remove trainer", () => {
    if (on) {
      editEntity("Make trainer", (e) => {
        e.trainerClass = classes.includes("OPP_YOUNGSTER") ? "OPP_YOUNGSTER" : classes[0];
        e.trainerParty = 1;
        delete e.text_asm;
      });
      const e = npcNow(map, index);
      const setup = e && currentSetup(map, e);
      if (e && setup && !isGameTrainer(map, e)) buildTrainer(map, e, index, setup, setTextId);
    } else {
      removeTrainer(map, entity);
      editEntity("Remove trainer", (e) => {
        delete e.trainerClass;
        delete e.trainerParty;
      });
    }
  });
  store.seal();
}

// the encounter music: the game's choice for the class, another one, or none
function musicSelect(setup: TrainerSetup, set: (music: string | undefined) => void): HTMLElement {
  const t = store.adapter.trainers;
  const auto = t?.meetTheme?.(setup.class) ?? null;
  const themes = t?.meetThemes ?? [];
  const label = (id: string | null) => (id ? (themes.find((x) => x.id === id)?.label ?? id.replace(/^Music_/, "")) : "none");
  const sel = h(
    "select",
    {},
    h("option", { value: "#auto", selected: setup.music === undefined }, `Game's choice for the class (${label(auto)})`),
    ...themes.map((x) => h("option", { value: x.id, selected: setup.music === x.id }, x.label)),
    h("option", { value: "", selected: setup.music === "" }, "None"),
  );
  sel.addEventListener("change", () => set(sel.value === "#auto" ? undefined : sel.value));
  return h("div", { class: "row nowrap" }, h("span", {}, "Encounter music"), sel);
}

// class, team, line of sight and texts of a trainer NPC
function trainerFields(map: MapDef, entity: EntityRecord, index: number, setTextId: (id: string) => void, editEntity: EditEntity): HTMLElement[] {
  const out: HTMLElement[] = [];
  const classes = Object.keys(store.table(store.adapter.trainers?.registry ?? "trainers")).sort();
  const game = isGameTrainer(map, entity);
  const ev = trainerEventOf(map, entity);
  const setup = ev?.trainer;
  // rebuild the events from the NPC as it is now (plus setup changes)
  const rebuild = (label: string, change?: Partial<TrainerSetup>, mutate?: (e: EntityRecord) => void) => {
    store.group(label, () => {
      if (mutate && editEntity) editEntity(label, mutate);
      const e = npcNow(map, index);
      const next = e && currentSetup(map, e, setup ? { ...setup, ...change } : undefined);
      if (e && next && !game) buildTrainer(map, e, index, { ...next, ...change }, setTextId);
    });
    store.seal();
  };
  const cls = comboInput(String(entity.trainerClass ?? ""), "dl-trainer-classes", classes, (v) => rebuild("Trainer class", undefined, (e) => (e.trainerClass = v)));
  const team = numberInput(Number(entity.trainerParty ?? 1), (v) => rebuild("Trainer team", undefined, (e) => (e.trainerParty = Math.max(1, v))), 1, 99);
  out.push(h("div", { class: "row nowrap" }, cls, h("span", { class: "muted" }, "team"), team, h("button", { class: "btn small ghost", onclick: () => nav.openTrainer(String(entity.trainerClass), Number(entity.trainerParty ?? 1)) }, "Team →")));
  if (game) {
    out.push(h("p", { class: "hint" }, "One of the game's trainers: its line of sight and battle texts come from the game's own data, which mods can't change."));
    return out;
  }
  if (!setup) {
    out.push(
      h(
        "div",
        { class: "row" },
        h("span", { class: "hint" }, "No line of sight or battle texts yet."),
        h("button", { class: "btn small primary-ish", onclick: () => rebuild("Trainer events") }, "Set up"),
      ),
    );
    return out;
  }
  const facing = facingOf(entity);
  const range = selectInput(String(setup.range), ["0", "1", "2", "3", "4", "5"], (v) => rebuild("Line of sight", { range: Number(v) }));
  for (const o of range.options) o.textContent = o.value === "0" ? "0 (only when talked to)" : `${o.value} cell${o.value === "1" ? "" : "s"}`;
  range.disabled = !facing;
  out.push(
    h("div", { class: "row nowrap" }, h("span", {}, "Line of sight"), range, h("span", { class: "muted" }, facing ? `looking ${facing}` : "")),
    ...(facing ? [] : [h("p", { class: "hint" }, "Only a standing NPC (Movement: STAY) can spot the player; this one walks around.")]),
    musicSelect(setup, (music) => rebuild("Encounter music", { music })),
    h("span", { class: "field-label" }, "Before the battle"),
    textEditor(setup.before, { rows: 3, compact: true, label: setup.before }),
    ...(setup.won
      ? [h("span", { class: "field-label" }, "In the battle, when it loses"), textEditor(setup.won, { rows: 3, compact: true, label: setup.won })]
      : [h("div", { class: "row" }, h("span", { class: "hint" }, "No line inside the battle yet."), h("button", { class: "btn small", onclick: () => rebuild("Lost line", { won: `_${typeof map.label === "string" ? map.label : map.id}Trainer${setup.index}EndBattleText` }) }, "Add"))]),
    h("span", { class: "field-label" }, "When talked to after losing"),
    textEditor(setup.after, { rows: 3, compact: true, label: setup.after }),
    h("div", { class: "kv" }, h("span", {}, "Beaten flag"), h("code", {}, setup.flag)),
    h("p", { class: "hint" }, "Built from events (talk, plus a step event per cell it sees): the gen1recomp way for mod trainers. Edits to these events in the Events workspace are replaced when these settings change."),
  );
  const e = npcNow(map, index);
  if (e && isStale(map, e, setup)) {
    out.push(
      h(
        "div",
        { class: "row" },
        h("span", { class: "hint warn" }, "The trainer moved, turned or changed since its events were built."),
        h("button", { class: "btn small primary-ish", onclick: () => rebuild("Update trainer events") }, "Update"),
      ),
    );
  }
  return out;
}
