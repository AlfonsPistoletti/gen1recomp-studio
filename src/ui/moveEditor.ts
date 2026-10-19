// Moves workspace: every move (left), its stats (center), and who learns or
// uses it (right). Edits go to the "moves" registry; a move's battle
// animation can be another move's, written as a reference so no animation
// data is copied into the mod.

import { clone } from "../core/merge.ts";
import { store } from "../core/store.ts";
import type { EffectSpec, EffectStep, MoveSpec } from "../games/types.ts";
import { clear, field, h, numberInput, onFocusLeave, rerender, selectInput } from "./dom.ts";
import { nav } from "./nav.ts";
import { idRow } from "./renameId.ts";
import { promptNewRecord } from "./newRecord.ts";
import { mountRecordList } from "./recordList.ts";
import { sortMenu, type SortOption, type SortState } from "./sortMenu.ts";

type Rec = Record<string, unknown>;

function spec(): MoveSpec | undefined {
  return store.adapter?.moves;
}

function moves(): Record<string, Rec> {
  return store.table(spec()?.registry ?? "moves") as Record<string, Rec>;
}

function ordered(): string[] {
  const all = moves();
  return Object.keys(all).sort((a, b) => ((all[a].index as number) ?? 999) - ((all[b].index as number) ?? 999) || a.localeCompare(b));
}

// the list's sort choices (game order first: the default)
const SORTS: SortOption[] = [
  { id: "index", label: "Game order", group: "Order" },
  { id: "name", label: "Name", group: "Order" },
  { id: "type", label: "Type", group: "Order" },
  { id: "effect", label: "Effect", group: "Order" },
  { id: "power", label: "Power", group: "Numbers", desc: true },
  { id: "accuracy", label: "Accuracy", group: "Numbers", desc: true },
  { id: "pp", label: "PP", group: "Numbers", desc: true },
];

