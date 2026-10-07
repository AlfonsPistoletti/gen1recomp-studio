// Host over the dev server's /api/host endpoints (server/api.ts).

import type { DirEntry, Host, HostInfo, ProcessResult, Root } from "./types.ts";

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `${res.status} ${res.statusText}`);
  return data as T;
}

function toBase64(data: Uint8Array): string {
  let s = "";
  for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return btoa(s);
}

export const httpHost: Host = {
  info: () => call<HostInfo>("/api/host/info"),
  readText: async (root: Root, path: string) => (await call<{ text: string | null }>("/api/host/read", { root, path })).text,
  writeText: async (path: string, text: string) => {
    await call("/api/host/write", { path, text });
  },
  writeBinary: async (path: string, data: Uint8Array) => {
    await call("/api/host/write-binary", { path, base64: toBase64(data) });
  },
  // the browser opens it itself
  openUrl: async (url: string) => {
    window.open(url, "_blank", "noopener");
  },
  deleteFile: async (path: string) => {
    await call("/api/host/delete", { path });
  },
  list: (root: Root, path: string) => call<DirEntry[]>("/api/host/list", { root, path }),
  imageUrl: (version: string, rel: string) =>
    `/api/host/image?version=${encodeURIComponent(version)}&path=${encodeURIComponent(rel)}`,
  modkit: (args: string[]) => call<ProcessResult>("/api/host/modkit", { args }),
  play: async (version: string) => {
    await call("/api/host/play", { version });
  },
};
