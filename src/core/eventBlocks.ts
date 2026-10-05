// Events as the editor shows them (blocks: commands, If/Else, Choice) and as
// the engine runs them (rows: { verb, args... } with labels and jumps).
//
// compile() turns blocks into rows with generated labels:
//   If:      [check] jump_if_false|true <else> ...then... [jump <end>, label <else>, ...else...] label <end>
//   Choice:  choice {labels}; 2 options: jump_if_false <c2>; 3+: per option i>1
//            [<choiceVerb> i, jump_if_true <ci>] ... each branch ends in jump <end>
// parse() reads rows back into blocks: it first turns numeric jump targets
// (hand-numbered game scripts) into labels, then recognises the If and
// Choice shapes; whatever it can't structure stays a visible Go to / Label
// block, so nothing is ever lost.

import type { EventRow } from "../games/types.ts";

export type Block =
  | { t: "cmd"; row: EventRow }
  | { t: "if"; cond: EventRow | null; not: boolean; then: Block[]; else: Block[] | null }
  | { t: "choice"; labels: string[]; branches: Block[][] }
  // an NPC walks a path and the player follows one step behind; `from` is
  // where the player stands next to the NPC when it starts (below = "down")
  | { t: "follow"; npc: number; path: string[]; from: string; stepFrames?: number }
  | { t: "stop" }
  | { t: "goto"; label: string; when?: boolean } // when: only if the last result is true/false
  | { t: "label"; name: string };

const JUMPS = new Set(["jump", "jump_if_true", "jump_if_false"]);
const OPPOSITE: Record<string, string> = { up: "down", down: "up", left: "right", right: "left" };

// the player's steps when following: into the NPC's starting cell, then
// every cell the NPC leaves (all of its path but the last step)
export function followerPath(from: string, path: string[]): string[] {
  return path.length ? [OPPOSITE[from] ?? "up", ...path.slice(0, -1)] : [];
}

export interface Verbs {
  checks: Set<string>; // verbs that set the last result (check_flag, ask, ...)
  choiceVerb: string;
}

// ------------------------------------------------------------------ compile

export function compile(blocks: Block[], verbs: Verbs): EventRow[] {
  const out: EventRow[] = [];
  const taken = new Set<string>();
  collectLabels(blocks, taken);
  let n = 0;
  const fresh = (base: string) => {
    let name: string;
    do name = `_${base}${++n}`;
    while (taken.has(name));
    taken.add(name);
    return name;
  };
  const emit = (list: Block[]) => {
    for (const b of list) {
      switch (b.t) {
        case "cmd":
          out.push(trimRow(b.row));
          break;
        case "stop":
          out.push(["jump", "end"]);
          break;
        case "goto":
          out.push([b.when === undefined ? "jump" : b.when ? "jump_if_true" : "jump_if_false", b.label]);
          break;
        case "label":
          out.push(["label", b.name]);
          break;
        case "follow":
          // both walks start together: the NPC's doesn't wait, the player's does
          // playerSide keeps the block's setting even with no steps yet (the
          // engine reads only wait/stepFrames from these options)
          // the leader steps at the player's pace (NPCs walk at half speed by
          // default), so the two stay one cell apart
          out.push(["walk_npc", b.npc, [...b.path], { wait: false, playerSide: b.from, stepFrames: b.stepFrames ?? 16 }], ["walk_npc", "player", followerPath(b.from, b.path)]);
          break;
        case "if": {
          const id = fresh("if");
          const elseL = `${id}_else`;
          const endL = `${id}_end`;
          if (b.cond) out.push(trimRow(b.cond));
          // an Else, even an empty one, stays an Else
          const hasElse = b.else !== null;
          out.push([b.not ? "jump_if_true" : "jump_if_false", hasElse ? elseL : endL]);
          emit(b.then);
          if (hasElse) {
            out.push(["jump", endL], ["label", elseL]);
            emit(b.else!);
          }
          out.push(["label", endL]);
          break;
        }
        case "choice": {
          const id = fresh("c");
          const endL = `${id}_end`;
          const opt = (i: number) => `${id}_${i}`;
          out.push(["choice", [...b.labels]]);
          const count = b.branches.length;
          if (count === 2) out.push(["jump_if_false", opt(2)]);
          else for (let i = 2; i <= count; i++) out.push([verbs.choiceVerb, i], ["jump_if_true", opt(i)]);
          b.branches.forEach((branch, i) => {
            if (i > 0) out.push(["label", opt(i + 1)]);
            emit(branch);
            if (i < count - 1) out.push(["jump", endL]);
          });
          out.push(["label", endL]);
          break;
        }
      }
    }
  };
  emit(blocks);
  return out;
}

