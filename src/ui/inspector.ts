// Right sidebar, BASE tab, lower half: properties of the selection or the map.
// Forms are generated from the adapter's FieldSpecs, so a new game only
// declares its fields.

import { areaBrushPanel, cellPanel } from "./mapAreas.ts";
import { extKind, extKindCard } from "./extFields.ts";
import { fieldDefault } from "../project/extensions.ts";
import { OPPOSITE, resizeBlocks } from "../core/geometry.ts";
import { clone, deepEqual } from "../core/merge.ts";
import { afterStroke, store } from "../core/store.ts";
import { DIRECTIONS, type Direction, type EntityRecord, type MapDef } from "../core/types.ts";
import type { EntityLayer, FieldSpec } from "../games/types.ts";
import type { MapView } from "../render/mapView.ts";
import { clear, comboInput, field, h, numberInput, rerender, selectInput, toast, errorText, onFocusLeave } from "./dom.ts";
import { npcTextSection } from "./mapText.ts";
import { gen1Roles, townSection } from "./mapTown.ts";
import { roleBox, type RoleCtx, type RoleSet } from "./roles.ts";
import { freshRole, gen2Roles } from "./roles2.ts";
import { changedParts, resetMapDialog } from "./mapReset.ts";
import { nav } from "./nav.ts";
import { createEvent, eventId } from "./eventEditor.ts";
import { songLabel } from "./soundEditor.ts";
import { warpProblem } from "../core/checks.ts";
import { liveTileset, tilesetIds } from "../core/tilesets.ts";
import { mapRulesSection } from "./mapRules.ts";
import { mapScenesSection } from "./mapScenes.ts";
import { FEATURES } from "../features.ts";
import { gameRoof, gbcAvailable, ROOFS, roofColors, tilesetHasRoof, townRoofs, type RoofRecord } from "../core/gbc.ts";
import type { Rgb } from "../render/color.ts";

type Rec = Record<string, unknown>;
type Edit = (label: string, mutate: (record: Rec) => void) => void;

// Properties of the selected warp/NPC/sign, or of the map. Lives in the
// BASE tab of the right panel, under the block palette.
export function mountInspector(host: HTMLElement, view: MapView): void {
  const title = h("span", {}, "Properties");
  const body = h("div", { class: "inspector" });
  host.append(h("div", { class: "panel-head" }, title), body);

  let scheduled = false;
  const render = () => {
    scheduled = false;
    const map = store.map;
    if (!map) {
      clear(body);
      return;
    }
    rerender(body, () => {
      if (store.tool === "area") {
        title.textContent = `Paint · ${extKind(store.areaBrush?.kind)?.label ?? "area"}`;
        return areaBrushPanel();
      }
      const cellSel = store.cellSelection;
      const cell = cellSel ? cellPanel(map, cellSel) : null;
      if (cellSel && cell) {
        title.textContent = extKind(cellSel.kind)?.label ?? "Painted cell";
        return cell;
      }
      const sel = store.selection;
      const layer = sel ? store.adapter.layers.find((l) => l.key === sel.layer) : undefined;
      if (sel && layer && store.entities(map, layer.key)[sel.index]) {
        const own = extKind((store.entities(map, layer.key)[sel.index].custom as Rec | undefined)?.kind);
        title.textContent = `${own?.label ?? layer.singular} ${sel.index + 1}`;
        return entityForm(map, layer, sel.index, view);
      }
      title.textContent = `Map · ${map.id}`;
      return mapForm(map, view);
    });
  };
  const schedule = () => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(render);
    }
  };
  const afterBrush = afterStroke(schedule);
  store.on((reason, _id, registry) => {
    if (store.midStroke(reason)) afterBrush();
    else if (["project", "map", "edit", "selection", "tool", "scene"].includes(reason)) schedule();
    const towns = store.adapter?.towns;
    if (reason === "content" && (registry === "text" || registry === "text_pointers" || registry === "map_songs" || registry === "studio_roofs" || registry === "palettes" || registry === "encounters" || registry === "field" || registry === store.adapter?.events?.registry || registry === towns?.fieldRegistry || registry === towns?.prizeRegistry || registry === "items")) schedule();
  });
  onFocusLeave(body, schedule);
}

function editMap(label: string, mutate: (d: MapDef) => void): void {
  store.edit(store.currentMap, label, mutate);
  store.seal();
}

// ---------------------------------------------------------------- fields

// Keys a set of specs edits (so "extras" can show everything else).
// an object the game picks up (gen1recomp talkTo: `item`, not pokered's "0")
export const isItemBall = (r: Rec): boolean => r.item !== undefined && r.item !== "0" && r.item !== 0;

function claimedKeys(specs: FieldSpec[], out = new Set<string>(["x", "y"])): Set<string> {
  for (const s of specs) {
    if (s.kind === "pair") claimedKeys(s.fields, out);
    else if (s.kind === "warpTarget") out.add(s.mapKey).add(s.warpKey);
    else if (s.kind !== "extras" && s.kind !== "weekdays" && s.kind !== "info") out.add(s.key.split(".")[0]);
  }
  return out;
}

