import wasmUrl from "wasmoon/dist/glue.wasm?url";
import { saveAssets, syncTransforms } from "./core/assets.ts";
import { brokenWarps, romReferences } from "./core/checks.ts";
import { store, type Overlays, type Tool } from "./core/store.ts";
import { clone } from "./core/merge.ts";
import { MOD_MAP_INDEX_BASE, type MapDef, type ModInfo } from "./core/types.ts";
import { adapterFor, GAME_NAMES, GAME_OF_VERSION } from "./games/index.ts";
import { httpHost } from "./host/httpHost.ts";
import { chooseGameRoot, isTauri, tauriHost } from "./host/tauriHost.ts";
import type { HostInfo } from "./host/types.ts";
import { configureLua } from "./lua/vm.ts";
import { createMod, listMods, openProject as loadProject, saveProject, validateMod, wireUp } from "./project/project.ts";
import { isTyping, MapView } from "./render/mapView.ts";
import { mountBlockPalette } from "./ui/blockPalette.ts";
import { mountChangesMenu } from "./ui/changesMenu.ts";
import { Grid3x3, MousePointer2, PaintBucket, Paintbrush, Pipette, Redo2, Square, Undo2, ZoomIn, ZoomOut, type IconNode } from "lucide";
import { $, clear, field, h, icon, numberInput, toast, errorText } from "./ui/dom.ts";
import { addEntity, deleteSelection, mountInspector, nudgeSelection } from "./ui/inspector.ts";
import { mountMapList } from "./ui/mapList.ts";
import { nav, WORKSPACES, type WorkspaceId } from "./ui/nav.ts";
import { mountEncounterPane } from "./ui/encounterPanel.ts";
import { mountGlobalWorkspace } from "./ui/globalWorkspace.ts";
import { mountPokemonWorkspace } from "./ui/pokemonEditor.ts";
import { mountRightTabs } from "./ui/rightTabs.ts";
import { mountSplitters } from "./ui/splitters.ts";
import { recall, remember } from "./ui/storage.ts";
import { mountTextWorkspace } from "./ui/textWorkspace.ts";
import { mountTrainerWorkspace } from "./ui/trainerEditor.ts";
import { mountMoveWorkspace } from "./ui/moveEditor.ts";
import { mountItemWorkspace } from "./ui/itemEditor.ts";
import { mountEventWorkspace } from "./ui/eventEditor.ts";
import { installTrainerSync } from "./ui/trainerEvents.ts";

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

const view = new MapView($("#viewport"));

// ---------------------------------------------------------------- top bar

const versionSelect = h("select", { class: "version-select", title: "Which imported ROM to edit" });
const modSelect = h("select", { class: "mod-select", title: "The mod your edits are saved into" });
const saveBtn = h("button", { class: "btn primary", onclick: () => save(), title: "Save into the mod (Ctrl+S)" }, "Save");
const validateBtn = h("button", { class: "btn", onclick: () => validate(), title: "Run modkit validate --strict and lint" }, "Validate");
const undoBtn = h("button", { class: "btn icon", onclick: () => store.undo(), title: "Undo (Ctrl+Z)", "aria-label": "Undo" }, icon(Undo2));
const redoBtn = h("button", { class: "btn icon", onclick: () => store.redo(), title: "Redo (Ctrl+Shift+Z)", "aria-label": "Redo" }, icon(Redo2));
// which gen1recomp the studio works on; clickable in the desktop app
const installBtn = h("button", { class: "btn small ghost install-btn", onclick: () => switchInstall() });

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
}

// one tab per workspace; game, mod, undo and save stay global
const workspaceTabs = WORKSPACES.map((w) =>
  h("button", { class: "ws-tab", "data-ws": w.id, title: `${w.label} (Alt+${w.key})`, onclick: () => setWorkspace(w.id) }, w.label),
);

$("#topbar").append(
  installBtn,
  h("div", { class: "group" }, h("span", { class: "muted" }, "Game"), versionSelect),
  h("div", { class: "group" }, h("span", { class: "muted" }, "Mod"), modSelect),
  h("nav", { class: "ws-tabs" }, ...workspaceTabs),
  h("div", { class: "group" }, undoBtn, redoBtn),
  h("div", { class: "spacer" }),
  mountChangesMenu(),
  h("div", { class: "group" }, validateBtn, saveBtn),
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
    if (!v.available) continue;
    const game = GAME_OF_VERSION[v.version];
    const ready = !!adapterFor(v.version);
    const label = `${v.version[0].toUpperCase()}${v.version.slice(1)} · ${GAME_NAMES[game]}${ready ? "" : " (coming soon)"}`;
    versionSelect.append(h("option", { value: v.version, selected: v.version === currentVersion, disabled: !ready }, label));
  }
}

