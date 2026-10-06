// Global workspace: game-wide settings the engine reads (slot chances, type
// chart, level cap, walking speed, ...). Sections on the left, the section's
// editor in the middle, everything that differs from vanilla on the right.
// Only settings the adapter lists appear, and each has the engine's default,
// so a value set back to vanilla is dropped instead of saved.

import { deepEqual } from "../core/merge.ts";
import { store } from "../core/store.ts";
import type { GlobalNumber, GlobalsSpec } from "../games/types.ts";
import { clear, field, h, numberInput, onFocusLeave, rerender, toast } from "./dom.ts";
import { chancesCard } from "./encounterPanel.ts";
import { nav } from "./nav.ts";
import { counterLabel, counters, prizeCounterEditor, showCounter } from "./prizeEditor.ts";
import { recall, remember } from "./storage.ts";
import { rodsCard } from "./fishingPanel.ts";
import { tradeCards, tradesEdited, TRADES_ID, TRADES_REGISTRY } from "./tradeEditor.ts";

const SECTION_KEY = "studio.globalSection";
// the status screen's TYPE field fits 8 letters (ELECTRIC)
const TYPE_NAME_MAX = 8;

function spec(): GlobalsSpec | undefined {
  return store.adapter?.globals;
}

// the value the game uses: the record if set, else the engine default
function current(registry: string, id: string): unknown {
  const v = store.table(registry)[id];
  return v !== undefined ? v : spec()?.defaults[registry]?.[id];
}

// Stores `value`, or drops the record when it is the engine default and the
// base data does not carry the key either.
function write(registry: string, id: string, label: string, value: unknown): void {
  const def = spec()?.defaults[registry]?.[id];
  const inBase = store.baseTable(registry)[id] !== undefined;
  store.setRecord(registry, id, label, !inBase && def !== undefined && deepEqual(value, def) ? undefined : value);
  store.seal();
}

function numberValue(n: GlobalNumber): number {
  const v = current(n.registry, n.id);
  if (n.key) return Number((v as Record<string, unknown> | undefined)?.[n.key] ?? 0);
  return Number(v ?? 0);
}

function setNumber(n: GlobalNumber, value: number): void {
  const v = Math.max(n.min, Math.min(n.max, Math.trunc(value)));
  if (!n.key) return write(n.registry, n.id, n.label, v);
  const def = (spec()?.defaults[n.registry]?.[n.id] ?? {}) as Record<string, unknown>;
  const now = (current(n.registry, n.id) ?? {}) as Record<string, unknown>;
  // override replaces the whole table: always write every key
  write(n.registry, n.id, n.label, { ...def, ...now, [n.key]: v });
}

// the Global section a record is edited in, or null
export function globalSectionOf(registry: string, id: string): string | null {
  const s = spec();
  if (!s) return null;
  if (registry === s.typeChart?.registry) return "types";
  if (registry === store.adapter.towns?.prizeRegistry) return "prizes";
  if (registry === TRADES_REGISTRY && id === TRADES_ID && s.sections.some((x) => x.id === "trades")) return "trades";
  if (registry === "field" && id === "fishing") return "wild";
  if (registry === "field" && id === "presetNames") return "names";
  const odds = store.adapter.encounters?.sharedOdds;
  if (odds && registry === odds.registry && id === odds.id) return "wild";
  if (s.hmBadges && registry === s.hmBadges.registry && id === s.hmBadges.id) return "fieldmoves";
  return s.numbers.find((n) => n.registry === registry && n.id === id)?.section ?? null;
}