// a field key may be a dotted path into the record ("radius.x", "hours.0")
function getPath(r: Rec, key: string): unknown {
  return key.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Rec)[k] : undefined), r);
}
function setPath(r: Rec, key: string, value: unknown): void {
  const parts = key.split(".");
  let at = r;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    const next = at[k];
    // copy the nested table: the record is a draft, its children may be shared
    at[k] = Array.isArray(next) ? [...next] : next && typeof next === "object" ? { ...(next as Rec) } : /^\d+$/.test(parts[i + 1]) ? [] : {};
    at = at[k] as Rec;
  }
  const last = parts[parts.length - 1];
  if (value === undefined) delete at[last];
  else at[last] = value;
}

function renderField(spec: FieldSpec, record: Rec, edit: Edit, all: FieldSpec[], view: MapView): HTMLElement | null {
  switch (spec.kind) {
    case "pair":
      return h("div", { class: "row two" }, ...spec.fields.map((f) => renderField(f, record, edit, all, view)));
    case "text": {
      const input = h("input", { type: "text", value: (getPath(record, spec.key) as string) ?? "", spellcheck: false });
      input.addEventListener("change", () => edit(spec.label, (r) => setPath(r, spec.key, input.value || undefined)));
      return field(spec.label, input, spec.hint);
    }
    case "int":
      return field(spec.label, numberInput(getPath(record, spec.key) as number | undefined, (v) => edit(spec.label, (r) => setPath(r, spec.key, v)), spec.min, spec.max), spec.hint);
    case "select": {
      const empty = typeof spec.emptyLabel === "function" ? spec.emptyLabel(record, store.ctx) : spec.emptyLabel;
      // a number (Gen 2's variable sprites) shows as its own entry, not as the list's first
      const raw = getPath(record, spec.key);
      // a Gen 2 script given inline (an event): its Event section shows it
      if (Array.isArray(raw)) return null;
      const value = typeof raw === "string" || typeof raw === "number" ? String(raw) : "";
      const map = store.map;
      const sel = selectInput(value, spec.options(store.ctx, map), (v) =>
        edit(spec.label, (r) => setPath(r, spec.key, v === "" ? undefined : spec.numeric ? Number(v) : v)), empty);
      if (spec.labels) for (const o of sel.options) if (o.value) o.textContent = spec.labels(o.value, store.ctx, map) ?? o.value;
      return field(spec.label, sel, spec.hint);
    }
    case "warpTarget":
      return warpTarget(spec, record, edit, view);
    case "info": {
      const sel = store.selection;
      const text = sel && store.map ? spec.text(store.map, sel.index, store.ctx) : null;
      return text ? field(spec.label, h("p", { class: "hint" }, text), spec.hint) : null;
    }
    case "weekdays": {
      const sel = store.selection;
      const map = store.map;
      if (!sel || !map) return null;
      const cur = spec.get(map, sel.index, store.ctx);
      const on = new Set(cur ?? spec.days.map((_, i) => i));
      const boxes = spec.days.map((d, i) => {
        const box = h("input", { type: "checkbox", checked: on.has(i) });
        box.addEventListener("change", () => {
          const next = new Set(on);
          if (box.checked) next.add(i);
          else next.delete(i);
          const days = next.size === spec.days.length ? null : [...next].sort((a, b) => a - b);
          store.edit(store.currentMap, spec.label, (draft) => spec.set(draft, sel.index, days, store.ctx));
          store.seal();
        });
        return h("label", { class: "inline-check" }, box, d.slice(0, 3));
      });
      return field(spec.label, h("div", { class: "row wrap" }, ...boxes), spec.hint);
    }
    case "extras": {
      // an item ball's item is edited in its Role (mapTown.ts)
      const claimed = claimedKeys(all);
      if (isItemBall(record)) claimed.add("item");
      // a known mod kind's values are edited in its own card
      if (extKind((record.custom as Rec | undefined)?.kind)) claimed.add("custom");
      return extrasField(spec, record, edit, claimed);
    }
  }
}

