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
