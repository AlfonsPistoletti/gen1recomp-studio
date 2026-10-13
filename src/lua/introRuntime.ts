// Oak's speech (studio_intro.lua: speech = { steps = {...} }). The intro is
// a list of steps (gen1recomp src/ui/OakSpeech.lua defaultSteps) that mods
// reshape through the public intro.oak_speech.build hook. The mod's list
// names the game's steps by id (with any changed keys) and holds its own
// whole; steps other mods added stay after the step they followed. An
// answer's flag (studioFlags[index]) is set in the save, which exists
// while the speech runs (Game:startNewGame), so events can check it.
export const INTRO_RUNTIME = String.raw`
  -- studio intro: Oak's speech in the mod's order
  local function studioIntro(spec)
    local list = type(spec) == "table" and type(spec.speech) == "table" and spec.speech.steps
    if type(list) ~= "table" then return end
    mod.hooks:wrap("intro.oak_speech.build", function(vanilla, steps, speech)
      steps = vanilla(steps, speech)
      if type(steps) ~= "table" then return steps end
      local byId, known = {}, {}
      for _, s in ipairs(steps) do if type(s) == "table" and s.id then byId[s.id] = s end end
      for _, s in ipairs(list) do known[s.id] = true end
      -- steps the mod doesn't know (other mods'): after the step they followed
      local after = {}
      local prev = "__start"
      for _, s in ipairs(steps) do
        if type(s) == "table" and s.id and known[s.id] then
          prev = s.id
        else
          after[prev] = after[prev] or {}
          table.insert(after[prev], s)
        end
      end
      local out = {}
      for _, extra in ipairs(after.__start or {}) do out[#out + 1] = extra end
      for _, s in ipairs(list) do
        local step = {}
        for k, v in pairs(byId[s.id] or {}) do step[k] = v end
        for k, v in pairs(s) do
          if k == "flags" then step.studioFlags = v else step[k] = v end
        end
        if byId[s.id] or step.kind then out[#out + 1] = step end
        for _, extra in ipairs(after[s.id] or {}) do out[#out + 1] = extra end
      end
      return out
    end)
    mod.events:on("intro.oak_speech.answered", function(ev)
      local flags = ev and ev.step and ev.step.studioFlags
      local flag = type(flags) == "table" and flags[ev.index]
      local save = ev.speech and ev.speech.game and ev.speech.game.save
      if type(flag) == "string" and flag ~= "" and save then
        save.flags = save.flags or {}
        save.flags[flag] = true
      end
    end)
  end
`;

export function introRegistration(modId: string, file: string): string {
  const module = `mods.${modId}.${file.replace(/\.lua$/, "")}`;
  return `  studioIntro(require(${JSON.stringify(module)}))`;
}

// The game's steps (OakSpeech.defaultSteps), restated for the editor: kind,
// text and picture as the game has them.
export interface IntroStep {
  id: string;
  kind?: "say" | "choice" | "yesno" | "pic" | "demo" | "name" | "shrink";
  textKey?: string;
  pic?: string | { type: string; id?: string };
  reveal?: string;
  cry?: boolean | string;
  choices?: string[];
  flags?: string[];
}

export const VANILLA_INTRO: (IntroStep & { label: string })[] = [
  { id: "oak_welcome", kind: "say", textKey: "_OakSpeechText1", pic: "oak", reveal: "fade", label: "Oak's welcome" },
  { id: "demo_mon", kind: "demo", textKey: "_OakSpeechText2A", label: "Oak shows a Pokémon" },
  { id: "world_spiel", kind: "say", textKey: "_OakSpeechText2B", label: "The world of Pokémon" },
  { id: "ask_player_name", kind: "say", textKey: "_IntroducePlayerText", pic: "player", reveal: "wipe", label: "Asks the player's name" },
  { id: "name_player", kind: "name", label: "Naming the player" },
  { id: "confirm_player_name", kind: "say", textKey: "_YourNameIsText", label: "Confirms the player's name" },
  { id: "ask_rival_name", kind: "say", textKey: "_IntroduceRivalText", pic: "rival", reveal: "fade", label: "Introduces the rival" },
  { id: "name_rival", kind: "name", label: "Naming the rival" },
  { id: "confirm_rival_name", kind: "say", textKey: "_HisNameIsText", label: "Confirms the rival's name" },
  { id: "legend", kind: "say", textKey: "_OakSpeechText3", pic: "player", label: "Your legend begins" },
  { id: "shrink", kind: "shrink", label: "The player shrinks into the world" },
];

// steps the game can't do without: the names, and the hand-over at the end
export const REQUIRED_INTRO = new Set(["name_player", "name_rival", "shrink"]);
