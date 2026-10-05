// What Gen 1's items do, restated from gen1recomp src/inventory/ItemEffects.lua
// (which hard-codes every effect by item id), and the custom-effect blocks
// that rebuild each family: Potions, status heals, Revives, Ethers/Elixers,
// vitamins, Rare Candy, stones, X items, Dire Hit, Guard Spec, Poké Doll,
// Repels and balls. Everything else (Bicycle, rods, Town Map, ...) can only
// keep its built-in behaviour.

import type { BallRecord, ItemEffectSpec } from "../types.ts";

const HEAL_AMOUNT: Record<string, number> = {
  POTION: 20, SUPER_POTION: 50, HYPER_POTION: 200,
  FRESH_WATER: 50, SODA_POP: 60, LEMONADE: 80,
};

const STATUS_HEAL: Record<string, string[] | null> = {
  ANTIDOTE: ["PSN"], BURN_HEAL: ["BRN"], ICE_HEAL: ["FRZ"], AWAKENING: ["SLP"], PARLYZ_HEAL: ["PAR"],
  FULL_HEAL: null, // every status
};

const VITAMINS: Record<string, string> = { HP_UP: "hp", PROTEIN: "attack", IRON: "defense", CARBOS: "speed", CALCIUM: "special" };
const X_ITEMS: Record<string, string> = { X_ATTACK: "attack", X_DEFEND: "defense", X_SPEED: "speed", X_SPECIAL: "special" };
const REPELS: Record<string, number> = { REPEL: 100, SUPER_REPEL: 200, MAX_REPEL: 250 };
const STONES = new Set(["FIRE_STONE", "WATER_STONE", "THUNDER_STONE", "LEAF_STONE", "MOON_STONE"]);
export const VANILLA_BALLS: Record<string, BallRecord> = {
  MASTER_BALL: { randMax: 0, autoCatch: true, tossAnim: "ULTRATOSS_ANIM", flicker: true },
  POKE_BALL: { randMax: 255, hpFactor: 12, wobbleFactor: 255, tossAnim: "TOSS_ANIM" },
  GREAT_BALL: { randMax: 200, hpFactor: 8, wobbleFactor: 200, tossAnim: "GREATTOSS_ANIM" },
  ULTRA_BALL: { randMax: 150, hpFactor: 12, wobbleFactor: 150, tossAnim: "ULTRATOSS_ANIM", flicker: true },
  SAFARI_BALL: { randMax: 150, hpFactor: 12, wobbleFactor: 150, tossAnim: "ULTRATOSS_ANIM" },
};

// built-in behaviour the blocks can't rebuild
const SPECIAL: Record<string, string> = {
  BICYCLE: "Gets on or off the bike.",
  TOWN_MAP: "Opens the town map.",
  ITEMFINDER: "Looks for hidden items nearby.",
  OLD_ROD: "Fishes (Old Rod).",
  GOOD_ROD: "Fishes (Good Rod).",
  SUPER_ROD: "Fishes (Super Rod).",
  ESCAPE_ROPE: "Escapes from a cave or dungeon to the last Pokémon Center town.",
  POKE_FLUTE: "Wakes up sleeping Pokémon (and Snorlax).",
  COIN_CASE: "Shows the coin count.",
  PP_UP: "Raises a move's max PP (up to 3 times).",
  EXP_ALL: "Shares battle EXP with the whole party while it is in the bag.",
};

const PICKS_MOVE = new Set(["ETHER", "MAX_ETHER", "PP_UP"]);

const STAT_NAME: Record<string, string> = { hp: "HP", attack: "Attack", defense: "Defense", speed: "Speed", special: "Special", accuracy: "accuracy" };

export function itemTemplate(id: string): ItemEffectSpec | null {
  if (HEAL_AMOUNT[id]) return { target: "party", steps: [{ act: "heal", amount: HEAL_AMOUNT[id] }] };
  if (id === "MAX_POTION") return { target: "party", steps: [{ act: "heal", full: true }] };
  if (id === "FULL_RESTORE") return { target: "party", steps: [{ act: "heal", full: true }, { act: "cure" }] };
  if (id in STATUS_HEAL) {
    const statuses = STATUS_HEAL[id];
    return { target: "party", steps: [statuses ? { act: "cure", statuses: [...statuses] } : { act: "cure" }] };
  }
  if (id === "REVIVE") return { target: "party", steps: [{ act: "revive", percent: 50 }] };
  if (id === "MAX_REVIVE") return { target: "party", steps: [{ act: "revive", percent: 100 }] };
  if (id === "ETHER") return { target: "party", steps: [{ act: "pp", amount: 10, all: false }] };
  if (id === "MAX_ETHER") return { target: "party", steps: [{ act: "pp", full: true, all: false }] };
  if (id === "ELIXER") return { target: "party", steps: [{ act: "pp", amount: 10, all: true }] };
  if (id === "MAX_ELIXER") return { target: "party", steps: [{ act: "pp", full: true, all: true }] };
  if (VITAMINS[id]) return { target: "party", where: "field", steps: [{ act: "statexp", stat: VITAMINS[id], amount: 2560, cap: 25600 }] };
  if (id === "RARE_CANDY") return { target: "party", where: "field", steps: [{ act: "level" }] };
  if (STONES.has(id)) return { target: "party", where: "field", steps: [{ act: "evolve" }] };
  if (X_ITEMS[id]) return { target: "none", where: "battle", steps: [{ act: "stage", stat: X_ITEMS[id], delta: 1 }] };
  if (id === "X_ACCURACY") return { target: "none", where: "battle", steps: [{ act: "xaccuracy" }] };
  if (id === "DIRE_HIT") return { target: "none", where: "battle", steps: [{ act: "focus" }] };
  if (id === "GUARD_SPEC") return { target: "none", where: "battle", steps: [{ act: "mist" }] };
  if (id === "POKE_DOLL") return { target: "none", where: "battle", steps: [{ act: "escape" }] };
  if (REPELS[id]) return { target: "none", where: "field", steps: [{ act: "repel", steps: REPELS[id] }] };
  if (VANILLA_BALLS[id]) return { target: "none", where: "battle", steps: [{ act: "ball" }] };
  return null;
}

