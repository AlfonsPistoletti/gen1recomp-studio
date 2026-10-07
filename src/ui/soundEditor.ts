// Music & sounds (Global > Music & sounds): the `music` and `sfx` registries.
// The game's own songs and sounds are sound-chip data the engine synthesizes
// while it runs; a mod adds or replaces them with files (gen1recomp
// src/core/Music.lua, Sound.lua): a song is { file } (looped whole) or
// { file, loopFile } (the intro plays once, then the loop part repeats), a
// sound { file }. Both registries are written with override: a file record
// can't be patched onto chip data. New songs show up in a map's Music menu
// and in the event commands Play music / Play sound.

import { addAsset, assetUrl, ASSET_TYPES } from "../core/assets.ts";
import { store } from "../core/store.ts";
import { errorText, field, h, toast } from "./dom.ts";

export const MUSIC = "music";
export const SFX = "sfx";
const AUDIO = Object.keys(ASSET_TYPES).filter((e) => ASSET_TYPES[e].startsWith("audio/"));
const MAX_SONG = 30 * 1024 * 1024;
const MAX_SOUND = 2 * 1024 * 1024;

interface FileDef {
  file?: string;
  loopFile?: string;
  [k: string]: unknown;
}

const table = (reg: string) => store.table(reg) as Record<string, FileDef | string>;
const base = (reg: string) => store.baseTable(reg) as Record<string, unknown>;
const fileOf = (reg: string, id: string): FileDef | null => {
  const v = table(reg)[id];
  return v && typeof v === "object" && typeof v.file === "string" ? v : null;
};
const shortName = (path: string | undefined) => (path ?? "").split("/").pop() ?? "";

export function songLabel(id: string): string {
  return id.replace(/^Music_/, "").replace(/([a-z])([A-Z0-9])/g, "$1 $2").replace(/_/g, " ");
}

export function soundsEdited(): boolean {
  return editedIds(MUSIC).length > 0 || editedIds(SFX).length > 0;
}

// changed records of a registry (added, replaced or reverted-to-nothing)
export function editedIds(reg: string): string[] {
  const ids = new Set([...Object.keys(table(reg)), ...Object.keys(base(reg))]);
  return [...ids].filter((id) => store.isRecordEdited(reg, id)).sort();
}

// ------------------------------------------------------------- playback

let playing: HTMLAudioElement[] = [];
function stopAll(): void {
  for (const a of playing) a.pause();
  playing = [];
}

// the intro once, then the loop part (or the file itself) on repeat
function play(def: FileDef): void {
  stopAll();
  const { host, version } = store.project;
  const first = new Audio(assetUrl(host, version, def.file));
  playing.push(first);
  if (def.loopFile) {
    const loop = new Audio(assetUrl(host, version, def.loopFile));
    loop.loop = true;
    playing.push(loop);
    first.addEventListener("ended", () => {
      if (playing.includes(loop)) loop.play().catch((err) => toast(errorText(err), "error"));
    });
  } else {
    first.loop = true;
  }
  first.play().catch((err) => toast(errorText(err), "error"));
}

function playButtons(def: FileDef, sound = false): HTMLElement[] {
  return [
    h("button", { class: "btn small", title: sound ? "Play the sound" : "Play (the intro, then the loop part on repeat)", onclick: () => (sound ? playOnce(def) : play(def)) }, "▶"),
    sound ? h("span", {}) : h("button", { class: "btn small ghost", title: "Stop", onclick: stopAll }, "■"),
  ];
}

function playOnce(def: FileDef): void {
  stopAll();
  const a = new Audio(assetUrl(store.project.host, store.project.version, def.file));
  playing.push(a);
  a.play().catch((err) => toast(errorText(err), "error"));
}

// ------------------------------------------------------------- importing

function pickAudio(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = h("input", { type: "file", accept: AUDIO.map((e) => `.${e}`).join(",") });
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null));
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

