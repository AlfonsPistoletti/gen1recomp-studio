import wasmUrl from "wasmoon/dist/glue.wasm?url";
import { startAreaBrush } from "./ui/mapAreas.ts";
import { extKinds } from "./ui/extFields.ts";
import { extIcon } from "./render/extIcons.ts";
import { imageAliases, OVERRIDES, saveAssets, saveOverrides, syncTransforms } from "./core/assets.ts";
import { foreignExtension, foreignNote, liveTileset, sheetRecipes, tilesetIds } from "./core/tilesets.ts";
import { gbcAvailable, loadGbc, setGbc } from "./core/gbc.ts";
import { brokenWarps, romReferences } from "./core/checks.ts";
import { store, type Overlays, type Tool } from "./core/store.ts";
import { clone } from "./core/merge.ts";
import { MOD_MAP_INDEX_BASE, type MapDef, type ModInfo } from "./core/types.ts";
import { adapterFor, GAME_NAMES, GAME_OF_VERSION } from "./games/index.ts";
import { httpHost } from "./host/httpHost.ts";
import { chooseGameRoot, isTauri, tauriHost } from "./host/tauriHost.ts";
import { checkForUpdates } from "./ui/updates.ts";
import type { HostInfo } from "./host/types.ts";
import { configureLua } from "./lua/vm.ts";
import { createMod, ensurePlayEnv, listMods, openProject as loadProject, processText, saveProject, validateMod, wireUp } from "./project/project.ts";
import { PLAYTEST_ID, playtestMain, playtestManifest, playtestSavingOff, type PlayTarget } from "./lua/playRuntime.ts";
import { exportZip, publishDialog, type ShareContext } from "./ui/share.ts";
import { modPageDialog } from "./ui/modPage.ts";
import { isTyping, MapView, warpLayer } from "./render/mapView.ts";
import { mountBlockPalette } from "./ui/blockPalette.ts";
import { differencesMarkdown, mountChangesMenu } from "./ui/changesMenu.ts";
import { ScanSearch, Brush, DoorOpen, Footprints, Package, Globe, Grid3x3, LayoutGrid, Maximize, MousePointer2, PaintBucket, Paintbrush, Palette, Play, Redo2, Save, Settings, Signpost, Square, Swords, Undo2, User, UserRound, Waves, ZoomIn, ZoomOut, type IconNode } from "lucide";
import { modDetailsDialog } from "./ui/modDetails.ts";
import { $, clear, dropdown, field, h, icon, numberInput, setComboLabels, toast, errorText } from "./ui/dom.ts";
import { addCustom, addEntity, deleteSelection, mountInspector, nudgeSelection } from "./ui/inspector.ts";
import { mountMapList } from "./ui/mapList.ts";
import { nav, WORKSPACES, type EventsView, type GraphicsView, type WorkspaceId } from "./ui/nav.ts";
import { mountEncounterPane } from "./ui/encounterPanel.ts";
import { mountGlobalWorkspace } from "./ui/globalWorkspace.ts";
import { mountPokemonWorkspace } from "./ui/pokemonEditor.ts";
import { mountRightTabs } from "./ui/rightTabs.ts";
import { mountPaletteSplitter, mountSplitters } from "./ui/splitters.ts";
import { recall, remember } from "./ui/storage.ts";
import { mountTextWorkspace } from "./ui/textWorkspace.ts";
import { mountTrainerWorkspace } from "./ui/trainerEditor.ts";
import { mountMoveWorkspace } from "./ui/moveEditor.ts";
import { mountItemWorkspace } from "./ui/itemEditor.ts";
import { mountTilesetWorkspace } from "./ui/tilesetEditor.ts";
import { mountSpriteWorkspace } from "./ui/spriteEditor.ts";
import { mountImageWorkspace } from "./ui/imageEditor.ts";
import { mountPaletteWorkspace } from "./ui/paletteEditor.ts";
import { mountTownMapWorkspace, townMapSheets } from "./ui/townMapEditor.ts";
import { mountTownMap2 } from "./ui/townMapEditor2.ts";
import { FEATURES } from "./features.ts";
import { MAX_BLOCKS } from "./core/tileBrush.ts";
import { mountEventWorkspace } from "./ui/eventEditor.ts";
import { mountFlagsView } from "./ui/flagsView.ts";
import { bugReportDialog } from "./ui/bugReport.ts";
import { installLog, log } from "./core/log.ts";
import { installTrainerSync } from "./ui/trainerEvents.ts";
import { playEvent } from "./ui/eventPreview.ts";

configureLua(wasmUrl);
// the desktop shell when running inside it, the dev server otherwise
const host = isTauri() ? tauriHost : httpHost;

const LAST_MOD_KEY = "studio.lastMod";
const LAST_VERSION_KEY = "studio.lastVersion";
const WORKSPACE_KEY = "studio.workspace";
let hostInfo: HostInfo | null = null;
let allMods: ModInfo[] = [];
let mods: ModInfo[] = [];
let currentMod: string | null = null;
let currentVersion = "red";

// first, so the bug report log sees everything after it
installLog();

const view = new MapView($("#viewport"));

// ---------------------------------------------------------------- top bar

const versionSelect = h("select", { class: "version-select", title: "Which imported ROM to edit" });
const modSelect = h("select", { class: "mod-select", title: "The mod your edits are saved into" });
// the mod menu (gear next to the mod picker): details, validate, pack, and
// which gen1recomp the studio works on
const modMenuBtn = h("button", { class: "btn icon", "aria-label": "Mod menu" }, icon(Settings));
const modMenuPanel = h("div", { class: "menu left" });
const modMenu = dropdown(modMenuBtn, modMenuPanel);
const menuRow = (label: string, run: () => void) =>
  h("button", { class: "menu-row", onclick: () => (modMenu.close(), run()) }, label);
// the mod's name, description, version, ... (manifest.json)
const modDetailsBtn = menuRow("Mod details…", () => currentMod && void modDetailsDialog(host, currentMod, store.adapter.id, () => void refreshMods(), allMods.map((m) => m.id)));
modDetailsBtn.title = "Name, description, version, category";
const modPageBtn = menuRow("Mod page…", () => currentMod && void modPageDialog(host, currentMod));
modPageBtn.title = "README.md: the page people see on the mod's GitHub repository";
const validateBtn = menuRow("Validate", () => validate());
validateBtn.append(h("span", { class: "menu-key" }, "Ctrl+V"));
const exportBtn = menuRow("Export .zip…", () => currentMod && void exportZip(shareContext(currentMod)));
exportBtn.title = "The .zip players install (gen1recomp: MODS > Import mod .zip)";
const publishBtn = menuRow("Publish on GitHub…", () => currentMod && void publishDialog(shareContext(currentMod)));
publishBtn.title = "Upload the mod to its own GitHub repository; GitHub builds the .zip release players install and update from";
const packBtn = menuRow("Pack…", () => pack());
// the mod's folder (or mods/ without one) in Explorer / Finder
const folderBtn = menuRow("Open folder", () => void host.openFolder(currentMod ?? "").catch((err) => toast(errorText(err), "error")));
packBtn.append(h("span", { class: "menu-key" }, "Ctrl+P"));
// clickable in the desktop app
const installBtn = menuRow("", () => switchInstall());
const updateBtn = menuRow("Check for updates…", () => void checkForUpdates(false));
const bugBtn = menuRow("Report a bug…", () => bugReportDialog());
bugBtn.title = "Copy what happened this session and open the bug form on GitHub";
modMenuPanel.append(modDetailsBtn, modPageBtn, validateBtn, exportBtn, publishBtn, packBtn, folderBtn, h("div", { class: "menu-sep" }), installBtn, updateBtn, bugBtn);

// what Export .zip and Publish on GitHub need from the top bar
function shareContext(modId: string): ShareContext {
  return {
    host,
    version: store.project.version,
    modId,
    checkout: !!hostInfo?.modkit,
    save,
    unsaved: () => store.unsaved,
    busy: whileBusy,
    dialog: openDialog,
    closeDialog: () => dialog.close(),
  };
}
const saveBtn = h("button", { class: "btn primary icon", onclick: () => save(), title: "Save into the mod (Ctrl+S)", "aria-label": "Save" }, icon(Save));
const playBtn = h("button", {
  class: "btn icon",
  "aria-label": "Play from here",
  title: "Play from here: click a cell on the map, and the game starts there with this mod, from your active save. Saving is off in test runs.",
  onclick: () => {
    if (store.adapter.playFromHere === false) return void launch(null);
    setWorkspace("maps");
    playFromHere();
  },
}, icon(Play));
const undoBtn = h("button", { class: "btn icon", onclick: () => store.undo(), title: "Undo (Ctrl+Z)", "aria-label": "Undo" }, icon(Undo2));
const redoBtn = h("button", { class: "btn icon", onclick: () => store.redo(), title: "Redo (Ctrl+Shift+Z)", "aria-label": "Redo" }, icon(Redo2));

