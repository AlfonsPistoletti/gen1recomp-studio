// Global workspace: game-wide settings the engine reads (slot chances, type
// chart, level cap, walking speed, ...). Sections on the left, the section's
// editor in the middle, everything that differs from vanilla on the right.
// Only settings the adapter lists appear, and each has the engine's default,
// so a value set back to vanilla is dropped instead of saved.

import { clone, deepEqual } from "../core/merge.ts";
import { store } from "../core/store.ts";
import type { GlobalNumber, GlobalsSpec } from "../games/types.ts";
import { clear, comboInput, field, h, listFocus, listKeys, numberInput, onFocusLeave, rerender, selectInput, toast } from "./dom.ts";
import { liveTileset } from "../core/tilesets.ts";
import { chancesCard } from "./encounterPanel.ts";
import { nav } from "./nav.ts";
import { counterLabel, counters, prizeCounterEditor, showCounter } from "./prizeEditor.ts";
import { recall, remember } from "./storage.ts";
import { rodsCard } from "./fishingPanel.ts";
import { slotCards, slotsEdited, SLOTS_ID } from "./slotEditor.ts";
import { MUSIC, SFX, songLabel, soundCards, soundsEdited } from "./soundEditor.ts";
import { tradeCards, tradesEdited, TRADES_ID, TRADES_REGISTRY } from "./tradeEditor.ts";
import { STARTER_BALLS } from "../lua/starterRuntime.ts";
import { textEditor } from "./textField.ts";
import { INTRO, introCards, introEdited, revertIntro } from "./introEditor.ts";
import { gameGifts, type GameGift } from "../project/gameEvents.ts";

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

// a key of a record; "a.b" reads a nested table
function keyOf(rec: unknown, key: string): unknown {
  let v = rec;
  for (const k of key.split(".")) v = (v as Record<string, unknown> | undefined)?.[k];
  return v;
}

function numberValue(n: GlobalNumber): number {
  const v = current(n.registry, n.id);
  if (n.key) return Number(keyOf(v, n.key) ?? 0);
  return Number(v ?? 0);
}

function setNumber(n: GlobalNumber, value: number): void {
  const v = Math.max(n.min, Math.min(n.max, Math.trunc(value)));
  if (!n.key) return write(n.registry, n.id, n.label, v);
  const def = (spec()?.defaults[n.registry]?.[n.id] ?? {}) as Record<string, unknown>;
  const now = (current(n.registry, n.id) ?? {}) as Record<string, unknown>;
  // override replaces the whole table: always write every key
  const next = clone({ ...def, ...now }) as Record<string, unknown>;
  const path = n.key.split(".");
  let at = next;
  for (const k of path.slice(0, -1)) at = (at[k] ??= {}) as Record<string, unknown>;
  at[path[path.length - 1]] = v;
  write(n.registry, n.id, n.label, next);
}

