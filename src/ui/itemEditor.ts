// Items workspace: every item (left), its name/price/effect/shops (center),
// and what uses it (right). Item effects are built into the engine by item
// id; a custom effect (built from blocks, see src/lua/itemEffectRuntime.ts)
// replaces the built-in one for any item and gives new items a use.

import { clone } from "../core/merge.ts";
import { store } from "../core/store.ts";
import type { BallRecord, ItemEffectSpec, ItemEffectStep, ItemSpec, MartRef } from "../games/types.ts";
import { describeItemEffect } from "../games/gen1/items.ts";
import { clear, comboInput, field, h, numberInput, onFocusLeave, rerender, selectInput, toast } from "./dom.ts";
import { nav } from "./nav.ts";
import { idRow } from "./renameId.ts";
import { promptNewRecord } from "./newRecord.ts";
import { counterLabel, countersGiving, showCounter } from "./prizeEditor.ts";
import { mountRecordList } from "./recordList.ts";
import { sortMenu, type SortOption, type SortState } from "./sortMenu.ts";

type Rec = Record<string, unknown>;

function spec(): ItemSpec | undefined {
  return store.adapter?.items;
}

function items(): Record<string, Rec> {
  return store.table(spec()?.registry ?? "items") as Record<string, Rec>;
}

function effects(): Record<string, ItemEffectSpec> {
  const s = spec();
  return s ? (store.table(s.effectRegistry) as Record<string, ItemEffectSpec>) : {};
}

// the custom effect an item uses: its `effect` field, or (Gen 2) the effect
// record under the item's own id
function effectOf(id: string, r: Rec | undefined): string {
  if (spec()?.byItem) return effects()[id] ? id : "";
  return typeof r?.effect === "string" ? r.effect : "";
}

function balls(): Record<string, BallRecord> {
  const reg = spec()?.ballRegistry;
  return reg ? (store.table(reg) as Record<string, BallRecord>) : {};
}

// a TM's move as the list shows it: MEGA PUNCH -> Mega Punch
function moveLabel(move: string): string {
  const name = String((store.table("moves")[move] as { name?: string } | undefined)?.name ?? move.replace(/_/g, " "));
  return name.toLowerCase().replace(/(^|[\s-])(\S)/g, (_m, sep: string, c: string) => sep + c.toUpperCase());
}

// gen1recomp Bag.isBadge: an item whose id contains BADGE never shows in
// the bag (and can't be tossed or sold); the trainer card shows the ones
// in constants.badges (Global > Badges)
export const isBadgeId = (id: string) => id.includes("BADGE");

const machineOf = (r: Rec | undefined) =>
  r ? (spec()?.machineOf?.(r) ?? (r.machine as { kind?: string; move?: string; number?: number } | undefined)) : undefined;

// regular items by bag index, then TMs and HMs, then new ones
function ordered(): string[] {
  const all = items();
  const key = (id: string) => {
    const m = machineOf(all[id]);
    if (m?.move) return (m.kind === "HM" ? 2000 : 1000) + (m.number ?? 0);
    return typeof all[id].index === "number" ? (all[id].index as number) : 5000;
  };
  return Object.keys(all).sort((a, b) => key(a) - key(b) || a.localeCompare(b));
}

// what kind of item it is, in bag order: regular, balls, key items, TMs/HMs, badges
// (Gen 2's pocket; Gen 1 has key items and machines)
function kindOf(r: Rec, id: string): [number, string] {
  if (machineOf(r)?.move) return [3, "TM/HM"];
  if (isBadgeId(id)) return [4, "badge"];
  if (r.keyItem || r.pocket === "KEY_ITEM") return [2, "key"];
  if (r.pocket === "BALL") return [1, "ball"];
  return [0, "item"];
}

// the list's sort choices (game order first: the default)
function sortOptions(): SortOption[] {
  const pockets = store.project ? !!store.adapter.items?.pockets : false;
  return [
    { id: "index", label: "Game order", group: "Order" },
    { id: "name", label: "Name", group: "Order" },
    { id: "kind", label: pockets ? "Pocket" : "Kind (key items, TMs …)", group: "Order" },
    { id: "price", label: "Price", group: "Numbers", desc: true },
  ];
}

// item ids in the chosen order (ties: game order), and the right column
// for each (null: the list's usual one)
function sortedItems(sort: SortState): { ids: string[]; meta: ((id: string) => string) | null } {
  const all = items();
  const base = ordered();
  const rank = new Map(base.map((id, i) => [id, i]));
  let value: (id: string) => number | string = (id) => rank.get(id) ?? 9999;
  let meta: ((id: string) => string) | null = null;
  if (sort.id === "name") value = (id) => String(all[id].name ?? id);
  else if (sort.id === "kind") {
    value = (id) => kindOf(all[id], id)[0];
    meta = (id) => kindOf(all[id], id)[1];
  } else if (sort.id === "price") {
    value = (id) => Number(all[id].price) || 0;
    meta = (id) => String(Number(all[id].price) || 0);
  }
  const dir = sort.desc ? -1 : 1;
  const ids = [...base].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
    return c * dir || (rank.get(a) ?? 0) - (rank.get(b) ?? 0);
  });
  return { ids, meta };
}

function isNewItem(id: string): boolean {
  return store.baseTable(spec()!.registry)[id] === undefined;
}

function itemEdited(id: string): boolean {
  const s = spec()!;
  return store.isRecordEdited(s.registry, id) || (!!s.ballRegistry && store.isRecordEdited(s.ballRegistry, id)) || (!!s.byItem && store.isRecordEdited(s.effectRegistry, id));
}

