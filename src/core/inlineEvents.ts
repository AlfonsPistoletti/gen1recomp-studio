// Events stored inline in map entities (EventSpec.inline, Gen 2): a map
// person's, sign's or step trigger's `scriptKey` is the script's row list
// itself instead of a key into the game's scripts (gen1recomp Vm:start runs
// either; ISSUES #4). Event ids:
//   <MAP>:talk:obj<index>   a map person (its `index`)
//   <MAP>:talk:sign<k>      the k-th sign (0-based place)
//   <MAP>:step:<k>          the k-th step trigger
//   <MAP>:after:obj<index>  a trainer's talk after the battle (trainer.scriptKey)
//   <MAP>:enter:scene<n>    entering the map in scene n (adapter.scenes script)
// Edits go through the maps registry (one undo history, saved with the map).

import type { EventRow } from "../games/types.ts";
import { clone } from "./merge.ts";
import { store } from "./store.ts";
import type { EntityRecord, MapDef } from "./types.ts";

export interface InlineEvent {
  x?: number;
  y?: number;
  rows: EventRow[];
}

export type InlineKind = "talk" | "step" | "after" | "enter";

// "scene<n>" -> n
const sceneNo = (key: string) => (/^scene(\d+)$/.exec(key) ? Number(key.slice(5)) : null);

const layerOf = (kind: "npc" | "sign" | "trigger") => store.adapter.layers.find((l) => l.kind === kind);

// the entity an event belongs to, in `map` (the live map, a draft or the base)
function entityIn(map: MapDef | undefined, kind: string, key: string): { layer: string; index: number; e: EntityRecord } | null {
  if (!map) return null;
  if (key.startsWith("obj")) {
    const l = layerOf("npc");
    if (!l) return null;
    const list = store.entities(map, l.key);
    const index = list.findIndex((e) => String(e.index) === key.slice(3));
    return index >= 0 ? { layer: l.key, index, e: list[index] } : null;
  }
  const l = layerOf(kind === "step" ? "trigger" : "sign");
  const index = Number(key.replace(/^sign/, ""));
  const e = l && Number.isInteger(index) ? store.entities(map, l.key)[index] : undefined;
  return l && e ? { layer: l.key, index, e } : null;
}

export function inlineTarget(mapId: string, kind: string, key: string): { layer: string; index: number; e: EntityRecord } | null {
  return entityIn(store.maps[mapId], kind, key);
}

const scriptOf = (kind: string, e: EntityRecord) => (kind === "after" ? (e.trainer as { scriptKey?: unknown } | undefined)?.scriptKey : e.scriptKey);

// every inline event of every map; `all`: also the scripts a role made (a
// person's text, a nurse, a shop: EventSpec.preset), which aren't events
export function inlineEvents(all = false): Record<string, InlineEvent> {
  const out: Record<string, InlineEvent> = {};
  const preset = all ? undefined : store.adapter.events?.preset;
  for (const [mapId, map] of Object.entries(store.maps)) {
    const npc = layerOf("npc");
    for (const e of npc ? store.entities(map, npc.key) : []) {
      if (Array.isArray(e.scriptKey)) out[`${mapId}:talk:obj${e.index}`] = { rows: e.scriptKey as EventRow[] };
      const after = scriptOf("after", e);
      if (Array.isArray(after)) out[`${mapId}:after:obj${e.index}`] = { rows: after as EventRow[] };
    }
    const sign = layerOf("sign");
    (sign ? store.entities(map, sign.key) : []).forEach((e, k) => {
      if (Array.isArray(e.scriptKey)) out[`${mapId}:talk:sign${k}`] = { rows: e.scriptKey as EventRow[] };
    });
    const trig = layerOf("trigger");
    (trig ? store.entities(map, trig.key) : []).forEach((e, k) => {
      if (Array.isArray(e.scriptKey)) out[`${mapId}:step:${k}`] = { x: e.x, y: e.y, rows: e.scriptKey as EventRow[] };
    });
    const scenes = store.adapter.scenes;
    for (const n of scenes ? scenes.withScripts(map) : []) {
      const rows = scenes!.script(map, n);
      if (Array.isArray(rows)) out[`${mapId}:enter:scene${n}`] = { rows: rows as EventRow[] };
    }
  }
  if (preset) for (const [id, ev] of Object.entries(out)) if (!id.includes(":after:") && preset(ev.rows)) delete out[id];
  return out;
}

// Entities that still run one of the game's scripts (a key): id -> key, with
// the same ids as inline events (a trainer's game script is its "after" talk);
// `all`: also the ones a role reads (a person's text, a nurse, a shop), which
// aren't events (as in inlineEvents)
export function inlineGameEvents(all = false): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [mapId, map] of Object.entries(store.maps)) {
    const npc = layerOf("npc");
    for (const e of npc ? store.entities(map, npc.key) : []) {
      if (typeof e.scriptKey === "string") out[`${mapId}:${e.trainer ? "after" : "talk"}:obj${e.index}`] = e.scriptKey;
    }
    const sign = layerOf("sign");
    (sign ? store.entities(map, sign.key) : []).forEach((e, k) => {
      if (typeof e.scriptKey === "string") out[`${mapId}:talk:sign${k}`] = e.scriptKey;
    });
    const trig = layerOf("trigger");
    (trig ? store.entities(map, trig.key) : []).forEach((e, k) => {
      if (typeof e.scriptKey === "string") out[`${mapId}:step:${k}`] = e.scriptKey;
    });
    const scenes = store.adapter.scenes;
    for (const n of scenes ? scenes.withScripts(map) : []) {
      const key = scenes!.script(map, n);
      if (typeof key === "string") out[`${mapId}:enter:scene${n}`] = key;
    }
  }
  const ev = store.adapter.events;
  if (!all && ev?.preset && ev.gameRows) {
    for (const [id, key] of Object.entries(out)) {
      const rows = id.includes(":after:") ? null : ev.gameRows(store.ctx, key);
      if (rows && ev.preset(rows)) delete out[id];
    }
  }
  return out;
}

