// Gen 1: when a map person is there. A person starts as its object's `hidden`
// says, and the game's scripts flip it (towns.toggles, restated); the mod's own
// events do with Show / Hide person rows; a rule (studio_visibility, written by
// src/lua/visibilityRuntime.ts) shows it only while a flag is (not) set.
import { store } from "../core/store.ts";
import type { EntityRecord, MapDef } from "../core/types.ts";
import { attachCombo, field, h, selectInput } from "./dom.ts";
import { knownFlags, splitEventId } from "./eventEditor.ts";
import { isItemBall } from "./inspector.ts";
import { nav } from "./nav.ts";

export const VISIBILITY = "studio_visibility";
type Rule = { flag: string; whileSet?: boolean };

// the mod's events with a row that shows / hides this person
function modEvents(mapId: string, name: string): { id: string; show: boolean }[] {
  const reg = store.adapter.events?.registry;
  if (!reg) return [];
  const out: { id: string; show: boolean }[] = [];
  for (const [id, ev] of Object.entries(store.table(reg) as Record<string, { rows?: unknown[] }>)) {
    const walk = (v: unknown) => {
      if (!Array.isArray(v)) return;
      if ((v[0] === "show_object" || v[0] === "hide_object") && v[1] === mapId && v[2] === name) out.push({ id, show: v[0] === "show_object" });
      else v.forEach(walk);
    };
    walk(ev.rows);
  }
  return out;
}

export function visibilitySection(map: MapDef, record: EntityRecord): HTMLElement | null {
  const toggles = store.adapter.towns?.toggles;
  const name = record.name;
  if (!toggles || typeof name !== "string" || !store.adapter.content.some((c) => c.registry === VISIBILITY)) return null;
  const version = store.project.version;
  const lines: string[] = [record.hidden ? "Starts hidden." : "Starts shown."];
  if (isItemBall(record)) lines.push("Gone for good once picked up.");
  if (record.pokemon) lines.push("Gone for good once beaten.");
  for (const t of toggles) {
    if (t.map === map.id && t.objects.includes(name) && (!t.versions || t.versions.includes(version))) lines.push(`${t.show ? "Shown" : "Hidden"} when ${t.when}.`);
  }
  const key = `${map.id}:${name}`;
  const rule = store.table(VISIBILITY)[key] as Rule | undefined;
  // read fresh: the inspector isn't redrawn for this record, the fields follow by hand
  const current = () => store.table(VISIBILITY)[key] as Rule | undefined;
  const set = (label: string, next: Rule | undefined) => {
    store.setRecord(VISIBILITY, key, label, next);
    store.seal();
    flag.value = next?.flag ?? "";
    flag.disabled = !next;
  };
  // a flag of its own: <MOD>_<MAP>_NPC_<object index>
  const fresh = () => `${store.project.mod ?? "MOD"}_${map.id}_NPC_${String(record.index ?? "")}`.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  const mode = selectInput(rule ? (rule.whileSet === false ? "unset" : "set") : "", ["", "set", "unset"], (v) =>
    set("Visibility rule", v ? { flag: current()?.flag ?? fresh(), ...(v === "unset" ? { whileSet: false } : {}) } : undefined));
  mode.options[0].textContent = "No rule of the mod's";
  mode.options[1].textContent = "Only while a flag is set";
  mode.options[2].textContent = "Only while a flag is not set";
  const flag = h("input", { type: "text", value: rule?.flag ?? "", spellcheck: false, class: "combo mono", disabled: !rule });
  attachCombo(flag, knownFlags, "flags");
  flag.addEventListener("change", () => {
    const v = flag.value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
    const r = current();
    if (r && v) set("Visibility rule flag", { ...r, flag: v });
  });
  const mine = modEvents(map.id, name);
  return h("div", { class: "npc-text" },
    ...lines.map((l) => h("p", { class: "hint" }, l)),
    ...(mine.length ? [h("div", { class: "row wrap" },
      h("span", { class: "hint" }, "Your events:"),
      ...mine.map((m) => h("button", { class: "btn small ghost", title: `This event ${m.show ? "shows" : "hides"} the person`, onclick: () => nav.openEvent(m.id) }, `${m.show ? "Shows" : "Hides"}: ${splitEventId(m.id).key}`)))] : []),
    field("Rule", h("div", { class: "row nowrap" }, mode, flag), "Applied every time the player enters this map. An event that sets the flag while the player is here should also show or hide the person (Show NPC / Hide NPC)."),
  );
}