// mods that declare this game (or no game at all) in their manifest
function filterMods(): void {
  const adapter = adapterFor(currentVersion);
  const game = adapter?.manifestGame ?? "";
  mods = allMods.filter((m) => !m.games.length || m.games.includes(game) || m.games.includes(currentVersion) || m.games.includes("all"));
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
  validateBtn.title = hostInfo && !hostInfo.modkit
    ? "Validate needs a source checkout of gen1recomp (tools/modkit.py); release builds do not ship it"
    : "Run modkit validate --strict and lint";
  document.title = `${store.unsaved ? "• " : ""}${currentMod ?? "Gen1Recomp"} — Gen1Recomp Studio`;
}

// ---------------------------------------------------------------- toolbar

const TOOLS: { id: Tool; label: string; key: string; tip: string; icon: IconNode }[] = [
  { id: "select", label: "Select", key: "V", tip: "Select, move and edit warps, NPCs and signs", icon: MousePointer2 },
  { id: "brush", label: "Brush", key: "B", tip: "Paint the current stamp", icon: Paintbrush },
  { id: "rect", label: "Rect", key: "R", tip: "Fill a rectangle with the stamp pattern", icon: Square },
  { id: "fill", label: "Fill", key: "F", tip: "Flood-fill connected identical blocks", icon: PaintBucket },
  { id: "pick", label: "Pick", key: "I", tip: "Copy a block or drag a region into the stamp (right-click/drag from any tool)", icon: Pipette },
];
const OVERLAYS: { id: keyof Overlays; label: string; key: string; icon?: IconNode }[] = [
  { id: "grid", label: "Grid", key: "G", icon: Grid3x3 },
  { id: "collision", label: "Collision", key: "C" },
  { id: "entities", label: "Entities", key: "E" },
  { id: "neighbors", label: "Neighbours", key: "N" },
  { id: "wild", label: "Wild", key: "W" },
];

const toolButtons = TOOLS.map((t) =>
  h("button", { class: "tool icon-tool", title: `${t.label}: ${t.tip} (${t.key})`, "aria-label": t.label, onclick: () => store.setTool(t.id), "data-tool": t.id }, icon(t.icon)),
);
const overlayButtons = OVERLAYS.map((o) =>
  h(
    "button",
    { class: `toggle${o.icon ? " icon-tool" : ""}`, title: `Toggle ${o.label.toLowerCase()} (${o.key})`, "aria-label": o.label, onclick: () => store.toggleOverlay(o.id), "data-overlay": o.id },
    o.icon ? icon(o.icon) : o.label,
  ),
);
// one "+" button per entity layer of the current game
const addGroup = h("div", { class: "seg" });
function renderAddButtons(): void {
  clear(addGroup);
  for (const layer of store.adapter.layers) {
    const name = layer.kind === "npc" ? "NPC" : layer.singular;
    addGroup.append(
      h("button", { class: "btn small", title: `Add a ${name.toLowerCase()} at the cursor or view centre`, onclick: () => addAt(layer.key) }, `+ ${name}`),
    );
  }
}
const zoomLabel = h("span", { class: "zoom-label" });

$("#toolbar").append(
  h("div", { class: "seg" }, ...toolButtons),
  h("div", { class: "seg" }, ...overlayButtons),
  addGroup,
  h("div", { class: "spacer" }),
  h(
    "div",
    { class: "seg" },
    h("button", { class: "btn small ghost", onclick: () => view.zoomBy(1 / 1.25), title: "Zoom out (-)", "aria-label": "Zoom out" }, icon(ZoomOut)),
    zoomLabel,
    h("button", { class: "btn small ghost", onclick: () => view.zoomBy(1.25), title: "Zoom in (+)", "aria-label": "Zoom in" }, icon(ZoomIn)),
    h("button", { class: "btn small ghost", onclick: () => view.fitMap(), title: "Fit map (0)" }, "Fit map"),
    h("button", { class: "btn small ghost", onclick: () => view.fitWorld(), title: "Fit connected world (Shift+0)" }, "World"),
  ),
);

function addAt(layer: string): void {
  const { cx, cy } = view.centerCell();
  addEntity(layer, cx, cy);
}

