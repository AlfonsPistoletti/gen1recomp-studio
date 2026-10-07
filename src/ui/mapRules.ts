// Map rules (map properties > Rules): what the engine decides per map from
// field data (gen1recomp src/world/OverworldController.lua):
//   Dark until Flash  field.darkMaps.maps
//   Bike allowed      field.bikeRiding.maps (or the map's tileset in .tilesets)
//   Badge gate        field.badgeGates[MAP] = { badge, coords, text keys }: a
//                     checkpoint; stepping on one of its cells without the
//                     badge shows a text and pushes the player one cell down
// field is deep: an added map is appended, a removal overrides the record.

import { clone } from "../core/merge.ts";
import { store } from "../core/store.ts";
import type { MapDef } from "../core/types.ts";
import { field, h } from "./dom.ts";
import { nav } from "./nav.ts";

interface DarkMaps {
  maps: string[];
  [k: string]: unknown;
}
interface BikeRiding {
  maps: string[];
  tilesets: string[];
}
interface Gate {
  badge?: string;
  coords?: { x: number; y: number }[];
  guards?: unknown[];
  text?: string;
  passText?: string;
  failText?: string;
  passedFlag?: string;
}

const fieldRec = <T>(id: string) => store.table("field")[id] as T | undefined;

function editField<T>(id: string, label: string, mutate: (d: T) => void, create: () => T): void {
  store.editRecord<T>("field", id, label, mutate, { create });
  store.seal();
}

function badges(): string[] {
  const listed = store.adapter.globals?.hmBadges?.badges;
  if (listed?.length) return listed;
  return Object.keys(store.table("items")).filter((id) => id.endsWith("BADGE")).sort();
}

const itemName = (id: string) => String((store.table("items")[id] as { name?: unknown } | undefined)?.name ?? id);

function toggle(label: string, checked: boolean, onChange: (on: boolean) => void, opts: { disabled?: boolean; title?: string } = {}): HTMLElement {
  const cb = h("input", { type: "checkbox", checked, disabled: !!opts.disabled });
  cb.addEventListener("change", () => onChange(cb.checked));
  return h("label", { class: "inline-check", title: opts.title ?? "" }, cb, label);
}

// the gate's texts: new gates get texts of their own, named after the map
function gateTextKeys(map: MapDef): { fail: string; pass: string } {
  const base = String(map.label ?? map.id).replace(/[^A-Za-z0-9]/g, "");
  return { fail: `${base}BadgeGateFailText`, pass: `${base}BadgeGatePassText` };
}

function addGate(map: MapDef, badge: string): void {
  const keys = gateTextKeys(map);
  const name = itemName(badge);
  store.group(`Badge gate on ${map.id}`, () => {
    // the engine shows "_" + key; it adds the "I can't let you pass" line
    if (store.table("text")[`_${keys.fail}`] === undefined) store.setRecord("text", `_${keys.fail}`, "Badge gate text", `You don't have the\n${name} yet!`);
    if (store.table("text")[`_${keys.pass}`] === undefined) store.setRecord("text", `_${keys.pass}`, "Badge gate text", `Oh! That is the\n${name}!\fGo right ahead!`);
    editField<Record<string, Gate>>("badgeGates", "Badge gate", (g) => {
      g[map.id] = { badge, coords: [], failText: keys.fail, passText: keys.pass };
    }, () => ({}));
  });
}