// Connect a warp to a cell of another map, both ways: the other map gets a
// warp there (made when missing) leading back to this one, and this one
// leads to it. Warps beside each one that went to the same place (a two-
// cell mat, a double door) follow along. Map ids are written on both sides
// (the game's exits often say LAST_MAP; an explicit map works everywhere).
function connectWarps(spec: Extract<FieldSpec, { kind: "warpTarget" }>, fromMap: string, fromIndex: number, toMap: string, x: number, y: number): void {
  const layer = store.adapter.layers.find((l) => l.kind === "warp")!;
  const same = (a: Rec, b: Rec) => a[spec.mapKey] === b[spec.mapKey] && a[spec.warpKey] === b[spec.warpKey];
  // the warp at `i` and its neighbours in the same row that went where it went
  const group = (list: Rec[], i: number) => list
    .map((_, k) => k)
    .filter((k) => k === i || (list[k].y === list[i].y && Math.abs((list[k].x as number) - (list[i].x as number)) === 1 && same(list[k], list[i])));
  if (fromMap === toMap) return void toast("Pick a cell on another map", "error");
  let toIndex = -1;
  store.group(`Connect ${fromMap} and ${toMap}`, () => {
    store.edit(toMap, "Connect door", (d) => {
      const list = store.entities(d, layer.key) as Rec[];
      toIndex = list.findIndex((w) => w.x === x && w.y === y);
      if (toIndex < 0) {
        list.push(layer.create(d, x, y, store.ctx));
        toIndex = list.length - 1;
        d[layer.key] = list;
      }
      for (const k of group(list, toIndex)) {
        list[k][spec.mapKey] = fromMap;
        list[k][spec.warpKey] = fromIndex + 1;
      }
    });
    store.edit(fromMap, "Connect door", (d) => {
      const list = store.entities(d, layer.key) as Rec[];
      for (const k of group(list, fromIndex)) {
        list[k][spec.mapKey] = toMap;
        list[k][spec.warpKey] = toIndex + 1;
      }
    });
  });
  store.seal();
  nav.selectEntity(fromMap, layer.key, fromIndex);
  toast(`${fromMap} warp ${fromIndex + 1} ↔ ${toMap} warp ${toIndex + 1}`, "ok");
}

function warpTarget(spec: Extract<FieldSpec, { kind: "warpTarget" }>, record: Rec, edit: Edit, view: MapView): HTMLElement {
  const layer = store.adapter.layers.find((l) => l.kind === "warp")!;
  const destId = String(record[spec.mapKey] ?? "");
  const destNum = Number(record[spec.warpKey] ?? 1);
  const dest = store.maps[destId];
  const ids = [...spec.specialMaps, ...Object.keys(store.maps).sort()];
  const mapSelect = selectInput(destId, ids, (v) => edit("Warp target", (r) => (r[spec.mapKey] = v || spec.specialMaps[0])));
  let warpControl: HTMLElement;
  const isBack = destNum === spec.backWarp;
  if (dest) {
    const sel = h(
      "select",
      {},
      ...store.entities(dest, layer.key).map((w, i) =>
        h("option", { value: i + 1, selected: i + 1 === destNum }, `${i + 1}  (${w.x}, ${w.y}) → ${String(w[spec.mapKey] ?? "")}`),
      ),
      ...(spec.backWarp !== undefined ? [h("option", { value: spec.backWarp, selected: isBack }, "Back where the player came from")] : []),
    );
    sel.addEventListener("change", () => edit("Warp target", (r) => (r[spec.warpKey] = Number(sel.value))));
    warpControl = sel;
  } else {
    warpControl = numberInput(destNum, (v) => edit("Warp target", (r) => (r[spec.warpKey] = v)), 1, 255);
  }
  const back = dest ? store.entities(dest, layer.key)[destNum - 1] : undefined;
  const index = store.selection?.index ?? 0;
  const backTo = back ? String(back[spec.mapKey] ?? "") : "";
  const problem = warpProblem(store.adapter, store.maps, store.currentMap, index);
  // the game only takes a warp standing on a warp tile (Gen 2: door, stairs, cave, mat)
  const here = store.map;
  const onWarpTile = here ? store.adapter.cell(here, liveTileset(here.tileset), Number(record.x), Number(record.y)).warp : undefined;
  return h(
    "div",
    { class: "field-group" },
    onWarpTile === false
      ? h("p", { class: "hint bad" }, "The game never takes this warp: its cell isn't a door, stairs, cave entrance or warp mat. Paint such a block under it, or move it onto one.")
      : null,
    field("Connect to a door…", comboInput("", "dl-maps", Object.keys(store.maps).sort(), (to) => {
      const from = store.currentMap;
      const index = store.selection?.index ?? 0;
      nav.pickCell(to, (x, y) => connectWarps(spec, from, index, to, x, y));
    }, "Pick a map, then click the spot"), "Both ways at once: the other map gets a warp on the cell you click (made if missing) that leads back here."),
    field("Destination map", mapSelect),
    field("Destination warp", warpControl, spec.specialMaps.includes(destId) || isBack ? spec.hint : undefined),
    problem
      ? h(
          "div",
          { class: "problem" },
          h("p", { class: "hint bad" }, `${problem.message} The game crashes when this warp is used.`),
          dest
            ? h("button", { class: "btn small", onclick: () => addMissingWarps(destId, destNum, index), title: `Adds warp ${destNum} near the bottom of ${destId}; it leads back through this warp` }, `Add warp ${destNum} to ${destId}`)
            : null,
        )
      : null,
    dest
      ? h(
          "div",
          { class: "row" },
          h("button", { class: "btn small", onclick: () => view.followWarp(index) }, `Go to ${destId} →`),
          back && backTo !== store.currentMap && !spec.specialMaps.includes(backTo) && back[spec.warpKey] !== spec.backWarp
            ? h("span", { class: "hint warn" }, `That warp leads to ${backTo}, not back here.`)
            : null,
        )
      : null,
  );
}

