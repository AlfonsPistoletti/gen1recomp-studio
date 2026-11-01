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

// A labelled block: { op = "sjump", label = "menu", script = rows } jumps into
// rows that may jump back to their own start (script "studio:label:menu", a
// prize counter's menu after each prize). A row list can't hold itself, so the
// save registers the block as <holder key>_MENU and both jumps name that key.
const LABEL = "studio:label:";

function outlineLabels(rows: unknown, key: string, regs: Map<string, unknown>): unknown {
  const keyOf = (name: string) => `${key}_${name.toUpperCase()}`;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (typeof v === "string") return v.startsWith(LABEL) ? keyOf(v.slice(LABEL.length)) : v;
    if (!v || typeof v !== "object") return v;
    const r = v as Rec;
    const out: Rec = {};
    for (const [k, x] of Object.entries(r)) if (k !== "label") out[k] = walk(x);
    if (typeof r.label === "string" && Array.isArray(r.script)) {
      regs.set(keyOf(r.label), out.script);
      out.script = keyOf(r.label);
    }
    return out;
  };
  return walk(rows);
}

// back: a jump to one of the holder's own blocks becomes the labelled block
function inlineLabels(rows: unknown, key: string, scripts: Record<string, unknown>): unknown {
  const open = new Map<string, string>(); // block key -> label, while inside it
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (typeof v === "string") return open.has(v) ? LABEL + open.get(v) : v;
    if (!v || typeof v !== "object") return v;
    const r = v as Rec;
    const block = r.op === "sjump" && typeof r.script === "string" && r.script.startsWith(`${key}_`) && !open.has(r.script) ? scripts[r.script] : undefined;
    if (Array.isArray(block)) {
      const sub = r.script as string;
      const label = sub.slice(key.length + 1).toLowerCase();
      open.set(sub, label);
      const inner = walk(structuredClone(block));
      open.delete(sub);
      return { ...r, label, script: inner };
    }
    return Object.fromEntries(Object.entries(r).map(([k, x]) => [k, walk(x)]));
  };
  return walk(rows);
}

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
      regs.set(key, outlineLabels(h.scriptKey, key, regs));
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
      if (Array.isArray(rows)) h.scriptKey = inlineLabels(structuredClone(rows), h.scriptKey as string, scripts);
    }
  }
}

// Phone contacts (the phone_contacts registry): a contact's calleeKey /
// callerKey may hold its own call inline; saved as STUDIO_PHONE_<CONTACT>_CALLEE
// / _CALLER (gen1recomp Phone.lua copies the record's keys onto its row, and
// the call runs vm.scripts[key]).
const CALLS = [["calleeKey", "CALLEE"], ["callerKey", "CALLER"]] as const;

export function outlineContacts(table: Record<string, unknown>): { table: Record<string, unknown>; registrations: ScriptRegistration[] } {
  const out: Record<string, unknown> = {};
  const registrations: ScriptRegistration[] = [];
  for (const [id, rec] of Object.entries(table)) {
    let r = rec as Rec | undefined;
    // a call time with no call to run (a mod's own contact whose call was removed): the engine
    // refuses the whole mod for it, so that way of calling is switched off
    for (const [f] of CALLS) {
      const time = f === "calleeKey" ? "calleeTime" : "callerTime";
      if (r && r[f] === undefined && Number(r[time] ?? 0) > 0) r = { ...r, [time]: 0 };
    }
    if (!r || !CALLS.some(([f]) => Array.isArray(r![f]))) {
      out[id] = r;
      continue;
    }
    const copy = structuredClone(r);
    for (const [f, part] of CALLS) {
      if (!Array.isArray(copy[f])) continue;
      const key = `${PREFIX}${id}_${part}`;
      registrations.push({ id: key, value: copy[f] });
      copy[f] = key;
    }
    out[id] = copy;
  }
  return { table: out, registrations };
}

export function inlineContacts(table: Record<string, unknown>, scripts: Record<string, unknown>): void {
  for (const rec of Object.values(table)) {
    const r = rec as Rec | undefined;
    if (!r) continue;
    for (const [f] of CALLS) {
      const rows = typeof r[f] === "string" && ownsScript(String(r[f])) ? scripts[String(r[f])] : undefined;
      if (Array.isArray(rows)) r[f] = structuredClone(rows);
    }
  }
}

// the script ids a studio save writes (regenerated on every save)
export const ownsScript = (id: string): boolean => id.startsWith(PREFIX) || id.startsWith(`movement:${MOVE}`);
