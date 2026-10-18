// What Gold's own party items do, for the item effect editor: the ones a custom
// effect can restate start from their blocks ("Customize this effect").
// Restated from gen1recomp src/core/gen2/ItemEffects.lua (HEAL_HP, HEAL_STATUS,
// REVIVE, RESTORE_PP, VITAMIN, RARE_CANDY, the stones): those are also the ids
// with an engine-owned item_effects record, so a custom effect overrides them.

import type { ItemEffectSpec } from "../types.ts";
import { describeItemEffect } from "../gen1/items.ts";

const HEAL_HP: Record<string, number> = {
  FRESH_WATER: 50, SODA_POP: 60, LEMONADE: 80, HYPER_POTION: 200, SUPER_POTION: 50, POTION: 20, MAX_POTION: 999,
  FULL_RESTORE: 999, MOOMOO_MILK: 100, BERRY: 10, GOLD_BERRY: 30, ENERGYPOWDER: 50, ENERGY_ROOT: 200, RAGECANDYBAR: 20, BERRY_JUICE: 20,
};
const HEAL_STATUS: Record<string, string> = {
  ANTIDOTE: "psn", BURN_HEAL: "brn", ICE_HEAL: "frz", AWAKENING: "slp", PARLYZ_HEAL: "par", FULL_HEAL: "all", HEAL_POWDER: "all",
  PSNCUREBERRY: "psn", PRZCUREBERRY: "par", BURNT_BERRY: "frz", ICE_BERRY: "brn", MINT_BERRY: "slp", MIRACLEBERRY: "all",
};
const REVIVE: Record<string, number> = { REVIVE: 50, MAX_REVIVE: 100, REVIVAL_HERB: 100 };
const RESTORE_PP: Record<string, { amount: number | "all"; each?: boolean }> = {
  ETHER: { amount: 10 }, MAX_ETHER: { amount: "all" }, MYSTERYBERRY: { amount: 5 }, ELIXER: { amount: 10, each: true }, MAX_ELIXER: { amount: "all", each: true },
};
const VITAMIN: Record<string, string> = { HP_UP: "hp", PROTEIN: "attack", IRON: "defense", CARBOS: "speed", CALCIUM: "special" };
const STONES = ["SUN_STONE", "MOON_STONE", "FIRE_STONE", "THUNDERSTONE", "WATER_STONE", "LEAF_STONE"];

// the ids the engine registers itself (a mod overrides these, registers the rest);
// a function: a module-level call would survive tree shaking into release builds
export const gen2EffectItems = (): string[] => [...Object.keys(HEAL_HP), ...Object.keys(HEAL_STATUS), ...Object.keys(REVIVE), ...Object.keys(RESTORE_PP), ...Object.keys(VITAMIN), "PP_UP", "RARE_CANDY", ...STONES];

// status classes the engine's cures compare (ItemEffects.STATUS_CLASS)
export const GEN2_ITEM_STATUSES = [
  { id: "slp", label: "Sleep" }, { id: "psn", label: "Poison" }, { id: "par", label: "Paralysis" }, { id: "brn", label: "Burn" }, { id: "frz", label: "Freeze" },
];
export const GEN2_EXP_STATS = ["hp", "attack", "defense", "speed", "special"];

export function gen2ItemTemplate(id: string): ItemEffectSpec | null {
  const party = (steps: ItemEffectSpec["steps"]): ItemEffectSpec => ({ target: "party", steps });
  // Full Restore: the heal, and at full HP the cure alone
  if (id === "FULL_RESTORE") return party([{ act: "heal", full: true }, { act: "cure" }]);
  if (HEAL_HP[id]) return party([HEAL_HP[id] >= 999 ? { act: "heal", full: true } : { act: "heal", amount: HEAL_HP[id] }]);
  const cure = HEAL_STATUS[id];
  if (cure) return party([cure === "all" ? { act: "cure" } : { act: "cure", statuses: [cure] }]);
  if (REVIVE[id]) return party([{ act: "revive", percent: REVIVE[id] }]);
  const pp = RESTORE_PP[id];
  if (pp) return party([{ act: "pp", ...(pp.amount === "all" ? { full: true } : { amount: pp.amount }), all: !!pp.each }]);
  if (VITAMIN[id]) return party([{ act: "statexp", stat: VITAMIN[id] }]);
  if (id === "RARE_CANDY") return party([{ act: "level" }]);
  if (STONES.includes(id)) return party([{ act: "evolve" }]);
  return null;
}

// the engine opens a move list in battle only for these (BattleState RESTORE_PP rows)
export const gen2PicksMove = (id: string) => !!RESTORE_PP[id] && !RESTORE_PP[id].each;

// items acting through engine code by id, or a menu of their own: blocks would
// replace what they do (PP Up, balls, X items, Repel, Bicycle, rods, ...)
export function gen2SpecialItem(id: string, item: Record<string, unknown>): boolean {
  if (gen2ItemTemplate(id)) return false;
  if (id === "PP_UP" || id === "BITTER_BERRY" || typeof item.teaches === "string") return true;
  return item.fieldMenu === "ITEMMENU_CURRENT" || item.fieldMenu === "ITEMMENU_CLOSE" || item.battleMenu === "ITEMMENU_CLOSE" || item.pocket === "KEY_ITEM" || item.pocket === "BALL";
}

export function gen2ItemText(id: string, item: Record<string, unknown>): string {
  const t = gen2ItemTemplate(id);
  if (t) return describeItemEffect(t, GEN2_ITEM_STATUSES);
  if (id === "PP_UP") return "Raises a move's maximum PP.";
  if (typeof item.teaches === "string") return `Teaches ${item.teaches}.`;
  if (gen2SpecialItem(id, item)) return "Its use is built into the game's code.";
  return item.fieldMenu === "ITEMMENU_NOUSE" && item.battleMenu === "ITEMMENU_NOUSE" ? "No use from the bag (held, sold, or asked for by scripts)." : "";
}