// Gives `destId` warps up to number `destNum`. The new last one leads back
// through warp `index` of the current map (LAST_MAP, like vanilla doors);
// any gap fillers do the same, ready to be moved or retargeted.
function addMissingWarps(destId: string, destNum: number, index: number): void {
  const w = store.adapter.layers.find((l) => l.kind === "warp")!;
  const spec = w.fields.find((f): f is Extract<FieldSpec, { kind: "warpTarget" }> => f.kind === "warpTarget")!;
  const back = spec.specialMaps[0] ?? store.currentMap;
  store.edit(destId, `Add warp to ${destId}`, (d) => {
    const list = store.entities(d, w.key);
    while (list.length < destNum) {
      const created = w.create(d, Math.max(0, d.width - 1), Math.max(0, d.height * 2 - 1), store.ctx);
      created[spec.mapKey] = back;
      created[spec.warpKey] = index + 1;
      list.push(created);
    }
    d[w.key] = list;
  });
  store.seal();
  toast(`Added warp ${destNum} to ${destId} at the bottom middle. Move it onto the door mat there.`, "ok");
}

function extrasField(spec: Extract<FieldSpec, { kind: "extras" }>, record: Rec, edit: Edit, claimed: Set<string>): HTMLElement {
  const extras: Rec = {};
  for (const [k, v] of Object.entries(record)) if (!claimed.has(k)) extras[k] = v;
  const area = h("textarea", { rows: 4, spellcheck: false, class: "mono" });
  area.value = Object.keys(extras).length ? JSON.stringify(extras, null, 2) : "";
  area.addEventListener("change", () => {
    let parsed: Rec;
    try {
      parsed = area.value.trim() ? JSON.parse(area.value) : {};
      if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) throw new Error("must be an object");
    } catch (err) {
      toast(`${spec.label}: ${errorText(err)}`, "error");
      return;
    }
    edit(spec.label, (r) => {
      for (const k of Object.keys(r)) if (!claimed.has(k)) delete r[k];
      Object.assign(r, parsed);
    });
  });
  return field(spec.label, area, spec.hint);
}

// ---------------------------------------------------------------- map

// whether the open game has a registry (the map panel shows what it can save)
const has = (registry: string) => store.adapter.content.some((c) => c.registry === registry);

