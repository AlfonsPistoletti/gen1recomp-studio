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

export function objectTrainerSection(record: EntityRecord, edit: (label: string, mutate: (r: Rec) => void) => void): HTMLElement | null {
  const s = store.adapter.trainers;
  const ot = s?.objectTrainer;
  if (!s || !ot) return null;
  const ctx = store.ctx;
  const t = record[ot.key] as Struct | undefined;
  const classes = Object.keys(store.table(s.registry)).filter((id) => ot.classIndex(ctx, id) !== undefined).sort();

  if (!t) {
    const make = h("button", {
      class: "btn small",
      title: "The person fights when it sees the player (or is talked to), like the game's own trainers",
      onclick: () => {
        const flag = ot.freeFlag(ctx);
        if (flag === null) return toast("No free event flag left for another trainer", "error");
        const cls = classes.includes("YOUNGSTER") ? "YOUNGSTER" : classes[0];
        const seen = newTextKey("SEEN");
        const win = newTextKey("WIN");
        store.group("Make a trainer", () => {
          store.setRecord(ot.textRegistry, seen, "Trainer text", "Let's battle!{DONE}");
          store.setRecord(ot.textRegistry, win, "Trainer text", "I lost…{DONE}");
          edit("Make a trainer", (r) => {
            r[ot.key] = { class: ot.classIndex(ctx, cls), member: 1, event: flag, seenText: seen, winText: win };
            r[ot.typeKey] = ot.typeValue;
            r[ot.sightKey] = 3;
          });
        });
        store.seal();
      },
    }, "Make this a trainer");
    return h("div", { class: "field-group npc-text" }, h("h4", {}, "Trainer"), h("div", { class: "row" }, make));
  }

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
  const after = ot.afterScripts(store.map!);
  const afterSel = selectInput(t.scriptKey ?? "", after.map((a) => a.key), (v) => edit("After the battle", (r) => {
    r[ot.key] = { ...(r[ot.key] as Struct), scriptKey: v || undefined };
    if (!v) delete (r[ot.key] as Struct).scriptKey;
    // talking to a beaten trainer runs the person's own script
    if (v) r.scriptKey = v;
    else delete r.scriptKey;
  }), "Nothing (the game's scripts can't be written here)");
  for (const o of afterSel.options) if (o.value) o.textContent = after.find((a) => a.key === o.value)?.label ?? o.value;

  return h(
    "div",
    { class: "field-group npc-text" },
    h("h4", {}, "Trainer"),
    h("div", { class: "row two" }, field("Class", clsSel), field("Trainer", memberSel, "Its team is edited in Trainers")),
    h("div", { class: "row two" },
      field("Sight", numberInput(Number(record[ot.sightKey] ?? 0), (v) => edit("Trainer sight", (r) => (r[ot.sightKey] = Math.max(0, Math.min(15, v)))), 0, 15), "Cells it sees ahead; 0: only when talked to"),
      field("Beaten flag", h("code", {}, String(t.event ?? "?")), "Set once it's beaten, so it fights only once"),
    ),
    t.seenText ? textEditor(t.seenText, { rows: 3, label: "When it sees the player", compact: true }) : null,
    t.winText ? textEditor(t.winText, { rows: 2, label: "When it loses", compact: true }) : null,
    field("Talked to after the battle", afterSel, "Says what another trainer here says after its battle (scripts are cart code)."),
    h(
      "div",
      { class: "row" },
      classId ? h("button", { class: "btn small", onclick: () => nav.openTrainer(classId, Number(t.member ?? 1)) }, "Open in Trainers →") : null,
      h("button", {
        class: "btn small ghost danger",
        onclick: () => store.group("Not a trainer", () => {
          // texts the studio made for it go too
          for (const k of [t.seenText, t.winText]) if (k && k.startsWith("STUDIO_TRAINER_") && store.baseTable(ot.textRegistry)[k] === undefined) store.setRecord(ot.textRegistry, k, "Remove trainer text", undefined);
          edit("Not a trainer", (r) => {
            delete r[ot.key];
            r[ot.typeKey] = 0;
          });
        }),
      }, "Not a trainer"),
    ),
  );
}