export function mountItemWorkspace(left: HTMLElement, center: HTMLElement, right: HTMLElement): void {
  let current: string | null = null;
  const newBtn = h("button", { class: "btn small", title: "Add an item, starting as a copy of one", onclick: () => createItem() }, "+ Item");
  const newMachine = h("button", { class: "btn small", title: "A new TM or HM that teaches a move", onclick: () => void createMachine() }, "+ TM/HM");
  const sort = sortMenu("items", sortOptions, () => list.render());
  const list = mountRecordList(left, {
    title: "Items",
    folded: { label: "Used by the game", hint: "Not real items: elevator floor labels, Surf's hidden item and unused slots. Edit only if you know why." },
    head: [newBtn, newMachine, sort.el],
    placeholder: "Search items…  (Ctrl+F)",
    searchId: "items-search",
    items: () => {
      const s = spec();
      if (!s) return [];
      const all = items();
      const sorted = sortedItems(sort.state());
      return sorted.ids.map((id) => {
        const r = all[id];
        const m = machineOf(r);
        return {
          id,
          label: String(r.name ?? id),
          meta: sorted.meta ? sorted.meta(id) : m?.move ? moveLabel(m.move) : isBadgeId(id) ? "badge" : r.keyItem || r.pocket === "KEY_ITEM" ? "key" : r.pocket === "BALL" ? "ball" : effectOf(id, r) ? "custom" : "",
          search: `${id} ${String(r.name ?? "")} ${m?.move ?? ""}`,
          edited: itemEdited(id),
          isNew: isNewItem(id),
          folded: !!s.internal(id, r),
        };
      });
    },
    current: () => current,
    pick: (id) => open(id),
    refreshOn: (reason, _id, registry) =>
      reason === "content" && (registry === spec()?.registry || registry === spec()?.ballRegistry || registry === spec()?.effectRegistry || registry === "moves"),
  });

  const main = h("div", { class: "ws-scroll" });
  const side = h("div", { class: "ws-scroll" });
  const title = h("span", { class: "head-title" }, "Items");
  const revert = h("button", {
    class: "btn small danger",
    onclick: () => {
      const s = spec();
      if (!current || !s) return;
      const id = current;
      if (isNewItem(id)) return deleteItem(id);
      store.group(`Revert ${id}`, () => {
        store.revertRecord(s.registry, id);
        if (s.ballRegistry) store.revertRecord(s.ballRegistry, id);
        // Gen 2: the custom effect is the record under the item's id
        if (s.byItem) store.revertRecord(s.effectRegistry, id);
        dropUnusedEffects();
      });
    },
  }, "Revert to base");
  center.append(h("div", { class: "panel-head" }, title, revert), main);
  right.append(h("div", { class: "panel-head" }, h("span", {}, "Used by")), side);

  const open = (id: string) => {
    if (!items()[id]) return;
    current = id;
    list.render();
    render(true);
    left.querySelector<HTMLElement>(`.map-row[data-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
  };
  nav.openItem = (id) => {
    nav.setWorkspace("items");
    open(id);
  };

  // a copy of an existing item; a built-in effect the blocks can rebuild
  // comes along as a custom one, so the copy behaves the same
  const createItem = async () => {
    const s = spec();
    if (!s) return;
    const all = items();
    const sources = ordered().filter((id) => !s.special(id, all[id]) && !s.internal(id, all[id]));
    const res = await promptNewRecord({
      title: "New item",
      idPrefix: "",
      nameMax: s.nameMax,
      taken: (id) => all[id] !== undefined,
      sources: sources.map((id) => ({ id, label: String(all[id].name ?? id) })),
      source: current && sources.includes(current) ? current : (sources.find((id) => id === "POTION") ?? sources[0]),
    });
    if (!res) return;
    const src = all[res.source];
    const rec = clone(src) as Rec;
    rec.id = res.id;
    rec.name = res.name;
    delete rec.index;
    delete rec.source;
    store.group(`New item ${res.id}`, () => {
      if (!rec.effect) {
        const template = s.template(res.source, src);
        if (template) {
          const fxId = effectIdFor(res.id);
          store.setRecord(s.effectRegistry, fxId, "New custom item effect", template);
          rec.effect = fxId;
        }
      }
      store.setRecord(s.registry, res.id, `New item ${res.id}`, rec);
      const ball = balls()[res.source];
      if (s.ballRegistry && ball) store.setRecord(s.ballRegistry, res.id, "Ball catch numbers", clone(ball));
    });
    open(res.id);
  };

  // A TM or HM is an item with machine = { kind, move, number }; the
  // Pokémon's TM/HM lists are built from all such items, so a new one shows
  // there at once. Its number only names and sorts it (TM51, HM06).
  const createMachine = async () => {
    const s = spec();
    if (!s) return;
    const res = await promptMachine();
    if (!res) return;
    const all = items();
    // the id is the name (TM51), the one the id row would suggest anyway
    const name = `${res.kind}${String(res.number).padStart(2, "0")}`;
    let id = name;
    for (let k = 2; all[id]; k++) id = `${name}_${k}`;
    const rec: Rec = {
      id,
      name,
      price: res.kind === "HM" ? 0 : 3000,
      machine: { kind: res.kind, move: res.move, number: res.number },
    };
    store.setRecord(s.registry, id, `New ${rec.name as string}`, rec);
    store.seal();
    open(id);
  };

  const deleteItem = (id: string) => {
    const s = spec()!;
    const uses = usesOf(id);
    if (!confirm(`${uses.length ? `${id} is still used by ${uses.slice(0, 10).map((u) => u.label).join(", ")}${uses.length > 10 ? " …" : ""}.\n\n` : ""}Delete ${id}?`)) return;
    store.group(`Delete ${id}`, () => {
      store.setRecord(s.registry, id, `Delete ${id}`, undefined);
      if (s.ballRegistry && balls()[id]) store.setRecord(s.ballRegistry, id, "Delete ball", undefined);
      for (const m of s.marts(store.ctx)) if (martStock(m).includes(id)) setStock(m, martStock(m).filter((x) => x !== id));
      dropUnusedEffects();
    });
    current = ordered()[0] ?? null;
    list.render();
    render(true);
  };

  const render = (force = false) => {
    const s = spec();
    const r = current ? items()[current] : undefined;
    if (!s || !r || !current) {
      clear(main);
      clear(side);
      main.append(h("p", { class: "hint empty" }, s ? "Pick an item on the left." : "This game has no item editor yet."));
      return;
    }
    const id = current;
    title.textContent = String(r.name ?? id);
    newBtn.hidden = newMachine.hidden = s.newItems === false;
    const isNew = isNewItem(id);
    revert.textContent = isNew ? "Delete item" : "Revert to base";
    revert.hidden = !isNew && !itemEdited(id);
    if (force) {
      clear(main);
      clear(side);
    }
    rerender(main, () => itemForm(s, id, r));
    rerender(side, () => usedBy(id));
  };

  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      render();
    });
  };
  onFocusLeave(main, schedule);
  store.on((reason, id, registry) => {
    const s = spec();
    if (reason === "project") {
      if (!current || !items()[current]) current = ordered()[0] ?? null;
      render(true);
    } else if (reason === "content" && s && [s.registry, s.effectRegistry, s.ballRegistry, "text_pointers", "pokemon", "ai_classes", "moves", store.adapter.towns?.prizeRegistry].includes(registry)) {
      schedule();
    } else if (reason === "reveal" && s && (registry === s.registry || registry === s.ballRegistry) && id) {
      nav.openItem(id);
    }
  });
}

const effectIdFor = (itemId: string): string => {
  const base = `STUDIO_${itemId}`.replace(/[^A-Z0-9_]/g, "_");
  let id = base;
  for (let n = 2; effects()[id]; n++) id = `${base}_${n}`;
  return id;
};

// custom effects no item points at any more are dropped (call inside a group)
function dropUnusedEffects(): void {
  const s = spec()!;
  // Gen 2: an effect belongs to its item, nothing to share
  if (s.byItem) return;
  const used = new Set(Object.values(items()).map((r) => r.effect));
  for (const fx of Object.keys(effects())) if (!used.has(fx)) store.setRecord(s.effectRegistry, fx, "Remove unused item effect", undefined);
}

// ------------------------------------------------------------------ form

function edit(id: string, label: string, mutate: (r: Rec) => void): void {
  store.editRecord<Rec>(spec()!.registry, id, label, mutate);
  store.seal();
}

function check(label: string, on: boolean, onChange: (v: boolean) => void, hint: string): HTMLElement {
  const box = h("input", { type: "checkbox", checked: on });
  box.addEventListener("change", () => onChange(box.checked));
  return h("label", { class: "ai-layer" }, box, h("span", {}, h("strong", {}, label), h("span", { class: "hint" }, hint)));
}

function itemForm(s: ItemSpec, id: string, r: Rec): HTMLElement[] {
  const name = h("input", { type: "text", value: String(r.name ?? ""), maxLength: s.nameMax, spellcheck: false });
  name.addEventListener("change", () => edit(id, "Item name", (d) => (d.name = name.value.trim().toUpperCase() || id)));
  const keyItem = r.keyItem === true;
  const basics = h(
    "section",
    { class: "card" },
    h("h4", {}, "Item"),
    idRow(s.registry, id, String(r.name ?? ""), (to) => nav.openItem(to)),
    field("Name", name, `Up to ${s.nameMax} characters, as shown in the bag.`),
    h(
      "div",
      { class: "row three" },
      field("Price", numberInput(Number(r.price ?? 0), (v) => edit(id, "Item price", (d) => (d.price = Math.max(0, Math.min(s.maxPrice, v)))), 0, s.maxPrice), "Shops sell for this and buy back for half."),
    ),
    s.pockets
      ? null
      : check("Key item", keyItem, (v) => edit(id, "Key item", (d) => (v ? (d.keyItem = true) : delete d.keyItem)), "Can't be sold or tossed; plays the key-item jingle when received."),
    // a TM/HM shows its move's description in the bag
    s.description && !machineOf(r)?.move ? descriptionField(s, id, r) : null,
  );
  // a TM/HM stays in its pocket (the machine data decides what it is)
  if (s.pockets && !machineOf(r)?.move) {
    // pocketId: the pocket's number (list position + 1), kept in sync
    const pockets = s.pockets.filter((p) => p !== "TM_HM");
    const pocket = selectInput(String(r.pocket ?? ""), pockets, (v) => edit(id, "Bag pocket", (d) => {
      d.pocket = v;
      if ("pocketId" in d) d.pocketId = s.pockets!.indexOf(v) + 1;
    }));
    for (const o of pocket.options) o.textContent = POCKET_LABELS[o.value] ?? o.value;
    basics.querySelector(".row.three")!.append(field("Pocket", pocket, "Where the bag keeps it."));
  }
  if (isBadgeId(id)) {
    basics.append(h("div", { class: "notice" },
      h("strong", {}, "A badge"),
      h("p", {}, "Its id contains BADGE, so the game never shows it in the bag. The badges the trainer card shows, in their order, are set in Global > Badges; give one with an event (Give item)."),
      h("button", { class: "btn small", onclick: () => nav.openGlobal("badges") }, "Open Global > Badges"),
    ));
  }
  const internal = s.internal(id, r);
  const out = internal
    ? [h("section", { class: "card warn-card" }, h("h4", {}, "Used by the game"), h("p", { class: "hint" }, internal), h("p", { class: "hint" }, "Changing it can break what relies on it.")), basics]
    : [basics];
  // not a real item: no effect, catching or shops
  if (internal) return out;
  const machine = machineOf(r);
  if (machine?.move) out.push(s.machineEdit === false ? machineInfo(machine) : machineCard(id, machine));
  if (s.heldEffects) out.push(heldCard(s, id, r));
  if (s.effects !== false) {
    out.push(effectCard(s, id, r));
    if (balls()[id] || effects()[effectOf(id, r)]?.steps.some((st) => st.act === "ball")) out.push(ballCard(s, id));
  }
  if (s.marts(store.ctx).length) out.push(martCard(s, id, r));
  return out;
}

const POCKET_LABELS: Record<string, string> = { ITEM: "Items", BALL: "Balls", KEY_ITEM: "Key items", TM_HM: "TMs / HMs" };

// the bag's text: one input per line, stored joined with <NEXT>
function descriptionField(s: ItemSpec, id: string, r: Rec): HTMLElement {
  const spec = s.description!;
  const lines = String(r.description ?? "").split("<NEXT>");
  const inputs = Array.from({ length: spec.lines }, (_, i) => {
    const input = h("input", { type: "text", value: lines[i] ?? "", maxLength: spec.lineMax, spellcheck: false, class: "mono" });
    input.addEventListener("change", () =>
      edit(id, "Item description", (d) => {
        const next = inputs.map((x) => x.value);
        while (next.length > 1 && !next[next.length - 1]) next.pop();
        d.description = next.join("<NEXT>");
      }));
    return input;
  });
  return field("Description", h("div", { class: "desc-lines" }, ...inputs), `${spec.lines} lines of up to ${spec.lineMax} characters, shown in the bag.`);
}

// what it does when a Pokémon holds it: the engine's held effect, and its
// number where that effect reads one (heal amount, boost %, chance ...)
function heldCard(s: ItemSpec, id: string, r: Rec): HTMLElement {
  const held = s.heldEffects!;
  const effect = String(r.heldEffect ?? "HELD_NONE");
  const sel = selectInput(effect, held.ids, (v) => edit(id, "Held effect", (d) => (d.heldEffect = v)));
  for (const o of sel.options) o.textContent = o.value === "HELD_NONE" ? "Nothing" : o.value.replace(/^HELD_/, "").replace(/_/g, " ").toLowerCase();
  const info = held.info(effect);
  const amount = info.amount;
  return h(
    "section",
    { class: "card" },
    h("h4", {}, "When held"),
    h(
      "div",
      { class: "row three" },
      field("Held effect", sel, info.note),
      amount
        ? field(amount.label, numberInput(Number(r.heldParameter ?? 0), (v) => edit(id, amount.label, (d) => (d.heldParameter = Math.max(0, Math.min(amount.max, v)))), 0, amount.max), amount.hint)
        : h("span", {}),
    ),
  );
}

// a TM/HM the studio shows but doesn't change (Gen 2), and who learns it
function machineInfo(m: { kind?: string; move?: string; number?: number }): HTMLElement {
  return h(
    "section",
    { class: "card" },
    h("h4", {}, "TM / HM"),
    h("p", {}, `${m.kind ?? "TM"}${String(m.number ?? 0).padStart(2, "0")} teaches `, h("strong", {}, moveLabel(m.move ?? ""))),
    m.move ? learnersCard(m.move) : null,
  );
}

// the next unused number for a TM or an HM
function nextMachineNumber(kind: string): number {
  const used = new Set(Object.values(items()).map((r) => machineOf(r)).filter((m) => m?.kind === kind).map((m) => m!.number));
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

// kind, number and move for a new TM/HM
function promptMachine(): Promise<{ kind: "TM" | "HM"; number: number; move: string } | null> {
  return new Promise((resolve) => {
    const moves = store.adapter.pokemon?.moveNames(store.ctx) ?? [];
    const taught = new Set(Object.values(items()).map((r) => machineOf(r)?.move));
    let kind: "TM" | "HM" = "TM";
    let move = moves.find((m) => !taught.has(m)) ?? moves[0] ?? "";
    const number = numberInput(nextMachineNumber("TM"), () => {}, 1, 99);
    const kindSel = selectInput(kind, ["TM", "HM"], (v) => {
      kind = v as "TM" | "HM";
      number.value = String(nextMachineNumber(kind));
    });
    const moveIn = comboInput(move, "dl-item-moves", moves, (v) => (move = v));
    const dialog = h("dialog", {});
    const close = (v: { kind: "TM" | "HM"; number: number; move: string } | null) => {
      dialog.close();
      dialog.remove();
      resolve(v);
    };
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      close(null);
    });
    const create = () => {
      if (!moves.includes(move)) return toast(`${move || "That"} is not a move`, "error");
      close({ kind, number: Math.max(1, Math.min(99, Math.trunc(Number(number.value) || 1))), move });
    };
    dialog.append(
      h("h3", {}, "New TM / HM"),
      h("div", { class: "row three" }, field("Kind", kindSel), field("Number", number), field("Teaches", moveIn)),
      h("p", { class: "hint" }, "HMs are never used up. A new HM teaches the move like a TM; using it outside of battle (like Cut or Surf) only works for the game's field moves."),
      h("p", { class: "hint" }, "Afterwards, tick it in each Pokémon's TM/HM list that should learn it, and put it in a shop or an event so players can get it."),
      h("div", { class: "dialog-actions" }, h("button", { class: "btn", onclick: () => close(null) }, "Cancel"), h("button", { class: "btn primary", onclick: create }, "Create")),
    );
    document.body.append(dialog);
    dialog.showModal();
  });
}

function machineCard(id: string, m: { kind?: string; move?: string; number?: number }): HTMLElement {
  const moves = store.adapter.pokemon?.moveNames(store.ctx) ?? [];
  const setM = (label: string, mutate: (x: { kind?: string; move?: string; number?: number }) => void) =>
    edit(id, label, (d) => {
      const next = { ...(d.machine as object) } as { kind?: string; move?: string; number?: number };
      mutate(next);
      d.machine = next;
    });
  return h(
    "section",
    { class: "card" },
    h("h4", {}, "TM / HM"),
    h(
      "div",
      { class: "row three" },
      field("Kind", selectInput(m.kind ?? "TM", ["TM", "HM"], (v) => setM("Machine kind", (x) => (x.kind = v)))),
      field("Number", numberInput(m.number ?? 1, (v) => setM("Machine number", (x) => (x.number = Math.max(0, Math.min(99, v)))), 0, 99)),
      field("Teaches", comboInput(m.move ?? "", "dl-item-moves", moves, (v) => moves.includes(v) && setM("Machine move", (x) => (x.move = v)))),
    ),
    h("p", { class: "hint" }, "HMs are never used up."),
    m.move ? learnersCard(m.move) : null,
  );
}

// Which Pokémon can learn a machine's move: the same `tmhm` lists the
// Pokémon workspace edits (a move in the list = the TM/HM teaches it).
// Kept in the game's machine order, like the Pokémon editor writes them.
// the checklist's search survives the redraw each tick causes
let learnerQuery = "";
function learnersCard(move: string): HTMLElement {
  type Mon = { name?: string; dex?: number; tmhm?: string[] };
  const mons = store.table("pokemon") as Record<string, Mon>;
  const ids = Object.keys(mons).sort((a, b) => (mons[a].dex ?? 999) - (mons[b].dex ?? 999) || a.localeCompare(b));
  const machines = store.adapter.pokemon?.machines(store.ctx) ?? [];
  const rank = (m: string) => {
    const i = machines.findIndex((x) => x.move === m);
    return i < 0 ? 999 : i;
  };
  const learns = (id: string) => (store.table("pokemon")[id] as Mon | undefined)?.tmhm?.includes(move) ?? false;
  // a set of Pokémon learning it from now on (one undo step)
  const setLearners = (label: string, want: (id: string) => boolean) => {
    store.group(label, () => {
      for (const id of ids) {
        const on = want(id);
        if (on === learns(id)) continue;
        store.editRecord<Mon>("pokemon", id, label, (d) => {
          const cur = (d.tmhm ?? []).filter((x) => x !== move);
          d.tmhm = (on ? [...cur, move] : cur).sort((a, b) => rank(a) - rank(b));
        });
      }
    });
    store.seal();
    for (const [id, box] of boxes) {
      box.checked = learns(id);
      box.parentElement!.classList.toggle("on", box.checked);
    }
    count.textContent = String(ids.filter(learns).length);
  };
  const boxes = new Map<string, HTMLInputElement>();
  const grid = h("div", { class: "tm-grid" }, ...ids.map((id) => {
    const box = h("input", { type: "checkbox", checked: learns(id) });
    box.addEventListener("change", () => setLearners(box.checked ? `Teach ${move} to ${id}` : `Forget ${move} for ${id}`, (x) => (x === id ? box.checked : learns(x))));
    boxes.set(id, box);
    return h("label", { class: `tm${box.checked ? " on" : ""}`, "data-search": `${id} ${String(mons[id].name ?? "")}`.toUpperCase() },
      box, h("span", { class: "tm-num" }, `#${String(mons[id].dex ?? "?").padStart(3, "0")}`), h("span", { class: "tm-move" }, String(mons[id].name ?? id)));
  }));
  const search = h("input", { type: "search", placeholder: "Find a Pokémon…", spellcheck: false, value: learnerQuery });
  const filter = () => {
    learnerQuery = search.value;
    const q = search.value.trim().toUpperCase();
    for (const el of grid.children) (el as HTMLElement).hidden = !!q && !(el as HTMLElement).dataset.search!.includes(q);
  };
  search.addEventListener("input", filter);
  filter();
  // the learners of another machine's move
  const others = machines.filter((x) => x.move !== move);
  const same = h("select", {},
    h("option", { value: "" }, "Same as…"),
    ...others.map((x) => h("option", { value: x.move }, `${x.label} ${x.move.replace(/_/g, " ")}`)),
  );
  same.addEventListener("change", () => {
    const other = same.value;
    same.value = "";
    if (other) setLearners(`${move}: same as ${other}`, (id) => (store.table("pokemon")[id] as Mon | undefined)?.tmhm?.includes(other) ?? false);
  });
  const count = h("strong", {}, String(ids.filter(learns).length));
  // the game's learners (a Pokémon the game doesn't have keeps its own)
  const gameLearns = (id: string) => {
    const base = store.baseTable("pokemon")[id] as Mon | undefined;
    return base ? (base.tmhm ?? []).includes(move) : learns(id);
  };
  const changed = ids.some((id) => learns(id) !== gameLearns(id));
  return h("div", { class: "learners" },
    h("div", { class: "row wrap learners-head" },
      h("span", { class: "field-label" }, "Who can learn it: ", count),
      search,
      h("button", { class: "btn small", onclick: () => setLearners(`Every Pokémon learns ${move}`, () => true) }, "All"),
      h("button", { class: "btn small", onclick: () => setLearners(`No Pokémon learns ${move}`, () => false) }, "None"),
      same,
      changed ? h("button", { class: "btn small danger", title: "The Pokémon the game lets learn it", onclick: () => setLearners(`${move}: the game's learners`, gameLearns) }, "Back to the game's") : null,
    ),
    grid,
  );
}

