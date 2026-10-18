// The game's own map events, read from a gen1recomp source checkout
// (data/scripts). Release builds pack those scripts into the game, so there
// the Events workspace only shows events made in the studio.

import type { Host } from "../host/types.ts";
import { loadGameScripts, type GameScripts } from "../lua/vm.ts";

// per version: what the maps get, and the script files the version loads
interface Loaded {
  maps: GameScripts;
  files: Map<string, string>;
}
const cache = new Map<string, Promise<Loaded | null>>();

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

function loaded(host: Host, version: string): Promise<Loaded | null> {
  let p = cache.get(version);
  if (!p) {
    p = (async () => {
      const files = await scriptFiles(host);
      if (!files) return null;
      const r = await loadGameScripts(files, version);
      return { maps: r.maps, files: new Map([...files].filter(([rel]) => r.files.includes(rel))) };
    })();
    p.catch(() => cache.delete(version));
    cache.set(version, p);
  }
  return p;
}

// A trainer battle a script starts (rival fights, gen1recomp's post-game
// CHIEF and Prof. Oak): class, team number and the script file.
export interface ScriptBattle {
  cls: string;
  party: number;
  where: string;
}

// The battles the game's scripts start ({ "rival_battle", class, team } and
// { "start_battle", "trainer", class, team } rows), in the files this
// version loads; [] on a release build, whose scripts can't be read.
const battles = new Map<string, Promise<ScriptBattle[]>>();
export function scriptBattles(host: Host, version: string): Promise<ScriptBattle[]> {
  const known = battles.get(version);
  if (known) return known;
  const p = loaded(host, version).then((r) => {
    const files = r?.files;
    const out: ScriptBattle[] = [];
    const re = /\{\s*"(rival_battle|start_battle)",\s*(?:"trainer",\s*)?"(OPP_[A-Z0-9_]+)",\s*(\d+)/g;
    // rival battles name a base team and fight base + 0/1/2 by the player's
    // starter (Commands.rival_battle); Route 22 passes the base through
    // route22Scene, and Oak's Lab computes team 1..3 from the same flags
    const triple = (cls: string, base: number, where: string) => [0, 1, 2].forEach((k) => out.push({ cls, party: base + k, where }));
    for (const [path, text] of files ?? []) {
      const where = path.split("/").pop()!.replace(/\.lua$/, "");
      for (const m of text.matchAll(re)) {
        if (m[1] === "rival_battle") triple(m[2], Number(m[3]), where);
        else out.push({ cls: m[2], party: Number(m[3]), where });
      }
      for (const m of text.matchAll(/route22Scene\([^)]*?"(OPP_[A-Z0-9_]+)",\s*(\d+)/g)) triple(m[1], Number(m[2]), where);
      if (/\{\s*"start_battle",\s*"trainer",\s*"OPP_RIVAL1",\s*party\s*\}/.test(text)) triple("OPP_RIVAL1", 1, where);
    }
    return out;
  }).catch(() => []);
  battles.set(version, p);
  return p;
}

// null when this install has no readable game scripts (a release build)
export function gameEvents(host: Host, version: string): Promise<GameScripts | null> {
  return loaded(host, version).then((r) => r?.maps ?? null);
}

// A Pokémon the game gives away (not the starters: Global > Starter Pokémon).
export interface GameGift {
  map: string;
  // the talk text of the NPC or ball that gives it, when known
  text: string | null;
  species: string;
  level: number;
  // texts its script shows (to rename the Pokémon in them)
  texts: string[];
  note?: string;
  // Gen 2: the map person who gives it (layer key, list place)
  at?: { layer: string; index: number };
}

// Gifts whose species the game's code picks at run time (no literal row):
// restated from data/scripts story4.lua dojoBall and story2.lua's fossil table.
const CODE_GIFTS: GameGift[] = [
  { map: "FIGHTING_DOJO", text: "TEXT_FIGHTINGDOJO_HITMONLEE_POKE_BALL", species: "HITMONLEE", level: 30, texts: [], note: "The player takes one of the two." },
  { map: "FIGHTING_DOJO", text: "TEXT_FIGHTINGDOJO_HITMONCHAN_POKE_BALL", species: "HITMONCHAN", level: 30, texts: [], note: "The player takes one of the two." },
  { map: "CINNABAR_LAB_FOSSIL_ROOM", text: "TEXT_CINNABARLABFOSSILROOM_SCIENTIST1", species: "OMANYTE", level: 30, texts: [], note: "Revived from the Helix Fossil." },
  { map: "CINNABAR_LAB_FOSSIL_ROOM", text: "TEXT_CINNABARLABFOSSILROOM_SCIENTIST1", species: "KABUTO", level: 30, texts: [], note: "Revived from the Dome Fossil." },
  { map: "CINNABAR_LAB_FOSSIL_ROOM", text: "TEXT_CINNABARLABFOSSILROOM_SCIENTIST1", species: "AERODACTYL", level: 30, texts: [], note: "Revived from the Old Amber." },
];

// Every gift of this version's scripts: talk rows (map, NPC and texts known),
// literal give_pokemon rows inside script code (map and NPC from the
// nearest M.<MAP> / TEXT_ before them), and CODE_GIFTS. Oak's Lab is left
// to the starters. [] on a release build.
const gifts = new Map<string, Promise<GameGift[]>>();
export function gameGifts(host: Host, version: string): Promise<GameGift[]> {
  const known = gifts.get(version);
  if (known) return known;
  const p = loaded(host, version).then((r) => {
    if (!r) return [];
    const out: GameGift[] = [];
    const has = (map: string, species: string) => out.some((g) => g.map === map && g.species === species);
    for (const [map, m] of Object.entries(r.maps)) {
      if (map === "OAKS_LAB") continue;
      for (const [text, rows] of Object.entries(m.talk)) {
        if (!rows) continue;
        const texts = rows.filter((row) => (row[0] === "show_text" || row[0] === "ask") && typeof row[1] === "string").map((row) => row[1] as string);
        for (const row of rows) {
          if (row[0] === "give_pokemon" && typeof row[1] === "string" && typeof row[2] === "number" && !has(map, row[1])) out.push({ map, text, species: row[1], level: row[2], texts });
        }
      }
    }
    for (const [, src] of r.files) {
      for (const m of src.matchAll(/"give_pokemon",\s*"([A-Z0-9_]+)",\s*(\d+)/g)) {
        const before = src.slice(0, m.index);
        const map = [...before.matchAll(/^M\.([A-Z0-9_]+)\s*=/gm)].pop()?.[1];
        if (!map || map === "OAKS_LAB" || has(map, m[1])) continue;
        const text = [...before.matchAll(/(TEXT_[A-Z0-9_]+)\s*=/g)].pop()?.[1] ?? null;
        out.push({ map, text, species: m[1], level: Number(m[2]), texts: [] });
      }
    }
    for (const g of CODE_GIFTS) if (r.maps[g.map] && !has(g.map, g.species)) out.push(g);
    return out.sort((a, b) => a.map.localeCompare(b.map) || a.species.localeCompare(b.species));
  }).catch(() => []);
  gifts.set(version, p);
  return p;
}