// the file as a mod asset path, or null (with a message) when it can't be
async function importFile(file: File, name: string, max: number): Promise<string | null> {
  const mod = store.project.mod;
  if (!mod) {
    toast("Choose or create a mod first: the sound is saved into it", "error");
    return null;
  }
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!AUDIO.includes(ext)) {
    toast(`Use a ${AUDIO.map((e) => e.toUpperCase()).join(", ")} file`, "error");
    return null;
  }
  if (file.size > max) {
    toast(`That file is over ${Math.round(max / 1024 / 1024)} MB`, "error");
    return null;
  }
  try {
    return addAsset(mod, name.toLowerCase(), new Uint8Array(await file.arrayBuffer()), ext);
  } catch (err) {
    toast(errorText(err), "error");
    return null;
  }
}

function set(reg: string, id: string, label: string, value: FileDef | undefined): void {
  store.setRecord(reg, id, label, value);
  store.seal();
}

// ------------------------------------------------------------- who uses it

function songUsers(id: string): string[] {
  const maps = Object.entries(store.table("map_songs")).filter(([, s]) => s === id).map(([m]) => m);
  return [...maps, ...eventUsers("play_music", id)];
}

function eventUsers(verb: string, id: string): string[] {
  const reg = store.adapter.events?.registry;
  if (!reg) return [];
  const needle = JSON.stringify([verb, id]).slice(1, -1);
  return Object.entries(store.table(reg)).filter(([, ev]) => JSON.stringify(ev).includes(needle)).map(([e]) => `event ${e}`);
}

// ------------------------------------------------------------- cards

export function soundCards(): HTMLElement[] {
  return [
    listCard(MUSIC),
    listCard(SFX),
    h("p", { class: "hint" }, `${AUDIO.map((e) => e.toUpperCase()).join(", ")}. OGG keeps songs small. The game's own songs and sounds can't be played here: the game makes them with its sound chip while it runs.`),
  ];
}

// a just-created song or sound: its row is scrolled into view once
let reveal: string | null = null;

// Every song (or sound effect) in one list: the game's and the mod's own,
// alphabetical; a new one joins the list.
function listCard(reg: string): HTMLElement {
  const song = reg === MUSIC;
  const label = (id: string) => (song ? songLabel(id) : id);
  const used = new Map<string, number>();
  if (song) for (const v of Object.values(store.table("map_songs"))) if (typeof v === "string") used.set(v, (used.get(v) ?? 0) + 1);
  const ids = Object.keys(table(reg)).sort((x, y) => label(x).localeCompare(label(y)));
  const max = song ? MAX_SONG : MAX_SOUND;
  const fileName = (id: string, suffix = "") => `${song ? "" : "sfx_"}${id}${suffix}`;

  const rows = ids.map((id) => {
    const isOwn = base(reg)[id] === undefined;
    const def = fileOf(reg, id);
    const n = used.get(id) ?? 0;
    const status = def
      ? `${isOwn ? "" : "your file: "}${shortName(def.file)}${def.loopFile ? ` → ${shortName(def.loopFile)} (repeats)` : ""}`
      : n ? `${n} map${n === 1 ? "" : "s"}` : "";
    const replace = h("button", {
      class: "btn small ghost",
      title: isOwn ? "A new file for this one" : "Play your own file wherever the game plays this",
      onclick: async () => {
        const f = await pickAudio();
        const path = f && (await importFile(f, fileName(id), max));
        if (path) set(reg, id, `${id}: new file`, { ...(def ?? {}), file: path });
      },
    }, def ? "Replace file…" : "Replace with a file…");
    const loopBtn = !song || !def
      ? null
      : def.loopFile
        ? h("button", { class: "btn small ghost", title: "Repeat the whole file instead", onclick: () => set(reg, id, "Song: no loop part", { file: def.file }) }, "No loop part")
        : h("button", {
            class: "btn small ghost",
            title: "A second file that repeats after this one played once (this one becomes the intro)",
            onclick: async () => {
              const f = await pickAudio();
              const path = f && (await importFile(f, fileName(id, "_loop"), max));
              if (path) set(reg, id, "Song: loop part", { ...def, loopFile: path });
            },
          }, "+ Loop part…");
    const undo = isOwn
      ? h("button", {
          class: "btn small ghost danger",
          onclick: () => {
            const users = song ? songUsers(id) : eventUsers("play_sound", id);
            if (users.length) return toast(`${label(id)} is still used by ${users.join(", ")}. Pick another one there first.`, "error");
            stopAll();
            set(reg, id, `Delete ${id}`, undefined);
          },
        }, "Delete")
      : store.isRecordEdited(reg, id)
        ? h("button", { class: "btn small ghost danger", onclick: () => { stopAll(); store.revertRecord(reg, id, `${id}: the game's`); } }, "Back to the game's")
        : null;
    const row = h("div", { class: "sound-row" },
      h("span", { class: "sound-name" }, label(id), isOwn ? h("span", { class: "tag new" }, "new") : def ? h("span", { class: "tag" }, "replaced") : null),
      h("span", { class: "hint" }, status),
      ...(def ? playButtons(def, !song) : []),
      replace,
      loopBtn,
      undo,
    );
    if (id === reveal) {
      reveal = null;
      row.classList.add("flash");
      requestAnimationFrame(() => row.scrollIntoView({ block: "nearest" }));
    }
    return row;
  });
  return h("section", { class: "card" },
    h("div", { class: "card-head" },
      h("h4", {}, song ? `Songs (${ids.length})` : `Sound effects (${ids.length})`),
      h("button", { class: "btn small primary-ish", onclick: song ? newSong : newSound }, song ? "+ New song…" : "+ New sound…"),
    ),
    h("p", { class: "hint" }, song
      ? "Replacing a game song plays your file everywhere the game plays it (maps, battles, jingles); where the game plays a song once, your file plays once too. New songs can be a map's music (map properties) and play in the Play music event command."
      : "Replacing a game sound plays your file wherever the game uses it. New sounds play with the Play sound event command."),
    h("div", { class: "sound-list" }, ...rows),
  );
}

