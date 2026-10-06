// Locating a gen1recomp install and its imported ROM datasets; the same rules
// as src-tauri/src/paths.rs (see there for the source vs release layouts).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STUDIO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_FILE = path.join(STUDIO_ROOT, "studio.config.json");

export const VERSIONS = ["red", "blue", "yellow", "gold", "silver", "crystal", "firered", "leafgreen", "emerald", "ruby", "sapphire"];
const GEN1 = new Set(["red", "blue", "yellow"]);

export interface Install {
  kind: "source" | "release";
  root: string;
  // the folder holding mods/ ("game" root for the front end)
  modsParent: string;
  portable: boolean;
}

function identity(): string {
  return process.env.POKEPORT_IDENTITY || "pokemon-love2d";
}

// LOVE's per-user data folder; fused builds drop the LOVE/ level.
function saveDir(fused: boolean): string | null {
  let base: string;
  if (process.platform === "win32") {
    if (!process.env.APPDATA) return null;
    base = process.env.APPDATA;
  } else if (process.platform === "darwin") {
    base = path.join(os.homedir(), "Library", "Application Support");
  } else {
    base = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  }
  const love = process.platform === "win32" || process.platform === "darwin" ? "LOVE" : "love";
  return fused ? path.join(base, identity()) : path.join(base, love, identity());
}

function isSource(dir: string): boolean {
  return fs.existsSync(path.join(dir, "src", "mods", "Registry.lua"));
}

function isRelease(dir: string): boolean {
  try {
    return fs.readdirSync(dir).some((n) => {
      const name = n.toLowerCase();
      return name.startsWith("gen1recomp") && (name.endsWith(".exe") || name.endsWith(".app") || name.endsWith(".appimage") || name === "gen1recomp");
    });
  } catch {
    return false;
  }
}

export function detect(dir: string): Install | null {
  const root = path.resolve(dir);
  if (isSource(root)) return { kind: "source", root, modsParent: root, portable: false };
  if (isRelease(root)) {
    const portable = fs.existsSync(path.join(root, "portable.txt"));
    const modsParent = portable ? root : saveDir(true);
    return modsParent ? { kind: "release", root, modsParent, portable } : null;
  }
  return null;
}

function readConfig(): { gameRoot?: string } {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}

let cached: Install | null = null;

export function install(): Install {
  if (cached) return cached;
  const explicit = process.env.GEN1RECOMP_ROOT || readConfig().gameRoot;
  const dir = path.resolve(explicit || path.join(STUDIO_ROOT, "..", "gen1recomp"));
  const found = detect(dir);
  if (!found) {
    throw new Error(
      `No gen1recomp checkout or release found at ${dir}. Set GEN1RECOMP_ROOT or write {"gameRoot": "..."} to ${CONFIG_FILE}.`,
    );
  }
  cached = found;
  return found;
}

export function hasModkit(inst: Install): boolean {
  return inst.kind === "source" && fs.existsSync(path.join(inst.root, "tools", "modkit.py"));
}

// a finished import: the engine writes rom-cache.complete last
// (gen1recomp src/import/CacheContract.lua); a data/generated without it is
// a partial or stale dataset (the source tree's own one lacks audio.lua)
function datasetOk(base: string): boolean {
  return fs.existsSync(path.join(base, "data", "generated", "maps.lua")) && fs.existsSync(path.join(base, "rom-cache.complete"));
}

// The directory holding data/generated and assets/generated of one version,
// or null when that version is not imported.
export function cacheRoot(version: string): string | null {
  const inst = install();
  const explicit = process.env.POKEPORT_DATA_DIR;
  const pinned = (process.env.POKEPORT_VERSION || "red").toLowerCase();
  if (explicit && version === pinned) {
    const base = path.resolve(explicit, "..", "..");
    return datasetOk(base) ? base : null;
  }
  const candidates: string[] = [];
  if (inst.kind === "source") {
    candidates.push(path.join(inst.root, version));
    const user = saveDir(false);
    if (user) candidates.push(path.join(user, version));
    // the historical source-tree dataset is a Gen 1 dataset
    if (GEN1.has(version)) candidates.push(inst.root);
  } else if (inst.portable) {
    candidates.push(path.join(inst.root, version));
  } else {
    const user = saveDir(true);
    if (user) candidates.push(path.join(user, version));
  }
  return candidates.find(datasetOk) ?? null;
}

// Resolves `rel` under `base`, refusing anything that escapes it.
export function within(base: string, rel: string): string | null {
  const full = path.resolve(base, rel);
  const relative = path.relative(base, full);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return full;
}

export const MOD_ID_RE = /^[\w-]+$/;