function mapForm(map: MapDef, view: MapView): HTMLElement[] {
  const adapter = store.adapter;
  const ids = Object.keys(store.maps).sort();
  const tilesets = tilesetIds();

  const tilesetSelect = selectInput(map.tileset, tilesets, (v) => editMap("Change tileset", (d) => (d.tileset = v)));

  // resize
  const w = numberInput(map.width, () => {}, 1, 255);
  const hgt = numberInput(map.height, () => {}, 1, 255);
  const anchor = h(
    "select",
    { title: "Which edge stays put" },
    ...[["0,0", "keep top-left"], ["0.5,0.5", "keep centered"], ["1,1", "keep bottom-right"], ["0,1", "keep bottom-left"], ["1,0", "keep top-right"]].map(([v, l]) =>
      h("option", { value: v }, l),
    ),
  );
  const resize = h("button", {
    class: "btn small",
    onclick: () => {
      const nw = Math.trunc(Number(w.value));
      const nh = Math.trunc(Number(hgt.value));
      if (!(nw >= 1 && nh >= 1 && nw <= 255 && nh <= 255)) return toast("Size must be 1–255 blocks", "error");
      const [ax, ay] = anchor.value.split(",").map(Number);
      editMap("Resize map", (d) => {
        const ox = Math.round((nw - d.width) * ax) * 2;
        const oy = Math.round((nh - d.height) * ay) * 2;
        d.blocks = resizeBlocks(d, nw, nh, ax, ay, store.stamp.blocks[0] ?? d.borderBlock ?? 0);
        d.width = nw;
        d.height = nh;
        // entities ride along with the content and drop if pushed off the map
        const inside = (e: EntityRecord) => e.x >= 0 && e.y >= 0 && e.x < nw * 2 && e.y < nh * 2;
        for (const layer of adapter.layers) {
          const list = store.entities(d, layer.key);
          for (const e of list) {
            e.x += ox;
            e.y += oy;
          }
          d[layer.key] = list.filter(inside);
        }
      });
    },
  }, "Resize");

  const border = numberInput(map.borderBlock ?? 0, (v) => editMap("Border block", (d) => (d.borderBlock = v)), 0, 255);
  const useStamp = h("button", {
    class: "btn small",
    title: "Use the selected palette block",
    onclick: () => editMap("Border block", (d) => (d.borderBlock = store.stamp.blocks[0] ?? 0)),
  }, "Use selected");

  const editRecord: Edit = (label, mutate) => editMap(label, (d) => mutate(d as Rec));
  const isNew = !store.base[map.id];
  return [
    h("div", { class: "kv" }, h("span", {}, "Id"), h("code", {}, map.id), isNew ? h("span", { class: "tag new" }, "new") : null),
    ...adapter.mapFields.map((f) => renderField(f, map as Rec, editRecord, adapter.mapFields, view)),
    field("Tileset", tilesetSelect),
    // only what this game's registries hold (Gen 2 has no map_songs, roofs or field rules yet)
    has("map_songs") ? musicField(map) : null,
    has("studio_roofs") ? roofField(map) : null,
    ...(has("field") ? mapRulesSection(map) : []),
    ...mapScenesSection(map),
    h("div", { class: "field" }, h("span", { class: "field-label" }, "Size (blocks)"), h("div", { class: "row" }, w, h("span", { class: "x" }, "×"), hgt, anchor, resize)),
    // gen1recomp TileRenderer.borderBlockFor: OVERWORLD maps fill the void
    // with the player's VOID FILL option (trees, water or black), not this block
    h("div", { class: "field" },
      h("span", { class: "field-label" }, "Void fill (border block)"),
      h("div", { class: "row" }, border, useStamp),
      h("span", { class: "hint" }, map.tileset === "OVERWORLD"
        ? "Not used on OVERWORLD maps: there the game fills the space around the map with the player's VOID FILL option (trees, water or black, in the game's settings)."
        : "The block the game repeats in the space around the map.")),
    h("h4", {}, "Connections"),
    h("p", { class: "hint" }, "The number shifts the neighbour along the shared edge, in blocks (the arrows move it one block). Setting a connection also writes the return connection on the other map."),
    ...DIRECTIONS.map((dir) => connectionRow(map, dir, ids, view)),
    ...townSection(map, view),
    h("h4", {}, "Contents"),
    h(
      "div",
      { class: "row wrap" },
      ...adapter.layers.map((l) =>
        h("span", { class: "chip", style: `border-color:${l.color};color:${l.color}` }, `${store.entities(map, l.key).length} ${l.label.toLowerCase()}`),
      ),
    ),
    h("p", { class: "hint" }, "Select tool (V): click to select, drag to move. Double-click a warp to follow it, a neighbouring map to open it."),
    isNew || changedParts(map, true).length
      ? h("button", {
          class: "btn danger small",
          // layout plus what belongs to the map elsewhere (events, music, ...)
          onclick: () => resetMapDialog(map, isNew, () => revertMap(map.id, store.base[map.id]), () => store.deleteMap(map.id)),
        }, isNew ? "Delete map" : "Revert map to base")
      : null,
  ].filter((e): e is HTMLElement => !!e);
}

// Music_PalletTown -> Pallet Town
// the map's song (the map_songs registry, keyed by map id)
function musicField(map: MapDef): HTMLElement | null {
  if (!store.adapter.content.some((c) => c.registry === "map_songs")) return null;
  const songs = Object.keys(store.table("music")).sort((a, b) => songLabel(a).localeCompare(songLabel(b)));
  const current = typeof store.table("map_songs")[map.id] === "string" ? (store.table("map_songs")[map.id] as string) : "";
  const sel = selectInput(current, songs, (v) => {
    store.setRecord("map_songs", map.id, "Map music", v || undefined);
    store.seal();
  }, "(none: the previous song keeps playing)");
  for (const o of sel.options) if (o.value) o.textContent = songLabel(o.value);
  return field("Music", sel, "Riding the bike or surfing plays their own song over it.");
}

// RED++ roof colors (the roof's 2 middle colors): the town's by default; a
// map the mod adds has none, so its roofs show the tileset's own (green)
// maps whose roof the user set to "Custom colors" (they may still match a town)
const customRoofs = new Set<string>();