export function mapRulesSection(map: MapDef): HTMLElement[] {
  const out: HTMLElement[] = [h("h4", {}, "Rules")];

  // outdoor or indoor (map.outdoor; unset: OVERWORLD maps are outdoor)
  const mark = (map as { outdoor?: unknown }).outdoor;
  const auto = map.tileset === "OVERWORLD" ? "outdoor" : "indoor";
  const where = h("select", {},
    h("option", { value: "", selected: typeof mark !== "boolean" }, `By tileset (${auto}: ${map.tileset})`),
    h("option", { value: "out", selected: mark === true }, "Outdoor"),
    h("option", { value: "in", selected: mark === false }, "Indoor"),
  );
  where.addEventListener("change", () => {
    store.edit(map.id, "Outdoor / indoor", (d) => {
      const r = d as { outdoor?: boolean };
      if (where.value === "out") r.outdoor = true;
      else if (where.value === "in") r.outdoor = false;
      else delete r.outdoor;
    });
    store.seal();
  });
  out.push(field("Outdoor or indoor", where,
    "Outdoor: wild Pokémon only in grass and water, and Fly and Teleport can be used. Indoor (caves, towers): with an index of 37 or more, every step can meet a wild Pokémon (not on the FOREST tileset). Needs a gen1recomp from October 2026 or later."));

  // dark until Flash
  const dark = fieldRec<DarkMaps>("darkMaps");
  if (dark) {
    const on = dark.maps.includes(map.id);
    out.push(toggle("Dark until Flash", on, (v) =>
      editField<DarkMaps>("darkMaps", v ? "Dark until Flash" : "Not dark", (d) => {
        d.maps = v ? [...d.maps, map.id] : d.maps.filter((m) => m !== map.id);
      }, () => clone(dark)),
      { title: "The map is drawn dark until the player uses FLASH (like Rock Tunnel)." }));
  }

  // bike
  const bike = fieldRec<BikeRiding>("bikeRiding");
  if (bike) {
    const byTileset = bike.tilesets.includes(String(map.tileset));
    const on = byTileset || bike.maps.includes(map.id);
    out.push(toggle(byTileset ? `Bike allowed (every ${map.tileset} map)` : "Bike allowed", on, (v) =>
      editField<BikeRiding>("bikeRiding", v ? "Bike allowed" : "No bike", (d) => {
        d.maps = v ? [...d.maps, map.id] : d.maps.filter((m) => m !== map.id);
      }, () => clone(bike)),
      { disabled: byTileset, title: byTileset ? `The bike is allowed on every map with the ${map.tileset} tileset.` : "Whether the player can ride the bike here." }));
  }

  // badge gate
  const gates = fieldRec<Record<string, Gate>>("badgeGates") ?? {};
  const gate = gates[map.id];
  if (gate?.guards) {
    out.push(h("p", { class: "hint" }, "Badge gate: guards check one badge each, row by row (like Route 23). The studio shows but doesn't edit this kind."));
  } else if (gate) {
    const sel = h("select", {}, ...badges().map((b) => h("option", { value: b, selected: b === gate.badge }, itemName(b))));
    sel.addEventListener("change", () => editField<Record<string, Gate>>("badgeGates", "Badge gate badge", (g) => (g[map.id] = { ...g[map.id], badge: sel.value }), () => ({})));
    const cells = (gate.coords ?? []).map((c, i) =>
      h("span", { class: "chip" }, `${c.x}, ${c.y}`,
        h("button", { class: "btn small ghost", title: "Remove this cell", onclick: () => editField<Record<string, Gate>>("badgeGates", "Badge gate cell", (g) => (g[map.id] = { ...g[map.id], coords: (g[map.id].coords ?? []).filter((_c, j) => j !== i) }), () => ({})) }, "✕")),
    );
    const pick = h("button", {
      class: "btn small",
      onclick: () => nav.pickCell(map.id, (x, y) => editField<Record<string, Gate>>("badgeGates", "Badge gate cell", (g) => (g[map.id] = { ...g[map.id], coords: [...(g[map.id].coords ?? []), { x, y }] }), () => ({}))),
    }, "+ Pick a cell");
    out.push(h("div", { class: "card" },
      h("div", { class: "card-head" }, h("h4", {}, "Badge gate"),
        h("button", { class: "btn small ghost danger", onclick: () => editField<Record<string, Gate>>("badgeGates", "Remove badge gate", (g) => delete g[map.id], () => ({})) }, "Remove")),
      field("Badge", sel),
      h("div", { class: "row wrap" }, ...cells, pick),
      h("p", { class: "hint" }, "Stepping on one of these cells without the badge shows the text and pushes the player one cell down, so the gate is crossed going up. With the badge, the guard waves them through once."),
      h("div", { class: "row wrap" },
        gate.failText ? h("button", { class: "btn small ghost", onclick: () => nav.openText(`_${gate.failText}`) }, "Edit 'no badge' text") : null,
        gate.passText ? h("button", { class: "btn small ghost", onclick: () => nav.openText(`_${gate.passText}`) }, "Edit 'go ahead' text") : null,
      ),
    ));
  } else {
    const sel = h("select", {}, h("option", { value: "" }, "+ Badge gate…"), ...badges().map((b) => h("option", { value: b }, itemName(b))));
    sel.title = "Stop the player at chosen cells until they have a badge (like the Route 22 gate)";
    sel.addEventListener("change", () => sel.value && addGate(map, sel.value));
    out.push(sel);
  }
  return out;
}