// the Global section a record is edited in, or null
export function globalSectionOf(registry: string, id: string): string | null {
  const s = spec();
  if (!s) return null;
  if (registry === s.typeChart?.registry) return "types";
  if (registry === store.adapter.towns?.prizeRegistry) return "prizes";
  if (registry === TRADES_REGISTRY && id === TRADES_ID && s.sections.some((x) => x.id === "trades")) return "trades";
  if (registry === STARTERS) return "starters";
  if (registry === GIFTS) return "gifts";
  if (registry === "constants" && id === "badges") return "badges";
  if (registry === INTRO || (registry === "field" && id === "oakSpeech")) return "intro";
  if (registry === "field" && id === "fishing") return "wild";
  if (registry === "field" && id === "boot") return "names";
  if (registry === "field" && id === SLOTS_ID) return "slots";
  if ((registry === MUSIC || registry === SFX) && s.sections.some((x) => x.id === "sounds")) return "sounds";
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
  if (registry === STARTERS) return `Starter: ${id}'s ball`;
  if (registry === GIFTS) return `Gift: ${id.split(":")[1]} (${id.split(":")[0]})`;
  if (section === "badges") return "Badges";
  if (section === "intro") return "Oak's speech";
  if (registry === "field" && id === "fishing") return "Old Rod and Good Rod";
  if (registry === "field" && id === "boot") return "New game start";
  if (registry === "field" && id === SLOTS_ID) return "Slot machine wheels";
  if (registry === MUSIC) return `Song: ${songLabel(id)}`;
  if (registry === SFX) return `Sound: ${id}`;
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
  if (id === "names" && store.isRecordEdited("field", "boot")) return true;
  if (id === "intro" && introEdited()) return true;
  if (id === "starters" && (Object.keys(store.table(STARTERS)).length > 0 || STARTER_BALLS.some((b) => store.isRecordEdited("text", b.ask)))) return true;
  if (id === "gifts" && Object.keys(store.table(GIFTS)).length > 0) return true;
  if (id === "badges" && store.isRecordEdited("constants", "badges")) return true;
  if (id === "slots" && slotsEdited()) return true;
  if (id === "sounds" && soundsEdited()) return true;
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
  listKeys(list);
  left.append(h("div", { class: "panel-head" }, h("span", {}, "Global")), list);
  const title = h("span", { class: "head-title" }, "");
  const main = h("div", { class: "ws-scroll" });
  center.append(h("div", { class: "panel-head" }, title), main);
  const side = h("div", { class: "ws-scroll" });
  right.append(h("div", { class: "panel-head" }, h("span", {}, "Changed")), side);

  const renderList = () => {
    const refocus = listFocus(list);
    clear(list);
    let group: string | undefined;
    for (const s of spec()?.sections ?? []) {
      if (s.group && s.group !== group) list.append(h("div", { class: "list-section" }, (group = s.group)));
      list.append(
        h(
          "button",
          { class: `map-row${s.id === section ? " active" : ""}`, onclick: () => open(s.id), title: s.hint, "data-id": s.id },
          h("span", { class: "map-name" }, s.label),
          sectionChanged(s.id) ? h("span", { class: "tag edited" }, "edited") : null,
        ),
      );
    }
    refocus();
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
    if (reason === "project") {
      moveOldNames();
      giftList = null;
      const { host, version } = store.project;
      void gameGifts(host, version).then((g) => {
        giftList = g;
        schedule();
      });
    }
    if (reason === "project" || reason === "saved") schedule();
    const s = spec();
    const prizes = store.adapter?.towns?.prizeRegistry;
    if (reason === "content" && s && (registry === "field" || registry === STARTERS || registry === GIFTS || registry === INTRO || registry === "text" || registry === "studio_events" || registry === "constants" || registry === s.typeChart?.registry || registry === prizes || registry === "items" || registry === "pokemon" || registry === "music" || registry === "sfx" || registry === "map_songs")) schedule();
    if (reason === "reveal" && s && ((registry === TRADES_REGISTRY && _id === TRADES_ID) || registry === "constants" || registry === s.typeChart?.registry || registry === prizes)) nav.setWorkspace("global");
  });
}

// ------------------------------------------------------------------ sections

// field.boot.namePresets: the three names Oak offers for the player and the
// rival (the intro's naming menu, OakSpeech namePresets). The engine copies
// field.presetNames there before mods run, so a mod edits boot.namePresets.
// The type-your-own entry is always "NEW NAME" (NamingScreen).
const NAME_MAX = 7;
interface PresetNames {
  player: string[];
  rival: string[];
}

