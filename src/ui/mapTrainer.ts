// A map person that is a trainer through a record of its own (Gen 2:
// object.trainer = { class (the class's index), member (1-based trainer),
// event (its "beaten" flag), seenText, winText, scriptKey (talk after the
// battle) }); the game fights it with its standard trainer script, so a new
// trainer needs no script of its own. TrainerSpec.objectTrainer says where.

import { store } from "../core/store.ts";
import type { EntityRecord } from "../core/types.ts";
import { field, h, numberInput, selectInput, toast } from "./dom.ts";
import { nav } from "./nav.ts";
import { textEditor } from "./textField.ts";

type Rec = Record<string, unknown>;
type Struct = { class?: number; member?: number; event?: number; seenText?: string; winText?: string; scriptKey?: string };

// a new text key for this map's trainer texts (STUDIO_TRAINER_<n>_SEEN, ...)
function newTextKey(kind: string): string {
  const texts = store.table("text");
  let n = 1;
  while (texts[`STUDIO_TRAINER_${n}_${kind}`] !== undefined) n++;
  return `STUDIO_TRAINER_${n}_${kind}`;
}

type Edit = (label: string, mutate: (r: Rec) => void) => void;

// Makes the person a trainer (a free beaten flag, new seen/win texts). Run it
// inside the caller's undo group (the Role box's).
export function makeTrainer(edit: Edit): boolean {
  const s = store.adapter.trainers;
  const ot = s?.objectTrainer;
  if (!s || !ot) return false;
  const ctx = store.ctx;
  const flag = ot.freeFlag(ctx);
  if (flag === null) {
    toast("No free event flag left for another trainer", "error");
    return false;
  }
  const classes = Object.keys(store.table(s.registry)).filter((id) => ot.classIndex(ctx, id) !== undefined).sort();
  const cls = classes.includes("YOUNGSTER") ? "YOUNGSTER" : classes[0];
  const seen = newTextKey("SEEN");
  const win = newTextKey("WIN");
  store.setRecord(ot.textRegistry, seen, "Trainer text", "Let's battle!{DONE}");
  store.setRecord(ot.textRegistry, win, "Trainer text", "I lost…{DONE}");
  edit("Make a trainer", (r) => {
    r[ot.key] = { class: ot.classIndex(ctx, cls), member: 1, event: flag, seenText: seen, winText: win };
    r[ot.typeKey] = ot.typeValue;
    r[ot.sightKey] = 3;
  });
  return true;
}

// No longer a trainer: the record goes, and the texts the studio made for it
export function removeTrainer(record: EntityRecord, edit: Edit): void {
  const ot = store.adapter.trainers?.objectTrainer;
  const t = ot ? (record[ot.key] as Struct | undefined) : undefined;
  if (!ot || !t) return;
  for (const k of [t.seenText, t.winText]) if (k && k.startsWith("STUDIO_TRAINER_") && store.baseTable(ot.textRegistry)[k] === undefined) store.setRecord(ot.textRegistry, k, "Remove trainer text", undefined);
  edit("Not a trainer", (r) => {
    delete r[ot.key];
    r[ot.typeKey] = 0;
  });
}

