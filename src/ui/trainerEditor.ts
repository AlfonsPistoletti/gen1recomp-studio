// Trainers workspace: trainer classes (left), their teams (center), and the
// AI (right). Edits go to the "trainers" registry and, for item/switch AI,
// to "ai_classes". A team is a list of { species, level, moves? }; a slot
// without moves gets what the game would give it, shown greyed.

import { addAsset } from "../core/assets.ts";
import { clone } from "../core/merge.ts";
import { store } from "../core/store.ts";
import type { TrainerSlot, TrainerSpec } from "../games/types.ts";
import { importArt } from "./artImport.ts";
import { clear, comboInput, field, h, numberInput, onFocusLeave, rerender, selectInput, toast } from "./dom.ts";
import { promptNewRecord } from "./newRecord.ts";
import { nav } from "./nav.ts";
import { idRow } from "./renameId.ts";
import { spriteUrl } from "./pokemonEditor.ts";
import { mountRecordList } from "./recordList.ts";
import { colorSelect, defaultView, monPaletteName, paletteField, picColors } from "./picColors.ts";
import { showTinted } from "../render/graphics.ts";
import { gameEvents, scriptBattles, type ScriptBattle } from "../project/gameEvents.ts";
import type { GameScripts } from "../lua/vm.ts";
import { STARTER_BALLS } from "../lua/starterRuntime.ts";

type Rec = Record<string, unknown>;
type Party = TrainerSlot[];

function spec(): TrainerSpec | undefined {
  return store.adapter?.trainers;
}

function trainers(): Record<string, Rec> {
  return store.table(spec()?.registry ?? "trainers") as Record<string, Rec>;
}

// the Colors choice at the top (null: RED++ while the map view shows RED++,
// else the pics' own palettes)
let view: string | null = null;
const viewNow = () => view ?? defaultView();

// a portrait's palette: the trainer's own, else MEWMON (BattleState.trainerPalette)
const trainerPalette = (r: Rec) => (typeof r.palette === "string" && store.table("palettes")[r.palette] ? r.palette : "MEWMON");

// full color: the trainer's own setting, else the one of the portrait it
// reuses (BattleState.trainerTrueColor)
function trainerTrueColor(r: Rec): boolean {
  if (typeof r.trueColor === "boolean") return r.trueColor;
  const base = typeof r.basePic === "string" ? trainers()[r.basePic] : undefined;
  return base?.trueColor === true;
}

// the class's teams, as the game stores them (TrainerSpec.teams; Gen 1:
// `parties`)
function parties(r: Rec | undefined): Party[] {
  if (!r) return [];
  const t = spec()?.teams;
  if (t) return t.read(r);
  return Array.isArray(r.parties) ? (r.parties as Party[]) : [];
}
function setParties(d: Rec, list: Party[]): void {
  const t = spec()?.teams;
  if (t) t.write(d, list);
  else d.parties = list;
}
function teamName(r: Rec, p: number): string {
  const t = spec()?.teams;
  return t ? t.name(r, p) : ((r.partyNames ?? {}) as Record<string, string>)[String(p + 1)] ?? "";
}
function setTeamName(d: Rec, p: number, v: string): void {
  const t = spec()?.teams;
  if (t) return t.setName(d, p, v);
  const names = { ...((d.partyNames ?? {}) as Record<string, string>) };
  if (v) names[String(p + 1)] = v;
  else delete names[String(p + 1)];
  if (Object.keys(names).length) d.partyNames = names;
  else delete d.partyNames;
}

// battles the game's scripts start (rivals, ...), loaded with the project;
// empty on a release build
let scripted: ScriptBattle[] = [];
// the game's own map scripts: an NPC whose talk one of them (or a studio
// talk event) handles as plain rows never fights with its own trainer class
// and team (OverworldController:talkTo, "hand-ported scripts always win";
// rows can't fight the NPC). Talk written as code may (gym leaders and the
// Elite Four call ow:engageTrainer(npc)), so it still counts.
let gameTalk: GameScripts | null = null;
function talkOwned(mapId: string, text: unknown): boolean {
  if (typeof text !== "string") return false;
  if (Array.isArray(gameTalk?.[mapId]?.talk?.[text])) return true;
  const reg = store.adapter.events?.registry;
  return !!reg && store.table(reg)[`${mapId}:talk:${text}`] !== undefined;
}

