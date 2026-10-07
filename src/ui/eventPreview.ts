// Plays an event on the map view, so a cutscene can be checked without the
// game: people walk their paths at the game's step speed, texts show as
// captions, "!" bubbles pop up, NPCs appear and disappear. A sketch, not the
// engine: Ifs take their first branch, Choices their first option, and
// battles, warps, items and flags only show a caption.

import type { Block } from "../core/eventBlocks.ts";
import { followerPath, STEP } from "../core/eventBlocks.ts";
import { store } from "../core/store.ts";
import type { EventRow } from "../games/types.ts";
import type { EventPreviewState } from "../render/mapView.ts";

export interface Stage {
  show(state: EventPreviewState): void;
  caption(text: string | null): void;
  stopped(): boolean;
  // resolves on a click/key or after `ms`
  pause(ms: number): Promise<void>;
}

type Actor = { x: number; y: number; facing: string; hidden?: boolean };
const FRAME_MS = 1000 / 60;
// a walking step: the player 16 frames, an NPC 32 (src/world/NPC.lua)
const PLAYER_FRAMES = 16;
const NPC_FRAMES = 32;

function textOf(v: unknown): string {
  const raw = typeof v === "string" && /^_\w+$/.test(v) ? String(store.table("text")[v] ?? v) : String(v ?? "");
  return raw.replace(/\{(DONE|PROMPT)\}/g, "").replace(/\{PLAYER\}/g, "RED").replace(/\{RIVAL\}/g, "BLUE").replace(/[\f\v]/g, "\n");
}