// move ids in the chosen order (ties: game order), and what the list's
// right column shows for each
function sortedMoves(sort: SortState): { ids: string[]; meta(id: string): string } {
  const all = moves();
  const base = ordered();
  const rank = new Map(base.map((id, i) => [id, i]));
  const typeMeta = (id: string) => String(all[id].type ?? "").replace("_TYPE", "");
  const num = (key: string) => (id: string) => Number(all[id][key]) || 0;
  let value: (id: string) => number | string = (id) => rank.get(id) ?? 9999;
  let meta = typeMeta;
  if (sort.id === "name") value = (id) => String(all[id].name ?? id);
  else if (sort.id === "type") value = typeMeta;
  else if (sort.id === "effect") {
    value = (id) => String(all[id].effect ?? "");
    meta = (id) => String(all[id].effect ?? "").replace(/^EFFECT_/, "").toLowerCase();
  } else if (sort.id === "power" || sort.id === "accuracy" || sort.id === "pp") {
    value = num(sort.id);
    meta = (id) => String(num(sort.id)(id));
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

// the move whose animation a move plays: its own, or the one it references
function animOf(id: string): string {
  const reg = spec()?.animRegistry;
  const ref = reg ? (store.table(reg)[id] as { __ref?: string } | undefined)?.__ref : undefined;
  return ref ? ref.split(":").slice(1).join(":") : id;
}

export function mountMoveWorkspace(left: HTMLElement, center: HTMLElement, right: HTMLElement): void {
  let current: string | null = null;
  const newBtn = h("button", { class: "btn small", title: "Add a move, starting as a copy of one", onclick: () => createMove() }, "+ New");
  const sort = sortMenu("moves", () => SORTS, () => list.render());
  const list = mountRecordList(left, {
    title: "Moves",
    head: [newBtn, sort.el],
    placeholder: "Search moves…  (Ctrl+F)",
    searchId: "moves-search",
    items: () => {
      const s = spec();
      if (!s) return [];
      const all = moves();
      const { ids, meta } = sortedMoves(sort.state());
      return ids.map((id) => ({
        id,
        label: String(all[id].name ?? id),
        meta: meta(id),
        search: `${id} ${String(all[id].type ?? "")} ${String(all[id].effect ?? "")}`,
        edited: store.isRecordEdited(s.registry, id) || (!!s.animRegistry && store.isRecordEdited(s.animRegistry, id)) || (!!s.animTable && animTableEdited(s.animTable, id)),
        isNew: store.baseTable(s.registry)[id] === undefined,
      }));
    },
    current: () => current,
    pick: (id) => open(id),
    refreshOn: (reason, _id, registry) => reason === "content" && (registry === spec()?.registry || registry === spec()?.animRegistry),
  });

  const main = h("div", { class: "ws-scroll" });
  const side = h("div", { class: "ws-scroll" });
  const title = h("span", { class: "head-title" }, "Moves");
  const revert = h("button", {
    class: "btn small danger",
    onclick: () => {
      const s = spec();
      if (!current || !s) return;
      const id = current;
      if (store.baseTable(s.registry)[id] === undefined) return deleteMove(id);
      store.group(`Revert ${id}`, () => {
        store.revertRecord(s.registry, id);
        if (s.animRegistry) store.revertRecord(s.animRegistry, id);
        if (s.animTable && animTableEdited(s.animTable, id)) {
          const t = s.animTable;
          const base = (store.baseTable(t.registry)[t.id] ?? {}) as Record<string, unknown>;
          store.editRecord<Record<string, unknown>>(t.registry, t.id, `Revert ${id}`, (d) => (d[id] = base[id]));
        }
        dropUnusedEffects();
      });
    },
  }, "Revert to base");
  center.append(h("div", { class: "panel-head" }, title, revert), main);
  right.append(h("div", { class: "panel-head" }, h("span", {}, "Used by")), side);

  const open = (id: string) => {
    if (!moves()[id]) return;
    current = id;
    list.render();
    render(true);
    left.querySelector<HTMLElement>(`.map-row[data-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
  };
  nav.openMove = (id) => {
    nav.setWorkspace("moves");
    open(id);
  };

  // a copy of an existing move, with its animation by reference
  const createMove = async () => {
    const s = spec();
    if (!s) return;
    const all = moves();
    const res = await promptNewRecord({
      title: "New move",
      idPrefix: "",
      nameMax: s.nameMax,
      taken: (id) => all[id] !== undefined,
      sources: ordered().map((id) => ({ id, label: String(all[id].name ?? id) })),
      source: current ?? ordered()[0],
    });
    if (!res) return;
    const rec = clone(all[res.source]) as Rec;
    rec.id = res.id;
    rec.name = res.name;
    delete rec.index;
    delete rec.source;
    store.group(`New move ${res.id}`, () => {
      store.setRecord(s.registry, res.id, `New move ${res.id}`, rec);
      if (s.animRegistry) store.setRecord(s.animRegistry, res.id, "Move animation", { __ref: `${s.animRegistry}:${animOf(res.source)}` });
      for (const x of s.moveExtras?.(res.source, res.id, store.ctx) ?? []) store.setRecord(x.registry, x.id, `New move ${res.id}`, x.value);
    });
    open(res.id);
  };

  const deleteMove = (id: string) => {
    const s = spec()!;
    const uses = usesOf(id);
    if (!confirm(`${uses.length ? `${id} is still used by ${uses.slice(0, 10).map((u) => u.label).join(", ")}${uses.length > 10 ? " …" : ""}.\n\n` : ""}Delete ${id}?`)) return;
    store.group(`Delete ${id}`, () => {
      store.setRecord(s.registry, id, `Delete ${id}`, undefined);
      if (s.animRegistry) store.setRecord(s.animRegistry, id, "Delete move animation", undefined);
      for (const x of s.dropMoveExtras?.(id, store.ctx) ?? []) store.setRecord(x.registry, x.id, `Delete ${id}`, x.value);
      dropUnusedEffects();
    });
    current = ordered()[0] ?? null;
    list.render();
    render(true);
  };

  const render = (force = false) => {
    const s = spec();
    const r = current ? moves()[current] : undefined;
    if (!s || !r || !current) {
      clear(main);
      clear(side);
      main.append(h("p", { class: "hint empty" }, s ? "Pick a move on the left." : "This game has no move editor yet."));
      return;
    }
    const id = current;
    title.textContent = String(r.name ?? id);
    newBtn.hidden = s.newMoves === false;
    const isNew = store.baseTable(s.registry)[id] === undefined;
    revert.textContent = isNew ? "Delete move" : "Revert to base";
    revert.hidden = !isNew && !(store.isRecordEdited(s.registry, id) || (!!s.animRegistry && store.isRecordEdited(s.animRegistry, id)) || (!!s.animTable && animTableEdited(s.animTable, id)));
    if (force) {
      clear(main);
      clear(side);
    }
    rerender(main, () => moveForm(s, id, r));
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
      if (!current || !moves()[current]) current = ordered()[0] ?? null;
      render(true);
    } else if (reason === "content" && s && (registry === s.registry || registry === s.animRegistry || registry === s.animTable?.registry || registry === s.custom?.registry || registry === "pokemon" || registry === "trainers" || registry === "type_chart")) {
      schedule();
    } else if (reason === "reveal" && s && (registry === s.registry || registry === s.animRegistry) && id) {
      nav.openMove(id);
    }
  });
}

// ------------------------------------------------------------------ form

function edit(id: string, label: string, mutate: (r: Rec) => void): void {
  store.editRecord<Rec>(spec()!.registry, id, label, mutate);
  store.seal();
}

// custom effects no move points at any more are dropped (call inside a
// group), like the Items workspace does with item effects
function dropUnusedEffects(): void {
  const custom = spec()?.custom;
  if (!custom) return;
  const used = new Set(Object.values(moves()).map((m) => m.effect));
  for (const fx of Object.keys(store.table(custom.registry))) if (!used.has(fx)) store.setRecord(custom.registry, fx, "Remove unused custom effect", undefined);
}

function moveForm(s: MoveSpec, id: string, r: Rec): HTMLElement[] {
  const types = store.adapter.pokemon?.typeNames(store.ctx) ?? [];
  const name = h("input", { type: "text", value: String(r.name ?? ""), maxLength: s.nameMax, spellcheck: false });
  name.addEventListener("change", () => edit(id, "Move name", (d) => (d.name = name.value.trim().toUpperCase() || id)));
  const num = (key: string, label: string, min: number, max: number, hint: string) =>
    field(label, numberInput(r[key] as number | undefined, (v) => edit(id, label, (d) => setNum(s, d, key, Math.max(min, Math.min(max, v)))), min, max), hint);
  const details = s.battleDetails !== false;

  const power = Number(r.power ?? 0);
  const category = typeof r.category === "string" ? r.category : "";
  const typeCategory = (store.table("type_chart")[String(r.type)] as { category?: string } | undefined)?.category;
  const highCrit = h("input", { type: "checkbox", checked: r.highCrit === true });
  highCrit.addEventListener("change", () => edit(id, "High critical-hit ratio", (d) => (highCrit.checked ? (d.highCrit = true) : delete d.highCrit)));

  const basics = h(
    "section",
    { class: "card" },
    h("h4", {}, "Move"),
    idRow(s.registry, id, String(r.name ?? ""), (to) => nav.openMove(to)),
    field("Name", name, `Up to ${s.nameMax} characters, as shown in battle.`),
    h(
      "div",
      { class: "row three" },
      field("Type", selectInput(String(r.type ?? ""), types, (v) => edit(id, "Move type", (d) => (d.type = v)))),
      num("power", "Power", 0, 255, power ? "Base damage." : "0 = no damage (status move)."),
      num("accuracy", "Accuracy %", 0, 100, "Chance to hit."),
    ),
    h(
      "div",
      { class: "row three" },
      num("pp", "PP", 1, s.maxPp, "Uses before it runs out."),
      details
        ? field(
            "Priority",
            numberInput(Number(r.priority ?? 0), (v) => edit(id, "Priority", (d) => (v ? (d.priority = Math.max(-7, Math.min(7, v))) : delete d.priority)), -7, 7),
            "Higher goes first; 0 = normal.",
          )
        : null,
    ),
    s.description ? descriptionField(s, id, r) : null,
  );

  const extras = h(
    "section",
    { class: "card" },
    h("h4", {}, "Battle details"),
    field(
      "Damage category",
      selectInput(category, s.categories, (v) => edit(id, "Damage category", (d) => (v ? (d.category = v) : delete d.category)), `From its type (${typeCategory ?? "?"})`),
      "Gen 1 decides physical/special by type; set this only to override it for this move.",
    ),
    h("label", { class: "ai-layer" }, highCrit, h("span", {}, h("strong", {}, "High critical-hit ratio"), h("span", { class: "hint" }, "Crits much more often, like Slash or Karate Chop."))),
  );

  const out = [basics, effectCard(s, id, r), ...(details ? [extras] : [])];
  if (s.animTable) out.push(animTableCard(s.animTable, s.registry, id));
  if (s.animRegistry) {
    const reg = s.animRegistry;
    const ref = (store.table(reg)[id] as { __ref?: string } | undefined)?.__ref;
    const isNew = store.baseTable(s.registry)[id] === undefined;
    const current = ref ? ref.split(":").slice(1).join(":") : isNew ? "" : id;
    const all = moves();
    const sel = selectInput(
      current,
      ordered().filter((m) => store.baseTable(s.registry)[m] !== undefined),
      (v) => {
        // a vanilla move playing its own animation needs no entry
        store.setRecord(reg, id, "Move animation", !v || (!isNew && v === id) ? undefined : { __ref: `${reg}:${v}` });
        store.seal();
      },
      isNew ? "(none)" : undefined,
    );
    for (const o of sel.options) if (o.value) o.textContent = String(all[o.value]?.name ?? o.value) + (o.value === id ? " (its own)" : "");
    out.push(
      h(
        "section",
        { class: "card" },
        h("h4", {}, "Battle animation"),
        field("Plays the animation of", sel, "Read from the player's game when the mod loads, so no animation data is copied into the mod."),
      ),
    );
  }
  return out;
}

// a number, and its 0-255 byte twin when the record has one (MoveSpec.rawBytes)
function setNum(s: MoveSpec, d: Rec, key: string, v: number): void {
  d[key] = v;
  const raw = s.rawBytes?.[key];
  if (raw && raw in d) d[raw] = Math.floor((v * 255) / 100);
}

// the move screen's text: one input per line, stored joined with <NEXT>
function descriptionField(s: MoveSpec, id: string, r: Rec): HTMLElement {
  const spec = s.description!;
  const lines = String(r.description ?? "").split("<NEXT>");
  const inputs = Array.from({ length: spec.lines }, (_, i) => {
    const input = h("input", { type: "text", value: lines[i] ?? "", maxLength: spec.lineMax, spellcheck: false, class: "mono" });
    input.addEventListener("change", () =>
      edit(id, "Move description", (d) => {
        const next = inputs.map((x) => x.value);
        while (next.length > 1 && !next[next.length - 1]) next.pop();
        d.description = next.join("<NEXT>");
      }));
    return input;
  });
  return field("Description", h("div", { class: "desc-lines" }, ...inputs), `${spec.lines} lines of up to ${spec.lineMax} characters, shown on the move screen.`);
}

// ------------------------------------------------------------------ effect

const pct = (chance: number | undefined): number => (chance === undefined || chance >= 256 ? 100 : Math.round((chance / 256) * 100));
const fromPct = (p: number): number | undefined => (p >= 100 ? undefined : Math.max(1, Math.round((p / 100) * 256)));
const STAT_LABEL: Record<string, string> = { attack: "Attack", defense: "Defense", speed: "Speed", special: "Special", accuracy: "accuracy", evasion: "evasion" };

// "30%: lowers the target's Defense by 1" etc.
export function describeEffect(spec: EffectSpec, statuses: { id: string; label: string }[]): string {
  const parts: string[] = [];
  if (spec.kind === "damaging") {
    if (spec.hits === "2-5") parts.push("hits 2-5 times");
    else if (typeof spec.hits === "number" && spec.hits > 1) parts.push(`hits ${spec.hits} times`);
    if (spec.damage === "level") parts.push("damage = the user's level");
    else if (typeof spec.damage === "object") parts.push(`always ${spec.damage.fixed} damage`);
    if (spec.neverMiss) parts.push("never misses");
    if (spec.recoil) parts.push(`${spec.recoil}% recoil`);
    if (spec.drain) parts.push(`heals ${spec.drain}% of the damage`);
  } else if (spec.canMiss === false) parts.push("never misses");
  for (const st of spec.steps) {
    const who = st.who === "user" ? "the user" : "the target";
    const chance = pct(st.chance) < 100 ? `${pct(st.chance)}%: ` : "";
    const what =
      st.act === "stage"
        ? `${(st.delta ?? 0) > 0 ? "raises" : "lowers"} ${who}'s ${STAT_LABEL[st.stat ?? ""] ?? st.stat} by ${Math.abs(st.delta ?? 0)}`
        : st.act === "status"
          ? `${(statuses.find((x) => x.id === st.status)?.label ?? st.status ?? "").toLowerCase()} on ${who}`
          : st.act === "confuse"
            ? `confuses ${who}`
            : st.act === "flinch"
              ? "the target flinches"
              : `heals ${who} by ${st.percent ?? 50}% of max HP`;
    parts.push(chance + what);
  }
  return parts.length ? parts.join("; ") + "." : spec.kind === "damaging" ? "Plain damage." : "Does nothing yet: add a step.";
}

// The move's effect: a built-in one (with what it does), or a custom one
// built from blocks.
function effectCard(s: MoveSpec, id: string, r: Rec): HTMLElement {
  const effect = String(r.effect ?? "");
  const custom = s.custom;
  const specs = custom ? (store.table(custom.registry) as Record<string, EffectSpec>) : {};
  const spec = specs[effect];
  const sel = selectInput(effect, s.effects(store.ctx), (v) =>
    store.group("Move effect", () => {
      edit(id, "Move effect", (d) => (d.effect = v));
      dropUnusedEffects();
    }));
  // each option says what the effect does, faint on the right (a customizable
  // select, styles.css .effect-select; the closed box shows the name only)
  const hintOf = (e: string) => custom?.describe(e) || (specs[e] && custom ? describeEffect(specs[e], custom.statuses) : "");
  sel.classList.add("effect-select");
  sel.prepend(h("button", {}, document.createElement("selectedcontent")));
  for (const o of sel.options) {
    const hint = o.value ? hintOf(o.value) : "";
    o.title = hint;
    if (hint) o.append(h("span", { class: "effect-hint" }, hint));
  }
  const card = h("section", { class: "card" }, h("h4", {}, "Effect"), field("Effect", sel));
  if (s.effectChance) {
    card.append(
      field(
        "Effect chance %",
        numberInput(Number(r.effectChance ?? 0), (v) => edit(id, "Effect chance", (d) => setNum(s, d, "effectChance", Math.max(0, Math.min(100, v)))), 0, 100),
        "How often the side effect happens (a burn, a stat drop, flinching); 0 for effects that always happen.",
      ),
    );
  }
  if (!custom) return card;

  if (!spec) {
    const template = custom.template(effect);
    card.append(
      h("p", { class: "hint" }, custom.describe(effect) || "Built into the game."),
      h(
        "div",
        { class: "row" },
        h("button", {
          class: "btn small primary-ish",
          title: template ? "Start a custom effect with the same behaviour, ready to tweak" : "Start a custom effect from scratch",
          onclick: () => {
            const fxId = `STUDIO_${id}`.replace(/[^A-Z0-9_]/g, "_");
            const fresh: EffectSpec = template ?? { kind: Number(r.power ?? 0) > 0 ? "damaging" : "status", canMiss: true, steps: [] };
            store.group(`Custom effect for ${id}`, () => {
              if (!specs[fxId]) store.setRecord(custom.registry, fxId, "New custom effect", fresh);
              edit(id, "Move effect", (d) => (d.effect = fxId));
            });
          },
        }, template ? "Customize this effect" : "Custom effect"),
        h("span", { class: "hint" }, template ? "Makes an editable copy for this move." : "Built from blocks: stat changes, statuses, confusion, flinch, healing, hits, recoil, drain."),
      ),
    );
    return card;
  }

  // ---- the builder
  const editSpec = (label: string, mutate: (d: EffectSpec) => void) => {
    store.editRecord<EffectSpec>(custom.registry, effect, label, mutate);
    store.seal();
  };
  const users = Object.entries(moves()).filter(([, m]) => m.effect === effect).map(([m]) => m);
  const power = Number(r.power ?? 0);
  const kindSel = h("select", {}, h("option", { value: "status", selected: spec.kind === "status" }, "Status move (no damage)"), h("option", { value: "damaging", selected: spec.kind === "damaging" }, "Damaging move"));
  kindSel.addEventListener("change", () => editSpec("Effect kind", (d) => (d.kind = kindSel.value as EffectSpec["kind"])));
  const mismatch = (spec.kind === "status") !== (power === 0);

  const check = (label: string, on: boolean, set: (d: EffectSpec, v: boolean) => void, hint: string) => {
    const box = h("input", { type: "checkbox", checked: on });
    box.addEventListener("change", () => editSpec(label, (d) => set(d, box.checked)));
    return h("label", { class: "ai-layer" }, box, h("span", {}, h("strong", {}, label), h("span", { class: "hint" }, hint)));
  };

  // Gen 2: a damaging effect is one status, rolled with the move's effect chance
  const onlyStatus = !!custom.secondaryOnly && spec.kind === "damaging";
  const options: HTMLElement[] = [];
  if (onlyStatus) {
    options.push(h("p", { class: "hint" }, "In this game a damaging move's own effect can add one status (or confusion) after the hit, rolled with the move's Effect chance above. Hits, fixed damage, recoil, drain and stat changes on a hit are fixed in the game's code."));
  } else if (spec.kind === "status") {
    options.push(check("Can miss", spec.canMiss !== false, (d, v) => (v ? delete d.canMiss : (d.canMiss = false)), "Rolls the move's accuracy when it targets the foe."));
  } else {
    const hits = h("select", {}, ...["1", "2", "3", "4", "5", "2-5"].map((v) => h("option", { value: v, selected: String(spec.hits ?? 1) === v }, v === "1" ? "Once" : v === "2-5" ? "2 to 5 times" : `${v} times`)));
    hits.addEventListener("change", () => editSpec("Hits", (d) => (hits.value === "1" ? delete d.hits : (d.hits = hits.value === "2-5" ? "2-5" : Number(hits.value)))));
    const dmgKind = typeof spec.damage === "object" ? "fixed" : spec.damage ?? "normal";
    const dmg = h("select", {}, h("option", { value: "normal", selected: dmgKind === "normal" }, "Normal (power formula)"), h("option", { value: "fixed", selected: dmgKind === "fixed" }, "Fixed amount"), h("option", { value: "level", selected: dmgKind === "level" }, "The user's level"));
    dmg.addEventListener("change", () => editSpec("Damage", (d) => (dmg.value === "normal" ? delete d.damage : (d.damage = dmg.value === "level" ? "level" : { fixed: 40 }))));
    const fixed = typeof spec.damage === "object" ? numberInput(spec.damage.fixed, (v) => editSpec("Fixed damage", (d) => (d.damage = { fixed: Math.max(1, Math.min(999, v)) })), 1, 999) : null;
    const percent = (key: "recoil" | "drain", label: string, hint: string) =>
      field(label, numberInput(spec[key] ?? 0, (v) => editSpec(label, (d) => (v > 0 ? (d[key] = Math.min(100, v)) : delete d[key])), 0, 100), hint);
    options.push(
      h("div", { class: "row three" }, field("Hits", hits), field("Damage", dmg), fixed ? field("Amount", fixed) : h("span", {})),
      h("div", { class: "row three" }, percent("recoil", "Recoil %", "Of the damage dealt, to the user."), percent("drain", "Drain %", "Of the damage dealt, healed."), h("span", {})),
      check("Never misses", !!spec.neverMiss, (d, v) => (v ? (d.neverMiss = true) : delete d.neverMiss), "Ignores accuracy and evasion, like Swift."),
    );
  }

  const acts: { id: EffectStep["act"]; label: string }[] = onlyStatus
    ? [{ id: "status", label: "Status" }, { id: "confuse", label: "Confuse" }]
    : [
        { id: "stage", label: "Stat change" },
        { id: "status", label: "Status" },
        { id: "confuse", label: "Confuse" },
        ...(spec.kind === "damaging" ? [{ id: "flinch" as const, label: "Flinch" }] : []),
        { id: "heal", label: "Heal" },
      ];
  const editStep = (i: number, label: string, mutate: (st: EffectStep) => void) =>
    editSpec(label, (d) => {
      d.steps = d.steps.map((x, j) => (j === i ? { ...x } : x));
      mutate(d.steps[i]);
    });
  const stepRows = spec.steps.map((st, i) => {
    const chance = numberInput(pct(st.chance), (v) => editStep(i, "Step chance", (x) => {
      const c = fromPct(Math.max(1, Math.min(100, v)));
      if (c === undefined) delete x.chance;
      else x.chance = c;
    }), 1, 100);
    chance.title = "Chance in %, stored out of 256 like the game";
    const act = h("select", {}, ...acts.map((a) => h("option", { value: a.id, selected: a.id === st.act }, a.label)));
    act.addEventListener("change", () => editStep(i, "Step action", (x) => {
      const keep = { act: act.value as EffectStep["act"], ...(x.chance ? { chance: x.chance } : {}) };
      for (const k of Object.keys(x)) delete (x as unknown as Record<string, unknown>)[k];
      Object.assign(x, keep, defaults(keep.act, spec.kind, custom.statuses));
    }));
    const who = st.act === "flinch" ? h("span", { class: "muted" }, "target") : selectInput(st.who ?? "target", ["target", "user"], (v) => editStep(i, "Step target", (x) => (x.who = v as "user" | "target")));
    const value: HTMLElement[] = [];
    if (st.act === "stage") {
      value.push(
        selectInput(st.stat ?? "attack", custom.stats, (v) => editStep(i, "Step stat", (x) => (x.stat = v))),
        selectInput(String(st.delta ?? 1), ["-2", "-1", "1", "2"], (v) => editStep(i, "Step amount", (x) => (x.delta = Number(v)))),
      );
    } else if (st.act === "status") {
      const ss = selectInput(st.status ?? "PAR", custom.statuses.map((x) => x.id), (v) => editStep(i, "Step status", (x) => (x.status = v)));
      for (const o of ss.options) o.textContent = custom.statuses.find((x) => x.id === o.value)?.label ?? o.value;
      value.push(ss);
    } else if (st.act === "heal") {
      value.push(numberInput(st.percent ?? 50, (v) => editStep(i, "Heal %", (x) => (x.percent = Math.max(1, Math.min(100, v)))), 1, 100), h("span", { class: "muted" }, "% of max HP"));
    }
    return h(
      "div",
      { class: "step-row" },
      // Gen 2 damaging: the move's Effect chance is the roll
      onlyStatus ? h("span", { class: "step-chance muted" }, "chance") : h("span", { class: "step-chance" }, chance, h("span", { class: "muted" }, "%")),
      act,
      who,
      h("div", { class: "row nowrap" }, ...value),
      h("button", { class: "btn small ghost", title: "Remove step", onclick: () => editSpec("Remove step", (d) => (d.steps = d.steps.filter((_, j) => j !== i))) }, "✕"),
    );
  });

  card.append(
    h("p", { class: "effect-summary" }, describeEffect(spec, custom.statuses)),
    field("Kind", kindSel, mismatch ? (power === 0 ? "This move has 0 power: a damaging effect needs power." : "This move does damage: a status effect only runs for 0-power moves.") : undefined),
    ...options,
    h("h4", {}, spec.kind === "status" ? "Steps" : "Side effects (after damage)"),
    ...stepRows,
    h(
      "div",
      { class: "row" },
      // Gen 2 damaging: one status only
      onlyStatus && spec.steps.length >= 1 ? null : h("button", { class: "btn small", onclick: () => editSpec("Add step", (d) => (d.steps = [...d.steps, onlyStatus ? { act: "status", who: "target", status: custom.statuses[0].id } : { act: "stage", ...defaults("stage", spec.kind, custom.statuses) }])) }, "+ Step"),
      users.length > 1 ? h("span", { class: "hint" }, `Shared by ${users.length} moves: ${users.join(", ")}.`) : null,
    ),
  );
  if (mismatch) card.querySelector(".field:last-of-type .hint")?.classList.add("warn");
  return card;
}

// sensible values for a new step of an action
// (`statuses`: the game's; paralysis when it has one by that id, else the first)
function defaults(act: EffectStep["act"], kind: EffectSpec["kind"], statuses: { id: string }[]): Partial<EffectStep> {
  const side = kind === "damaging";
  switch (act) {
    case "stage":
      return side ? { who: "target", stat: "defense", delta: -1, chance: 85 } : { who: "target", stat: "attack", delta: -1 };
    case "status":
      return { who: "target", status: statuses.some((x) => x.id === "PAR") ? "PAR" : statuses[0]?.id, ...(side ? { chance: 77 } : {}) };
    case "confuse":
      return { who: "target", ...(side ? { chance: 26 } : {}) };
    case "flinch":
      return { chance: 77 };
    case "heal":
      return { who: "user", percent: 50 };
  }
}

// ------------------------------------------------------------------ used by

interface Use {
  label: string;
  open: () => void;
}

function usesOf(id: string): Use[] {
  const out: Use[] = [];
  const k = store.adapter.pokemon?.keys;
  const lvKey = k?.levelMoves ?? "learnset";
  const startKey = k?.startMoves === undefined ? "level1Moves" : k.startMoves;
  for (const [pid, m] of Object.entries(store.table("pokemon") as Record<string, Rec>)) {
    const how: string[] = [];
    if (startKey && (m[startKey] as string[] | undefined)?.includes(id)) how.push("at start");
    const lv = (m[lvKey] as { level: number; move: string }[] | undefined)?.filter((e) => e.move === id).map((e) => `Lv ${e.level}`) ?? [];
    how.push(...lv);
    if ((m.eggMoves as string[] | undefined)?.includes(id)) how.push("egg move");
    if ((m.tmhm as string[] | undefined)?.includes(id)) how.push("TM/HM");
    if (how.length) out.push({ label: `${String(m.name ?? pid)} (${how.join(", ")})`, open: () => nav.openPokemon(pid) });
  }
  for (const [tid, t] of Object.entries(store.table("trainers") as Record<string, Rec>)) {
    // TrainerSpec.teams (Gen 2: the class's trainers), else Gen 1's parties
    const teams = (store.adapter.trainers?.teams?.read(t) ?? (t.parties as { moves?: string[] }[][] | undefined)) ?? [];
    teams.forEach((party, p) => {
      if (party.some((m) => m.moves?.includes(id))) out.push({ label: `${String(t.name ?? tid)} team ${p + 1}`, open: () => nav.openTrainer(tid, p + 1) });
    });
  }
  return out;
}

function usedBy(id: string): HTMLElement[] {
  const uses = usesOf(id);
  // Gen 1 items carry machine.move, Gen 2's `teaches`
  const machine = Object.values(store.table("items") as Record<string, { name?: string; machine?: { move?: string }; teaches?: string }>).find((i) => i.machine?.move === id || i.teaches === id);
  const out: HTMLElement[] = [];
  if (machine) out.push(h("p", { class: "hint" }, `Taught by ${machine.name}.`));
  if (!uses.length) out.push(h("p", { class: "hint" }, "No Pokémon learns this move and no trainer uses it."));
  for (const u of uses) out.push(h("button", { class: "use-row", onclick: u.open }, h("span", { class: "use-map" }, u.label)));
  return out;
}

// Gen 2: this move's entry differs from the game's
function animTableEdited(t: { registry: string; id: string }, id: string): boolean {
  const table = (store.table(t.registry)[t.id] ?? {}) as Record<string, unknown>;
  const base = (store.baseTable(t.registry)[t.id] ?? {}) as Record<string, unknown>;
  return base[id] !== undefined && table[id] !== base[id];
}

// Gen 2: one record maps every move to its animation; this move plays the
// animation of the game move whose value it holds
function animTableCard(t: { registry: string; id: string }, registry: string, id: string): HTMLElement {
  const table = (store.table(t.registry)[t.id] ?? {}) as Record<string, unknown>;
  const base = (store.baseTable(t.registry)[t.id] ?? {}) as Record<string, unknown>;
  const all = moves();
  const gameMoves = ordered().filter((m) => store.baseTable(registry)[m] !== undefined && base[m] !== undefined);
  const value = table[id];
  const current = base[id] !== undefined && base[id] === value ? id : (gameMoves.find((m) => base[m] === value) ?? "");
  const sel = selectInput(current, gameMoves, (v) => {
    store.editRecord<Record<string, unknown>>(t.registry, t.id, "Move animation", (d) => {
      if (v) d[id] = base[v];
      else delete d[id];
    });
    store.seal();
  }, base[id] === undefined ? "(none)" : undefined);
  for (const o of sel.options) if (o.value) o.textContent = String(all[o.value]?.name ?? o.value) + (o.value === id ? " (its own)" : "");
  return h("section", { class: "card" },
    h("h4", {}, "Battle animation"),
    field("Plays the animation of", sel, "The game's own animation of that move: no animation data is copied into the mod."),
    base[id] !== undefined && value !== base[id]
      ? h("button", { class: "btn small danger", onclick: () => (store.editRecord<Record<string, unknown>>(t.registry, t.id, "Move animation: the game's", (d) => (d[id] = base[id])), store.seal()) }, "Back to the game's animation")
      : null,
  );
}
