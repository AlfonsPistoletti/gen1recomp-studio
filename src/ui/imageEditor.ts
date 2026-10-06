// Graphics > Images: every other game image (title screen, the player's
// pictures, intro, battle screen, fonts, ...). A mod replaces one by shipping
// mods/<mod>/overrides/<path> for assets/generated/<path>, which the engine
// loads instead (src/render/Assets.lua); the studio writes those files on save.

import { store } from "../core/store.ts";
import { addOverride, COPY, OVERRIDES, overrideUrl } from "../core/assets.ts";
import { canDerive, NO_RECIPE } from "../core/reuse.ts";
import type { ImageSpec } from "../games/types.ts";
import { loadImage } from "../render/graphics.ts";
import { importArt } from "./artImport.ts";
import { clear, h, toast } from "./dom.ts";
import { mountRecordList } from "./recordList.ts";
import { nav } from "./nav.ts";

const GENERATED = "assets/generated/";
const listed = new Map<string, Promise<string[]>>();

// the cache's images below assets/generated, minus the spec's skipped folders
function cacheImages(spec: ImageSpec): Promise<string[]> {
  const version = store.project.version;
  let p = listed.get(version);
  if (!p) {
    const host = store.project.host;
    p = (async () => {
      const out: string[] = [];
      const walk = async (dir: string, depth: number): Promise<void> => {
        if (depth > 5) return;
        for (const e of await host.list(`cache:${version}`, `${GENERATED}${dir}`.replace(/\/$/, ""))) {
          const rel = `${dir}${e.name}`;
          if (spec.skip.some((s) => `${rel}/`.startsWith(s) || rel.startsWith(s))) continue;
          if (e.dir) await walk(`${rel}/`, depth + 1);
          else if (e.name.toLowerCase().endsWith(".png")) out.push(rel);
        }
      };
      await walk("", 0);
      return out;
    })().catch(() => []);
    listed.set(version, p);
  }
  return p;
}

// image sizes ("WxH"), loaded once per version and file
const sizes = new Map<string, Promise<string>>();
function sizeOf(url: string): Promise<string> {
  let p = sizes.get(url);
  if (!p) {
    p = loadImage(url).then((img) => (img ? `${img.width}x${img.height}` : ""));
    sizes.set(url, p);
  }
  return p;
}

function groupOf(spec: ImageSpec, rel: string): string {
  return spec.groups.find(([prefix]) => rel === prefix || rel.startsWith(prefix))?.[1] ?? "Other";
}

