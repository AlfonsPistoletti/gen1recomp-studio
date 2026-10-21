// Gold/Silver/Crystal roles for the shared Role box (roles.ts). What a person
// or sign does is its script (an inline row list: ISSUES #4, src/core/
// inlineEvents.ts) or a field of its record:
//   ""       says a text: [jumptextfaceplayer text] (signs: [jumptext text])
//   event    any other inline list (the Events workspace edits it)
//   nurse    [jumpstd PokecenterNurseScript] (the game's std script, by key)
//   mart     faceplayer, opentext, pokemart <one of the game's marts>, closetext
//   std      a sign running a std script (bookshelf, TV, trash can …)
//   trainer  object.trainer (mapTrainer.ts)
//   item     object type 1 with itemball = { item, quantity }, eventFlag = taken
//   hidden   sign kind 7 with hiddenItem = { event, item }
//   game     the game's own script key (kept as it was) when it does more
// A person still on a game key gets the role of that key's rows (the fisher's
// [jumptextfaceplayer text] is Normal), keeping the key: nothing is copied.
// There is no PC role: the engine opens a Pokémon Center's PC by tileset.

import { newEventText, syncEventTexts } from "../core/inlineEvents.ts";
import { store } from "../core/store.ts";
import type { EntityRecord, MapDef } from "../core/types.ts";
import { comboInput, field, h, numberInput, selectInput, toast } from "./dom.ts";
import { createEvent, eventId, eventOutline } from "./eventEditor.ts";
import { makeTrainer, objectTrainerSection, removeTrainer } from "./mapTrainer.ts";
import { nav } from "./nav.ts";
import type { RoleCtx, RoleSet } from "./roles.ts";
import { textEditor } from "./textField.ts";
import { pickText } from "./textPick.ts";
import { contactName } from "./globalWorkspace.ts";

type Row = Record<string, unknown> & { op: string };
type Rec = Record<string, unknown>;

const OBJECTTYPE_SCRIPT = 0;
const OBJECTTYPE_ITEMBALL = 1;
const BGEVENT_READ = 0;
const BGEVENT_ITEM = 7;
const ALWAYS = 0xffff; // eventFlag of a person who is always there

// std scripts a sign can run (constants.stdScriptOrder names)
const SIGN_STD = ["PictureBookshelfScript", "MagazineBookshelfScript", "DifficultBookshelfScript", "TVScript", "WindowScript", "TownMapScript", "Radio1Script", "Radio2Script", "TrashCanScript", "IncenseBurnerScript", "MerchandiseShelfScript", "PokecenterSignScript", "MartSignScript", "HomepageScript"];
const stdLabel = (std: string) => std.replace(/Script$/, "").replace(/([a-z])([A-Z0-9])/g, "$1 $2");

const extra = () => store.ctx.data.extra as { stdScripts?: Record<string, string>; marts?: string[][]; scripts?: Record<string, unknown> };
const items = () => store.table("items") as Record<string, { index?: number; name?: string }>;
const itemNumber = (id: string) => items()[id]?.index ?? 0;
const itemId = (n: unknown) => Object.entries(items()).find(([, r]) => r.index === n)?.[0] ?? "";
const freeFlag = () => store.adapter.trainers?.objectTrainer?.freeFlag(store.ctx) ?? null;

const rowsOf = (e: EntityRecord) => (Array.isArray(e.scriptKey) ? (e.scriptKey as Row[]) : null);
// a game key's own rows (top level)
const keyRows = (key: unknown) => {
  const rows = typeof key === "string" ? extra().scripts?.[key] : undefined;
  return Array.isArray(rows) ? (rows as Row[]) : null;
};
// what the entity runs: its inline rows, else its game script's
const scriptOf = (e: EntityRecord) => rowsOf(e) ?? keyRows(e.scriptKey);