// the trainer's fields (the Role box's Trainer panel)
export function objectTrainerSection(record: EntityRecord, edit: Edit): HTMLElement | null {
  const s = store.adapter.trainers;
  const ot = s?.objectTrainer;
  if (!s || !ot) return null;
  const ctx = store.ctx;
  const t = record[ot.key] as Struct | undefined;
  const classes = Object.keys(store.table(s.registry)).filter((id) => ot.classIndex(ctx, id) !== undefined).sort();
  if (!t) return null;

  const classId = ot.classOf(ctx, Number(t.class)) ?? "";
  const set = (label: string, mutate: (x: Struct) => void) => edit(label, (r) => {
    const next = { ...(r[ot.key] as Struct) };
    mutate(next);
    r[ot.key] = next;
  });
  const clsSel = selectInput(classId, classes, (v) => set("Trainer class", (x) => {
    x.class = ot.classIndex(ctx, v);
    x.member = 1;
  }));
  for (const o of clsSel.options) o.textContent = `${String((store.table(s.registry)[o.value] as Rec | undefined)?.name ?? o.value)} (${o.value})`;
  const teams = s.teams?.read((store.table(s.registry)[classId] ?? {}) as Rec) ?? [];
  const memberSel = selectInput(String(t.member ?? 1), teams.map((_, i) => String(i + 1)), (v) => set("Trainer", (x) => (x.member = Number(v))));
  for (const o of memberSel.options) {
    const i = Number(o.value) - 1;
    const name = s.teams?.name((store.table(s.registry)[classId] ?? {}) as Rec, i) ?? "";
    o.textContent = `${name || `#${o.value}`} · ${teams[i]?.map((m) => `${m.species} ${m.level}`).join(", ") ?? ""}`;
  }
  // the lines the trainers here say after their battles: the map as it is and
  // as the game has it (a key nobody uses any more stays offered)
  const base = store.base[store.map!.id];
  const after = [...ot.afterScripts(store.map!), ...(base ? ot.afterScripts(base) : [])].filter((a, i, all) => all.findIndex((b) => b.key === a.key) === i);
  // the words a script says (its writetext / jumptextfaceplayer text), shortened
  const scripts = (store.ctx.data.extra as { scripts?: Record<string, unknown> }).scripts ?? {};
  const wordsOf = (key: string) => {
    const rows = scripts[key];
    const r = Array.isArray(rows) ? (rows as Rec[]).find((x) => (x.op === "writetext" || x.op === "jumptextfaceplayer" || x.op === "jumptext") && typeof x.text === "string") : undefined;
    const text = r ? store.table("text")[String(r.text)] : undefined;
    if (typeof text !== "string") return "";
    const plain = text.replace(/\{(DONE|PROMPT)\}/g, "").replace(/[\n\v\f]+/g, " ").trim();
    return plain.length > 40 ? `${plain.slice(0, 39)}…` : plain;
  };
  const afterSel = selectInput(typeof t.scriptKey === "string" ? t.scriptKey : "", after.map((a) => a.key), (v) => edit("After the battle", (r) => {
    r[ot.key] = { ...(r[ot.key] as Struct), scriptKey: v || undefined };
    if (!v) delete (r[ot.key] as Struct).scriptKey;
    // talking to a beaten trainer runs the person's own script
    if (v) r.scriptKey = v;
    else delete r.scriptKey;
  }), "Nothing (the game's scripts can't be written here)");
  for (const o of afterSel.options) {
    if (!o.value) continue;
    const words = wordsOf(o.value);
    o.textContent = `${words ? `“${words}” · ` : ""}${after.find((a) => a.key === o.value)?.label ?? o.value}`;
  }

  return h(
    "div",
    { class: "npc-text" },
    h("div", { class: "row two" }, field("Class", clsSel), field("Trainer", memberSel, "Its team is edited in Trainers")),
    h("div", { class: "row two" },
      field("Sight", numberInput(Number(record[ot.sightKey] ?? 0), (v) => edit("Trainer sight", (r) => (r[ot.sightKey] = Math.max(0, Math.min(15, v)))), 0, 15), "Cells it sees ahead; 0: only when talked to"),
      field("Beaten flag", h("code", {}, String(t.event ?? "?")), "Set once it's beaten, so it fights only once"),
    ),
    t.seenText ? textEditor(t.seenText, { rows: 3, label: "When it sees the player", compact: true }) : null,
    t.winText ? textEditor(t.winText, { rows: 2, label: "When it loses", compact: true }) : null,
    // its own after-battle event (an inline list) is linked below the box instead
    Array.isArray(t.scriptKey) ? null : field("Talked to after the battle", afterSel, "Says what another trainer here says after its battle, or make its own words below."),
    classId ? h("div", { class: "row" }, h("button", { class: "btn small", onclick: () => nav.openTrainer(classId, Number(t.member ?? 1)) }, "Open in Trainers →")) : null,
  );
}
