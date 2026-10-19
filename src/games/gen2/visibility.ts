// When a Gold map person is there. Gold has no per-scene people: a person is
// hidden while its event flag is set (MAPOBJECT_EVENT_FLAG), a new game starts
// with initial_events.lua's flags set, and scripts `appear` / `disappear` it
// (object number = index + 1) or set / clear its flag. The Olivine rival, for
// one: flag 1731 is set at the start, scene 0's step triggers appear him, then
// disappear him and setscene 1.

import type { MapDef } from "../../core/types.ts";

type Row = Record<string, unknown>;
const asRows = (v: unknown): Row[] => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : []) as Row[];
const NO_FLAG = 0xffff;

// the scripts of a map, each with what starts it
function roots(map: MapDef): { label: string; key: unknown }[] {
  const out: { label: string; key: unknown }[] = [];
  asRows(map.objects).forEach((o) => out.push({ label: `person ${String(o.index)}`, key: o.scriptKey }));
  asRows((map as { bgEvents?: unknown }).bgEvents).forEach((b, k) => out.push({ label: `sign ${k + 1}`, key: b.scriptKey }));
  asRows((map as { coordEvents?: unknown }).coordEvents).forEach((t) => out.push({ label: `step trigger ${String(t.x)}, ${String(t.y)} (scene ${String(t.sceneId ?? 0)})`, key: t.scriptKey }));
  asRows((map as { sceneScripts?: unknown }).sceneScripts).forEach((s, i) => out.push({ label: `entering in scene ${String(s.sceneId ?? i)}`, key: s.scriptKey }));
  asRows((map as { callbacks?: unknown }).callbacks).forEach((c) => out.push({ label: `the map's ${String(c.callback ?? "").replace(/^MAPCALLBACK_/, "").toLowerCase()} script`, key: c.scriptKey }));
  return out;
}

// what shows / hides person `objIndex` (its `index`) and whether a new game hides it
export function visibilityNote(map: MapDef, objIndex: number, scripts: Record<string, unknown>, startFlags: Set<number>): string | null {
  const o = asRows(map.objects).find((x) => Number(x.index) === objIndex);
  if (!o) return null;
  const n = objIndex + 1;
  const flag = Number(o.eventFlag ?? NO_FLAG);
  const shown = new Set<string>();
  const hidden = new Set<string>();
  for (const r of roots(map)) {
    const seen = new Set<string>();
    const walk = (v: unknown): void => {
      if (typeof v === "string") {
        if (v in scripts && !seen.has(v)) {
          seen.add(v);
          walk(scripts[v]);
        }
      } else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") {
        const row = v as Row;
        const obj = Number(row.object ?? asRows(row.args)[0]);
        if ((row.op === "appear" && obj === n) || (row.op === "clearevent" && flag !== NO_FLAG && row.event === flag)) shown.add(r.label);
        if ((row.op === "disappear" && obj === n) || (row.op === "setevent" && flag !== NO_FLAG && row.event === flag)) hidden.add(r.label);
        Object.values(row).forEach(walk);
      }
    };
    walk(r.key);
  }
  const parts: string[] = [];
  if (flag !== NO_FLAG && startFlags.has(flag)) parts.push(`Hidden at the start (flag ${flag} is set in a new game).`);
  if (shown.size) parts.push(`Shown by: ${[...shown].join(", ")}.`);
  if (hidden.size) parts.push(`Hidden by: ${[...hidden].join(", ")}.`);
  if (!parts.length) return flag === NO_FLAG ? null : `Hidden while flag ${flag} is set.`;
  if (flag !== NO_FLAG) parts.push("Other maps' scripts may set or clear its flag too.");
  return parts.join(" ");
}
