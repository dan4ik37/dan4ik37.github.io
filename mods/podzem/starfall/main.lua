-- Пример мода на Lua для «Подземья» (API версии 1 — docs/MODS.md).
-- Есть: mod, world, fx, npc, commands, player, game — как в JavaScript, вызовы через точку: world.get(x, y).
local timer = 0

-- Уронить звезду в колонку x: ищем землю в «окне» мира вокруг игрока
local function dropStar(x)
  local v = world.view()
  if not v then return false end
  for y = v.y0, v.y0 + v.h - 1 do
    local t = world.get(x, y)
    if t ~= nil and t ~= "air" and t ~= "leaves" and t ~= "tallgrass" and t ~= "flower" and t ~= "trunk" then
      for dx = -1, 1 do
        world.set(x + dx, y, "air")
        world.set(x + dx, y + 1, "starfall:starstone")
      end
      world.set(x, y + 2, "starfall:starstone")
      fx.particles(x + 0.5, y, "fire", 40, "#ffe060")
      fx.particles(x + 0.5, y, "star", 20)
      fx.sound("roar", 0.5)
      fx.shake(0.4)
      return true
    end
  end
  return false
end

-- Ночью раз в ~45 с звезда падает где-то рядом
mod.on("tick", function(e)
  if not world.isNight() then return end
  timer = timer + e.dt
  if timer < 45 then return end
  timer = 0
  local x = math.floor(player.x + math.random(-25, 25))
  if dropStar(x) then
    player.message("🌠 Где-то рядом упала звезда!")
  end
end)

-- Звёздная пыль (use: true в mod.json) — немного лечит
mod.on("use", function(e)
  if e.item == "starfall:stardust" then
    player.heal(10)
    fx.particles(player.x, player.y - 1.5, "star", 12)
    fx.sound("magic")
  end
end)

-- Команда /звезда — уронить звезду рядом
commands.add("звезда", "уронить звезду рядом", function(args)
  local x = math.floor(player.x + 6)
  if not dropStar(x) then
    player.message("Звезде некуда упасть")
  end
end)

npc.addLine("Ночью иногда падают звёзды. Звёздная пыль немного лечит, а из неё выходят отличные лампы.")
