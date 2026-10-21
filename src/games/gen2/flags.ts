// Gold's event flags (numbers 0-2047) and where the game and the mod use them,
// for Events > Flags: script rows (setevent / clearevent / checkevent, followed
// through the scripts they call), a person's eventFlag (hidden while set; an
// item ball's: taken), a trainer's beaten flag, a hidden item's, the flags a new
// game starts with, and phone contacts' calls.
import type { MapDef } from "../../core/types.ts";
import type { FlagUse, FlagUseKind, GameContext } from "../types.ts";

type Rec = Record<string, unknown>;
const asList = (v: unknown): Rec[] => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : []) as Rec[];
const ROW_KIND: Record<string, FlagUseKind> = { setevent: "set", clearevent: "clear", checkevent: "check" };
const NO_FLAG = 0xffff;

export function gen2FlagUses(ctx: GameContext, scripts: Record<string, unknown>, startFlags: Set<number>): Map<string, FlagUse[]> {
  const out = new Map<string, FlagUse[]>();
  const add = (flag: unknown, use: FlagUse) => {
    const n = Number(flag);
    if (!Number.isInteger(n) || n < 0 || n >= NO_FLAG) return;
    const key = String(n);
    const list = out.get(key) ?? [];
    if (!list.some((u) => u.kind === use.kind && u.label === use.label)) list.push(use);
    out.set(key, list);
  };
  // the flag rows a script runs: its own rows (inline lists) and the game's scripts it names
  const scan = (body: unknown, use: Omit<FlagUse, "kind">) => {
    const seen = new Set<string>();
    const walk = (v: unknown): void => {
      const list = typeof v === "string" ? (seen.has(v) ? null : (seen.add(v), scripts[v])) : v;
      if (!Array.isArray(list)) return;
      for (const r of list as Rec[]) {
        const kind = ROW_KIND[String(r.op)];
        if (kind) add(r.event, { ...use, kind });
        for (const x of Object.values(r)) if (typeof x === "string" ? x in scripts : Array.isArray(x)) walk(x);
      }
    };
    walk(body);
  };
  const eventId = (body: unknown, id: string) => (Array.isArray(body) ? id : typeof body === "string" ? `game:${id}` : undefined);

  for (const [mapId, map] of Object.entries(ctx.maps) as [string, MapDef & Rec][]) {
    asList(map.objects).forEach((o, i) => {
      const who = `${mapId} NPC ${String(o.index ?? i)}`;
      const at = { map: mapId, layer: "objects", index: i };
      const tr = o.trainer as Rec | undefined;
      scan(o.scriptKey, { ...at, label: who, eventId: eventId(o.scriptKey, `${mapId}:${tr ? "after" : "talk"}:obj${String(o.index)}`), own: Array.isArray(o.scriptKey) });
      if (tr && tr.scriptKey !== o.scriptKey) scan(tr.scriptKey, { ...at, label: `${who} after battle`, eventId: eventId(tr.scriptKey, `${mapId}:after:obj${String(o.index)}`), own: Array.isArray(tr.scriptKey) });
      if (tr) add(tr.event, { ...at, kind: "beaten", label: who });
      if (o.eventFlag !== undefined) add(o.eventFlag, { ...at, kind: o.itemball ? "item" : "hides", label: who });
    });
    asList(map.bgEvents).forEach((e, k) => {
      const who = `${mapId} sign ${k + 1}`;
      const at = { map: mapId, layer: "bgEvents", index: k };
      scan(e.scriptKey, { ...at, label: who, eventId: eventId(e.scriptKey, `${mapId}:talk:sign${k}`), own: Array.isArray(e.scriptKey) });
      const hidden = e.hiddenItem as Rec | undefined;
      if (hidden) add(hidden.event, { ...at, kind: "hidden", label: who });
    });
    asList(map.coordEvents).forEach((e, k) => {
      scan(e.scriptKey, { map: mapId, layer: "coordEvents", index: k, label: `${mapId} trigger ${k + 1}`, eventId: eventId(e.scriptKey, `${mapId}:step:${k}`), own: Array.isArray(e.scriptKey) });
    });
    asList(map.sceneScripts).forEach((sc, k) => {
      const n = Number(sc.sceneId ?? k);
      scan(sc.scriptKey, { map: mapId, label: `${mapId} entering in scene ${n}`, eventId: eventId(sc.scriptKey, `${mapId}:enter:scene${n}`), own: Array.isArray(sc.scriptKey) });
    });
    asList(map.callbacks).forEach((cb) => {
      scan(cb.scriptKey, { map: mapId, label: `${mapId} map script (${String(cb.callback ?? "").replace(/^MAPCALLBACK_/, "").toLowerCase()})`, own: Array.isArray(cb.scriptKey) });
    });
  }
  for (const [id, c] of Object.entries((ctx.records.phone_contacts ?? {}) as Record<string, Rec>)) {
    const name = id.replace(/^PHONE_/, "").toLowerCase().replace(/_/g, " ").replace(/(^| )\w/g, (x) => x.toUpperCase());
    for (const dir of ["callee", "caller"] as const) {
      const body = c[`${dir}Key`];
      scan(body, { label: `Phone: ${name} (${dir === "callee" ? "you call" : "calls you"})`, contact: id, eventId: eventId(body, `PHONE:${dir}:${id}`), own: Array.isArray(body) });
    }
  }
  for (const f of startFlags) add(f, { kind: "start", label: "A new game" });
  return out;
}
