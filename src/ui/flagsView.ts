// Events > Flags: every event flag the game and the mod use, labelled by what
// sets, clears, checks or hangs on it (adapter.flags.uses), with a note per flag
// the mod keeps for itself (studio_flag_notes, a data file only the studio reads).
// Gen 1 flags are names, Gen 2 flags numbers (Gold/Silver also have names).

import { store } from "../core/store.ts";
import { FEATURES } from "../features.ts";
import type { FlagUse, FlagUseKind } from "../games/types.ts";
import { clear, h, rerender, toast } from "./dom.ts";
import { ensureGameEvents, eventTitle, gameEventsLoaded } from "./eventEditor.ts";
import { nav } from "./nav.ts";
import { mountRecordList } from "./recordList.ts";

const KINDS: [FlagUseKind, string, string][] = [
  ["set", "Sets it", "Set by"],
  ["clear", "Clears it", "Cleared by"],
  ["check", "Checks it", "Checked by"],
  ["shows", "Shows a person only while it is set", "Shows"],
  ["hides", "Hides a person while it is set", "Hides"],
  ["beaten", "A trainer's \"beaten\" flag", "Beaten"],
  ["item", "An item ball's \"taken\" flag", "Item ball"],
  ["hidden", "A hidden item's \"found\" flag", "Hidden item"],
  ["start", "Set when a new game starts", "Set at"],
];

type Note = { note?: string };
// (nothing before a project is open: store.adapter reads the project)
const spec = () => (store.project ? store.adapter.flags : undefined);
const notes = () => (spec() ? (store.table(spec()!.notes) as Record<string, Note>) : {});
export const flagNote = (key: string): string => String(notes()[key]?.note ?? "");

// a flag in words: Gen 2 "628 EVENT_JOEY_READY_FOR_REMATCH", Gen 1 its name
export function flagTitle(key: string): string {
  const name = spec()?.name?.(store.ctx, key);
  return name ? `${key} ${name}` : key;
}

let usesCache: { stamp: number; uses: Map<string, FlagUse[]> } | null = null;
let stamp = 0;
function allUses(): Map<string, FlagUse[]> {
  const s = spec();
  if (!s) return new Map();
  if (usesCache?.stamp !== stamp) usesCache = { stamp, uses: s.uses(store.ctx, gameEventsLoaded() ?? undefined) };
  return usesCache.uses;
}

// the line under a flag field in the event editor: its note (or the game's name) and a link
export function flagNoteLine(key: string): HTMLElement | null {
  if (!spec() || !key) return null;
  const note = flagNote(key);
  const name = spec()!.name?.(store.ctx, key);
  return h("div", { class: "row nowrap" },
    h("span", { class: "hint" }, note || name || "No note yet."),
    h("button", { class: "btn small ghost", title: "See where this flag is used and note what it is for", onclick: () => nav.openFlag(key) }, "Flags →"));
}

