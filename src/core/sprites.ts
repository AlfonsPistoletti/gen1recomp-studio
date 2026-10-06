// Overworld sprites as the editor sees them: records of the "sprites"
// registry (the dataset's, patched by the mod, and the mod's own).
//
// A sheet is a vertical strip of 16x16 frames in the 4 Game Boy shades,
// white transparent (src/render/SpriteRenderer.lua): walkers have 6 frames
// (stand down/up/left, walk down/up/left; right = left mirrored), turners 3
// (stand only), objects 1.

import type { SpriteDef } from "./types.ts";
import { store } from "./store.ts";
import { assetUrl } from "./assets.ts";

export const SPRITES = "sprites";
export const FRAME = 16;

// What the player wears: field.playerSprites (on foot, bike, surf, fly),
// the engine's defaults (src/world/FieldDefaults.lua PLAYER_SPRITES) unless
// the mod sets them.
export type PlayerRole = "walk" | "bike" | "surf" | "fly";
export const PLAYER_ROLES: PlayerRole[] = ["walk", "bike", "surf", "fly"];
export const ROLE_LABELS: Record<PlayerRole, string> = { walk: "On foot", bike: "On the bike", surf: "Surfing", fly: "Flying" };
export const DEFAULT_PLAYER: Record<PlayerRole, string> = { walk: "SPRITE_RED", bike: "SPRITE_RED_BIKE", surf: "SPRITE_SEEL", fly: "SPRITE_BIRD" };

export function playerSprites(): Record<PlayerRole, string> {
  const set = store.table("field").playerSprites as Partial<Record<PlayerRole, string>> | undefined;
  return { ...DEFAULT_PLAYER, ...(set ?? {}) };
}

// the player roles a sprite fills
export function rolesOf(id: string): PlayerRole[] {
  const p = playerSprites();
  return PLAYER_ROLES.filter((r) => p[r] === id);
}

export type SpriteKind = "walker" | "turner" | "object";
export const KIND_FRAMES: Record<SpriteKind, number> = { walker: 6, turner: 3, object: 1 };
export const FRAME_LABELS = ["Stand ↓", "Stand ↑", "Stand ←", "Walk ↓", "Walk ↑", "Walk ←"];

export function liveSprite(id: string): SpriteDef | undefined {
  return store.table(SPRITES)[id] as SpriteDef | undefined;
}

export function spriteUrl(id: string): string {
  const s = liveSprite(id);
  return s?.image ? assetUrl(store.project.host, store.project.version, s.image) : "";
}

export function spriteIds(): string[] {
  return Object.keys(store.table(SPRITES)).sort();
}

export function kindOf(s: SpriteDef): SpriteKind {
  const n = s.frames || 1;
  return s.walker && n >= 6 ? "walker" : n >= 3 ? "turner" : "object";
}

// sheets the editor can rebuild: plain 16x16 vertical strips
export function isSimpleSheet(s: SpriteDef): boolean {
  return (s.frameWidth ?? FRAME) === FRAME && (s.frameHeight ?? FRAME) === FRAME && !s.cells && (Number(s.frameColumns ?? 1) || 1) === 1 && !s.frameOffset;
}

// whether a sprite comes from the dataset (or the mod's main.lua)
export function isBaseSprite(id: string): boolean {
  return store.baseTable(SPRITES)[id] !== undefined;
}

// NPCs on maps that use a sprite: [map id, position in its objects list]
export function spriteUsers(id: string): [string, number][] {
  const out: [string, number][] = [];
  for (const [mapId, map] of Object.entries(store.maps)) {
    store.entities(map, "objects").forEach((o, i) => {
      if (o.sprite === id) out.push([mapId, i]);
    });
  }
  return out.sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]);
}
