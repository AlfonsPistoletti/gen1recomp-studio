// The fixed Lua helper the studio writes into studio_content.lua when a mod
// has custom item effects. It turns one spec from studio_item_effects.lua
// (plain data, see src/games/types.ts ItemEffectSpec) into an item_effects
// record. gen1recomp src/inventory/ItemEffects.lua runs it in place of the
// built-in code when an item's `effect` names it; each step is a port of the
// vanilla branch it rebuilds (Potion, status heals, Revive, Ether/Elixer,
// vitamins, Rare Candy, stones, X items, Dire Hit, Guard Spec, Poké Doll,
// Repel, balls), with the same refusals, texts and BagMenu extras.
//
// What a mod can't reach is left out: the Heal HP sound (the item jingle plays
// instead), Yellow's Pikachu happiness and starter-Pikachu stone refusal, and
// the par/burn stat penalty re-stack after an X item. Only the supported
// src.pokemon.Stats is required (modkit MK006). Plain Lua 5.1/LuaJIT, and no
// backticks (it lives in a template string).

export const ITEM_EFFECT_RUNTIME = String.raw`
  -- studio item effects: specs from studio_item_effects.lua -> item_effects records
  local function studioItemEffect(spec)
    local steps = spec.steps or {}
    local STAT_LABEL = { hp = "HEALTH", attack = "ATTACK", defense = "DEFENSE", speed = "SPEED", special = "SPECIAL", accuracy = "ACCURACY" }
    local CURE_TEXT = { PSN = "_AntidoteText", BRN = "_BurnHealText", FRZ = "_IceHealText", SLP = "_AwakeningText", PAR = "_ParlyzHealText" }
    local BATTLE = { stage = true, focus = true, mist = true, xaccuracy = true, escape = true, ball = true }
    local ENDINGS = { ["{DONE}"] = true, ["{PROMPT}"] = true }

    -- src/core/RomText.lua: the game's own line, or the engine's wording
    local function romText(data, label, fallback, ...)
      local text = data and data.text and data.text[label]
      local args = { ... }
      if not text then return string.format(fallback, ...) end
      if #args == 0 then return text end
      local slots, named = 0, 0
      for token in text:gmatch("%b{}") do
        if not ENDINGS[token] then
          slots = slots + 1
          if token == "{PLAYER}" or token == "{RIVAL}" then named = named + 1 end
        end
      end
      local fillNamed
      if #args == slots then fillNamed = true
      elseif #args == slots - named then fillNamed = false
      else return string.format(fallback, ...) end
      local index = 0
      return (text:gsub("%b{}", function(token)
        if ENDINGS[token] then return token end
        if not fillNamed and (token == "{PLAYER}" or token == "{RIVAL}") then return token end
        index = index + 1
        local value = args[index]
        if value == nil then return token end
        return tostring(value)
      end))
    end

    local function monName(data, mon)
      local def = data.pokemon and data.pokemon[mon.species]
      return mon.nickname or (def and def.name) or tostring(mon.species)
    end
    local function noEffect(data) return romText(data, "_ItemUseNoEffectText", "It won't have\nany effect.") end
    local function notTime(data, save)
      return romText(data, "_ItemUseNotTimeText", "OAK: %s!\nThis isn't the\ntime to use that!", save.player.name)
    end
    local function recalc(data, mon)
      local old = mon.stats
      mon.stats = require("src.pokemon.Stats").calc(data.pokemon[mon.species], mon.level, mon.dvs, mon.statExp)
      return old
    end
    -- curing the active battler also clears its Toxic escalation
    local function cureToxic(battle, mon)
      if not battle then return end
      for _, b in ipairs({ battle.player, battle.enemy }) do
        if b and b.mon == mon then b.toxicCounter = nil end
      end
    end

    -- a step on the picked party Pokemon: its messages, or nil for no effect
    local function onMon(c, st, out)
      local data, mon, battle = c.data, c.target, c.battle
      local act = st.act
      if act == "heal" then
        local max = mon.stats.hp
        if mon.hp <= 0 or mon.hp >= max then return nil end
        local before = mon.hp
        local amount = st.full and max or st.percent and math.max(1, math.floor(max * st.percent / 100)) or (st.amount or 20)
        mon.hp = math.min(max, mon.hp + amount)
        out.extra.healedFrom = out.extra.healedFrom or before
        out.healed = true
        return { romText(data, "_PotionText", "%s's HP\nwas restored!", monName(data, mon), mon.hp - before) }
      elseif act == "cure" then
        local status = mon.status
        if not status then return nil end
        local list = st.statuses
        if list and #list > 0 then
          local ok = false
          for _, s in ipairs(list) do if s == status then ok = true end end
          if not ok then return nil end
        end
        mon.status = nil
        cureToxic(battle, mon)
        out.jingle = true
        -- a Full Restore's cure is silent after its heal
        if out.healed then return {} end
        local label = (list and #list == 1) and CURE_TEXT[status] or "_FullHealText"
        return { romText(data, label, "%s's\nstatus returned\nto normal!", monName(data, mon)) }
      elseif act == "revive" then
        if mon.hp > 0 then return nil end
        mon.status = nil
        mon.hp = math.max(1, math.floor(mon.stats.hp * (st.percent or 50) / 100))
        out.extra.healedFrom = 0
        out.healed = true
        if battle and battle.participants then battle.participants[mon] = true end
        return { romText(data, "_ReviveText", "%s\nis revitalized!", monName(data, mon)) }
      elseif act == "pp" then
        local function restore(mv)
          local mdef = mv and data.moves[mv.id]
          if not mdef then return false end
          local maxPP = mdef.pp + (mv.ppUps or 0) * math.floor(mdef.pp / 5)
          if mv.pp >= maxPP then return false end
          mv.pp = st.full and maxPP or math.min(maxPP, mv.pp + (st.amount or 10))
          return true
        end
        local restored = false
        if st.all == false then
          restored = restore(mon.moves[c.moveIndex or 1])
        else
          for _, mv in ipairs(mon.moves) do restored = restore(mv) or restored end
        end
        if not restored then return nil end
        out.jingle = true
        return { romText(data, "_PPRestoredText", "PP was restored.") }
      elseif act == "statexp" then
        local stat = st.stat or "attack"
        mon.statExp = mon.statExp or {}
        local cur = mon.statExp[stat] or 0
        if cur >= (st.cap or 25600) then return nil end
        mon.statExp[stat] = math.min(65535, cur + (st.amount or 2560))
        recalc(data, mon)
        mon.hp = math.min(mon.hp, mon.stats.hp)
        out.jingle = true
        return { string.format("%s's\n%s rose.", monName(data, mon), STAT_LABEL[stat] or string.upper(stat)) }
      elseif act == "level" then
        if mon.level >= 100 then return nil end
        local def = data.pokemon[mon.species]
        mon.level = mon.level + 1
        local rate = data.growth_rates and def and data.growth_rates[def.growthRate]
        if rate and rate.expForLevel then mon.exp = math.max(0, rate.expForLevel(mon.level)) end
        local old = recalc(data, mon)
        mon.hp = math.min(mon.stats.hp, mon.hp + (mon.stats.hp - old.hp))
        out.extra.leveledTo = mon.level
        return { romText(data, "_RareCandyText", "%s grew\nto level %d!", monName(data, mon), mon.level) }
      elseif act == "evolve" then
        local def = data.pokemon[mon.species]
        for _, evo in ipairs((def and def.evolutions) or {}) do
          if evo.method == "ITEM" and evo.item == c.itemId then
            out.extra.evolveTo = evo.species
            return {}
          end
        end
        return nil
      end
      return nil
    end

    -- a battle step on the player's active battler
    local function inBattle(c, st, out)
      local b = c.battle.player
      local act = st.act
      if act == "stage" then
        local stat = st.stat or "attack"
        local cur = b.stages[stat] or 0
        if cur >= 6 then
          out.after[#out.after + 1] = romText(c.data, "_NothingHappenedText", "Nothing happened!")
          return
        end
        b.stages[stat] = math.min(6, cur + (st.delta or 1))
        b.hazeStatReset = nil
        out.after[#out.after + 1] = string.format((st.delta or 1) > 1 and "%s's\n%s greatly rose!" or "%s's\n%s rose!", b.name, STAT_LABEL[stat] or string.upper(stat))
      elseif act == "focus" then
        b.focusEnergy = true
      elseif act == "mist" then
        b.mist = true
      elseif act == "xaccuracy" then
        b.xAccuracy = true
      elseif act == "escape" then
        out.escape = true
      end
    end

    local function use(c)
      local data, save, battle = c.data, c.save, c.battle
      if spec.target == "party" and not c.target then return "failed", { noEffect(data) } end
      -- refusals first, before anything changes
      for _, st in ipairs(steps) do
        if BATTLE[st.act] and not battle then return "failed", { notTime(data, save) } end
        if st.act == "repel" and battle then return "failed", { notTime(data, save) } end
        if st.act == "escape" and battle.kind ~= "wild" then return "failed", { notTime(data, save) } end
        if st.act == "ball" then
          -- a link battle has nothing to catch
          if battle.kind == "link" then return "failed", { notTime(data, save) } end
          return "ball"
        end
      end
      local out = { extra = {}, after = {}, healed = false, jingle = false }
      local msgs, landed = {}, false
      local name = (c.item and c.item.name) or c.itemId
      local used = romText(data, "_ItemUseText001", "%s used\n%s!", save.player.name, name)
      for _, st in ipairs(steps) do
        if spec.target == "party" and not BATTLE[st.act] and st.act ~= "repel" then
          local got = onMon(c, st, out)
          if got then
            landed = true
            for _, m in ipairs(got) do msgs[#msgs + 1] = m end
          end
        else
          if not landed then msgs[#msgs + 1] = used end
          landed = true
          out.jingle = true
          if st.act == "repel" then
            save.repelSteps = st.steps or 100
          else
            inBattle(c, st, out)
          end
        end
      end
      if not landed then return "failed", { noEffect(data) } end
      if #msgs == 0 and not out.extra.evolveTo then msgs[1] = used end
      local extra = out.extra
      if #out.after > 0 then extra.afterMessages = out.after end
      if out.jingle and not out.healed then extra.useJingle = true end
      if out.escape then return "consumed_escape", msgs, extra end
      return spec.keep and "kept" or "consumed", msgs, extra
    end

    local record = { needsTarget = spec.target == "party", use = use }
    if spec.where == "field" then record.battle = false end
    if spec.where == "battle" then record.field = false end
    return record
  end
`;

// the registration loop after the helper
export function itemEffectRegistration(modId: string, file: string): string {
  const module = `mods.${modId}.${file.replace(/\.lua$/, "")}`;
  return `  for id, spec in pairs(require(${JSON.stringify(module)})) do\n    mod.content.item_effects:register(id, studioItemEffect(spec))\n  end`;
}
