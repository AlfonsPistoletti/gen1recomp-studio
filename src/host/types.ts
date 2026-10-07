// The only things the studio needs from the machine it runs on. Everything
// else (Lua, diffing, rendering, saving logic) runs in the front end, so a new
// shell (the Vite dev server today, Tauri later) only implements this.

// Paths are relative to a root:
//   "game"            the folder holding mods/: the repo for a source checkout,
//                     the save directory (or portable folder) for a release
//   "cache:<version>" the imported dataset for one ROM version; its
//                     data/generated and assets/generated sit below it
export type Root = "game" | `cache:${string}`;

export interface VersionInfo {
  version: string; // red, blue, yellow, gold, silver, crystal, firered, emerald, ...
  available: boolean;
}

export interface HostInfo {
  gameRoot: string;
  // "source": a repo checkout; "release": a packaged build (no Python tools)
  kind: "source" | "release";
  // where mods are read and written (a release keeps them in its save folder)
  modsDir: string;
  portable: boolean;
  // tools/modkit.py is available (scaffold, validate, lint)
  modkit: boolean;
  versions: VersionInfo[];
}

export interface DirEntry {
  name: string;
  dir: boolean;
}

// set to "1" for a game the studio starts: it switches on the studio's
// play-test helper mod (and the edited mod) through manifest force_enable_env
export const PLAY_ENV = "GEN1RECOMP_STUDIO_PLAY";

export interface ProcessResult {
  code: number;
  output: string;
}

export interface Host {
  info(): Promise<HostInfo>;
  // null when the file does not exist
  readText(root: Root, path: string): Promise<string | null>;
  // writes are confined to game/mods/
  writeText(path: string, text: string): Promise<void>;
  // binary files (imported art); also confined to game/mods/
  writeBinary(path: string, data: Uint8Array): Promise<void>;
  // removes one file under game/mods/ (missing files are fine)
  deleteFile(path: string): Promise<void>;
  // opens an https:// link in the system browser
  openUrl(url: string): Promise<void>;
  list(root: Root, path: string): Promise<DirEntry[]>;
  // A URL the page can load an image from. `rel` resolves the way the game's
  // merged filesystem does: the version's cache first, then the game root.
  imageUrl(version: string, rel: string): string;
  // python tools/modkit.py <args...>, run in the game root
  modkit(args: string[]): Promise<ProcessResult>;
  // starts the game (--game=<version>, PLAY_ENV=1) without waiting for it
  play(version: string): Promise<void>;
  // offers a finished .zip to the user (save dialog or download); where it
  // went, or null when cancelled
  saveExport(name: string, data: Uint8Array): Promise<string | null>;
  // shows mods/<modId> (or mods/ for "") in the system file manager
  openFolder(modId: string): Promise<void>;
  // git <args> in mods/<modId>/ (Publish on GitHub); code -1 with
  // "git not found" when git isn't installed
  git(modId: string, args: string[]): Promise<ProcessResult>;
}
