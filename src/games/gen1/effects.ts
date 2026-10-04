// What each vanilla Gen 1 move effect does (gen1recomp src/battle/MoveEffects.lua),
// and, where it is one of the block patterns, the same effect as blocks so
// the studio can start a custom effect from it. Chances are out of 256 as in
// the ROM (26 = 10%, 77 = 30%, 85 = 33%).

import type { EffectSpec, EffectStep } from "../types.ts";

const stage = (who: "user" | "target", stat: string, delta: number, chance?: number): EffectStep => ({ act: "stage", who, stat, delta, ...(chance ? { chance } : {}) });
const status = (s: string, chance?: number): EffectStep => ({ act: "status", who: "target", status: s, ...(chance ? { chance } : {}) });
const statusMove = (...steps: EffectStep[]): EffectSpec => ({ kind: "status", canMiss: true, steps });
const selfMove = (...steps: EffectStep[]): EffectSpec => ({ kind: "status", canMiss: false, steps });
const damaging = (extra: Partial<EffectSpec>, ...steps: EffectStep[]): EffectSpec => ({ kind: "damaging", steps, ...extra });

interface Info {
  text: string;
  spec?: EffectSpec;
}

const STAT_NAME: Record<string, string> = { attack: "Attack", defense: "Defense", speed: "Speed", special: "Special", accuracy: "accuracy", evasion: "evasion" };
const up = (stat: string, n: number): Info => ({ text: `Raises the user's ${STAT_NAME[stat]} by ${n}.`, spec: selfMove(stage("user", stat, n)) });
const down = (stat: string, n: number): Info => ({ text: `Lowers the target's ${STAT_NAME[stat]} by ${n}.`, spec: statusMove(stage("target", stat, -n)) });
const sideDown = (stat: string): Info => ({ text: `Damage; 33% chance to lower the target's ${STAT_NAME[stat]} by 1.`, spec: damaging({}, stage("target", stat, -1, 85)) });
const sideStatus = (s: string, label: string, chance: number): Info => ({
  text: `Damage; ${Math.round((chance / 256) * 100)}% chance to ${label} the target.`,
  spec: damaging({}, status(s, chance)),
});
const flinch = (chance: number): Info => ({ text: `Damage; ${Math.round((chance / 256) * 100)}% chance to make the target flinch.`, spec: damaging({}, { act: "flinch", chance }) });

