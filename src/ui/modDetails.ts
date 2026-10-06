// The mod's own details (manifest.json): what players see in the game's mod
// list, how it loads, how it relates to other mods. Field meanings follow
// the engine's manifest reference (gen1recomp wiki "Reference: Manifest",
// src/mods/Manifest.lua). Keys the dialog doesn't show are kept as they are.

import type { Host } from "../host/types.ts";
import { field, h, toast } from "./dom.ts";

// what mods in the wild use; the manager groups by it and accepts any text
const CATEGORIES = ["GAMEPLAY", "BALANCE", "QUEST", "GRAPHICS", "AUDIO", "UI", "MECHANIC", "TOOL", "TOTAL_CONVERSION", "OTHER"];
const PROFILES: [string, string][] = [
  ["content", "Content: adds or changes game data (most mods)"],
  ["overhaul", "Overhaul: big changes; marked on linked play"],
  ["total_conversion", "Total conversion: a different game on the engine"],
];
const VERSIONS = ["red", "blue", "yellow"];
// permissions the engine knows (Manifest.lua); engine_internals follows what
// the studio's own helpers need, so it is shown, not toggled
const PERMISSIONS: [string, string][] = [
  ["network", "Network: talk to the internet (link play, logs)"],
  ["filesystem", "Filesystem: read and write files outside the mod's storage"],
  ["steps", "Steps: run code on every step"],
  ["background", "Background: keep running while paused"],
];
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const GITHUB = /^(?:https?:\/\/github\.com\/)?[\w.-]+\/[\w.-]+?(?:\.git)?\/?$/;
// "mod_id", "mod_id@^1.2.0", "mod_id#owner/repo"
const MOD_REF = /^[A-Za-z0-9_-]+(?:@\S+|#[\w.-]+\/[\w.-]+)?$/;

export async function modDetailsDialog(host: Host, modId: string, saved: () => void, otherMods: string[] = []): Promise<void> {
  const path = `mods/${modId}/manifest.json`;
  const text = await host.readText("game", path);
  if (text === null) return toast(`${path} is missing`, "error");
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(text) as Record<string, unknown>;
  } catch (err) {
    return toast(`${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`, "error");
  }
  const str = (k: string) => (typeof manifest[k] === "string" ? (manifest[k] as string) : "");
  const desc = str("description").startsWith("TODO:") ? "" : str("description");

  // ---- shown to players
  const name = h("input", { type: "text", value: str("name") || modId, spellcheck: false });
  const description = h("textarea", { rows: 3, placeholder: "One or two lines: what the mod changes" });
  description.value = desc;
  const version = h("input", { type: "text", value: str("version") || "0.1.0", spellcheck: false, placeholder: "1.0.0" });
  // category: the usual ones, or your own
  const curCat = (str("category") || "GAMEPLAY").toUpperCase();
  const category = h("select", {},
    ...CATEGORIES.map((c) => h("option", { value: c, selected: c === curCat }, c.replace(/_/g, " "))),
    h("option", { value: "__own", selected: !CATEGORIES.includes(curCat) }, "Your own…"),
  );
  const ownCat = h("input", { type: "text", value: CATEGORIES.includes(curCat) ? "" : curCat, spellcheck: false, placeholder: "MY_CATEGORY" });
  const syncCat = () => (ownCat.hidden = category.value !== "__own");
  category.addEventListener("change", syncCat);
  syncCat();
  const experimental = h("input", { type: "checkbox", checked: manifest.experimental === true });

  // ---- loading
  const profile = h("select", {}, ...PROFILES.map(([v, l]) => h("option", { value: v, selected: (str("profile") || "content") === v }, l)));
  const priority = h("input", { type: "number", value: String(manifest.priority ?? 0), min: -1000, max: 1000 });
  const games = Array.isArray(manifest.games) ? (manifest.games as unknown[]).filter((g): g is string => typeof g === "string") : [];
  const allGen1 = games.length === 0 || games.includes("gen1") || games.includes("all");
  const allBox = h("input", { type: "checkbox", checked: allGen1 });
  const versionBoxes = VERSIONS.map((v) => ({ v, box: h("input", { type: "checkbox", checked: allGen1 || games.includes(v), disabled: allGen1 }) }));
  allBox.addEventListener("change", () => versionBoxes.forEach(({ box }) => {
    box.disabled = allBox.checked;
    if (allBox.checked) box.checked = true;
  }));
  const gameVersion = h("input", { type: "text", value: str("game_version"), spellcheck: false, placeholder: ">=1.0.0 <2.0.0 (optional)" });

  // ---- other mods: comma-separated ids, optionally with a version range
  const modList = h("datalist", { id: "mod-ids" }, ...otherMods.filter((m) => m !== modId).map((m) => h("option", { value: m })));
  const listInput = (key: string, placeholder: string) => {
    const raw = Array.isArray(manifest[key]) ? (manifest[key] as unknown[]) : [];
    const plain = raw.every((x) => typeof x === "string");
    const input = h("input", { type: "text", value: plain ? (raw as string[]).join(", ") : "", spellcheck: false, placeholder, list: "mod-ids", disabled: !plain });
    if (!plain) input.title = "Written by hand in another form; edit manifest.json directly";
    return { key, input, plain };
  };
  const lists = [
    listInput("dependencies", "other_mod, other_mod@^1.0.0"),
    listInput("optional_dependencies", "loads after these when present"),
    listInput("conflicts", "can't be enabled together"),
    listInput("incompatible", "breaks with these"),
  ];
  // how the line is read, entry by entry, as the user types
  const readBack = (input: HTMLInputElement): HTMLElement => {
    const out = h("div", { class: "mod-refs" });
    const update = () => {
      const items = input.value.split(",").map((x) => x.trim()).filter(Boolean);
      out.replaceChildren(...items.map((x) => {
        const ok = MOD_REF.test(x);
        const known = ok && otherMods.includes(x.replace(/[@#].*$/, ""));
        const what = !ok ? "not a mod id" : x.includes("@") ? `version ${x.slice(x.indexOf("@") + 1)}` : x.includes("#") ? `from GitHub ${x.slice(x.indexOf("#") + 1)}` : "any version";
        return h("span", { class: `mod-ref ${ok ? "ok" : "bad"}`, title: ok && !known ? "Not installed here; that's fine if players get it elsewhere" : "" }, `${x.replace(/[@#].*$/, "")} · ${what}${ok && !known ? " · not installed" : ""}`);
      }));
    };
    input.addEventListener("input", update);
    update();
    return out;
  };
  const listField = (i: number, label: string, hint: string) =>
    lists[i].plain
      ? h("div", {}, field(label, lists[i].input, hint), readBack(lists[i].input))
      : field(label, lists[i].input, "Written in another form: edit manifest.json by hand.");

  // ---- updates and permissions
  const github = h("input", { type: "text", value: str("github"), spellcheck: false, placeholder: "owner/repo (optional)" });
  const perms = Array.isArray(manifest.permissions) ? (manifest.permissions as unknown[]).filter((p): p is string => typeof p === "string") : [];
  const permBoxes = PERMISSIONS.map(([p, label]) => ({ p, box: h("input", { type: "checkbox", checked: perms.includes(p) }), label }));

  const dialog = h("dialog", { class: "mod-details" });
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  const save = async () => {
    const v = version.value.trim();
    if (!name.value.trim()) return toast("Give the mod a name", "error");
    if (!SEMVER.test(v)) return toast("The version looks like 1.0.0 (major.minor.patch)", "error");
    const gh = github.value.trim();
    if (gh && !GITHUB.test(gh)) return toast("GitHub is owner/repo, or the repository's URL", "error");
    const cat = category.value === "__own" ? ownCat.value.trim().toUpperCase().replace(/\s+/g, "_") : category.value;
    if (!cat) return toast("Name your category, or pick one", "error");
    const next: Record<string, unknown> = { ...manifest, name: name.value.trim(), version: v, category: cat, priority: Math.trunc(Number(priority.value) || 0), profile: profile.value };
    const d = description.value.trim();
    next.description = d || `TODO: one line about ${modId}`;
    next.experimental = experimental.checked;
    if (gh) next.github = gh;
    else delete next.github;
    const gv = gameVersion.value.trim();
    if (gv) next.game_version = gv;
    else delete next.game_version;
    // games: Gen 1 as a whole or some of its versions; other generations kept
    const others = games.filter((g) => !["gen1", "all", ...VERSIONS].includes(g));
    const chosen = allBox.checked ? ["gen1"] : versionBoxes.filter((x) => x.box.checked).map((x) => x.v);
    if (!chosen.length) return toast("Pick at least one game", "error");
    next.games = [...chosen, ...others];
    for (const l of lists) {
      if (!l.plain) continue;
      const items = l.input.value.split(",").map((x) => x.trim()).filter(Boolean);
      const bad = items.find((x) => !MOD_REF.test(x));
      if (bad) return toast(`"${bad}" isn't a mod id (mod_id, mod_id@range or mod_id#owner/repo)`, "error");
      next[l.key] = items;
    }
    const keep = perms.filter((p) => !PERMISSIONS.some(([k]) => k === p));
    const nextPerms = [...keep, ...permBoxes.filter((x) => x.box.checked).map((x) => x.p)];
    if (nextPerms.length) next.permissions = nextPerms;
    else delete next.permissions;
    await host.writeText(path, JSON.stringify(next, null, 2) + "\n");
    toast("Mod details saved", "ok");
    close();
    saved();
  };
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  const internals = perms.includes("engine_internals");
  dialog.append(
    h("h3", {}, `Mod details · ${modId}`),
    h("div", { class: "mod-details-body" },
      h("h4", {}, "Shown to players"),
      field("Name", name, "In the game's mod list."),
      field("Description", description, "What players read before enabling it."),
      h("div", { class: "row" },
        field("Version", version, "Raise it for every release you share."),
        field("Category", h("div", { class: "row nowrap" }, category, ownCat), "The mod list groups by it."),
      ),
      h("label", { class: "inline-check" }, experimental, "Experimental (players confirm before enabling it)"),

      h("h4", {}, "Loading"),
      field("Profile", profile),
      h("div", { class: "row" },
        field("Priority", priority, "Lower loads first; a later mod wins where two change the same thing."),
        field("Engine version", gameVersion, "A version range of gen1recomp the mod needs. Empty: any."),
      ),
      field("Games", h("div", { class: "row wrap" },
        h("label", { class: "inline-check" }, allBox, "Every Gen 1 game"),
        ...versionBoxes.map(({ v, box }) => h("label", { class: "inline-check" }, box, v[0].toUpperCase() + v.slice(1))),
      ), "The game picker and the studio list a mod only for the games it names."),

      h("h4", {}, "Other mods"),
      h("div", { class: "hint mod-ref-help" },
        h("p", {}, "Each line takes mod ids (the folder name under mods/), separated by commas. Leave a line empty for none. Each id can carry:"),
        h("ul", {},
          h("li", {}, h("code", {}, "bills_garden"), ": any version"),
          h("li", {}, h("code", {}, "bills_garden@^1.2.0"), ": a version range after @ (^1.2.0 = 1.2.0 up to, not including, 2.0.0; >=1.0.0 <2.0.0 also works)"),
          h("li", {}, h("code", {}, "bills_garden#owner/repo"), ": where to get it on GitHub, if players don't have it"),
        ),
        h("p", {}, "Example: ", h("code", {}, "bills_garden, cool_gym_leaders@^1.0.0")),
      ),
      listField(0, "Needs", "Your mod won't load unless these are enabled; they load first."),
      listField(1, "Works with", "Loads after these when they are enabled; never blocks."),
      listField(2, "Conflicts with", "Can't be enabled together."),
      listField(3, "Incompatible with", "Known to break together."),
      modList,

      h("h4", {}, "Updates & permissions"),
      field("GitHub", github, "Lets the launcher update the mod from your repository's releases."),
      h("div", { class: "perm-list" }, ...permBoxes.map(({ box, label }) => h("label", { class: "inline-check" }, box, label))),
      h("p", { class: "hint" }, internals
        ? "engine_internals is on: the studio adds it while the mod uses something that writes into the engine (prize counters, RED++ colors) and removes it again when nothing does."
        : "engine_internals isn't needed: the studio adds it by itself when a feature requires it."),
    ),
    h("p", { class: "hint" }, `Saved straight to mods/${modId}/manifest.json (not part of undo). The id can't change.`),
    h("div", { class: "dialog-actions" }, h("button", { class: "btn", onclick: close }, "Cancel"), h("button", { class: "btn primary", onclick: () => void save() }, "Save details")),
  );
  document.body.append(dialog);
  dialog.showModal();
  name.focus();
}
