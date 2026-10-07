// A Pokémon's cry. The game plays cries[<species id>]: the game's own sound
// chip data (synthesized while playing), another species' cry, or a sound
// file the mod ships (WAV, OGG, MP3 or FLAC: what the engine's audio plays).
// The studio imports files and borrows cries; it does not synthesize. For a
// new Gen 1 style cry there is a link to an outside synthesizer.

import { addAsset, assetUrl, AUDIO_EXTS as AUDIO } from "../core/assets.ts";
import { clone } from "../core/merge.ts";
import { store } from "../core/store.ts";
import { errorText, h, selectInput, toast } from "./dom.ts";

const REG = "cries";
const SYNTH = "https://ardean.github.io/pokemon-gen1-cry-synthesizer/";
// a cry is a second or two; anything much bigger is likely the wrong file
const MAX_BYTES = 2 * 1024 * 1024;

interface CryDef {
  file?: string;
  base?: string;
  header?: unknown;
  chip?: unknown;
  pitch?: number;
  length?: number;
}

function cries(): Record<string, CryDef> {
  return store.table(REG) as Record<string, CryDef>;
}

const nameOf = (id: string) => String((store.table("pokemon")[id] as { name?: string } | undefined)?.name ?? id);

// What a new species copied from `source` should cry with: a reference to the
// source's chip cry, or a copy of its file.
export function cryFor(source: string): CryDef | undefined {
  const def = cries()[source];
  if (!def) return undefined;
  if (def.file) return clone(def);
  return { base: def.base ?? source };
}

function describe(def: CryDef | undefined): string {
  if (!def) return "No cry: this Pokémon is silent.";
  if (def.file) return `Imported sound: ${def.file.split("/").pop()}`;
  if (def.base) return `${nameOf(def.base)}'s cry${def.pitch !== undefined || def.length !== undefined ? ` (pitch ${def.pitch ?? "same"}, length ${def.length ?? "same"})` : ""}.`;
  return "The game's own cry (the game synthesizes it while playing).";
}

export function cryCard(id: string): HTMLElement {
  const def = cries()[id];
  const base = store.baseTable(REG)[id] as CryDef | undefined;
  const set = (label: string, value: CryDef | undefined) => {
    store.setRecord(REG, id, label, value);
    store.seal();
  };
  const file = h("input", { type: "file", accept: AUDIO.map((e) => `.${e}`).join(","), hidden: true });
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    file.value = "";
    if (!f) return;
    const mod = store.project.mod;
    if (!mod) return toast("Choose or create a mod first: the sound is saved into it", "error");
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    if (!AUDIO.includes(ext)) return toast(`Use a ${AUDIO.map((e) => e.toUpperCase()).join(", ")} file`, "error");
    if (f.size > MAX_BYTES) return toast("That file is over 2 MB; a cry is usually a second or two", "error");
    try {
      const data = new Uint8Array(await f.arrayBuffer());
      set("Import cry", { file: addAsset(mod, `${id}_cry`, data, ext) });
    } catch (err) {
      toast(errorText(err), "error");
    }
  });

  const play = def?.file
    ? h("button", {
        class: "btn small",
        title: "Play the imported sound",
        onclick: () => {
          const url = assetUrl(store.project.host, store.project.version, def.file);
          new Audio(url).play().catch((err) => toast(errorText(err), "error"));
        },
      }, "▶ Play")
    : null;

  const others = Object.keys(store.table("pokemon"))
    .filter((p) => p !== id && cries()[p])
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const borrow = selectInput(def?.base ?? "", others, (v) => v && set("Borrow cry", cryFor(v)), "Use the cry of…");
  for (const o of borrow.options) if (o.value) o.textContent = nameOf(o.value);

  return h(
    "section",
    { class: "card" },
    h("h4", {}, "Cry"),
    h("div", { class: "row" }, h("span", {}, describe(def)), play),
    h(
      "div",
      { class: "row" },
      h("button", { class: "btn small", onclick: () => file.click() }, "Import sound…"),
      borrow,
      base && JSON.stringify(base) !== JSON.stringify(def)
        ? h("button", { class: "btn small ghost", onclick: () => set("Revert cry", clone(base)) }, "Back to the game's cry")
        : null,
      file,
    ),
    h(
      "p",
      { class: "hint" },
      `${AUDIO.map((e) => e.toUpperCase()).join(", ")}; keep it short. The game's own cries can't be played here (the game makes them while it runs). For a new Gen 1 style cry: `,
      h("button", { class: "linkish", onclick: () => store.project.host.openUrl(SYNTH).catch((err) => toast(errorText(err), "error")) }, "Gen 1 cry synthesizer ↗"),
      ", export it as .wav, then import it here.",
    ),
  );
}
