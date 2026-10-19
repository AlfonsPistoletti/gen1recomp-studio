// Gold's map scenes: a map's story stage, a number saved per map (0 at the
// start). Step triggers fire only in their `sceneId`, `sceneScripts[n]` runs
// once when the player enters the map in scene n, and scripts move it on with
// setscene / setmapscene (gen1recomp src/world/gen2/World.lua tryCoordScript,
// trySceneScript). A scene doesn't change the layout by itself; the studio's
// per-scene layouts are an own MAPCALLBACK_TILES callback (run on every map
// load), built like the weekday people's (weekdays.ts):
//   scall <the game's TILES key> (gameCallback), checkscene,
//   ifequal n [changeblock x y block ...] (studioScene = n) ..., endcallback
// changeblock takes CELL coordinates (block x * 2, y * 2; Vm.lua changeblock).

import type { MapDef } from "../../core/types.ts";

const TILES = "MAPCALLBACK_TILES";

type Row = Record<string, unknown>;
type Callback = { callback?: string; scriptKey?: unknown; type?: number; [k: string]: unknown };
type SceneScript = { sceneId?: number; scriptKey?: unknown; [k: string]: unknown };

const asRows = (v: unknown): Row[] => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : []) as Row[];
const callbacks = (map: MapDef): Callback[] => asRows((map as { callbacks?: unknown }).callbacks) as Callback[];

// the studio's own TILES list: its rows carry studioScene / gameCallback / studioScenes
const isOwn = (v: unknown): v is Row[] => Array.isArray(v) && v.some((r) => (r as Row)?.studioScene !== undefined || (r as Row)?.studioScenes === true);

function tilesGameKey(map: MapDef): string | undefined {
  const cb = callbacks(map).find((c) => c.callback === TILES);
  if (!cb) return undefined;
  if (typeof cb.scriptKey === "string") return cb.scriptKey;
  if (isOwn(cb.scriptKey)) {
    const call = cb.scriptKey.find((r) => r.gameCallback === true);
    return typeof call?.script === "string" ? call.script : undefined;
  }
  return undefined;
}

// ------------------------------------------------------------------ layouts

// scene -> block index (by * width + bx) -> block id, from the studio's callback
export function sceneBlocks(map: MapDef): Map<number, Map<number, number>> {
  const out = new Map<number, Map<number, number>>();
  const cb = callbacks(map).find((c) => c.callback === TILES);
  if (!cb || !isOwn(cb.scriptKey)) return out;
  for (const r of cb.scriptKey) {
    if (typeof r.studioScene !== "number") continue;
    const blocks = new Map<number, number>();
    for (const c of asRows(r.script)) {
      if (c.op !== "changeblock") continue;
      const [x, y, id] = asRows(c.args) as unknown as number[];
      blocks.set(Math.floor(y / 2) * map.width + Math.floor(x / 2), id);
    }
    out.set(r.studioScene, blocks);
  }
  return out;
}

// the map's blocks as scene n shows them (a copy; the map stays as it is)
export function blocksInScene(map: MapDef, n: number): number[] {
  const out = [...map.blocks];
  for (const [i, id] of sceneBlocks(map).get(n) ?? []) if (i >= 0 && i < out.length) out[i] = id;
  return out;
}

function writeLayouts(map: MapDef, all: Map<number, Map<number, number>>): void {
  const key = tilesGameKey(map);
  const list = [...callbacks(map)];
  const at = list.findIndex((c) => c.callback === TILES);
  const scenes = [...all].filter(([, b]) => b.size).sort((a, b) => a[0] - b[0]);
  if (!scenes.length) {
    if (key) list[at] = { ...list[at], scriptKey: key };
    else if (at >= 0) list.splice(at, 1);
  } else {
    const rows: Row[] = [];
    if (key) rows.push({ op: "scall", script: key, gameCallback: true });
    rows.push({ op: "checkscene", studioScenes: true });
    for (const [n, blocks] of scenes) {
      const changes = [...blocks].sort((a, b) => a[0] - b[0]).map(([i, id]) => ({ op: "changeblock", args: [(i % map.width) * 2, Math.floor(i / map.width) * 2, id] }));
      rows.push({ op: "ifequal", value: n, studioScene: n, script: changes });
    }
    rows.push({ op: "endcallback" });
    const entry = { ...(at >= 0 ? list[at] : { callback: TILES, type: 1 }), scriptKey: rows };
    if (at >= 0) list[at] = entry;
    else list.push(entry);
  }
  (map as { callbacks?: unknown }).callbacks = list;
}