// the role a script's rows play ("event": none of the simple ones)
function rowsRole(rows: Row[]): string {
  if (rows.length === 1 && (rows[0].op === "jumptextfaceplayer" || rows[0].op === "jumptext")) return "";
  if (rows.length === 1 && rows[0].op === "jumpstd") return rows[0].std === "PokecenterNurseScript" ? "nurse" : "std";
  if (rows.length === 1 && rows[0].op === "fruittree") return "fruit";
  if (rows.some((r) => r.op === "pokemart") && rows.every((r) => ["faceplayer", "opentext", "pokemart", "closetext", "end"].includes(r.op))) return "mart";
  return "event";
}

// the role of a game script key ("game": it does more than a simple role)
function keyRole(key: string): string {
  const rows = keyRows(key);
  const role = rows ? rowsRole(rows) : "event";
  return role === "event" ? "game" : role;
}

function roleOf(c: RoleCtx): string {
  const e = c.entity;
  if (c.kind === "npc" && e.trainer && typeof e.trainer === "object") return "trainer";
  if (c.kind === "npc" && e.itemball) return "item";
  if (c.kind === "sign" && e.hiddenItem) return "hidden";
  const rows = rowsOf(e);
  if (rows) return rowsRole(rows);
  return typeof e.scriptKey === "string" ? keyRole(e.scriptKey) : "none";
}

// the game's version of this entity (people by their index, signs by place)
function baseOf(c: RoleCtx): EntityRecord | undefined {
  const base = store.base[c.map.id];
  const list = base ? store.entities(base, c.layer) : [];
  return c.kind === "npc" ? list.find((x) => x.index === c.entity.index) : list[c.index];
}

function gameScript(c: RoleCtx): string | undefined {
  const e = baseOf(c);
  return typeof e?.scriptKey === "string" ? e.scriptKey : undefined;
}

// leaving the item ball role: the person's own look back
const personSprite = (c: RoleCtx) => {
  const s = baseOf(c)?.sprite;
  return typeof s === "string" && s !== "SPRITE_POKE_BALL" ? s : "SPRITE_YOUNGSTER";
};

const stdRow = (std: string): Row => ({ op: "jumpstd", std, script: extra().stdScripts?.[std] ?? "" });

// the first text a script shows, kept when switching between text roles
function textIn(e: EntityRecord): string | null {
  const r = scriptOf(e)?.find((x) => typeof x.text === "string");
  return r ? String(r.text) : null;
}

function setRole(c: RoleCtx, from: string, next: string): void {
  if (next === from) return;
  if (next === "std" && !extra().stdScripts?.PictureBookshelfScript) return void toast("The game's standard scripts were not found in this dataset", "error");
  if ((next === "item" || next === "hidden") && freeFlag() === null) return void toast("No free event flag left", "error");
  store.group(`Role: ${next || "text"}`, () => {
    const keep = textIn(c.entity);
    if (from === "trainer") removeTrainer(c.entity, c.editEntity);
    // a trainer keeps its script: talking to it once it's beaten runs that
    if (next !== "trainer") c.editEntity(`Role: ${next || "text"}`, (e) => {
      // leave the old role
      if (from === "item") {
        delete e.itemball;
        e.type = OBJECTTYPE_SCRIPT;
        e.eventFlag = ALWAYS;
        e.sprite = personSprite(c);
      }
      if (from === "hidden") {
        delete e.hiddenItem;
        e.kind = BGEVENT_READ;
      }
      delete e.scriptKey;
      // take the new one
      const npc = c.kind === "npc";
      if (next === "") e.scriptKey = [{ op: npc ? "jumptextfaceplayer" : "jumptext", text: keep ?? newEventText() }];
      if (next === "event") e.scriptKey = [...(npc ? [{ op: "faceplayer" }] : []), { op: "opentext" }, { op: "writetext", text: keep ?? newEventText() }, { op: "waitbutton" }, { op: "closetext" }, { op: "end" }];
      if (next === "nurse") e.scriptKey = [stdRow("PokecenterNurseScript")];
      if (next === "std") e.scriptKey = [stdRow("PictureBookshelfScript")];
      if (next === "mart") e.scriptKey = [{ op: "faceplayer" }, { op: "opentext" }, { op: "pokemart", args: [0, 0, 0] }, { op: "closetext" }, { op: "end" }];
      if (next === "fruit") e.scriptKey = [{ op: "fruittree", args: [1] }];
      if (next === "game") e.scriptKey = gameScript(c);
      if (next === "item") {
        e.type = OBJECTTYPE_ITEMBALL;
        e.itemball = { item: itemNumber("POTION"), quantity: 1 };
        e.eventFlag = freeFlag();
        e.sprite = "SPRITE_POKE_BALL";
      }
      if (next === "hidden") {
        e.kind = BGEVENT_ITEM;
        e.hiddenItem = { event: freeFlag(), item: itemNumber("POTION") };
      }
      // the role the game's own script plays: its key again, not a copy
      const game = gameScript(c);
      if (game && keyRole(game) === next && ["", "nurse", "std", "mart", "fruit"].includes(next)) e.scriptKey = game;
      if (e.scriptKey === undefined) delete e.scriptKey;
    });
    else if (from === "item") c.editEntity("Role: trainer", (e) => {
      delete e.itemball;
      e.eventFlag = ALWAYS;
      e.sprite = personSprite(c);
    });
    if (next === "trainer") makeTrainer(c.editEntity);
    syncEventTexts();
  });
  store.seal();
}