async function switchInstall(): Promise<void> {
  if (!isTauri()) {
    toast("Set GEN1RECOMP_ROOT or studio.config.json to change folders in the browser", "info");
    return;
  }
  if (store.unsaved && !confirm("Switching folders discards unsaved edits. Continue?")) return;
  try {
    if (await chooseGameRoot()) location.reload();
  } catch (err) {
    toast(errorText(err), "error");
  }
}

function renderInstall(): void {
  if (!hostInfo) return;
  const name = hostInfo.gameRoot.split(/[\\/]/).filter(Boolean).pop() ?? hostInfo.gameRoot;
  const kind = hostInfo.kind === "source" ? "checkout" : hostInfo.portable ? "portable release" : "release";
  installBtn.textContent = `${name} · ${kind}`;
  installBtn.title = `${hostInfo.gameRoot}\nMods: ${hostInfo.modsDir}${isTauri() ? "\nClick to choose another gen1recomp folder" : ""}`;
  modMenuBtn.title = `Mod details, Validate, Pack\ngen1recomp: ${hostInfo.gameRoot} (${kind})`;
}

// one tab per workspace; game, mod, undo and save stay global
const workspaceTabs = WORKSPACES.map((w) =>
  h("button", { class: "ws-tab", "data-ws": w.id, title: `${w.label} (${w.key})`, onclick: () => setWorkspace(w.id) }, w.label),
);

$("#topbar").append(
  h("div", { class: "group" }, versionSelect),
  h("div", { class: "group" }, modSelect, modMenu.root),
  h("nav", { class: "ws-tabs" }, ...workspaceTabs),
  h("div", { class: "group" }, undoBtn, redoBtn),
  h("div", { class: "spacer" }),
  mountChangesMenu(),
  h("div", { class: "group" }, playBtn, saveBtn),
);

modSelect.addEventListener("change", async () => {
  const value = modSelect.value;
  if (value === "__new__") {
    modSelect.value = currentMod ?? "";
    newModDialog();
    return;
  }
  if (store.unsaved && !confirm("Switching mods discards unsaved edits. Continue?")) {
    modSelect.value = currentMod ?? "";
    return;
  }
  await openProject(value || null);
});

versionSelect.addEventListener("change", async () => {
  const version = versionSelect.value;
  // not imported (yet): look again (it may have been imported meanwhile)
  if (!hostInfo?.versions.find((v) => v.version === version)?.available) {
    hostInfo = await host.info();
    renderVersionSelect();
    if (!hostInfo.versions.find((v) => v.version === version)?.available) {
      versionSelect.value = currentVersion;
      const name = `${version[0].toUpperCase()}${version.slice(1)}`;
      openDialog(
        `${name} isn't imported yet`,
        [
          h("p", {}, `The studio edits a game from the data gen1recomp imports from your own ROM, and there is no ${name} data yet.`),
          h("p", {}, `Start gen1recomp, choose ${name} and give it your ${name} ROM: it imports the data once. Then pick ${name} here again.`),
          h("p", { class: "hint" }, "Only a finished import counts (gen1recomp writes rom-cache.complete when it is done)."),
        ],
        [h("button", { class: "btn primary", onclick: () => dialog.close() }, "OK")],
      );
      return;
    }
  }
  if (store.unsaved && !confirm("Switching games discards unsaved edits. Continue?")) {
    versionSelect.value = currentVersion;
    return;
  }
  currentVersion = version;
  remember(LAST_VERSION_KEY, version);
  filterMods();
  await openProject(mods.some((m) => m.id === currentMod) ? currentMod : null);
});

function renderVersionSelect(): void {
  clear(versionSelect);
  for (const v of hostInfo?.versions ?? []) {
    const ready = !!adapterFor(v.version);
    // versions the studio supports are listed even without an import, so
    // picking one can explain how to get its data
    if (!v.available && !ready) continue;
    const game = GAME_OF_VERSION[v.version];
    const label = `${v.version[0].toUpperCase()}${v.version.slice(1)} · ${GAME_NAMES[game]}${!ready ? " (coming soon)" : !v.available ? " (not imported)" : ""}`;
    versionSelect.append(h("option", { value: v.version, selected: v.version === currentVersion, disabled: !ready }, label));
  }
}

// mods that declare this game in their manifest (gen1recomp ModTargets: no
// "games" = every Gen 1 game)
function filterMods(): void {
  const game = adapterFor(currentVersion)?.manifestGame ?? "";
  mods = allMods.filter((m) => (m.games.length ? m.games : ["gen1"]).some((g) => {
    const t = g.toLowerCase().replace(/\s+/g, "");
    return t === game || t === currentVersion || t === "all";
  }));
}

function renderModSelect(): void {
  clear(modSelect);
  modSelect.append(h("option", { value: "" }, "(none — browse only)"));
  for (const m of mods) {
    modSelect.append(h("option", { value: m.id, selected: m.id === currentMod }, m.hasStudioContent ? `${m.id}  ◆` : m.id));
  }
  modSelect.append(h("option", { value: "__new__" }, "+ New mod…"));
  modSelect.value = currentMod ?? "";
}

// what differs from the base, per registry ("2 maps · 1 pokemon")
function refreshTopbar(): void {
  saveBtn.classList.toggle("attention", store.unsaved);
  undoBtn.disabled = !store.canUndo;
  redoBtn.disabled = !store.canRedo;
  undoBtn.title = store.canUndo ? `Undo ${store.undoLabel()} (Ctrl+Z)` : "Undo (Ctrl+Z)";
  validateBtn.disabled = !currentMod || !hostInfo?.modkit;
  modDetailsBtn.disabled = !currentMod;
  exportBtn.disabled = publishBtn.disabled = modPageBtn.disabled = !currentMod;
  folderBtn.textContent = currentMod ? "Open mod folder" : "Open mods folder";
  folderBtn.title = hostInfo ? `${hostInfo.modsDir}${currentMod ? `\\${currentMod}` : ""}` : "";
  playBtn.disabled = !store.project;
  packBtn.disabled = validateBtn.disabled;
  packBtn.title = validateBtn.disabled && hostInfo && !hostInfo.modkit ? "Packing needs a gen1recomp source checkout (tools/modkit.py)" : "Make the .modpkg file players install (runs validate --strict first)";
  validateBtn.title = hostInfo && !hostInfo.modkit
    ? "Validate needs a source checkout of gen1recomp (tools/modkit.py); release builds do not ship it"
    : "Run modkit validate --strict and lint";
  document.title = `${store.unsaved ? "• " : ""}${currentMod ? `${currentMod} — ` : ""}G1R Studio`;
}

// ---------------------------------------------------------------- toolbar

const TOOLS: { id: Tool; label: string; key: string; tip: string; icon: IconNode }[] = [
  { id: "select", label: "Select", key: "S", tip: "Select, move and edit warps, NPCs and signs", icon: MousePointer2 },
  { id: "brush", label: "Block brush", key: "B", tip: "Paint the current stamp of blocks", icon: Paintbrush },
  { id: "tile", label: "Tile brush", key: "T", tip: "Paint single 8×8 tiles: the studio makes or reuses the blocks (right-click picks a tile, right-drag an area)", icon: Brush },
  { id: "rect", label: "Rectangle", key: "R", tip: "Drag a rectangle; it is filled with the stamp pattern", icon: Square },
  { id: "fill", label: "Flood fill", key: "F", tip: "Fill all connected identical blocks with the stamp", icon: PaintBucket },
];
const OVERLAYS: { id: keyof Overlays; label: string; key: string; tip?: string; icon: IconNode }[] = [
  { id: "grid", label: "Grid", key: "G", icon: Grid3x3 },
  { id: "collision", label: "Collisions", key: "C", tip: "where the player can't walk", icon: Footprints },
  { id: "entities", label: "Entities", key: "E", tip: "warps, NPCs and signs", icon: User },
  { id: "neighbors", label: "Neighbouring maps", key: "N", icon: LayoutGrid },
  { id: "wild", label: "Wild encounters", key: "W", tip: "the cells that can start a wild battle", icon: Swords },
  { id: "animate", label: "Animated tiles", key: "A", icon: Waves },
];

