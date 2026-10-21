// Gold scripts on disk vs in the studio. The editors keep a studio event as an
// inline row list in its holder's `scriptKey` (a person, a trainer's after-
// battle talk, a sign, a step trigger, a scene's entering script, a map
// callback). A saved mod registers each list as a script of its own instead
// (gen1recomp: map_scripts routes to data.gen2Scripts on Gen 2, engine 070ca01+)
// and the holder names its key; movements the rows use ("studio:<bytes>") are
// registered as "movement:<key>". On load the keys are read back inline.
import type { MapDef } from "../../core/types.ts";

type Rec = Record<string, unknown>;
const PREFIX = "STUDIO_";
const MOVE = "studio:";

const asRows = (v: unknown): Rec[] => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : []) as Rec[];

// each place a map holds a script, with the key name it gets
function holders(map: MapDef): [Rec, string][] {
  const m = map as unknown as Rec;
  const out: [Rec, string][] = [];
  asRows(m.objects).forEach((o, i) => {
    const n = String(o.index ?? i);
    out.push([o, `OBJ${n}`]);
    if (o.trainer && typeof o.trainer === "object") out.push([o.trainer as Rec, `OBJ${n}_AFTER`]);
  });
  asRows(m.bgEvents).forEach((e, k) => out.push([e, `SIGN${k}`]));
  asRows(m.coordEvents).forEach((e, k) => out.push([e, `STEP${k}`]));
  asRows(m.sceneScripts).forEach((s, k) => out.push([s, `SCENE${String(s.sceneId ?? k)}`]));
  asRows(m.callbacks).forEach((c, k) => out.push([c, `CB_${String(c.callback ?? k).replace(/^MAPCALLBACK_/, "")}`]));
  return out;
}

// the steps a studio movement key spells ("studio:13.12.71")
export function studioMovementSteps(key: unknown): number[] | null {
  if (typeof key !== "string" || !key.startsWith(MOVE)) return null;
  const steps = key.slice(MOVE.length).split(".").map(Number);
  return steps.length && steps.every((n) => Number.isInteger(n) && n >= 0 && n < 256) ? steps : null;
}

export interface ScriptRegistration { id: string; value: unknown }

// The maps with every inline script replaced by its key, and what to register.
// Maps without one are passed through as they are.
export function outlineScripts(maps: Record<string, MapDef>): { maps: Record<string, MapDef>; registrations: ScriptRegistration[] } {
  const out: Record<string, MapDef> = {};
  const regs = new Map<string, unknown>();
  const moves = (v: unknown): void => {
    if (!v || typeof v !== "object") return;
    const r = v as Rec;
    const steps = r.op === "applymovement" ? studioMovementSteps(r.movement) : null;
    if (steps) regs.set(`movement:${String(r.movement)}`, steps);
    Object.values(r).forEach(moves);
  };
  for (const [id, map] of Object.entries(maps)) {
    if (!map || !holders(map).some(([h]) => Array.isArray(h.scriptKey))) {
      out[id] = map;
      continue;
    }
    const copy = structuredClone(map);
    for (const [h, part] of holders(copy)) {
      if (!Array.isArray(h.scriptKey)) continue;
      const key = `${PREFIX}${id}_${part}`;
      moves(h.scriptKey);
      regs.set(key, h.scriptKey);
      h.scriptKey = key;
    }
    out[id] = copy;
  }
  return { maps: out, registrations: [...regs].map(([id, value]) => ({ id, value })) };
}

// Back inline: a holder naming one of `scripts` (the mod's own) gets its rows.
export function inlineScripts(maps: Record<string, MapDef>, scripts: Record<string, unknown>): void {
  for (const map of Object.values(maps)) {
    if (!map) continue;
    for (const [h] of holders(map)) {
      const rows = typeof h.scriptKey === "string" && ownsScript(h.scriptKey) ? scripts[h.scriptKey] : undefined;
      if (Array.isArray(rows)) h.scriptKey = structuredClone(rows);
    }
  }
}

// the script ids a studio save writes (regenerated on every save)
export const ownsScript = (id: string): boolean => id.startsWith(PREFIX) || id.startsWith(`movement:${MOVE}`);
