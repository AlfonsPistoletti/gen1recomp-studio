// Global > Oak's speech: the intro as a list of steps (src/lua/introRuntime.ts).
// The game's steps keep their texts in `text` records (edited in place); the
// mod's own steps get new text keys (STUDIO_INTRO_<n>). The Pokémon Oak shows
// is field.oakSpeech.demoSpecies. A question's answers can set flags that
// events check later.

import { clone } from "../core/merge.ts";
import { store } from "../core/store.ts";
import { REQUIRED_INTRO, VANILLA_INTRO, type IntroStep } from "../lua/introRuntime.ts";
import { attachCombo, comboInput, field, h, selectInput, toast } from "./dom.ts";
import { knownFlags } from "./eventEditor.ts";
import { textEditor } from "./textField.ts";

export const INTRO = "studio_intro";
const ID = "speech";
const NEW_TEXT = "STUDIO_INTRO_";
const MAX_CHOICES = 4;
// the choice menu is 12 tiles wide with its border (OakSpeech choice tw)
const CHOICE_MAX = 10;

type Speech = { steps: IntroStep[] };
const vanilla = (id: string) => VANILLA_INTRO.find((s) => s.id === id);
const speech = (): Speech => (store.table(INTRO)[ID] as Speech | undefined) ?? { steps: VANILLA_INTRO.map((s) => ({ id: s.id })) };

// a step as the game will run it: the game's own with the mod's keys on top
function full(s: IntroStep): IntroStep & { label?: string } {
  return { ...(vanilla(s.id) ?? {}), ...s };
}

const KIND_LABEL: Record<string, string> = {
  say: "Oak says", choice: "Question", yesno: "Yes or no", pic: "Picture",
  demo: "Shows a Pokémon", name: "Naming", shrink: "Shrinks away",
};

function set(label: string, mutate: (steps: IntroStep[]) => void): void {
  const next = clone(speech());
  mutate(next.steps);
  store.setRecord(INTRO, ID, label, next);
  store.seal();
}

// the Pokémon Oak shows: the game's (Yellow: Pikachu), or the mod's
function demoSpecies(): string {
  const cur = store.table("field").oakSpeech as { demoSpecies?: string } | undefined;
  return cur?.demoSpecies ?? (store.project.version === "yellow" ? "PIKACHU" : "NIDORINO");
}

// everything the speech changed, back to the game's in one step
export function revertIntro(): void {
  store.group("Oak's speech: the game's", () => {
    for (const k of Object.keys(store.table("text"))) if (k.startsWith(NEW_TEXT)) store.setRecord("text", k, "Oak's speech", undefined);
    for (const s of VANILLA_INTRO) if (s.textKey && store.isRecordEdited("text", s.textKey)) store.setRecord("text", s.textKey, "Oak's speech", clone(store.baseTable("text")[s.textKey]));
    store.setRecord(INTRO, ID, "Oak's speech", undefined);
    if (store.isRecordEdited("field", "oakSpeech")) store.setRecord("field", "oakSpeech", "Oak's speech", clone(store.baseTable("field").oakSpeech));
  });
  store.seal();
}

export function introEdited(): boolean {
  return store.isRecordEdited(INTRO, ID) || store.isRecordEdited("field", "oakSpeech")
    || VANILLA_INTRO.some((s) => s.textKey && store.isRecordEdited("text", s.textKey))
    || Object.keys(store.table("text")).some((k) => k.startsWith(NEW_TEXT));
}

// flags the speech's answers set (the event editor suggests them)
export function introFlags(): string[] {
  return speech().steps.flatMap((s) => s.flags ?? []).filter(Boolean);
}

// ------------------------------------------------------------------ pictures

const PIC_KINDS = ["", "oak", "rival", "player", "pokemon", "trainer"];
const PIC_LABEL: Record<string, string> = { "": "No picture", oak: "Oak", rival: "The rival", player: "The player", pokemon: "A Pokémon…", trainer: "A trainer…" };

function picKind(pic: IntroStep["pic"]): string {
  if (!pic) return "";
  if (typeof pic === "object") return pic.type === "trainer" ? "trainer" : "pokemon";
  return ["oak", "rival", "player"].includes(pic) ? pic : "pokemon";
}