export function describeItemEffect(spec: ItemEffectSpec, statuses: { id: string; label: string }[]): string {
  const parts = spec.steps.map((st) => {
    switch (st.act) {
      case "heal":
        return st.full ? "fully restores HP" : st.percent ? `restores ${st.percent}% of max HP` : `restores ${st.amount ?? 0} HP`;
      case "cure":
        return st.statuses?.length
          ? `cures ${st.statuses.map((s) => (statuses.find((x) => x.id === s)?.label ?? s).toLowerCase()).join(" / ")}`
          : "cures any status";
      case "revive":
        return `revives a fainted Pokémon with ${st.percent ?? 50}% HP`;
      case "pp":
        return `restores ${st.full ? "all" : (st.amount ?? 10)} PP of ${st.all === false ? "one move" : "every move"}`;
      case "statexp":
        return `+${st.amount ?? 2560} ${STAT_NAME[st.stat ?? ""] ?? st.stat} stat EXP (up to ${st.cap ?? 25600})`;
      case "level":
        return "raises the level by 1";
      case "evolve":
        return "evolves Pokémon that evolve with this item";
      case "stage":
        return `raises the active Pokémon's ${STAT_NAME[st.stat ?? ""] ?? st.stat} by ${st.delta ?? 1}`;
      case "focus":
        return "raises the critical-hit ratio (Focus Energy)";
      case "mist":
        return "protects from stat drops (Mist)";
      case "xaccuracy":
        return "moves never miss";
      case "escape":
        return "escapes from a wild battle";
      case "repel":
        return `keeps weak wild Pokémon away for ${st.steps ?? 100} steps`;
      case "ball":
        return "catches a wild Pokémon";
    }
    return st.act;
  });
  const where = spec.where === "battle" ? " Battle only." : spec.where === "field" ? " Outside battle only." : "";
  if (!parts.length) return "Does nothing yet: add a step." + where;
  const text = parts.join("; ");
  return text.charAt(0).toUpperCase() + text.slice(1) + "." + where;
}

const LABELS: Record<string, string> = { SLP: "Sleep", PSN: "Poison", PAR: "Paralysis", BRN: "Burn", FRZ: "Freeze" };
export const ITEM_STATUSES = Object.entries(LABELS).map(([id, label]) => ({ id, label }));

export function vanillaItemText(id: string, item: Record<string, unknown>): string {
  if (SPECIAL[id]) return SPECIAL[id];
  const machine = item.machine as { kind?: string; move?: string } | undefined;
  if (machine?.move) return `Teaches ${machine.move}${machine.kind === "HM" ? " (never used up)" : ""}.`;
  const t = itemTemplate(id);
  if (t) return describeItemEffect(t, ITEM_STATUSES);
  if (item.keyItem) return "Key item: story scripts check for it; no use from the bag.";
  return "No use from the bag (sell it, or scripts ask for it).";
}

// items the game uses for something else: why, or null for a real item
export function internalItem(id: string): string | null {
  if (/^FLOOR_/.test(id)) return "Elevator floor: the elevator menus list their floors as these fake items, and the name is the floor label shown.";
  if (id === "SURFBOARD") return "Used by the Surf field move behind the scenes; the player never holds it.";
  if (id === "ITEM_2C") return "Unused slot (?????): nothing in the game gives it.";
  if (id === "ITEM_32") return "Unused duplicate of PP UP: nothing in the game gives it.";
  return null;
}

export const isSpecialItem = (id: string, item: Record<string, unknown>): boolean => !!SPECIAL[id] || !!(item.machine as { move?: string } | undefined)?.move;
export const picksMove = (id: string): boolean => PICKS_MOVE.has(id);
