// Events workspace: map events built from commands, RPG Maker style.
// Left: every event, by map (the studio's, then the game's own when this is
// a source checkout). Center: the event's trigger and its command list as
// blocks (If / Else, Choice, commands). Right: help for the selected command.
//
// Events are stored as the engine's own command rows (studio_events records:
// { x?, y?, once?, rows }); the editor parses them into blocks and compiles
// every edit back (src/core/eventBlocks.ts). The game's own events are shown
// read-only, with "Edit a copy" to override one.

import { clone } from "../core/merge.ts";
import { compile, parse, type Block, type Verbs } from "../core/eventBlocks.ts";
import { store } from "../core/store.ts";
import type { EntityRecord, MapDef } from "../core/types.ts";
import type { EventCommand, EventParam, EventRow, EventSpec } from "../games/types.ts";
import type { GameScripts } from "../lua/vm.ts";
import { gameEvents } from "../project/gameEvents.ts";
import { clear, comboInput, errorText, field, h, numberInput, onFocusLeave, rerender, selectInput, toast } from "./dom.ts";
import { nav } from "./nav.ts";
import { textEditor } from "./textField.ts";
import { mountRecordList } from "./recordList.ts";

export interface StudioEvent {
  x?: number;
  y?: number;
  once?: boolean;
  rows: EventRow[];
}

export type EventKind = "talk" | "step" | "enter";

function spec(): EventSpec | undefined {
  return store.adapter?.events;
}

function events(): Record<string, StudioEvent> {
  const s = spec();
  return s ? (store.table(s.registry) as Record<string, StudioEvent>) : {};
}

export function splitEventId(id: string): { mapId: string; kind: EventKind; key: string; game: boolean } {
  const game = id.startsWith("game:");
  const [mapId, kind, ...rest] = (game ? id.slice(5) : id).split(":");
  return { mapId, kind: kind as EventKind, key: rest.join(":"), game };
}

export const eventId = (mapId: string, kind: EventKind, key: string) => `${mapId}:${kind}:${key}`;

function verbs(s: EventSpec): Verbs {
  return { checks: new Set(s.commands.filter((c) => c.condition).map((c) => c.verb)), choiceVerb: s.choiceVerb };
}

// the NPC or sign a talk event belongs to, on its map
function talker(mapId: string, textId: string): { layer: string; index: number; e: EntityRecord } | null {
  const map = store.maps[mapId];
  if (!map) return null;
  for (const layer of store.adapter.layers) {
    const index = store.entities(map, layer.key).findIndex((e) => e.text === textId);
    if (index >= 0) return { layer: layer.key, index, e: store.entities(map, layer.key)[index] };
  }
  return null;
}

const nice = (v: string) => v.replace(/_/g, " ").toLowerCase().replace(/(^| )\w/g, (c) => c.toUpperCase());

export function eventTitle(id: string): string {
  const { mapId, kind, key } = splitEventId(id);
  if (kind === "talk") {
    const t = talker(mapId, key);
    const label = String(store.maps[mapId]?.label ?? "").toUpperCase();
    const who = t ? (typeof t.e.name === "string" ? nice(String(t.e.name).replace(new RegExp(`^(${mapId}|${label})_`), "")) : `${t.layer === "signs" ? "Sign" : "NPC"} ${t.index + 1}`) : key.replace(/^TEXT_/, "");
    return `Talk: ${who}`;
  }
  if (kind === "step") {
    const e = events()[id];
    return `Step: ${e ? `${e.x}, ${e.y}` : key}`;
  }
  return "On entering the map";
}

// a new studio event (one undo step); returns its id
export function createEvent(mapId: string, kind: EventKind, key: string, init: Partial<StudioEvent> = {}): string | null {
  const s = spec();
  if (!s) return null;
  const id = eventId(mapId, kind, key);
  if (events()[id]) return id;
  const rows: EventRow[] = init.rows ?? (kind === "talk" ? [["face_player"], ["show_text", "..."]] : [["show_text", "..."]]);
  store.setRecord(s.registry, id, "New event", { ...init, rows });
  store.seal();
  return id;
}

let gameCache: GameScripts | null | undefined;
let gameLoading: Promise<void> | null = null;

// the game's own events, loaded once per project (checkout only)
function loadGame(onReady: () => void): GameScripts | null | undefined {
  if (gameCache !== undefined || gameLoading) return gameCache;
  const p = store.project;
  gameLoading = gameEvents(p.host, p.version)
    .then((g) => {
      gameCache = g;
    })
    .catch((err) => {
      gameCache = null;
      toast(`The game's events could not be read: ${errorText(err)}`, "error");
    })
    .finally(() => {
      gameLoading = null;
      onReady();
    });
  return undefined;
}

export function gameTalkEvent(mapId: string, textId: string): EventRow[] | false | undefined {
  return gameCache?.[mapId]?.talk?.[textId];
}