// the key of a person's / sign's talk event (inlineEvents ids)
const talkKey = (c: RoleCtx) => (c.kind === "npc" ? `obj${String(c.entity.index)}` : `sign${c.index}`);
const outline = (id: string) => {
  const el = eventOutline(id);
  return el ? [el] : [];
};

function panels(c: RoleCtx, role: string): HTMLElement[] {
  const e = c.entity;
  const edit = (label: string, mutate: (x: EntityRecord) => void) => {
    c.editEntity(label, mutate);
    store.seal();
  };
  switch (role) {
    case "": {
      const key = textIn(e);
      const other = h("button", {
        class: "btn small ghost", title: "Show a text the game (or your mod) already has instead",
        onclick: () => void pickText().then((k) => k && edit("Use text", (x) => (x.scriptKey = [{ op: c.kind === "sign" ? "jumptext" : "jumptextfaceplayer", text: k }]))),
      }, "Use another text…");
      return [...(key && typeof store.table("text")[key] === "string" ? [textEditor(key, { rows: 3, compact: true, label: c.kind === "sign" ? "It reads" : "It says" })] : []), h("div", { class: "row" }, other)];
    }
    case "event": {
      const id = eventId(c.map.id, "talk", talkKey(c));
      return [h("div", { class: "row" }, h("span", { class: "hint" }, "Runs its own commands."), h("button", { class: "btn small primary-ish", onclick: () => nav.openEvent(id) }, "Edit event →")), ...outline(id)];
    }
    case "trainer": {
      const box = objectTrainerSection(e, (label, mutate) => c.editEntity(label, mutate as (x: EntityRecord) => void));
      const t = e.trainer as { scriptKey?: unknown } | undefined;
      const after = eventId(c.map.id, "after", `obj${String(e.index)}`);
      const own = Array.isArray(t?.scriptKey);
      // what it says when talked to once beaten: one line (the studio's
      // [endifjustbattled, jumptextfaceplayer t] or the game's endifjustbattled,
      // opentext, writetext t, waitbutton, closetext, end), or an event.
      // endifjustbattled ends the script right after the battle (Vm.lua)
      const rows = ((own ? t!.scriptKey : keyRows(t?.scriptKey)) ?? []) as Row[];
      const ops = rows.map((r) => r.op).join(",");
      // (an earlier studio wrote [jumptextfaceplayer t] alone: said right after the battle too)
      const early = own && ops === "jumptextfaceplayer" ? rows[0].text : null;
      const line = ops === "endifjustbattled,jumptextfaceplayer" ? rows[1].text
        : ops === "endifjustbattled,opentext,writetext,waitbutton,closetext,end" ? rows[2].text : early;
      // a beaten trainer talked to runs the person's script too (inlineEvents writeInline "after")
      const setAfter = (label: string, next: Row[]) => {
        edit(label, (x) => {
          x.trainer = { ...(x.trainer as Rec), scriptKey: next };
          x.scriptKey = structuredClone(next);
        });
        syncEventTexts();
      };
      const words = (text: string): Row[] => [{ op: "endifjustbattled" }, { op: "jumptextfaceplayer", text }];
      // a phone number it offers (askforphonenumber n): the contact, opened in Global
      const ph = store.adapter.globals?.phone;
      const number = ph ? [...ph.givers(store.ctx)].find(([, list]) => list.some((g) => g.map === c.map.id && g.index === c.index))?.[0] : undefined;
      const contact = number !== undefined ? Object.entries(store.table(ph!.registry)).find(([, r]) => (r as { index?: number }).index === number)?.[0] : undefined;
      return [
        ...(box ? [box] : []),
        ...(contact ? [h("div", { class: "row" },
          h("span", { class: "hint" }, `Gives its phone number: ${contactName(contact)}`),
          h("button", { class: "btn small ghost", onclick: () => nav.openGlobal("phone") }, "Open contacts →"))] : []),
        typeof line === "string" && typeof store.table("text")[line] === "string"
          ? textEditor(line, { rows: 3, compact: true, label: "After its battle it says", hideEnding: true })
          : h("p", { class: "hint" }, own ? "When talked to after its battle it runs its own commands." : "When talked to after its battle it says what the trainer it borrows from says."),
        typeof early === "string"
          ? h("div", { class: "row" },
              h("span", { class: "hint warn" }, "It also says this right after the battle."),
              h("button", { class: "btn small", onclick: () => setAfter("After-battle words: only when talked to", words(early)) }, "Only when talked to again"))
          : h("p", { class: "hint" }, "Said when player talks to it again after battle"),
        h("div", { class: "row wrap" },
          own && line ? null : h("button", { class: "btn small primary-ish", title: "Its own line, said when talked to after the battle", onclick: () => setAfter("After-battle words", words(newEventText())) }, "Own words"),
          h("button", { class: "btn small ghost", title: "Say a text the game (or your mod) already has", onclick: () => void pickText().then((k) => k && setAfter("After-battle text", words(k))) }, "Use a text…"),
          own && !line
            ? h("button", { class: "btn small", onclick: () => nav.openEvent(after) }, "Edit event →")
            : h("button", { class: "btn small ghost", title: "More than words: items, flags, …", onclick: () => { const id = createEvent(c.map.id, "after", `obj${String(e.index)}`); if (id) nav.openEvent(id); } }, "Make an event")),
        ...(own && !line ? outline(after) : []),
      ];
    }
    case "item": {
      const ball = e.itemball as { item?: number; quantity?: number };
      return [
        h("div", { class: "row two" },
          field("Item", comboInput(itemId(ball.item), "dl-items", Object.keys(items()).sort(), (v) => items()[v] && edit("Item ball item", (x) => (x.itemball = { ...(x.itemball as Rec), item: itemNumber(v) })))),
          field("Count", numberInput(Number(ball.quantity ?? 1), (v) => edit("Item ball count", (x) => (x.itemball = { ...(x.itemball as Rec), quantity: Math.max(1, Math.min(99, v)) })), 1, 99))),
        h("p", { class: "hint" }, `Taken flag ${String(e.eventFlag)}: set when it's picked up, so it's gone for good.`),
      ];
    }
    case "hidden": {
      const hi = e.hiddenItem as { item?: number; event?: number };
      return [
        field("Item", comboInput(itemId(hi.item), "dl-items", Object.keys(items()).sort(), (v) => items()[v] && edit("Hidden item", (x) => (x.hiddenItem = { ...(x.hiddenItem as Rec), item: itemNumber(v) })))),
        h("p", { class: "hint" }, `Found by checking the cell (or with the Itemfinder); flag ${String(hi.event)} remembers it was found.`),
      ];
    }
    case "nurse":
      return [h("p", { class: "hint" }, "Heals the party with the game's nurse script.")];
    case "std": {
      const cur = String(scriptOf(e)?.[0]?.std ?? "");
      const sel = selectInput(cur, SIGN_STD.filter((s) => extra().stdScripts?.[s]), (v) => edit("Standard object", (x) => (x.scriptKey = [stdRow(v)])));
      for (const o of sel.options) o.textContent = stdLabel(o.value);
      return [field("What it is", sel, "The game's own script for it")];
    }
    case "mart": {
      const lists = extra().marts ?? [];
      const row = scriptOf(e)?.find((r) => r.op === "pokemart");
      const args = (row?.args as number[] | undefined) ?? [0, 0, 0];
      const id = Number(args[1] ?? 0) + Number(args[2] ?? 0) * 256;
      const sel = selectInput(String(id), lists.map((_l, i) => String(i)), (v) => edit("Shop", (x) => {
        x.scriptKey = (scriptOf(x) ?? []).map((r) => (r.op === "pokemart" ? { ...r, args: [0, Number(v) % 256, Math.floor(Number(v) / 256)] } : r));
      }));
      for (const o of sel.options) o.textContent = `Shop ${o.value}: ${(lists[Number(o.value)] ?? []).slice(0, 3).map((i) => String(items()[i]?.name ?? i)).join(", ")}…`;
      return [
        field("Sells", sel, "One of the game's shops: a mod can't change Gold's stock yet (ISSUES #6)."),
        h("p", { class: "hint" }, (lists[id] ?? []).map((i) => String(items()[i]?.name ?? i)).join(", ")),
      ];
    }
    case "fruit": {
      const ft = store.adapter.globals?.fruitTrees;
      const trees = ft ? ((store.table(ft.registry)[ft.id] as string[] | undefined) ?? []) : [];
      const cur = Number((scriptOf(e)?.[0]?.args as number[] | undefined)?.[0] ?? 1);
      const sel = selectInput(String(cur), trees.map((_x, i) => String(i + 1)), (v) => edit("Fruit tree", (x) => (x.scriptKey = [{ op: "fruittree", args: [Number(v)] }])));
      for (const o of sel.options) o.textContent = `Tree ${o.value}: ${String(items()[trees[Number(o.value) - 1]]?.name ?? trees[Number(o.value) - 1] ?? "?")}`;
      return [
        field("Tree", sel, "Trees with the same number share their fruit and are picked together."),
        h("div", { class: "row" }, h("button", { class: "btn small ghost", onclick: () => nav.openGlobal("fruittrees") }, "Edit what the trees give →")),
      ];
    }
    case "game": {
      const id = `game:${eventId(c.map.id, "talk", talkKey(c))}`;
      return [
        h("div", { class: "row" },
          h("span", { class: "hint" }, "Runs the game's own script."),
          h("button", { class: "btn small ghost", title: "Open it in Events, where Edit a copy makes it the mod's", onclick: () => nav.openEvent(id) }, "View →")),
        ...outline(id),
      ];
    }
    case "none":
      return [h("p", { class: "hint" }, "Nothing happens when the player talks to it.")];
  }
  return [];
}

export const gen2Roles: RoleSet = (c) => {
  if (c.kind !== "npc" && c.kind !== "sign") return null;
  const current = roleOf(c);
  const npc = c.kind === "npc";
  const options = [
    "", "event",
    ...(npc ? ["trainer", "item", "mart", "nurse", ...(store.adapter.globals?.fruitTrees ? ["fruit"] : [])] : ["hidden", "std"]),
    // only when the game's script does more than one of the roles above
    ...((gameScript(c) && keyRole(gameScript(c)!) === "game") || current === "game" ? ["game"] : []),
    ...(current === "none" ? ["none"] : []),
  ];
  return { current, options, set: (next) => setRole(c, current, next), panels: panels(c, current) };
};

// a new person / sign says a new text of its own
export function freshRole(map: MapDef, layer: string, index: number, kind: string): void {
  store.edit(map.id, "New text", (d) => {
    const e = store.entities(d, layer)[index];
    if (e && e.scriptKey === undefined && !e.itemball && !e.hiddenItem) e.scriptKey = [{ op: kind === "npc" ? "jumptextfaceplayer" : "jumptext", text: newEventText() }];
  });
  syncEventTexts();
}
