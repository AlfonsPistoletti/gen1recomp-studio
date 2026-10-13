// Editor state. Every editable registry (maps, pokemon, encounters, text,
// ...) is held as whole-record snapshots: each command stores the record
// before and after, so undo/redo is exact and cheap (a big route is a few
// hundred block ids). One undo history and one save cover all registries.
//
// Maps keep their own convenience API (maps, base, edit, isEdited, ...),
// which is a view onto the "maps" registry.

import type { GameAdapter, GameContext } from "../games/types.ts";
import type { Project } from "../project/project.ts";
import { clone, deepEqual } from "./merge.ts";
import type { EntityRecord, MapDef } from "./types.ts";

export type Tool = "select" | "brush" | "rect" | "fill" | "tile";

// `layer` is the adapter layer key (the map field holding the list)
export type Selection = { layer: string; index: number } | null;

// A rectangle of block ids to paint with; the palette makes 1x1 stamps,
// dragging the pick tool over a map copies bigger ones.
export interface Stamp {
  w: number;
  h: number;
  blocks: number[];
}

export interface Overlays {
  grid: boolean;
  collision: boolean;
  entities: boolean;
  neighbors: boolean;
  wild: boolean;
  animate: boolean;
}

export type Records = Record<string, Record<string, unknown>>;

interface Change {
  registry: string;
  id: string;
  before: unknown;
  after: unknown; // undefined = absent
}

// One undo step; may span several records (a connection edits both ends).
interface Command {
  label: string;
  changes: Change[];
  sealed: boolean;
  // the map the step was made on, when it may change only other records
  // (the tile brush changing a block in place): undo/redo shows that map
  map?: string;
}

// "edit" = a map changed (id = map id); "content" = a record of another
// registry changed; "reveal" = undo/redo touched a non-map record the UI
// should bring into view.
type Listener = (reason: string, id?: string, registry?: string) => void;

export class Store {
  project!: Project;
  // every editable registry: base data (dataset + the mod's own code) and
  // the live records the editor works on
  baseRecords: Records = {};
  records: Records = {};
  base: Record<string, MapDef> = {};
  maps: Record<string, MapDef> = {};
  palettes: Record<string, string> = {};
  currentMap = "PALLET_TOWN";
  tool: Tool = "select";
  stamp: Stamp = { w: 1, h: 1, blocks: [0] };
  // the tiles the tile brush paints (tile ids in `blocks`, row by row)
  tileStamp: Stamp = { w: 1, h: 1, blocks: [0] };
  selection: Selection = null;
  overlays: Overlays = { grid: false, collision: false, entities: true, neighbors: true, wild: false, animate: true };
  // how maps are colored: the Game Boy palettes, or RED++ (pokered-gbc)
  colorMode: "sgb" | "redpp" = "sgb";
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private listeners: Listener[] = [];
  private savedSnapshot: Records = {};

  on(listener: Listener): void {
    this.listeners.push(listener);
  }

  emit(reason: string, id?: string, registry?: string): void {
    for (const l of this.listeners) l(reason, id, registry);
  }

  load(project: Project): void {
    this.project = project;
    this.baseRecords = { maps: project.data.maps, ...project.data.content };
    this.records = {};
    for (const [registry, table] of Object.entries(this.baseRecords)) {
      const live: Record<string, unknown> = { ...table };
      for (const [id, value] of Object.entries(project.studio[registry] ?? {})) {
        if (value === null) delete live[id];
        else live[id] = value;
      }
      this.records[registry] = live;
    }
    this.base = this.baseRecords.maps as Record<string, MapDef>;
    this.maps = this.records.maps as Record<string, MapDef>;
    this.savedSnapshot = this.snapshot();
    this.undoStack = [];
    this.redoStack = [];
    this.selection = null;
    this.refreshPalettes();
    if (!this.maps[this.currentMap]) this.currentMap = this.fallbackMap();
    this.emit("project");
  }

  private snapshot(): Records {
    const out: Records = {};
    for (const [registry, table] of Object.entries(this.records)) out[registry] = { ...table };
    return out;
  }

  private fallbackMap(): string {
    return this.maps.PALLET_TOWN ? "PALLET_TOWN" : Object.keys(this.maps)[0];
  }

  get adapter(): GameAdapter {
    return this.project.adapter;
  }

  get ctx(): GameContext {
    return { data: this.project.data, maps: this.maps, records: this.records };
  }

  refreshPalettes(): void {
    this.palettes = this.adapter.paletteKeys(this.ctx);
  }

  // The entity list of one layer on a map record.
  entities(map: MapDef, layer: string): EntityRecord[] {
    const list = map[layer];
    return Array.isArray(list) ? (list as EntityRecord[]) : [];
  }

  get map(): MapDef {
    return this.maps[this.currentMap];
  }

