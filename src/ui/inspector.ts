// Right sidebar, BASE tab, lower half: properties of the selection or the map.
// Forms are generated from the adapter's FieldSpecs, so a new game only
// declares its fields.

import { OPPOSITE, resizeBlocks } from "../core/geometry.ts";
import { clone } from "../core/merge.ts";
import { store } from "../core/store.ts";
import { DIRECTIONS, type Direction, type EntityRecord, type MapDef } from "../core/types.ts";
import type { EntityLayer, FieldSpec } from "../games/types.ts";
import type { MapView } from "../render/mapView.ts";
import { clear, field, h, numberInput, rerender, selectInput, toast, errorText, onFocusLeave } from "./dom.ts";
import { npcTextSection } from "./mapText.ts";
import { roleSection, townSection } from "./mapTown.ts";
import { changedParts, resetMapDialog } from "./mapReset.ts";
import { nav } from "./nav.ts";
import { warpProblem } from "../core/checks.ts";
import { tilesetIds } from "../core/tilesets.ts";
import { mapRulesSection } from "./mapRules.ts";
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
      const sel = store.selection;
      const layer = sel ? store.adapter.layers.find((l) => l.key === sel.layer) : undefined;
      if (sel && layer && store.entities(map, layer.key)[sel.index]) {
        title.textContent = `${layer.singular} ${sel.index + 1}`;
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
  store.on((reason, _id, registry) => {
    if (["project", "map", "edit", "selection"].includes(reason)) schedule();
    const towns = store.adapter?.towns;
    if (reason === "content" && (registry === "text" || registry === "text_pointers" || registry === "map_songs" || registry === "studio_roofs" || registry === "encounters" || registry === "field" || registry === store.adapter?.events?.registry || registry === towns?.fieldRegistry || registry === towns?.prizeRegistry || registry === "items")) schedule();
  });
  onFocusLeave(body, schedule);
}

function editMap(label: string, mutate: (d: MapDef) => void): void {
  store.edit(store.currentMap, label, mutate);
  store.seal();
}

// ---------------------------------------------------------------- fields

// Keys a set of specs edits (so "extras" can show everything else).
function claimedKeys(specs: FieldSpec[], out = new Set<string>(["x", "y"])): Set<string> {
  for (const s of specs) {
    if (s.kind === "pair") claimedKeys(s.fields, out);
    else if (s.kind === "warpTarget") out.add(s.mapKey).add(s.warpKey);
    else if (s.kind !== "extras") out.add(s.key);
  }
  return out;
}

function renderField(spec: FieldSpec, record: Rec, edit: Edit, all: FieldSpec[], view: MapView): HTMLElement | null {
  switch (spec.kind) {
    case "pair":
      return h("div", { class: "row two" }, ...spec.fields.map((f) => renderField(f, record, edit, all, view)));
    case "text": {
      const input = h("input", { type: "text", value: (record[spec.key] as string) ?? "", spellcheck: false });
      input.addEventListener("change", () =>
        edit(spec.label, (r) => {
          if (input.value) r[spec.key] = input.value;
          else delete r[spec.key];
        }),
      );
      return field(spec.label, input, spec.hint);
    }
    case "int":
      return field(spec.label, numberInput(record[spec.key] as number | undefined, (v) => edit(spec.label, (r) => (r[spec.key] = v)), spec.min, spec.max), spec.hint);
    case "select": {
      const empty = typeof spec.emptyLabel === "function" ? spec.emptyLabel(record, store.ctx) : spec.emptyLabel;
      const value = typeof record[spec.key] === "string" ? (record[spec.key] as string) : "";
      return field(
        spec.label,
        selectInput(value, spec.options(store.ctx), (v) =>
          edit(spec.label, (r) => {
            if (v) r[spec.key] = v;
            else delete r[spec.key];
          }), empty),
        spec.hint,
      );
    }
    case "warpTarget":
      return warpTarget(spec, record, edit, view);
    case "extras":
      return extrasField(spec, record, edit, claimedKeys(all));
  }
}

function warpTarget(spec: Extract<FieldSpec, { kind: "warpTarget" }>, record: Rec, edit: Edit, view: MapView): HTMLElement {
  const layer = store.adapter.layers.find((l) => l.kind === "warp")!;
  const destId = String(record[spec.mapKey] ?? "");
  const destNum = Number(record[spec.warpKey] ?? 1);
  const dest = store.maps[destId];
  const ids = [...spec.specialMaps, ...Object.keys(store.maps).sort()];
  const mapSelect = selectInput(destId, ids, (v) => edit("Warp target", (r) => (r[spec.mapKey] = v || spec.specialMaps[0])));
  let warpControl: HTMLElement;
  if (dest) {
    const sel = h(
      "select",
      {},
      ...store.entities(dest, layer.key).map((w, i) =>
        h("option", { value: i + 1, selected: i + 1 === destNum }, `${i + 1}  (${w.x}, ${w.y}) → ${String(w[spec.mapKey] ?? "")}`),
      ),
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
  return h(
    "div",
    { class: "field-group" },
    field("Destination map", mapSelect),
    field("Destination warp", warpControl, spec.specialMaps.includes(destId) ? spec.hint : undefined),
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
          back && backTo !== store.currentMap && !spec.specialMaps.includes(backTo)
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
    musicField(map),
    roofField(map),
    ...mapRulesSection(map),
    h("div", { class: "field" }, h("span", { class: "field-label" }, "Size (blocks)"), h("div", { class: "row" }, w, h("span", { class: "x" }, "×"), hgt, anchor, resize)),
    h("div", { class: "field" }, h("span", { class: "field-label" }, "Border block"), h("div", { class: "row" }, border, useStamp)),
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
function songLabel(id: string): string {
  return id.replace(/^Music_/, "").replace(/([a-z])([A-Z0-9])/g, "$1 $2").replace(/_/g, " ");
}

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
    ...towns.map(([id]) => h("option", { value: id, selected: !!mine && same(mine.colors, towns.find(([t]) => t === id)?.[1]) }, `Like ${id}`)),
    h("option", { value: "__custom", selected: !!mine && !towns.some(([, c]) => same(c, mine.colors)) }, "Custom colors"),
  );
  sel.addEventListener("change", () => {
    if (!sel.value) return set(null);
    if (sel.value === "__custom") return set(clone(current ?? [[255, 140, 120], [200, 80, 70]]));
    set(clone(towns.find(([t]) => t === sel.value)?.[1] ?? null));
  });
  // the color pickers only for custom colors (a town's roof is picked by name)
  const custom = !!mine && !towns.some(([, c]) => same(c, mine.colors));
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
  // what it does (shop, nurse, PC, prizes) goes right above what it says
  const role = layer.kind === "npc" || layer.kind === "sign"
    ? roleSection(map, record, layer.kind, index, (id) => store.edit(map.id, "Text id", (d) => (store.entities(d, layer.key)[index].text = id)), (label, mutate) => store.edit(map.id, label, (d) => mutate(store.entities(d, layer.key)[index])))
    : null;
  if (role) fields.splice(says ? fields.indexOf(says) : fields.length, 0, role);
  return [pos, ...fields, actions];
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

export function addEntity(layerKey: string, cx: number, cy: number): void {
  const layer = store.adapter.layers.find((l) => l.key === layerKey);
  if (!layer) return;
  let index = 0;
  store.edit(store.currentMap, `Add ${layer.singular}`, (d) => {
    const list = store.entities(d, layer.key);
    list.push(layer.create(d, cx, cy, store.ctx));
    d[layer.key] = list;
    index = list.length - 1;
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