function refreshToolbar(): void {
  for (const b of toolButtons) b.classList.toggle("active", b.dataset.tool === store.tool);
  for (const b of overlayButtons) b.classList.toggle("active", store.overlays[b.dataset.overlay as keyof Overlays]);
  zoomLabel.textContent = `${Math.round(view.zoom * 100)}%`;
  $("#viewport").dataset.tool = store.tool;
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
// a trainer's line of sight moves with its NPC
installTrainerSync();
mountTrainerWorkspace($("#trainers-left"), $("#trainers-center"), $("#trainers-right"));
mountTextWorkspace($("#text-left"), $("#text-center"), $("#text-right"));
mountGlobalWorkspace($("#global-left"), $("#global-center"), $("#global-right"));
mountSplitters($("#layout"));

// ---------------------------------------------------------------- workspaces

function setWorkspace(id: WorkspaceId): void {
  nav.workspace = id;
  document.body.dataset.ws = id;
  for (const el of document.querySelectorAll<HTMLElement>("#layout > [data-ws]")) el.hidden = el.dataset.ws !== id;
  for (const b of workspaceTabs) b.classList.toggle("active", b.dataset.ws === id);
  remember(WORKSPACE_KEY, id);
  if (id === "maps") view.invalidate();
}
nav.setWorkspace = setWorkspace;
nav.openMap = (mapId) => {
  setWorkspace("maps");
  view.openMap(mapId);
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
  const tilesets = Object.keys(store.project.data.tilesets).sort();
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
      "Copies the blocks, warps, NPCs, signs and their texts and roles (nurse, shop clerk, ...), the PC tiles, music and wild Pokémon. Not copied: connections to other maps, and any hand-written script the game runs on the original.",
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
// copied over to the new id/label too (one undo step). Connections stay
// behind: they would point into the original's neighbours one way only.
function copyMap(src: MapDef, mapId: string, index: number): void {
  const label = String(store.adapter.newMap({ id: mapId, tileset: src.tileset, width: 1, height: 1, fill: 0, index }).label ?? mapId);
  const map = clone(src);
  map.id = mapId;
  map.label = label;
  map.index = index;
  map.connections = {};
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
    // imported art the saved file uses goes next to it; studio images it no
    // longer uses are removed (assets/studio/ only)
    const saved = (await host.readText("game", result.file)) ?? "";
    const art = await saveAssets(host, currentMod, saved);
    // vanilla art reused through the asset-transforms recipe
    const tf = await syncTransforms(host, currentMod, saved);
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

async function validate(): Promise<void> {
  if (!currentMod) return;
  if (store.unsaved) await save();
  validateBtn.disabled = true;
  validateBtn.textContent = "Validating…";
  try {
    const result = await validateMod(host, currentMod);
    openDialog(
      result.ok ? "✓ Validate + lint passed" : "✗ Validate / lint reported problems",
      [h("pre", { class: `mono output ${result.ok ? "ok" : "bad"}` }, result.output)],
      [h("button", { class: "btn primary", onclick: () => dialog.close() }, "Close")],
    );
  } catch (err) {
    toast(errorText(err), "error");
  } finally {
    validateBtn.disabled = false;
    validateBtn.textContent = "Validate";
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
    // workspaces without a list search (Global) ignore it
    const search = document.querySelector<HTMLInputElement>(nav.workspace === "maps" ? "#map-search" : `#${nav.workspace}-search`);
    search?.focus();
    search?.select();
    return;
  }
  if (e.altKey && !mod) {
    const ws = WORKSPACES.find((w) => w.key === e.key);
    if (ws) {
      e.preventDefault();
      setWorkspace(ws.id);
      return;
    }
  }
  if (isTyping(e) || dialog.open) return;
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
  if (tool) return store.setTool(tool.id);
  const overlay = OVERLAYS.find((o) => o.key === key);
  if (overlay) return store.toggleOverlay(overlay.id);
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
    case ")":
      view.fitWorld();
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

async function openProject(mod: string | null): Promise<void> {
  const adapter = adapterFor(currentVersion);
  if (!adapter) {
    toast(`${currentVersion} is not supported yet`, "error");
    return;
  }
  document.body.classList.add("loading");
  try {
    const project = await loadProject(host, currentVersion, adapter, mod);
    currentMod = mod;
    remember(LAST_MOD_KEY, currentMod);
    store.load(project);
    renderModSelect();
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