export function mountImageWorkspace(left: HTMLElement, center: HTMLElement, right: HTMLElement): void {
  let current: string | null = null;
  let files: string[] = [];
  const spec = () => store.adapter?.images;
  const records = () => store.table(OVERRIDES) as Record<string, string>;

  const list = mountRecordList(left, {
    title: "Images",
    placeholder: "Search images…",
    searchId: "images-search",
    items: () => {
      const s = spec();
      if (!s) return [];
      const order = [...new Set(s.groups.map(([, g]) => g)), "Other"];
      // replaced files the cache doesn't list (another version's) still show
      const all = [...new Set([...files, ...Object.keys(records())])];
      return all
        .map((rel) => ({ rel, group: groupOf(s, rel) }))
        .sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.rel.localeCompare(b.rel))
        .map(({ rel, group }) => ({
          id: rel,
          label: rel.split("/").pop()!.replace(/\.png$/, ""),
          meta: group,
          search: `${rel} ${group} ${s.hints[rel] ?? ""}`,
          edited: records()[rel] !== undefined,
        }));
    },
    current: () => current,
    pick: (rel) => open(rel),
    refreshOn: (reason, _id, registry) => reason === "content" && registry === OVERRIDES,
  });

  const title = h("span", { class: "head-title" }, "Images");
  const main = h("div", { class: "ws-scroll" });
  const side = h("div", { class: "ws-scroll" });
  center.append(h("div", { class: "panel-head" }, title), main);
  right.append(h("div", { class: "panel-head" }, h("span", {}, "Replace")), side);

  const open = (rel: string) => {
    current = rel;
    list.render();
    void render();
    left.querySelector<HTMLElement>(`.map-row[data-id="${CSS.escape(rel)}"]`)?.scrollIntoView({ block: "nearest" });
  };
  nav.openImage = (rel) => {
    nav.setWorkspace("graphics");
    nav.showGraphics("images");
    open(rel);
  };

  const gameUrl = (rel: string) => store.project.host.imageUrl(store.project.version, GENERATED + rel);
  const modUrl = (rel: string) => {
    const v = records()[rel];
    return v && store.project.mod ? overrideUrl(store.project.host, store.project.version, store.project.mod, rel, v) : "";
  };

  // one image, zoomed to fit `box` px (whole steps keep pixels square)
  const picture = (url: string, w: number, hgt: number, box: number): HTMLElement => {
    const zoom = Math.max(1, Math.min(6, Math.floor(box / Math.max(w, hgt))));
    const img = h("img", { src: url, alt: "", class: "image-pic", style: `width:${w * zoom}px;height:${hgt * zoom}px` });
    return h("div", { class: "image-frame" }, img);
  };

  let token = 0;
  const render = async () => {
    const my = ++token;
    clear(main);
    clear(side);
    const s = spec();
    const rel = current;
    if (!rel || !s || !store.project) {
      title.textContent = "Images";
      main.append(h("p", { class: "hint empty" }, s ? "Pick an image on the left." : "This game has no replaceable images."));
      return;
    }
    const game = await loadImage(gameUrl(rel));
    if (my !== token) return;
    const w = game?.width ?? 16;
    const hgt = game?.height ?? 16;
    // see-through pixels in the game's image stay see-through in a replacement
    let clear0 = false;
    if (game) {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = hgt;
      const cx = c.getContext("2d", { willReadFrequently: true })!;
      cx.drawImage(game, 0, 0);
      const px = cx.getImageData(0, 0, w, hgt).data;
      for (let i = 3; i < px.length; i += 4) if (px[i] === 0) { clear0 = true; break; }
    }
    title.textContent = rel;
    const mine = modUrl(rel);
    const value = records()[rel];
    const copyOf = value?.startsWith(COPY) ? value.slice(COPY.length) : null;
    // the game's images of the same size, for "use the art of"
    const size = `${w}x${hgt}`;
    const sameSize: string[] = [];
    for (const f of files) if (f !== rel && (await sizeOf(gameUrl(f))) === size) sameSize.push(f);
    if (my !== token) return;
    main.append(
      h("div", { class: "image-compare" },
        h("div", { class: "card" }, h("h4", {}, `The game's · ${w}×${hgt}`), game ? picture(gameUrl(rel), w, hgt, 420) : h("p", { class: "hint warn" }, "Not in this version's imported files.")),
        h("div", { class: "card" }, h("h4", {}, copyOf ? `Your mod's · the game's ${copyOf}` : "Your mod's"), mine ? picture(mine, w, hgt, 420) : h("p", { class: "hint" }, "Not replaced: the game's image is used.")),
      ),
      h("p", { class: "hint" }, "Shown as stored: the game colors these images with the palette of the screen they appear on."),
    );
    side.append(
      h("div", { class: "card" },
        h("h4", {}, groupOf(s, rel)),
        h("p", { class: "hint" }, s.hints[rel] ?? `Shown somewhere in the game as ${rel}.`),
        h("p", { class: "hint" }, `Your picture should be ${w}×${hgt}: the game cuts some images into pieces by position (fonts, sheets), so keep the layout.`),
        h("div", { class: "row wrap" },
          h("button", { class: "btn small", onclick: () => void replace(rel, w, hgt, clear0) }, mine ? "Replace again…" : "Replace…"),
          mine
            ? h("button", {
                class: "btn small danger",
                onclick: () => {
                  store.setRecord(OVERRIDES, rel, `Revert ${rel}`, undefined);
                  store.seal();
                },
              }, "Back to the game's")
            : null,
        ),
        useArt(rel, sameSize, copyOf),
        h("p", { class: "hint" }, copyOf
          ? `The game copies its own ${copyOf} into this image's place when the mod loads (asset transforms): the mod ships no ROM art.`
          : `Saved as mods/<your mod>/overrides/${rel}; the game loads it instead of its own.`),
      ),
    );
  };

  // another game image of the same size in this one's place
  const useArt = (rel: string, sameSize: string[], copyOf: string | null): HTMLElement => {
    const sel = h("select", { disabled: !sameSize.length || !canDerive() },
      h("option", { value: "" }, sameSize.length ? "Use the art of…" : "No other image has this size"),
      ...sameSize.map((f) => h("option", { value: f, selected: f === copyOf }, f)),
    );
    sel.title = canDerive() ? "Show another of the game's images (same size) here instead" : NO_RECIPE;
    sel.addEventListener("change", () => {
      if (!sel.value) return;
      store.setRecord(OVERRIDES, rel, `Use ${sel.value} for ${rel}`, COPY + sel.value);
      store.seal();
    });
    return sel;
  };

  const replace = async (rel: string, w: number, hgt: number, keepTransparent: boolean) => {
    if (!store.project.mod) return toast("Open a mod first: replaced images are saved into it.", "error");
    const res = await importArt({ label: rel.split("/").pop()!.replace(/\.png$/, ""), width: w, height: hgt, align: "center", keepTransparent }, { trueColor: false });
    if (!res) return;
    store.setRecord(OVERRIDES, rel, `Replace ${rel}`, addOverride(res.data));
    store.seal();
  };

  // ---------------------------------------------------------------- events
  const refreshFiles = async () => {
    const s = spec();
    files = s ? await cacheImages(s) : [];
    if (current === null) current = files.find((f) => f === "title/player.png") ?? files[0] ?? null;
    list.render();
    if (nav.workspace === "graphics" && nav.graphicsView === "images") void render();
  };
  store.on((reason, id, registry) => {
    if (reason === "project") void refreshFiles();
    else if (reason === "content" && registry === OVERRIDES && nav.workspace === "graphics" && nav.graphicsView === "images") void render();
    else if (reason === "reveal" && registry === OVERRIDES && id) nav.openImage(id);
  });
  nav.onImagesShown = () => void render();
}