const toolButtons = TOOLS.map((t) =>
  h("button", { class: "tool icon-tool", title: `${t.label}: ${t.tip} (${t.key})`, "aria-label": t.label, onclick: () => store.setTool(t.id), "data-tool": t.id }, icon(t.icon)),
);
const overlayButtons = OVERLAYS.map((o) =>
  h(
    "button",
    { class: "toggle icon-tool", title: `${o.label}${o.tip ? `: ${o.tip}` : ""} (${o.key})`, "aria-label": o.label, onclick: () => store.toggleOverlay(o.id), "data-overlay": o.id },
    icon(o.icon),
  ),
);
// RED++ colors (pokered-gbc), when the install has their data (a checkout)
const COLORS_KEY = "studio.colorMode";
function toggleColors(): void {
  if (!gbcAvailable()) return;
  store.setColorMode(store.colorMode === "redpp" ? "sgb" : "redpp");
  remember(COLORS_KEY, store.colorMode);
}
const colorButton = h("button", { class: "toggle icon-tool", "aria-label": "RED++ colors", onclick: toggleColors }, icon(Palette));
// the time of day the map view shows (games with times of day: Gen 2)
const timeSelect = h("select", { class: "time-select", title: "Time of day the maps are shown in (a map that sets its own keeps it)" });
timeSelect.addEventListener("change", () => store.setTimeOfDay(timeSelect.value));
function updateTimeSelect(): void {
  const times = store.project ? store.adapter.times : undefined;
  timeSelect.hidden = !times;
  if (!times) return;
  if (!times.some((t) => t.key === store.timeOfDay)) store.timeOfDay = times[0].key;
  timeSelect.replaceChildren(...times.map((t) => h("option", { value: t.key, selected: t.key === store.timeOfDay }, t.label)));
}

// the scene the open map is shown and painted in (games with scenes: Gen 2)
const sceneSelect = h("select", { class: "time-select", title: "The map's scene (its story stage): step triggers of other scenes are faint, and in scenes above 0 the block brush paints that scene's own blocks" });
sceneSelect.addEventListener("change", () => {
  const scenes = store.adapter.scenes;
  if (!scenes) return;
  if (sceneSelect.value === "new") {
    const n = Math.max(0, ...scenes.list(store.map, store.ctx)) + 1;
    store.edit(store.currentMap, "New scene", (d) => scenes.setName(d, n, `Scene ${n}`));
    store.seal();
    store.setScene(n);
  } else store.setScene(Number(sceneSelect.value));
});
function updateSceneSelect(): void {
  const scenes = store.project && store.map ? store.adapter.scenes : undefined;
  sceneSelect.hidden = !scenes;
  if (!scenes) return;
  const names = scenes.names(store.map);
  const list = scenes.list(store.map, store.ctx);
  if (!list.includes(store.scene)) list.push(store.scene);
  sceneSelect.replaceChildren(
    ...list.sort((a, b) => a - b).map((n) => h("option", { value: String(n), selected: n === store.scene }, n === 0 ? `Scene 0 (start)${names["0"] ? ` · ${names["0"]}` : ""}` : `Scene ${n}${names[String(n)] && names[String(n)] !== `Scene ${n}` ? ` · ${names[String(n)]}` : ""}`)),
    h("option", { value: "new" }, "+ New scene"),
  );
}

function updateColorButton(): void {
  const ok = gbcAvailable();
  // RED++ is Gen 1's color mode: other games have no such toggle
  colorButton.hidden = !!store.project && store.adapter.id !== "gen1";
  colorButton.disabled = !ok;
  colorButton.classList.toggle("active", ok && store.colorMode === "redpp");
  colorButton.title = ok
    ? "RED++ colors: show maps in the game's COLORS=RED++ mode (from pokered-gbc). Off: the Game Boy palettes. (P)"
    : "RED++ colors need a gen1recomp source checkout (its data/palettes_gbc.lua)";
}
store.on((reason, _id) => {
  if (reason === "project" || reason === "colors") updateColorButton();
  if (reason === "project") updateRegionButtons();
  if (reason === "project") updateTimeSelect();
  if (reason === "project" || reason === "map" || reason === "scene" || (reason === "edit" && !store.brushing)) updateSceneSelect();
  // an edit of a registry this game only shows (Gen 2 maps), once per gesture
  if (reason === "notice" && _id) toast(_id, "error");
  if (reason === "viewonly" && !viewOnlyShown) {
    viewOnlyShown = true;
    toast(store.adapter.viewOnly?.reason ?? "This can't be changed here yet", "info");
    setTimeout(() => (viewOnlyShown = false), 3000);
  }
});
let viewOnlyShown = false;

// one "+" button per entity layer of the current game (the map markers' icons)
const ADD_ICONS: Partial<Record<string, IconNode>> = { warp: DoorOpen, npc: UserRound, sign: Signpost, item: Package, hidden: ScanSearch };
const addGroup = h("div", { class: "seg" });
function renderAddButtons(): void {
  clear(addGroup);
  for (const layer of store.adapter.layers) {
    const name = layer.kind === "npc" ? "NPC" : layer.singular;
    const glyph = ADD_ICONS[layer.kind];
    addGroup.append(
      h("button", { class: "btn small add-btn", title: `Add a ${name.toLowerCase()} at the cursor or view centre`, "aria-label": `Add ${name}`, onclick: () => addAt(layer.key) },
        "+", glyph ? icon(glyph) : ` ${name}`),
    );
    // the mods' own area kinds: arm the area brush
    if (layer.custom) {
      for (const k of extKinds().filter((x) => x.place === "cells")) {
        addGroup.append(
          h("button", { class: "btn small add-btn area-btn", "data-kind": k.id, title: `Paint ${k.label.toLowerCase()} (from the mod ${k.from}): drag on the map, right-drag erases`, "aria-label": `Paint ${k.label}`, style: `color:${k.color}`, onclick: () => startAreaBrush(k.id) },
            icon(Brush), icon(extIcon(k.icon)[1])),
        );
      }
    }
    // the mods' own placed kinds (studio_extensions.json)
    if (layer.custom) {
      for (const k of extKinds().filter((x) => x.place === "object")) {
        addGroup.append(
          h("button", { class: "btn small add-btn", title: `Add a ${k.label.toLowerCase()} (from the mod ${k.from}) at the cursor or view centre`, "aria-label": `Add ${k.label}`, style: `color:${k.color}`, onclick: () => addAt(layer.key, `ext:${k.id}`) },
            "+", icon(extIcon(k.icon)[1])),
        );
      }
    }
    for (const v of layer.variants ?? []) {
      const vglyph = ADD_ICONS[v.id];
      addGroup.append(
        h("button", { class: "btn small add-btn", title: `Add an ${v.label.toLowerCase()} at the cursor or view centre`, "aria-label": `Add ${v.label}`, onclick: () => addAt(layer.key, v.id) },
          "+", vglyph ? icon(vglyph) : ` ${v.label}`),
      );
    }
  }
}
const zoomLabel = h("span", { class: "zoom-label" });
const regionButtons = h("span", { class: "row nowrap" });

$("#toolbar").append(
  h("div", { class: "seg" }, ...toolButtons),
  h("div", { class: "seg" }, ...overlayButtons, colorButton),
  timeSelect,
  sceneSelect,
  addGroup,
);

// Play from here: the studio's helper mod (src/lua/playRuntime.ts) puts the
// player on the picked cell of the game it starts
function playFromHere(): void {
  const mapId = store.currentMap;
  if (!mapId) return;
  if (view.picking) return view.cancelPick();
  pickOnMap("Play from here: click the cell where the game should start", (cx, cy) => void launch({ map: mapId, x: cx, y: cy }));
}

// One cell to pick on the open map (Play from here, Pick on map): a banner
// over the map says what to do, and the Select tool is on (and locked) until
// the pick ends; the tool from before comes back after.
function pickOnMap(message: string, onPick: (cx: number, cy: number) => void): void {
  if (view.picking) view.cancelPick();
  const before = store.tool;
  store.setTool("select");
  store.toolLocked = true;
  const bar = h("div", { class: "preview-bar pick-bar" },
    h("span", { class: "on-air", "aria-hidden": "true" }),
    h("strong", {}, message),
    h("span", { class: "muted" }, "Esc cancels"),
    h("button", { class: "btn small", onclick: () => view.cancelPick() }, "Cancel"));
  $("#viewport").append(bar);
  refreshToolbar();
  view.pickCell(onPick, () => {
    bar.remove();
    store.toolLocked = false;
    store.setTool(before);
    refreshToolbar();
  });
}