// ------------------------------------------------------------------ workspace

export function mountEventWorkspace(left: HTMLElement, center: HTMLElement, right: HTMLElement): void {
  let current: string | null = null;
  let selected: string | null = null; // block path of the selected command
  const newBtn = h("button", { class: "btn small", title: "Add an event to a map", onclick: () => newEventDialog() }, "+ New");
  const list = mountRecordList(left, {
    title: "Events",
    head: [newBtn],
    placeholder: "Search events…  (Ctrl+P)",
    searchId: "events-search",
    folded: { label: "The game's own events", hint: "Read from the game's scripts (source checkout). Open one to see it; Edit a copy to change it." },
    items: () => {
      const s = spec();
      if (!s) return [];
      const own = Object.keys(events())
        .sort()
        .map((id) => ({ id, label: eventTitle(id), meta: splitEventId(id).mapId, search: id, edited: true, isNew: store.baseTable(s.registry)[id] === undefined }));
      const game: { id: string; label: string; meta: string; search: string; edited: boolean; folded: boolean }[] = [];
      for (const [mapId, m] of Object.entries(gameCache ?? {})) {
        for (const [text, rows] of Object.entries(m.talk)) {
          const id = `game:${mapId}:talk:${text}`;
          if (events()[eventId(mapId, "talk", text)]) continue;
          game.push({ id, label: `${eventTitle(id)}${rows ? "" : " (code)"}`, meta: mapId, search: id, edited: false, folded: true });
        }
      }
      game.sort((a, b) => a.meta.localeCompare(b.meta) || a.label.localeCompare(b.label));
      return [...own, ...game];
    },
    current: () => current,
    pick: (id) => open(id),
    refreshOn: (reason, _id, registry) => reason === "content" && registry === spec()?.registry,
  });

  const main = h("div", { class: "ws-scroll" });
  const side = h("div", { class: "ws-scroll" });
  const title = h("span", { class: "head-title" }, "Events");
  const del = h("button", {
    class: "btn small danger",
    onclick: () => {
      const s = spec();
      if (!s || !current || splitEventId(current).game) return;
      if (!confirm(`Delete this event (${eventTitle(current)})?`)) return;
      store.setRecord(s.registry, current, "Delete event", undefined);
      store.seal();
      current = null;
      list.render();
      render(true);
    },
  }, "Delete event");
  center.append(h("div", { class: "panel-head" }, title, del), main);
  right.append(h("div", { class: "panel-head" }, h("span", {}, "Help")), side);

  const open = (id: string) => {
    current = id;
    selected = null;
    list.render();
    render(true);
    left.querySelector<HTMLElement>(`.map-row[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
  };
  nav.openEvent = (id) => {
    nav.setWorkspace("events");
    open(id);
  };

  const render = (force = false) => {
    const s = spec();
    if (s && gameCache === undefined) loadGame(() => {
      list.render();
      render(true);
    });
    if (!s || !current) {
      clear(main);
      clear(side);
      del.hidden = true;
      title.textContent = "Events";
      main.append(
        h("p", { class: "hint empty" }, s ? "Pick an event on the left, or make one with + New." : "This game has no event editor yet."),
        ...(s && gameCache === null ? [h("p", { class: "hint" }, "The game's own events can only be shown with a gen1recomp source checkout.")] : []),
      );
      return;
    }
    const id = current;
    const info = splitEventId(id);
    title.textContent = `${info.mapId} · ${eventTitle(id)}`;
    del.hidden = info.game;
    if (force) {
      clear(main);
      clear(side);
    }
    rerender(main, () => eventForm(s, id, () => selected, (p) => {
      selected = p;
      schedule();
    }));
    rerender(side, () => helpPanel(s, id, selected));
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
      gameCache = undefined;
      if (current && !current.startsWith("game:") && !events()[current]) current = null;
      render(true);
    } else if (reason === "content" && s && (registry === s.registry || registry === "text" || registry === "items" || registry === "pokemon")) {
      if (registry === s.registry && id && current && id !== current) return;
      if (registry === s.registry && current && !current.startsWith("game:") && !events()[current]) current = null;
      schedule();
    } else if (reason === "edit") {
      schedule();
    } else if (reason === "reveal" && s && registry === s.registry && id) {
      nav.openEvent(id);
    }
  });
}

// ------------------------------------------------------------------ new event

function newEventDialog(): void {
  const s = spec();
  if (!s) return;
  const dialog = h("dialog", { class: "modal" });
  const mapIds = Object.keys(store.maps).sort();
  const mapSel = selectInput(store.currentMap, mapIds, () => fillWho());
  const kindSel = selectInput("talk", ["talk", "step", "enter"], () => fillWho());
  kindSel.options[0].textContent = "Talking to an NPC or sign";
  kindSel.options[1].textContent = "Stepping on a cell";
  kindSel.options[2].textContent = "Entering the map";
  const who = h("div", {});
  let pickWho: () => { key: string; init: Partial<StudioEvent> } | null = () => null;
  const fillWho = () => {
    clear(who);
    const map = store.maps[mapSel.value];
    if (!map) return;
    if (kindSel.value === "talk") {
      const opts: { value: string; label: string }[] = [];
      for (const layer of store.adapter.layers) {
        if (layer.kind !== "npc" && layer.kind !== "sign") continue;
        store.entities(map, layer.key).forEach((e, i) => {
          if (typeof e.text === "string" && /^TEXT_[A-Z0-9_]+$/.test(e.text)) opts.push({ value: e.text, label: `${layer.singular} ${i + 1}${typeof e.name === "string" ? ` · ${e.name}` : ""} (${e.text})` });
        });
      }
      const sel = h("select", {}, ...opts.map((o) => h("option", { value: o.value }, o.label)));
      who.append(field("NPC or sign", sel, opts.length ? "Its text id; the event replaces what it says." : "This map has no NPC or sign with a text id yet (Maps: select one, Create text)."));
      pickWho = () => (sel.value ? { key: sel.value, init: {} } : null);
    } else if (kindSel.value === "step") {
      let x = 0;
      let y = 0;
      const once = h("input", { type: "checkbox", checked: true });
      who.append(
        h("div", { class: "row two" }, field("X", numberInput(0, (v) => (x = v), 0, map.width * 2 - 1)), field("Y", numberInput(0, (v) => (y = v), 0, map.height * 2 - 1))),
        h("label", { class: "inline-check" }, once, "Only once"),
        h("p", { class: "hint" }, "Cells as in the map view (two per block). The map's properties can also place one by clicking the map."),
      );
      pickWho = () => ({ key: `at_${x}_${y}`, init: { x, y, once: once.checked || undefined } });
    } else {
      const once = h("input", { type: "checkbox", checked: false });
      who.append(h("label", { class: "inline-check" }, once, "Only once"));
      pickWho = () => ({ key: `enter_${Object.keys(events()).filter((k) => k.startsWith(`${mapSel.value}:enter:`)).length + 1}`, init: { once: once.checked || undefined } });
    }
  };
  fillWho();
  const create = h("button", {
    class: "btn primary",
    onclick: () => {
      const w = pickWho();
      if (!w) return toast("Pick who or where", "error");
      const id = createEvent(mapSel.value, kindSel.value as EventKind, w.key, w.init);
      dialog.close();
      dialog.remove();
      if (id) nav.openEvent(id);
    },
  }, "Create event");
  dialog.append(
    h("h3", {}, "New event"),
    field("Map", mapSel),
    field("Runs when", kindSel),
    who,
    h("div", { class: "dialog-actions" }, h("button", { class: "btn", onclick: () => (dialog.close(), dialog.remove()) }, "Cancel"), create),
  );
  document.body.append(dialog);
  dialog.showModal();
}

// ------------------------------------------------------------------ form

function eventForm(s: EventSpec, id: string, selected: () => string | null, select: (path: string | null) => void): HTMLElement[] {
  const info = splitEventId(id);
  const out: HTMLElement[] = [];
  const map = store.maps[info.mapId];

  if (info.game) {
    const rows = gameTalkEvent(info.mapId, info.key);
    const t = talker(info.mapId, info.key);
    out.push(
      h(
        "section",
        { class: "card" },
        h("h4", {}, "The game's own event"),
        h("p", { class: "hint" }, `Runs when the player talks to ${t ? `${t.layer === "signs" ? "sign" : "NPC"} ${t.index + 1} on ${info.mapId}` : `${info.key} on ${info.mapId}`}.`),
        h(
          "div",
          { class: "row" },
          t ? h("button", { class: "btn small ghost", onclick: () => nav.selectEntity(info.mapId, t.layer, t.index) }, "Show on map") : null,
          rows
            ? h("button", {
                class: "btn small primary-ish",
                title: "Makes a studio event with the same commands; it runs instead of the game's",
                onclick: () => {
                  const nid = createEvent(info.mapId, "talk", info.key, { rows: clone(rows) });
                  if (nid) nav.openEvent(nid);
                },
              }, "Edit a copy")
            : h("button", {
                class: "btn small",
                title: "Makes a new, empty studio event for this NPC; it runs instead of the game's code",
                onclick: () => {
                  if (!confirm("The game runs code here, which the studio can't show. Replace it with a new event of your own?")) return;
                  const nid = createEvent(info.mapId, "talk", info.key);
                  if (nid) nav.openEvent(nid);
                },
              }, "Replace with a new event"),
        ),
      ),
    );
    if (rows) out.push(h("section", { class: "card" }, h("h4", {}, "Commands"), blockList(s, info.mapId, parse(rows, verbs(s)), "", null, selected, select)));
    else out.push(h("p", { class: "hint" }, "This event is code in the game (often a cutscene or a special case), so it can't be shown as commands."));
    return out;
  }

  const ev = events()[id];
  if (!ev) return [h("p", { class: "hint" }, "This event no longer exists.")];
  const editEv = (label: string, mutate: (d: StudioEvent) => void) => {
    store.editRecord<StudioEvent>(s.registry, id, label, mutate);
    store.seal();
  };

  // trigger
  const trigger = h("section", { class: "card" }, h("h4", {}, "Runs when"));
  if (info.kind === "talk") {
    const t = talker(info.mapId, info.key);
    const game = gameTalkEvent(info.mapId, info.key);
    trigger.append(
      h(
        "div",
        { class: "row" },
        h("span", {}, t ? `The player talks to ${t.layer === "signs" ? "sign" : "NPC"} ${t.index + 1}${typeof t.e.name === "string" ? ` (${t.e.name})` : ""}` : `The player talks to ${info.key} (not on the map any more)`),
        t ? h("button", { class: "btn small ghost", onclick: () => nav.selectEntity(info.mapId, t.layer, t.index) }, "Show on map") : null,
      ),
      ...(game !== undefined ? [h("p", { class: "hint" }, `Replaces the game's own event for ${info.key}${game ? "" : " (code in the game)"}.`)] : []),
    );
  } else if (info.kind === "step") {
    const once = h("input", { type: "checkbox", checked: ev.once === true });
    once.addEventListener("change", () => editEv("Only once", (d) => (once.checked ? (d.once = true) : delete d.once)));
    trigger.append(
      h(
        "div",
        { class: "row" },
        h("span", {}, "The player steps on cell"),
        numberInput(ev.x ?? 0, (v) => editEv("Event cell", (d) => (d.x = v)), 0, map ? map.width * 2 - 1 : 255),
        h("span", { class: "x" }, ","),
        numberInput(ev.y ?? 0, (v) => editEv("Event cell", (d) => (d.y = v)), 0, map ? map.height * 2 - 1 : 255),
        h("button", { class: "btn small ghost", onclick: () => (nav.openMap(info.mapId), setTimeout(() => store.select(null))) }, "Open map"),
      ),
      h("label", { class: "inline-check" }, once, "Only once (remembered in the save)"),
    );
  } else {
    const once = h("input", { type: "checkbox", checked: ev.once === true });
    once.addEventListener("change", () => editEv("Only once", (d) => (once.checked ? (d.once = true) : delete d.once)));
    trigger.append(h("p", {}, `The player enters ${info.mapId}.`), h("label", { class: "inline-check" }, once, "Only once (remembered in the save)"));
  }
  out.push(trigger);

  // commands
  const root = parse(ev.rows ?? [], verbs(s));
  const commit = (label: string) => editEv(label, (d) => (d.rows = compile(root, verbs(s))));
  out.push(h("section", { class: "card event-card" }, h("h4", {}, "Commands"), blockList(s, info.mapId, root, "", commit, selected, select)));
  return out;
}