  openMap(id: string): void {
    if (!this.maps[id] || id === this.currentMap) return;
    this.currentMap = id;
    this.selection = null;
    this.emit("map");
  }

  // while a cell is picked on the map (Play from here, Pick on map) the
  // Select tool stays on
  toolLocked = false;

  setTool(tool: Tool): void {
    if (this.toolLocked) return;
    this.tool = tool;
    if (tool !== "select") this.selection = null;
    this.emit("tool");
  }

  setStamp(stamp: Stamp): void {
    this.stamp = stamp;
    this.emit("stamp");
  }

  setTileStamp(stamp: Stamp): void {
    this.tileStamp = stamp;
    this.emit("stamp");
  }

  select(selection: Selection): void {
    this.selection = selection;
    this.emit("selection");
  }

  setColorMode(mode: "sgb" | "redpp"): void {
    this.colorMode = mode;
    this.emit("colors");
  }

  toggleOverlay(key: keyof Overlays): void {
    this.overlays[key] = !this.overlays[key];
    this.emit("overlays");
  }

  // ------------------------------------------------------------ records

  table(registry: string): Record<string, unknown> {
    return this.records[registry] ?? {};
  }

  baseTable(registry: string): Record<string, unknown> {
    return this.baseRecords[registry] ?? {};
  }

  // Replaces one record (undefined removes it) as one undo step. `merge`
  // folds consecutive edits with the same label on the same record (a brush
  // stroke, a drag, typing) into the step on top until seal().
  setRecord(registry: string, id: string, label: string, next: unknown, merge = false): void {
    const current = this.table(registry)[id];
    if (next === current || (next !== undefined && current !== undefined && deepEqual(next, current))) return;
    this.record(label, { registry, id, before: current, after: next }, merge);
  }

  // A change that follows from the edit just made (a trainer's sight cells
  // after its NPC moved): it joins that edit's undo step, whatever its label.
  follow(registry: string, id: string, next: unknown): void {
    const current = this.table(registry)[id];
    if (next === current || (next !== undefined && current !== undefined && deepEqual(next, current))) return;
    const top = this.grouping ?? this.undoStack[this.undoStack.length - 1];
    if (!top) return this.record("Update", { registry, id, before: current, after: next }, false);
    const existing = top.changes.find((c) => c.registry === registry && c.id === id);
    if (existing) existing.after = next;
    else top.changes.push({ registry, id, before: current, after: next });
    this.redoStack = [];
    this.put(registry, id, next);
  }

  // Applies `mutate` to a copy of the record (or of `create()` when absent).
  editRecord<T>(registry: string, id: string, label: string, mutate: (draft: T) => void, opts: { merge?: boolean; create?: () => T } = {}): void {
    const current = this.table(registry)[id] as T | undefined;
    if (current === undefined && !opts.create) return;
    const draft = current === undefined ? opts.create!() : clone(current);
    mutate(draft);
    this.setRecord(registry, id, label, draft, opts.merge);
  }

  // Back to what the base data has (or gone, for a record the base lacks).
  revertRecord(registry: string, id: string, label = "Revert"): void {
    const base = this.baseTable(registry)[id];
    this.setRecord(registry, id, label, base === undefined ? undefined : clone(base));
    this.seal();
  }

  isRecordEdited(registry: string, id: string): boolean {
    const value = this.table(registry)[id];
    const base = this.baseTable(registry)[id];
    if (value === base) return false;
    if ((value === undefined) !== (base === undefined)) return true;
    return !deepEqual(value, base);
  }

  // Records that differ from the base, per registry; what a save writes.
  // A record the base has but the editor removed maps to null.
  changed(): Records {
    const out: Records = {};
    for (const registry of Object.keys(this.records)) {
      const ids = new Set([...Object.keys(this.table(registry)), ...Object.keys(this.baseTable(registry))]);
      for (const id of ids) {
        if (!this.isRecordEdited(registry, id)) continue;
        (out[registry] ??= {})[id] = this.table(registry)[id] ?? null;
      }
    }
    return out;
  }

  // ------------------------------------------------------------ maps

  // Applies `mutate` to a copy of the map and records it as one undo step.
  edit(mapId: string, label: string, mutate: (draft: MapDef) => void, merge = false): void {
    if (!this.maps[mapId]) return;
    this.editRecord<MapDef>("maps", mapId, label, mutate, { merge });
  }

  createMap(map: MapDef): void {
    this.record(`Create ${map.id}`, { registry: "maps", id: map.id, before: undefined, after: map }, false);
    this.seal();
  }

  deleteMap(id: string): void {
    if (!this.maps[id]) return;
    if (id === this.currentMap) this.openMap(this.maps.PALLET_TOWN ? "PALLET_TOWN" : Object.keys(this.base)[0]);
    this.record(`Delete ${id}`, { registry: "maps", id, before: this.maps[id], after: undefined }, false);
    this.seal();
  }