function picEditor(s: IntroStep, i: number): HTMLElement {
  const f = full(s);
  const kind = picKind(f.pic);
  const mons = Object.keys(store.table("pokemon")).sort();
  const trainers = Object.keys(store.table("trainers")).sort();
  const setPic = (pic: IntroStep["pic"] | undefined) => set("Oak's speech: picture", (steps) => {
    if (pic === undefined) delete steps[i].pic;
    else steps[i].pic = pic;
  });
  const sel = selectInput(kind, PIC_KINDS, (v) => {
    if (v === "pokemon") setPic(mons.includes("MEW") ? "MEW" : mons[0]);
    else if (v === "trainer") setPic({ type: "trainer", id: trainers.includes("OPP_PROF_OAK") ? "OPP_PROF_OAK" : trainers[0] });
    else setPic(v || undefined);
  });
  for (const o of sel.options) o.textContent = PIC_LABEL[o.value] ?? o.value;
  const which = kind === "pokemon"
    ? comboInput(typeof f.pic === "string" ? f.pic : f.pic?.id ?? "", "dl-species", mons, (v) => (store.table("pokemon")[v] ? setPic(v) : toast(`${v} is not a Pokémon`, "error")))
    : kind === "trainer"
      ? selectInput(typeof f.pic === "object" ? f.pic.id ?? "" : "", trainers, (v) => setPic({ type: "trainer", id: v }))
      : null;
  const reveal = selectInput(f.reveal ?? "", ["", "fade", "wipe"], (v) => set("Oak's speech: how it appears", (steps) => {
    if (v) steps[i].reveal = v;
    else delete steps[i].reveal;
  }));
  for (const o of reveal.options) o.textContent = ({ "": "Appears at once", fade: "Fades in", wipe: "Slides in" } as Record<string, string>)[o.value];
  const cry = h("input", { type: "checkbox", checked: f.cry === true, onchange: () => set("Oak's speech: cry", (steps) => {
    if (cry.checked) steps[i].cry = true;
    else delete steps[i].cry;
  }) });
  return h("div", { class: "row wrap intro-pic" },
    field("Picture", sel), which ? field(kind === "pokemon" ? "Pokémon" : "Trainer", which) : null,
    kind ? field("How it appears", reveal) : null,
    kind === "pokemon" ? h("label", { class: "inline-check" }, cry, "Play its cry") : null,
  );
}

// ------------------------------------------------------------------ answers

function answersEditor(s: IntroStep, i: number): HTMLElement {
  const yesno = s.kind === "yesno";
  const labels = yesno ? ["YES", "NO"] : s.choices ?? [];
  const flags = s.flags ?? [];
  const rows = labels.map((label, k) => {
    const name = h("input", { type: "text", value: label, maxLength: CHOICE_MAX, spellcheck: false, disabled: yesno });
    name.addEventListener("change", () => {
      const v = name.value.trim().toUpperCase();
      if (!v) return toast("An answer needs a name", "error");
      set("Oak's speech: answer", (steps) => (steps[i].choices![k] = v));
    });
    const flag = h("input", { type: "text", value: flags[k] ?? "", spellcheck: false, class: "combo mono", placeholder: "no flag" });
    // the flags events and the game use, suggested like in the event editor
    attachCombo(flag, knownFlags, "flags");
    flag.addEventListener("change", () => {
      const v = flag.value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
      set("Oak's speech: answer flag", (steps) => {
        const f = [...(steps[i].flags ?? [])];
        while (f.length < labels.length) f.push("");
        f[k] = v;
        if (f.some(Boolean)) steps[i].flags = f;
        else delete steps[i].flags;
      });
    });
    const remove = !yesno && labels.length > 2
      ? h("button", { class: "btn small ghost", title: "Remove this answer", onclick: () => set("Oak's speech: remove answer", (steps) => {
          steps[i].choices = steps[i].choices!.filter((_, j) => j !== k);
          if (steps[i].flags) steps[i].flags = steps[i].flags!.filter((_, j) => j !== k);
        }) }, "✕")
      : null;
    return h("div", { class: "row nowrap intro-answer" }, name, h("span", { class: "muted" }, "sets"), flag, remove);
  });
  const add = !yesno && labels.length < MAX_CHOICES
    ? h("button", { class: "btn small", onclick: () => set("Oak's speech: add answer", (steps) => (steps[i].choices = [...(steps[i].choices ?? []), `ANSWER ${labels.length + 1}`])) }, "+ Answer")
    : null;
  return h("div", {},
    h("span", { class: "field-label" }, "Answers"),
    ...rows,
    add,
    h("p", { class: "hint" }, `Answers fit ${CHOICE_MAX} letters. A flag remembers the answer in the save: events can check it (If → flag).`),
  );
}

// ------------------------------------------------------------------ steps

function newStep(kind: "say" | "choice" | "yesno" | "pic"): IntroStep {
  const used = new Set(speech().steps.map((s) => s.id));
  let n = 1;
  while (used.has(`studio_${n}`) || store.table("text")[`${NEW_TEXT}${n}`] !== undefined) n++;
  const step: IntroStep = { id: `studio_${n}`, kind, pic: "oak" };
  if (kind !== "pic") step.textKey = `${NEW_TEXT}${n}`;
  if (kind === "choice") step.choices = ["YES", "NO"];
  return step;
}

const FIRST_TEXT: Record<string, string> = {
  say: "Here is something\nnew to say!",
  choice: "Which one do\nyou like?",
  yesno: "Do you like\nPOKéMON?",
};

