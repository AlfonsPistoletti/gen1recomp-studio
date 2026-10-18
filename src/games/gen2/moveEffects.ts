// What Gold's own move effects do, for the effect editor: the ones a custom
// effect can restate start from their blocks ("Customize this effect").
// Restated from gen1recomp src/battle/gen2/Effects.lua STAT_CHANGES and
// Battle.lua STATUS_EFFECTS / SECONDARY_EFFECTS.

import type { EffectSpec } from "../types.ts";

const STAT_LABEL: Record<string, string> = { attack: "Attack", defense: "Defense", speed: "Speed", specialAttack: "Sp. Atk", specialDefense: "Sp. Def", accuracy: "accuracy", evasion: "evasion" };

const STAT_CHANGES: Record<string, [string, number, "user" | "target"]> = {
  EFFECT_ATTACK_UP: ["attack", 1, "user"], EFFECT_DEFENSE_UP: ["defense", 1, "user"], EFFECT_SP_ATK_UP: ["specialAttack", 1, "user"],
  EFFECT_EVASION_UP: ["evasion", 1, "user"], EFFECT_ATTACK_UP_2: ["attack", 2, "user"], EFFECT_DEFENSE_UP_2: ["defense", 2, "user"],
  EFFECT_SPEED_UP_2: ["speed", 2, "user"], EFFECT_SP_DEF_UP_2: ["specialDefense", 2, "user"],
  EFFECT_ATTACK_DOWN: ["attack", -1, "target"], EFFECT_DEFENSE_DOWN: ["defense", -1, "target"], EFFECT_SPEED_DOWN: ["speed", -1, "target"],
  EFFECT_ACCURACY_DOWN: ["accuracy", -1, "target"], EFFECT_EVASION_DOWN: ["evasion", -1, "target"], EFFECT_ATTACK_DOWN_2: ["attack", -2, "target"],
  EFFECT_DEFENSE_DOWN_2: ["defense", -2, "target"], EFFECT_SPEED_DOWN_2: ["speed", -2, "target"],
};
const STATUS: Record<string, string> = { EFFECT_SLEEP: "sleep", EFFECT_POISON: "poison", EFFECT_TOXIC: "toxic", EFFECT_PARALYZE: "paralyze", EFFECT_BURN: "burn", EFFECT_FREEZE: "freeze", EFFECT_CONFUSE: "confuse" };
const ON_HIT: Record<string, string> = { EFFECT_POISON_HIT: "poison", EFFECT_BURN_HIT: "burn", EFFECT_FREEZE_HIT: "freeze", EFFECT_PARALYZE_HIT: "paralyze", EFFECT_SLEEP_HIT: "sleep", EFFECT_CONFUSE_HIT: "confuse" };

export const GEN2_STATUSES = [
  { id: "sleep", label: "Sleep" }, { id: "poison", label: "Poison" }, { id: "toxic", label: "Bad poison" },
  { id: "paralyze", label: "Paralysis" }, { id: "burn", label: "Burn" }, { id: "freeze", label: "Freeze" },
];
export const GEN2_STATS = Object.keys(STAT_LABEL);

const statusLabel = (id: string) => (id === "confuse" ? "confusion" : GEN2_STATUSES.find((s) => s.id === id)?.label.toLowerCase() ?? id);

export function gen2EffectText(effect: string): string {
  const st = STAT_CHANGES[effect];
  if (st) return `${st[2] === "user" ? "Raises the user's" : "Lowers the target's"} ${STAT_LABEL[st[0]]} by ${Math.abs(st[1])}.`;
  if (STATUS[effect]) return `Inflicts ${statusLabel(STATUS[effect])} (a status move).`;
  if (ON_HIT[effect]) return `Damage, and a chance (the move's effect chance) of ${statusLabel(ON_HIT[effect])}.`;
  return "";
}

export function gen2EffectTemplate(effect: string): EffectSpec | null {
  const st = STAT_CHANGES[effect];
  // raising the user's own stat never misses (Effects.NO_CHECKHIT)
  if (st) return { kind: "status", ...(st[2] === "user" ? { canMiss: false } : {}), steps: [{ act: "stage", who: st[2], stat: st[0], delta: st[1] }] };
  const s = STATUS[effect];
  if (s) return { kind: "status", steps: [s === "confuse" ? { act: "confuse", who: "target" } : { act: "status", who: "target", status: s }] };
  const hit = ON_HIT[effect];
  if (hit) return { kind: "damaging", steps: [hit === "confuse" ? { act: "confuse", who: "target" } : { act: "status", who: "target", status: hit }] };
  return null;
}