// ------------------------------------------------------------------ blocks

type Commit = ((label: string) => void) | null;

function findCommand(s: EventSpec, row: EventRow): EventCommand | undefined {
  return s.commands.find((c) => c.verb === row[0] && (c.fixed ?? []).every((f, i) => row[1 + i] === f));
}

function argsOf(c: EventCommand, row: EventRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const skip = 1 + (c.fixed?.length ?? 0);
  c.params.forEach((p, i) => (out[p.key] = row[skip + i]));
  return out;
}

function rowOf(c: EventCommand, args: Record<string, unknown>): EventRow {
  return [c.verb, ...(c.fixed ?? []), ...c.params.map((p) => args[p.key] ?? p.default)];
}

function freshRow(c: EventCommand, mapId: string): EventRow {
  const args: Record<string, unknown> = {};
  for (const p of c.params) {
    if (p.default !== undefined) args[p.key] = p.default;
    else if (p.type === "map") args[p.key] = mapId;
    else if (p.type === "flag") args[p.key] = `${(store.project.mod ?? "MOD").toUpperCase()}_FLAG`;
    else if (p.type === "song") args[p.key] = Object.keys(store.table("music")).sort()[0];
    else if (p.type === "sound") args[p.key] = "Get_Item1";
    else if (p.type === "npcName") args[p.key] = String(store.entities(store.maps[mapId], "objects")[0]?.name ?? "");
  }
  return rowOf(c, args);
}

