// Graphics > Sprites: the overworld sprites of NPCs, the player and objects.
// A walking preview at the game's timing, the frames of the sheet, and
// importing art: a whole sheet (any sprite), or one frame (sheets the mod
// already owns; a game sheet is the player's ROM art and never copied).

import { store } from "../core/store.ts";
import { addAsset } from "../core/assets.ts";
import { clone } from "../core/merge.ts";
import type { SpriteDef } from "../core/types.ts";
import {
  DEFAULT_PLAYER, FRAME, FRAME_LABELS, isBaseSprite, isSimpleSheet, KIND_FRAMES, kindOf, liveSprite, PLAYER_ROLES, playerSprites, ROLE_LABELS, rolesOf,
  SPRITES, spriteIds, spriteUrl, spriteUsers, type SpriteKind,
} from "../core/sprites.ts";
import { loadImage, spriteFrameAt } from "../render/graphics.ts";
import type { Rgb } from "../render/color.ts";
import { importArt } from "./artImport.ts";
import { spriteGbcColors } from "../core/gbc.ts";
import { canDerive, NO_RECIPE, reusable } from "../core/reuse.ts";
import { clear, field, h, toast } from "./dom.ts";
import { mountRecordList } from "./recordList.ts";
import { nav } from "./nav.ts";

const ZOOM = 4;
const GRAYS = "__grays";
const REDPP = "__redpp";
const GRAY_COLORS: Rgb[] = [[0, 0, 0], [85, 85, 85], [170, 170, 170], [255, 255, 255]];
const KIND_LABELS: Record<SpriteKind, string> = { walker: "Walks (6 frames)", turner: "Turns, never walks (3 frames)", object: "Still (1 frame)" };
const DIRS = ["down", "up", "left", "right"] as const;
const STAND: Record<string, number> = { down: 0, up: 1, left: 2, right: 2 };
const WALK: Record<string, number> = { down: 3, up: 4, left: 5, right: 5 };

