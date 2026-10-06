// The mod's own details (manifest.json): what players see in the game's mod
// list and what packing/sharing uses. Keys the dialog doesn't show are kept.

import type { Host } from "../host/types.ts";
import { field, h, toast } from "./dom.ts";

// what mods in the wild use; the manager groups by it and accepts any text
const CATEGORIES = ["GAMEPLAY", "BALANCE", "QUEST", "GRAPHICS", "AUDIO", "UI", "MECHANIC", "TOOL", "TOTAL_CONVERSION", "OTHER"];
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const GITHUB = /^(?:https?:\/\/github\.com\/)?[\w.-]+\/[\w.-]+?(?:\.git)?\/?$/;

export async function modDetailsDialog(host: Host, modId: string, saved: () => void): Promise<void> {
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

  const name = h("input", { type: "text", value: str("name") || modId, spellcheck: false });
  const description = h("textarea", { rows: 3, placeholder: "One or two lines: what the mod changes" });
  description.value = desc;
  const version = h("input", { type: "text", value: str("version") || "0.1.0", spellcheck: false, placeholder: "1.0.0" });
  const category = h("input", { type: "text", value: str("category") || "GAMEPLAY", spellcheck: false, list: "mod-categories" });
  const categories = h("datalist", { id: "mod-categories" }, ...CATEGORIES.map((c) => h("option", { value: c })));
  const priority = h("input", { type: "number", value: String(manifest.priority ?? 100), min: 0, max: 1000 });
  const github = h("input", { type: "text", value: str("github"), spellcheck: false, placeholder: "owner/repo (optional)" });
  const experimental = h("input", { type: "checkbox", checked: manifest.experimental === true });

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
    const next: Record<string, unknown> = { ...manifest, name: name.value.trim(), version: v, category: category.value.trim().toUpperCase() || "OTHER", priority: Math.trunc(Number(priority.value) || 0) };
    const d = description.value.trim();
    next.description = d || `TODO: one line about ${modId}`;
    if (gh) next.github = gh;
    else delete next.github;
    next.experimental = experimental.checked;
    await host.writeText(path, JSON.stringify(next, null, 2) + "\n");
    toast("Mod details saved", "ok");
    close();
    saved();
  };
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  dialog.append(
    h("h3", {}, `Mod details · ${modId}`),
    field("Name", name, "Shown in the game's mod list."),
    field("Description", description, "What players read before enabling it."),
    h("div", { class: "row" },
      field("Version", version, "Raise it for every release you share."),
      field("Category", category, "The mod list groups by it."),
      field("Priority", priority, "Higher loads later and wins conflicts."),
    ),
    field("GitHub", github, "Lets the launcher update the mod from your repository's releases."),
    h("label", { class: "inline-check" }, experimental, "Experimental (players see a warning)"),
    categories,
    h("p", { class: "hint" }, `Saved straight to mods/${modId}/manifest.json (not part of undo). The id can't change.`),
    h("div", { class: "dialog-actions" }, h("button", { class: "btn", onclick: close }, "Cancel"), h("button", { class: "btn primary", onclick: () => void save() }, "Save details")),
  );
  document.body.append(dialog);
  dialog.showModal();
  name.focus();
}