export const GEN1_EFFECTS: Record<string, Info> = {
  NO_ADDITIONAL_EFFECT: { text: "Plain damage, nothing else.", spec: damaging({}) },
  ATTACK_UP1_EFFECT: up("attack", 1),
  ATTACK_UP2_EFFECT: up("attack", 2),
  DEFENSE_UP1_EFFECT: up("defense", 1),
  DEFENSE_UP2_EFFECT: up("defense", 2),
  SPEED_UP2_EFFECT: up("speed", 2),
  SPECIAL_UP1_EFFECT: up("special", 1),
  SPECIAL_UP2_EFFECT: up("special", 2),
  EVASION_UP1_EFFECT: up("evasion", 1),
  ATTACK_DOWN1_EFFECT: down("attack", 1),
  DEFENSE_DOWN1_EFFECT: down("defense", 1),
  DEFENSE_DOWN2_EFFECT: down("defense", 2),
  SPEED_DOWN1_EFFECT: down("speed", 1),
  ACCURACY_DOWN1_EFFECT: down("accuracy", 1),
  SLEEP_EFFECT: { text: "Puts the target to sleep.", spec: statusMove(status("SLP")) },
  POISON_EFFECT: { text: "Poisons the target (Toxic: badly).", spec: statusMove(status("PSN")) },
  PARALYZE_EFFECT: { text: "Paralyzes the target.", spec: statusMove(status("PAR")) },
  CONFUSION_EFFECT: { text: "Confuses the target.", spec: statusMove({ act: "confuse", who: "target" }) },
  HEAL_EFFECT: { text: "Restores half of the user's max HP (Rest: all HP, then sleeps).", spec: selfMove({ act: "heal", who: "user", percent: 50 }) },
  BURN_SIDE_EFFECT1: sideStatus("BRN", "burn", 26),
  BURN_SIDE_EFFECT2: sideStatus("BRN", "burn", 77),
  FREEZE_SIDE_EFFECT1: sideStatus("FRZ", "freeze", 26),
  PARALYZE_SIDE_EFFECT1: sideStatus("PAR", "paralyze", 26),
  PARALYZE_SIDE_EFFECT2: sideStatus("PAR", "paralyze", 77),
  POISON_SIDE_EFFECT1: sideStatus("PSN", "poison", 52),
  POISON_SIDE_EFFECT2: sideStatus("PSN", "poison", 103),
  FLINCH_SIDE_EFFECT1: flinch(26),
  FLINCH_SIDE_EFFECT2: flinch(77),
  ATTACK_DOWN_SIDE_EFFECT: sideDown("attack"),
  DEFENSE_DOWN_SIDE_EFFECT: sideDown("defense"),
  SPEED_DOWN_SIDE_EFFECT: sideDown("speed"),
  SPECIAL_DOWN_SIDE_EFFECT: sideDown("special"),
  CONFUSION_SIDE_EFFECT: { text: "Damage; 10% chance to confuse the target.", spec: damaging({}, { act: "confuse", who: "target", chance: 25 }) },
  TWO_TO_FIVE_ATTACKS_EFFECT: { text: "Hits 2 to 5 times.", spec: damaging({ hits: "2-5" }) },
  ATTACK_TWICE_EFFECT: { text: "Hits twice.", spec: damaging({ hits: 2 }) },
  TWINEEDLE_EFFECT: { text: "Hits twice; 20% chance to poison.", spec: damaging({ hits: 2 }, status("PSN", 52)) },
  RECOIL_EFFECT: { text: "The user takes 1/4 of the damage dealt as recoil.", spec: damaging({ recoil: 25 }) },
  DRAIN_HP_EFFECT: { text: "The user recovers half of the damage dealt.", spec: damaging({ drain: 50 }) },
  SWIFT_EFFECT: { text: "Never misses.", spec: damaging({ neverMiss: true }) },
  SPECIAL_DAMAGE_EFFECT: { text: "Fixed damage instead of the damage formula (Sonicboom 20, Dragon Rage 40, Seismic Toss/Night Shade = the user's level, Psywave random)." },
  SUPER_FANG_EFFECT: { text: "Halves the target's HP." },
  OHKO_EFFECT: { text: "Knocks out in one hit; fails against a faster target." },
  DREAM_EATER_EFFECT: { text: "Only works on a sleeping target; the user recovers half of the damage." },
  CHARGE_EFFECT: { text: "Charges on the first turn, attacks on the second." },
  FLY_EFFECT: { text: "Flies or digs up on the first turn (can't be hit), attacks on the second." },
  TRAPPING_EFFECT: { text: "Traps the target for 2 to 5 turns, hitting each turn." },
  THRASH_PETAL_DANCE_EFFECT: { text: "Attacks for 2 to 3 turns, then the user becomes confused." },
  JUMP_KICK_EFFECT: { text: "The user takes 1 damage if it misses." },
  EXPLODE_EFFECT: { text: "The user faints; the target's Defense is halved for the hit." },
  HYPER_BEAM_EFFECT: { text: "The user must recharge next turn (not after a knockout)." },
  PAY_DAY_EFFECT: { text: "Scatters coins the player picks up after battle." },
  RAGE_EFFECT: { text: "Locks the user into Rage; its Attack rises when hit." },
  BIDE_EFFECT: { text: "Waits 2 to 3 turns, then deals twice the damage taken." },
  SWITCH_AND_TELEPORT_EFFECT: { text: "Ends a wild battle (Roar, Whirlwind, Teleport)." },
  METRONOME_EFFECT: { text: "Uses a random move." },
  MIRROR_MOVE_EFFECT: { text: "Uses the target's last move." },
  MIMIC_EFFECT: { text: "Copies one of the target's moves for the battle." },
  LEECH_SEED_EFFECT: { text: "Seeds the target: it loses HP each turn and the user gains it." },
  LIGHT_SCREEN_EFFECT: { text: "Halves special damage the user takes." },
  REFLECT_EFFECT: { text: "Halves physical damage the user takes." },
  MIST_EFFECT: { text: "Protects the user from stat drops." },
  FOCUS_ENERGY_EFFECT: { text: "Meant to raise the critical-hit ratio (Gen 1 bug: lowers it)." },
  HAZE_EFFECT: { text: "Resets all stat changes and cures statuses." },
  SUBSTITUTE_EFFECT: { text: "Makes a substitute with 1/4 of the user's max HP." },
  CONVERSION_EFFECT: { text: "Changes the user's types to the target's." },
  TRANSFORM_EFFECT: { text: "Turns the user into a copy of the target." },
  DISABLE_EFFECT: { text: "Disables one of the target's moves for a few turns." },
  SPLASH_EFFECT: { text: "Does nothing." },
};