// arguments as the list shows them: a text key shows its text
function shown(c: EventCommand, args: Record<string, unknown>): Record<string, unknown> {
  const out = { ...args };
  for (const p of c.params) {
    const v = out[p.key];
    if (p.type === "text" && typeof v === "string" && /^_\w+$/.test(v)) {
      const t = store.table("text")[v];
      if (typeof t === "string") out[p.key] = t.replace(/\{(DONE|PROMPT)\}/g, "");
    }
  }
  return out;
}

function describeCondition(s: EventSpec, cond: EventRow | null, not: boolean): string {
  if (!cond) return not ? "the last answer/result was NO" : "the last answer/result was YES";
  const c = findCommand(s, cond);
  if (!c?.condition) return `${not ? "not " : ""}${JSON.stringify(cond)}`;
  const text = c.describe(shown(c, argsOf(c, cond)));
  return not ? `NOT ${text}` : text;
}

function describe(s: EventSpec, b: Block): string {
  switch (b.t) {
    case "cmd": {
      const c = findCommand(s, b.row);
      return c ? c.describe(shown(c, argsOf(c, b.row))) : `${String(b.row[0])} ${b.row.slice(1).map((a) => JSON.stringify(a)).join(" ")}`;
    }
    case "stop":
      return "Stop the event";
    case "goto":
      return b.label === "end" ? `Stop the event if the last result was ${b.when ? "YES" : "NO"}` : `Go to ${b.label}${b.when === undefined ? "" : ` if the last result was ${b.when ? "YES" : "NO"}`}`;
    case "label":
      return `Label ${b.name}`;
    case "if":
      return `If ${describeCondition(s, b.cond, b.not)}`;
    case "choice":
      return `Choice: ${b.labels.join(" / ")}`;
  }
}

