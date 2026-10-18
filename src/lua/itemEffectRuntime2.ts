// The fixed Lua helper for custom item effects on Gen 2 (Gold/Silver/Crystal),
// written into studio_content.lua like the Gen 1 one (itemEffectRuntime.ts).
// Gold keys item_effects by ITEM id (gen1recomp src/core/gen2/ItemEffects.lua
// recordFor), so a spec in studio_item_effects.lua is stored under the item it
// belongs to and becomes { action, use = fn(ctx{item, mon, data, slot}) ->
// { used, text, ... }, field, needsTarget }. The pack and the battle pick
// their flow by `action`: "pp" opens the move list (field always, battle for
// the Ether ids), "candy" offers the new moves, "stone" plays the evolution,
// "heal"/"revive" animate the HP bar. Where the item can be used is the item
// record's fieldMenu/battleMenu, set by the editor.
//
// Level up, stones and vitamins reuse the game's own records (captured through
// item_effects:get before the studio's overrides land), so no engine module is
// required (modkit MK006). Plain Lua 5.1/LuaJIT, no backticks (template string).

import { GEN2_EFFECT_ITEMS } from "../games/gen2/items.ts";

export const ITEM_EFFECT_RUNTIME2 = String.raw`
  -- studio item effects (Gen 2): specs from studio_item_effects.lua -> item_effects records
  local studioGameItem = {}
  for _, id in ipairs({ "RARE_CANDY", "SUN_STONE", "HP_UP", "PROTEIN", "IRON", "CARBOS", "CALCIUM" }) do
    local r = mod.content.item_effects:get(id)
    studioGameItem[id] = r and r.use
  end
  local function studioItemEffect(spec)
    local steps = spec.steps or {}
    local NO_EFFECT = "It won't have any\neffect."
    local CLASS = { psn = "psn", poison = "psn", toxic = "psn", brn = "brn", burn = "brn", frz = "frz", freeze = "frz",
      par = "par", paralysis = "par", paralyze = "par", slp = "slp", sleep = "slp" }
    local CURE_TEXT = { psn = "%s's\ncured of poison.", par = "%s's\nrid of paralysis.", brn = "%s's\nburn was healed.",
      frz = "%s\nwas defrosted.", slp = "%s\nwoke up.", all = "%s's\nhealth returned." }
    local VITAMIN = { hp = "HP_UP", attack = "PROTEIN", defense = "IRON", speed = "CARBOS", special = "CALCIUM" }

    local function monName(mon) return mon.nickname or mon.name or tostring(mon.species) end
    local function maxHp(mon) return mon.maxHp or (mon.stats and mon.stats.hp) or 0 end
    local function clearStatus(mon) mon.status, mon.statusTurns, mon.toxicCounter = nil, nil, nil end
    -- Mon.maxPpOf: the move's base PP plus its PP Ups
    local function maxPp(move, data)
      local def = data and data.moves and data.moves[move.id]
      local base = def and tonumber(def.pp)
      if not base then return tonumber(move.maxPp) or tonumber(move.pp) or 0 end
      local bonus = math.min(math.floor(base / 5), 7)
      local ups = tonumber(move.ppUps)
      if ups == nil then
        ups = 0
        local stored = tonumber(move.maxPp)
        if stored and stored > base and bonus > 0 and (stored - base) % bonus == 0 then ups = (stored - base) / bonus end
      end
      return base + math.max(0, math.min(3, math.floor(ups))) * bonus
    end
    local function game(id, ctx, item)
      local use = studioGameItem[id]
      if not use then return nil end
      local r = use({ item = item or ctx.item, mon = ctx.mon, data = ctx.data, slot = ctx.slot })
      return r and r.used and r or nil
    end

    -- one step on the picked mon: its result ({ text, ... }) or nil for no effect
    local function run(ctx, st, done)
      local mon = ctx.mon
      local act = st.act
      if act == "heal" then
        local max = maxHp(mon)
        if (mon.hp or 0) <= 0 or (mon.hp or 0) >= max then return nil end
        local amount = st.full and max or st.percent and math.max(1, math.floor(max * st.percent / 100)) or (st.amount or 20)
        local before = mon.hp
        mon.hp = math.min(max, mon.hp + amount)
        done.healed = true
        return { text = string.format("%s\nrecovered %dHP!", monName(mon), mon.hp - before) }
      elseif act == "cure" then
        if (mon.hp or 0) <= 0 then return nil end
        local have = CLASS[string.lower(tostring(mon.status or ""))]
        local statuses = ctx.data and ctx.data.gen2Statuses
        local own = statuses and mon.status and statuses[mon.status]
        have = have or (own and own.healClass)
        if not have then return nil end
        local list = st.statuses
        if list and #list > 0 then
          local ok = false
          for _, s in ipairs(list) do if s == have then ok = true end end
          if not ok then return nil end
        end
        clearStatus(mon)
        -- a Full Restore's cure is silent after its heal
        if done.healed then return { text = false } end
        return { text = string.format(CURE_TEXT[(list and #list == 1) and have or "all"] or CURE_TEXT.all, monName(mon)) }
      elseif act == "revive" then
        if (mon.hp or 0) > 0 then return nil end
        mon.hp = math.max(1, math.floor(maxHp(mon) * (st.percent or 50) / 100))
        clearStatus(mon)
        return { text = string.format("%s\nis revitalized.", monName(mon)) }
      elseif act == "pp" then
        local function restore(move)
          if type(move) ~= "table" or not move.id then return false end
          local max = maxPp(move, ctx.data)
          if (move.pp or 0) >= max then return false end
          move.pp = st.full and max or math.min(max, (move.pp or 0) + (st.amount or 10))
          return true
        end
        local moves = mon.moves or {}
        local any = false
        if st.all == false and ctx.slot then
          any = restore(moves[ctx.slot])
        else
          for _, move in ipairs(moves) do any = restore(move) or any end
        end
        return any and { text = "PP was restored." } or nil
      elseif act == "statexp" then
        return game(VITAMIN[st.stat or "attack"] or "PROTEIN", ctx, VITAMIN[st.stat or "attack"])
      elseif act == "level" then
        return game("RARE_CANDY", ctx)
      elseif act == "evolve" then
        return game("SUN_STONE", ctx)
      end
      return nil
    end

    local action = "status"
    for _, st in ipairs(steps) do
      if st.act == "evolve" then action = "stone" break end
      if st.act == "pp" and st.all == false then action = "pp" break end
      if st.act == "level" then action = "candy"
      elseif action == "status" and st.act == "heal" then action = "heal"
      elseif action == "status" and st.act == "revive" then action = "revive" end
    end

    local function use(ctx)
      local out, texts, done = { used = false }, {}, {}
      for _, st in ipairs(steps) do
        local got = run(ctx, st, done)
        if got then
          out.used = true
          for k, v in pairs(got) do if k ~= "text" and k ~= "used" then out[k] = v end end
          if got.text then texts[#texts + 1] = got.text end
        end
      end
      if not out.used then return { used = false, text = NO_EFFECT } end
      out.text = table.concat(texts, "\f")
      return out
    end
    return { action = action, use = use, field = true, needsTarget = true }
  end
`;

// the registration loop after the helper: the game's own ids are overridden
export function itemEffectRegistration2(modId: string, file: string): string {
  const module = `mods.${modId}.${file.replace(/\.lua$/, "")}`;
  const game = GEN2_EFFECT_ITEMS.map((id) => `${id} = true`).join(", ");
  return [
    `  local studioOwnItem = { ${game} }`,
    `  for id, spec in pairs(require(${JSON.stringify(module)})) do`,
    `    if studioOwnItem[id] then mod.content.item_effects:override(id, studioItemEffect(spec))`,
    `    else mod.content.item_effects:register(id, studioItemEffect(spec)) end`,
    `  end`,
  ].join("\n");
}