export function mountFlagsView(left: HTMLElement, center: HTMLElement, right: HTMLElement): void {
  let current: string | null = null;
  const newBtn = h("button", { class: "btn small", title: "Note down a new flag for your events", onclick: () => newFlag() }, "+ New flag");
  const list = mountRecordList(left, {
    title: "Flags",
    head: [newBtn],
    placeholder: "Search flags…  (Ctrl+F)",
    searchId: "flags-search",
    items: () => {
      const s = spec();
      if (!s) return [];
      const uses = allUses();
      const keys = new Set([...uses.keys(), ...Object.keys(notes())]);
      // Gold/Silver: every named flag, used by a script or not
      if (s.numeric && s.name) for (let n = 0; n < 2048; n++) if (s.name(store.ctx, String(n))) keys.add(String(n));
      return [...keys]
        .sort((a, b) => (s.numeric ? Number(a) - Number(b) : a.localeCompare(b)))
        .map((key) => {
          const u = uses.get(key) ?? [];
          const note = flagNote(key);
          const first = u[0];
          const word = first ? KINDS.find(([k]) => k === first.kind)?.[2] : undefined;
          return {
            id: key,
            // the list is narrow: EVENT_ goes (the flag's page shows the whole name)
            label: flagTitle(key).replace(/(^| )EVENT_/, "$1"),
            meta: note || (first ? `${word}: ${first.label}${u.length > 1 ? ` +${u.length - 1}` : ""}` : "unused"),
            search: `${note}\n${u.map((x) => x.label).join("\n")}`,
            edited: !!note || u.some((x) => x.own),
          };
        });
    },
    current: () => current,
    pick: (id) => open(id),
    refreshOn: (reason) => {
      if (reason === "content" || reason === "edit") stamp++;
      return reason === "content" || reason === "edit";
    },
  });

  const main = h("div", { class: "ws-scroll" });
  const title = h("span", { class: "head-title" }, "Flags");
  center.append(h("div", { class: "panel-head" }, title), main);
  const side = h("div", { class: "ws-scroll" });
  right.append(h("div", { class: "panel-head" }, h("span", {}, "Help")), side);

  const open = (key: string) => {
    current = key;
    list.render();
    render(true);
    left.querySelector<HTMLElement>(`.map-row[data-id="${CSS.escape(key)}"]`)?.scrollIntoView({ block: "nearest" });
  };
  nav.openFlag = (key) => {
    nav.setWorkspace("events");
    nav.showEvents("flags");
    stamp++;
    open(key);
  };

  const setNote = (key: string, text: string) => {
    const s = spec();
    if (!s) return;
    const t = text.trim();
    store.setRecord(s.notes, key, `Flag note ${key}`, t ? { note: t } : undefined);
    store.seal();
  };

  const newFlag = () => {
    const s = spec();
    if (!s) return;
    let key: string | null;
    if (s.numeric) {
      const f = store.adapter.trainers?.objectTrainer?.freeFlag(store.ctx);
      key = typeof f === "number" ? String(f) : null;
      if (key === null) return void toast("No free event flag left", "error");
    } else {
      const raw = prompt("Name of the new flag (letters, digits, _):", `${(store.project.mod ?? "MOD").toUpperCase()}_`);
      key = raw ? raw.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_") : null;
      if (!key) return;
    }
    if (!notes()[key]) setNote(key, "New flag");
    open(key);
  };

  const useButton = (u: FlagUse) => {
    // an event says who it is itself ("After battle: NPC 2"), with its map
    const label = u.eventId ? (u.map ? `${u.map} · ${eventTitle(u.eventId)}` : eventTitle(u.eventId)) : u.label;
    const go = u.eventId ? () => nav.openEvent(u.eventId!)
      : u.map && u.layer && u.index !== undefined ? () => nav.selectEntity(u.map!, u.layer!, u.index!)
        : u.contact ? () => nav.openGlobal("phone")
          : u.map ? () => nav.openMap(u.map!) : null;
    return h("button", { class: `btn small ${u.own ? "" : "ghost"}`, disabled: !go, title: u.own ? "Your mod's" : "The game's", onclick: () => go?.() }, label);
  };

  const render = (force = false) => {
    if (force) clear(main);
    // Gen 1: the game's own talk events (a checkout) say which flags they use
    if (spec() && !spec()!.numeric) ensureGameEvents(() => {
      stamp++;
      list.render();
      render();
    });
    side.replaceChildren(
      h("p", { class: "hint" }, "Event flags remember what happened in the save: a person beaten, an item taken, a story step done. Events set, clear and check them."),
      h("p", { class: "hint" }, "Your flags (and the ones you noted) are listed first. A note is only for you: the game never reads it."),
      h("p", { class: "hint" }, FEATURES.gen2 && spec()?.numeric ? "Gold's flags are numbers. \"+ New flag\" takes one no map, script or note uses yet." : "Gen 1 flags are names: name yours after your mod (MYMOD_GOT_GIFT)."));
    const key = current;
    if (!spec() || !key) {
      title.textContent = "Flags";
      clear(main);
      main.append(h("p", { class: "hint empty" }, spec() ? "Pick a flag on the left, or note a new one with + New flag." : "This game has no flags view."));
      return;
    }
    title.textContent = `Flag ${flagTitle(key)}`;
    rerender(main, () => {
      const uses = allUses().get(key) ?? [];
      const note = h("textarea", { rows: 2, spellcheck: true, placeholder: "What is this flag for? (only for you, the game never reads it)" });
      note.value = flagNote(key);
      note.addEventListener("change", () => setNote(key, note.value));
      const out: HTMLElement[] = [
        h("section", { class: "card" }, h("h4", {}, "Note"), note),
        h("section", { class: "card" }, h("h4", {}, "Used by"),
          ...(uses.length
            ? KINDS.filter(([k]) => uses.some((u) => u.kind === k)).map(([k, heading]) =>
                h("div", { class: "flag-uses" }, h("span", { class: "field-label" }, heading), h("div", { class: "row wrap" }, ...uses.filter((u) => u.kind === k).map(useButton))))
            : [h("p", { class: "hint" }, "Nothing on the maps, in the game's scripts or in your events uses it yet.")]),
          !spec()!.numeric && gameEventsLoaded() === null
            ? h("p", { class: "hint" }, "The game's own scripts can only be read with a gen1recomp source checkout: here only its trainers and your mod's uses show.")
            : null),
      ];
      return out;
    });
  };
  store.on((reason) => {
    if (reason === "project") {
      current = null;
      stamp++;
      render(true);
    } else if (reason === "content" || reason === "edit") {
      stamp++;
      render();
    }
  });
  render(true);
}