// a select that inserts a new block into `list` at `at`
function addMenu(s: EventSpec, mapId: string, list: Block[], at: number, commit: Commit, onAdded: (i: number) => void, text = "+ Add command"): HTMLElement {
  const sel = h("select", { class: "add-command" }, h("option", { value: "" }, text));
  const flow = h("optgroup", { label: "Flow" }, h("option", { value: "#if" }, "If … (condition)"), h("option", { value: "#ifelse" }, "If … Else …"), h("option", { value: "#choice" }, "Choice (menu)"), h("option", { value: "#stop" }, "Stop the event"));
  sel.append(flow);
  for (const cat of s.categories) {
    if (cat === "Conditions") continue;
    const cmds = s.commands.filter((c) => c.category === cat);
    if (cmds.length) sel.append(h("optgroup", { label: cat }, ...cmds.map((c) => h("option", { value: c.id, title: c.help }, c.label))));
  }
  sel.addEventListener("change", () => {
    if (!commit || !sel.value) return;
    const v = sel.value;
    const first = s.commands.find((c) => c.id === "check_flag") ?? s.commands.find((c) => c.condition)!;
    let block: Block;
    if (v === "#if" || v === "#ifelse") block = { t: "if", cond: freshRow(first, mapId), not: false, then: [], else: v === "#ifelse" ? [] : null };
    else if (v === "#choice") block = { t: "choice", labels: ["YES", "NO"], branches: [[], []] };
    else if (v === "#stop") block = { t: "stop" };
    else {
      const c = s.commands.find((x) => x.id === v)!;
      block = { t: "cmd", row: freshRow(c, mapId) };
    }
    list.splice(at, 0, block);
    commit("Add command");
    onAdded(at);
  });
  return sel;
}

