// Host implemented directly on the file system. Serves the HTTP API and runs
// the self-test; src-tauri implements the same interface in Rust.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PLAY_ENV, type DirEntry, type Host, type HostInfo, type ProcessResult, type Root } from "../src/host/types.ts";
import { cacheRoot, gameCommand, hasModkit, install, MOD_ID_RE, VERSIONS, within } from "./paths.ts";

function rootDir(root: Root): string {
  if (root === "game") return install().modsParent;
  const version = root.slice("cache:".length);
  const dir = cacheRoot(version);
  if (!dir) throw new Error(`no imported dataset for ${version}`);
  return dir;
}

function resolve(root: Root, rel: string): string {
  const full = within(rootDir(root), rel);
  if (!full) throw new Error(`path escapes its root: ${rel}`);
  return full;
}

// The first existing file for `rel`: the version's cache, then the game root
// (LOVE mounts the save directory over the source tree the same way).
export function resolveImage(version: string, rel: string): string | null {
  const bases = [cacheRoot(version), install().modsParent].filter((b): b is string => !!b);
  for (const base of bases) {
    const full = within(base, rel);
    if (full && fs.existsSync(full) && fs.statSync(full).isFile()) return full;
  }
  return null;
}

// a path inside game/mods/, or an error: the only place writes may go
function modsFile(rel: string): string {
  const full = resolve("game", rel);
  const relative = path.relative(path.join(install().modsParent, "mods"), full);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("writes are limited to mods/");
  return full;
}

export function runModkit(args: string[]): Promise<ProcessResult> {
  const inst = install();
  if (!hasModkit(inst)) {
    return Promise.resolve({ code: -1, output: "modkit needs a source checkout of gen1recomp (tools/modkit.py); release builds do not ship it." });
  }
  const cwd = inst.root;
  const candidates = process.platform === "win32" ? ["py", "python"] : ["python3", "python"];
  return new Promise((done) => {
    const attempt = (i: number) => {
      if (i >= candidates.length) {
        done({ code: -1, output: "Python not found on PATH (needed for tools/modkit.py)." });
        return;
      }
      let output = "";
      const child = spawn(candidates[i], ["tools/modkit.py", ...args], {
        cwd,
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      });
      child.stdout.on("data", (d) => (output += d));
      child.stderr.on("data", (d) => (output += d));
      child.on("error", () => attempt(i + 1));
      child.on("close", (code) => done({ code: code ?? -1, output }));
    };
    attempt(0);
  });
}

// git <args> in mods/<modId>/ only, and only what publishing needs (same
// rules as the git command in src-tauri/src/main.rs)
const GIT_COMMANDS = ["--version", "init", "remote", "add", "commit", "push", "config", "rev-parse", "status"];

export function runGit(modId: string, args: string[]): Promise<ProcessResult> {
  if (!MOD_ID_RE.test(modId)) throw new Error(`bad mod id ${modId}`);
  let i = 0;
  while (args[i] === "-c") i += 2;
  if (!GIT_COMMANDS.includes(args[i])) throw new Error(`git ${args[i] ?? ""} is not allowed`);
  const cwd = path.join(install().modsParent, "mods", modId);
  if (!fs.existsSync(cwd)) throw new Error(`${cwd} not found`);
  return new Promise((done) => {
    let output = "";
    const child = spawn("git", args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("error", () => done({ code: -1, output: "git not found" }));
    child.on("close", (code) => done({ code: code ?? -1, output }));
  });
}

// shows mods/<modId> (or mods/) in the file manager of the machine the dev
// server runs on (the same machine in browser mode)
export async function openFolder(modId: string): Promise<void> {
  if (modId && !MOD_ID_RE.test(modId)) throw new Error(`bad mod id ${modId}`);
  const dir = path.join(install().modsParent, "mods", modId);
  if (!fs.existsSync(dir)) throw new Error(`${dir} not found`);
  const cmd = process.platform === "win32" ? "explorer" : process.platform === "darwin" ? "open" : "xdg-open";
  spawn(cmd, [dir], { detached: true, stdio: "ignore" }).unref();
}

export async function playGame(version: string): Promise<void> {
  if (!VERSIONS.includes(version)) throw new Error(`unknown version ${version}`);
  const inst = install();
  const cmd = gameCommand(inst);
  if (!cmd) {
    throw new Error(inst.kind === "source"
      ? "LÖVE was not found. Install LÖVE (love2d.org) or put love on PATH."
      : `No gen1recomp executable found in ${inst.root}.`);
  }
  const child = spawn(cmd.exe, [...cmd.args, `--game=${version}`], {
    cwd: inst.root,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, [PLAY_ENV]: "1" },
  });
  await new Promise<void>((done, fail) => {
    child.once("error", fail);
    child.once("spawn", () => done());
  });
  child.unref();
}

export const nodeHost: Host = {
  async info(): Promise<HostInfo> {
    const inst = install();
    return {
      gameRoot: inst.root,
      kind: inst.kind,
      modsDir: path.join(inst.modsParent, "mods"),
      portable: inst.portable,
      modkit: hasModkit(inst),
      versions: VERSIONS.map((version) => ({ version, available: cacheRoot(version) !== null })),
    };
  },
  async readText(root, rel) {
    const full = resolve(root, rel);
    return fs.existsSync(full) && fs.statSync(full).isFile() ? fs.readFileSync(full, "utf8") : null;
  },
  async writeText(rel, text) {
    const full = modsFile(rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text, "utf8");
  },
  async writeBinary(rel, data) {
    const full = modsFile(rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, data);
  },
  async deleteFile(rel) {
    const full = modsFile(rel);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) fs.unlinkSync(full);
  },
  async list(root, rel): Promise<DirEntry[]> {
    const full = resolve(root, rel);
    if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) return [];
    return fs.readdirSync(full, { withFileTypes: true }).map((e) => ({ name: e.name, dir: e.isDirectory() }));
  },
  imageUrl(version, rel) {
    const file = resolveImage(version, rel);
    return file ? pathToFileURL(file).href : "";
  },
  // only the web front opens links (httpHost.openUrl); the server never does
  async openUrl() {},
  modkit: runModkit,
  play: playGame,
  // only the web front offers files (httpHost.saveExport downloads them)
  async saveExport() {
    return null;
  },
  git: runGit,
  openFolder,
};
