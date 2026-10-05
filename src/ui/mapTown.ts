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
import type { TownSpec } from "../games/types.ts";
import type { MapView } from "../render/mapView.ts";
import { comboInput, h, numberInput, selectInput, toast } from "./dom.ts";
import { idBase, newTextId, pointerEntry, type PointerEntry } from "./mapText.ts";
import { nav } from "./nav.ts";
import { counterId, counters, freshCounter, prizeCounterEditor } from "./prizeEditor.ts";

type Role = "" | "mart" | "nurse" | "pc" | "prizes";

const ROLE_LABEL: Record<Role, string> = { "": "Normal (says its text)", mart: "Shop clerk", nurse: "Nurse (heals)", pc: "PC", prizes: "Prize counter" };

function spec(): TownSpec | undefined {
  return store.adapter?.towns;
}

function roleOf(s: TownSpec, mapId: string, label: string, textId: string): Role {
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

export function roleSection(map: MapDef, entity: EntityRecord, kind: string, index: number, setTextId: (id: string) => void): HTMLElement | null {
  const s = spec();
  if (!s) return null;
  const label = typeof map.label === "string" ? map.label : "";
  const wrap = h("div", { class: "field-group" }, h("h4", {}, "Role"));
  if (!label) {
    wrap.append(h("p", { class: "hint warn" }, "Give the map a Label (map properties) to set a role."));
    return wrap;
  }
  const textId = typeof entity.text === "string" && /^TEXT_[A-Z0-9_]+$/.test(entity.text) ? entity.text : "";
  const role = textId ? roleOf(s, map.id, label, textId) : "";
  const cid = textId ? counterId(map.id, textId) : "";
  const vanillaCounter = !!cid && store.baseTable(s.prizeRegistry)[cid] !== undefined;
  const roles: Role[] = kind === "sign" ? ["", "prizes"] : ["", "mart", "nurse", "pc", "prizes"];

  const setRole = (next: Role) => {
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
}

interface FieldTable {
  hiddenExtras?: { pcTiles?: Record<string, Spot[]> };
  flyWarps?: Record<string, Spot>;
}

function fieldTable(s: TownSpec): FieldTable {
  return store.table(s.fieldRegistry) as FieldTable;
}

function setPcs(s: TownSpec, mapId: string, what: string, pcs: Spot[]): void {
  store.editRecord<Record<string, unknown>>(s.fieldRegistry, "hiddenExtras", what, (d) => {
    const tiles = { ...((d.pcTiles as Record<string, Spot[]> | undefined) ?? {}) };
    if (pcs.length) tiles[mapId] = pcs;
    else delete tiles[mapId];
    d.pcTiles = tiles;
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

  // Pokémon Center PCs
  const pcs = clone(f.hiddenExtras?.pcTiles?.[map.id] ?? []);
  const pcRows = pcs.map((pc, i) => {
    const facing = selectInput(pc.facing ?? "", ["up", "down", "left", "right"], (v) => setPcs(s, map.id, "PC facing", pcs.map((x, j) => (j === i ? { ...x, facing: v || undefined } : x))), "any side");
    return h(
      "div",
      { class: "row nowrap pc-row" },
      numberInput(pc.x, (v) => setPcs(s, map.id, "Move PC", pcs.map((x, j) => (j === i ? { ...x, x: v } : x))), 0, map.width * 2 - 1),
      h("span", { class: "x" }, ","),
      numberInput(pc.y, (v) => setPcs(s, map.id, "Move PC", pcs.map((x, j) => (j === i ? { ...x, y: v } : x))), 0, map.height * 2 - 1),
      facing,
      h("button", { class: "btn small ghost", title: "Remove PC", onclick: () => setPcs(s, map.id, "Remove PC", pcs.filter((_, j) => j !== i)) }, "✕"),
    );
  });
  out.push(
    h("h4", {}, "Pokémon Center"),
    ...pcRows,
    h(
      "div",
      { class: "row" },
      h("button", { class: "btn small", onclick: () => pick(view, "PC", (x, y) => setPcs(s, map.id, "Add PC", [...pcs, { x, y, facing: "up" }])) }, "+ PC (pick on map)"),
    ),
    h("p", { class: "hint" }, "A PC tile opens Bill's PC when the player faces it (facing: the way the player looks, usually up). The nurse and shop clerk are NPCs: select one and set its Role."),
  );

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