// starts the game with the mod and the studio's helper: on a picked cell, or
// (null) as usual, from the title screen
async function launch(at: PlayTarget | null): Promise<void> {
  const map = at && store.maps[at.map];
  if (at && (!map || !store.adapter.cell(map, liveTileset(map.tileset), at.x, at.y).walkable)) {
    toast(`${at.map} (${at.x}, ${at.y}) is not a walkable cell: pick one the player can stand on`, "error");
    return;
  }
  // the game runs what is on disk
  if (currentMod && store.unsaved) {
    await save();
    if (store.unsaved) return;
  }
  try {
    await host.writeText(`mods/${PLAYTEST_ID}/manifest.json`, playtestManifest(store.adapter.manifestGame, !!at));
    await host.writeText(`mods/${PLAYTEST_ID}/main.lua`, at ? (store.adapter.playtestMain ?? playtestMain)(at) : playtestSavingOff());
    if (currentMod && (await ensurePlayEnv(host, currentMod))) {
      toast(`mods/${currentMod}/manifest.json now names force_enable_env, so test runs include the mod even when it is switched off in the game`, "info");
    }
    await host.play(store.project.version);
    toast(`Starting ${store.project.version}${at ? ` at ${at.map} (${at.x}, ${at.y})` : ""}: saving is off in this run`, "ok");
  } catch (err) {
    toast(`Can't start the game: ${errorText(err)}`, "error");
  }
}
// view controls float over the map view's top-right corner
$("#viewport").append(
  h(
    "div",
    { class: "view-float" },
    h("button", { class: "btn small ghost", onclick: () => view.zoomBy(1 / 1.25), title: "Zoom out (-)", "aria-label": "Zoom out" }, icon(ZoomOut)),
    zoomLabel,
    h("button", { class: "btn small ghost", onclick: () => view.zoomBy(1.25), title: "Zoom in (+)", "aria-label": "Zoom in" }, icon(ZoomIn)),
    h("span", { class: "view-float-sep" }),
    h("button", { class: "btn small ghost", onclick: () => view.fitMap(), title: "Fit the map (0)", "aria-label": "Fit map" }, icon(Maximize)),
    h("button", { class: "btn small ghost", onclick: () => view.toOverworld(), title: "The connected world; inside a building, the outdoor map it leads out to (Shift+0)", "aria-label": "Fit world" }, icon(Globe)),
    regionButtons,
  ),
);
// games with several regions (Gen 2: Johto, Kanto): jump to one's world
function updateRegionButtons(): void {
  const regions = store.project ? store.adapter.regions ?? [] : [];
  regionButtons.replaceChildren(...regions.filter((r) => store.maps[r.map]).map((r) =>
    h("button", { class: "btn small ghost", title: `${r.label}: the world around ${r.map}`, onclick: () => { view.openMap(r.map); view.fitWorld(); } }, r.label),
  ));
  regionButtons.hidden = !regionButtons.childElementCount;
}

function addAt(layer: string, variant?: string): void {
  const { cx, cy } = view.centerCell();
  if (variant?.startsWith("ext:")) return addCustom(variant.slice(4), cx, cy);
  addEntity(layer, cx, cy, variant);
}

function refreshToolbar(): void {
  for (const b of toolButtons) {
    b.classList.toggle("active", b.dataset.tool === store.tool);
    b.disabled = store.toolLocked;
  }
  for (const b of overlayButtons) b.classList.toggle("active", store.overlays[b.dataset.overlay as keyof Overlays]);
  for (const b of addGroup.querySelectorAll<HTMLElement>(".area-btn")) b.classList.toggle("active", store.tool === "area" && store.areaBrush?.kind === b.dataset.kind);
  zoomLabel.textContent = `${Math.round(view.zoom * 100)}%`;
  $("#viewport").dataset.tool = store.tool;
}

// names next to the ids in pick lists (dom.ts attachCombo): the list id says
// which registry its options come from
const COMBO_REGISTRY: [RegExp, string][] = [[/species/, "pokemon"], [/moves/, "moves"], [/items/, "items"], [/trainer/, "trainers"]];
setComboLabels((listId, id) => {
  const reg = COMBO_REGISTRY.find(([re]) => re.test(listId))?.[1];
  const rec = reg && store.project ? (store.table(reg)[id] as { name?: unknown } | undefined) : undefined;
  if (typeof rec?.name === "string") return reg === "items" && /^(TM|HM)\d/.test(rec.name) ? `${rec.name} ${machineMove(rec)}` : rec.name;
  return undefined;
});
// a TM/HM item's move, for its label ("TM51 ABSORB")
function machineMove(rec: unknown): string {
  return String((rec as { machine?: { move?: string } }).machine?.move ?? "").replace(/_/g, " ");
}

// ---------------------------------------------------------------- status bar

const status = {
  map: h("span", {}),
  pos: h("span", {}),
  block: h("span", {}),
  walk: h("span", {}),
  hint: h("span", { class: "muted right" }, "Middle-drag pan · wheel zoom · right-click/drag pick · double-click neighbour to open"),
};
$("#statusbar").append(status.map, status.pos, status.block, status.walk, status.hint);

view.onTilesetFull = (tileset) =>
  foreignExtension(tileset) ? toast(foreignNote(tileset), "error") : toast(`${tileset} has ${MAX_BLOCKS} blocks, the most a map can use: no room for another. Paint with blocks it has, or free some in Graphics > Tilesets.`, "error");

view.onHover = (info) => {
  if (!info) {
    status.pos.textContent = status.block.textContent = status.walk.textContent = "";
    return;
  }
  status.map.textContent = info.mapId;
  status.pos.textContent = `block ${info.bx},${info.by} · cell ${info.cx},${info.cy}`;
  status.block.textContent = `block #${info.block}${info.tile !== undefined ? ` · tile $${info.tile.toString(16).toUpperCase().padStart(2, "0")}` : ""}`;
  status.walk.textContent = info.walkable ? "walkable" : "solid";
  status.walk.className = info.walkable ? "ok" : "bad";
  zoomLabel.textContent = `${Math.round(view.zoom * 100)}%`;
};

// ---------------------------------------------------------------- panels