// a Lua list can't end in nil: drop trailing undefined/null arguments
function trimRow(row: EventRow): EventRow {
  const r = [...row];
  while (r.length > 1 && (r[r.length - 1] === undefined || r[r.length - 1] === null)) r.pop();
  return r;
}

function collectLabels(blocks: Block[], out: Set<string>): void {
  for (const b of blocks) {
    if (b.t === "label") out.add(b.name);
    if (b.t === "if") {
      collectLabels(b.then, out);
      if (b.else) collectLabels(b.else, out);
    }
    if (b.t === "choice") for (const br of b.branches) collectLabels(br, out);
  }
}

// ------------------------------------------------------------------ parse

// Hand-numbered rows ("jump_if_false", 20) become labelled ones so edits
// don't break them: a { "label", "step<N>" } row goes in front of row N.
export function labelled(rows: EventRow[]): EventRow[] {
  const targets = new Set<number>();
  for (const r of rows) if (JUMPS.has(String(r[0])) && typeof r[1] === "number") targets.add(r[1]);
  if (!targets.size) return rows.map((r) => [...r]);
  const out: EventRow[] = [];
  rows.forEach((r, i) => {
    if (targets.has(i + 1)) out.push(["label", `step${i + 1}`]);
    const row = [...r];
    if (JUMPS.has(String(row[0])) && typeof row[1] === "number") row[1] = row[1] >= 1 && row[1] <= rows.length ? `step${row[1]}` : "end";
    out.push(row);
  });
  return out;
}