export async function playEvent(stage: Stage, mapId: string, blocks: Block[], start: { x: number; y: number; facing: string } | null): Promise<void> {
  const map = store.maps[mapId];
  if (!map) return;
  const actors: Record<string, Actor> = {};
  for (const e of store.entities(map, "objects")) {
    if (typeof e.index !== "number") continue;
    const facing = e.movement === "STAY" ? String(e.range ?? "DOWN").toLowerCase() : "down";
    actors[`npc${e.index}`] = { x: e.x, y: e.y, facing: facing in STEP ? facing : "down", hidden: e.hidden === true };
  }
  actors.player = start ? { x: start.x, y: start.y, facing: start.facing } : { x: Math.floor(map.width), y: Math.floor(map.height), facing: "down" };
  let emote: string | null = null;
  let emoteText = "!";
  const redraw = () => stage.show({ actors: JSON.parse(JSON.stringify(actors)), emote, emoteText });
  const key = (who: unknown) => (who === "player" ? "player" : `npc${String(who)}`);
  const nameToKey = (name: unknown) => {
    const e = store.entities(map, "objects").find((o) => o.name === name);
    return e ? `npc${String(e.index)}` : null;
  };

  // one actor walks a list of directions, smoothly, a step at a time
  const walk = async (k: string, dirs: unknown[], frames?: unknown) => {
    const a = actors[k];
    if (!a) return;
    const stepMs = (k === "player" ? PLAYER_FRAMES : typeof frames === "number" ? frames : NPC_FRAMES) * FRAME_MS;
    for (const d of dirs) {
      if (stage.stopped()) return;
      const [dx, dy] = STEP[String(d)] ?? [0, 0];
      a.facing = String(d);
      const x0 = a.x;
      const y0 = a.y;
      const t0 = performance.now();
      for (;;) {
        const t = Math.min(1, (performance.now() - t0) / stepMs);
        a.x = x0 + dx * t;
        a.y = y0 + dy * t;
        redraw();
        if (t >= 1 || stage.stopped()) break;
        await new Promise((r) => requestAnimationFrame(r));
      }
      a.x = Math.round(a.x);
      a.y = Math.round(a.y);
    }
  };
  // a straight-line route (x first, then y): the preview doesn't pathfind
  const route = (k: string, tx: number, ty: number): string[] => {
    const a = actors[k];
    if (!a) return [];
    const out: string[] = [];
    for (let i = 0; i < Math.abs(tx - a.x); i++) out.push(tx > a.x ? "right" : "left");
    for (let i = 0; i < Math.abs(ty - a.y); i++) out.push(ty > a.y ? "down" : "up");
    return out;
  };
  const say = async (text: string, ms = 0) => {
    stage.caption(text);
    await stage.pause(ms || 1200 + text.length * 35);
    stage.caption(null);
  };

  const running: Promise<void>[] = [];
  let stop = false;
  const run = async (list: Block[]): Promise<void> => {
    for (const b of list) {
      if (stop || stage.stopped()) return;
      if (b.t === "stop") {
        stop = true;
        return;
      }
      if (b.t === "if") {
        if (b.cond) await step(b.cond, true);
        await run(b.then);
        continue;
      }
      if (b.t === "choice") {
        await say(`[Choice: ${b.labels.join(" / ")}]  (playing "${b.labels[0]}")`, 1500);
        await run(b.branches[0] ?? []);
        continue;
      }
      if (b.t === "follow") {
        const lead = key(b.npc);
        // the player stands on the side the block says, facing the leader
        const n = actors[lead];
        const [dx, dy] = STEP[b.from] ?? [0, 1];
        if (n) {
          Object.assign(actors.player, { x: n.x + dx, y: n.y + dy, facing: ({ up: "down", down: "up", left: "right", right: "left" } as Record<string, string>)[b.from] ?? "up" });
          redraw();
        }
        await Promise.all([walk(lead, b.path, b.stepFrames ?? PLAYER_FRAMES), walk("player", followerPath(b.from, b.path))]);
        continue;
      }
      if (b.t === "cmd") await step(b.row, false);
    }
  };
  const step = async (r: EventRow, asCondition: boolean): Promise<void> => {
    const v = String(r[0]);
    switch (v) {
      case "show_text":
        return say(textOf(r[1]));
      case "ask":
        return say(`${textOf(r[1])}\n> YES`);
      case "emote":
        emote = key(r[1] ?? "player");
        emoteText = r[2] === "question" ? "?" : r[2] === "happy" ? "♪" : "!";
        redraw();
        await stage.pause(700);
        emote = null;
        redraw();
        return;
      case "face_player": {
        // the NPC that was talked to: the one nearest the player
        return;
      }
      case "face":
        return;
      case "face_object":
        if (actors[key(r[1])]) actors[key(r[1])].facing = String(r[2]);
        return redraw();
      case "face_player_dir":
        actors.player.facing = String(r[1]);
        return redraw();
      case "walk_npc": {
        const p = walk(key(r[1]), Array.isArray(r[2]) ? r[2] : [], (r[3] as { stepFrames?: unknown } | undefined)?.stepFrames);
        if ((r[3] as { wait?: unknown } | undefined)?.wait === false) running.push(p);
        else await p;
        return;
      }
      case "move_npc":
        return walk(key(r[1]), Array(Number(r[3] ?? 1)).fill(r[2]));
      case "move_player":
        return walk("player", Array(Number(r[2] ?? 1)).fill(r[1]));
      case "move_npc_to":
        return walk(key(r[1]), route(key(r[1]), Number(r[2]), Number(r[3])));
      case "place_npc": {
        const a = actors[key(r[1])];
        if (a) Object.assign(a, { x: Number(r[2]), y: Number(r[3]), facing: String(r[4] ?? a.facing) });
        return redraw();
      }
      case "show_object":
      case "hide_object": {
        const k = nameToKey(r[2]);
        if (k && actors[k]) actors[k].hidden = v === "hide_object";
        redraw();
        return stage.pause(250);
      }
      case "wait":
        return stage.pause(Number(r[1] ?? 30) * (1000 / 60));
      case "start_battle":
        return say(`[Battle: ${String(r[1]) === "wild" ? `wild ${String(r[2])} Lv ${String(r[3])}` : `${String(r[2])} team ${String(r[3])}`}]`, 1200);
      case "warp":
        return say(`[Warp to ${String(r[1])} ${String(r[2])}, ${String(r[3])}]`, 1000);
      case "give_item":
        return say(`[Gets ${String(r[2] ?? 1)}× ${String(r[1])}]`, 900);
      case "give_pokemon":
        return say(`[Gets ${String(r[1])} Lv ${String(r[2])}]`, 900);
      case "fade":
        return say(`[Fade ${String(r[1] ?? "out")}]`, 600);
      default:
        if (asCondition) return say(`[If: ${v} ${String(r[1] ?? "")} … assumed true]`, 900);
        return; // flags, music, sounds, labels: nothing to see
    }
  };

  redraw();
  await run(blocks);
  await Promise.all(running);
}
