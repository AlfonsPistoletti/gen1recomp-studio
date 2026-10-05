// Host implemented directly on the file system. Serves the HTTP API and runs
// the self-test; src-tauri implements the same interface in Rust.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { DirEntry, Host, HostInfo, ProcessResult, Root } from "../src/host/types.ts";
import { cacheRoot, hasModkit, install, VERSIONS, within } from "./paths.ts";

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
};