mountMapList($("#left"), view, () => newMapDialog());
mountBlockPalette($("#palette"), view);
mountInspector($("#props"), view);
const encounterPane = mountEncounterPane($("#right-encounters"));
mountRightTabs($("#right-tabs"), { base: $("#right-base"), encounters: $("#right-encounters") }, (tab) => tab === "encounters" && encounterPane.render(), view);
mountPokemonWorkspace($("#pokemon-left"), $("#pokemon-center"), $("#pokemon-right"));
mountMoveWorkspace($("#moves-left"), $("#moves-center"), $("#moves-right"));
mountItemWorkspace($("#items-left"), $("#items-center"), $("#items-right"));
mountEventWorkspace($("#events-left"), $("#events-center"), $("#events-right"));
mountFlagsView($("#flags-left"), $("#flags-center"), $("#flags-right"));
// a trainer's line of sight moves with its NPC
installTrainerSync();
mountTrainerWorkspace($("#trainers-left"), $("#trainers-center"), $("#trainers-right"));
mountTextWorkspace($("#text-left"), $("#text-center"), $("#text-right"));
mountGlobalWorkspace($("#global-left"), $("#global-center"), $("#global-right"));
mountTilesetWorkspace($("#tilesets-left"), $("#tilesets-center"), $("#tilesets-right"));
mountSpriteWorkspace($("#sprites-left"), $("#sprites-center"), $("#sprites-right"));
mountImageWorkspace($("#images-left"), $("#images-center"), $("#images-right"));
mountPaletteWorkspace($("#palettes-left"), $("#palettes-center"), $("#palettes-right"));
// Gen 1's and Gen 2's Town Map editors share the panels (each in a display:
// contents wrapper); the open game's is shown, and gets the nav calls
{
  const wraps = (["left", "center", "right"] as const).map((side) => {
    const one = h("div", { style: "display: contents" });
    const two = h("div", { style: "display: none" });
    $(`#townmap-${side}`).append(one, two);
    return [one, two];
  });
  mountTownMapWorkspace(wraps[0][0], wraps[1][0], wraps[2][0]);
  const gen1 = { shown: nav.onTownMapShown, open: nav.openTownMap };
  // behind the feature flag: release builds carry no Gen 2 code
  const gen2 = FEATURES.gen2 ? mountTownMap2(wraps[0][1], wraps[1][1], wraps[2][1]) : null;
  const pick = () => {
    const two = !!gen2 && !!store.adapter?.townMap2;
    for (const [one, other] of wraps) {
      one.style.display = two ? "none" : "contents";
      other.style.display = two ? "contents" : "none";
    }
    nav.onTownMapShown = two ? gen2!.shown : gen1.shown;
    nav.openTownMap = two ? (() => { nav.setWorkspace("graphics"); nav.showGraphics("townmap"); gen2!.open(); }) : gen1.open;
  };
  store.on((reason) => reason === "project" && pick());
}
// the Graphics workspace's view switch, on top of both left panels
const GRAPHICS_VIEW_KEY = "studio.graphicsView";
const savedView = recall(GRAPHICS_VIEW_KEY);
nav.graphicsView = savedView === "sprites" || savedView === "images" || savedView === "palettes" || savedView === "townmap" ? savedView : "tilesets";
// a drop-down: fits the narrowest left panel however many views there are
const GRAPHICS_VIEWS: [GraphicsView, string][] = [["tilesets", "Tilesets"], ["sprites", "Sprites"], ["images", "Images"], ["palettes", "Palettes"], ["townmap", "Town Map"]];
const viewSwitches: HTMLSelectElement[] = [];
for (const host of [$("#tilesets-left"), $("#sprites-left"), $("#images-left"), $("#palettes-left"), $("#townmap-left")]) {
  const select = h("select", { class: "view-switch", "aria-label": "Graphics view", onchange: () => nav.showGraphics(select.value as GraphicsView) },
    ...GRAPHICS_VIEWS.map(([view, label]) => h("option", { value: view }, label)));
  viewSwitches.push(select);
  host.prepend(select);
}
nav.showGraphics = (view) => {
  nav.graphicsView = view;
  remember(GRAPHICS_VIEW_KEY, view);
  for (const s of viewSwitches) s.value = view;
  if (nav.workspace === "graphics") setWorkspace("graphics");
};
for (const s of viewSwitches) s.value = nav.graphicsView;
// the Events workspace's: its events, or the flags they use
const EVENTS_VIEW_KEY = "studio.eventsView";
nav.eventsView = recall(EVENTS_VIEW_KEY) === "flags" ? "flags" : "events";
const eventSwitches: HTMLSelectElement[] = [];
for (const host of [$("#events-left"), $("#flags-left")]) {
  const select = h("select", { class: "view-switch", "aria-label": "Events view", onchange: () => nav.showEvents(select.value as EventsView) },
    h("option", { value: "events" }, "Events"), h("option", { value: "flags" }, "Flags"));
  eventSwitches.push(select);
  host.prepend(select);
}
nav.showEvents = (view) => {
  nav.eventsView = view;
  remember(EVENTS_VIEW_KEY, view);
  for (const s of eventSwitches) s.value = view;
  if (nav.workspace === "events") setWorkspace("events");
};
for (const s of eventSwitches) s.value = nav.eventsView;
mountSplitters($("#layout"));
mountPaletteSplitter($("#right-base"), $("#palette"));

// ---------------------------------------------------------------- workspaces

function setWorkspace(id: WorkspaceId): void {
  // a generation without this workspace (shortcuts, links) stays on Maps
  const allowed = adapterFor(currentVersion)?.workspaces;
  if (allowed && !allowed.includes(id)) id = "maps";
  if (drawing && id !== "maps") drawing.finish(true);
  nav.workspace = id;
  document.body.dataset.ws = id;
  for (const el of document.querySelectorAll<HTMLElement>("#layout > [data-ws]")) {
    const view = el.dataset.ws === "events" ? nav.eventsView : nav.graphicsView;
    el.hidden = el.dataset.ws !== id || (el.dataset.view !== undefined && el.dataset.view !== view);
  }
  for (const b of workspaceTabs) b.classList.toggle("active", b.dataset.ws === id);
  remember(WORKSPACE_KEY, id);
  if (id === "maps") view.invalidate();
  if (id === "graphics") ({ tilesets: nav.onTilesetsShown, sprites: nav.onSpritesShown, images: nav.onImagesShown, palettes: nav.onPalettesShown, townmap: nav.onTownMapShown })[nav.graphicsView]();
}
nav.setWorkspace = setWorkspace;
// a jump from elsewhere (changes list, links): the view moves to the map too
// (view.openMap alone keeps the camera still for a neighbour you double-click)
nav.openMap = (mapId) => {
  setWorkspace("maps");
  view.openMap(mapId);
  view.fitMap();
};
// draws an event's walking path: each click walks from the path's end to
// the clicked cell (along x, then y); Escape returns to the Events workspace
// an event preview over the map view: a caption box, Stop, and a click or
// key to move on from a caption; leaving it restores the map
nav.playEvent = (mapId, blocks, start) => {
  const back = nav.workspace;
  setWorkspace("maps");
  view.openMap(mapId);
  store.select(null);
  const host = $("#viewport");
  let stopped = false;
  let wake: (() => void) | null = null;
  const caption = h("div", { class: "preview-caption", hidden: true, onclick: () => wake?.() });
  const stop = () => {
    stopped = true;
    wake?.();
  };
  const bar = h(
    "div",
    { class: "preview-bar" },
    h("span", {}, "Event preview"),
    h("span", { class: "muted" }, "click or a key: next · Esc: stop"),
    h("button", { class: "btn small", onclick: stop }, "Stop"),
  );
  host.append(bar, caption);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") stop();
    else wake?.();
  };
  window.addEventListener("keydown", onKey, true);
  playEvent(
    {
      show: (state) => view.setPreview(state),
      caption: (text) => {
        caption.hidden = !text;
        caption.textContent = text ?? "";
      },
      stopped: () => stopped,
      pause: (ms) =>
        new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            wake = null;
            resolve();
          };
          const timer = setTimeout(done, stopped ? 0 : ms);
          wake = done;
        }),
    },
    mapId,
    blocks,
    start,
  )
    .catch((err) => toast(errorText(err), "error"))
    .finally(() => {
      window.removeEventListener("keydown", onKey, true);
      view.setPreview(null);
      bar.remove();
      caption.remove();
      if (back !== "maps") setWorkspace(back);
    });
};
nav.pickCell = (mapId, picked) => {
  const back = nav.workspace;
  setWorkspace("maps");
  view.openMap(mapId);
  view.fitMap();
  pickOnMap("Click a cell on the map", (cx, cy) => {
    setWorkspace(back);
    picked(cx, cy);
  });
};
// the path drawing in progress (leaving the map in any way finishes it)
let drawing: { mapId: string; finish: (keep: boolean) => void } | null = null;