function roofField(map: MapDef): HTMLElement | null {
  if (!gbcAvailable() || !tilesetHasRoof(map.tileset) || !store.adapter.content.some((c) => c.registry === ROOFS)) return null;
  const mine = store.table(ROOFS)[map.id] as RoofRecord | undefined;
  const towns = townRoofs();
  const game = gameRoof(store.base[map.id]?.index ?? undefined);
  const current = roofColors(map.tileset, map.id);
  const same = (a: Rgb[] | null | undefined, b: Rgb[] | null | undefined) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
  const set = (colors: Rgb[] | null) => {
    store.setRecord(ROOFS, map.id, "RED++ roof", colors ? { index: map.index ?? 0, colors } : undefined);
    store.seal();
  };
  const sel = h("select", {},
    h("option", { value: "" }, game ? "The town's (the game's)" : "The tileset's own (green)"),
    ...towns.map(([id]) => h("option", { value: id, selected: !!mine && !customRoofs.has(map.id) && same(mine.colors, towns.find(([t]) => t === id)?.[1]) }, `Like ${id}`)),
    h("option", { value: "__custom", selected: !!mine && (customRoofs.has(map.id) || !towns.some(([, c]) => same(c, mine.colors))) }, "Custom colors"),
  );
  sel.addEventListener("change", () => {
    if (sel.value === "__custom") customRoofs.add(map.id);
    else customRoofs.delete(map.id);
    // the same colors as before change no record: still show the pickers
    if (sel.value === "__custom" && mine) return store.emit("content", map.id, ROOFS);
    if (!sel.value) return set(null);
    if (sel.value === "__custom") return set(clone(current ?? [[255, 140, 120], [200, 80, 70]]));
    set(clone(towns.find(([t]) => t === sel.value)?.[1] ?? null));
  });
  // the color pickers only for custom colors (a town's roof is picked by name)
  const custom = !!mine && (customRoofs.has(map.id) || !towns.some(([, c]) => same(c, mine.colors)));
  const pickers = (custom ? current ?? [] : []).map((c, i) => {
    const input = h("input", { type: "color", value: `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`, title: i === 0 ? "Light roof color" : "Dark roof color" });
    input.addEventListener("change", () => {
      const rgb = [1, 3, 5].map((k) => parseInt(input.value.slice(k, k + 2), 16)) as Rgb;
      const next = clone(current ?? ([[255, 255, 255], [0, 0, 0]] as Rgb[]));
      next[i] = rgb;
      set(next);
    });
    return input;
  });
  return field("RED++ roof", h("div", { class: "row nowrap" }, sel, ...pickers), "The roof colors in the game's RED++ color mode. Setting one gives the mod the engine_internals permission (it writes into the engine's color table).");
}

function revertMap(id: string, to: MapDef): void {
  store.edit(id, "Revert map", (d) => {
    for (const k of Object.keys(d)) delete d[k];
    Object.assign(d, clone(to));
  });
}

function connectionRow(map: MapDef, dir: Direction, ids: string[], view: MapView): HTMLElement {
  const conn = store.adapter.connections(map).find((c) => c.dir === dir);
  const select = h("select", {}, h("option", { value: "" }, "—"), ...ids.filter((i) => i !== map.id).map((i) => h("option", { value: i, selected: i === conn?.map }, i)));
  const offset = numberInput(conn?.offset ?? 0, () => {}, -255, 255);
  const apply = () => setConnection(map.id, dir, select.value || null, Math.trunc(Number(offset.value) || 0));
  select.addEventListener("change", apply);
  offset.addEventListener("change", apply);
  offset.title = "How far the neighbour is shifted along this edge, in blocks";
  const open = conn && store.maps[conn.map]
    ? h("button", { class: "btn small ghost", title: `Open ${conn.map}`, onclick: () => view.openMap(conn.map) }, "→")
    : null;
  // push the neighbour one block along the shared edge
  const vertical = dir === "east" || dir === "west";
  const nudge = (by: number, arrow: string, where: string) =>
    h("button", {
      class: "btn small ghost conn-nudge",
      disabled: !conn,
      title: conn ? `Move ${conn.map} one block ${where}` : "Pick a map first",
      onclick: () => conn && setConnection(map.id, dir, conn.map, conn.offset + by),
    }, arrow);
  return h(
    "div",
    { class: "conn-row" },
    h("span", { class: "conn-dir" }, dir),
    select,
    vertical ? nudge(-1, "▲", "up") : nudge(-1, "◀", "left"),
    offset,
    vertical ? nudge(1, "▼", "down") : nudge(1, "▶", "right"),
    h("span", { class: "muted conn-unit" }, "blocks"),
    open,
  );
}

// A connection lives on both maps; the return side mirrors the offset
// (all vanilla reciprocal pairs satisfy back.offset == -offset).
function setConnection(mapId: string, dir: Direction, target: string | null, offset: number): void {
  const adapter = store.adapter;
  const before = adapter.connections(store.maps[mapId]).find((c) => c.dir === dir);
  const back = OPPOSITE[dir];
  const pointsBack = (id: string) => adapter.connections(store.maps[id]).some((c) => c.dir === back && c.map === mapId);
  store.group("Connection", () => {
    store.edit(mapId, "Connection", (d) => adapter.setConnection(d, dir, target, offset));
    if (before && before.map !== target && store.maps[before.map] && pointsBack(before.map)) {
      store.edit(before.map, "Connection", (d) => adapter.setConnection(d, back, null, 0));
    }
    if (target && store.maps[target]) {
      store.edit(target, "Connection", (d) => adapter.setConnection(d, back, mapId, -offset));
    }
  });
}

// ---------------------------------------------------------------- entities