// battles the mod's own events start (studio trainers are map NPCs already)
function eventBattles(): ScriptBattle[] {
  const reg = store.adapter.events?.registry;
  if (!reg) return [];
  const out: ScriptBattle[] = [];
  for (const [id, ev] of Object.entries(store.table(reg) as Record<string, { rows?: unknown[][]; trainer?: unknown }>)) {
    if (ev?.trainer) continue;
    for (const row of ev?.rows ?? []) {
      const args = row[0] === "rival_battle" ? row.slice(1) : row[0] === "start_battle" && row[1] === "trainer" ? row.slice(2) : null;
      if (args && typeof args[0] === "string") out.push({ cls: args[0], party: Number(args[1] ?? 1), where: `event:${id}` });
    }
  }
  return out;
}

const scriptUses = (id: string): ScriptBattle[] => [...scripted, ...eventBattles()].filter((b) => b.cls === id);

// how many map objects and scripts fight as each trainer class
function fightCounts(): Map<string, number> {
  const s = spec()!;
  const out = new Map<string, number>();
  if (s.uses) {
    for (const id of Object.keys(trainers())) out.set(id, [...s.uses(store.ctx, id).values()].reduce((n, l) => n + l.length, 0));
    return out;
  }
  const layer = store.adapter.layers.find((l) => l.kind === "npc");
  if (!layer) return out;
  for (const map of Object.values(store.maps)) {
    for (const o of store.entities(map, layer.key)) {
      const c = o[s.objectClassKey];
      if (typeof c === "string" && !talkOwned(map.id, o.text)) out.set(c, (out.get(c) ?? 0) + 1);
    }
  }
  for (const b of [...scripted, ...eventBattles()]) out.set(b.cls, (out.get(b.cls) ?? 0) + 1);
  return out;
}

// map objects that fight as this trainer, per team number (1-based)
function usesOf(id: string): Map<number, { mapId: string; index: number }[]> {
  const s = spec()!;
  if (s.uses) return s.uses(store.ctx, id);
  const out = new Map<number, { mapId: string; index: number }[]>();
  const layer = store.adapter.layers.find((l) => l.kind === "npc");
  if (!layer) return out;
  for (const map of Object.values(store.maps)) {
    store.entities(map, layer.key).forEach((o, index) => {
      if (o[s.objectClassKey] !== id || talkOwned(map.id, o.text)) return;
      const n = Number(o[s.objectPartyKey] ?? 1);
      if (!out.has(n)) out.set(n, []);
      out.get(n)!.push({ mapId: map.id, index });
    });
  }
  return out;
}

