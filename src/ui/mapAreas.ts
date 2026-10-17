// Painted areas of a mod's own kinds (studio extensions, place "cells"): the
// map record's customCells[kind] = [{ x, y, <field values> }, ...]. The area
// tool paints cells with the brush's values (right-drag erases); with Select,
// a painted cell can be edited on its own. The engine keeps unknown map keys,
// and the defining mod's Lua reads them.

import { store } from "../core/store.ts";
import type { MapDef } from "../core/types.ts";
import { fieldDefault } from "../project/extensions.ts";
import { h } from "./dom.ts";
import { cellsOf, extKind, paintCell } from "../core/customCells.ts";
import { extKindCard } from "./extFields.ts";

// the area tool's values for a kind (its defaults the first time)
export function startAreaBrush(kindId: string): void {
  const kind = extKind(kindId);
  if (!kind) return;
  const keep = store.areaBrush?.kind === kindId ? store.areaBrush.values : null;
  store.areaBrush = { kind: kindId, values: keep ?? Object.fromEntries(kind.fields.map((f) => [f.key, fieldDefault(f)])) };
  store.setTool("area");
}

// right panel while the area tool is on
export function areaBrushPanel(): HTMLElement[] {
  const brush = store.areaBrush;
  const kind = extKind(brush?.kind);
  if (!brush || !kind) return [h("p", { class: "hint" }, "Pick an area kind in the toolbar.")];
  return [
    h("p", { class: "hint" }, "Drag on the map to paint cells with these values; right-drag erases. With Select, click a painted cell to change it on its own."),
    extKindCard(kind, brush.values, (key, v) => {
      brush.values = { ...brush.values, [key]: v };
    }),
  ];
}

// right panel for one painted cell (Select tool)
export function cellPanel(map: MapDef, sel: { kind: string; x: number; y: number }): HTMLElement[] | null {
  const cell = cellsOf(map)[sel.kind]?.find((c) => c.x === sel.x && c.y === sel.y);
  const kind = extKind(sel.kind);
  if (!cell) return null;
  const erase = h("button", { class: "btn small danger", onclick: () => {
    paintCell(map.id, sel.kind, null, sel.x, sel.y);
    store.seal();
    store.select(null);
  } }, "Erase this cell");
  if (!kind) {
    return [h("p", { class: "hint" }, `A cell of ${sel.kind}, a kind no loaded mod defines (is its mod a dependency?).`), erase];
  }
  return [
    h("div", { class: "kv" }, h("span", {}, "Cell"), h("code", {}, `${sel.x}, ${sel.y}`)),
    extKindCard(kind, cell, (key, v) => {
      const now = cellsOf(store.maps[map.id])[sel.kind]?.find((c) => c.x === sel.x && c.y === sel.y);
      if (now) paintCell(map.id, sel.kind, { ...now, [key]: v }, sel.x, sel.y);
      store.seal();
    }),
    erase,
  ];
}