// ------------------------------------------------------------------ effect

const PARTY_ACTS: { id: ItemEffectStep["act"]; label: string }[] = [
  { id: "heal", label: "Restore HP" },
  { id: "cure", label: "Cure status" },
  { id: "revive", label: "Revive" },
  { id: "pp", label: "Restore PP" },
  { id: "statexp", label: "Stat EXP (vitamin)" },
  { id: "level", label: "Level up" },
  { id: "evolve", label: "Evolve (stone)" },
];
const NONE_ACTS: { id: ItemEffectStep["act"]; label: string }[] = [
  { id: "stage", label: "Raise stat (X item)" },
  { id: "focus", label: "Focus Energy (Dire Hit)" },
  { id: "mist", label: "Mist (Guard Spec)" },
  { id: "xaccuracy", label: "Never miss (X Accuracy)" },
  { id: "escape", label: "Escape wild battle" },
  { id: "ball", label: "Throw as a ball" },
  { id: "repel", label: "Repel" },
];

function stepDefaults(act: ItemEffectStep["act"]): Partial<ItemEffectStep> {
  switch (act) {
    case "heal":
      return { amount: 20 };
    case "revive":
      return { percent: 50 };
    case "pp":
      return { amount: 10, all: true };
    case "statexp":
      return { stat: "attack", amount: 2560, cap: 25600 };
    case "stage":
      return { stat: "attack", delta: 1 };
    case "repel":
      return { steps: 100 };
    default:
      return {};
  }
}