function bytesOf(canvas: HTMLCanvasElement): Uint8Array {
  const bin = atob(canvas.toDataURL("image/png").split(",")[1] ?? "");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function imageOf(data: Uint8Array): Promise<HTMLImageElement | null> {
  return loadImage(URL.createObjectURL(new Blob([data as BlobPart], { type: "image/png" })));
}

export function mountSpriteWorkspace(left: HTMLElement, center: HTMLElement, right: HTMLElement): void {
  let current: string | null = null;
  let selFrame = 0;
  let viewPalette = "";
  // NPCs take 32 frames a step, the player 16 (src/world/NPC.lua, Player.lua)
  let stepFrames = 32;
  let raf = 0;

  const newBtn = h("button", { class: "btn small", title: "A new sprite from a picture", onclick: () => void newSprite() }, "+ New");
  const list = mountRecordList(left, {
    title: "Sprites",
    head: [newBtn],
    placeholder: "Search sprites…",
    searchId: "sprites-search",
    items: () =>
      spriteIds().map((id) => {
        const s = liveSprite(id)!;
        const own = !isBaseSprite(id);
        return {
          id,
          label: id.replace(/^SPRITE_/, ""),
          meta: { walker: "walks", turner: "turns", object: "still" }[kindOf(s)],
          tags: rolesOf(id).length ? ["player"] : [],
          search: id,
          edited: !own && store.isRecordEdited(SPRITES, id),
          isNew: own,
        };
      }),
    current: () => current,
    pick: (id) => open(id),
    refreshOn: (reason, id, registry) => reason === "content" && (registry === SPRITES || (registry === "field" && id === "playerSprites")),
  });

  const title = h("span", { class: "head-title" }, "Sprites");
  const headTools = h("div", { class: "row nowrap" });
  const main = h("div", { class: "ws-scroll" });
  const side = h("div", { class: "ws-scroll" });
  center.append(h("div", { class: "panel-head" }, title, headTools), main);
  right.append(h("div", { class: "panel-head" }, h("span", {}, "Art")), side);

  const open = (id: string) => {
    if (!liveSprite(id)) return;
    if (current !== id) selFrame = 0;
    current = id;
    list.render();
    render();
    left.querySelector<HTMLElement>(`.map-row[data-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
  };
  nav.openSprite = (id) => {
    nav.setWorkspace("graphics");
    nav.showGraphics("sprites");
    open(id);
  };

  // the colors sprites are shown in: a map's palette (the current one), any
  // palette, or plain grays
  // RED++: the sprite's own palette (a "random" one shows one of its four)
  const gbcOf = () => (current ? spriteGbcColors(liveSprite(current), "preview", /yellow/i.test(store.project.version)) : null);
  const useGbc = () => viewPalette === REDPP || (!viewPalette && store.colorMode === "redpp" && !!gbcOf());
  const colorKey = () => (useGbc() ? (gbcOf()?.key ?? GRAYS) : viewPalette && viewPalette !== REDPP ? viewPalette : store.palettes[store.currentMap] || "ROUTE");
  const colors = (): Rgb[] => (useGbc() ? (gbcOf()?.colors ?? GRAY_COLORS) : colorKey() === GRAYS ? GRAY_COLORS : store.adapter.spriteColors(store.ctx, colorKey()));

  const frameImg = (id: string, frame: number, flip: boolean) =>
    spriteFrameAt(liveSprite(id), spriteUrl(id), colors(), colorKey(), frame, flip, schedule);

  // ---------------------------------------------------------------- render
  const render = () => {
    cancelAnimationFrame(raf);
    clear(headTools);
    clear(main);
    clear(side);
    const id = current;
    if (!id || !store.project) {
      title.textContent = "Sprites";
      main.append(h("p", { class: "hint empty" }, "Pick a sprite on the left."));
      return;
    }
    const s = liveSprite(id)!;
    title.textContent = id;
    const kind = kindOf(s);
    const frames = s.frames || 1;

    const names = store.adapter.mapFields.find((f) => f.kind === "select" && f.key === "palette");
    const paletteNames = names && names.kind === "select" ? names.options(store.ctx) : [];
    const view = h("select", { title: "How the sprite is shown here; in the game it takes the colors of the map it stands on" },
      h("option", { value: "" }, `Colors: this map's (${store.palettes[store.currentMap] || "ROUTE"})`),
      ...paletteNames.map((n) => h("option", { value: n, selected: viewPalette === n }, `Colors: ${n}`)),
      h("option", { value: GRAYS, selected: viewPalette === GRAYS }, "Game Boy grays"),
      ...(gbcOf() ? [h("option", { value: REDPP, selected: viewPalette === REDPP }, "Colors: RED++ (Game Boy Color)")] : []),
    );
    view.disabled = !!s.trueColor;
    view.addEventListener("change", () => {
      viewPalette = view.value;
      render();
    });
    const speed = h("select", { title: "How fast the preview walks" },
      h("option", { value: "32", selected: stepFrames === 32 }, "NPC speed"),
      h("option", { value: "16", selected: stepFrames === 16 }, "Player speed"),
    );
    speed.addEventListener("change", () => (stepFrames = Number(speed.value)));
    headTools.append(view, speed);

    // the walking preview: one actor per direction
    const preview = h("canvas", { class: "sprite-preview" });
    const cellW = FRAME * ZOOM + 24;
    preview.width = cellW * 4;
    preview.height = FRAME * ZOOM + 26;
    const pctx = preview.getContext("2d")!;
    pctx.imageSmoothingEnabled = false;
    const draw = () => {
      if (!preview.isConnected) return;
      const tick = Math.floor(performance.now() / (1000 / 60));
      pctx.fillStyle = "#e9eef3";
      pctx.fillRect(0, 0, preview.width, preview.height);
      DIRS.forEach((dir, i) => {
        let frame = 0;
        let flip = false;
        if (kind === "walker") {
          // movement.asm: the walk frame in ticks 4..11 of each 16-tick
          // cycle; up/down mirror it every other step
          const step = Math.floor(tick / stepFrames);
          const walking = (tick % stepFrames) % 16 >= 4 && (tick % stepFrames) % 16 < 12;
          frame = walking ? WALK[dir] : STAND[dir];
          flip = dir === "right" || (walking && (dir === "up" || dir === "down") && step % 2 === 1);
        } else if (kind === "turner") {
          frame = STAND[dir];
          flip = dir === "right";
        }
        const img = kind === "object" && i > 0 ? null : frameImg(id, frame, flip);
        const x = i * cellW + 12;
        if (img) pctx.drawImage(img, x, 6, FRAME * ZOOM, FRAME * ZOOM);
        pctx.fillStyle = "#56606e";
        pctx.font = "11px sans-serif";
        if (kind !== "object" || i === 0) pctx.fillText(kind === "object" ? "still" : dir, x, FRAME * ZOOM + 20);
      });
      raf = requestAnimationFrame(draw);
    };
    // starts once the canvas is in the page (it stops when it leaves)
    raf = requestAnimationFrame(draw);

    // the sheet's frames
    const strip = h("div", { class: "sprite-frames" });
    for (let f = 0; f < frames; f++) {
      const c = h("canvas", { class: `sprite-frame${f === selFrame ? " active" : ""}`, title: FRAME_LABELS[f] ?? `Frame ${f + 1}` });
      c.width = FRAME * 3;
      c.height = FRAME * 3;
      const cx = c.getContext("2d")!;
      cx.imageSmoothingEnabled = false;
      cx.fillStyle = "#e9eef3";
      cx.fillRect(0, 0, c.width, c.height);
      const img = frameImg(id, f, false);
      if (img) cx.drawImage(img, 0, 0, c.width, c.height);
      c.addEventListener("click", () => {
        selFrame = f;
        render();
      });
      strip.append(h("div", { class: "sprite-frame-box" }, c, h("span", { class: "hint" }, frames === 1 ? "Still" : FRAME_LABELS[f] ?? `Frame ${f + 1}`)));
    }

    main.append(
      h("div", { class: "card" },
        h("div", { class: "card-head" }, h("h4", {}, "Preview"), h("span", { class: "hint" }, KIND_LABELS[kind])),
        preview,
        kind === "turner" ? h("p", { class: "hint" }, "This sprite has no walking frames: it only turns. Import a 6-frame sheet to make it walk.") : null,
      ),
      h("div", { class: "card" },
        h("div", { class: "card-head" }, h("h4", {}, `Frames (${frames})`), h("span", { class: "hint" }, `${typeof s.image === "string" && s.image.startsWith("mods/") ? "Your art" : "The game's art (read-only)"} · right is the left frame mirrored`)),
        strip,
        isSimpleSheet(s) ? null : h("p", { class: "hint warn" }, "This sheet has a custom layout (set by mod code); the studio shows it but can't edit it."),
      ),
    );
    side.append(...sidePanel(id, s));
  };

  // ---------------------------------------------------------------- side
  const sidePanel = (id: string, s: SpriteDef): HTMLElement[] => {
    const out: HTMLElement[] = [];
    const simple = isSimpleSheet(s);
    const ownSheet = typeof s.image === "string" && s.image.startsWith("mods/");
    // the kind: fixed for the game's art (its sheet has the frames it has);
    // the mod's own sheet can use fewer of its frames, or as many as it holds
    let kindRow: HTMLElement;
    if (ownSheet && simple) {
      const kindSel = h("select", {}, ...(["walker", "turner", "object"] as SpriteKind[]).map((k) => h("option", { value: k, selected: kindOf(s) === k }, KIND_LABELS[k])));
      void loadImage(spriteUrl(id)).then((img) => {
        const has = img ? Math.floor(img.height / FRAME) : s.frames || 1;
        for (const o of kindSel.options) o.disabled = KIND_FRAMES[o.value as SpriteKind] > has;
      });
      kindSel.addEventListener("change", () => {
        const k = kindSel.value as SpriteKind;
        store.editRecord<SpriteDef>(SPRITES, id, "Sprite kind", (d) => {
          d.frames = KIND_FRAMES[k];
          d.walker = k === "walker";
        });
        store.seal();
      });
      kindRow = field("Kind", kindSel, "Kinds that need more frames than this sheet has are greyed out: import a sheet with more frames for them.");
    } else {
      kindRow = h("div", { class: "kv" }, h("span", {}, "Kind"), h("span", {}, KIND_LABELS[kindOf(s)]));
    }
    const gameArt = !ownSheet;
    out.push(h("div", { class: "card" },
      h("h4", {}, "Art"),
      kindRow,
      gameArt
        ? h("p", { class: "hint" }, "This is the game's own art, read from your imported ROM, so it is read-only: its pixels can't be edited or copied into a mod (a mod may not ship ROM art). Import a sheet of your own to replace it; you choose its kind (walks, turns, still) when importing.")
        : h("p", { class: "hint" }, "Your mod's own sheet. Walkers: stand ↓ ↑ ←, then walk ↓ ↑ ← (right is left mirrored); 16×16 frames, white is see-through."),
      borrowRow(id, simple),
      h("div", { class: "row wrap" },
        h("button", { class: "btn small", disabled: !simple, onclick: () => void importSheet(id) }, "Import sheet…"),
        h("button", {
          class: "btn small",
          disabled: !simple || !ownSheet,
          title: ownSheet ? `Replace ${FRAME_LABELS[selFrame] ?? "this frame"} only` : "Import a whole sheet first: the game's sheet is the player's own ROM art and is never copied into a mod",
          onclick: () => void replaceFrame(id),
        }, `Replace ${s.frames && s.frames > 1 ? (FRAME_LABELS[selFrame] ?? "frame").toLowerCase() : "frame"}…`),
      ),
      isBaseSprite(id) && store.isRecordEdited(SPRITES, id)
        ? h("button", { class: "btn small danger", onclick: () => store.revertRecord(SPRITES, id, `Revert ${id}`) }, "Back to the game's art")
        : null,
    ));
    // who uses it
    const users = spriteUsers(id);
    const roles = rolesOf(id);
    out.push(h("div", { class: "card" },
      h("h4", {}, "Used by"),
      roles.length ? h("p", { class: "hint" }, `The player (${roles.map((r) => ROLE_LABELS[r].toLowerCase()).join(", ")}): changing it changes the player.`) : null,
      users.length
        ? h("div", { class: "row wrap" }, ...users.slice(0, 40).map(([m, i]) => h("button", { class: "btn small ghost", onclick: () => nav.selectEntity(m, "objects", i) }, `${m} #${i + 1}`)))
        : roles.length ? null : h("p", { class: "hint" }, "No NPC uses it yet: pick it as an NPC's Sprite on a map."),
      !isBaseSprite(id)
        ? h("button", {
            class: "btn small danger",
            disabled: users.length > 0 || roles.length > 0,
            title: users.length || roles.length ? "NPCs or the player still use it" : "Delete this sprite",
            onclick: () => {
              store.setRecord(SPRITES, id, `Delete ${id}`, undefined);
              store.seal();
              current = null;
              render();
            },
          }, "Delete sprite")
        : null,
    ));
    out.push(playerCard(id));
    return out;
  };

  // another sprite's art (and its kind): the mod's own as is, the game's as a
  // copy the asset-transforms recipe makes when the game loads
  const borrowRow = (id: string, simple: boolean): HTMLElement => {
    const sources = spriteIds().filter((o) => {
      const src = liveSprite(o);
      return o !== id && !!src && isSimpleSheet(src) && reusable(src.image) !== null;
    });
    const sel = h("select", { disabled: !simple || !sources.length || !canDerive() },
      h("option", { value: "" }, sources.length ? "Use the art of…" : "No art to reuse"),
      ...sources.map((o) => h("option", { value: o }, o.replace(/^SPRITE_/, ""))),
    );
    sel.title = canDerive() ? "Show this sprite with another sprite's art (the game's art is copied from the player's own files when the game loads)" : NO_RECIPE;
    sel.addEventListener("change", () => {
      const src = liveSprite(sel.value);
      const path = src ? reusable(src.image) : null;
      if (!src || !path) return;
      store.editRecord<SpriteDef>(SPRITES, id, `Use ${sel.value}'s art`, (d) => {
        d.image = path;
        d.frames = src.frames || 1;
        d.walker = !!src.walker;
        if (src.trueColor) d.trueColor = true;
        else delete d.trueColor;
      });
      store.seal();
    });
    return sel;
  };

  // which sprites the player wears (field.playerSprites); a role set back to
  // the game's sprite is dropped
  const playerCard = (id: string): HTMLElement => {
    const now = playerSprites();
    const ids = spriteIds();
    const rows = PLAYER_ROLES.map((role) => {
      const sel = h("select", {}, ...ids.map((s) => h("option", { value: s, selected: now[role] === s }, `${s}${s === DEFAULT_PLAYER[role] ? " (the game's)" : ""}`)));
      sel.addEventListener("change", () => {
        const cur = { ...((store.table("field").playerSprites as Record<string, string> | undefined) ?? {}) };
        if (sel.value === DEFAULT_PLAYER[role]) delete cur[role];
        else cur[role] = sel.value;
        store.setRecord("field", "playerSprites", `Player sprite: ${ROLE_LABELS[role].toLowerCase()}`, Object.keys(cur).length ? cur : undefined);
        store.seal();
      });
      const use = h("button", { class: "btn small ghost", disabled: now[role] === id, title: `Make ${id} the player's sprite ${ROLE_LABELS[role].toLowerCase()}`, onclick: () => {
        sel.value = id;
        sel.dispatchEvent(new Event("change"));
      } }, "Use this");
      return h("div", { class: "field" }, h("span", { class: "field-label" }, ROLE_LABELS[role]), h("div", { class: "row nowrap" }, sel, use));
    });
    return h("div", { class: "card" },
      h("h4", {}, "The player"),
      h("p", { class: "hint" }, "Which sprite the player wears. Pick any sprite, or replace that sprite's art. On foot also sets the Town Map marker and Oak's intro."),
      ...rows,
      store.table("field").playerSprites !== undefined
        ? h("button", {
            class: "btn small danger",
            title: "On foot SPRITE_RED, bike SPRITE_RED_BIKE, surfing SPRITE_SEEL, flying SPRITE_BIRD",
            onclick: () => {
              store.setRecord("field", "playerSprites", "Player sprites: the game's", undefined);
              store.seal();
            },
          }, "Back to the game's player sprites")
        : null,
    );
  };

  // ---------------------------------------------------------------- import
  const target = (kind: SpriteKind) => ({ label: "Sprite sheet", width: FRAME, height: FRAME, frames: KIND_FRAMES[kind], align: "bottom" as const });

  const setArt = (id: string, label: string, image: string, kind: SpriteKind, trueColor: boolean) => {
    store.editRecord<SpriteDef>(SPRITES, id, label, (d) => {
      d.image = image;
      d.frames = KIND_FRAMES[kind];
      d.walker = kind === "walker";
      if (trueColor) d.trueColor = true;
      else delete d.trueColor;
    });
    store.seal();
  };

  const importSheet = async (id: string) => {
    if (!store.project.mod) return toast("Open a mod first: imported art is saved into it.", "error");
    const s = liveSprite(id);
    const kind = await promptKind(s ? kindOf(s) : "walker");
    if (!kind) return;
    const res = await importArt(target(kind), { trueColor: !!s?.trueColor });
    if (!res) return;
    setArt(id, "Import sprite sheet", addAsset(store.project.mod, id.toLowerCase(), res.data), kind, res.trueColor);
  };

  // one frame into the mod's own sheet
  const replaceFrame = async (id: string) => {
    const s = liveSprite(id);
    if (!s || !store.project.mod) return;
    const res = await importArt({ label: FRAME_LABELS[selFrame] ?? "Frame", width: FRAME, height: FRAME, align: "bottom" }, { trueColor: !!s.trueColor });
    if (!res) return;
    const [sheet, frame] = await Promise.all([loadImage(spriteUrl(id)), imageOf(res.data)]);
    if (!sheet || !frame) return toast("The sheet could not be read.", "error");
    const c = document.createElement("canvas");
    c.width = FRAME;
    c.height = FRAME * (s.frames || 1);
    const ctx = c.getContext("2d")!;
    ctx.drawImage(sheet, 0, 0);
    ctx.clearRect(0, selFrame * FRAME, FRAME, FRAME);
    ctx.drawImage(frame, 0, selFrame * FRAME);
    setArt(id, "Replace frame", addAsset(store.project.mod, id.toLowerCase(), bytesOf(c)), kindOf(s), !!s.trueColor);
  };

  const newSprite = async () => {
    if (!store.project?.mod) return toast("Open a mod first: a new sprite is saved into it.", "error");
    const res = await promptNewSprite(spriteIds());
    if (!res) return;
    const art = await importArt(target(res.kind), { trueColor: false });
    if (!art) return;
    const record: SpriteDef = {
      id: res.id,
      image: addAsset(store.project.mod, res.id.toLowerCase(), art.data),
      frames: KIND_FRAMES[res.kind],
      walker: res.kind === "walker",
      ...(art.trueColor ? { trueColor: true } : {}),
    };
    store.setRecord(SPRITES, res.id, `New sprite ${res.id}`, clone(record));
    store.seal();
    open(res.id);
  };

  // ---------------------------------------------------------------- events
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (nav.workspace === "graphics" && nav.graphicsView === "sprites") render();
    });
  };
  store.on((reason, id, registry) => {
    if (reason === "project") {
      if (!current || !liveSprite(current)) current = "SPRITE_RED";
      schedule();
    } else if (reason === "content" && (registry === SPRITES || (registry === "field" && id === "playerSprites"))) {
      if (current && !liveSprite(current)) current = null;
      schedule();
    } else if (reason === "reveal" && registry === SPRITES && id) {
      nav.openSprite(id);
    }
  });
  nav.onSpritesShown = () => render();
}