nav.drawPath = (mapId, start, dirs, changed, done) => {
  drawing?.finish(true);
  setWorkspace("maps");
  view.openMap(mapId);
  const original = [...dirs];
  const path = [...dirs];
  const end = () => {
    let x = start.x;
    let y = start.y;
    for (const d of path) {
      if (d === "up") y--;
      else if (d === "down") y++;
      else if (d === "left") x--;
      else if (d === "right") x++;
    }
    return { x, y };
  };
  view.setPathOverlay({ ...start, dirs: path });
  // how long the path was before each click, for taking clicks back
  const marks: number[] = [];
  const count = h("strong", {});
  const update = () => {
    view.setPathOverlay({ ...start, dirs: path });
    count.textContent = `${path.length} step${path.length === 1 ? "" : "s"}`;
    changed([...path]);
  };
  const undo = () => {
    path.length = marks.pop() ?? Math.max(0, path.length - 1);
    update();
  };
  // the bar over the map: what's going on, and the ways out
  const bar = h(
    "div",
    { class: "preview-bar draw-bar" },
    h("span", {}, "✏ Drawing a path", h("span", { class: "muted" }, " · "), count),
    h("span", { class: "muted" }, "Left click: walk there · Right click: take back · Enter: done · Esc: cancel"),
    h("button", { class: "btn small", title: "Take back the last click (Ctrl+Z)", onclick: undo }, "↶ Undo"),
    h("button", { class: "btn small", onclick: () => ((path.length = 0), (marks.length = 0), update()) }, "Clear"),
    h("button", { class: "btn small", title: "Throw this drawing away (Esc)", onclick: () => view.cancelPick(false) }, "Cancel"),
    h("button", { class: "btn small primary", title: "Keep the path (Enter)", onclick: () => view.cancelPick(true) }, "✓ Done"),
  );
  $("#viewport").append(bar);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") view.cancelPick(true);
    else if (e.key === "Escape") view.cancelPick(false);
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") undo();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener("keydown", onKey, true);
  drawing = { mapId, finish: (keep) => view.cancelPick(keep) };
  update();
  view.pickCells(
    (cx, cy) => {
      const e = end();
      marks.push(path.length);
      for (let i = 0; i < Math.abs(cx - e.x); i++) path.push(cx > e.x ? "right" : "left");
      for (let i = 0; i < Math.abs(cy - e.y); i++) path.push(cy > e.y ? "down" : "up");
      update();
    },
    (keep) => {
      drawing = null;
      window.removeEventListener("keydown", onKey, true);
      bar.remove();
      view.setPathOverlay(null);
      if (!keep) changed(original);
      if (nav.workspace === "maps") setWorkspace("events");
      done();
    },
    (cx, cy) => {
      // on the path: cut it back to that cell; elsewhere: undo the last click
      let x = start.x;
      let y = start.y;
      let at = x === cx && y === cy ? 0 : -1;
      path.forEach((d, i) => {
        if (d === "up") y--;
        else if (d === "down") y++;
        else if (d === "left") x--;
        else if (d === "right") x++;
        if (x === cx && y === cy) at = i + 1;
      });
      if (at >= 0 && at < path.length) path.length = at;
      else path.length = marks.pop() ?? Math.max(0, path.length - 1);
      while (marks.length && marks[marks.length - 1] > path.length) marks.pop();
      update();
    },
  );
};
nav.selectEntity = (mapId, layer, index) => {
  setWorkspace("maps");
  view.openMap(mapId);
  store.setTool("select");
  store.select({ layer, index });
  const e = store.entities(store.map, layer)[index];
  if (e) view.centerOnCell(e.x, e.y);
};
{
  const saved = recall(WORKSPACE_KEY) as WorkspaceId | null;
  setWorkspace(WORKSPACES.some((w) => w.id === saved) ? saved! : "maps");
}

store.on((reason) => {
  if (reason === "tool" || reason === "overlays" || reason === "project") refreshToolbar();
  if (reason === "project") renderAddButtons();
  if (["edit", "content", "project", "saved", "map"].includes(reason)) refreshTopbar();
  if (reason === "map" || reason === "project") status.map.textContent = store.currentMap;
  // opening another map ends a path drawing (kept)
  if ((reason === "map" || reason === "project") && drawing && store.currentMap !== drawing.mapId) drawing.finish(true);
  if (reason === "overlays") view.invalidate();
});
view.onDraw = () => (zoomLabel.textContent = `${Math.round(view.zoom * 100)}%`);

// ---------------------------------------------------------------- dialogs

const dialog = $("#dialog") as HTMLDialogElement;

function openDialog(title: string, body: Node[], actions: HTMLElement[]): void {
  clear(dialog);
  dialog.append(h("h3", {}, title), ...body, h("div", { class: "dialog-actions" }, ...actions));
  dialog.showModal();
}

function newModDialog(): void {
  const id = h("input", { type: "text", placeholder: "my_map_mod", spellcheck: false, pattern: "[\\w-]+" });
  const create = h("button", {
    class: "btn primary",
    onclick: async () => {
      const value = id.value.trim();
      if (!/^[\w-]+$/.test(value)) return toast("Use letters, numbers, _ or -", "error");
      create.disabled = true;
      try {
        await createMod(host, value, store.adapter.manifestGame, !!hostInfo?.modkit);
        dialog.close();
        await refreshMods();
        // keep current edits: they move into the new mod on next save
        currentMod = value;
        store.project.mod = value;
        renderModSelect();
        remember(LAST_MOD_KEY, currentMod);
        toast(`Created mods/${value}${hostInfo?.modkit ? " (via modkit scaffold)" : ""}`, "ok");
        refreshTopbar();
      } catch (err) {
        toast(errorText(err), "error");
      } finally {
        create.disabled = false;
      }
    },
  }, "Create");
  openDialog(
    "New mod",
    [
      h("p", { class: "hint" }, `Creates ${hostInfo?.modsDir ?? "mods"}${hostInfo?.modsDir?.includes("\\") ? "\\" : "/"}<id>${hostInfo?.modkit ? " with tools/modkit.py" : ""}. Its main.lua loads studio_content.lua, which the studio writes on save. Any unsaved edits carry over.`),
      field("Mod id", id),
    ],
    [h("button", { class: "btn", onclick: () => dialog.close() }, "Cancel"), create],
  );
  id.focus();
}

function newMapDialog(): void {
  const tilesets = tilesetIds();
  const mapIds = Object.keys(store.maps).sort();
  const id = h("input", { type: "text", placeholder: "MY_NEW_ROUTE", spellcheck: false });
  // start from an empty map, or from a copy of one (a Pokémon Center, a Mart, ...)
  const from = h(
    "select",
    {},
    h("option", { value: "empty" }, "An empty map"),
    h("option", { value: "copy" }, "A copy of a map"),
  );
  const source = h("select", {}, ...mapIds.map((m) => h("option", { value: m, selected: m === store.currentMap }, m)));
  const tileset = h("select", {}, ...tilesets.map((t) => h("option", { value: t, selected: t === store.map?.tileset }, t)));
  let width = 10;
  let height = 9;
  const fill = h("input", { type: "number", value: store.stamp.blocks[0] ?? 0, min: 0, max: 255 });
  const emptyFields = h(
    "div",
    {},
    field("Tileset", tileset),
    h(
      "div",
      { class: "row two" },
      field("Width (blocks)", numberInput(width, (v) => (width = Math.max(1, Math.min(255, v))), 1, 255)),
      field("Height (blocks)", numberInput(height, (v) => (height = Math.max(1, Math.min(255, v))), 1, 255)),
    ),
    field("Fill block", fill, "Defaults to the selected palette block"),
  );
  const copyFields = h(
    "div",
    { hidden: true },
    field("Copy of", source),
    h(
      "p",
      { class: "hint" },
      store.adapter.towns
        ? "Copies the blocks, NPCs, signs and their texts and roles (nurse, shop clerk, ...), the PC tiles, music and wild Pokémon. Not copied: warps (place the copy's doors yourself, then Connect to a door), connections to other maps, and any hand-written script the game runs on the original."
        : "Copies the blocks, people, signs (they say what they say on the original), music and wild Pokémon. Not copied: warps (place the copy's doors yourself, then Connect to a door), connections to other maps, and the scripts the game runs on entering the original.",
    ),
  );
  from.addEventListener("change", () => {
    emptyFields.hidden = from.value === "copy";
    copyFields.hidden = from.value !== "copy";
  });
  const create = h("button", {
    class: "btn primary",
    onclick: () => {
      const mapId = id.value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
      if (!mapId) return toast("Give the map an id", "error");
      if (store.maps[mapId]) return toast(`${mapId} already exists`, "error");
      const used = Object.values(store.maps).map((m) => m.index ?? 0);
      const index = Math.max(MOD_MAP_INDEX_BASE - 1, ...used) + 1;
      if (from.value === "copy") {
        const src = store.maps[source.value];
        if (!src) return toast("Pick a map to copy", "error");
        copyMap(src, mapId, index);
      } else {
        const block = Math.max(0, Math.trunc(Number(fill.value) || 0));
        store.createMap(store.adapter.newMap({ id: mapId, tileset: tileset.value, width, height, fill: block, index }));
      }
      dialog.close();
      view.openMap(mapId);
      view.fitMap();
    },
  }, "Create map");
  openDialog(
    "New map",
    [field("Map id", id, "UPPER_SNAKE_CASE; registered at index ≥ 1000"), field("Start from", from), emptyFields, copyFields],
    [h("button", { class: "btn", onclick: () => dialog.close() }, "Cancel"), create],
  );
  id.focus();
}

