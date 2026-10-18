// People who appear on certain days of the week (Gold's travelling siblings,
// the Lake of Rage fisher, ...). Gold has no field for it: the map's
// MAPCALLBACK_OBJECTS script reads VAR_WEEKDAY and `appear`s / `disappear`s
// objects (gen1recomp src/world/gen2/World.lua runMapCallback; the object's
// event flag carries it). The studio reads a person's days by running that
// callback for each day, and writes days as an inline callback of its own:
// the game's callback first (scall), then one block per person the mod set
//   disappear N; readvar VAR_WEEKDAY; ifequal <day> [appear N] ...
// (a taken ifequal ends only its own list, so each block is scall'd).

import type { MapDef } from "../../core/types.ts";

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const VAR_WEEKDAY = 11;
const OBJECTS = "MAPCALLBACK_OBJECTS";

type Row = Record<string, unknown>;
type Callback = { callback?: string; scriptKey?: unknown; type?: number; [k: string]: unknown };

const asRows = (v: unknown): Row[] => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : []) as Row[];
const objectOf = (r: Row) => Number(r.object ?? asRows(r.args)[0]);

function callbacks(map: MapDef): Callback[] {
  return asRows((map as { callbacks?: unknown }).callbacks) as Callback[];
}

// the studio's own callback list (written below): its rows carry `weekday`
const isOwn = (v: unknown): v is Row[] => Array.isArray(v) && v.some((r) => (r as Row)?.weekday !== undefined || (r as Row)?.gameCallback === true);

// the game's callback key behind the map's current OBJECTS callback
function gameKey(map: MapDef): string | undefined {
  const cb = callbacks(map).find((c) => c.callback === OBJECTS);
  if (!cb) return undefined;
  if (typeof cb.scriptKey === "string") return cb.scriptKey;
  if (isOwn(cb.scriptKey)) {
    const call = cb.scriptKey.find((r) => r.gameCallback === true);
    return typeof call?.script === "string" ? call.script : undefined;
  }
  return undefined;
}

// which objects a callback list leaves shown / hidden on `day` (null: it
// depends on something else, e.g. an event flag check)
function run(rows: unknown, scripts: Record<string, unknown>, day: number, out: Map<number, boolean>, depth = 0): "end" | "ok" | null {
  const list = typeof rows === "string" ? scripts[rows] : rows;
  if (depth > 20) return null;
  let v: number | null = null;
  for (const r of asRows(list)) {
    const op = r.op;
    if (op === "end" || op === "endcallback" || op === "endall") return "end";
    if (op === "readvar") v = r.var === VAR_WEEKDAY ? day : null;
    else if (op === "appear" || op === "disappear") out.set(objectOf(r), op === "appear");
    else if (op === "scall" || op === "farscall") {
      if (run(r.script, scripts, day, out, depth + 1) === null) return null;
    } else if (op === "sjump" || op === "farsjump") {
      return run(r.script, scripts, day, out, depth + 1) === null ? null : "end";
    } else if (op === "ifequal" || op === "ifnotequal") {
      if (v === null) return null;
      const taken = op === "ifequal" ? v === r.value : v !== r.value;
      if (taken) return run(r.script, scripts, day, out, depth + 1) === null ? null : "end";
    } else if (op === "iftrue" || op === "iffalse") {
      // a flag or the time decides: not a weekday rule this reads
      return null;
    }
  }
  return "ok";
}

// the days object number `n` is there, read from `rows` (null: every day,
// or not a weekday rule)
function daysIn(rows: unknown, scripts: Record<string, unknown>, n: number): number[] | null {
  const days: number[] = [];
  let touched = false;
  for (let d = 0; d < 7; d++) {
    const out = new Map<number, boolean>();
    if (run(rows, scripts, d, out) === null) return null;
    if (out.has(n)) touched = true;
    if (out.get(n) !== false) days.push(d);
  }
  return touched && days.length < 7 ? days : null;
}

// a person's days on the map as it is now (Gold object number = index + 1)
export function weekdaysOf(map: MapDef, objIndex: number, scripts: Record<string, unknown>): number[] | null {
  const cb = callbacks(map).find((c) => c.callback === OBJECTS);
  return cb ? daysIn(cb.scriptKey, scripts, objIndex + 1) : null;
}

// set a person's days on a draft map (null: every day); `days` equal to the
// game's own drops the person's block, and with no blocks left the map gets
// the game's callback back
export function setWeekdays(map: MapDef, objIndex: number, days: number[] | null, scripts: Record<string, unknown>): void {
  const n = objIndex + 1;
  const key = gameKey(map);
  const cbs = callbacks(map);
  const at = cbs.findIndex((c) => c.callback === OBJECTS);
  const cur = at >= 0 ? cbs[at].scriptKey : undefined;
  const blocks = new Map<number, number[]>();
  if (isOwn(cur)) for (const r of cur) if (typeof r.weekday === "number") blocks.set(r.weekday, (r.days as number[]) ?? []);
  const game = key ? daysIn(key, scripts, n) : null;
  const same = (a: number[] | null, b: number[] | null) => JSON.stringify(a) === JSON.stringify(b);
  if (same(days, game)) blocks.delete(n);
  else blocks.set(n, days ?? [0, 1, 2, 3, 4, 5, 6]);
  const list = [...cbs];
  if (!blocks.size) {
    if (key) list[at] = { ...cbs[at], scriptKey: key };
    else if (at >= 0) list.splice(at, 1);
  } else {
    const rows: Row[] = [];
    if (key) rows.push({ op: "scall", script: key, gameCallback: true });
    for (const [obj, ds] of [...blocks].sort((a, b) => a[0] - b[0])) {
      rows.push({
        op: "scall", weekday: obj, days: ds,
        script: [
          { op: "disappear", args: [obj], object: obj },
          { op: "readvar", var: VAR_WEEKDAY },
          ...ds.map((d) => ({ op: "ifequal", value: d, script: [{ op: "appear", args: [obj], object: obj }] })),
        ],
      });
    }
    rows.push({ op: "endcallback" });
    const entry = { ...(at >= 0 ? cbs[at] : { callback: OBJECTS, type: 2 }), scriptKey: rows };
    if (at >= 0) list[at] = entry;
    else list.push(entry);
  }
  (map as { callbacks?: unknown }).callbacks = list;
}