// Mods saved before names moved to boot.namePresets carry them in
// field.presetNames, which the game copies before mods run (so never sees).
// On load they move to boot.namePresets, unless names were set there too,
// and the old entry goes.
function moveOldNames(): void {
  if (!store.isRecordEdited("field", "presetNames")) return;
  const old = store.table("field").presetNames as Partial<PresetNames> | undefined;
  const base = (store.baseTable("field").boot as { namePresets?: PresetNames } | undefined)?.namePresets;
  const now = (store.table("field").boot as { namePresets?: PresetNames } | undefined)?.namePresets;
  store.group("Names moved to where the game reads them", () => {
    if (old && base && deepEqual(now, base)) {
      store.editRecord<Boot & { namePresets: PresetNames }>("field", "boot", "Names", (d) => {
        d.namePresets = { player: [...(old.player ?? base.player)], rival: [...(old.rival ?? base.rival)] };
      });
    }
    store.setRecord("field", "presetNames", "Names", clone(store.baseTable("field").presetNames));
  });
  store.seal();
  toast("This mod's preset names were saved where the game doesn't read them; they were moved to Start values. Save to keep it.", "info");
}

function namesCard(): HTMLElement {
  const presets = (b: unknown) => (b as { namePresets?: PresetNames } | undefined)?.namePresets;
  const cur = presets(store.table("field").boot);
  if (!cur) return h("p", { class: "hint" }, "This game has no preset names.");
  const set = (label: string, mutate: (n: PresetNames) => void) => {
    store.editRecord<Boot & { namePresets: PresetNames }>("field", "boot", label, (d) => mutate(d.namePresets));
    store.seal();
  };
  const base = presets(store.baseTable("field").boot);
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
    h("h4", {}, "Names"),
    column("player", "The player"),
    column("rival", "The rival"),
    h("p", { class: "hint" }, `Names fit ${NAME_MAX} letters. The menu's last entry, NEW NAME, lets the player type one.`),
    base && !deepEqual(cur, base)
      ? h("button", { class: "btn small danger", onclick: () => set("Names: the game's", (d) => Object.assign(d, clone(base))) }, "Back to the game's names")
      : null,
  );
}

// field.boot: where a new game starts (SaveData.newGame), the start money,
// and the blackout point before the first Pokémon Center (lastHeal; unset,
// the engine derives it: SaveData.defaultHeal)
interface Boot {
  startMap?: string;
  startX?: number;
  startY?: number;
  startFacing?: string;
  startMoney?: number;
  lastHeal?: { map: string; x: number; y: number };
  [k: string]: unknown;
}
const MAX_MONEY = 999999;

function editBoot(label: string, mutate: (b: Boot) => void): void {
  store.editRecord<Boot>("field", "boot", label, mutate);
  store.seal();
}

// the blackout point the engine derives when lastHeal is unset
function derivedHeal(b: Boot): { map: string; x: number; y: number } {
  const map = b.startMap ?? "REDS_HOUSE_2F";
  if (map === "REDS_HOUSE_2F") return { map: "PALLET_TOWN", x: 5, y: 6 };
  return { map, x: b.startX ?? 3, y: b.startY ?? 6 };
}

// a map + cell, with "Pick on map" (walkable cells only)
function cellRow(at: { map: string; x: number; y: number }, what: string, onSet: (map: string, x: number, y: number) => void): HTMLElement {
  const maps = Object.keys(store.maps).sort();
  const pick = () =>
    nav.pickCell(at.map, (x, y) => {
      const m = store.maps[at.map];
      if (!m || !store.adapter.cell(m, liveTileset(m.tileset), x, y).walkable) return toast(`${at.map} (${x}, ${y}) is not a walkable cell`, "error");
      onSet(at.map, x, y);
    });
  return h("div", { class: "row" },
    Object.assign(comboInput(at.map, "dl-maps", maps, (v) => onSet(v, at.x, at.y)), { style: "max-width: 260px" }),
    h("span", { class: "muted" }, "x"), numberInput(at.x, (v) => onSet(at.map, v, at.y), 0, 255),
    h("span", { class: "muted" }, "y"), numberInput(at.y, (v) => onSet(at.map, at.x, v), 0, 255),
    h("button", { class: "btn small", title: `Click the cell for ${what} on the map`, onclick: pick }, "Pick on map"),
    h("button", { class: "btn small ghost", onclick: () => nav.openMap(at.map) }, "Show map"),
  );
}

// ------------------------------------------------------------------ badges