function blockList(s: EventSpec, mapId: string, list: Block[], path: string, commit: Commit, selected: () => string | null, select: (p: string | null) => void): HTMLElement {
  const wrap = h("div", { class: "block-list" });
  list.forEach((b, i) => {
    const p = `${path}${path ? "." : ""}${i}`;
    const isSel = selected() === p;
    const move = (to: number) => {
      if (!commit || to < 0 || to >= list.length) return;
      const [x] = list.splice(i, 1);
      list.splice(to, 0, x);
      commit("Move command");
      select(`${path}${path ? "." : ""}${to}`);
    };
    const tools = commit
      ? h(
          "span",
          { class: "block-tools" },
          h("button", { class: "btn small ghost", title: "Move up", disabled: i === 0, onclick: (e: Event) => (e.stopPropagation(), move(i - 1)) }, "↑"),
          h("button", { class: "btn small ghost", title: "Move down", disabled: i === list.length - 1, onclick: (e: Event) => (e.stopPropagation(), move(i + 1)) }, "↓"),
          h("button", {
            class: "btn small ghost",
            title: "Duplicate",
            onclick: (e: Event) => {
              e.stopPropagation();
              list.splice(i + 1, 0, clone(b));
              commit("Duplicate command");
            },
          }, "⧉"),
          h("button", {
            class: "btn small ghost",
            title: "Delete",
            onclick: (e: Event) => {
              e.stopPropagation();
              list.splice(i, 1);
              commit("Delete command");
              select(null);
            },
          }, "✕"),
        )
      : null;
    const head = h(
      "div",
      { class: `block-row${isSel ? " selected" : ""}${b.t === "if" || b.t === "choice" ? " block-flow" : ""}`, onclick: () => select(isSel ? null : p) },
      h("span", { class: "block-bullet" }, b.t === "if" || b.t === "choice" ? "◇" : "◆"),
      h("span", { class: "block-text" }, describe(s, b)),
      tools,
    );
    wrap.append(head);
    if (isSel) wrap.append(blockEditor(s, mapId, b, commit, list, i, select, p));
    if (b.t === "if") {
      wrap.append(h("div", { class: "block-indent" }, blockList(s, mapId, b.then, `${p}.t`, commit, selected, select)));
      if (b.else) {
        wrap.append(h("div", { class: "block-row block-flow block-else" }, h("span", { class: "block-bullet" }, "◇"), h("span", { class: "block-text" }, "Else")));
        wrap.append(h("div", { class: "block-indent" }, blockList(s, mapId, b.else, `${p}.e`, commit, selected, select)));
      }
      wrap.append(h("div", { class: "block-row block-end" }, h("span", { class: "block-text muted" }, "End if")));
    }
    if (b.t === "choice") {
      b.branches.forEach((br, k) => {
        wrap.append(h("div", { class: "block-row block-flow block-else" }, h("span", { class: "block-bullet" }, "◇"), h("span", { class: "block-text" }, `When "${b.labels[k] ?? k + 1}"`)));
        wrap.append(h("div", { class: "block-indent" }, blockList(s, mapId, br, `${p}.b${k}`, commit, selected, select)));
      });
      wrap.append(h("div", { class: "block-row block-end" }, h("span", { class: "block-text muted" }, "End choice")));
    }
  });
  if (commit) wrap.append(addMenu(s, mapId, list, list.length, commit, (at) => select(`${path}${path ? "." : ""}${at}`)));
  else if (!list.length) wrap.append(h("p", { class: "hint" }, "(nothing)"));
  return wrap;
}

// the inline editor of the selected block
function blockEditor(s: EventSpec, mapId: string, b: Block, commit: Commit, list: Block[], i: number, select: (p: string | null) => void, path: string): HTMLElement {
  const box = h("div", { class: "block-editor" });
  const ro = !commit;
  const done = (label: string) => commit?.(label);
  if (b.t === "cmd") {
    const c = findCommand(s, b.row);
    if (!c) {
      const raw = h("textarea", { rows: 2, class: "mono", disabled: ro }, JSON.stringify(b.row));
      raw.addEventListener("change", () => {
        try {
          const v = JSON.parse(raw.value) as unknown;
          if (!Array.isArray(v) || typeof v[0] !== "string") throw new Error("a list starting with the command name");
          b.row = v;
          done("Edit command");
        } catch (err) {
          toast(`Not a command: ${errorText(err)}`, "error");
        }
      });
      box.append(h("p", { class: "hint" }, "A command the studio has no form for; edit it as data."), raw);
    } else {
      const args = argsOf(c, b.row);
      box.append(...paramFields(s, mapId, c.params, args, ro, () => {
        b.row = rowOf(c, args);
        done(`Edit ${c.label}`);
      }));
      box.append(h("p", { class: "hint" }, c.help));
    }
  } else if (b.t === "if") {
    const conds = s.commands.filter((c) => c.condition);
    const cur = b.cond ? findCommand(s, b.cond) : undefined;
    const kind = selectInput(cur?.id ?? "#last", [...conds.map((c) => c.id), "#last"], (v) => {
      const c = conds.find((x) => x.id === v);
      b.cond = c ? freshRow(c, mapId) : null;
      done("If condition");
    });
    for (const o of kind.options) o.textContent = o.value === "#last" ? "the last answer/result" : (conds.find((c) => c.id === o.value)?.label ?? o.value);
    kind.disabled = ro;
    const neg = selectInput(b.not ? "not" : "is", ["is", "not"], (v) => {
      b.not = v === "not";
      done("If condition");
    });
    neg.options[0].textContent = "is true";
    neg.options[1].textContent = "is NOT true";
    neg.disabled = ro;
    box.append(h("div", { class: "row" }, h("span", {}, "If"), kind, neg));
    if (cur && b.cond) {
      const args = argsOf(cur, b.cond);
      box.append(...paramFields(s, mapId, cur.params, args, ro, () => {
        b.cond = rowOf(cur, args);
        done("If condition");
      }));
    }
    if (!ro) {
      box.append(
        h(
          "label",
          { class: "inline-check" },
          (() => {
            const cb = h("input", { type: "checkbox", checked: !!b.else });
            cb.addEventListener("change", () => {
              b.else = cb.checked ? [] : null;
              done(cb.checked ? "Add Else" : "Remove Else");
            });
            return cb;
          })(),
          "Else branch (runs when the condition is not met)",
        ),
      );
    }
  } else if (b.t === "choice") {
    const labels = h("input", { type: "text", value: b.labels.join(", "), disabled: ro, spellcheck: false });
    labels.addEventListener("change", () => {
      const next = labels.value.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean).slice(0, 6);
      if (next.length < 2) return toast("A choice needs at least 2 options", "error");
      b.labels = next;
      while (b.branches.length < next.length) b.branches.push([]);
      b.branches.length = next.length;
      done("Choice options");
    });
    box.append(field("Options", labels, "Separated by commas, 2 to 6. The last one is also what B picks."));
  } else if (b.t === "goto" || b.t === "label") {
    box.append(h("p", { class: "hint" }, "A jump from the game's script that the studio can't turn into blocks. It still works; move or delete it with care."));
  }
  if (!ro) {
    box.append(h("div", { class: "row" }, addMenu(s, mapId, list, i, commit, (at) => select(path.replace(/\d+$/, String(at))), "+ Insert above")));
  }
  return box;
}

