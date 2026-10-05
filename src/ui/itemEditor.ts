// Items workspace: every item (left), its name/price/effect/shops (center),
// and what uses it (right). Item effects are built into the engine by item
// id; a custom effect (built from blocks, see src/lua/itemEffectRuntime.ts)
// replaces the built-in one for any item and gives new items a use.

import { clone } from "../core/merge.ts";
import { store } from "../core/store.ts";
import type { BallRecord, ItemEffectSpec, ItemEffectStep, ItemSpec, MartRef } from "../games/types.ts";
import { describeItemEffect } from "../games/gen1/items.ts";
import { clear, comboInput, field, h, numberInput, onFocusLeave, rerender, selectInput } from "./dom.ts";
import { nav } from "./nav.ts";
import { promptNewRecord } from "./newRecord.ts";
import { mountRecordList } from "./recordList.ts";

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

function balls(): Record<string, BallRecord> {
  const reg = spec()?.ballRegistry;
  return reg ? (store.table(reg) as Record<string, BallRecord>) : {};
}

// a TM's move as the list shows it: MEGA PUNCH -> Mega Punch
function moveLabel(move: string): string {
  const name = String((store.table("moves")[move] as { name?: string } | undefined)?.name ?? move.replace(/_/g, " "));
  return name.toLowerCase().replace(/(^|[\s-])(\S)/g, (_m, sep: string, c: string) => sep + c.toUpperCase());
}

const machineOf = (r: Rec | undefined) => r?.machine as { kind?: string; move?: string; number?: number } | undefined;

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

function isNewItem(id: string): boolean {
  return store.baseTable(spec()!.registry)[id] === undefined;
}

function itemEdited(id: string): boolean {
  const s = spec()!;
  return store.isRecordEdited(s.registry, id) || (!!s.ballRegistry && store.isRecordEdited(s.ballRegistry, id));
}