// constants.badges: the badges in order (list position = the trainer card
// slot). constants.lua has none, so the engine's own list is restated
// (src/inventory/Badges.lua VANILLA); a list equal to it isn't written.
interface Badge {
  id: string;
  name?: string;
  icon?: string;
  item?: string;
}
const VANILLA_BADGES: Badge[] = ["BOULDERBADGE", "CASCADEBADGE", "THUNDERBADGE", "RAINBOWBADGE", "SOULBADGE", "MARSHBADGE", "VOLCANOBADGE", "EARTHBADGE"].map((id) => ({ id }));
// the trainer card's pictures cover eight slots (TrainerCard.lua)
const CARD_SLOTS = 8;

function badgesCard(): HTMLElement {
  const list = (store.table("constants").badges as Badge[] | undefined) ?? VANILLA_BADGES;
  const items = store.table("items") as Record<string, { name?: string }>;
  const badgeItems = Object.keys(items).filter((id) => id.includes("BADGE")).sort();
  const set = (label: string, next: Badge[]) => {
    store.setRecord("constants", "badges", label, deepEqual(next, VANILLA_BADGES) ? undefined : next);
    store.seal();
  };
  const rows = list.map((b, i) => {
    const sel = selectInput(b.id, badgeItems.includes(b.id) ? badgeItems : [b.id, ...badgeItems], (v) => set("Badge", list.map((x, j) => (j === i ? { ...x, id: v } : x))));
    for (const o of sel.options) o.textContent = String(items[o.value]?.name ?? o.value);
    const move = (d: -1 | 1) => {
      const next = [...list];
      [next[i], next[i + d]] = [next[i + d], next[i]];
      set("Badge order", next);
    };
    return h("div", { class: "row nowrap badge-row" },
      h("span", { class: "badge-num" }, String(i + 1)),
      sel,
      h("button", { class: "btn small ghost", title: "Move up", disabled: i === 0, onclick: () => move(-1) }, "↑"),
      h("button", { class: "btn small ghost", title: "Move down", disabled: i === list.length - 1, onclick: () => move(1) }, "↓"),
      h("button", { class: "btn small ghost danger", title: "Remove from the list (the item stays)", onclick: () => set("Remove badge", list.filter((_, j) => j !== i)) }, "✕"),
      h("button", { class: "btn small ghost", title: "Open the item", onclick: () => nav.openItem(b.id) }, "Item"),
      i >= CARD_SLOTS ? h("span", { class: "hint warn", title: "The trainer card has pictures for eight badges" }, "not on the trainer card") : null,
    );
  });
  const unused = badgeItems.filter((id) => !list.some((b) => b.id === id));
  const add = h("select", {},
    h("option", { value: "" }, unused.length ? "+ Add a badge…" : "No other badge items"),
    ...unused.map((id) => h("option", { value: id }, String(items[id]?.name ?? id))),
  );
  add.disabled = !unused.length;
  add.addEventListener("change", () => add.value && set("Add badge", [...list, { id: add.value }]));
  return h("section", { class: "card" },
    h("h4", {}, "Badges"),
    h("p", { class: "hint" }, "In order: the trainer card shows slot 1 to 8 with the game's badge pictures. HM rules (Field moves) and badge gates (map Rules) check whether the player has a badge."),
    ...rows,
    h("div", { class: "row" }, add),
    h("p", { class: "hint" }, "A new badge is an item whose id contains BADGE (Items, + New Item): the game never shows it in the bag. Hand it out with an event (Give item). Slots past the eighth count, but the trainer card draws nothing for them."),
    store.isRecordEdited("constants", "badges") ? h("button", { class: "btn small danger", onclick: () => set("Badges: the game's", VANILLA_BADGES) }, "Back to the game's badges") : null,
  );
}

// ------------------------------------------------------------------ gifts

const GIFTS = "studio_gifts";
// the game's gifts of this version (gameGifts: read from its scripts)
let giftList: GameGift[] | null = null;
// the shared "box is full" line isn't about one gift
const SHARED_TEXTS = new Set(["_BoxIsFullText"]);

