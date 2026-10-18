// The Role box of a map person or sign in the Maps inspector, the same for
// every generation: what it does (says a text, runs an event, battles, is an
// item ball, a shop clerk, a nurse …) and that role's own fields. Each
// generation supplies its roles: Gen 1 in mapTown.ts (text pointer flags,
// prize counters, studio events), Gen 2 in roles2.ts (inline scripts and
// object fields).

import type { EntityRecord, MapDef } from "../core/types.ts";
import { h, selectInput } from "./dom.ts";

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
  none: "Nothing (doesn't react)",
};

export function roleBox(roles: RoleSet, c: RoleCtx): HTMLElement | null {
  const p = roles(c);
  if (!p) return null;
  const wrap = h("div", { class: "field-group" }, h("h4", {}, "Role"));
  if (p.blocked) {
    wrap.append(p.blocked);
    return wrap;
  }
  if (p.note) wrap.append(p.note);
  else {
    const sel = selectInput(p.current, p.options, (v) => p.set(v));
    for (const o of sel.options) o.textContent = ROLE_LABEL[o.value] ?? o.value;
    wrap.append(sel);
  }
  wrap.append(...p.panels);
  return wrap;
}
