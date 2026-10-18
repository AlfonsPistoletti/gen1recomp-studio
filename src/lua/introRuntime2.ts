// Oak's speech on Gen 2. The step list is the Gen 1 helper's (introRuntime.ts:
// the same public intro.oak_speech.build hook, same step ids where the moment
// is the same). What differs: Gold's speech reads its texts from
// oak_speech.lua's `text` table (speech.texts, not the text registry), so
// studio_intro_text.lua holds the edited and new texts and its helper copies
// them in on build; and the Pokémon Oak shows is speech.demoSpecies with its
// pic loaded when the speech opens, so the studio_intro record "demo" sets
// both again on build (gen1recomp src/ui/gen2/OakSpeech.lua resolvePic).
// Plain Lua, no requires, no backticks.

export const INTRO_TEXT_RUNTIME2 = "";

export function introTextRegistration2(modId: string, file: string): string {
  const module = `mods.${modId}.${file.replace(/\.lua$/, "")}`;
  return String.raw`
  -- studio intro texts (Gen 2): Oak's lines by key
  local studioIntroTexts = require(${JSON.stringify(module)})
  mod.hooks:wrap("intro.oak_speech.build", function(vanilla, steps, speech)
    steps = vanilla(steps, speech)
    if type(speech) == "table" then
      speech.texts = speech.texts or {}
      for k, v in pairs(studioIntroTexts) do
        if type(v) == "string" then speech.texts[k] = v end
      end
    end
    return steps
  end)`;
}

export function introRegistration2(modId: string, file: string): string {
  const module = `mods.${modId}.${file.replace(/\.lua$/, "")}`;
  return String.raw`
  local studioIntroSpec = require(${JSON.stringify(module)})
  studioIntro(studioIntroSpec)
  -- the Pokemon Oak shows: its species (cry) and its picture
  local studioDemo = type(studioIntroSpec.demo) == "table" and studioIntroSpec.demo.species
  if type(studioDemo) == "string" then
    mod.hooks:wrap("intro.oak_speech.build", function(vanilla, steps, speech)
      steps = vanilla(steps, speech)
      if type(speech) == "table" and speech.resolvePic then
        speech.demoSpecies = studioDemo
        speech.marillPic, speech.marillColors = speech:resolvePic({ type = "pokemon", id = studioDemo })
      end
      return steps
    end)
  end`;
}
