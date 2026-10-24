// Gen 2 own held item effects (Items > a Gold item > When held): rules on top
// of the game's held effect, kept in studio_held_effects (item id -> { rules })
// and run by src/lua/heldEffectRuntime2.ts through the battle hooks. Each rule
// is one sentence of drop-downs and numbers; the list is in the order they act.

import { store } from "../core/store.ts";
import { h, numberInput, selectInput } from "./dom.ts";

type Rule = Record<string, unknown> & { kind: string };
type Moment = "first" | "attack" | "hit" | "always" | "turn";

// what an item can do, by moment, with the fields each rule starts with
const KINDS: { kind: string; moment: Moment; label: string; init: Rule }[] = [
  { kind: "first", moment: "first", label: "Chance to move first", init: { kind: "first", chance: 20 } },
  { kind: "boost", moment: "attack", label: "More damage", init: { kind: "boost", percent: 20, on: "all" } },
  { kind: "crit", moment: "attack", label: "Critical hits more likely", init: { kind: "crit", stages: 1 } },
  { kind: "flinch", moment: "attack", label: "Chance to make the target flinch", init: { kind: "flinch", chance: 10 } },
  { kind: "guard", moment: "hit", label: "Less damage taken", init: { kind: "guard", percent: 20, on: "all" } },
  { kind: "evade", moment: "hit", label: "Moves miss it more often", init: { kind: "evade", chance: 10 } },
  { kind: "endure", moment: "hit", label: "Chance to hold on with 1 HP", init: { kind: "endure", chance: 12 } },
  { kind: "noconfuse", moment: "always", label: "Can't be confused", init: { kind: "noconfuse" } },
  { kind: "heal", moment: "turn", label: "Heal HP", init: { kind: "heal", percent: 6, below: 0 } },
  { kind: "drain", moment: "turn", label: "Heal from the damage it dealt", init: { kind: "drain", percent: 12 } },
  { kind: "hurt", moment: "turn", label: "Lose HP", init: { kind: "hurt", percent: 12 } },
  { kind: "cure", moment: "turn", label: "Cure a status", init: { kind: "cure", status: "any" } },
  { kind: "raise", moment: "turn", label: "Raise a stat", init: { kind: "raise", stat: "attack", stages: 1, below: 25 } },
  { kind: "pp", moment: "turn", label: "Restore PP when a move runs out", init: { kind: "pp" } },
];
const MOMENTS: [Moment, string][] = [
  ["first", "Choosing who moves first"],
  ["attack", "When it attacks"],
  ["hit", "When it is hit"],
  ["always", "Always"],
  ["turn", "At the end of each turn"],
];
const ON: [string, string][] = [["all", "all moves"], ["type", "moves of one type"], ["physical", "physical moves"], ["special", "special moves"], ["super", "super effective hits"]];
const STATUSES: [string, string][] = [["any", "any status (and confusion)"], ["sleep", "sleep"], ["poison", "poison"], ["burn", "a burn"], ["freeze", "freezing"], ["paralyze", "paralysis"], ["confusion", "confusion"]];
const STATS: [string, string][] = [["attack", "Attack"], ["defense", "Defense"], ["speed", "Speed"], ["specialAttack", "Special Attack"], ["specialDefense", "Special Defense"], ["accuracy", "accuracy"], ["evasion", "evasion"]];

const choice = (value: unknown, options: [string, string][], set: (v: string) => void) => {
  const sel = selectInput(String(value ?? options[0][0]), options.map(([v]) => v), set);
  for (const o of sel.options) o.textContent = options.find(([v]) => v === o.value)?.[1] ?? o.value;
  return sel;
};
const words = (t: string) => h("span", {}, t);

// the battle message an end-of-turn rule shows when it has no own text
// (heldEffectRuntime2.ts says the same); {USER} the holder, {ITEM} the item
const DEFAULT_TEXT: Record<string, string> = {
  heal: "{USER}\nrecovered using\n{ITEM}!",
  drain: "{USER}\nrecovered using\n{ITEM}!",
  hurt: "{USER}\nwas hurt by\n{ITEM}!",
  cure: "{USER}\nrecovered using\n{ITEM}!",
  raise: "{USER}\nused {ITEM}!",
};
// the battle text box: 18 letters a line (more lines scroll); a sample holder (a foe's says "Enemy …")
const BOX = 18;
const SAMPLE_USER = "PIKACHU";

