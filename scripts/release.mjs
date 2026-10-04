// npm run release -- 0.2.0
//
// Sets the version in package.json (+ lock), src-tauri/tauri.conf.json and
// src-tauri/Cargo.toml (+ lock), runs the checks, commits "Release v0.2.0" and
// tags v0.2.0. Pushing is left to you:
//   git push && git push origin v0.2.0
// The tag push starts .github/workflows/release.yml (draft release with the
// Windows installers).

import { execSync } from "node:child_process";
import fs from "node:fs";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error("usage: npm run release -- <version>   (e.g. 0.2.0)");
  process.exit(1);
}
const tag = `v${version}`;
const run = (cmd) => execSync(cmd, { stdio: "inherit" });
const out = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();

if (out("git status --porcelain")) {
  console.error("Commit or stash your changes first; a release commit only carries the version bump.");
  process.exit(1);
}
if (out(`git tag --list ${tag}`)) {
  console.error(`${tag} already exists.`);
  process.exit(1);
}

const edit = (file, fn) => fs.writeFileSync(file, fn(fs.readFileSync(file, "utf8")));
const json = (file) =>
  edit(file, (s) => {
    const data = JSON.parse(s);
    data.version = version;
    if (data.packages?.[""]) data.packages[""].version = version; // package-lock.json
    return JSON.stringify(data, null, 2) + "\n";
  });
json("package.json");
json("package-lock.json");
json("src-tauri/tauri.conf.json");
// the [package] version is the first `version = ` line of Cargo.toml
edit("src-tauri/Cargo.toml", (s) => s.replace(/^version = ".*"$/m, `version = "${version}"`));
// (the lock file has Windows line endings)
edit("src-tauri/Cargo.lock", (s) => s.replace(/(name = "gen1recomp-studio"\r?\nversion = )".*"/, `$1"${version}"`));

run("npm run typecheck");
run("npm run selftest");
run("git add package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock");
run(`git commit -m "Release ${tag}"`);
run(`git tag -a ${tag} -m "Gen1Recomp Studio ${tag}"`);
console.log(`\nTagged ${tag}. Publish it with:\n  git push && git push origin ${tag}\n`);
