// Host over the desktop shell's commands (src-tauri/src/main.rs).

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { DirEntry, Host, HostInfo, ProcessResult, Root } from "./types.ts";

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export const tauriHost: Host = {
  info: () => invoke<HostInfo>("host_info"),
  readText: (root: Root, path: string) => invoke<string | null>("read_text", { root, path }),
  writeText: (path: string, text: string) => invoke<void>("write_text", { path, text }),
  writeBinary: (path: string, data: Uint8Array) => invoke<void>("write_binary", { path, data: Array.from(data) }),
  deleteFile: (path: string) => invoke<void>("delete_file", { path }),
  list: (root: Root, path: string) => invoke<DirEntry[]>("list_dir", { root, path }),
  // served by the shell's studio:// protocol (http://studio.localhost/ on Windows)
  imageUrl: (version: string, rel: string) => convertFileSrc(`image/${version}/${rel}`, "studio"),
  modkit: (args: string[]) => invoke<ProcessResult>("modkit", { args }),
};

// Lets the user point the app at their gen1recomp checkout; remembered by the shell.
export async function chooseGameRoot(): Promise<HostInfo | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const dir = await open({ directory: true, title: "Choose your gen1recomp folder" });
  if (typeof dir !== "string") return null;
  return invoke<HostInfo>("set_game_root", { path: dir });
}