// A new map that starts as a copy of `src`. Its texts, NPC roles, PC tiles,
// music and wild Pokémon are keyed by map id or label elsewhere, so they are
// copied over to the new id/label too (one undo step). Connections and warps
// stay behind: they would lead into the original's neighbours and rooms,
// which don't lead back; the copy's doors are placed and connected by hand.
function copyMap(src: MapDef, mapId: string, index: number): void {
  const label = String(store.adapter.newMap({ id: mapId, tileset: src.tileset, width: 1, height: 1, fill: 0, index }).label ?? mapId);
  const map = clone(src);
  map.id = mapId;
  map.label = label;
  map.index = index;
  map.connections = {};
  const warps = warpLayer(store.adapter);
  if (warps) map[warps.layer.key] = [];
  const srcLabel = typeof src.label === "string" ? src.label : "";
  store.group(`New map ${mapId} (copy of ${src.id})`, () => {
    store.createMap(store.adapter.normalizeMap(map));
    const pointers = srcLabel ? store.table("text_pointers")[srcLabel] : undefined;
    if (pointers) store.setRecord("text_pointers", label, "Copy texts", clone(pointers));
    const song = store.table("map_songs")[src.id];
    if (song !== undefined) store.setRecord("map_songs", mapId, "Copy music", song);
    const wild = store.table("encounters")[src.id];
    if (wild !== undefined) store.setRecord("encounters", mapId, "Copy wild Pokémon", clone(wild));
    const towns = store.adapter.towns;
    const pcs = towns ? (store.table(towns.fieldRegistry).hiddenExtras as { pcTiles?: Record<string, unknown[]> } | undefined)?.pcTiles?.[src.id] : undefined;
    if (towns && pcs?.length) {
      store.editRecord<Record<string, unknown>>(towns.fieldRegistry, "hiddenExtras", "Copy PCs", (d) => {
        d.pcTiles = { ...((d.pcTiles as Record<string, unknown[]> | undefined) ?? {}), [mapId]: clone(pcs) };
      }, { create: () => ({}) });
    }
  });
}

// ---------------------------------------------------------------- save / validate

async function save(): Promise<void> {
  // a field still being typed in commits on blur (its change event fires
  // now), so Ctrl+S or the Save button never drops the last edit
  (document.activeElement as HTMLElement | null)?.blur?.();
  if (!currentMod) {
    toast("Choose a mod to save into, or create one", "error");
    modSelect.focus();
    return;
  }
  // warps the game would crash on (only maps this mod changes or adds)
  const problems = brokenWarps(store.adapter, store.maps, Object.keys(store.changed().maps ?? {}).filter((id) => store.maps[id]));
  if (problems.length) {
    const list = problems.map((p) => `• ${p.message}`).join("\n");
    if (!confirm(`These warps crash the game when used:\n\n${list}\n\nSave anyway?`)) return;
  }
  // moves whose effect exists neither in the game nor as a custom effect
  const moveSpec = store.adapter.moves;
  if (moveSpec) {
    const known = new Set(moveSpec.effects(store.ctx));
    const orphans = Object.entries(store.changed()[moveSpec.registry] ?? {})
      .filter(([, m]) => m && typeof (m as { effect?: unknown }).effect === "string" && !known.has((m as { effect: string }).effect))
      .map(([id, m]) => `• ${id}: ${(m as { effect: string }).effect}`);
    const list = orphans.join("\n");
    if (orphans.length && !confirm(`These moves use an effect that does not exist (the game would treat them as plain damage):\n\n${list}\n\nSave anyway?`)) return;
  }
  // a mod may not point at the game's own files (modkit MK301)
  const rom = romReferences(store.changed(), (registry) => store.baseTable(registry));
  if (rom.length) {
    const list = rom.slice(0, 10).map((r) => `• ${r}`).join("\n");
    if (!confirm(`These point at the game's own (ROM) files, which a mod may not do; validation will fail:\n\n${list}\n\nImport your own art for them. Save anyway?`)) return;
  }
  saveBtn.disabled = true;
  try {
    const result = await saveProject(store.project, store.changed());
    // DIFFERENCES.md: what the mod changes, for its GitHub page and .zip
    const modName = allMods.find((m) => m.id === currentMod)?.name ?? currentMod;
    await host.writeText(`mods/${currentMod}/DIFFERENCES.md`, differencesMarkdown(modName));
    // imported art the saved file uses goes next to it; studio images it no
    // longer uses are removed (assets/studio/ only)
    const saved = (await Promise.all([result.file, ...result.dataFiles].map((f) => host.readText("game", f)))).map((t) => t ?? "").join("\n");
    const art = await saveAssets(host, currentMod, saved);
    // replaced game images: files in overrides/
    const shots = await saveOverrides(host, currentMod, store.table(OVERRIDES));
    art.written += shots.written;
    // vanilla art reused through the asset-transforms recipe
    const tf = await syncTransforms(host, currentMod, saved, [...sheetRecipes(), ...townMapSheets()], imageAliases(store.table(OVERRIDES)));
    if (tf.blocked) toast(`mods/${currentMod} already has its own assets_transforms file, so vanilla art cannot be reused there. Import art instead.`, "error");
    store.markSaved();
    const parts = [];
    if (result.registered.length) parts.push(`${result.registered.length} new`);
    if (result.patched.length) parts.push(`${result.patched.length} patched`);
    if (art.written) parts.push(`${art.written} image${art.written === 1 ? "" : "s"}`);
    toast(`Saved studio_content.lua${parts.length ? ` (${parts.join(", ")})` : " (no changes)"}`, "ok");
    if (!result.wiredUp) wireUpDialog(result.snippet ?? "");
    await refreshMods();
  } catch (err) {
    toast(`Save failed: ${errorText(err)}`, "error");
  } finally {
    saveBtn.disabled = false;
  }
}

function wireUpDialog(snippet: string): void {
  const mod = currentMod!;
  openDialog(
    "Load the studio file from main.lua?",
    [
      h("p", {}, `mods/${mod}/main.lua does not load studio_content.lua yet, so the game will not see these edits.`),
      h("p", { class: "hint" }, "The studio can add this line before the final `end` of main.lua:"),
      h("pre", { class: "mono" }, snippet),
    ],
    [
      h("button", { class: "btn", onclick: () => dialog.close() }, "I'll add it myself"),
      h("button", {
        class: "btn primary",
        onclick: async () => {
          const error = await wireUp(host, mod);
          dialog.close();
          if (!error) toast("main.lua now loads studio_content.lua", "ok");
          else toast(error, "error");
          await refreshMods();
        },
      }, "Add the line"),
    ],
  );
}

// A modal "working" box: nothing else can be clicked or typed into until
// `run` finishes (keys are swallowed by the capture listener below).
let busy = false;
async function whileBusy<T>(title: string, run: (step: (text: string) => void) => Promise<T>): Promise<T> {
  const stepText = h("p", { class: "hint" });
  const box = h("dialog", { class: "busy-dialog" }, h("div", { class: "spinner" }), h("div", {}, h("strong", {}, title), stepText));
  box.addEventListener("cancel", (e) => e.preventDefault());
  document.body.append(box);
  box.showModal();
  busy = true;
  document.body.classList.add("busy");
  try {
    return await run((text) => (stepText.textContent = text));
  } finally {
    busy = false;
    document.body.classList.remove("busy");
    box.close();
    box.remove();
  }
}
window.addEventListener("keydown", (e) => {
  if (!busy) return;
  e.preventDefault();
  e.stopImmediatePropagation();
}, true);

async function validate(): Promise<void> {
  if (!currentMod || busy) return;
  const mod = currentMod;
  validateBtn.disabled = true;
  try {
    const result = await whileBusy(`Validating ${mod}`, async (step) => {
      if (store.unsaved) {
        step("Saving first…");
        await save();
      }
      step("Running modkit validate --strict and lint… (this can take a minute)");
      return validateMod(host, mod);
    });
    openDialog(
      result.ok ? "✓ Validate + lint passed" : "✗ Validate / lint reported problems",
      [h("pre", { class: `mono output ${result.ok ? "ok" : "bad"}` }, result.output)],
      [h("button", { class: "btn primary", onclick: () => dialog.close() }, "Close")],
    );
  } catch (err) {
    toast(errorText(err), "error");
  } finally {
    validateBtn.disabled = false;
  }
}

// where modkit wrote the package: the game folder (modkit runs there)
function packedPath(file: string | undefined): string {
  const root = hostInfo?.gameRoot ?? "";
  if (!file) return root;
  return `${root}${root.includes("\\") ? "\\" : "/"}${file}`;
}