// Event texts are `text` records STUDIO_EVENT_<n> (Gold's writetext takes a
// key, no literal line). A new one is made when a command needs it and
// written with the next event write, in the same undo step; ones no event
// uses any more are removed then too.
const TEXT_PREFIX = "STUDIO_EVENT_";
const pendingTexts: string[] = [];

export function newEventText(): string {
  const texts = store.table("text");
  let n = 1;
  while (texts[`${TEXT_PREFIX}${n}`] !== undefined || pendingTexts.includes(`${TEXT_PREFIX}${n}`)) n++;
  const key = `${TEXT_PREFIX}${n}`;
  pendingTexts.push(key);
  return key;
}

export function syncEventTexts(): void {
  for (const key of pendingTexts.splice(0)) store.follow("text", key, "...{DONE}");
  const used = new Set<string>();
  JSON.stringify(inlineEvents(true), (_k, v: unknown) => (typeof v === "string" && v.startsWith(TEXT_PREFIX) && used.add(v), v));
  const base = store.baseTable("text");
  for (const key of Object.keys(store.table("text"))) {
    if (key.startsWith(TEXT_PREFIX) && !used.has(key) && base[key] === undefined) store.follow("text", key, undefined);
  }
}

function split(id: string): { mapId: string; kind: string; key: string } {
  const [mapId, kind, ...rest] = id.split(":");
  return { mapId, kind, key: rest.join(":") };
}

// Writes an event (or removes it: the entity gets the game's script back, a
// step trigger the studio made goes away). One undo step.
export function writeInline(id: string, label: string, ev: InlineEvent | undefined): void {
  const { mapId, kind, key } = split(id);
  if (!store.maps[mapId]) return;
  // a scene's entering script: the rows, or the game's script for it back
  const scenes = store.adapter.scenes;
  const n = kind === "enter" ? sceneNo(key) : null;
  if (scenes && n !== null) {
    const base = store.base[mapId];
    store.edit(mapId, label, (d) => scenes.setScript(d, n, ev ? clone(ev.rows) : base ? clone(scenes.script(base, n)) : undefined));
    syncEventTexts();
    store.seal();
    return;
  }
  store.edit(mapId, label, (d) => {
    const t = entityIn(d, kind, key);
    if (!t) return;
    const e = d[t.layer as keyof MapDef] as unknown as EntityRecord[];
    const at = e[t.index];
    if (ev) {
      // a beaten trainer talked to runs the person's own script too
      if (kind === "after") at.trainer = { ...(at.trainer as object), scriptKey: clone(ev.rows) };
      at.scriptKey = clone(ev.rows);
      if (kind === "step" && typeof ev.x === "number" && typeof ev.y === "number") {
        at.x = ev.x;
        at.y = ev.y;
      }
      return;
    }
    // the game's own script for this entity, if the base map has it there
    const base = entityIn(store.base[mapId], kind, key)?.e;
    const own = base && base.x === at.x && base.y === at.y ? scriptOf(kind, base) : undefined;
    if (kind === "after") {
      const tr = { ...(at.trainer as Record<string, unknown>) };
      if (own !== undefined) tr.scriptKey = own;
      else delete tr.scriptKey;
      at.trainer = tr;
    } else if (own !== undefined) at.scriptKey = own;
    else if (kind === "step") e.splice(t.index, 1);
    else delete at.scriptKey;
  });
  syncEventTexts();
  store.seal();
}

// A new step trigger on a cell running `rows`; returns its event id.
export function createStepInline(mapId: string, x: number, y: number, rows: EventRow[]): string | null {
  const map = store.maps[mapId];
  const l = layerOf("trigger");
  if (!map || !l) return null;
  const k = store.entities(map, l.key).length;
  store.edit(mapId, "New event", (d) => {
    const rec = l.create(d, x, y, store.ctx);
    rec.scriptKey = clone(rows);
    const list = ((d as unknown as Record<string, unknown>)[l.key] as EntityRecord[] | undefined) ?? [];
    (d as unknown as Record<string, unknown>)[l.key] = [...list, rec];
  });
  syncEventTexts();
  store.seal();
  return `${mapId}:step:${k}`;
}

// people and signs of a map an event can be given to (key, label)
export function inlineTalkers(map: MapDef): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const npc = layerOf("npc");
  for (const e of npc ? store.entities(map, npc.key) : []) out.push({ value: `obj${e.index}`, label: `${npc!.singular} ${e.index}${typeof e.sprite === "string" ? ` · ${String(e.sprite).replace(/^SPRITE_/, "")}` : ""}${Array.isArray(e.scriptKey) ? " (has an event)" : ""}` });
  const sign = layerOf("sign");
  (sign ? store.entities(map, sign.key) : []).forEach((e, k) => out.push({ value: `sign${k}`, label: `${sign!.singular} ${k + 1} (${e.x}, ${e.y})${Array.isArray(e.scriptKey) ? " (has an event)" : ""}` }));
  return out;
}
