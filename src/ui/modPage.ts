// Gear menu > Mod page…: the mod's README.md, the front page of its GitHub
// repository (and part of the .zip). Starts from an outline filled in from
// the manifest; a preview shows how GitHub will roughly show it. Saved
// straight to mods/<id>/README.md (not part of undo), like Mod details.

import type { Host } from "../host/types.ts";
import { append, h, toast } from "./dom.ts";

const GAME_NAMES: Record<string, string> = {
  gen1: "Pokémon Red, Blue and Yellow", all: "every game", red: "Pokémon Red", blue: "Pokémon Blue", yellow: "Pokémon Yellow",
  gen2: "Pokémon Gold, Silver and Crystal", gold: "Pokémon Gold", silver: "Pokémon Silver", crystal: "Pokémon Crystal",
};

// the outline a new page starts from
function outline(m: Record<string, unknown>, modId: string): string {
  const games = Array.isArray(m.games) && m.games.length ? (m.games as string[]).map((g) => GAME_NAMES[g] ?? g).join(", ") : "Pokémon Red, Blue and Yellow";
  const github = typeof m.github === "string" && m.github ? m.github : null;
  const where = github ? `the [Releases page](https://github.com/${github}/releases)` : "the author";
  return [
    `# ${String(m.name ?? modId)}`,
    "",
    // createMod's placeholder ("TODO: one line about ...") isn't a description
    typeof m.description === "string" && m.description && !m.description.startsWith("TODO") ? m.description : "What this mod is about, in a sentence or two.",
    "",
    "## Features",
    "",
    "- ",
    "",
    "## How to install",
    "",
    `1. Get the newest \`${modId}-<version>.zip\` from ${where}.`,
    "2. In gen1recomp, open **MODS > Import mod .zip** and pick the file.",
    "3. Make sure the mod is switched on in the mod list.",
    "",
    `Made for ${games}.`,
    "",
    "## What it changes",
    "",
    "See [DIFFERENCES.md](DIFFERENCES.md) for the full list.",
    "",
    "## Credits",
    "",
    "- ",
    "",
  ].join("\n");
}

// modkit scaffold's README is notes for developers, not a page for players
const isModkitReadme = (text: string) => text.includes("mod for the LOVE2D Pokemon Red engine");

// **bold**, `code` and [text](link) inside a line
function inline(text: string): (Node | string)[] {
  const out: (Node | string)[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(h("strong", {}, m[1]));
    else if (m[2] !== undefined) out.push(h("code", {}, m[2]));
    else out.push(h("a", { href: /^https:\/\//.test(m[4]) ? m[4] : "#", target: "_blank", rel: "noopener" }, m[3]));
    last = re.lastIndex;
  }
  out.push(text.slice(last));
  return out;
}

// a rough preview: headings, lists and paragraphs (GitHub shows more)
function preview(md: string): HTMLElement {
  const root = h("div", { class: "md-preview" });
  let list: HTMLElement | null = null;
  for (const line of md.split(/\r?\n/)) {
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const tag = bullet ? "ul" : "ol";
      if (!list || list.tagName.toLowerCase() !== tag) root.append((list = h(tag, {})));
      list.append(h("li", {}, ...inline((bullet ?? numbered)![1])));
      continue;
    }
    list = null;
    if (heading) root.append(h(heading[1].length === 1 ? "h2" : heading[1].length === 2 ? "h3" : "h4", {}, ...inline(heading[2])));
    else if (line.trim()) root.append(h("p", {}, ...inline(line)));
  }
  return root;
}

export async function modPageDialog(host: Host, modId: string): Promise<void> {
  const path = `mods/${modId}/README.md`;
  const manifest = JSON.parse((await host.readText("game", `mods/${modId}/manifest.json`)) ?? "{}") as Record<string, unknown>;
  const existing = await host.readText("game", path);
  const fresh = existing === null || isModkitReadme(existing);
  const text = h("textarea", { class: "mono md-source", spellcheck: true });
  text.value = fresh ? outline(manifest, modId) : existing;
  const view = h("div", { class: "md-view" });
  const refresh = () => view.replaceChildren(preview(text.value));
  text.addEventListener("input", refresh);
  refresh();

  const dialog = h("dialog", { class: "mod-page" });
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  const save = async () => {
    await host.writeText(path, text.value.replace(/\s*$/, "\n"));
    toast("Mod page saved (README.md)", "ok");
    close();
  };
  append(dialog, [
    h("h3", {}, `Mod page · ${modId}`),
    h("p", { class: "hint" },
      "The page people see on your mod's GitHub repository (README.md), also included in the .zip. ",
      "Write normal text; # starts a heading, - a list item, **word** makes it bold. ",
      "DIFFERENCES.md, the list of everything the mod changes, is written by the studio on every save."),
    fresh && existing !== null ? h("p", { class: "hint warn" }, "The current README.md holds modkit's notes for developers; this outline replaces it when you save.") : null,
    h("div", { class: "md-editor" }, text, view),
    h("div", { class: "dialog-actions" },
      h("button", { class: "btn ghost", title: "Start again from the outline", onclick: () => ((text.value = outline(manifest, modId)), refresh()) }, "Start from the outline"),
      h("span", { class: "spacer" }),
      h("button", { class: "btn", onclick: close }, "Cancel"),
      h("button", { class: "btn primary", onclick: () => void save() }, "Save page")),
  ]);
  document.body.append(dialog);
  dialog.showModal();
  text.focus();
}