// The .modpkg players install: modkit pack validates (strict, warnings too)
// and writes <id>-<version>.modpkg into the game folder.
async function pack(): Promise<void> {
  if (!currentMod || busy) return;
  const mod = currentMod;
  try {
    const result = await whileBusy(`Packing ${mod}`, async (step) => {
      if (store.unsaved) {
        step("Saving first…");
        await save();
      }
      step("Running modkit pack (validates first)…");
      return host.modkit(["pack", mod]);
    });
    const file = /([\w.-]+\.modpkg)/.exec(result.output)?.[1];
    openDialog(
      result.code === 0 ? "✓ Packed" : "✗ Not packed",
      [
        result.code === 0
          ? h("p", {}, "Share this file; players install it from the game's mod list:", h("br", {}), h("code", {}, packedPath(file)))
          : h("p", {}, "Packing runs validate --strict, so warnings stop it too. Fix what's listed, then pack again."),
        h("p", { class: "hint" }, "Raise the version in Mod details for every release you share."),
        h("pre", { class: `mono output ${result.code === 0 ? "ok" : "bad"}` }, processText(result) || "(no output)"),
      ],
      [h("button", { class: "btn primary", onclick: () => dialog.close() }, "Close")],
    );
  } catch (err) {
    toast(errorText(err), "error");
  }
}

// ---------------------------------------------------------------- keyboard

window.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "s") {
    e.preventDefault();
    save();
    return;
  }
  if (mod && e.key.toLowerCase() === "p") {
    e.preventDefault();
    if (!validateBtn.disabled) void pack();
    return;
  }
  if (mod && e.key.toLowerCase() === "f") {
    e.preventDefault();
    // workspaces without a list search (Global) ignore it
    const search = document.querySelector<HTMLInputElement>(nav.workspace === "maps" ? "#map-search" : `#${nav.workspace}-search`);
    search?.focus();
    search?.select();
    return;
  }
  if (isTyping(e) || dialog.open) return;
  // after the typing check: Ctrl+V pastes in text fields
  if (mod && e.key.toLowerCase() === "v") {
    e.preventDefault();
    if (!validateBtn.disabled) void validate();
    return;
  }
  if (!mod && !e.altKey) {
    const ws = WORKSPACES.find((w) => w.key === e.key);
    if (ws) {
      e.preventDefault();
      setWorkspace(ws.id);
      return;
    }
  }
  if (mod && e.key.toLowerCase() === "z") {
    e.preventDefault();
    e.shiftKey ? store.redo() : store.undo();
    return;
  }
  if (mod && e.key.toLowerCase() === "y") {
    e.preventDefault();
    store.redo();
    return;
  }
  // the rest are map editing shortcuts
  if (mod || e.altKey || nav.workspace !== "maps") return;
  const key = e.key.toUpperCase();
  const tool = TOOLS.find((t) => t.key === key);
  // a hidden tool (the tile brush while tilesets are view-only) has no key
  if (tool) return void (!toolButtons.find((b) => b.dataset.tool === tool.id)?.hidden && store.setTool(tool.id));
  const overlay = OVERLAYS.find((o) => o.key === key);
  if (overlay) return store.toggleOverlay(overlay.id);
  if (key === "P") return toggleColors();
  // Shift+0 by key position: ")" sits elsewhere on other layouts (Shift+9 on German ones)
  if (e.code === "Digit0" && e.shiftKey) {
    view.toOverworld();
    zoomLabel.textContent = `${Math.round(view.zoom * 100)}%`;
    return;
  }
  switch (e.key) {
    case "Delete":
    case "Backspace":
      deleteSelection();
      break;
    case "Escape":
      store.select(null);
      break;
    case "ArrowUp": case "ArrowDown": case "ArrowLeft": case "ArrowRight":
      if (store.selection) {
        e.preventDefault();
        nudgeSelection(e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0, e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0);
      }
      break;
    case "0":
      view.fitMap();
      break;
    case "+": case "=":
      view.zoomBy(1.25);
      break;
    case "-":
      view.zoomBy(1 / 1.25);
      break;
  }
  zoomLabel.textContent = `${Math.round(view.zoom * 100)}%`;
});
window.addEventListener("keyup", (e) => {
  if (e.key.startsWith("Arrow")) store.seal();
});
window.addEventListener("beforeunload", (e) => {
  if (store.unsaved) e.preventDefault();
});

// ---------------------------------------------------------------- boot

async function refreshMods(): Promise<void> {
  allMods = await listMods(host);
  filterMods();
  renderModSelect();
}

// what a generation the studio only partly supports hides: workspaces it
// has no editors for, and the map toolbar's add icons while maps are view-only
function applyAdapterLimits(adapter: NonNullable<ReturnType<typeof adapterFor>>): void {
  const shown = adapter.workspaces;
  for (const b of workspaceTabs) b.hidden = !!shown && !shown.includes(b.dataset.ws!);
  if (shown && !shown.includes(nav.workspace)) setWorkspace(shown[0] as WorkspaceId);
  addGroup.hidden = !!adapter.viewOnly?.registries.includes("maps");
  // the Graphics views the game has (Gen 2: Tilesets only)
  const views = adapter.graphicsViews;
  for (const sel of viewSwitches) for (const o of sel.options) o.hidden = !!views && !views.includes(o.value);
  if (views && !views.includes(nav.graphicsView)) nav.showGraphics(views[0] as GraphicsView);
  // the tile brush makes blocks, so it needs editable tilesets
  const noTiles = !!adapter.viewOnly?.registries.includes("tilesets");
  for (const b of toolButtons) if (b.dataset.tool === "tile") b.hidden = noTiles;
  if (noTiles && store.tool === "tile") store.setTool("select");
  const here = adapter.playFromHere !== false;
  playBtn.setAttribute("aria-label", here ? "Play from here" : "Play");
  playBtn.title = here
    ? "Play from here: click a cell on the map, and the game starts there with this mod, from your active save. Saving is off in test runs."
    : "Play: starts the game with this mod (continue your save from the title screen). Saving is off in test runs.";
}

async function openProject(mod: string | null): Promise<void> {
  const adapter = adapterFor(currentVersion);
  if (!adapter) {
    toast(`${currentVersion} is not supported yet`, "error");
    return;
  }
  document.body.classList.add("loading");
  log("open", `${currentVersion}, mod ${mod ?? "(none)"}`);
  try {
    const project = await loadProject(host, currentVersion, adapter, mod);
    // RED++ (pokered-gbc colors) is Gen 1 only
    const gbc = adapter.id === "gen1" ? await loadGbc(host, currentVersion) : null;
    setGbc(gbc);
    store.colorMode = gbc && recall(COLORS_KEY) === "redpp" ? "redpp" : "sgb";
    currentMod = mod;
    remember(LAST_MOD_KEY, currentMod);
    store.load(project);
    renderModSelect();
    applyAdapterLimits(adapter);
    // the studio runs mods against a stand-in API, so code that needs the
    // running game can fail here without affecting its map registrations
    if (project.warnings.length) {
      for (const w of project.warnings) console.warn(`[${mod}]`, w);
      toast(`${mod}: ${project.warnings.length} part${project.warnings.length === 1 ? "" : "s"} of the mod's code need the running game and were skipped. Its map edits are loaded.`, "info");
    }
  } catch (err) {
    toast(errorText(err), "error");
    renderModSelect();
  } finally {
    document.body.classList.remove("loading");
  }
}

async function boot(): Promise<void> {
  // the desktop app looks for a newer release once, quietly, after starting
  setTimeout(() => void checkForUpdates(true), 4000);
  try {
    hostInfo = await host.info();
    allMods = await listMods(host);
  } catch (err) {
    const choose = isTauri()
      ? h("button", {
          class: "btn primary",
          onclick: async () => {
            try {
              if (await chooseGameRoot()) location.reload();
            } catch (e) {
              toast(errorText(e), "error");
            }
          },
        }, "Choose gen1recomp folder…")
      : null;
    document.body.append(h("div", { class: "fatal" }, h("h2", {}, "Could not reach gen1recomp"), h("pre", {}, errorText(err)), choose));
    return;
  }
  const usable = hostInfo.versions.filter((v) => v.available && adapterFor(v.version)).map((v) => v.version);
  if (!usable.length) {
    document.body.append(
      h("div", { class: "fatal" }, h("h2", {}, "No supported ROM imported"), h("pre", {}, "Boot gen1recomp once with a Red, Blue or Yellow ROM so it imports, then reload.")),
    );
    return;
  }
  const lastVersion = recall(LAST_VERSION_KEY);
  currentVersion = lastVersion && usable.includes(lastVersion) ? lastVersion : usable[0];
  renderInstall();
  renderVersionSelect();
  filterMods();
  const last = recall(LAST_MOD_KEY);
  await openProject(last && mods.some((m) => m.id === last) ? last : null);
  refreshToolbar();
  refreshTopbar();
}

boot();