function effectCard(s: ItemSpec, id: string, r: Rec): HTMLElement {
  const effect = effectOf(id, r);
  const all = effects();
  const fx = all[effect];
  const byItem = s.byItem;
  const options = [...new Set([...Object.keys(all), ...(effect ? [effect] : [])])].sort();
  const sel = selectInput(effect, options, (v) => {
    store.group("Item effect", () => {
      edit(id, "Item effect", (d) => (v ? (d.effect = v) : delete d.effect));
      dropUnusedEffects();
    });
  }, s.special(id, r) || s.template(id, r) ? "Built-in" : "(none)");
  const card = byItem
    ? h("section", { class: "card" }, h("h4", {}, "Effect"))
    : h("section", { class: "card" }, h("h4", {}, "Effect"), field("Effect", sel, "Custom effects are built from blocks; one can be shared by several items."));

  if (!fx) {
    if (effect) {
      card.append(h("p", { class: "hint warn" }, `${effect} is not defined by the studio (a hand-written mod may register it).`));
      return card;
    }
    const template = s.template(id, r);
    card.append(h("p", { class: "hint" }, s.describe(id, r)));
    if (s.special(id, r)) {
      card.append(h("p", { class: "hint" }, "Built into the game; this one can't be rebuilt from blocks."));
      return card;
    }
    card.append(
      h(
        "div",
        { class: "row" },
        h("button", {
          class: "btn small primary-ish",
          title: template ? "Start a custom effect with the same behaviour, ready to tweak" : "Start a custom effect from scratch",
          onclick: () => {
            const fxId = byItem ? id : effectIdFor(id);
            const fresh: ItemEffectSpec = template ?? { target: "party", steps: [{ act: "heal", amount: 20 }] };
            store.group(`Custom effect for ${id}`, () => {
              store.setRecord(s.effectRegistry, fxId, "New custom item effect", fresh);
              if (!byItem) edit(id, "Item effect", (d) => (d.effect = fxId));
              // an item without a use gets one outside battle
              else if (r[byItem.field] !== byItem.on && r[byItem.battle] !== byItem.on) edit(id, "Where usable", (d) => (d[byItem.field] = byItem.on));
            });
          },
        }, template ? "Customize this effect" : "Custom effect"),
        h("span", { class: "hint" }, template ? "Makes an editable copy for this item." : byItem ? "Built from blocks, used on a party Pokémon: healing, cures, revive, PP, vitamins, level up, evolution." : "Built from blocks: healing, cures, PP, vitamins, level up, evolution, X items, Repel, balls."),
      ),
    );
    return card;
  }

  // ---- the builder
  // Gen 2: level up and evolution only run outside battle (the battle has no
  // move offer or evolution scene), so such an effect leaves the battle menu
  const fieldOnly = (steps: ItemEffectStep[]) => steps.some((st) => st.act === "level" || st.act === "evolve");
  const editFx = (label: string, mutate: (d: ItemEffectSpec) => void) => {
    store.group(label, () => {
      store.editRecord<ItemEffectSpec>(s.effectRegistry, effect, label, mutate);
      const now = effects()[effect];
      if (byItem && now && fieldOnly(now.steps) && items()[id]?.[byItem.battle] === byItem.on) {
        store.editRecord<Rec>(s.registry, id, label, (d) => {
          d[byItem.battle] = byItem.off;
          if (d[byItem.field] !== byItem.on) d[byItem.field] = byItem.on;
        });
      }
    });
    store.seal();
  };
  const users = Object.entries(items()).filter(([, x]) => x.effect === effect).map(([x]) => x);
  const target = selectInput(fx.target, ["party", "none"], (v) =>
    editFx("Item target", (d) => {
      d.target = v as ItemEffectSpec["target"];
      // keep only the steps that fit the new target
      const fits = new Set((v === "party" ? PARTY_ACTS : NONE_ACTS).map((a) => a.id));
      d.steps = d.steps.filter((st) => fits.has(st.act));
      if (!d.steps.length) d.steps = [{ act: v === "party" ? "heal" : "stage", ...stepDefaults(v === "party" ? "heal" : "stage") }];
    }),
  );
  target.options[0].textContent = "A party Pokémon (asks which)";
  target.options[1].textContent = "Nothing (acts in battle or the field)";
  const menuWhere = byItem && (r[byItem.field] === byItem.on ? (r[byItem.battle] === byItem.on ? "both" : "field") : "battle");
  const where = byItem
    ? selectInput(menuWhere as string, fieldOnly(fx.steps) ? ["field"] : ["both", "battle", "field"], (v) =>
        edit(id, "Where usable", (d) => {
          d[byItem.field] = v === "battle" ? byItem.off : byItem.on;
          d[byItem.battle] = v === "field" ? byItem.off : byItem.on;
        }),
      )
    : selectInput(fx.where ?? "both", ["both", "battle", "field"], (v) => editFx("Where usable", (d) => (v === "both" ? delete d.where : (d.where = v as "battle" | "field"))));
  const WHERE_LABEL: Record<string, string> = { both: "In and out of battle", battle: "Battle only", field: "Outside battle only" };
  for (const o of where.options) o.textContent = WHERE_LABEL[o.value] ?? o.value;

  const acts = fx.target === "party" ? PARTY_ACTS : NONE_ACTS;
  const editStep = (i: number, label: string, mutate: (st: ItemEffectStep) => void) =>
    editFx(label, (d) => {
      d.steps = d.steps.map((x, j) => (j === i ? { ...x } : x));
      mutate(d.steps[i]);
    });
  const stepRows = fx.steps.map((st, i) => {
    const act = h("select", {}, ...acts.map((a) => h("option", { value: a.id, selected: a.id === st.act }, a.label)));
    act.addEventListener("change", () =>
      editStep(i, "Step action", (x) => {
        for (const k of Object.keys(x)) delete (x as unknown as Rec)[k];
        Object.assign(x, { act: act.value }, stepDefaults(act.value as ItemEffectStep["act"]));
      }),
    );
    return h(
      "div",
      { class: "step-row item-step" },
      act,
      h("div", { class: "row nowrap" }, ...stepValue(s, id, st, (label, mutate) => editStep(i, label, mutate))),
      h("button", { class: "btn small ghost", title: "Remove step", onclick: () => editFx("Remove step", (d) => (d.steps = d.steps.filter((_, j) => j !== i))) }, "✕"),
    );
  });
  const hasBall = fx.steps.some((st) => st.act === "ball");

  card.append(
    h("p", { class: "effect-summary" }, describeItemEffect(fx, s.statuses)),
    byItem
      ? h("div", { class: "row three" }, field("Usable", where, fieldOnly(fx.steps) ? "Level up and evolution work outside battle only." : "The item's bag menus."))
      : h("div", { class: "row three" }, field("Used on", target), field("Usable", where)),
    ...(byItem ? [] : [check("Never used up", fx.keep === true, (v) => editFx("Never used up", (d) => (v ? (d.keep = true) : delete d.keep)), "Stays in the bag after use, like a key item.")]),
    h("h4", {}, "Steps"),
    ...stepRows,
    h(
      "div",
      { class: "row" },
      h("button", {
        class: "btn small",
        onclick: () => {
          const a = acts.find((x) => !fx.steps.some((st) => st.act === x.id)) ?? acts[0];
          editFx("Add step", (d) => (d.steps = [...d.steps, { act: a.id, ...stepDefaults(a.id) }]));
        },
      }, "+ Step"),
      h("button", {
        class: "btn small ghost",
        title: "Use the built-in behaviour again",
        onclick: () =>
          store.group("Item effect", () => {
            if (byItem) {
              store.setRecord(s.effectRegistry, id, "Item effect", undefined);
              // the game's menus again
              const base = store.baseTable(s.registry)[id] as Rec | undefined;
              if (base) edit(id, "Where usable", (d) => ((d[byItem.field] = base[byItem.field]), (d[byItem.battle] = base[byItem.battle])));
              return;
            }
            edit(id, "Item effect", (d) => delete d.effect);
            dropUnusedEffects();
          }),
      }, s.template(id, r) || s.special(id, r) ? "Back to built-in" : "Remove effect"),
      users.length > 1 ? h("span", { class: "hint" }, `Shared by ${users.length} items: ${users.join(", ")}.`) : null,
    ),
  );
  if (hasBall && s.ballRegistry && !balls()[id]) {
    card.append(
      h(
        "div",
        { class: "row" },
        h("span", { class: "hint warn" }, "A ball needs catch numbers."),
        h("button", { class: "btn small", onclick: () => (store.setRecord(s.ballRegistry!, id, "Ball catch numbers", clone(balls().POKE_BALL ?? { randMax: 255, hpFactor: 12, wobbleFactor: 255, tossAnim: "TOSS_ANIM" })), store.seal()) }, "Add (from Poké Ball)"),
      ),
    );
  }
  return card;
}

