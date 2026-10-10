// The game's own map events, read from a gen1recomp source checkout
// (data/scripts). Release builds pack those scripts into the game, so there
// the Events workspace only shows events made in the studio.

import type { Host } from "../host/types.ts";
import { loadGameScripts, type GameScripts } from "../lua/vm.ts";

const cache = new Map<string, Promise<GameScripts | null>>();

async function scriptFiles(host: Host): Promise<Map<string, string> | null> {
  if ((await host.readText("game", "data/scripts/init.lua")) === null) return null;
  const files = new Map<string, string>();
  const walk = async (dir: string, depth: number): Promise<void> => {
    for (const e of await host.list("game", dir)) {
      const rel = `${dir}/${e.name}`;
      if (e.dir && depth < 2) await walk(rel, depth + 1);
      else if (e.name.endsWith(".lua")) {
        const text = await host.readText("game", rel);
        if (text !== null) files.set(rel, text);
      }
    }
  };
  await walk("data/scripts", 0);
  return files;
}

// A trainer battle a script starts (rival fights, gen1recomp's post-game
// CHIEF and Prof. Oak): class, team number and the script file.
export interface ScriptBattle {
  cls: string;
  party: number;
  where: string;
}

// The battles the game's scripts start ({ "rival_battle", class, team } and
// { "start_battle", "trainer", class, team } rows); [] on a release build,
// whose scripts can't be read.
// ponytail: every version's scripts count (Yellow-only ones show on Red too)
let battles: Promise<ScriptBattle[]> | null = null;
export function scriptBattles(host: Host): Promise<ScriptBattle[]> {
  battles ??= scriptFiles(host).then((files) => {
    const out: ScriptBattle[] = [];
    const re = /\{\s*"(?:rival_battle|start_battle)",\s*(?:"trainer",\s*)?"(OPP_[A-Z0-9_]+)",\s*(\d+)/g;
    for (const [path, text] of files ?? []) {
      const where = path.split("/").pop()!.replace(/\.lua$/, "");
      for (const m of text.matchAll(re)) out.push({ cls: m[1], party: Number(m[2]), where });
    }
    return out;
  }).catch(() => []);
  return battles;
}

// null when this install has no readable game scripts (a release build)
export function gameEvents(host: Host, version: string): Promise<GameScripts | null> {
  let p = cache.get(version);
  if (!p) {
    p = (async () => {
      const files = await scriptFiles(host);
      return files ? loadGameScripts(files, version) : null;
    })();
    p.catch(() => cache.delete(version));
    cache.set(version, p);
  }
  return p;
}
