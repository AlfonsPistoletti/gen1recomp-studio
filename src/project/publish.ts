// Sharing a mod the way the gen1recomp wiki's Guide-Publishing describes:
// the mod is its own GitHub repository with "github": "owner/repo" in its
// manifest and modkit's release workflow (tools/mod_release_workflow.yml),
// which turns every push to main into a GitHub Release with an installable
// <id>-<version>.zip. Export .zip makes the same archive locally.

import type { Host } from "../host/types.ts";
import { MOD_ID_RE } from "./project.ts";

// "owner/repo" from owner/repo or a github.com URL (modkit normalize_github),
// or null when it is neither
export function normalizeGithub(value: string): string | null {
  const m = /^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(value.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

// what the release workflow strips from the archive (and Export .zip too)
const LEFT_OUT = new Set([".git", ".github", ".gitignore", ".gitattributes", ".luarc.json"]);

// every file of a mod, relative to its folder, for the archive
export async function archiveFiles(host: Host, modId: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (rel: string): Promise<void> => {
    for (const e of await host.list("game", `mods/${modId}${rel ? `/${rel}` : ""}`)) {
      if (!rel && LEFT_OUT.has(e.name)) continue;
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (e.dir) await walk(path);
      else out.push(path);
    }
  };
  await walk("");
  return out.sort();
}

async function readManifest(host: Host, modId: string): Promise<Record<string, unknown>> {
  const text = await host.readText("game", `mods/${modId}/manifest.json`);
  if (text === null) throw new Error(`mods/${modId}/manifest.json not found`);
  return JSON.parse(text) as Record<string, unknown>;
}

export async function modVersion(host: Host, modId: string): Promise<string> {
  return String((await readManifest(host, modId)).version ?? "0.1.0");
}

export interface PublishOptions {
  repo: string; // owner/repo
  version: string; // X.Y.Z
  message: string; // the commit message
  // the release workflow (gen1recomp tools/mod_release_workflow.yml)
  workflow: string;
  // where to push; github.com/<repo> unless a test points elsewhere
  remote?: string;
}

export interface PublishResult {
  ok: boolean;
  // what went wrong, in words for the user (ok: what happened)
  message: string;
  output: string;
}

// Sets the mod up as its own repository (first time) and pushes it: the
// manifest's github and version, the release workflow, then git init /
// remote / add / commit / push in mods/<id>/.
export async function publishMod(host: Host, modId: string, opts: PublishOptions, step: (text: string) => void): Promise<PublishResult> {
  if (!MOD_ID_RE.test(modId)) throw new Error(`bad mod id ${modId}`);
  let log = "";
  const git = async (args: string[]) => {
    const r = await host.git(modId, args);
    log += `$ git ${args.join(" ")}\n${r.output}`;
    return r;
  };
  const fail = (message: string): PublishResult => ({ ok: false, message, output: log });

  if ((await git(["--version"])).code === -1) {
    return fail("Git isn't installed. Install Git for Windows (https://git-scm.com/download/win), then try again.");
  }

  step("Setting up the manifest and the release workflow…");
  const manifest = await readManifest(host, modId);
  if (manifest.github !== opts.repo || manifest.version !== opts.version) {
    manifest.github = opts.repo;
    manifest.version = opts.version;
    await host.writeText(`mods/${modId}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
  }
  const workflowPath = `mods/${modId}/.github/workflows/release.yml`;
  // the mod's own copy is never replaced (it may have been changed by hand)
  if ((await host.readText("game", workflowPath)) === null) {
    await host.writeText(workflowPath, opts.workflow.replaceAll("{{MOD_ID}}", modId));
  }

  step("Preparing the git repository…");
  if ((await git(["rev-parse", "--is-inside-work-tree"])).output.trim() !== "true" || (await git(["rev-parse", "--show-prefix"])).output.trim() !== "") {
    // not a repository of its own yet (or only inside the gen1recomp checkout's)
    const init = await git(["init", "-b", "main"]);
    if (init.code !== 0) return fail("Couldn't create the git repository.");
  }
  const remote = opts.remote ?? `https://github.com/${opts.repo}.git`;
  const current = await git(["remote", "get-url", "origin"]);
  if (current.code !== 0) await git(["remote", "add", "origin", remote]);
  else if (current.output.trim() !== remote) await git(["remote", "set-url", "origin", remote]);

  step("Saving this version in git…");
  await git(["add", "-A"]);
  // a commit needs a name and an email; without git's own settings, use the
  // GitHub owner and GitHub's no-reply address
  const named = (await git(["config", "user.email"])).output.trim() !== "";
  const owner = opts.repo.split("/")[0];
  const who = named ? [] : ["-c", `user.name=${owner}`, "-c", `user.email=${owner}@users.noreply.github.com`];
  const commit = await git([...who, "commit", "-m", opts.message]);
  if (commit.code !== 0 && !/nothing to commit/i.test(commit.output)) return fail("Couldn't save this version in git.");

  step("Uploading to GitHub… (the first time, a GitHub sign-in window may open)");
  const push = await git(["push", "-u", "origin", "main"]);
  if (push.code !== 0) {
    if (/rejected|fetch first|non-fast-forward/i.test(push.output)) {
      return fail("GitHub refused the upload because the repository already has files the mod doesn't (for example a README made on GitHub). Use an empty repository, or delete and recreate it without a README.");
    }
    if (/not found|does not exist/i.test(push.output)) {
      return fail(`The repository ${opts.repo} doesn't exist on GitHub (or you can't write to it). Create it on GitHub first.`);
    }
    if (/authentication|could not read username|403|denied/i.test(push.output)) {
      return fail("GitHub sign-in failed or was cancelled. Try again and sign in when the window opens.");
    }
    return fail("The upload to GitHub failed.");
  }
  return { ok: true, message: `Uploaded to ${opts.repo}.`, output: log };
}