function stepValue(s: ItemSpec, id: string, st: ItemEffectStep, editStep: (label: string, mutate: (st: ItemEffectStep) => void) => void): HTMLElement[] {
  const num = (label: string, value: number, min: number, max: number, set: (x: ItemEffectStep, v: number) => void) =>
    numberInput(value, (v) => editStep(label, (x) => set(x, Math.max(min, Math.min(max, v)))), min, max);
  const muted = (t: string) => h("span", { class: "muted" }, t);
  switch (st.act) {
    case "heal": {
      const mode = st.full ? "full" : st.percent ? "percent" : "amount";
      const m = selectInput(mode, ["amount", "percent", "full"], (v) =>
        editStep("Heal amount", (x) => {
          delete x.full;
          delete x.percent;
          delete x.amount;
          if (v === "full") x.full = true;
          else if (v === "percent") x.percent = 50;
          else x.amount = 20;
        }),
      );
      m.options[0].textContent = "HP";
      m.options[1].textContent = "% of max HP";
      m.options[2].textContent = "All HP";
      if (mode === "full") return [m];
      return mode === "percent"
        ? [num("Heal %", st.percent ?? 50, 1, 100, (x, v) => (x.percent = v)), m]
        : [num("Heal HP", st.amount ?? 20, 1, 999, (x, v) => (x.amount = v)), m];
    }
    case "cure": {
      const any = !st.statuses?.length;
      const boxes = s.statuses.map((x) => {
        const box = h("input", { type: "checkbox", checked: any || !!st.statuses?.includes(x.id) });
        box.addEventListener("change", () =>
          editStep("Cured statuses", (y) => {
            const now = new Set(any ? s.statuses.map((z) => z.id) : (y.statuses ?? []));
            if (box.checked) now.add(x.id);
            else now.delete(x.id);
            const list = s.statuses.map((z) => z.id).filter((z) => now.has(z));
            if (!list.length || list.length === s.statuses.length) delete y.statuses;
            else y.statuses = list;
          }),
        );
        return h("label", { class: "inline-check" }, box, x.label);
      });
      return boxes;
    }
    case "revive":
      return [num("Revive %", st.percent ?? 50, 1, 100, (x, v) => (x.percent = v)), muted("% of max HP")];
    case "pp": {
      const amount = st.full
        ? muted("all")
        : num("PP amount", st.amount ?? 10, 1, 64, (x, v) => (x.amount = v));
      const full = selectInput(st.full ? "full" : "amount", ["amount", "full"], (v) => editStep("PP amount", (x) => (v === "full" ? ((x.full = true), delete x.amount) : (delete x.full, (x.amount = 10)))));
      full.options[0].textContent = "PP";
      full.options[1].textContent = "Full PP";
      const out: HTMLElement[] = [st.full ? full : amount, ...(st.full ? [] : [full])];
      // the engine only opens the move picker for the Ether-style ids
      if (s.picksMove(id)) {
        const which = selectInput(st.all === false ? "one" : "all", ["one", "all"], (v) => editStep("PP moves", (x) => (x.all = v === "all")));
        which.options[0].textContent = "of the move picked";
        which.options[1].textContent = "of every move";
        out.push(which);
      } else out.push(muted("of every move"));
      return out;
    }
    case "statexp":
      if (s.byItem)
        return [selectInput(st.stat ?? "attack", s.expStats, (v) => editStep("Stat", (x) => (x.stat = v))), muted("+2560 stat EXP, refused at 25600")];
      return [
        selectInput(st.stat ?? "attack", s.expStats, (v) => editStep("Stat", (x) => (x.stat = v))),
        muted("+"),
        num("Stat EXP", st.amount ?? 2560, 1, 65535, (x, v) => (x.amount = v)),
        muted("refused at"),
        num("Stat EXP cap", st.cap ?? 25600, 1, 65535, (x, v) => (x.cap = v)),
      ];
    case "level":
      return [muted("+1 level, then new moves and evolution")];
    case "evolve":
      return [muted("Pokémon whose evolution needs this item")];
    case "stage":
      return [
        selectInput(st.stat ?? "attack", s.stats, (v) => editStep("Stat", (x) => (x.stat = v))),
        selectInput(String(st.delta ?? 1), ["1", "2"], (v) => editStep("Stages", (x) => (x.delta = Number(v)))),
        muted("stage(s), up to +6"),
      ];
    case "repel":
      return [num("Repel steps", st.steps ?? 100, 1, 255, (x, v) => (x.steps = v)), muted("steps")];
    case "escape":
      return [muted("wild battles only")];
    case "ball":
      return [muted("catch numbers below")];
    default:
      return [];
  }
}