function giftCards(): HTMLElement[] {
  if (!giftList) return [h("p", { class: "hint" }, "Reading the game's scripts…")];
  if (!giftList.length) return [h("p", { class: "hint" }, "The gifts are read from the game's scripts, which only a gen1recomp source checkout has.")];
  const mons = store.table("pokemon") as Record<string, { name?: string }>;
  const ids = Object.keys(mons).sort();
  const name = (s: string) => String(mons[s]?.name ?? s);
  return giftList.map((g) => {
    const key = `${g.map}:${g.species}`;
    const rec = store.table(GIFTS)[key] as Starter | undefined;
    const cur: Starter = { species: rec?.species ?? g.species, level: rec?.level ?? g.level };
    const put = (label: string, next: Starter) => {
      store.setRecord(GIFTS, key, label, next.species === g.species && next.level === g.level ? undefined : next);
      store.seal();
    };
    // the NPC (or ball) that gives it
    const layer = store.adapter.layers.find((l) => l.kind === "npc");
    const map = store.maps[g.map];
    const npc = map && layer && g.text ? store.entities(map, layer.key).findIndex((o) => o.text === g.text) : -1;
    const texts = g.texts.filter((t) => !SHARED_TEXTS.has(t) && store.table("text")[t] !== undefined);
    return h(
      "section",
      { class: "card" },
      h("h4", {}, `${name(g.species)}, level ${g.level}`, h("span", { class: "hint team-choice" }, g.map)),
      g.note ? h("p", { class: "hint" }, g.note) : null,
      h("div", { class: "row two" },
        field("Pokémon", comboInput(cur.species, "dl-species", ids, (v) => {
          if (!mons[v]) return toast(`${v} is not a Pokémon`, "error");
          put(`Gift ${g.species}: ${v}`, { ...cur, species: v });
        })),
        field("Level", numberInput(cur.level, (n) => put(`Gift ${g.species}: level`, { ...cur, level: Math.max(1, Math.min(100, Math.trunc(n))) }), 1, 100)),
      ),
      h("div", { class: "row wrap" },
        npc >= 0 && layer ? h("button", { class: "btn small", onclick: () => nav.selectEntity(g.map, layer.key, npc) }, "Show on map") : null,
        ...texts.map((t) => h("button", { class: "btn small ghost", title: "Open this text (Text)", onclick: () => nav.openText(t) }, t.replace(/^_/, "").replace(/Text$/, ""))),
      ),
      cur.species !== g.species
        ? h("div", { class: "notice" },
            h("strong", {}, "Check the texts"),
            h("p", {}, `What people say before the gift may still name ${name(g.species)}. The line saying what the player received names the new Pokémon by itself.`))
        : null,
      rec ? h("button", { class: "btn small danger", onclick: () => put(`Gift ${g.species}: the game's`, { species: g.species, level: g.level }) }, "Back to the game's") : null,
    );
  });
}

// ------------------------------------------------------------------ starters

const STARTERS = "studio_starters";
interface Starter {
  species: string;
  level: number;
}

// Oak's question in the game's words ("So! You want the\nfire POKéMON,\vCHARMANDER?")
function starterQuestion(species: string): string {
  const mon = store.table("pokemon")[species] as { name?: string; types?: string[] } | undefined;
  const type = mon?.types?.[0] ?? "";
  const typeName = (store.table("type_chart")[type] as { name?: string } | undefined)?.name ?? type.replace(/_TYPE$/, "");
  return `So! You want the\n${typeName.toLowerCase()} POKéMON,\v${String(mon?.name ?? species)}?`;
}

// the game gives each ball at level 5
const BALL_LEVEL = 5;