function entityForm(map: MapDef, layer: EntityLayer, index: number, view: MapView): HTMLElement[] {
  const record = store.entities(map, layer.key)[index];
  const edit: Edit = (label, mutate) => editMap(label, (d) => mutate(store.entities(d, layer.key)[index]));
  const pos = h(
    "div",
    { class: "field" },
    h("span", { class: "field-label" }, "Position (cells)"),
    h(
      "div",
      { class: "row" },
      numberInput(record.x, (v) => edit("Move", (e) => (e.x = v)), 0, map.width * 2 - 1),
      h("span", { class: "x" }, ","),
      numberInput(record.y, (v) => edit("Move", (e) => (e.y = v)), 0, map.height * 2 - 1),
      h("button", { class: "btn small ghost", onclick: () => {
        const e = store.entities(store.map, layer.key)[index];
        if (e) view.centerOnCell(e.x, e.y);
      } }, "Center"),
    ),
  );
  const actions = h(
    "div",
    { class: "row" },
    h("button", { class: "btn small", onclick: () => duplicateEntity(layer, index) }, "Duplicate"),
    h("button", { class: "btn small danger", onclick: () => deleteSelection() }, "Delete"),
    ...revertEntityButton(map, layer, index, record),
  );
  // what the NPC/sign says goes right under the fields, before the raw extras
  const says =
    layer.kind === "npc" || layer.kind === "sign"
      ? npcTextSection(map, record, layer.kind, index, (id) => store.edit(map.id, "Text id", (d) => (store.entities(d, layer.key)[index].text = id)))
      : null;
  const fields: HTMLElement[] = [];
  for (const f of layer.fields) {
    if (f.kind === "extras" && says) fields.push(says);
    const el = renderField(f, record, edit, layer.fields, view);
    if (el) fields.push(el);
  }
  if (says && !fields.includes(says)) fields.push(says);
  const fights = layer.kind === "npc" ? trainerSection(record) : null;
  if (fights) fields.splice(fields.indexOf(says ?? fields[fields.length - 1]), 0, fights);
  // what it does (says a text, an event, a trainer, a shop, a nurse …) goes
  // right above what it says
  const roles = rolesFor();
  const role = roles && (layer.kind === "npc" || layer.kind === "sign")
    ? roleBox(roles, roleCtx(map, layer, index, record))
    : null;
  if (role) fields.splice(says ? fields.indexOf(says) : fields.length, 0, role);
  // Gen 2: a step trigger's own event (an inline script)
  const own = layer.kind === "trigger" ? inlineEventSection(map, layer.kind, index, record) : null;
  if (own) fields.push(own);
  // a mod's own kind (studio extensions): its fields first
  const kind = extKind((record.custom as Rec | undefined)?.kind);
  if (kind) {
    fields.unshift(extKindCard(kind, record.custom as Rec, (key, v) =>
      edit(`${kind.label}: ${key}`, (e) => (e.custom = { ...(e.custom as Rec), [key]: v }))));
  }
  return [pos, ...fields, actions];
}

// the Role box this generation offers (Gen 2's only in builds with Gen 2)
function rolesFor(): RoleSet | null {
  if (store.adapter.roles === "gen2") return FEATURES.gen2 ? gen2Roles : null;
  return gen1Roles;
}

function roleCtx(map: MapDef, layer: EntityLayer, index: number, record: EntityRecord): RoleCtx {
  return {
    map,
    entity: record,
    kind: layer.kind,
    index,
    layer: layer.key,
    setTextId: (id) => store.edit(map.id, "Text id", (d) => (store.entities(d, layer.key)[index].text = id)),
    editEntity: (label, mutate) => store.edit(map.id, label, (d) => mutate(store.entities(d, layer.key)[index])),
  };
}

// Gen 2 (EventSpec.inline): what stepping on a trigger does is a script of its
// own, made and edited in the Events workspace (people and signs: the Role box)
function inlineEventSection(map: MapDef, _kind: string, index: number, record: EntityRecord): HTMLElement | null {
  if (!store.adapter.events?.inline) return null;
  const id = eventId(map.id, "step", String(index));
  const has = Array.isArray(record.scriptKey);
  return h("div", { class: "field-group" },
    h("h4", {}, "Event"),
    h("div", { class: "row" },
      h("span", {}, has ? "Stepping here: its own event" : "Stepping here: the game's script"),
      has
        ? h("button", { class: "btn small primary-ish", onclick: () => nav.openEvent(id) }, "Edit event →")
        : h("button", { class: "btn small", title: "Replace what it does with an event made of commands", onclick: () => { const nid = createEvent(map.id, "step", String(index)); if (nid) nav.openEvent(nid); } }, "Make an event")),
  );
}

// For an NPC that is a trainer: which class and team it fights with, and a
// way to jump there.
function trainerSection(record: EntityRecord): HTMLElement | null {
  const s = store.adapter.trainers;
  const cls = s ? record[s.objectClassKey] : undefined;
  if (!s || typeof cls !== "string") return null;
  const team = Number(record[s.objectPartyKey] ?? 1);
  const trainer = store.table(s.registry)[cls] as { name?: string; parties?: { species: string; level: number }[][] } | undefined;
  const party = trainer?.parties?.[team - 1];
  const summary = party?.length ? party.map((m) => `${m.species.replace(/_/g, " ")} ${m.level}`).join(" · ") : "";
  return h(
    "div",
    { class: "field-group npc-text" },
    h("h4", {}, "Trainer"),
    h("div", { class: "kv" }, h("span", {}, "Fights as"), h("code", {}, `${trainer?.name ?? cls} · team ${team}`)),
    !trainer
      ? h("p", { class: "hint bad" }, `There is no trainer class ${cls}.`)
      : !party
        ? h("p", { class: "hint bad" }, `${cls} has no team ${team} (it has ${trainer.parties?.length ?? 0}). The battle would fail.`)
        : h("p", { class: "hint" }, summary),
    trainer ? h("button", { class: "btn small", onclick: () => nav.openTrainer(cls, party ? team : undefined) }, "Open team in Trainers →") : null,
  );
}