// a block of scene n (null, or the map's own block: no change there)
export function setSceneBlock(map: MapDef, n: number, bx: number, by: number, id: number | null): void {
  const all = sceneBlocks(map);
  const blocks = all.get(n) ?? new Map<number, number>();
  const i = by * map.width + bx;
  if (id === null || id === map.blocks[i]) blocks.delete(i);
  else blocks.set(i, id);
  all.set(n, blocks);
  writeLayouts(map, all);
}

export function clearSceneBlocks(map: MapDef, n: number): void {
  const all = sceneBlocks(map);
  all.delete(n);
  writeLayouts(map, all);
}

// ------------------------------------------------------------------ scenes

function sceneScripts(map: MapDef): SceneScript[] {
  return asRows((map as { sceneScripts?: unknown }).sceneScripts) as SceneScript[];
}

// what entering the map in scene n runs: a game key, inline rows, or nothing
export function sceneScriptOf(map: MapDef, n: number): unknown {
  const s = sceneScripts(map).find((x, i) => (x.sceneId ?? i) === n);
  return s?.scriptKey;
}

// the scenes that have an entering script (cheap: no script walk)
export function scenesWithScripts(map: MapDef): number[] {
  return sceneScripts(map).map((s, i) => Number(s.sceneId ?? i));
}

// set scene n's entering script (undefined: drop the scene's entry)
export function setSceneScript(map: MapDef, n: number, script: unknown): void {
  const out: Record<string, SceneScript> = {};
  sceneScripts(map).forEach((s, i) => (out[String(s.sceneId ?? i)] = s));
  if (script === undefined) delete out[String(n)];
  else out[String(n)] = { ...(out[String(n)] ?? {}), sceneId: n, scriptKey: script };
  (map as { sceneScripts?: unknown }).sceneScripts = out;
}

export function sceneNames(map: MapDef): Record<string, string> {
  return ((map as { studioSceneNames?: Record<string, string> }).studioSceneNames ?? {});
}

export function setSceneName(map: MapDef, n: number, name: string): void {
  const names = { ...sceneNames(map) };
  if (name) names[String(n)] = name;
  else delete names[String(n)];
  if (Object.keys(names).length) (map as { studioSceneNames?: unknown }).studioSceneNames = names;
  else delete (map as { studioSceneNames?: unknown }).studioSceneNames;
}

// scene numbers that `setmapscene` rows anywhere give each map ("group:map")
const setBy = new WeakMap<object, Map<string, Set<number>>>();
function mapSceneSets(scripts: Record<string, unknown>): Map<string, Set<number>> {
  const hit = setBy.get(scripts);
  if (hit) return hit;
  const out = new Map<string, Set<number>>();
  JSON.stringify(scripts, (_k, v: unknown) => {
    const r = v as Row | null;
    if (r && typeof r === "object" && r.op === "setmapscene" && typeof r.scene === "number") {
      const k = `${String(r.group)}:${String(r.map)}`;
      out.set(k, (out.get(k) ?? new Set()).add(r.scene));
    }
    return v;
  });
  setBy.set(scripts, out);
  return out;
}

// every scene the map knows: entering scripts, its triggers, setscene rows in
// its own scripts, setmapscene rows aimed at it, names and layouts
export function scenesOf(map: MapDef, scripts: Record<string, unknown>): number[] {
  const out = new Set<number>([0]);
  sceneScripts(map).forEach((s, i) => out.add(Number(s.sceneId ?? i)));
  for (const t of asRows((map as { coordEvents?: unknown }).coordEvents)) out.add(Number(t.sceneId ?? 0));
  for (const k of Object.keys(sceneNames(map))) out.add(Number(k));
  for (const k of sceneBlocks(map).keys()) out.add(k);
  const seen = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === "string") {
      if (v in scripts && !seen.has(v)) {
        seen.add(v);
        walk(scripts[v]);
      }
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      const r = v as Row;
      if (r.op === "setscene" && typeof r.scene === "number") out.add(r.scene);
      Object.values(r).forEach(walk);
    }
  };
  walk([(map as { objects?: unknown }).objects, (map as { bgEvents?: unknown }).bgEvents, (map as { coordEvents?: unknown }).coordEvents, (map as { sceneScripts?: unknown }).sceneScripts, (map as { callbacks?: unknown }).callbacks]);
  const g = (map as { group?: unknown }).group;
  const m = (map as { map?: unknown }).map;
  for (const n of mapSceneSets(scripts).get(`${String(g)}:${String(m)}`) ?? []) out.add(n);
  return [...out].filter(Number.isFinite).sort((a, b) => a - b);
}