export function mountTrainerWorkspace(left: HTMLElement, center: HTMLElement, right: HTMLElement): void {
  let current: string | null = null;

  const newBtn = h("button", { class: "btn small", title: "Add a trainer class, starting as a copy of one", onclick: () => createTrainer() }, "+ New");
  const list = mountRecordList(left, {
    title: "Trainers",
    head: [newBtn],
    placeholder: "Search trainers…  (Ctrl+F)",
    searchId: "trainers-search",
    items: () => {
      const s = spec();
      if (!s) return [];
      const all = trainers();
      const used = fightCounts();
      return Object.keys(all)
        .sort((a, b) => ((all[a].index as number) ?? 999) - ((all[b].index as number) ?? 999) || a.localeCompare(b))
        .map((id) => {
          const r = all[id];
          const pic = s.pic(id, store.ctx);
          const species = parties(r).flat().map((m) => m.species);
          const fought = used.get(id) ?? 0;
          const n = parties(r).length;
          return {
            id,
            label: String(r.name ?? id),
            meta: fought ? `${n} ${s.teams ? "trainer" : "team"}${n === 1 ? "" : "s"}` : "unused",
            search: `${id} ${species.join(" ")}`,
            icon: pic ? spriteUrl(pic) : undefined,
            edited: store.isRecordEdited(s.registry, id) || (!!s.aiClasses && store.isRecordEdited(s.aiClasses.registry, aiId(id))),
            isNew: store.baseTable(s.registry)[id] === undefined,
          };
        });
    },
    current: () => current,
    pick: (id) => open(id),
    refreshOn: (reason, _id, registry) =>
      reason === "edit" || (reason === "content" && (registry === spec()?.registry || registry === spec()?.aiClasses?.registry)),
  });

  const main = h("div", { class: "ws-scroll" });
  const side = h("div", { class: "ws-scroll" });
  const title = h("span", { class: "head-title" }, "Trainers");
  const revert = h("button", {
    class: "btn small danger",
    onclick: () => {
      const s = spec();
      if (!current || !s) return;
      const id = current;
      if (store.baseTable(s.registry)[id] === undefined) return deleteTrainer(id);
      store.group(`Revert ${id}`, () => {
        store.revertRecord(s.registry, id);
        if (s.aiClasses) store.revertRecord(s.aiClasses.registry, aiId(id));
      });
    },
  }, "Revert to base");
  const colors = h("span", {});
  center.append(h("div", { class: "panel-head" }, title, h("div", { class: "row nowrap" }, colors, revert)), main);
  right.append(h("div", { class: "panel-head" }, h("span", {}, "AI")), side);

  const open = (id: string) => {
    if (!trainers()[id]) return;
    current = id;
    list.render();
    render(true);
    left.querySelector<HTMLElement>(`.map-row[data-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
  };
  nav.openTrainer = (id, team) => {
    nav.setWorkspace("trainers");
    open(id);
    if (!team) return;
    // after the workspace is laid out: bring the team into view and flash it
    requestAnimationFrame(() => {
      const card = main.querySelector<HTMLElement>(`.card[data-team="${team}"]`);
      if (!card) return toast(`${id} has no team ${team}`, "error");
      card.scrollIntoView({ block: "start", behavior: "smooth" });
      card.classList.remove("flash");
      void card.offsetWidth;
      card.classList.add("flash");
    });
  };

  // a new class as a copy: teams, money and AI, and the source's portrait
  // through basePic (it follows the source until replaced)
  const createTrainer = async () => {
    const s = spec();
    if (!s) return;
    const all = trainers();
    const res = await promptNewRecord({
      title: "New trainer class",
      idPrefix: "OPP_",
      nameMax: s.nameMax,
      taken: (id) => all[id] !== undefined,
      sources: Object.keys(all).sort().map((id) => ({ id, label: `${String(all[id].name ?? id)} (${id})` })),
      source: current ?? Object.keys(all).sort()[0],
    });
    if (!res) return;
    const src = all[res.source];
    const rec = clone(src) as Rec;
    rec.id = res.id;
    rec.name = res.name;
    delete rec.index;
    delete rec.source;
    delete rec.aiClass;
    if (typeof src.pic === "string") {
      delete rec.pic;
      rec.basePic = res.source;
    }
    const ai = s.aiClasses ? store.table(s.aiClasses.registry)[aiId(res.source)] : undefined;
    store.group(`New trainer ${res.id}`, () => {
      store.setRecord(s.registry, res.id, `New trainer ${res.id}`, rec);
      if (s.aiClasses && ai) store.setRecord(s.aiClasses.registry, res.id, "Trainer AI", clone(ai));
    });
    open(res.id);
  };

  const deleteTrainer = (id: string) => {
    const s = spec()!;
    const fought = fightCounts().get(id) ?? 0;
    const based = Object.entries(trainers()).filter(([, t]) => t.basePic === id).map(([t]) => t);
    const notes = [fought ? `${fought} map NPC(s) fight as ${id}.` : "", based.length ? `${based.join(", ")} use its portrait.` : ""].filter(Boolean);
    if (!confirm(`${notes.length ? notes.join(" ") + "\n\n" : ""}Delete ${id}?`)) return;
    store.group(`Delete ${id}`, () => {
      store.setRecord(s.registry, id, `Delete ${id}`, undefined);
      if (s.aiClasses && store.baseTable(s.aiClasses.registry)[id] === undefined) store.setRecord(s.aiClasses.registry, id, "Delete trainer AI", undefined);
    });
    current = Object.keys(trainers()).sort()[0] ?? null;
    list.render();
    render(true);
  };

  const render = (force = false) => {
    const s = spec();
    const r = current ? trainers()[current] : undefined;
    if (!s || !r || !current) {
      clear(main);
      clear(side);
      main.append(h("p", { class: "hint empty" }, s ? "Pick a trainer on the left." : "This game has no trainer editor yet."));
      return;
    }
    const id = current;
    title.textContent = String(r.name ?? id);
    newBtn.hidden = s.newTeams === false || s.newClasses === false;
    colors.replaceChildren(s.colors === false ? "" : colorSelect(viewNow(), trainerPalette(r), false, (v) => {
      view = v;
      render(true);
    }));
    const isNew = store.baseTable(s.registry)[id] === undefined;
    revert.textContent = isNew ? "Delete trainer" : "Revert to base";
    revert.hidden = !isNew && !(store.isRecordEdited(s.registry, id) || (s.aiClasses && store.isRecordEdited(s.aiClasses.registry, aiId(id))));
    if (force) {
      clear(main);
      clear(side);
    }
    rerender(main, () => mainForm(s, id, r));
    rerender(side, () => aiForm(s, id, r));
  };

  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      render();
    });
  };
  for (const el of [main, side]) onFocusLeave(el, schedule);
  store.on((reason, id, registry) => {
    const s = spec();
    if (reason === "project") {
      if (!current || !trainers()[current]) current = Object.keys(trainers()).sort()[0] ?? null;
      render(true);
      // the game's scripted battles (checkout only), then the list again
      const { host, version } = store.project;
      void Promise.all([scriptBattles(host, version), gameEvents(host, version).catch(() => null)]).then(([b, talk]) => {
        scripted = b;
        gameTalk = talk;
        list.render();
        render(true);
      });
    } else if (reason === "content" && s && (registry === s.registry || registry === s.aiClasses?.registry || registry === "pokemon")) {
      schedule();
    } else if (reason === "edit") {
      schedule(); // map NPCs may now use another team
    } else if (reason === "reveal" && s && (registry === s.registry || registry === s.aiClasses?.registry) && id) {
      nav.openTrainer(registry === s.registry ? id : Object.keys(trainers()).find((t) => aiId(t) === id) ?? id);
    }
  });
}

// ------------------------------------------------------------------ editing

function edit(id: string, label: string, mutate: (r: Rec) => void): void {
  store.editRecord<Rec>(spec()!.registry, id, label, mutate);
  store.seal();
}

function editParty(id: string, p: number, label: string, mutate: (party: Party) => void): void {
  edit(id, label, (r) => {
    const all = parties(r).map((x) => x.map((m) => ({ ...m })));
    mutate(all[p]);
    setParties(r, all);
  });
}

function mainForm(s: TrainerSpec, id: string, r: Rec): HTMLElement[] {
  const pic = s.pic(id, store.ctx);
  const name = h("input", { type: "text", value: String(r.name ?? ""), maxLength: s.nameMax, spellcheck: false });
  name.addEventListener("change", () => edit(id, "Trainer name", (d) => (d.name = name.value.toUpperCase() || id)));
  const money = numberInput(Number(r.baseMoney ?? 0), (v) => edit(id, "Prize money", (d) => (d.baseMoney = Math.max(0, v))), 0, 9999);
  const uses = usesOf(id);
  const header = h(
    "div",
    { class: "mon-header" },
    portrait(s, id, r, pic),
    h(
      "div",
      { class: "mon-ident" },
      idRow(s.registry, id, String(r.name ?? ""), (to) => nav.openTrainer(to)),
      field("Name", name, `Up to ${s.nameMax} characters, shown as "${String(r.name ?? id)} wants to fight!"`),
      field("Prize money", money, prizeHint(r)),
      ...s.notes(id, store.ctx).map((n) => h("p", { class: "hint" }, n)),
      fightCounts().get(id) ? null : h("p", { class: "hint warn" }, "Unused: no NPC on any map, no event and no game script fights this trainer class."),
    ),
  );
  const all = parties(r);
  const teams = all.map((party, p) => teamCard(s, id, r, party, p, uses.get(p + 1) ?? [], p === all.length - 1, scriptUses(id).filter((b) => b.party === p + 1)));
  const add = h(
    "button",
    {
      class: "btn small",
      title: s.teams ? "Adds a trainer to this class; place it on a map as a person (Maps, select a person, Trainer)" : "Adds a team at the end; NPCs pick a team by its number",
      onclick: () => edit(id, s.teams ? "Add trainer" : "Add team", (d) => setParties(d, [...parties(d), [{ species: firstSpecies(), level: 5 }]])),
    },
    s.teams ? "+ Trainer" : "+ Team",
  );
  if (s.newTeams === false) return [header, ...teams];
  const hint = s.teams ? "A new trainer is fought by a map person made a trainer in its panel (Maps)." : "Map NPCs choose a team by its number (trainerParty).";
  return [header, ...teams, h("div", { class: "row" }, add, h("span", { class: "hint" }, hint))];
}

// BattleState: the prize is baseMoney × the level of the last Pokémon the
// trainer sends out (the team's last), so it is shown per team
function prizeHint(r: Rec): string {
  const base = Number(r.baseMoney ?? 0);
  const won = parties(r).map((p, i) => `${parties(r).length > 1 ? `${teamName(r, i) || `team ${i + 1}`} ` : ""}₽${base * Number(p[p.length - 1]?.level ?? 0)}`);
  return `The game pays this × the level of the team's last Pokémon: ${won.join(", ") || "₽0"}`;
}

function firstSpecies(): string {
  const mons = store.table("pokemon");
  return ["RATTATA", "PIDGEY"].find((m) => mons[m]) ?? Object.keys(mons)[0] ?? "RATTATA";
}

// The rival's teams come in threes, one per ball the player took
// (Commands.rival_battle: base team + 0 Charmander's, 1 Squirtle's, 2
// Bulbasaur's ball). Red/Blue; Yellow picks his team another way.
function rivalChoice(id: string, p: number): string | null {
  if (!/^OPP_RIVAL[123]$/.test(id) || store.project.version === "yellow") return null;
  const k = p % 3;
  const b = STARTER_BALLS[k];
  const own = (store.table("studio_starters")[b.ball] as { species?: string } | undefined)?.species ?? b.ball;
  const name = String((store.table("pokemon")[own] as { name?: string } | undefined)?.name ?? own);
  return `When the player chooses ball ${k + 1}: ${name}`;
}

function teamCard(s: TrainerSpec, id: string, r: Rec, party: Party, p: number, used: { mapId: string; index: number }[], isLast: boolean, scripts: ScriptBattle[]): HTMLElement {
  const mons = store.table("pokemon") as Record<string, Rec>;
  const speciesIds = Object.keys(mons).sort();
  const moveIds = store.adapter.pokemon?.moveNames(store.ctx) ?? [];
  const nameInput = h("input", { type: "text", value: teamName(r, p), placeholder: s.teams ? "name" : "(no name)", maxLength: s.nameMax, spellcheck: false, class: "team-name", title: s.teams ? "The trainer's name: \"BEAUTY VICTORIA wants to battle!\"" : "" });
  nameInput.addEventListener("change", () => edit(id, "Team name", (d) => setTeamName(d, p, nameInput.value.trim().toUpperCase())));
  const items = s.heldItems ? (store.adapter.pokemon?.itemNames(store.ctx) ?? []) : [];

  const rows = party.map((slot, i) => {
    const custom = Array.isArray(slot.moves);
    const shown = custom ? slot.moves! : s.defaultMoves(id, p, i, party, store.ctx);
    const front = mons[slot.species] ? spriteUrl(store.adapter.pokemon?.frontSprite(mons[slot.species])) : "";
    const moves = custom
      ? h(
          "div",
          { class: "row slot-moves" },
          ...[0, 1, 2, 3].map((k) =>
            comboInput(shown[k] ?? "", "dl-moves", moveIds, (v) => editParty(id, p, "Team move", (pt) => (pt[i].moves = setMove(pt[i].moves ?? [], k, v))), "—"),
          ),
          h("button", { class: "btn small ghost", title: "Back to the moves the game gives it", onclick: () => editParty(id, p, "Default moves", (pt) => delete pt[i].moves) }, "Default"),
        )
      : h(
          "div",
          { class: "row slot-moves" },
          h("span", { class: "default-moves", title: "What the game gives it: its last four level-up moves (plus a signature move for some leaders)" }, shown.map((m) => m.replace(/_/g, " ")).join(" · ") || "—"),
          h("button", { class: "btn small", title: "Pick this Pokémon's moves yourself", onclick: () => editParty(id, p, "Custom moves", (pt) => (pt[i].moves = [...shown])) }, "Custom moves"),
        );
    return h(
      "div",
      { class: "team-slot" },
      front
        ? showTinted(h("img", { class: "slot-icon big", alt: "" }), front, slotColors(slot.species, mons[slot.species]))
        : h("span", { class: "slot-icon big" }),
      h(
        "div",
        { class: "slot-main" },
        h(
          "div",
          { class: "row nowrap" },
          comboInput(slot.species, "dl-species", speciesIds, (v) => editParty(id, p, "Team species", (pt) => (pt[i].species = v))),
          h("span", { class: "muted" }, "Lv"),
          numberInput(slot.level, (v) => editParty(id, p, "Team level", (pt) => (pt[i].level = Math.max(1, Math.min(100, v)))), 1, 100),
          s.heldItems
            ? selectInput(String(slot.item ?? ""), items, (v) => editParty(id, p, "Held item", (pt) => (v ? (pt[i].item = v) : delete pt[i].item)), "no item")
            : null,
          h("button", { class: "btn small ghost", title: "Move up", disabled: i === 0, onclick: () => editParty(id, p, "Reorder team", (pt) => pt.splice(i - 1, 0, ...pt.splice(i, 1))) }, "↑"),
          h("button", { class: "btn small ghost", title: "Move down", disabled: i === party.length - 1, onclick: () => editParty(id, p, "Reorder team", (pt) => pt.splice(i + 1, 0, ...pt.splice(i, 1))) }, "↓"),
          h("button", { class: "btn small ghost", title: "Remove", disabled: party.length <= 1, onclick: () => editParty(id, p, "Remove team member", (pt) => pt.splice(i, 1)) }, "✕"),
        ),
        moves,
      ),
    );
  });

  const usedBy = used.length || scripts.length
    ? h(
        "div",
        { class: "row" },
        h("span", { class: "hint" }, "Fought at:"),
        // index -1: a map script (no object of its own) starts the battle
        ...used.map((u) => u.index < 0
          ? h("button", { class: "btn small ghost", title: "A script on this map starts the battle", onclick: () => nav.openMap(u.mapId) }, `${u.mapId} (script)`)
          : h("button", { class: "btn small ghost", onclick: () => nav.selectEntity(u.mapId, "objects", u.index) }, `${u.mapId} #${u.index + 1}`)),
        ...scripts.map((b) => b.where.startsWith("event:")
          ? h("button", { class: "btn small ghost", onclick: () => nav.openEvent(b.where.slice(6)) }, `event ${b.where.slice(6)}`)
          : h("span", { class: "tag", title: "A battle the game's own script starts" }, `script: ${b.where}`)),
      )
    : h("p", { class: "hint" }, s.teams ? "No map NPC or script fights this trainer." : "No map NPC or script uses this team.");

  const removeTeam = () => {
    if (used.length && !confirm(`Team ${p + 1} is used by ${used.length} NPC(s). Remove it anyway? They would have no team to fight with.`)) return;
    edit(id, "Remove team", (d) => setParties(d, parties(d).slice(0, -1)));
  };
  return h(
    "section",
    { class: "card", "data-team": p + 1 },
    h(
      "div",
      { class: "card-head" },
      h("h4", {}, s.teams ? `Trainer ${p + 1}` : `Team ${p + 1}`, rivalChoice(id, p) ? h("span", { class: "hint team-choice" }, rivalChoice(id, p)) : null),
      h(
        "div",
        { class: "row nowrap" },
        nameInput,
        s.newTeams === false || s.teams ? null : h("button", { class: "btn small ghost", title: "Copy this team to a new one at the end", onclick: () => edit(id, "Duplicate team", (d) => setParties(d, [...parties(d), party.map((m) => ({ ...m }))])) }, "Duplicate"),
        // the game's own trainers stay (scripts refer to them by number)
        isLast && s.newTeams !== false && (!s.teams || p >= parties(store.baseTable(s.registry)[id] as Rec | undefined).length)
          ? h("button", { class: "btn small ghost danger", title: "Only the last team can be removed, so the other numbers stay valid", onclick: removeTeam }, "Remove")
          : null,
      ),
    ),
    ...rows,
    h(
      "div",
      { class: "row" },
      party.length < s.maxPartySize
        ? h("button", { class: "btn small", onclick: () => editParty(id, p, "Add team member", (pt) => pt.push({ species: party[party.length - 1]?.species ?? firstSpecies(), level: party[party.length - 1]?.level ?? 5 })) }, "+ Pokémon")
        : h("span", { class: "hint" }, `Full (${s.maxPartySize}).`),
    ),
    usedBy,
  );
}

// The portrait with its art controls: import one, or borrow another
// class's (basePic), and the full-color switch.
function portrait(s: TrainerSpec, id: string, r: Rec, pic: string | undefined): HTMLElement {
  const mod = store.project.mod;
  const all = trainers();
  const importPic = async () => {
    if (!mod) return toast("Choose or create a mod first: imported art is saved into it", "error");
    const res = await importArt({ label: "Trainer portrait", width: s.picSize, height: s.picSize, align: "bottom" }, { trueColor: r.trueColor === true });
    if (!res) return;
    const path = addAsset(mod, `${id}_pic`, res.data);
    edit(id, "Import portrait", (d) => {
      d.pic = path;
      delete d.basePic;
      if (res.trueColor) d.trueColor = true;
      else delete d.trueColor;
    });
  };
  const borrow = s.basePic === false ? null : selectInput(
    typeof r.basePic === "string" && !r.pic ? r.basePic : "",
    Object.keys(all).filter((t) => t !== id && (typeof all[t].pic === "string")).sort(),
    (v) =>
      edit(id, "Use portrait", (d) => {
        if (!v) return;
        d.basePic = v;
        delete d.pic;
        delete d.trueColor;
      }),
    "Use portrait of…",
  );
  const color = h("input", { type: "checkbox", checked: r.trueColor === true });
  color.addEventListener("change", () => edit(id, "Full color", (d) => (color.checked ? (d.trueColor = true) : delete d.trueColor)));
  return h(
    "div",
    { class: "art-slot portrait" },
    h("div", { class: "art-thumb" }, pic ? showTinted(h("img", { alt: "" }), spriteUrl(pic), s.colors === false ? (s.picColors?.(store.ctx, id) ?? null) : picColors(viewNow(), () => trainerPalette(r), trainerTrueColor(r))) : h("span", { class: "hint" }, "no portrait")),
    h("button", { class: "btn small", onclick: importPic }, "Import…"),
    borrow,
    s.colors === false ? null : h("label", { class: "row nowrap hint" }, color, "Full color"),
    s.colors === false ? null : field("Palette", paletteField(r.palette, "MEWMON", (v) => edit(id, "Portrait palette", (d) => (v ? (d.palette = v) : delete d.palette))), "The portrait's colors in battle."),
  );
}

// a team member's picture colors: the game's own per-species palette when it
// has one (Gen 2), else the Colors choice
function slotColors(species: string, mon: Rec | undefined) {
  const own = store.adapter.pokemon?.monColors;
  if (own) return mon?.trueColor === true ? null : own(store.ctx, species);
  return picColors(viewNow(), (redpp) => monPaletteName(species, mon, redpp), mon?.trueColor === true);
}

// a custom move list: set slot k, drop empty slots, keep at most four
function setMove(moves: string[], k: number, v: string): string[] {
  const next = [...moves];
  next[k] = v;
  const out = next.filter((m) => !!m);
  if (!out.length) toast("A Pokémon needs at least one move; use Default to go back to the game's moves", "info");
  return out.length ? out.slice(0, 4) : moves;
}

// ------------------------------------------------------------------ AI

// the ai_classes record a trainer uses: its aiClass, else its own id
function aiId(trainerId: string): string {
  const r = trainers()[trainerId];
  return typeof r?.aiClass === "string" ? r.aiClass : trainerId;
}

function aiForm(s: TrainerSpec, id: string, r: Rec): HTMLElement[] {
  if (s.ai === false) return [h("p", { class: "hint" }, "This game sets a class's AI in its attribute bytes, which the studio doesn't edit yet.")];
  const out: HTMLElement[] = [];
  // move choice layers
  const mods = Array.isArray(r.aiMods) ? (r.aiMods as unknown[]) : [];
  const layerRows = s.aiLayers.map((l) => {
    const box = h("input", { type: "checkbox", checked: mods.includes(l.value) });
    box.addEventListener("change", () =>
      edit(id, l.label, (d) => {
        const cur = Array.isArray(d.aiMods) ? (d.aiMods as unknown[]) : [];
        const next = box.checked ? [...cur.filter((m) => m !== l.value), l.value] : cur.filter((m) => m !== l.value);
        // vanilla order: numbers ascending, named layers after
        d.aiMods = [...next.filter((m) => typeof m === "number").sort((a, b) => (a as number) - (b as number)), ...next.filter((m) => typeof m !== "number")];
      }),
    );
    return h("label", { class: "ai-layer" }, box, h("span", {}, h("strong", {}, `${l.value}. ${l.label}`), h("span", { class: "hint" }, l.about)));
  });
  const others = mods.filter((m) => !s.aiLayers.some((l) => l.value === m));
  out.push(
    h(
      "section",
      { class: "card" },
      h("h4", {}, "Move choice"),
      h("p", { class: "hint" }, "Without any layer the trainer picks a random move."),
      ...layerRows,
      others.length ? h("p", { class: "hint" }, `Also uses: ${others.map(String).join(", ")} (set by a mod).`) : null,
    ),
  );

  if (s.aiClasses) out.push(itemAiCard(id, s.aiClasses));
  return out;
}

function itemAiCard(trainerId: string, ai: NonNullable<TrainerSpec["aiClasses"]>): HTMLElement {
  const classId = aiId(trainerId);
  const rec = store.table(ai.registry)[classId] as Rec | undefined;
  const shared = classId !== trainerId;
  const editAi = (label: string, mutate: (d: Rec) => void) => {
    store.editRecord<Rec>(ai.registry, classId, label, mutate, { create: () => ({ uses: 1 }) });
    store.seal();
  };
  const head = h("h4", {}, "Items & switching");
  if (!rec) {
    return h(
      "section",
      { class: "card" },
      head,
      h("p", { class: "hint" }, "Never uses items or switches."),
      h("button", { class: "btn small", onclick: () => editAi("Add item AI", (d) => Object.assign(d, { uses: 1, chance: 64, item: "POTION", hpBelow: 5 })) }, "+ Use items"),
    );
  }
  const num = (key: string, label: string, hint: string, min: number, max: number) =>
    h(
      "div",
      { class: "ai-row" },
      field(label, numberInput(rec[key] as number | undefined, (v) => editAi(label, (d) => (d[key] = Math.max(min, Math.min(max, v)))), min, max)),
      h("span", { class: "hint" }, hint),
      rec[key] !== undefined ? h("button", { class: "btn small ghost", title: "Clear", onclick: () => editAi(label, (d) => delete d[key]) }, "✕") : null,
    );
  const item = h("select", {}, h("option", { value: "", selected: !rec.item }, "(none)"), ...ai.items.map((i) => h("option", { value: i, selected: rec.item === i }, i)));
  if (typeof rec.item === "string" && !ai.items.includes(rec.item)) item.prepend(h("option", { value: rec.item, selected: true }, rec.item));
  item.addEventListener("change", () => editAi("AI item", (d) => (item.value ? (d.item = item.value) : delete d.item)));
  const flag = (key: string, label: string, hint: string) => {
    const box = h("input", { type: "checkbox", checked: rec[key] === true });
    box.addEventListener("change", () => editAi(label, (d) => (box.checked ? (d[key] = true) : delete d[key])));
    return h("label", { class: "ai-layer" }, box, h("span", {}, h("strong", {}, label), h("span", { class: "hint" }, hint)));
  };
  const chance = Number(rec.chance);
  return h(
    "section",
    { class: "card" },
    head,
    shared ? h("p", { class: "hint warn" }, `Shared with ${classId}: changes apply to every trainer using it.`) : null,
    field("Item", item),
    num("uses", "Uses per Pokémon", "How often it may use an item or switch, per Pokémon of its team.", 0, 99),
    num("chance", "Chance (out of 256)", rec.chance !== undefined ? `≈ ${((chance / 256) * 100).toFixed(0)}% each turn. Empty = always.` : "Empty = always.", 0, 256),
    num("hpBelow", "Only below 1/N HP", rec.hpBelow ? `Uses the item only below ${Math.round(100 / Number(rec.hpBelow))}% HP.` : "Empty = at any HP.", 1, 99),
    flag("onStatus", "Only when statused", "Uses the item only while its Pokémon has a status condition (e.g. Full Heal)."),
    flag("switch", "Switches instead", "Switches Pokémon instead of using an item."),
    num("switchBelow", "Switch below 1/N HP", "With an HP limit: switches when even lower than this.", 1, 99),
    num("switchChance", "Switch chance (out of 256)", "Rolled before the item; switching wins when it hits.", 0, 256),
    h(
      "div",
      { class: "row" },
      h("button", { class: "btn small ghost danger", onclick: () => { store.setRecord(ai.registry, classId, "No item AI", undefined); store.seal(); } }, "Never use items"),
    ),
  );
}
