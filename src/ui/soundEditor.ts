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
const own = (reg: string) => Object.keys(table(reg)).filter((id) => base(reg)[id] === undefined).sort();
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
  const songs = Object.keys(table(MUSIC));
  return [
    ownSongsCard(),
    gameSongsCard(songs.filter((id) => base(MUSIC)[id] !== undefined)),
    soundsCard(),
    h("p", { class: "hint" }, `${AUDIO.map((e) => e.toUpperCase()).join(", ")}. OGG keeps songs small. The game's own songs and sounds can't be played here: the game makes them with its sound chip while it runs.`),
  ];
}

function ownSongsCard(): HTMLElement {
  const rows = own(MUSIC).map((id) => {
    const def = fileOf(MUSIC, id) ?? {};
    const loopBtn = def.loopFile
      ? h("button", { class: "btn small ghost", title: "Loop the whole file instead", onclick: () => set(MUSIC, id, "Song: no loop part", { file: def.file }) }, "No loop part")
      : h("button", {
          class: "btn small ghost",
          title: "A second file that repeats after this one played once (the file above becomes the intro)",
          onclick: async () => {
            const f = await pickAudio();
            const path = f && (await importFile(f, `${id}_loop`, MAX_SONG));
            if (path) set(MUSIC, id, "Song: loop part", { ...def, loopFile: path });
          },
        }, "+ Loop part…");
    return h("div", { class: "sound-row" },
      h("span", { class: "sound-name" }, songLabel(id), h("span", { class: "hint mono" }, ` ${id}`)),
      h("span", { class: "hint" }, def.loopFile ? `${shortName(def.file)} → ${shortName(def.loopFile)} (repeats)` : `${shortName(def.file)} (repeats)`),
      ...playButtons(def),
      h("button", {
        class: "btn small ghost",
        onclick: async () => {
          const f = await pickAudio();
          const path = f && (await importFile(f, id, MAX_SONG));
          if (path) set(MUSIC, id, "Song: new file", { ...def, file: path });
        },
      }, "Replace file…"),
      loopBtn,
      h("button", {
        class: "btn small ghost danger",
        onclick: () => {
          const users = songUsers(id);
          if (users.length) return toast(`${songLabel(id)} is still used by ${users.join(", ")}. Pick another song there first.`, "error");
          stopAll();
          set(MUSIC, id, `Delete song ${id}`, undefined);
        },
      }, "Delete"),
    );
  });
  return h("section", { class: "card" },
    h("div", { class: "card-head" }, h("h4", {}, "Your songs"), h("button", { class: "btn small primary-ish", onclick: newSong }, "+ New song…")),
    ...(rows.length ? rows : [h("p", { class: "hint" }, "No songs yet. A new song can be picked as a map's music (map properties) and in the Play music event command.")]),
  );
}

async function newSong(): Promise<void> {
  const res = await promptNew("New song", "Music_", "The song's id, after Music_ (letters, digits and _).", true);
  if (!res) return;
  const file = await importFile(res.file, res.id, MAX_SONG);
  if (!file) return;
  const loop = res.loop ? await importFile(res.loop, `${res.id}_loop`, MAX_SONG) : null;
  set(MUSIC, res.id, `New song ${res.id}`, loop ? { file, loopFile: loop } : { file });
}