export function heldRulesSection(registry: string, itemId: string): HTMLElement {
  const spec = store.table(registry)[itemId] as { rules?: Rule[]; usedUp?: boolean } | undefined;
  // older saves ticked "used up" per effect: it counts for the whole item
  const spent = spec?.usedUp === true || (spec?.rules ?? []).some((r) => r.usedUp === true);
  const rules = (spec?.rules ?? []).map(({ usedUp: _old, ...r }) => ({ ...r }) as Rule);
  const write = (label: string, next: Rule[], usedUp = spent) => {
    store.setRecord(registry, itemId, label, next.length ? { rules: next, ...(usedUp ? { usedUp: true } : {}) } : undefined);
    store.seal();
  };
  // like a Berry: the item is gone once any of its effects acted (end-of-turn effects at once, the
  // others at the end of that turn); unticked it is kept, like Leftovers
  const usedUpBox = h("input", { type: "checkbox", checked: spent });
  usedUpBox.addEventListener("change", () => write(usedUpBox.checked ? "Held item used up" : "Held item kept", rules, usedUpBox.checked));
  const types = Object.entries(store.table("type_chart") as Record<string, { category?: unknown; name?: unknown }>)
    .filter(([id, t]) => !id.includes(">") && t && typeof t === "object" && t.category !== undefined)
    .map(([id, t]): [string, string] => [id, String(t.name ?? id)]);

  const row = (r: Rule, i: number): HTMLElement => {
    const set = (key: string, value: unknown, label = "Held effect") => {
      const next = rules.map((x) => ({ ...x }));
      next[i] = { ...next[i], [key]: value };
      write(label, next);
    };
    const num = (key: string, min: number, max: number) => numberInput(Number(r[key] ?? 0), (v) => set(key, Math.max(min, Math.min(max, v))), min, max);
    // the message in battle: the default until changed, previewed as the game's text box
    const message = () => {
      const def = DEFAULT_TEXT[r.kind] ?? "";
      const item = String((store.table("items")[itemId] as { name?: unknown } | undefined)?.name ?? itemId);
      const area = h("textarea", { rows: 2, spellcheck: false, class: "mono" });
      area.value = typeof r.text === "string" ? r.text : def;
      const box = h("div", { class: "gb-preview" });
      const show = () => {
        const lines = (area.value.trim() ? area.value : def).replace(/\r/g, "").split("\n");
        const filled = lines.map((l) => l.replace(/\{USER\}/g, SAMPLE_USER).replace(/\{ITEM\}/g, item));
        box.replaceChildren(h("div", { class: "gb-box" },
          ...filled.map((l) => h("div", { class: `gb-line${l.length > BOX ? " wide" : ""}` }, l || " "))));
        if (filled.some((l) => l.length > BOX)) box.append(h("p", { class: "hint warn" }, `A line holds ${BOX} letters (longer names make it wider).`));
      };
      area.addEventListener("input", show);
      area.addEventListener("change", () => {
        const v = area.value.replace(/\r/g, "");
        set("text", !v.trim() || v === def ? undefined : v, "Held effect message");
      });
      show();
      return h("div", { class: "held-message" },
        h("span", { class: "field-label" }, "Message in battle"),
        h("div", { class: "row wrap" }, area, box),
        h("p", { class: "hint" }, "{USER}: the holder's name (\"Enemy …\" for a foe's), {ITEM}: the item's name. Each line break starts a new line; more than two scroll on, as the game's own messages do. Empty: the default."));
    };
    const target = () => [
      choice(r.on, ON, (v) => set("on", v)),
      r.on === "type" ? choice(r.type ?? types[0]?.[0], types, (v) => set("type", v)) : null,
    ];
    let parts: (HTMLElement | null)[];
    switch (r.kind) {
      case "first": parts = [num("chance", 1, 100), words("% chance to move first when both moves have the same priority")]; break;
      case "boost": parts = [words("Damage +"), num("percent", 1, 400), words("% for"), ...target(), words("while its HP is below"), num("below", 0, 100), words("% (0: always)")]; break;
      case "crit": parts = [words("Critical hits more likely by"), choice(r.stages, [["1", "one step"], ["2", "two steps"]], (v) => set("stages", Number(v)))]; break;
      case "flinch": parts = [num("chance", 1, 100), words("% chance to make the target flinch (moves that can, as with King's Rock)")]; break;
      case "guard": parts = [words("Damage taken −"), num("percent", 1, 100), words("% from"), ...target()]; break;
      case "evade": parts = [words("Moves aimed at it miss"), num("chance", 1, 100), words("% more often")]; break;
      case "endure": parts = [num("chance", 1, 100), words("% chance to hold on with 1 HP after a hit that would make it faint")]; break;
      case "noconfuse": parts = [words("Can't be confused")]; break;
      case "heal": parts = [words("Heal"), num("percent", 1, 100), words("% of max HP when its HP is below"), num("below", 0, 100), words("% (0: every turn)"), message()]; break;
      case "drain": parts = [words("Heal"), num("percent", 1, 100), words("% of the damage it dealt this turn"), message()]; break;
      case "hurt": parts = [words("Lose"), num("percent", 1, 100), words("% of max HP (never below 1 HP)"), message()]; break;
      case "cure": parts = [words("Cure"), choice(r.status, STATUSES, (v) => set("status", v)), message()]; break;
      case "raise": parts = [words("Raise"), choice(r.stat, STATS, (v) => set("stat", v)), words("by"), choice(r.stages, [["1", "1"], ["2", "2"]], (v) => set("stages", Number(v))), words("when its HP is below"), num("below", 0, 100), words("% (0: every turn)"), message()]; break;
      case "pp": parts = [words("Restore 5 PP to a move that runs out (always used up: the game's Mystery Berry)")]; break;
      default: parts = [words(`Unknown effect ${r.kind}`)];
    }
    return h("div", { class: "row wrap held-rule" }, ...parts,
      h("button", { class: "btn small ghost", title: "Remove this effect", onclick: () => write("Remove held effect", rules.filter((_, j) => j !== i)) }, "✕"));
  };

  const add = h("select", { class: "held-add" },
    h("option", { value: "" }, "+ Add an effect…"),
    ...MOMENTS.map(([m, label]) => h("optgroup", { label }, ...KINDS.filter((k) => k.moment === m).map((k) => h("option", { value: k.kind }, k.label)))));
  add.addEventListener("change", () => {
    const k = KINDS.find((x) => x.kind === add.value);
    add.value = "";
    if (k) write(`Held effect: ${k.label}`, [...rules, { ...k.init }]);
  });

  return h("div", { class: "held-rules" },
    h("span", { class: "field-label" }, "Own effects"),
    rules.length
      ? h("label", { class: "inline-check", title: "Like a Berry: once any of these effects acted, the item is gone. Unticked, it is kept like Leftovers." },
          usedUpBox, "The item is used up once one of its effects acts (like a Berry)")
      : null,
    ...MOMENTS.flatMap(([m, label]) => {
      const mine = rules.map((r, i) => [r, i] as const).filter(([r]) => KINDS.find((k) => k.kind === r.kind)?.moment === m);
      return mine.length ? [h("span", { class: "hint" }, label), ...mine.map(([r, i]) => row(r, i))] : [];
    }),
    h("div", { class: "row wrap" },
      add,
      rules.length ? h("button", { class: "btn small danger", onclick: () => write("Back to the game's held effect", []) }, "Back to the game's effect only") : null),
    h("p", { class: "hint" }, rules.length
      ? "These act on top of the game's held effect above (set it to Nothing for only these)."
      : "Own effects act on top of the game's held effect: combine as many as you like."),
  );
}