  // Maps that differ from the base data.
  changedMaps(): Record<string, MapDef> {
    const out: Record<string, MapDef> = {};
    for (const [id, map] of Object.entries(this.maps)) {
      if (map !== this.base[id] && !deepEqual(map, this.base[id])) out[id] = map;
    }
    return out;
  }

  isEdited(id: string): boolean {
    const map = this.maps[id];
    return map !== this.base[id] && !deepEqual(map, this.base[id]);
  }

  // ------------------------------------------------------------ history

  // Runs several edits as one undo step.
  group(label: string, run: () => void): void {
    this.seal();
    this.grouping = { label, changes: [], sealed: false };
    try {
      run();
    } finally {
      const cmd = this.grouping;
      this.grouping = null;
      if (cmd.changes.length) this.push(cmd);
      this.seal();
    }
  }

  private grouping: Command | null = null;

  private record(label: string, change: Change, merge: boolean): void {
    const target = this.grouping ?? this.undoStack[this.undoStack.length - 1];
    const sameGesture = this.grouping || (merge && target && !target.sealed && target.label === label);
    const existing = sameGesture
      ? target?.changes.find((c) => c.registry === change.registry && c.id === change.id)
      : undefined;
    if (sameGesture && existing) existing.after = change.after;
    // another record in the same gesture (the tile brush: map + tileset)
    else if (sameGesture) target!.changes.push(change);
    else this.push({ label, changes: [change], sealed: false });
    this.redoStack = [];
    this.put(change.registry, change.id, change.after);
  }

  private push(cmd: Command): void {
    const top = this.undoStack[this.undoStack.length - 1];
    if (top === cmd) return;
    this.undoStack.push(cmd);
    if (this.undoStack.length > 500) this.undoStack.shift();
    this.redoStack = [];
  }

  // Ends a mergeable gesture so the next one becomes its own undo step.
  seal(): void {
    const top = this.undoStack[this.undoStack.length - 1];
    if (top) top.sealed = true;
  }

  private put(registry: string, id: string, value: unknown): void {
    const table = (this.records[registry] ??= {});
    if (value === undefined) delete table[id];
    else table[id] = value;
    if (registry !== "maps") {
      this.emit("content", id, registry);
      return;
    }
    // palettes can hang off any field (Gen 1 interiors inherit through
    // warps); recomputing is cheap enough to do on every edit
    this.refreshPalettes();
    if (!this.maps[this.currentMap]) this.currentMap = this.fallbackMap();
    this.emit("edit", id);
  }

  // marks the open gesture `label` as made on map `mapId` (see Command.map)
  markMap(label: string, mapId: string): void {
    const top = this.undoStack[this.undoStack.length - 1];
    if (top && !top.sealed && top.label === label) top.map = mapId;
  }

  // after undo/redo: the step's map when it changed one (the tile brush
  // also writes the tileset, which must not pull the view to Graphics)
  private show(cmd: Command, side: "before" | "after"): void {
    if (cmd.map && this.maps[cmd.map]) return this.openMap(cmd.map);
    const change = cmd.changes.find((c) => c.registry === "maps") ?? cmd.changes[0];
    const value = change?.[side];
    if (!change || value === undefined) return;
    if (change.registry === "maps") this.openMap(change.id);
    else this.emit("reveal", change.id, change.registry);
  }

  // true while undo/redo puts recorded values back: listeners that derive
  // changes from edits (trainer sight) must not add to history then
  replaying = false;

  undo(): void {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    this.redoStack.push(cmd);
    this.selection = null;
    this.replaying = true;
    try {
      for (const c of [...cmd.changes].reverse()) this.put(c.registry, c.id, c.before);
    } finally {
      this.replaying = false;
    }
    this.show(cmd, "before");
  }

  redo(): void {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    this.undoStack.push(cmd);
    cmd.sealed = true;
    this.selection = null;
    this.replaying = true;
    try {
      for (const c of cmd.changes) this.put(c.registry, c.id, c.after);
    } finally {
      this.replaying = false;
    }
    this.show(cmd, "after");
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undoLabel(): string {
    return this.undoStack[this.undoStack.length - 1]?.label ?? "";
  }

  // Unsaved since the last load/save (identity check; edits always replace).
  get unsaved(): boolean {
    for (const registry of new Set([...Object.keys(this.records), ...Object.keys(this.savedSnapshot)])) {
      const live = this.table(registry);
      const saved = this.savedSnapshot[registry] ?? {};
      for (const k of new Set([...Object.keys(live), ...Object.keys(saved)])) if (live[k] !== saved[k]) return true;
    }
    return false;
  }

  markSaved(): void {
    this.savedSnapshot = this.snapshot();
    this.emit("saved");
  }
}

export const store = new Store();
