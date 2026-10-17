// The mods' own kinds (studio extensions) as the map code sees them: kind
// lookup and the painted cells of area kinds (the map record's
// customCells[kind] = [{ x, y, <field values> }, ...]). No DOM here: the map
// view and the checks import it (src/ui/mapAreas.ts has the panels).

import type { ExtKind } from "../project/extensions.ts";
import { store } from "./store.ts";
import type { MapDef } from "./types.ts";

export const extKinds = (): ExtKind[] => store.project?.extensions.kinds ?? [];
export const extKind = (id: unknown): ExtKind | undefined => (typeof id === "string" ? extKinds().find((k) => k.id === id) : undefined);

export type Cell = Record<string, unknown> & { x: number; y: number };
type Cells = Record<string, Cell[]>;

export const cellsOf = (map: MapDef): Cells => ((map as { customCells?: Cells }).customCells ?? {});

// the painted cell at (x, y), the last-defined kind first
export function cellAt(map: MapDef, x: number, y: number): { kind: string; cell: Cell } | null {
  for (const [kind, list] of Object.entries(cellsOf(map)).reverse()) {
    const cell = list.find((c) => c.x === x && c.y === y);
    if (cell) return { kind, cell };
  }
  return null;
}

// one cell of a stroke: paints with `values`, or erases with null; a stroke's
// cells merge into one undo step (same label, sealed on pointer up)
export function paintCell(mapId: string, kind: string, values: Record<string, unknown> | null, x: number, y: number): void {
  const map = store.maps[mapId];
  if (!map || x < 0 || y < 0 || x >= map.width * 2 || y >= map.height * 2) return;
  const had = cellsOf(map)[kind]?.find((c) => c.x === x && c.y === y);
  if (!values && !had) return;
  if (values && had && Object.entries(values).every(([k, v]) => had[k] === v)) return;
  store.edit(mapId, values ? "Paint area" : "Erase area", (d) => {
    const all = { ...cellsOf(d) };
    const list = (all[kind] ?? []).filter((c) => c.x !== x || c.y !== y);
    if (values) list.push({ x, y, ...values });
    if (list.length) all[kind] = list;
    else delete all[kind];
    if (Object.keys(all).length) (d as { customCells?: Cells }).customCells = all;
    else delete (d as { customCells?: Cells }).customCells;
  }, true);
}