function ballCard(s: ItemSpec, id: string): HTMLElement {
  const reg = s.ballRegistry!;
  const b = balls()[id];
  if (!b) return h("section", { class: "card" }, h("h4", {}, "Catching"), h("p", { class: "hint" }, "No catch numbers yet."));
  const editBall = (label: string, mutate: (d: BallRecord) => void) => {
    store.editRecord<BallRecord>(reg, id, label, mutate);
    store.seal();
  };
  const num = (key: "randMax" | "hpFactor" | "wobbleFactor", label: string, min: number, max: number, hint: string) =>
    field(label, numberInput(b[key] ?? 0, (v) => editBall(label, (d) => (d[key] = Math.max(min, Math.min(max, v)))), min, max), hint);
  return h(
    "section",
    { class: "card" },
    h("h4", {}, "Catching"),
    check("Always catches", b.autoCatch === true, (v) => editBall("Always catches", (d) => (v ? (d.autoCatch = true) : delete d.autoCatch)), "Like the Master Ball."),
    b.autoCatch
      ? null
      : h(
          "div",
          { class: "row three" },
          num("randMax", "Roll range", 0, 255, "Lower = better (Poké 255, Great 200, Ultra 150)."),
          num("hpFactor", "HP factor", 1, 255, "Lower = HP matters more (Great 8, others 12)."),
          num("wobbleFactor", "Wobble factor", 1, 255, "Only changes how often it shakes on a miss."),
        ),
    h(
      "div",
      { class: "row three" },
      field("Throw animation", selectInput(b.tossAnim ?? "TOSS_ANIM", s.tossAnims, (v) => editBall("Throw animation", (d) => (d.tossAnim = v)))),
    ),
    check("Flicker", b.flicker === true, (v) => editBall("Flicker", (d) => (v ? (d.flicker = true) : delete d.flicker)), "The Ultra/Master Ball palette strobe on the throw."),
  );
}