// a ball to `next` (undefined: the game's), and Oak's question when the
// species changes; one undo step. The rival's teams are left alone: the
// card asks the user to change them (Trainers).
function setBall(ball: string, ask: string, next: Starter | undefined, label: string): void {
  const rec = store.table(STARTERS)[ball] as Starter | undefined;
  const from: Starter = { species: rec?.species ?? ball, level: rec?.level ?? BALL_LEVEL };
  const to: Starter = next ?? { species: ball, level: BALL_LEVEL };
  store.group(label, () => {
    store.setRecord(STARTERS, ball, label, to.species === ball && to.level === BALL_LEVEL ? undefined : to);
    if (!next) store.setRecord("text", ask, label, clone(store.baseTable("text")[ask]));
    else if (to.species !== from.species) store.setRecord("text", ask, label, to.species === ball ? clone(store.baseTable("text")[ask]) : starterQuestion(to.species));
  });
  store.seal();
}

// the right panel's Revert of a ball: the whole ball, like its own button
function revertStarter(ball: string): void {
  const b = STARTER_BALLS.find((x) => x.ball === ball);
  if (b) setBall(ball, b.ask, undefined, `${ball}'s ball back`);
}

function starterCards(): HTMLElement[] {
  if (store.project.version === "yellow") {
    return [h("section", { class: "card" }, h("p", { class: "hint" }, "Yellow has no three balls: Oak gives the Pikachu that follows you around, and the follower is built around it. Starters can be changed in Red and Blue."))];
  }
  const mons = store.table("pokemon") as Record<string, { name?: string }>;
  const ids = Object.keys(mons).sort();
  return STARTER_BALLS.map(({ ball, ask, rivalTeam }) => {
    const rec = store.table(STARTERS)[ball] as Starter | undefined;
    const cur: Starter = { species: rec?.species ?? ball, level: rec?.level ?? BALL_LEVEL };
    const ballName = String((store.baseTable("pokemon")[ball] as { name?: string } | undefined)?.name ?? ball);
    const pick = (v: string) => {
      if (!mons[v]) return toast(`${v} is not a Pokémon`, "error");
      if (v !== cur.species) setBall(ball, ask, { ...cur, species: v }, `${ballName}'s ball: ${v}`);
    };
    const edited = !!rec || store.isRecordEdited("text", ask);
    return h(
      "section",
      { class: "card" },
      h("h4", {}, `${ballName}'s ball`),
      h("div", { class: "row two" },
        field("Pokémon", comboInput(cur.species, "dl-species", ids, pick)),
        field("Level", numberInput(cur.level, (n) => setBall(ball, ask, { ...cur, level: Math.max(1, Math.min(100, Math.trunc(n))) }, `${ballName}'s ball: level`), 1, 100)),
      ),
      textEditor(ask, { rows: 3, label: "Oak's question" }),
      // the rival's teams: what the studio changes for you, and what it doesn't
      h("div", { class: "notice" },
        h("strong", {}, "Consider changing the rival's teams"),
        h("p", {}, "He takes the ball in the cutscene, but that doesn't change his team Pokémon. Change the rival's teams to reflect the changes you made here."),
        h("div", { class: "row" }, ...["OPP_RIVAL1", "OPP_RIVAL2", "OPP_RIVAL3"].map((t, i) =>
          h("button", { class: "btn small", onclick: () => nav.openTrainer(t, i === 0 ? rivalTeam : undefined) }, `Rival ${i + 1}`))),
      ),
      edited
        ? h("button", { class: "btn small danger", onclick: () => setBall(ball, ask, undefined, `${ballName}'s ball back`) }, "Back to the game's")
        : null,
    );
  });
}

