// The fixed Lua helper for custom held item effects on Gen 2 (Gold/Silver/Crystal),
// written into studio_content.lua. studio_held_effects.lua holds, per item id,
// `rules`: what the item does on top of (or instead of) its game held effect.
// They run through the engine's public battle hooks, each acting only for a
// holder whose item has rules (gen1recomp src/battle/gen2/Battle.lua):
//   held_item.trigger  at "priority" / "flinch" / "endure" / "confuse" / "pp" a rule
//                      answers as the game's HELD_* with its own chance; at
//                      "residual" (end of turn, asked twice a turn) the
//                      end-of-turn rules run once per turn
//   battle.damage      damage up (holder attacks) / down (holder is hit)
//   battle.crit        critical-hit level up
//   battle.accuracy    the holder is missed more often
// Chances are percent; the helper rolls them itself (so it knows when an item
// acted) and lets the game's effect fire for sure (parameter 256). "Used up"
// rules mark the item when they act; it is taken at the end of that turn
// (some game effects still read the item's name after acting). Only methods of the battle object it is handed are
// used, nothing is required (modkit MK006). Plain Lua 5.1/LuaJIT, no backticks.

export const HELD_EFFECT_RUNTIME2 = String.raw`
  -- studio held effects (Gen 2): rules from studio_held_effects.lua, run in the battle hooks
  local function studioHeldEffects(byItem)
    -- the types Gold hits with Attack (the rest use Special Attack)
    local PHYSICAL = { NORMAL = true, FIGHTING = true, FLYING = true, POISON = true, GROUND = true,
      ROCK = true, BUG = true, GHOST = true, STEEL = true }
    local CURES = { sleep = { sleep = true }, poison = { poison = true, toxic = true }, burn = { burn = true },
      freeze = { freeze = true }, paralyze = { paralyze = true } }
    -- rule kinds that answer a moment as one of the game's held effects
    local SUB = { priority = { first = "HELD_QUICK_CLAW" }, flinch = { flinch = "HELD_FLINCH" },
      endure = { endure = "HELD_FOCUS_BAND" }, confuse = { noconfuse = "HELD_PREVENT_CONFUSE" },
      pp = { pp = "HELD_RESTORE_PP" } }
    local turnDone = setmetatable({}, { __mode = "k" })
    -- mon -> true: a used-up rule acted this turn, the item goes at its end
    local spent = setmetatable({}, { __mode = "k" })
    -- "used up" is the item's: any of its rules acting spends it (an older per-rule flag counts too)
    local function usedUp(mon)
      local spec = mon and mon.item and byItem[mon.item]
      if not spec then return false end
      if spec.usedUp then return true end
      for _, r in ipairs(spec.rules or {}) do if r.usedUp then return true end end
      return false
    end
    local function acted(mon) if usedUp(mon) then spent[mon] = true end end
    local function roll(battle, percent)
      local n = tonumber(percent) or 0
      if n >= 100 then return true end
      return type(battle.random) == "function" and battle.random(100) < n
    end

    local function rulesOf(mon)
      local spec = mon and mon.item and byItem[mon.item]
      return spec and spec.rules or nil
    end
    local function maxHp(mon) return mon.maxHp or (mon.stats and mon.stats.hp) or 1 end
    -- "while HP is below M%" (0 or none: always)
    local function below(mon, pct)
      pct = tonumber(pct) or 0
      return pct <= 0 or (mon.hp or 0) * 100 < maxHp(mon) * pct
    end
    local function matches(rule, move, info)
      local on = rule.on or "all"
      local t = move and move.type
      if on == "type" then return t ~= nil and t == rule.type end
      if on == "physical" then return t ~= nil and PHYSICAL[t] == true end
      if on == "special" then return t ~= nil and not PHYSICAL[t] end
      if on == "super" then return info ~= nil and (info.effectiveness or 10) > 10 end
      return true
    end
    local function say(battle, mon, rule, default, kind)
      local def = battle:itemDef(mon.item)
      local itemName = (def and def.name) or tostring(mon.item)
      local text = (type(rule.text) == "string" and rule.text ~= "") and rule.text or default
      text = text:gsub("{USER}", function() return battle:battlerName(mon) end)
      text = text:gsub("{ITEM}", function() return itemName end)
      battle:emit({ kind = kind or "message", side = battle:sideOf(mon), status = mon.status, text = text })
    end

    -- the end-of-turn rules, once a turn (the game asks at "residual" twice)
    local function endOfTurn(battle, mon, rules)
      local mark = turnDone[mon]
      if mark and mark.battle == battle and mark.turn == battle.turn then return end
      turnDone[mon] = { battle = battle, turn = battle.turn }
      for _, r in ipairs(rules) do
        if not mon.item or (mon.hp or 0) <= 0 then break end
        local acted = false
        if r.kind == "heal" and below(mon, r.below) and (mon.hp or 0) < maxHp(mon) then
          acted = battle:heal(mon, math.max(1, math.floor(maxHp(mon) * (tonumber(r.percent) or 0) / 100))) > 0
          if acted then say(battle, mon, r, "{USER}\nrecovered using\n{ITEM}!") end
        elseif r.kind == "drain" then
          local foe = (mon == battle.player) and battle.enemy or battle.player
          local dealt = foe and battle:volatile(foe).tookThisTurn or 0
          if dealt > 0 and (mon.hp or 0) < maxHp(mon) then
            acted = battle:heal(mon, math.max(1, math.floor(dealt * (tonumber(r.percent) or 0) / 100))) > 0
            if acted then say(battle, mon, r, "{USER}\nrecovered using\n{ITEM}!") end
          end
        elseif r.kind == "hurt" then
          -- never below 1 HP: the turn's faint check has already run
          local n = math.min((mon.hp or 0) - 1, math.max(1, math.floor(maxHp(mon) * (tonumber(r.percent) or 0) / 100)))
          if n > 0 then
            mon.hp = mon.hp - n
            battle:emit({ kind = "damage", side = battle:sideOf(mon), amount = n, hp = mon.hp, anim = false })
            say(battle, mon, r, "{USER}\nwas hurt by\n{ITEM}!")
            acted = true
          end
        elseif r.kind == "cure" then
          local state = battle:volatile(mon)
          local which = r.status or "any"
          local major = mon.status ~= nil and (which == "any" or (CURES[which] ~= nil and CURES[which][mon.status] == true))
          local confused = state.confuseCount ~= nil and (which == "any" or which == "confusion")
          if major then
            mon.status, mon.statusTurns, mon.toxicCounter = nil, nil, nil
            state.nightmare, state.toxicKept = nil, nil
          end
          if confused then state.confuseCount = nil end
          acted = major or confused
          if acted then say(battle, mon, r, "{USER}\nrecovered using\n{ITEM}!", "status") end
        elseif r.kind == "raise" and below(mon, r.below) then
          say(battle, mon, r, "{USER}\nused {ITEM}!")
          acted = battle:changeStage(mon, r.stat or "attack", tonumber(r.stages) or 1) ~= false
        end
        -- used up: gone at once (its own message said it acted), so no later rule acts this turn
        if acted and usedUp(mon) then
          mon.item = nil
          spent[mon] = nil
        end
      end
    end

    mod.hooks:wrap("held_item.trigger", function(nextFn, c)
      local rules = rulesOf(c.mon)
      if not rules then return nextFn(c) end
      local sub = SUB[c.trigger]
      if sub then
        for _, r in ipairs(rules) do
          if sub[r.kind] then
            -- the game asks "confuse" and "pp" only when it matters; the rest is a chance
            if r.chance ~= nil and not roll(c.battle, r.chance) then return nil, 0 end
            if r.kind ~= "pp" then acted(c.mon) end
            return sub[r.kind], 256
          end
        end
      end
      if c.trigger == "residual" and c.battle then
        endOfTurn(c.battle, c.mon, rules)
        if spent[c.mon] and c.mon.item then
          spent[c.mon] = nil
          say(c.battle, c.mon, {}, "{USER}'s\n{ITEM} was\nused up.")
          c.mon.item = nil
        end
        -- used up: the game's own end-of-turn effect has no item left to act with
        if not c.mon.item then return nil, 0 end
      end
      return nextFn(c)
    end)

    mod.hooks:wrap("battle.damage", function(nextFn, c)
      local damage, info = nextFn(c)
      if type(damage) ~= "number" or damage <= 0 then return damage, info end
      local percent = 100
      for _, r in ipairs(rulesOf(c.user) or {}) do
        if r.kind == "boost" and below(c.user, r.below) and matches(r, c.move, info) then
          percent = percent * (100 + (tonumber(r.percent) or 0)) / 100
          acted(c.user)
        end
      end
      for _, r in ipairs(rulesOf(c.target) or {}) do
        if r.kind == "guard" and matches(r, c.move, info) then
          percent = percent * math.max(0, 100 - (tonumber(r.percent) or 0)) / 100
          acted(c.target)
        end
      end
      if percent ~= 100 then damage = math.max(1, math.floor(damage * percent / 100)) end
      return damage, info
    end)

    mod.hooks:wrap("battle.crit", function(nextFn, c)
      local up = 0
      for _, r in ipairs(rulesOf(c.attacker) or {}) do
        if r.kind == "crit" then
          up = up + (tonumber(r.stages) or 1)
          acted(c.attacker)
        end
      end
      -- data/battle/critical_hit_chances.asm has five rungs (0-4)
      if up > 0 then c.criticalLevel = math.min(4, (c.criticalLevel or 0) + up) end
      return nextFn(c)
    end)

    mod.hooks:wrap("battle.accuracy", function(nextFn, c)
      local hit = nextFn(c)
      if not hit then return hit end
      for _, r in ipairs(rulesOf(c.target) or {}) do
        if r.kind == "evade" and type(c.random) == "function" and c.random(100) < (tonumber(r.chance) or 0) then
          acted(c.target)
          return false
        end
      end
      return hit
    end)
  end
`;

export function heldEffectRegistration2(modId: string, file: string): string {
  const module = `mods.${modId}.${file.replace(/\.lua$/, "")}`;
  return `  studioHeldEffects(require(${JSON.stringify(module)}))`;
}