// a readable name for a global setting record ("Level cap"), or null
export function globalLabelOf(registry: string, id: string): string | null {
  const s = spec();
  const section = globalSectionOf(registry, id);
  if (!s || !section) return null;
  if (section === "types") return null;
  if (section === "prizes") return counterLabel(id);
  if (section === "trades") return "In-game trades";
  if (registry === "field" && id === "fishing") return "Old Rod and Good Rod";
  if (registry === "field" && id === "presetNames") return "Preset names";
  if (section === "wild") return "Wild slot chances";
  if (section === "fieldmoves") return "HM badges";
  const labels = s.numbers.filter((n) => n.registry === registry && n.id === id).map((n) => n.label);
  return labels.length === 1 ? labels[0] : (s.sections.find((x) => x.id === section)?.label ?? null);
}

// whether a section holds anything that differs from the base
function sectionChanged(id: string): boolean {
  const s = spec();
  if (!s) return false;
  const regs: [string, string][] = [];
  for (const n of s.numbers) if (n.section === id) regs.push([n.registry, n.id]);
  if (id === "fieldmoves" && s.hmBadges) regs.push([s.hmBadges.registry, s.hmBadges.id]);
  const odds = store.adapter.encounters?.sharedOdds;
  if (id === "wild" && odds) regs.push([odds.registry, odds.id]);
  if (regs.some(([r, i]) => store.isRecordEdited(r, i))) return true;
  if (id === "trades" && tradesEdited()) return true;
  if (id === "names" && store.isRecordEdited("field", "presetNames")) return true;
  if (id === "wild" && store.isRecordEdited("field", "fishing")) return true;
  const towns = store.adapter.towns;
  if (id === "prizes" && towns) {
    const reg = towns.prizeRegistry;
    for (const i of new Set([...Object.keys(store.table(reg)), ...Object.keys(store.baseTable(reg))])) if (store.isRecordEdited(reg, i)) return true;
  }
  if (id === "types" && s.typeChart) {
    const reg = s.typeChart.registry;
    const ids = new Set([...Object.keys(store.table(reg)), ...Object.keys(store.baseTable(reg))]);
    for (const i of ids) if (store.isRecordEdited(reg, i)) return true;
  }
  return false;
}

export function mountGlobalWorkspace(left: HTMLElement, center: HTMLElement, right: HTMLElement): void {
  let section = recall(SECTION_KEY) ?? "wild";
  const list = h("div", { class: "map-list" });
  left.append(h("div", { class: "panel-head" }, h("span", {}, "Global")), list);
  const title = h("span", { class: "head-title" }, "");
  const main = h("div", { class: "ws-scroll" });
  center.append(h("div", { class: "panel-head" }, title), main);
  const side = h("div", { class: "ws-scroll" });
  right.append(h("div", { class: "panel-head" }, h("span", {}, "Changed")), side);

  const renderList = () => {
    clear(list);
    for (const s of spec()?.sections ?? []) {
      list.append(
        h(
          "button",
          { class: `map-row${s.id === section ? " active" : ""}`, onclick: () => open(s.id), title: s.hint },
          h("span", { class: "map-name" }, s.label),
          sectionChanged(s.id) ? h("span", { class: "tag edited" }, "edited") : null,
        ),
      );
    }
  };
  const open = (id: string) => {
    section = id;
    remember(SECTION_KEY, id);
    renderAll(true);
  };
  nav.openGlobal = (id) => {
    nav.setWorkspace("global");
    open(id);
  };

  const renderAll = (force = false) => {
    const s = spec();
    renderList();
    if (!s) {
      clear(main);
      main.append(h("p", { class: "hint empty" }, "This game has no global settings in the studio yet."));
      return;
    }
    const sec = s.sections.find((x) => x.id === section) ?? s.sections[0];
    section = sec.id;
    title.textContent = sec.label;
    if (force) clear(main);
    rerender(main, () => sectionForm(s, sec.id, sec.hint));
    rerender(side, () => changedList(s, open));
  };

  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      renderAll();
    });
  };
  onFocusLeave(main, schedule);
  store.on((reason, _id, registry) => {
    if (reason === "project" || reason === "saved") schedule();
    const s = spec();
    const prizes = store.adapter?.towns?.prizeRegistry;
    if (reason === "content" && s && (registry === "field" || registry === "studio_events" || registry === "constants" || registry === s.typeChart?.registry || registry === prizes || registry === "items" || registry === "pokemon")) schedule();
    if (reason === "reveal" && s && ((registry === TRADES_REGISTRY && _id === TRADES_ID) || registry === "constants" || registry === s.typeChart?.registry || registry === prizes)) nav.setWorkspace("global");
  });
}