export function parse(input: EventRow[], verbs: Verbs): Block[] {
  const rows = labelled(input);
  // where each label is, and how many jumps go to it
  const at = new Map<string, number>();
  const refs = new Map<string, number>();
  rows.forEach((r, i) => {
    if (r[0] === "label" && typeof r[1] === "string" && !at.has(r[1])) at.set(r[1], i);
    if (JUMPS.has(String(r[0])) && typeof r[1] === "string") refs.set(r[1], (refs.get(r[1]) ?? 0) + 1);
  });
  const isLabel = (i: number, name: string) => rows[i]?.[0] === "label" && rows[i][1] === name;
  const only = (name: string) => (refs.get(name) ?? 0) === 1;

  // rows [lo, hi) -> blocks
  const seq = (lo: number, hi: number): Block[] => {
    const out: Block[] = [];
    let i = lo;
    while (i < hi) {
      const r = rows[i];
      const verb = String(r[0]);
      // Follow: walk_npc <npc> P {wait=false}; walk_npc "player" <behind P>
      const nr = rows[i + 1];
      if (verb === "walk_npc" && typeof r[1] === "number" && Array.isArray(r[2]) && (r[3] as { wait?: unknown } | undefined)?.wait === false && i + 1 < hi && nr?.[0] === "walk_npc" && nr[1] === "player" && Array.isArray(nr[2])) {
        const path = (r[2] as unknown[]).map(String);
        const mine = (nr[2] as unknown[]).map(String);
        const side = (r[3] as { playerSide?: unknown }).playerSide;
        const from = typeof side === "string" && side in OPPOSITE ? side : mine.length ? OPPOSITE[mine[0]] : "down";
        if (from && mine.length === path.length && JSON.stringify(followerPath(from, path)) === JSON.stringify(mine)) {
          const frames = (r[3] as { stepFrames?: unknown }).stepFrames;
          out.push({ t: "follow", npc: r[1], path, from, ...(typeof frames === "number" && frames !== 16 ? { stepFrames: frames } : {}) });
          i += 2;
          continue;
        }
      }
      // Choice
      if (verb === "choice" && Array.isArray(r[1])) {
        const got = choiceAt(i, hi);
        if (got) {
          out.push(got.block);
          i = got.next;
          continue;
        }
      }
      // If: [check] jump_if_x <label> with the label later in this range
      const check = verbs.checks.has(verb) ? r : null;
      const j = check ? i + 1 : i;
      const jr = rows[j];
      if (jr && (jr[0] === "jump_if_false" || jr[0] === "jump_if_true") && typeof jr[1] === "string" && jr[1] !== "end" && j < hi) {
        const got = ifAt(j, hi, check, jr[0] === "jump_if_true");
        if (got) {
          out.push(got.block);
          i = got.next;
          continue;
        }
      }
      if (verb === "jump" && r[1] === "end") out.push({ t: "stop" });
      else if (JUMPS.has(verb) && typeof r[1] === "string") out.push({ t: "goto", label: r[1], ...(verb === "jump" ? {} : { when: verb === "jump_if_true" }) });
      else if (verb === "label" && typeof r[1] === "string") out.push({ t: "label", name: r[1] });
      else out.push({ t: "cmd", row: r });
      i++;
    }
    return out;
  };

  const ifAt = (j: number, hi: number, cond: EventRow | null, not: boolean): { block: Block; next: number } | null => {
    const target = rows[j][1] as string;
    const ti = at.get(target);
    if (ti === undefined || ti <= j || ti >= hi || !only(target)) return null;
    // then ... [jump <end>] label <target> else ... label <end>
    const before = rows[ti - 1];
    if (before && before[0] === "jump" && typeof before[1] === "string" && before[1] !== "end" && ti - 1 > j) {
      const endL = before[1];
      const ei = at.get(endL);
      if (ei !== undefined && ei > ti && ei < hi && only(endL)) {
        return { block: { t: "if", cond, not, then: seq(j + 1, ti - 1), else: seq(ti + 1, ei) }, next: ei + 1 };
      }
    }
    return { block: { t: "if", cond, not, then: seq(j + 1, ti), else: null }, next: ti + 1 };
  };

  const choiceAt = (i: number, hi: number): { block: Block; next: number } | null => {
    const labels = (rows[i][1] as unknown[]).map(String);
    const count = labels.length;
    const starts: string[] = [];
    let k = i + 1;
    if (count === 2) {
      if (!(rows[k]?.[0] === "jump_if_false" && typeof rows[k][1] === "string")) return null;
      starts.push(rows[k][1] as string);
      k++;
    } else {
      for (let n = 2; n <= count; n++) {
        if (!(rows[k]?.[0] === verbs.choiceVerb && rows[k][1] === n && rows[k + 1]?.[0] === "jump_if_true" && typeof rows[k + 1][1] === "string")) return null;
        starts.push(rows[k + 1][1] as string);
        k += 2;
      }
    }
    const pos = starts.map((l) => at.get(l));
    if (pos.some((p, n) => p === undefined || p >= hi || !only(starts[n]) || (n > 0 && p! <= pos[n - 1]!) || p! <= k)) return null;
    // every branch but the last ends in jump <end>
    const endL = rows[pos[0]! - 1]?.[0] === "jump" ? (rows[pos[0]! - 1][1] as string) : null;
    const ei = endL ? at.get(endL) : undefined;
    if (!endL || ei === undefined || ei >= hi || ei <= pos[pos.length - 1]! || (refs.get(endL) ?? 0) !== count - 1) return null;
    const bounds = [k, ...pos.map((p) => p! + 1)];
    const ends = [...pos.map((p) => p! - 1), ei];
    for (let n = 0; n < count - 1; n++) if (!(rows[ends[n]]?.[0] === "jump" && rows[ends[n]][1] === endL)) return null;
    const branches = bounds.map((b, n) => seq(b, ends[n]));
    if (!isLabel(ei, endL)) return null;
    return { block: { t: "choice", labels, branches }, next: ei + 1 };
  };

  return seq(0, rows.length);
}