// the kind of sheet about to be imported
function promptKind(current: SpriteKind): Promise<SpriteKind | null> {
  return new Promise((resolve) => {
    const dialog = h("dialog", {});
    const kind = h("select", {}, ...(["walker", "turner", "object"] as SpriteKind[]).map((k) => h("option", { value: k, selected: k === current }, KIND_LABELS[k])));
    const close = (v: SpriteKind | null) => {
      dialog.close();
      dialog.remove();
      resolve(v);
    };
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      close(null);
    });
    dialog.append(
      h("h3", {}, "Import a sprite sheet"),
      field("Kind", kind, "Walks: 6 frames (stand ↓ ↑ ←, walk ↓ ↑ ←). Turns: 3 (stand only). Still: 1. Frames are 16×16, stacked or side by side."),
      h("div", { class: "dialog-actions" }, h("button", { class: "btn", onclick: () => close(null) }, "Cancel"), h("button", { class: "btn primary", onclick: () => close(kind.value as SpriteKind) }, "Next: picture")),
    );
    document.body.append(dialog);
    dialog.showModal();
    kind.focus();
  });
}

// id and kind of a new sprite
function promptNewSprite(taken: string[]): Promise<{ id: string; kind: SpriteKind } | null> {
  return new Promise((resolve) => {
    const dialog = h("dialog", {});
    const id = h("input", { type: "text", spellcheck: false, placeholder: "SPRITE_MY_NPC", value: "SPRITE_" });
    const kind = h("select", {}, ...(["walker", "turner", "object"] as SpriteKind[]).map((k) => h("option", { value: k }, KIND_LABELS[k])));
    const close = (v: { id: string; kind: SpriteKind } | null) => {
      dialog.close();
      dialog.remove();
      resolve(v);
    };
    const create = () => {
      const newId = id.value.trim().toUpperCase();
      if (!/^[A-Z][A-Z0-9_]*$/.test(newId)) return toast("The id may use A-Z, 0-9 and _ and starts with a letter", "error");
      if (taken.includes(newId)) return toast(`${newId} already exists`, "error");
      close({ id: newId, kind: kind.value as SpriteKind });
    };
    id.addEventListener("keydown", (e) => e.key === "Enter" && create());
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      close(null);
    });
    dialog.append(
      h("h3", {}, "New sprite"),
      field("Id", id, "NPCs name their sprite by this id; cannot be changed later."),
      field("Kind", kind, "Then pick its picture: 16×16 frames, stacked or side by side."),
      h("div", { class: "dialog-actions" }, h("button", { class: "btn", onclick: () => close(null) }, "Cancel"), h("button", { class: "btn primary", onclick: create }, "Next: picture")),
    );
    document.body.append(dialog);
    dialog.showModal();
    id.focus();
  });
}