// ------------------------------------------------------------------ shops

function martStock(m: MartRef): string[] {
  const entry = (store.table(m.registry)[m.map] as Record<string, { mart?: string[] }> | undefined)?.[m.text];
  return Array.isArray(entry?.mart) ? entry.mart : [];
}

function setStock(m: MartRef, stock: string[]): void {
  store.editRecord<Record<string, Rec>>(m.registry, m.map, "Shop stock", (d) => {
    d[m.text] = { ...d[m.text], mart: stock };
  });
}

function martCard(s: ItemSpec, id: string, r: Rec): HTMLElement {
  const marts = s.marts(store.ctx);
  const rows = marts.map((m) => {
    const stock = martStock(m);
    const box = h("input", { type: "checkbox", checked: stock.includes(id) });
    box.addEventListener("change", () => {
      setStock(m, box.checked ? [...stock, id] : stock.filter((x) => x !== id));
      store.seal();
    });
    return h(
      "div",
      { class: "mart-row" },
      h("label", { class: "inline-check" }, box, m.label),
      m.mapId ? h("button", { class: "btn small ghost", title: "Open the map", onclick: () => nav.openMap(m.mapId!) }, "Map") : null,
    );
  });
  return h(
    "section",
    { class: "card" },
    h("h4", {}, "Sold at"),
    r.keyItem ? h("p", { class: "hint warn" }, "Key items can't be bought back or sold; shops still list them.") : null,
    rows.length ? h("div", { class: "mart-grid" }, ...rows) : h("p", { class: "hint" }, "No shops found."),
    h("p", { class: "hint" }, "New items go at the end of the shop's list."),
  );
}

