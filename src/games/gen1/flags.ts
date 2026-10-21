// Gen 1's event flags (names, EVENT_* or a mod's own) and where they are used,
// for Events > Flags: the game's trainer headers (beaten flags), the game's talk
// events (checkout only, passed in by the Events workspace), the mod's events
// (set_flag / clear_flag / check_flag rows, studio trainers' beaten flags) and
// its visibility rules (studio_visibility: a person shown only while a flag is
// or isn't set).
import type { MapDef } from "../../core/types.ts";
import type { FlagUse, FlagUseKind, GameContext } from "../types.ts";

type Rec = Record<string, unknown>;
const ROW_KIND: Record<string, FlagUseKind> = { set_flag: "set", clear_flag: "clear", check_flag: "check" };

export function gen1FlagUses(ctx: GameContext, gameTalk?: Record<string, { talk: Record<string, unknown[][] | false> }>): Map<string, FlagUse[]> {
  const out = new Map<string, FlagUse[]>();
  const add = (flag: unknown, use: FlagUse) => {
    if (typeof flag !== "string" || !flag) return;
    const list = out.get(flag) ?? [];
    if (!list.some((u) => u.kind === use.kind && u.label === use.label)) list.push(use);
    out.set(flag, list);
  };
  const maps = ctx.maps as Record<string, MapDef & Rec>;
  const objects = (m: MapDef & Rec | undefined) => (Array.isArray(m?.objects) ? (m!.objects as Rec[]) : []);
  // the person (or sign) a talk text id belongs to, on its map
  const talker = (mapId: string, text: string): { layer: string; index: number; label: string } | null => {
    const m = maps[mapId];
    const o = objects(m).findIndex((e) => e.text === text);
    if (o >= 0) return { layer: "objects", index: o, label: `${mapId} NPC ${String(objects(m)[o].index ?? o + 1)}` };
    const signs = Array.isArray(m?.signs) ? (m!.signs as Rec[]) : [];
    const s = signs.findIndex((e) => e.text === text);
    return s >= 0 ? { layer: "signs", index: s, label: `${mapId} sign ${s + 1}` } : null;
  };
  // every flag row in an event's rows (rows may nest)
  const scan = (rows: unknown, use: Omit<FlagUse, "kind">) => {
    const walk = (v: unknown): void => {
      if (!Array.isArray(v)) return;
      const kind = typeof v[0] === "string" ? ROW_KIND[v[0]] : undefined;
      if (kind) add(v[1], { ...use, kind });
      for (const x of v) if (Array.isArray(x)) walk(x);
    };
    walk(rows);
  };

  // the game's trainers: label -> object index -> header (Lua list form = 0-based array)
  const headers = (ctx.data.extra.trainerHeaders ?? {}) as Record<string, unknown>;
  for (const [mapId, m] of Object.entries(maps)) {
    const byIndex = typeof m.label === "string" ? headers[m.label] : undefined;
    if (!byIndex || typeof byIndex !== "object") continue;
    const rows: [number, Rec][] = Array.isArray(byIndex) ? byIndex.map((h, i) => [i + 1, h as Rec]) : Object.entries(byIndex as Rec).map(([k, h]) => [Number(k), h as Rec]);
    for (const [idx, h] of rows) {
      const at = objects(m).findIndex((o) => Number(o.index) === idx);
      add(h?.event, { kind: "beaten", label: `${mapId} NPC ${idx}`, map: mapId, ...(at >= 0 ? { layer: "objects", index: at } : {}) });
    }
  }
  // the game's own talk events (data/scripts, a checkout)
  for (const [mapId, m] of Object.entries(gameTalk ?? {})) {
    for (const [text, rows] of Object.entries(m.talk)) {
      if (!rows) continue;
      const t = talker(mapId, text);
      scan(rows, { label: t?.label ?? `${mapId} ${text}`, map: mapId, eventId: `game:${mapId}:talk:${text}`, ...(t ? { layer: t.layer, index: t.index } : {}) });
    }
  }
  // the mod's events: <MAP>:talk|step|enter:<key>
  for (const [id, ev] of Object.entries((ctx.records.studio_events ?? {}) as Record<string, Rec>)) {
    const [mapId, kind, ...rest] = id.split(":");
    const key = rest.join(":");
    const t = kind === "talk" ? talker(mapId, key) : null;
    const use = { label: t?.label ?? `${mapId} ${kind} ${key}`, map: mapId, eventId: id, own: true, ...(t ? { layer: t.layer, index: t.index } : {}) };
    scan(ev?.rows, use);
    const trainer = ev?.trainer as { flag?: unknown } | undefined;
    if (trainer) add(trainer.flag, { ...use, kind: "beaten" });
  }
  // the mod's visibility rules: "<MAP>:<OBJECT name>" -> { flag, whileSet }
  for (const [key, rule] of Object.entries((ctx.records.studio_visibility ?? {}) as Record<string, { flag?: unknown; whileSet?: unknown }>)) {
    const [mapId, name] = key.split(":");
    const at = objects(maps[mapId]).findIndex((o) => o.name === name);
    add(rule?.flag, { kind: rule?.whileSet === false ? "hides" : "shows", label: `${mapId} ${name}`, map: mapId, own: true, ...(at >= 0 ? { layer: "objects", index: at } : {}) });
  }
  return out;
}