// a new step after index `at` (-1: at the start), with its text
function insert(at: number, kind: "say" | "choice" | "yesno" | "pic"): void {
  const step = newStep(kind);
  store.group("Oak's speech: new step", () => {
    if (step.textKey) store.setRecord("text", step.textKey, "Oak's speech", FIRST_TEXT[kind]);
    const next = clone(speech());
    // never after the shrink: it ends the speech
    const shrink = next.steps.findIndex((s) => s.id === "shrink");
    next.steps.splice(Math.min(at + 1, shrink < 0 ? next.steps.length : shrink), 0, step);
    store.setRecord(INTRO, ID, "Oak's speech", next);
  });
  store.seal();
}

function remove(i: number): void {
  const s = speech().steps[i];
  store.group("Oak's speech: remove step", () => {
    if (!vanilla(s.id) && s.textKey) store.setRecord("text", s.textKey, "Oak's speech", undefined);
    const next = clone(speech());
    next.steps.splice(i, 1);
    store.setRecord(INTRO, ID, "Oak's speech", next);
  });
  store.seal();
}

function addMenu(at: number, label: string): HTMLElement {
  const sel = h("select", { class: "intro-add" },
    h("option", { value: "" }, label),
    h("option", { value: "say" }, "Oak says…"),
    h("option", { value: "choice" }, "A question with answers"),
    h("option", { value: "yesno" }, "A yes/no question"),
    h("option", { value: "pic" }, "A picture"),
  );
  sel.addEventListener("change", () => {
    const v = sel.value as "say" | "choice" | "yesno" | "pic" | "";
    sel.value = "";
    if (v) insert(at, v);
  });
  return sel;
}

function stepCard(s: IntroStep, i: number, count: number): HTMLElement {
  const f = full(s);
  const isShrink = s.id === "shrink";
  const move = (d: -1 | 1) => set("Oak's speech: move step", (steps) => {
    const [x] = steps.splice(i, 1);
    steps.splice(i + d, 0, x);
  });
  // the shrink ends the speech: nothing moves below it
  const lastMovable = count - 2;
  const title = f.label ?? (f.kind === "pic" ? "Picture" : f.kind === "choice" ? "Question" : f.kind === "yesno" ? "Yes or no" : "Oak says");
  const body: (HTMLElement | null)[] = [];
  if (f.kind === "demo") {
    const mons = Object.keys(store.table("pokemon")).sort();
    body.push(field("Pokémon Oak shows", comboInput(demoSpecies(), "dl-species", mons, (v) => {
      if (!store.table("pokemon")[v]) return toast(`${v} is not a Pokémon`, "error");
      const game = (store.baseTable("field").oakSpeech as { demoSpecies?: string } | undefined)?.demoSpecies;
      store.editRecord<Record<string, unknown>>("field", "oakSpeech", "Oak's speech: Pokémon", (d) => {
        if (v === (game ?? (store.project.version === "yellow" ? "PIKACHU" : "NIDORINO")) && !game) delete d.demoSpecies;
        else d.demoSpecies = v;
      }, { create: () => ({}) });
      store.seal();
    }), "Shown mirrored, with its cry, while Oak talks about Pokémon."));
  }
  if (f.kind === "say" || f.kind === "choice" || f.kind === "yesno" || f.kind === "pic") body.push(picEditor(s, i));
  if (f.textKey) body.push(textEditor(f.textKey, { rows: 4, label: "Text" }));
  if (f.kind === "choice" || f.kind === "yesno") body.push(answersEditor(s, i));
  if (f.kind === "name") body.push(h("p", { class: "hint" }, "The naming screen, with the names from New game. It can be moved but not removed."));
  if (isShrink) body.push(h("p", { class: "hint" }, "Ends the speech: the player's picture shrinks into the overworld. Always last."));
  return h("section", { class: "card intro-step" },
    h("div", { class: "card-head" },
      h("h4", {}, `${i + 1}. ${title}`, h("span", { class: "hint intro-kind" }, KIND_LABEL[f.kind ?? "say"] ?? "")),
      h("div", { class: "row nowrap" },
        h("button", { class: "btn small ghost", title: "Move up", disabled: i === 0 || isShrink, onclick: () => move(-1) }, "↑"),
        h("button", { class: "btn small ghost", title: "Move down", disabled: i >= lastMovable || isShrink, onclick: () => move(1) }, "↓"),
        h("button", { class: "btn small ghost danger", title: REQUIRED_INTRO.has(s.id) ? "The game needs this step" : "Remove this step", disabled: REQUIRED_INTRO.has(s.id), onclick: () => remove(i) }, "✕"),
      ),
    ),
    ...body,
    isShrink ? null : h("div", { class: "row" }, addMenu(i, "+ Insert a step below…")),
  );
}

export function introCards(): HTMLElement[] {
  const steps = speech().steps;
  const out: HTMLElement[] = [
    h("div", { class: "row" },
      addMenu(-1, "+ Insert a step at the start…"),
      introEdited() ? h("button", { class: "btn small danger", onclick: revertIntro }, "Back to the game's speech") : null,
    ),
  ];
  steps.forEach((s, i) => out.push(stepCard(s, i, steps.length)));
  return out;
}
