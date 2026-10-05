// Trainers built from events (the documented route, gen1recomp wiki recipe
// R51): mods can't write trainer headers, so a trainer placed by a mod has no
// line of sight and no battle texts of its own. The studio builds them from
// map events instead:
// - a talk event: not beaten yet -> before-battle text, battle, beaten flag
//   when won; beaten -> after-battle text;
// - one step event per cell of its line of sight: "!" over the trainer, it
//   walks up to the player, then the same before-battle text and battle.
// The settings live on the talk event (`trainer`), so the events can be
// rebuilt whenever the trainer moves, turns or changes team.

import { compile, type Block } from "../core/eventBlocks.ts";
import { store } from "../core/store.ts";
import type { EntityRecord, MapDef } from "../core/types.ts";
import type { EventRow } from "../games/types.ts";
import { eventId, studioEvent, studioEventsOf, type StudioEvent } from "./eventEditor.ts";
import { idBase, newTextId } from "./mapText.ts";

export interface TrainerSetup {
  range: number; // cells in front of it, 0 = only when talked to
  flag: string; // set once beaten
  before: string; // text key
  after: string; // text key
  won?: string; // text key: its line inside the battle when it loses
  // encounter music: missing = the game's choice for the class, "" = none
  music?: string;
  // what the events were built for (rebuilt when these change)
  class: string;
  team: number;
  index: number;
  x: number;
  y: number;
  facing: string;
}

export interface TrainerEvent extends StudioEvent {
  trainer?: TrainerSetup;
}

const DIRS: Record<string, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

// where a standing NPC looks (Gen 1 keeps it in `range` for STAY NPCs);
// null for one that walks around
export function facingOf(e: EntityRecord): string | null {
  if (e.movement !== "STAY") return null;
  const r = String(e.range ?? "DOWN").toLowerCase();
  return r in DIRS ? r : "down";
}

const reg = () => store.adapter.events!.registry;

export function trainerEventOf(map: MapDef, e: EntityRecord): TrainerEvent | undefined {
  return typeof e.text === "string" ? (studioEvent(eventId(map.id, "talk", e.text)) as TrainerEvent | undefined) : undefined;
}

const stepPrefix = (map: MapDef, index: number) => `${map.id}:step:trainer${index}_`;

// the cells it sees, nearest first, inside the map
export function sightCells(map: MapDef, x: number, y: number, facing: string, range: number): { x: number; y: number; k: number }[] {
  const [dx, dy] = DIRS[facing] ?? DIRS.down;
  const out: { x: number; y: number; k: number }[] = [];
  for (let k = 1; k <= range; k++) {
    const cx = x + dx * k;
    const cy = y + dy * k;
    if (cx < 0 || cy < 0 || cx >= map.width * 2 || cy >= map.height * 2) break;
    out.push({ x: cx, y: cy, k });
  }
  return out;
}

function verbs() {
  const s = store.adapter.events!;
  return { checks: new Set(s.commands.filter((c) => c.condition).map((c) => c.verb)), choiceVerb: s.choiceVerb };
}

// the song that starts when the trainer engages
export function musicOf(t: TrainerSetup): string | null {
  if (t.music !== undefined) return t.music || null;
  return store.adapter.trainers?.meetTheme?.(t.class) ?? null;
}

function sting(t: TrainerSetup): Block[] {
  const song = musicOf(t);
  return song ? [{ t: "cmd", row: ["play_music", song] }] : [];
}

function fight(t: TrainerSetup): Block[] {
  return [
    { t: "cmd", row: ["show_text", t.before] },
    // its own line inside the battle when it loses (PrintEndBattleText)
    ...(t.won ? [{ t: "cmd", row: ["save_end_battle_text", t.won] } as Block] : []),
    { t: "cmd", row: ["start_battle", "trainer", t.class, t.team] },
    { t: "if", cond: ["check_battle_result", "win"], not: false, then: [{ t: "cmd", row: ["set_flag", t.flag] }], else: null },
  ];
}

export function talkRows(t: TrainerSetup): EventRow[] {
  return compile([
    {
      t: "if",
      cond: ["check_flag", t.flag],
      not: true,
      then: [{ t: "cmd", row: ["face_player"] }, ...sting(t), ...fight(t)],
      else: [{ t: "cmd", row: ["face_player"] }, { t: "cmd", row: ["show_text", t.after] }],
    },
  ], verbs());
}