// ------------------------------------------------------------------ sections

// field.presetNames: the three names Oak offers for the player and the rival
// (the intro's naming menu), and the label of the type-your-own option
const NAME_MAX = 7;
interface PresetNames {
  player: string[];
  rival: string[];
  customOption?: string;
  [k: string]: unknown;
}

function namesCard(): HTMLElement {
  const cur = store.table("field").presetNames as PresetNames | undefined;
  if (!cur) return h("p", { class: "hint" }, "This game has no preset names.");
  const set = (label: string, mutate: (n: PresetNames) => void) => {
    store.editRecord<PresetNames>("field", "presetNames", label, mutate);
    store.seal();
  };
  const nameInput = (value: string, onSet: (v: string) => void, max = NAME_MAX) => {
    const input = h("input", { type: "text", value, maxLength: max, spellcheck: false });
    input.addEventListener("change", () => {
      const v = input.value.trim().toUpperCase().slice(0, max);
      if (!v) return toast("A name can't be empty", "error");
      onSet(v);
    });
    return input;
  };
  const column = (who: "player" | "rival", label: string) =>
    field(label, h("div", { class: "row nowrap" }, ...cur[who].map((n, i) => nameInput(n, (v) => set(`${label} name ${i + 1}`, (d) => (d[who] = d[who].map((x, j) => (j === i ? v : x))))))));
  return h("section", { class: "card names-card" },
    column("player", "The player"),
    column("rival", "The rival"),
    field("Own name option", nameInput(cur.customOption ?? "NEW NAME", (v) => set("Own name option", (d) => (d.customOption = v)), 10), "The menu entry that lets the player type a name."),
    h("p", { class: "hint" }, `Names fit ${NAME_MAX} letters.`),
    store.isRecordEdited("field", "presetNames")
      ? h("button", { class: "btn small danger", onclick: () => { store.revertRecord("field", "presetNames", "Names: the game's"); } }, "Back to the game's names")
      : null,
  );
}

function sectionForm(s: GlobalsSpec, id: string, hint: string): HTMLElement[] {
  const out: HTMLElement[] = [h("p", { class: "hint" }, hint)];
  if (id === "wild") {
    const enc = store.adapter.encounters;
    if (enc?.sharedOdds) out.push(chancesCard(enc, enc.sharedOdds));
    out.push(rodsCard());
  }
  if (id === "types" && s.typeChart) out.push(...typeChartCards(s.typeChart));
  if (id === "fieldmoves" && s.hmBadges) out.push(hmBadgesCard(s.hmBadges));
  if (id === "trades") out.push(...tradeCards());
  if (id === "names") out.push(namesCard());
  const towns = store.adapter.towns;
  if (id === "prizes" && towns) {
    for (const cid of Object.keys(counters(towns)).sort()) {
      out.push(
        h(
          "section",
          { class: "card" },
          h("div", { class: "row" }, h("h4", {}, counterLabel(cid)), h("button", { class: "btn small ghost", onclick: () => showCounter(cid) }, "Show on map")),
          prizeCounterEditor(towns, cid),
        ),
      );
    }
  }
  const numbers = s.numbers.filter((n) => n.section === id);
  if (numbers.length) out.push(h("section", { class: "card" }, ...numbers.map(numberRow)));
  return out;
}

