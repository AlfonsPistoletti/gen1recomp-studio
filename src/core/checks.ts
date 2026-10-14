// Problems the game would crash on, found before saving. The engine asserts
// on a warp to an unknown map or to a warp number the target map does not
// have (src/world/Warp.lua resolve).

import type { GameAdapter } from "../games/types.ts";
import { diffRecord } from "./merge.ts";
import { warpLayer } from "../render/mapView.ts";
import type { EntityRecord, MapDef } from "./types.ts";

export interface WarpProblem {
  mapId: string;
  index: number; // 0-based warp index on mapId
  destMap: string;
  destWarp: number;
  message: string;
}

export function warpProblem(adapter: GameAdapter, maps: Record<string, MapDef>, mapId: string, index: number): WarpProblem | null {
  const w = warpLayer(adapter);
  const warp = (maps[mapId]?.[w?.layer.key ?? ""] as EntityRecord[] | undefined)?.[index];
  if (!w || !warp) return null;
  const destMap = String(warp[w.spec.mapKey] ?? "");
  const destWarp = Number(warp[w.spec.warpKey] ?? 0);
  // LAST_MAP and friends (Gen 2: warp 255) resolve at runtime
  if (w.spec.specialMaps.includes(destMap) || destWarp === w.spec.backWarp) return null;
  const dest = maps[destMap];
  const base = { mapId, index, destMap, destWarp };
  if (!dest) return { ...base, message: `Warp ${index + 1} on ${mapId} leads to ${destMap || "(no map)"}, which does not exist.` };
  const count = ((dest[w.layer.key] as EntityRecord[] | undefined) ?? []).length;
  if (!(destWarp >= 1 && destWarp <= count)) {
    return {
      ...base,
      message: `Warp ${index + 1} on ${mapId} leads to warp ${destWarp} of ${destMap}, which ${count ? `only has ${count} warp${count === 1 ? "" : "s"}` : "has no warps"}.`,
    };
  }
  return null;
}

// Every broken warp on the given maps.
export function brokenWarps(adapter: GameAdapter, maps: Record<string, MapDef>, mapIds: string[] = Object.keys(maps)): WarpProblem[] {
  const w = warpLayer(adapter);
  if (!w) return [];
  const out: WarpProblem[] = [];
  for (const id of mapIds) {
    const list = (maps[id]?.[w.layer.key] as EntityRecord[] | undefined) ?? [];
    list.forEach((_, i) => {
      const p = warpProblem(adapter, maps, id, i);
      if (p) out.push(p);
    });
  }
  return out;
}

// Records whose saved form would point into the player's ROM-derived cache.
// modkit rejects a mod whose files mention it (MK301). Only what a save
// writes counts: the changed fields of a base record, a new record whole
// (an edited vanilla Pokémon still has cache paths in its unchanged fields).
export function romReferences(
  changed: Record<string, Record<string, unknown>>,
  base: (registry: string) => Record<string, unknown>,
): string[] {
  const out: string[] = [];
  for (const [registry, records] of Object.entries(changed)) {
    for (const [id, value] of Object.entries(records)) {
      if (value === null || value === undefined) continue;
      const old = base(registry)[id];
      const written = old === undefined ? value : diffRecord(old, value);
      const text = JSON.stringify(written ?? "");
      if (text.includes("assets/generated/") || text.includes("data/generated/")) out.push(`${registry} ${id}`);
    }
  }
  return out;
}