function newGameCard(): HTMLElement {
  const b = (store.table("field").boot ?? {}) as Boot;
  const start = { map: b.startMap ?? "REDS_HOUSE_2F", x: b.startX ?? 3, y: b.startY ?? 6 };
  const custom = !!b.lastHeal;
  const heal = b.lastHeal ?? derivedHeal(b);
  const healSel = selectInput(custom ? "custom" : "", ["custom"], (v) =>
    editBoot("Blackout point", (d) => {
      if (v) d.lastHeal = { ...derivedHeal(d) };
      else delete d.lastHeal;
    }), `The game's (${derivedHeal(b).map} ${derivedHeal(b).x}, ${derivedHeal(b).y})`);
  for (const o of healSel.options) if (o.value === "custom") o.textContent = "A cell of my own";
  return h("section", { class: "card" },
    h("h4", {}, "Start"),
    field("Where the player starts", cellRow(start, "the start", (map, x, y) => editBoot("New game start", (d) => {
      d.startMap = map;
      d.startX = x;
      d.startY = y;
    })), "The game starts the player in the bedroom upstairs (REDS_HOUSE_2F 3, 6)."),
    field("Facing", selectInput(b.startFacing ?? "down", ["down", "up", "left", "right"], (v) => editBoot("Start facing", (d) => (d.startFacing = v)))),
    field("Money", numberInput(b.startMoney ?? 3000, (v) => editBoot("Start money", (d) => (d.startMoney = Math.max(0, Math.min(MAX_MONEY, v)))), 0, MAX_MONEY), `What the player has at the start (the game: 3000, at most ${MAX_MONEY}).`),
    h("h4", {}, "Blackout point"),
    field("Before the first Pokémon Center", healSel, "Where the player wakes up after blacking out until they visit a Pokémon Center. The game uses Pallet Town outside the house, or the start cell when the game starts somewhere else."),
    custom ? cellRow(heal, "the blackout point", (map, x, y) => editBoot("Blackout point", (d) => (d.lastHeal = { map, x, y }))) : null,
    store.isRecordEdited("field", "boot")
      ? h("button", { class: "btn small danger", onclick: () => store.revertRecord("field", "boot", "New game: the game's") }, "Back to the game's start")
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
  if (id === "starters") out.push(...starterCards());
  if (id === "gifts") out.push(...giftCards());
  if (id === "badges") out.push(badgesCard());
  if (id === "intro") out.push(...introCards());
  if (id === "names") out.push(newGameCard(), namesCard());
  if (id === "slots") out.push(...slotCards());
  if (id === "sounds") out.push(...soundCards());
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
  const def = n.key ? keyOf(defRec, n.key) : defRec;
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

// Every changed record a Global section edits (globalSectionOf), in the
// order of the sections, each with its own Revert.
function changedList(s: GlobalsSpec, open: (section: string) => void): HTMLElement[] {
  const label = (registry: string, id: string): string => {
    // a table of several settings: name the ones that differ from vanilla
    const same = s.numbers.filter((m) => m.registry === registry && m.id === id);
    if (same.length) {
      const changed = same[0].key ? same.filter((m) => numberValue(m) !== Number(keyOf(s.defaults[m.registry]?.[m.id], m.key!))) : same;
      return (changed.length ? changed : same).map((m) => m.label).join(", ");
    }
    if (registry === s.typeChart?.registry) return id.includes(">") ? id.replace(">", " → ") : store.baseTable(registry)[id] === undefined ? `New type ${id}` : `${id} type`;
    if (registry === store.adapter.towns?.prizeRegistry) return `Prizes: ${counterLabel(id)}`;
    return globalLabelOf(registry, id) ?? id;
  };
  const order = s.sections.map((x) => x.id);
  const rows: [number, string, HTMLElement][] = [];
  for (const [registry, records] of Object.entries(store.changed())) {
    for (const id of Object.keys(records)) {
      const section = globalSectionOf(registry, id);
      if (!section) continue;
      const text = label(registry, id);
      rows.push([order.indexOf(section), text, h(
        "div",
        { class: "use-row static" },
        h("button", { class: "linkish", onclick: () => open(section) }, text),
        h("button", { class: "btn small danger", title: "Back to the game's value", onclick: () => (registry === STARTERS ? revertStarter(id) : section === "intro" ? revertIntro() : store.revertRecord(registry, id, `Revert ${text}`)) }, "Revert"),
      )]);
    }
  }
  if (!rows.length) return [h("p", { class: "hint" }, "Everything is vanilla.")];
  return rows.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1])).map((r) => r[2]);
}