function numberRow(n: GlobalNumber): HTMLElement {
  const value = numberValue(n);
  const defRec = spec()?.defaults[n.registry]?.[n.id];
  const def = n.key ? (defRec as Record<string, unknown> | undefined)?.[n.key] : defRec;
  let control: HTMLElement;
  if (n.choices) {
    const sel = h("select", {}, ...n.choices.map((c) => h("option", { value: c.value, selected: c.value === value }, c.label)));
    if (!n.choices.some((c) => c.value === value)) sel.prepend(h("option", { value, selected: true }, String(value)));
    sel.addEventListener("change", () => setNumber(n, Number(sel.value)));
    control = sel;
  } else {
    control = numberInput(value, (v) => setNumber(n, v), n.min, n.max);
  }
  return h(
    "div",
    { class: "global-row" },
    field(n.label, control),
    h("span", { class: "hint" }, `${n.hint}${def !== undefined ? ` Vanilla: ${def}.` : ""}`),
  );
}

function hmBadgesCard(hm: NonNullable<GlobalsSpec["hmBadges"]>): HTMLElement {
  const gates = (current(hm.registry, hm.id) ?? {}) as Record<string, { badge?: string } | undefined>;
  const rows = hm.moves.map((move) => {
    const badge = gates[move]?.badge ?? "";
    const sel = h("select", {}, h("option", { value: "", selected: !badge }, "No badge needed"), ...hm.badges.map((b) => h("option", { value: b, selected: b === badge }, b)));
    sel.addEventListener("change", () => {
      const next: Record<string, unknown> = {};
      for (const m of hm.moves) {
        const b = m === move ? sel.value : gates[m]?.badge;
        if (b) next[m] = { badge: b };
      }
      write(hm.registry, hm.id, `${move} badge`, next);
    });
    return h("div", { class: "global-row" }, field(move, sel));
  });
  return h("section", { class: "card" }, h("h4", {}, "Badge needed to use outside battle"), ...rows, h("p", { class: "hint" }, "Teaching the HM is not affected, only using it on the map."));
}

function typeChartCards(tc: NonNullable<GlobalsSpec["typeChart"]>): HTMLElement[] {
  const reg = tc.registry;
  const table = store.table(reg) as Record<string, { multiplier?: number; category?: string; name?: string }>;
  const types = Object.keys(table).filter((k) => !k.includes(">"));
  const order = store.adapter.pokemon?.typeNames(store.ctx) ?? types;
  const ids = order.filter((t) => types.includes(t));
  const name = (t: string) => table[t]?.name ?? t;
  const mult = (a: string, d: string) => table[`${a}>${d}`]?.multiplier ?? 10;
  const label = (v: number) => tc.multipliers.find((m) => m.value === v)?.label ?? `${v / 10}×`;
  const cycle = tc.multipliers.map((m) => m.value);

  const setPair = (a: string, d: string, v: number) => {
    const id = `${a}>${d}`;
    const inBase = store.baseTable(reg)[id] !== undefined;
    // neutral needs no row unless the base has one to overrule
    store.setRecord(reg, id, `${name(a)} → ${name(d)}`, v === 10 && !inBase ? undefined : { ...(table[id] ?? {}), multiplier: v });
    store.seal();
  };

  const head = h("tr", {}, h("th", { class: "tc-corner" }, "ATK ↓ / DEF →"), ...ids.map((d) => h("th", { class: "tc-def", title: name(d) }, h("span", {}, name(d).slice(0, 3)))));
  const rows = ids.map((a) =>
    h(
      "tr",
      {},
      h("th", { class: "tc-atk" }, name(a)),
      ...ids.map((d) => {
        const v = mult(a, d);
        const edited = store.isRecordEdited(reg, `${a}>${d}`);
        const cell = h("button", { class: `tc-cell m${v}${edited ? " edited" : ""}`, title: `${name(a)} → ${name(d)}: ${label(v)}\nClick to cycle, right-click back` }, v === 10 ? "" : label(v));
        cell.addEventListener("click", () => setPair(a, d, cycle[(cycle.indexOf(v) + 1) % cycle.length] ?? 10));
        cell.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          setPair(a, d, cycle[(cycle.indexOf(v) - 1 + cycle.length) % cycle.length] ?? 10);
        });
        return h("td", {}, cell);
      }),
    ),
  );
  const chart = h(
    "section",
    { class: "card" },
    h("h4", {}, "Effectiveness"),
    h("p", { class: "hint" }, "Rows attack, columns defend. Click a cell to cycle 1× → 2× → 0× → ½× (right-click goes back). Against two types the game multiplies both."),
    h("div", { class: "tc-wrap" }, h("table", { class: "type-chart" }, h("thead", {}, head), h("tbody", {}, ...rows))),
    h("div", { class: "row tc-legend" }, ...tc.multipliers.map((m) => h("span", { class: `tc-cell m${m.value}` }, m.label))),
  );
  const out = [chart];
  out.push(typesCard(tc, ids, table));
  return out;
}