async function newSong(): Promise<void> {
  const res = await promptNew("New song", "Music_", "The song's id, after Music_ (letters, digits and _).", true);
  if (!res) return;
  const file = await importFile(res.file, res.id, MAX_SONG);
  if (!file) return;
  const loop = res.loop ? await importFile(res.loop, `${res.id}_loop`, MAX_SONG) : null;
  reveal = res.id;
  set(MUSIC, res.id, `New song ${res.id}`, loop ? { file, loopFile: loop } : { file });
}

async function newSound(): Promise<void> {
  const res = await promptNew("New sound effect", "", "The sound's id (letters, digits and _), e.g. Doorbell.", false);
  if (!res) return;
  const file = await importFile(res.file, `sfx_${res.id}`, MAX_SOUND);
  if (!file) return;
  reveal = res.id;
  set(SFX, res.id, `New sound ${res.id}`, { file });
}

// a dialog for a new song or sound: its id, the file, and (songs) an
// optional loop part
function promptNew(title: string, prefix: string, hint: string, song: boolean): Promise<{ id: string; file: File; loop: File | null } | null> {
  return new Promise((resolve) => {
    const dialog = h("dialog", {});
    const name = h("input", { type: "text", spellcheck: false, placeholder: song ? "MyTown" : "Doorbell" });
    const accept = AUDIO.map((e) => `.${e}`).join(",");
    const file = h("input", { type: "file", accept });
    const loop = h("input", { type: "file", accept });
    const close = (v: { id: string; file: File; loop: File | null } | null) => {
      dialog.close();
      dialog.remove();
      resolve(v);
    };
    const go = () => {
      const raw = name.value.trim().replace(/\s+/g, "_");
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(raw)) return toast("Use letters, digits and _, starting with a letter", "error");
      const id = prefix + raw;
      const reg = song ? MUSIC : SFX;
      if (table(reg)[id] !== undefined) return toast(`${id} already exists`, "error");
      const f = file.files?.[0];
      if (!f) return toast("Pick a file", "error");
      close({ id, file: f, loop: song ? loop.files?.[0] ?? null : null });
    };
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      close(null);
    });
    dialog.append(
      h("h3", {}, title),
      field(prefix ? `Id (${prefix}…)` : "Id", name, hint),
      field(song ? "File (the intro, or the whole song)" : "File", file),
      ...(song ? [field("Loop part (optional)", loop, "Repeats after the file above played once. Without it the file above repeats as a whole.")] : []),
      h("div", { class: "dialog-actions" }, h("button", { class: "btn", onclick: () => close(null) }, "Cancel"), h("button", { class: "btn primary", onclick: go }, "Create")),
    );
    document.body.append(dialog);
    dialog.showModal();
    name.focus();
  });
}
