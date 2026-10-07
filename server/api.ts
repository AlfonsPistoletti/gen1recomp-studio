// HTTP surface for src/host/httpHost.ts. A plain (req, res, next) handler so
// it runs inside Vite's dev and preview servers.

import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Root } from "../src/host/types.ts";
import { nodeHost, openFolder, playGame, resolveImage, runGit, runModkit } from "./nodeHost.ts";

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function rootParam(value: unknown): Root {
  if (value === "game" || (typeof value === "string" && /^cache:[a-z]+$/.test(value))) return value as Root;
  throw new Error("bad root");
}

function stringParam(value: unknown, name: string): string {
  if (typeof value !== "string") throw new Error(`missing ${name}`);
  return value;
}

export async function handleApi(req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> {
  const url = new URL(req.url || "/", "http://studio.local");
  if (!url.pathname.startsWith("/api/")) return next();
  try {
    switch (`${req.method} ${url.pathname}`) {
      case "GET /api/host/info":
        return send(res, 200, await nodeHost.info());
      case "POST /api/host/read": {
        const body = await readBody(req);
        return send(res, 200, { text: await nodeHost.readText(rootParam(body.root), stringParam(body.path, "path")) });
      }
      case "POST /api/host/write": {
        const body = await readBody(req);
        await nodeHost.writeText(stringParam(body.path, "path"), stringParam(body.text, "text"));
        return send(res, 200, { ok: true });
      }
      case "POST /api/host/write-binary": {
        const body = await readBody(req);
        await nodeHost.writeBinary(stringParam(body.path, "path"), Buffer.from(stringParam(body.base64, "base64"), "base64"));
        return send(res, 200, { ok: true });
      }
      case "POST /api/host/delete": {
        const body = await readBody(req);
        await nodeHost.deleteFile(stringParam(body.path, "path"));
        return send(res, 200, { ok: true });
      }
      case "POST /api/host/list": {
        const body = await readBody(req);
        return send(res, 200, await nodeHost.list(rootParam(body.root), stringParam(body.path, "path")));
      }
      case "POST /api/host/modkit": {
        const body = await readBody(req);
        const args = body.args;
        if (!Array.isArray(args) || !args.every((a) => typeof a === "string")) throw new Error("bad args");
        return send(res, 200, await runModkit(args));
      }
      case "POST /api/host/play": {
        const body = await readBody(req);
        await playGame(stringParam(body.version, "version"));
        return send(res, 200, { ok: true });
      }
      case "POST /api/host/open-folder": {
        const body = await readBody(req);
        await openFolder(typeof body.modId === "string" ? body.modId : "");
        return send(res, 200, { ok: true });
      }
      case "POST /api/host/git": {
        const body = await readBody(req);
        const args = body.args;
        if (!Array.isArray(args) || !args.every((a) => typeof a === "string")) throw new Error("bad args");
        return send(res, 200, await runGit(stringParam(body.modId, "modId"), args));
      }
      case "GET /api/host/image": {
        const version = url.searchParams.get("version") || "";
        if (!/^[a-z]+$/.test(version)) return send(res, 400, { error: "bad version" });
        const file = resolveImage(version, url.searchParams.get("path") || "");
        if (!file) return send(res, 404, { error: "image not found" });
        res.statusCode = 200;
        const types: Record<string, string> = { png: "image/png", wav: "audio/wav", ogg: "audio/ogg", mp3: "audio/mpeg", flac: "audio/flac" };
        res.setHeader("Content-Type", types[file.split(".").pop() ?? ""] ?? "application/octet-stream");
        res.setHeader("Cache-Control", "no-cache");
        fs.createReadStream(file).pipe(res);
        return;
      }
      default:
        return send(res, 404, { error: `no route ${req.method} ${url.pathname}` });
    }
  } catch (err) {
    return send(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}