export function mountItemWorkspace(left: HTMLElement, center: HTMLElement, right: HTMLElement): void {
  let current: string | null = null;
  const newBtn = h("button", { class: "btn small", title: "Add an item, starting as a copy of one", onclick: () => createItem() }, "+ New");
  const list = mountRecordList(left, {
    title: "Items",
    folded: { label: "Used by the game", hint: "Not real items: elevator floor labels, Surf's hidden item and unused slots. Edit only if you know why." },
    head: [newBtn],
    placeholder: "Search items…  (Ctrl+P)",
    searchId: "items-search",
    items: () => {
      const s = spec();
      if (!s) return [];
      const all = items();
      return ordered().map((id) => {
        const r = all[id];
        const m = machineOf(r);
        return {
          id,
          label: String(r.name ?? id),
          meta: m?.move ? moveLabel(m.move) : r.keyItem ? "key" : r.effect ? "custom" : "",
          search: `${id} ${String(r.name ?? "")} ${m?.move ?? ""}`,
          edited: itemEdited(id),
          isNew: isNewItem(id),
          folded: !!s.internal(id),
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
    const sources = ordered().filter((id) => !s.special(id, all[id]) && !s.internal(id));
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
    } else if (reason === "content" && s && [s.registry, s.effectRegistry, s.ballRegistry, "text_pointers", "pokemon", "ai_classes", "moves"].includes(registry)) {
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
    h("div", { class: "kv" }, h("span", {}, "Id"), h("code", {}, id)),
    field("Name", name, `Up to ${s.nameMax} characters, as shown in the bag.`),
    h(
      "div",
      { class: "row three" },
      field("Price", numberInput(Number(r.price ?? 0), (v) => edit(id, "Item price", (d) => (d.price = Math.max(0, Math.min(s.maxPrice, v)))), 0, s.maxPrice), "Shops sell for this and buy back for half."),
    ),
    check("Key item", keyItem, (v) => edit(id, "Key item", (d) => (v ? (d.keyItem = true) : delete d.keyItem)), "Can't be sold or tossed; plays the key-item jingle when received."),
  );
  const internal = s.internal(id);
  const out = internal
    ? [h("section", { class: "card warn-card" }, h("h4", {}, "Used by the game"), h("p", { class: "hint" }, internal), h("p", { class: "hint" }, "Changing it can break what relies on it.")), basics]
    : [basics];
  // not a real item: no effect, catching or shops
  if (internal) return out;
  const machine = machineOf(r);
  if (machine?.move) out.push(machineCard(id, machine));
  out.push(effectCard(s, id, r));
  if (balls()[id] || effects()[String(r.effect ?? "")]?.steps.some((st) => st.act === "ball")) out.push(ballCard(s, id));
  out.push(martCard(s, id, r));
  return out;
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
    h("p", { class: "hint" }, "Which Pokémon can learn it is set per Pokémon (TM/HM list). HMs are never used up."),
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
  const effect = typeof r.effect === "string" ? r.effect : "";
  const all = effects();
  const fx = all[effect];
  const options = [...new Set([...Object.keys(all), ...(effect ? [effect] : [])])].sort();
  const sel = selectInput(effect, options, (v) => {
    store.group("Item effect", () => {
      edit(id, "Item effect", (d) => (v ? (d.effect = v) : delete d.effect));
      dropUnusedEffects();
    });
  }, s.special(id, r) || s.template(id, r) ? "Built-in" : "(none)");
  const card = h("section", { class: "card" }, h("h4", {}, "Effect"), field("Effect", sel, "Custom effects are built from blocks; one can be shared by several items."));

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
            const fxId = effectIdFor(id);
            const fresh: ItemEffectSpec = template ?? { target: "party", steps: [{ act: "heal", amount: 20 }] };
            store.group(`Custom effect for ${id}`, () => {
              store.setRecord(s.effectRegistry, fxId, "New custom item effect", fresh);
              edit(id, "Item effect", (d) => (d.effect = fxId));
            });
          },
        }, template ? "Customize this effect" : "Custom effect"),
        h("span", { class: "hint" }, template ? "Makes an editable copy for this item." : "Built from blocks: healing, cures, PP, vitamins, level up, evolution, X items, Repel, balls."),
      ),
    );
    return card;
  }

  // ---- the builder
  const editFx = (label: string, mutate: (d: ItemEffectSpec) => void) => {
    store.editRecord<ItemEffectSpec>(s.effectRegistry, effect, label, mutate);
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
  const where = selectInput(fx.where ?? "both", ["both", "battle", "field"], (v) => editFx("Where usable", (d) => (v === "both" ? delete d.where : (d.where = v as "battle" | "field"))));
  where.options[0].textContent = "In and out of battle";
  where.options[1].textContent = "Battle only";
  where.options[2].textContent = "Outside battle only";

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
    h("div", { class: "row three" }, field("Used on", target), field("Usable", where)),
    check("Never used up", fx.keep === true, (v) => editFx("Never used up", (d) => (v ? (d.keep = true) : delete d.keep)), "Stays in the bag after use, like a key item."),
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
  open: () => void;
}

function usesOf(id: string): Use[] {
  const out: Use[] = [];
  for (const [pid, m] of Object.entries(store.table("pokemon") as Record<string, Rec>)) {
    const evos = (m.evolutions as { method?: string; item?: string; species?: string }[] | undefined) ?? [];
    for (const e of evos) if (e.item === id) out.push({ label: `${String(m.name ?? pid)} → ${e.species ?? "?"}`, open: () => nav.openPokemon(pid) });
  }
  for (const [cls, a] of Object.entries(store.table("ai_classes") as Record<string, Rec>)) {
    if (a.item === id) out.push({ label: `Trainer AI: ${cls}`, open: () => nav.openTrainer(cls) });
  }
  const s = spec();
  for (const m of s?.marts(store.ctx) ?? []) if (martStock(m).includes(id)) out.push({ label: `Shop: ${m.label}`, open: () => (m.mapId ? nav.openMap(m.mapId) : undefined) });
  return out;
}

function usedBy(id: string): HTMLElement[] {
  const uses = usesOf(id);
  const out: HTMLElement[] = [];
  if (!uses.length) out.push(h("p", { class: "hint" }, "No evolution, trainer AI or shop uses this item."));
  for (const u of uses) out.push(h("button", { class: "use-row", onclick: u.open }, h("span", { class: "use-map" }, u.label)));
  return out;
}