export function sightRows(t: TrainerSetup, k: number): EventRow[] {
  // the sting starts with the "!", ahead of the walk-up (trainer_sight.asm:224)
  const approach: Block[] = [...sting(t), { t: "cmd", row: ["emote", t.index, "shock"] }];
  if (k > 1) approach.push({ t: "cmd", row: ["move_npc", t.index, t.facing, k - 1] });
  return compile([{ t: "if", cond: ["check_flag", t.flag], not: true, then: [...approach, ...fight(t)], else: null }], verbs());
}

// the setup the NPC's current state asks for, keeping the texts/flag/range
export function currentSetup(map: MapDef, e: EntityRecord, prev?: TrainerSetup): TrainerSetup | null {
  const cls = typeof e.trainerClass === "string" ? e.trainerClass : null;
  if (!cls || typeof e.index !== "number") return null;
  const facing = facingOf(e);
  const mod = (store.project.mod ?? "MOD").toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const label = typeof map.label === "string" ? map.label : map.id;
  return {
    range: facing ? (prev?.range ?? 3) : 0,
    flag: prev?.flag ?? `${mod}_BEAT_${map.id}_${e.index}`,
    before: prev?.before ?? `_${label}Trainer${e.index}BattleText`,
    after: prev?.after ?? `_${label}Trainer${e.index}AfterText`,
    won: prev?.won ?? `_${label}Trainer${e.index}EndBattleText`,
    ...(prev?.music !== undefined ? { music: prev.music } : {}),
    class: cls,
    team: Number(e.trainerParty ?? 1),
    index: e.index,
    x: e.x,
    y: e.y,
    facing: facing ?? "down",
  };
}

export function isStale(map: MapDef, e: EntityRecord, t: TrainerSetup): boolean {
  const now = currentSetup(map, e, t);
  return !now || (["class", "team", "index", "x", "y", "facing", "range"] as const).some((k) => now[k] !== t[k]);
}

// Writes (or rewrites) the trainer's talk and line-of-sight events. Call
// inside a store.group. `setText` points the NPC at a text id when it has none.
export function buildTrainer(map: MapDef, e: EntityRecord, index: number, setup: TrainerSetup, setText: (id: string) => void): void {
  let textId = typeof e.text === "string" && /^TEXT_[A-Z0-9_]+$/.test(e.text) && e.text !== "TEXT_" ? e.text : "";
  if (!textId) {
    textId = newTextId(map, typeof map.label === "string" ? map.label : map.id, idBase(map, e, "npc", index));
    setText(textId);
  }
  const text = store.table("text");
  if (text[setup.before] === undefined) store.setRecord("text", setup.before, "Trainer text", "Hey! You there!\nLet's battle!{DONE}");
  if (text[setup.after] === undefined) store.setRecord("text", setup.after, "Trainer text", "I need to train\nmore...{DONE}");
  if (setup.won && text[setup.won] === undefined) store.setRecord("text", setup.won, "Trainer text", "Oh no!\nI lost!{PROMPT}");
  const talk: TrainerEvent = { rows: talkRows(setup), trainer: setup };
  store.setRecord(reg(), eventId(map.id, "talk", textId), "Trainer events", talk);
  // line of sight: drop the old cells, write the new ones
  const prefix = stepPrefix(map, setup.index);
  for (const id of studioEventsOf(map.id)) if (id.startsWith(prefix)) store.setRecord(reg(), id, "Trainer events", undefined);
  for (const c of sightCells(map, setup.x, setup.y, setup.facing, setup.range)) {
    store.setRecord(reg(), `${prefix}${c.k}`, "Trainer events", { x: c.x, y: c.y, rows: sightRows(setup, c.k) });
  }
}

// Removes the trainer's events (call inside a store.group).
export function removeTrainer(map: MapDef, e: EntityRecord): void {
  const t = trainerEventOf(map, e);
  if (typeof e.text === "string" && t) store.setRecord(reg(), eventId(map.id, "talk", e.text), "Remove trainer events", undefined);
  if (typeof e.index === "number") {
    const prefix = stepPrefix(map, e.index);
    for (const id of studioEventsOf(map.id)) if (id.startsWith(prefix)) store.setRecord(reg(), id, "Remove trainer events", undefined);
  }
}