// The types themselves: display name and physical/special for each, new
// types, and deleting the ones this mod added (with their matchups).
function typesCard(tc: NonNullable<GlobalsSpec["typeChart"]>, ids: string[], table: Record<string, { name?: string; category?: string; multiplier?: number }>): HTMLElement {
  const reg = tc.registry;
  const cats = tc.categories ?? ["physical", "special"];
  const isNew = (t: string) => store.baseTable(reg)[t] === undefined;
  const setType = (t: string, label: string, patch: Record<string, unknown>) => {
    store.setRecord(reg, t, label, { ...(table[t] ?? {}), ...patch });
    store.seal();
  };

  // Pokémon and moves that would be left with a type that no longer exists
  const usedBy = (t: string): string[] => {
    const out: string[] = [];
    for (const [id, m] of Object.entries(store.table("pokemon") as Record<string, { types?: string[] }>)) if (m.types?.includes(t)) out.push(id);
    for (const [id, m] of Object.entries(store.table("moves") as Record<string, { type?: string }>)) if (m.type === t) out.push(`move ${id}`);
    return out;
  };
  const remove = (t: string) => {
    const uses = usedBy(t);
    if (!confirm(`${uses.length ? `${t} is used by ${uses.slice(0, 8).join(", ")}${uses.length > 8 ? " …" : ""}. They would have a type that no longer exists.\n\n` : ""}Delete the type ${t} and its matchups?`)) return;
    store.group(`Delete type ${t}`, () => {
      for (const id of Object.keys(store.table(reg))) {
        if (id === t || id.startsWith(`${t}>`) || id.endsWith(`>${t}`)) store.setRecord(reg, id, `Delete type ${t}`, undefined);
      }
    });
  };

  const rows = ids.map((t) => {
    const nameIn = h("input", { type: "text", value: table[t]?.name ?? t, maxLength: TYPE_NAME_MAX, spellcheck: false });
    nameIn.addEventListener("change", () => setType(t, `${t} name`, { name: nameIn.value.trim().toUpperCase() || t }));
    const cat = h("select", {}, ...cats.map((c) => h("option", { value: c, selected: table[t]?.category === c }, c)));
    cat.addEventListener("change", () => setType(t, `${t} category`, { category: cat.value }));
    return h(
      "div",
      { class: "type-row" },
      h("code", {}, t),
      nameIn,
      cat,
      isNew(t) ? h("button", { class: "btn small ghost danger", title: "Delete this type and its matchups", onclick: () => remove(t) }, "Delete") : h("span", {}),
    );
  });

  // a new type: id, name, category; it starts neutral against everything
  const newId = h("input", { type: "text", placeholder: "SOUND", spellcheck: false });
  const newName = h("input", { type: "text", placeholder: "SOUND", maxLength: TYPE_NAME_MAX, spellcheck: false });
  newName.addEventListener("input", () => (newId.value = newName.value.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")));
  const newCat = h("select", {}, ...cats.map((c) => h("option", { value: c }, c)));
  const add = () => {
    const id = newId.value.trim().toUpperCase();
    const label = newName.value.trim().toUpperCase();
    if (!label) return toast("Give the type a name", "error");
    if (!/^[A-Z][A-Z0-9_]*$/.test(id)) return toast("The id may use A-Z, 0-9 and _ and starts with a letter", "error");
    if (store.table(reg)[id] !== undefined) return toast(`${id} already exists`, "error");
    store.setRecord(reg, id, `New type ${id}`, { name: label, category: newCat.value });
    store.seal();
  };

  return h(
    "section",
    { class: "card" },
    h("h4", {}, "Types"),
    h("p", { class: "hint" }, `Name as shown in the game (up to ${TYPE_NAME_MAX} letters) and whether moves of the type use Attack/Defense (physical) or Special.`),
    ...rows,
    h("h4", {}, "New type"),
    h(
      "div",
      { class: "type-row new" },
      field("Id", newId),
      field("Name", newName),
      field("Category", newCat),
      h("button", { class: "btn small primary-ish", onclick: add }, "+ Add type"),
    ),
    h("p", { class: "hint" }, "A new type starts neutral (1×) against every type; set its matchups in the chart above. Pokémon and moves can use it right away: pick it as a move's Type in the Moves workspace."),
    h("button", { class: "btn small ghost", onclick: () => nav.setWorkspace("moves") }, "Open Moves →"),
  );
}

// ------------------------------------------------------------------ changed list

function changedList(s: GlobalsSpec, open: (section: string) => void): HTMLElement[] {
  const items: HTMLElement[] = [];
  const add = (sectionId: string, text: string, registry: string, id: string) =>
    items.push(
      h(
        "div",
        { class: "use-row static" },
        h("button", { class: "linkish", onclick: () => open(sectionId) }, text),
        h("button", { class: "btn small ghost", title: "Back to the base value", onclick: () => store.revertRecord(registry, id, `Revert ${text}`) }, "Revert"),
      ),
    );
  const odds = store.adapter.encounters?.sharedOdds;
  if (odds && store.isRecordEdited(odds.registry, odds.id)) add("wild", "Slot chances", odds.registry, odds.id);
  const seen = new Set<string>();
  for (const n of s.numbers) {
    const key = `${n.registry}:${n.id}`;
    if (seen.has(key) || !store.isRecordEdited(n.registry, n.id)) continue;
    seen.add(key);
    // a table of several settings: name the ones that differ from vanilla
    const same = s.numbers.filter((m) => m.registry === n.registry && m.id === n.id);
    const changed = n.key ? same.filter((m) => numberValue(m) !== Number((s.defaults[m.registry]?.[m.id] as Record<string, unknown> | undefined)?.[m.key!])) : [n];
    add(n.section, (changed.length ? changed : same).map((m) => m.label).join(", "), n.registry, n.id);
  }
  if (s.hmBadges && store.isRecordEdited(s.hmBadges.registry, s.hmBadges.id)) add("fieldmoves", "HM badges", s.hmBadges.registry, s.hmBadges.id);
  if (s.typeChart) {
    const reg = s.typeChart.registry;
    const ids = new Set([...Object.keys(store.table(reg)), ...Object.keys(store.baseTable(reg))]);
    for (const id of [...ids].sort()) {
      if (!store.isRecordEdited(reg, id)) continue;
      const label = id.includes(">") ? id.replace(">", " → ") : store.baseTable(reg)[id] === undefined ? `New type ${id}` : `${id} type`;
      add("types", label, reg, id);
    }
  }
  const prizes = store.adapter.towns?.prizeRegistry;
  if (prizes) {
    const ids = new Set([...Object.keys(store.table(prizes)), ...Object.keys(store.baseTable(prizes))]);
    for (const id of [...ids].sort()) if (store.isRecordEdited(prizes, id)) add("prizes", `Prizes: ${counterLabel(id)}`, prizes, id);
  }
  if (!items.length) items.push(h("p", { class: "hint" }, "Everything is vanilla."));
  return items;
}
