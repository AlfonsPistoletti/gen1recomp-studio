// Reusing the game's own art in a mod: never as a file of the mod, always
// as a copy the asset-transforms recipe makes from the player's imported
// files when the game loads (src/core/assets.ts). A mod with an
// assets_transforms file of its own can't (one recipe per manifest).

import { derivedPath, isCachePath, STUDIO_TRANSFORMS } from "./assets.ts";
import { store } from "./store.ts";

export function canDerive(): boolean {
  const t = store.project.transforms;
  return !!store.project.mod && (!t || t === STUDIO_TRANSFORMS);
}

// a path this mod may use for `path`: its own art as is, the game's art as a
// derived copy (when the recipe is available), else null
export function reusable(path: unknown): string | null {
  if (typeof path === "string" && (path.startsWith("mods/") || path.startsWith(`save/mod-derived/${store.project.mod}/`))) return path;
  if (isCachePath(path) && canDerive()) return derivedPath(store.project.mod!, path);
  return null;
}

export const NO_RECIPE = "This mod has its own assets_transforms file, so the studio can't add copies of the game's art to it.";
