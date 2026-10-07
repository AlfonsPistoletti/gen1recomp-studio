// Gear menu: Export .zip… (the archive players import: MODS > Import mod
// .zip) and Publish on GitHub… (src/project/publish.ts).

import type { Host } from "../host/types.ts";
import { makeZip } from "../core/zip.ts";
import { archiveFiles, modVersion, normalizeGithub, publishMod } from "../project/publish.ts";
import { validateMod } from "../project/project.ts";
// a copy of gen1recomp tools/mod_release_workflow.yml for release builds; a
// checkout's own file is used when there is one (keep the copy in sync)
import bundledWorkflow from "../project/mod_release_workflow.yml?raw";
import { errorText, field, h, toast } from "./dom.ts";

export interface ShareContext {
  host: Host;
  version: string;
  modId: string;
  checkout: boolean; // a gen1recomp source checkout (modkit available)
  save(): Promise<void>;
  unsaved(): boolean;
  busy<T>(title: string, run: (step: (text: string) => void) => Promise<T>): Promise<T>;
  dialog(title: string, body: Node[], actions: HTMLElement[]): void;
  closeDialog(): void;
}

export async function exportZip(c: ShareContext): Promise<void> {
  try {
    const { name, zip } = await c.busy(`Exporting ${c.modId}`, async (step) => {
      if (c.unsaved()) {
        step("Saving first…");
        await c.save();
      }
      step("Packing the files…");
      const files = await archiveFiles(c.host, c.modId);
      const entries = await Promise.all(files.map(async (rel) => {
        // the same route the studio shows the mod's art through
        const res = await fetch(c.host.imageUrl(c.version, `mods/${c.modId}/${rel}`), { cache: "no-store" });
        if (!res.ok) throw new Error(`Couldn't read mods/${c.modId}/${rel}`);
        return { path: rel, data: new Uint8Array(await res.arrayBuffer()) };
      }));
      return { name: `${c.modId}-${await modVersion(c.host, c.modId)}.zip`, zip: await makeZip(entries) };
    });
    const where = await c.host.saveExport(name, zip);
    if (where) toast(`Exported to ${where}. Players install it in gen1recomp: MODS > Import mod .zip`, "ok");
  } catch (err) {
    toast(`Export failed: ${errorText(err)}`, "error");
  }
}

export async function publishDialog(c: ShareContext): Promise<void> {
  const manifest = JSON.parse((await c.host.readText("game", `mods/${c.modId}/manifest.json`)) ?? "{}") as Record<string, unknown>;
  const repo = h("input", { type: "text", value: String(manifest.github ?? ""), placeholder: "your-name/your-mod", spellcheck: false });
  const version = h("input", { type: "text", value: String(manifest.version ?? "0.1.0"), spellcheck: false, style: "width: 120px" });
  const message = h("input", { type: "text", value: `Update ${c.modId}`, spellcheck: false });
  const create = h("button", {
    class: "btn small",
    onclick: () => void c.host.openUrl(`https://github.com/new?name=${encodeURIComponent(c.modId)}`),
  }, "Create it on GitHub…");
  const go = async () => {
    const slug = normalizeGithub(repo.value);
    if (!slug) return toast("The repository is your GitHub name and the repository's name: your-name/your-mod", "error");
    if (!/^\d+\.\d+\.\d+$/.test(version.value.trim())) return toast("The version is three numbers: 1.0.0", "error");
    c.closeDialog();
    await publish(c, { repo: slug, version: version.value.trim(), message: message.value.trim() || `Update ${c.modId}` });
  };
  c.dialog(
    "Publish on GitHub",
    [
      h("p", {}, "Uploads the mod to its own GitHub repository. GitHub then builds the .zip players install and publishes it as a release, and gen1recomp's launcher can update the mod from there."),
      field("GitHub repository", h("div", { class: "row nowrap" }, repo, create),
        "The first time: create an empty repository on GitHub (no README), named after your mod, then enter it here as your-name/repository."),
      field("Version", version, "Raise it to release a new version (1.0.0 → 1.0.1). If you keep it, GitHub counts the last number up by itself."),
      field("What changed", message, "A short note, shown in the release."),
      h("p", { class: "hint" }, "Needs Git (git-scm.com). The first upload opens a GitHub sign-in window."),
      c.checkout ? h("p", { class: "hint" }, "The mod folder becomes its own git repository inside your gen1recomp folder.") : null,
    ].filter((n): n is HTMLElement => n !== null),
    [
      h("button", { class: "btn", onclick: () => c.closeDialog() }, "Cancel"),
      h("button", { class: "btn primary", onclick: () => void go() }, "Publish"),
    ],
  );
}

async function publish(c: ShareContext, opts: { repo: string; version: string; message: string }): Promise<void> {
  try {
    const result = await c.busy(`Publishing ${c.modId}`, async (step) => {
      if (c.unsaved()) {
        step("Saving first…");
        await c.save();
      }
      if (c.checkout) {
        step("Running modkit validate --strict and lint…");
        const v = await validateMod(c.host, c.modId);
        if (!v.ok) return { ok: false, message: "Validate / lint reported problems; fix them first (nothing was uploaded).", output: v.output };
      }
      const workflow = (c.checkout && (await c.host.readText("game", "tools/mod_release_workflow.yml"))) || bundledWorkflow;
      return publishMod(c.host, c.modId, { ...opts, workflow }, step);
    });
    const link = (label: string, url: string) => h("button", { class: "btn", onclick: () => void c.host.openUrl(url) }, label);
    c.dialog(
      result.ok ? "✓ Published" : "✗ Not published",
      [
        h("p", {}, result.ok
          ? `${result.message} GitHub now builds ${c.modId}-${opts.version}.zip; it appears under Releases in a minute or two. Share that page: players download the .zip and install it (MODS > Import mod .zip), and the launcher offers updates from there.`
          : result.message),
        h("details", {}, h("summary", { class: "hint" }, "Details"), h("pre", { class: `mono output ${result.ok ? "ok" : "bad"}` }, result.output)),
      ],
      [
        ...(result.ok ? [link("Releases", `https://github.com/${opts.repo}/releases`), link("Build progress", `https://github.com/${opts.repo}/actions`)] : []),
        h("button", { class: "btn primary", onclick: () => c.closeDialog() }, "Close"),
      ],
    );
  } catch (err) {
    toast(`Publishing failed: ${errorText(err)}`, "error");
  }
}
