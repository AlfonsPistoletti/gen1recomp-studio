// The fixed Lua helper the studio writes into studio_content.lua when a mod
// has custom move effects. It turns one spec from studio_effects.lua (plain
// data, see src/games/types.ts EffectSpec) into a move_effects record the
// engine's battle code understands (gen1recomp src/battle/EffectRegistry.lua
// makeCtx/runDamaging and BattleState performMove), built from the same
// patterns as the vanilla effects in src/battle/MoveEffects.lua.
//
// Rules the engine imposes: run() is iterated with ipairs, so it always
// returns a list; a status move's list carries failed = true when nothing
// landed (that also cancels its animation). Plain Lua 5.1/LuaJIT, and no
// backticks (it lives in a template string).

export const EFFECT_RUNTIME = String.raw`
  -- studio move effects: specs from studio_effects.lua -> move_effects records
  local function studioEffect(spec)
    local steps = spec.steps or {}
    local function name(ctx, who) return ctx.displayName(who) end
    local function failed(text) return { text, failed = true } end
    local function append(out, msgs)
      for _, m in ipairs(msgs or {}) do out[#out + 1] = m end
    end
    -- did a step take effect (messages that are not a failure)
    local function landed(msgs) return msgs and #msgs > 0 and not msgs.failed end
    local function rolls(ctx, step)
      local chance = step.chance or 256
      return chance >= 256 or ctx.rng(0, 255) < chance
    end
    local STATUS = { SLP = "SLP", PSN = "PSN", TOX = "PSN", PAR = "PAR", BRN = "BRN", FRZ = "FRZ" }

    -- one step; primary = the main effect of a status move
    local function apply(ctx, step, primary)
      local who = step.who == "user" and ctx.user or ctx.target
      local foe = who == ctx.target
      if step.act == "stage" then
        if not primary and foe and ctx.target.substituteHP then return {} end
        -- a status move's stat drop is blocked by Substitute/Mist (statDown);
        -- a side effect pierces Mist (statDownSide)
        return ctx.changeStage(who, step.stat, step.delta, primary and foe)
      elseif step.act == "status" then
        if primary and who.mon.status then
          return failed(string.format("It didn't affect\n%s!", name(ctx, who)))
        end
        local msgs = ctx.inflict(who, STATUS[step.status] or step.status, {
          toxic = step.status == "TOX", moveType = ctx.move.type,
          source = ctx.move.id, secondary = not primary or nil,
        })
        if primary and #msgs == 0 then return failed("But, it failed!") end
        return msgs
      elseif step.act == "confuse" then
        if who.confusedTurns or (primary and foe and who.substituteHP) then
          return primary and failed("But, it failed!") or {}
        end
        who.confusedTurns = ctx.rng(2, 5)
        return { string.format("%s\nbecame confused!", name(ctx, who)) }
      elseif step.act == "flinch" then
        if not ctx.target.substituteHP then ctx.target.flinched = true end
        return {}
      elseif step.act == "heal" then
        local mon = who.mon
        if mon.hp >= mon.stats.hp then return primary and failed("But, it failed!") or {} end
        mon.hp = math.min(mon.stats.hp, mon.hp + math.max(1, math.floor(mon.stats.hp * (step.percent or 50) / 100)))
        -- a status move's bar drains after its messages (performMove)
        if not primary then ctx.drain() end
        return { string.format("%s\nregained health!", name(ctx, who)) }
      end
      return {}
    end

    local function runSteps(ctx, primary)
      local out, any = {}, false
      for _, step in ipairs(steps) do
        if rolls(ctx, step) then
          local msgs = apply(ctx, step, primary)
          if landed(msgs) then any = true end
          append(out, msgs)
        end
      end
      if primary and not any then
        out.failed = true
        if #out == 0 then out[1] = "But, it failed!" end
      end
      return out
    end

    if spec.kind == "status" then
      local targetsFoe, inflicts = false, false
      for _, step in ipairs(steps) do
        if step.who ~= "user" and step.act ~= "flinch" then targetsFoe = true end
        if step.act == "status" then inflicts = true end
      end
      return {
        kind = "primary",
        accuracyChecked = (spec.canMiss ~= false and targetsFoe) or nil,
        -- the vanilla miss lines: statuses "didn't affect", the rest "failed"
        missText = targetsFoe and (inflicts and "didntAffect" or "butItFailed") or nil,
        run = function(ctx) return runSteps(ctx, true) end,
      }
    end

    local record = { kind = "full" }
    if spec.neverMiss then record.neverMiss = true end
    if spec.hits == "2-5" then
      -- the 2-2-2-3-3-3-4-5 spread of TWO_TO_FIVE_ATTACKS_EFFECT
      local spread = { 2, 2, 2, 3, 3, 3, 4, 5 }
      record.hitCount = function(ctx) return spread[ctx.rng(0, 7) + 1] end
    elseif type(spec.hits) == "number" and spec.hits > 1 then
      local n = spec.hits
      record.hitCount = function() return n end
    end
    if type(spec.damage) == "table" and spec.damage.fixed then
      local amount = spec.damage.fixed
      record.chooseDamage = function() return amount, { crit = false, typeMult = 10 } end
    elseif spec.damage == "level" then
      record.chooseDamage = function(ctx) return ctx.user.mon.level, { crit = false, typeMult = 10 } end
    end
    local recoil, drain = spec.recoil or 0, spec.drain or 0
    if recoil > 0 or drain > 0 then
      record.afterDamage = function(ctx, dealt)
        if drain > 0 then
          local mon = ctx.user.mon
          mon.hp = math.min(mon.stats.hp, mon.hp + math.max(1, math.floor(dealt * drain / 100)))
          ctx.drain()
          ctx.say(string.format("Sucked health from\n%s!", name(ctx, ctx.target)))
        end
        if recoil > 0 then
          ctx.say(string.format("%s's\nhit with recoil!", name(ctx, ctx.user)))
          ctx.battle:applyDamage(ctx.user, math.max(1, math.floor(dealt * recoil / 100)))
        end
      end
    end
    if #steps > 0 then
      record.run = function(ctx) return runSteps(ctx, false) end
    end
    return record
  end
`;

// the registration loop after the helper
export function effectRegistration(modId: string, file: string): string {
  const module = `mods.${modId}.${file.replace(/\.lua$/, "")}`;
  return `  for id, spec in pairs(require(${JSON.stringify(module)})) do\n    mod.content.move_effects:register(id, studioEffect(spec))\n  end`;
}