const DIRS = ["up", "down", "left", "right"];

function paramFields(_s: EventSpec, mapId: string, params: EventParam[], args: Record<string, unknown>, ro: boolean, changed: () => void): HTMLElement[] {
  return params.map((p) => {
    const set = (v: unknown) => {
      args[p.key] = v;
      changed();
    };
    const value = args[p.key];
    let input: HTMLElement;
    switch (p.type) {
      case "text": {
        // a text key: edit the text itself, like the Text workspace does
        if (!ro && typeof value === "string" && /^_\w+$/.test(value) && typeof store.table("text")[value] === "string") {
          input = h(
            "div",
            {},
            textEditor(value, { rows: 3, compact: true, label: value }),
            h(
              "div",
              { class: "row" },
              h("button", { class: "btn small ghost", title: "Type a line just for this event instead of using the shared text", onclick: () => set(String(store.table("text")[value] ?? "")) }, "Use own text instead"),
              h("button", { class: "btn small ghost", onclick: () => nav.openText(value) }, "Open in Text →"),
            ),
          );
          break;
        }
        const ta = h("textarea", { rows: 3, class: "gb-text mono", spellcheck: false, disabled: ro });
        ta.value = typeof value === "string" ? value : "";
        ta.addEventListener("change", () => set(ta.value));
        const key = typeof value === "string" && /^_\w+$/.test(value) ? value : null;
        const resolved = key ? store.table("text")[key] : undefined;
        input = h(
          "div",
          {},
          ta,
          key
            ? h("div", { class: "row" }, h("span", { class: "hint" }, typeof resolved === "string" ? `Text key: "${resolved.slice(0, 60).replace(/\n|\f|\v/g, " ")}…"` : "Unknown text key"), h("button", { class: "btn small ghost", onclick: () => nav.openText(key) }, "Open in Text →"))
            : h("p", { class: "hint" }, "Line breaks as in the Text workspace. Start with _ to use a text key instead."),
        );
        break;
      }
      case "number":
        input = numberInput(Number(value ?? p.default ?? 0), (v) => set(Math.max(p.min ?? -1e9, Math.min(p.max ?? 1e9, v))), p.min, p.max);
        break;
      case "dir":
        input = selectInput(String(value ?? "down"), DIRS, set);
        break;
      case "bubble":
        input = selectInput(String(value ?? "shock"), ["shock", "question", "happy"], set);
        break;
      case "fade":
        input = selectInput(String(value ?? "out"), ["out", "in"], set);
        break;
      case "flag": {
        // any name: new flags are made by using them; known ones are suggested
        const list = document.getElementById("dl-event-flags") ?? document.body.appendChild(h("datalist", { id: "dl-event-flags" }));
        list.replaceChildren(...knownFlags().map((f) => h("option", { value: f })));
        const inp = h("input", { type: "text", value: String(value ?? ""), spellcheck: false, class: "combo mono" });
        inp.setAttribute("list", "dl-event-flags");
        inp.addEventListener("change", () => {
          const v = inp.value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
          if (!v) return void (inp.value = String(value ?? ""));
          inp.value = v;
          set(v);
        });
        input = inp;
        break;
      }
      case "item":
        input = combo(Object.keys(store.table("items")).sort(), value, set);
        break;
      case "species":
        input = combo(Object.keys(store.table("pokemon")).sort(), value, set);
        break;
      case "trainer":
        input = combo(Object.keys(store.table("trainers")).sort(), value, set);
        break;
      case "map":
        input = combo(Object.keys(store.maps).sort(), value, set);
        break;
      case "song":
        input = combo(Object.keys(store.table("music")).sort(), value, set);
        break;
      case "sound":
        input = combo(Object.keys(store.table("sfx")).sort(), value, set);
        break;
      case "npcIndex": {
        const map = store.maps[mapId];
        const npcs = map ? store.entities(map, "objects") : [];
        const opts = [...(p.key === "who" ? ["player"] : []), ...npcs.map((e) => String(e.index ?? ""))];
        const sel = selectInput(String(value ?? ""), opts, (v) => set(v === "player" ? v : Number(v)));
        for (const o of sel.options) {
          const e = npcs.find((n) => String(n.index) === o.value);
          if (o.value === "player") o.textContent = "the player";
          else if (e) o.textContent = `NPC ${o.value}${typeof e.name === "string" ? ` · ${e.name}` : ""}`;
        }
        input = sel;
        break;
      }
      case "npcName": {
        const mapKey = (args.map as string | undefined) ?? mapId;
        const map = store.maps[mapKey];
        const names = map ? store.entities(map, "objects").map((e) => String(e.name ?? "")).filter(Boolean) : [];
        input = combo(names, value, set);
        break;
      }
      default:
        input = h("span", {}, String(value ?? ""));
    }
    if (ro) for (const el of input.querySelectorAll?.("input,select,textarea,button") ?? []) (el as HTMLInputElement).disabled = true;
    if (ro && (input instanceof HTMLInputElement || input instanceof HTMLSelectElement)) input.disabled = true;
    return field(p.label, input);
  });
}

