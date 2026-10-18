// The fixed Lua helper for custom move effects on Gen 2 (Gold/Silver/Crystal),
// written into studio_content.lua like the Gen 1 one (effectRuntime.ts). It
// turns a spec from studio_effects.lua into the move_effects record Gold's
// battle reads (gen1recomp src/battle/gen2/Battle.lua moveEffectRecordFor):
//   status move   { kind = "primary", run = fn(battle, attacker, defender,
//                 move, moveId, sureHit) }: the battle returns right after it,
//                 so it rolls accuracy itself, like the game's own handlers
//                 (EFFECT_FORESIGHT), and works through the battle's methods
//   damaging move { kind = "secondary", status }: the one side effect Gold
//                 reads from a record, rolled with the move's effect chance
// Plain Lua 5.1/LuaJIT, and no backticks (it lives in a template string).

export const EFFECT_RUNTIME2 = String.raw`
  -- studio move effects (Gen 2): specs from studio_effects.lua -> move_effects records
  local function studioEffect(spec)
    local steps = spec.steps or {}
    if spec.kind ~= "status" then
      for _, step in ipairs(steps) do
        if step.act == "status" then return { kind = "secondary", status = step.status } end
        if step.act == "confuse" then return { kind = "secondary", status = "confuse" } end
      end
      return { kind = "full" }
    end
    local foe = false
    for _, step in ipairs(steps) do
      if step.who ~= "user" then foe = true end
    end
    return {
      kind = "primary",
      run = function(battle, attacker, defender, move, moveId, sureHit)
        if foe and spec.canMiss ~= false and not sureHit
            and not battle:accuracyRoll(move, attacker, defender) then
          battle:markMissed()
          battle:emit({ kind = "message", text = battle:battlerName(attacker) .. "'s attack missed!" })
          return
        end
        local landed = false
        for _, step in ipairs(steps) do
          local chance = step.chance or 256
          local roll = battle.random and battle.random(256) or math.random(0, 255)
          if chance >= 256 or roll < chance then
            local who = step.who == "user" and attacker or defender
            local ok = false
            if step.act == "stage" then
              ok = battle:changeStageAgainstMist(attacker, who, step.stat, step.delta)
            elseif step.act == "status" then
              ok = battle:applyStatus(who, step.status, attacker)
            elseif step.act == "confuse" then
              ok = battle:applyConfusion(who, nil, attacker)
            elseif step.act == "heal" then
              local max = who.maxHp or (who.stats and who.stats.hp) or 1
              if (who.hp or 0) < max then
                battle:heal(who, math.max(1, math.floor(max * (step.percent or 50) / 100)), { anim = true })
                battle:emit({ kind = "message", text = battle:battlerName(who) .. " regained health!" })
                ok = true
              else
                battle:emit({ kind = "message", text = "But it failed!" })
              end
            end
            if ok then landed = true end
          end
        end
        -- nothing took: the failed-move look (no animation)
        if not landed then battle:markMissed() end
      end,
    }
  end
`;