// ---------------------------------------------------------------- actions

// a mod's own placed kind (studio extensions): the layer's plain record with
// `custom = { kind, <field defaults> }`, hidden in the game unless it is visible
export function addCustom(kindId: string, cx: number, cy: number): void {
  const kind = extKind(kindId);
  const layer = store.adapter.layers.find((l) => l.custom);
  if (!kind || !layer?.custom) return;
  let index = 0;
  store.edit(store.currentMap, `Add ${kind.label.toLowerCase()}`, (d) => {
    const list = store.entities(d, layer.key);
    const rec = layer.custom!.create(d, cx, cy);
    if (kind.sprite) rec.sprite = kind.sprite;
    if (!kind.visible) rec.hidden = true;
    rec.custom = { kind: kind.id, ...Object.fromEntries(kind.fields.map((f) => [f.key, fieldDefault(f)])) };
    list.push(rec);
    d[layer.key] = list;
    index = list.length - 1;
  });
  store.seal();
  store.setTool("select");
  store.select({ layer: layer.key, index });
}

export function addEntity(layerKey: string, cx: number, cy: number, variantId?: string): void {
  const layer = store.adapter.layers.find((l) => l.key === layerKey);
  if (!layer) return;
  const variant = layer.variants?.find((v) => v.id === variantId);
  let index = 0;
  const label = `Add ${variant?.label.toLowerCase() ?? layer.singular}`;
  store.group(label, () => {
    store.edit(store.currentMap, label, (d) => {
      const list = store.entities(d, layer.key);
      list.push((variant ?? layer).create(d, cx, cy, store.ctx));
      d[layer.key] = list;
      index = list.length - 1;
    });
    // Gen 2: a new person / sign says a text of its own
    if (FEATURES.gen2 && store.adapter.roles === "gen2" && !variant && (layer.kind === "npc" || layer.kind === "sign")) freshRole(store.map, layer.key, index, layer.kind);
  });
  store.seal();
  store.setTool("select");
  store.select({ layer: layer.key, index });
}

function duplicateEntity(layer: EntityLayer, index: number): void {
  let newIndex = 0;
  editMap(`Duplicate ${layer.singular}`, (d) => {
    const list = store.entities(d, layer.key);
    const copy = clone(list[index]);
    copy.x = Math.min(copy.x + 1, d.width * 2 - 1);
    layer.duplicate?.(d, copy);
    list.push(copy);
    newIndex = list.length - 1;
  });
  store.select({ layer: layer.key, index: newIndex });
}

// The game's version of an entity: people/objects by their `index` (the game's
// object number), warps and signs by their place in the list (a warp's number
// is its place: destWarp points at it). Places are only trusted while nothing
// was deleted from the list (additions go at the end).
function baseEntity(map: MapDef, layer: EntityLayer, index: number, record: EntityRecord): EntityRecord | undefined {
  const base = store.base[map.id];
  if (!base) return undefined;
  const baseList = store.entities(base, layer.key);
  if (typeof record.index === "number" && baseList.some((e) => typeof e.index === "number")) return baseList.find((e) => e.index === record.index);
  return store.entities(map, layer.key).length >= baseList.length ? baseList[index] : undefined;
}

function revertEntityButton(map: MapDef, layer: EntityLayer, index: number, record: EntityRecord): HTMLElement[] {
  const original = baseEntity(map, layer, index, record);
  if (!original || deepEqual(original, record)) return [];
  return [h("button", {
    class: "btn small danger",
    title: "Put this one back the way the game has it (texts are reverted on their own)",
    onclick: () => editMap(`Revert ${layer.singular.toLowerCase()}`, (d) => {
      store.entities(d, layer.key)[index] = clone(original);
    }),
  }, "Revert to base")];
}

export function deleteSelection(): void {
  const sel = store.selection;
  if (!sel) return;
  editMap(`Delete ${sel.layer}`, (d) => {
    store.entities(d, sel.layer).splice(sel.index, 1);
  });
  store.select(null);
}

export function nudgeSelection(dx: number, dy: number): void {
  const sel = store.selection;
  if (!sel) return;
  store.edit(store.currentMap, `Move ${sel.layer}`, (d) => {
    const e = store.entities(d, sel.layer)[sel.index];
    if (!e) return;
    e.x = Math.max(0, Math.min(d.width * 2 - 1, e.x + dx));
    e.y = Math.max(0, Math.min(d.height * 2 - 1, e.y + dy));
  }, true);
}