function gameSongsCard(ids: string[]): HTMLElement {
  const used = new Map<string, number>();
  for (const s of Object.values(store.table("map_songs"))) if (typeof s === "string") used.set(s, (used.get(s) ?? 0) + 1);
  const rows = ids.sort((a, b) => songLabel(a).localeCompare(songLabel(b))).map((id) => {
    const def = fileOf(MUSIC, id);
    const n = used.get(id) ?? 0;
    return h("div", { class: "sound-row" },
      h("span", { class: "sound-name" }, songLabel(id)),
      h("span", { class: "hint" }, def ? `your file: ${shortName(def.file)}${def.loopFile ? ` → ${shortName(def.loopFile)}` : ""}` : n ? `${n} map${n === 1 ? "" : "s"}` : ""),
      ...(def ? playButtons(def) : []),
      h("button", {
        class: "btn small ghost",
        title: "Play your own file wherever the game plays this song",
        onclick: async () => {
          const f = await pickAudio();
          const path = f && (await importFile(f, id, MAX_SONG));
          if (path) set(MUSIC, id, `Replace ${id}`, { file: path });
        },
      }, def ? "Replace file…" : "Replace with a file…"),
      def && !def.loopFile
        ? h("button", {
            class: "btn small ghost",
            onclick: async () => {
              const f = await pickAudio();
              const path = f && (await importFile(f, `${id}_loop`, MAX_SONG));
              if (path) set(MUSIC, id, "Song: loop part", { ...def, loopFile: path });
            },
          }, "+ Loop part…")
        : null,
      store.isRecordEdited(MUSIC, id)
        ? h("button", { class: "btn small ghost danger", onclick: () => { stopAll(); store.revertRecord(MUSIC, id, `${id}: the game's`); } }, "Back to the game's")
        : null,
    );
  });
  return h("section", { class: "card" },
    h("h4", {}, "The game's songs"),
    h("p", { class: "hint" }, "Replacing one plays your file everywhere the game plays that song (maps, battles, jingles). A song that should not repeat, like a jingle, still loops if it's a single file."),
    h("div", { class: "sound-list" }, ...rows),
  );
}

function soundsCard(): HTMLElement {
  const mine = own(SFX);
  const replaced = Object.keys(base(SFX)).filter((id) => store.isRecordEdited(SFX, id)).sort();
  const row = (id: string, isOwn: boolean) => {
    const def = fileOf(SFX, id);
    return h("div", { class: "sound-row" },
      h("span", { class: "sound-name" }, id),
      h("span", { class: "hint" }, def ? shortName(def.file) : ""),
      ...(def ? playButtons(def, true) : []),
      h("button", {
        class: "btn small ghost",
        onclick: async () => {
          const f = await pickAudio();
          const path = f && (await importFile(f, `sfx_${id}`, MAX_SOUND));
          if (path) set(SFX, id, `Sound ${id}: new file`, { file: path });
        },
      }, "Replace file…"),
      isOwn
        ? h("button", {
            class: "btn small ghost danger",
            onclick: () => {
              const users = eventUsers("play_sound", id);
              if (users.length) return toast(`${id} is still used by ${users.join(", ")}.`, "error");
              set(SFX, id, `Delete sound ${id}`, undefined);
            },
          }, "Delete")
        : h("button", { class: "btn small ghost danger", onclick: () => store.revertRecord(SFX, id, `${id}: the game's`) }, "Back to the game's"),
    );
  };
  const others = Object.keys(base(SFX)).filter((id) => !replaced.includes(id)).sort();
  const pick = h("select", {}, h("option", { value: "" }, "Replace a game sound…"), ...others.map((id) => h("option", { value: id }, id)));
  pick.addEventListener("change", async () => {
    const id = pick.value;
    pick.value = "";
    if (!id) return;
    const f = await pickAudio();
    const path = f && (await importFile(f, `sfx_${id}`, MAX_SOUND));
    if (path) set(SFX, id, `Replace sound ${id}`, { file: path });
  });
  return h("section", { class: "card" },
    h("div", { class: "card-head" }, h("h4", {}, "Sound effects"), h("button", { class: "btn small primary-ish", onclick: newSound }, "+ New sound…")),
    ...mine.map((id) => row(id, true)),
    ...replaced.map((id) => row(id, false)),
    mine.length || replaced.length ? null : h("p", { class: "hint" }, "A new sound can be played with the Play sound event command; a replaced game sound plays wherever the game uses it."),
    h("div", { class: "row" }, pick),
  );
}

async function newSound(): Promise<void> {
  const res = await promptNew("New sound effect", "", "The sound's id (letters, digits and _), e.g. Doorbell.", false);
  if (!res) return;
  const file = await importFile(res.file, `sfx_${res.id}`, MAX_SOUND);
  if (file) set(SFX, res.id, `New sound ${res.id}`, { file });
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
