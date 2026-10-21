// The Role box of a map person or sign in the Maps inspector, the same for
// every generation: what it does (says a text, runs an event, battles, is an
// item ball, a shop clerk, a nurse …) and that role's own fields. Each
// generation supplies its roles: Gen 1 in mapTown.ts (text pointer flags,
// prize counters, studio events), Gen 2 in roles2.ts (inline scripts and
// object fields).

import type { EntityRecord, MapDef } from "../core/types.ts";
import { selectInput } from "./dom.ts";

export interface RoleCtx {
  map: MapDef;
  entity: EntityRecord;
  kind: string; // the layer kind: "npc" | "sign"
  index: number; // place in its layer's list
  layer: string; // the layer's key
  setTextId(id: string): void;
  editEntity(label: string, mutate: (e: EntityRecord) => void): void;
}

export interface RoleParts {
  // instead of the whole box (Gen 1: the map has no label yet)
  blocked?: HTMLElement;
  // instead of the picker, with the role's fields still shown (a game prize counter)
  note?: HTMLElement;
  current: string;
  options: string[];
  set(next: string): void;
  panels: HTMLElement[];
}

export type RoleSet = (c: RoleCtx) => RoleParts | null;

// what each role is called, the same wherever it means the same
export const ROLE_LABEL: Record<string, string> = {
  "": "Normal (says its text)",
  event: "Event (runs commands)",
  trainer: "Trainer (battles)",
  item: "Item ball (picked up)",
  mart: "Shop clerk",
  nurse: "Nurse (heals)",
  pc: "PC",
  prizes: "Prize counter",
  hidden: "Hidden item (found once)",
  std: "Standard object (bookshelf, TV …)",
  game: "The game's script",
  fruit: "Fruit tree (gives fruit daily)",
  none: "Nothing (doesn't react)",
};

// the role picker and the role's panels (the inspector's "What it does" card)
export function roleBox(roles: RoleSet, c: RoleCtx): HTMLElement[] | null {
  const p = roles(c);
  if (!p) return null;
  if (p.blocked) return [p.blocked];
  let head: HTMLElement;
  if (p.note) head = p.note;
  else {
    head = selectInput(p.current, p.options, (v) => p.set(v));
    for (const o of (head as HTMLSelectElement).options) o.textContent = ROLE_LABEL[o.value] ?? o.value;
  }
  return [head, ...p.panels];
}