function combo(options: string[], value: unknown, set: (v: string) => void): HTMLInputElement {
  return comboInput(String(value ?? ""), `dl-ev-${options.length}-${options[0] ?? ""}`, options, (v) => options.includes(v) && set(v));
}

// flags used by the studio's events and the game's own
function knownFlags(): string[] {
  const out = new Set<string>();
  const walk = (rows: EventRow[] | false | undefined) => {
    for (const r of rows || []) if ((r[0] === "check_flag" || r[0] === "set_flag" || r[0] === "clear_flag") && typeof r[1] === "string") out.add(r[1]);
  };
  for (const e of Object.values(events())) walk(e.rows);
  for (const m of Object.values(gameCache ?? {})) for (const t of Object.values(m.talk)) walk(t);
  return [...out].sort();
}

// ------------------------------------------------------------------ help

function helpPanel(s: EventSpec, id: string, selected: string | null): HTMLElement[] {
  const out: HTMLElement[] = [];
  out.push(
    h("p", { class: "hint" }, "Click a command to edit it. Commands run top to bottom; If and Choice run the indented commands only when they apply."),
    h("p", { class: "hint" }, "Flags remember things in the save. Name new ones after your mod (e.g. MYMOD_GOT_GIFT); the game's own (EVENT_…) can be checked too."),
  );
  if (!selected) return out;
  const info = splitEventId(id);
  const rows = info.game ? gameTalkEvent(info.mapId, info.key) || [] : events()[id]?.rows ?? [];
  // paths look like 2.t.0 (then), 2.e.1 (else), 3.b1.0 (choice branch 2)
  let list = parse(rows, verbs(s));
  let b: Block | undefined;
  for (const part of selected.split(".")) {
    if (/^\d+$/.test(part)) b = list[Number(part)];
    else if (part === "t" && b?.t === "if") list = b.then;
    else if (part === "e" && b?.t === "if") list = b.else ?? [];
    else if (part.startsWith("b") && b?.t === "choice") list = b.branches[Number(part.slice(1))] ?? [];
  }
  if (b?.t === "cmd") {
    const c = findCommand(s, b.row);
    if (c) out.push(h("h4", {}, c.label), h("p", {}, c.help));
    const flag = c?.params.find((p) => p.type === "flag");
    const name = flag ? argsOf(c!, b.row)[flag.key] : undefined;
    if (typeof name === "string") {
      const uses = Object.entries(events()).filter(([, e]) => (e.rows ?? []).some((r) => r.includes(name))).map(([k]) => k);
      out.push(h("p", { class: "hint" }, uses.length ? `Flag ${name} is used in: ${uses.map((k) => `${splitEventId(k).mapId} ${eventTitle(k)}`).join(", ")}` : `Flag ${name} isn't used elsewhere in this mod.`));
    }
  }
  return out;
}

export function studioEventsOf(mapId: string): string[] {
  return Object.keys(events()).filter((k) => k.startsWith(`${mapId}:`));
}

export function studioEvent(id: string): StudioEvent | undefined {
  return events()[id];
}

// for the map view: cells with step events on a map
export function stepCells(map: MapDef): { x: number; y: number }[] {
  return studioEventsOf(map.id)
    .filter((k) => splitEventId(k).kind === "step")
    .map((k) => events()[k])
    .filter((e): e is StudioEvent => !!e && typeof e.x === "number" && typeof e.y === "number")
    .map((e) => ({ x: e.x!, y: e.y! }));
}