// ------------------------------------------------------------------ used by

interface Use {
  label: string;
  open?: () => void;
}

function usesOf(id: string): Use[] {
  const out: Use[] = [];
  for (const [pid, m] of Object.entries(store.table("pokemon") as Record<string, Rec>)) {
    const into = store.adapter.pokemon?.keys?.evolveInto ?? "species";
    const evos = (m.evolutions as Record<string, string | undefined>[] | undefined) ?? [];
    for (const e of evos) if (e.item === id) out.push({ label: `${String(m.name ?? pid)} → ${e[into] ?? "?"}`, open: () => nav.openPokemon(pid) });
  }
  for (const [cls, a] of Object.entries(store.table("ai_classes") as Record<string, Rec>)) {
    if (a.item === id) out.push({ label: `Trainer AI: ${cls}`, open: () => nav.openTrainer(cls) });
  }
  const s = spec();
  for (const m of s?.marts(store.ctx) ?? []) if (martStock(m).includes(id)) out.push({ label: `Shop: ${m.label}`, open: () => (m.mapId ? nav.openMap(m.mapId) : undefined) });
  const towns = store.adapter.towns;
  if (towns) for (const cid of countersGiving(towns, id)) out.push({ label: `Prize: ${counterLabel(cid)}`, open: () => showCounter(cid) });
  for (const u of s?.uses?.(store.ctx, id) ?? []) {
    const { map, trainer, pokemon } = u;
    const open = map
      ? () => (map.layer && map.index !== undefined ? nav.selectEntity(map.id, map.layer, map.index) : nav.openMap(map.id))
      : trainer
        ? () => nav.openTrainer(trainer.id, trainer.team)
        : pokemon
          ? () => nav.openPokemon(pokemon)
          : undefined;
    out.push({ label: u.label, open });
  }
  return out;
}

function usedBy(id: string): HTMLElement[] {
  const uses = usesOf(id);
  const out: HTMLElement[] = [];
  if (!uses.length) out.push(h("p", { class: "hint" }, spec()?.uses ? "Nothing in the game uses this item: no shop, trainer, held item, item ball or evolution." : "No evolution, trainer AI, shop or prize counter uses this item."));
  for (const u of uses) out.push(h("button", { class: "use-row", onclick: u.open }, h("span", { class: "use-map" }, u.label)));
  return out;
}
