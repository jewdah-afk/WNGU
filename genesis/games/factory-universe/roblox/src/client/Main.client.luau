-- Factory Universe client: joins with a snapshot, then runs the same
-- deterministic sim locally from the server's stamped command stream.
-- It may simulate up to (last clock tick + DELAY - 1): every command for
-- those ticks has already arrived on the same ordered RemoteEvent.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Sim = require(Shared.Sim)
local Content = require(Shared.Content)
local Renderer = require(script.Parent:WaitForChild("Renderer"))
local Hud = require(script.Parent:WaitForChild("Hud"))

local net = ReplicatedStorage:WaitForChild("FUNet") :: RemoteEvent
local join = ReplicatedStorage:WaitForChild("FUJoin") :: RemoteFunction

local gui = Instance.new("ScreenGui")
gui.Name = "FactoryUniverse"
gui.IgnoreGuiInset = true
gui.ResetOnSpawn = false
gui.Parent = Players.LocalPlayer:WaitForChild("PlayerGui")

-- ---------- lockstep state ----------
local st, queue, hashes, lastClock, delay
local desyncs = 0

local function resync()
	local info = join:InvokeServer()
	st = Sim.restore(Content, info.snap)
	delay = info.delay
	queue, hashes = {}, {}
	for _, p in info.pending do
		queue[p[1]] = queue[p[1]] or {}
		table.insert(queue[p[1]], p[2])
	end
	lastClock = st.tick
end
resync()

net.OnClientEvent:Connect(function(kind, t, payload)
	if kind == "cmd" then
		queue[t] = queue[t] or {}
		table.insert(queue[t], payload)
	elseif kind == "clock" then
		lastClock = math.max(lastClock, t)
		if payload then hashes[t] = payload end
	end
end)

local renderer = Renderer.new(st, gui)
local hub = st.ents[1]
renderer:centreOn(hub.x + 1.5, hub.y + 1.5)

-- ---------- ui state ----------
local ui = { tool = nil, dir = 0, hover = nil, selected = nil }
local hud
local function send(cmd) net:FireServer("cmd", cmd) end
function ui.selectTool(t)
	if t and not Sim.techUnlocked(st, Content.BUILDINGS[t].tech) then hud:say("needs research", true); return end
	ui.tool = t
	if t then ui.selected = nil end
end
hud = Hud.new(gui, function() return st end, send, ui)

-- ---------- input ----------
local function framePoint(pos: Vector2): (number, number)
	local abs = renderer.label.AbsoluteSize
	return pos.X / abs.X * renderer.f.W, pos.Y / abs.Y * renderer.f.H
end
local function hoverFrom(pos: Vector2)
	local fx, fy = framePoint(pos)
	local wx, wy = renderer:toWorld(fx, fy)
	ui.hover = { wx, wy }
end
local function ghostTile(): (number, number)
	local s = Content.BUILDINGS[ui.tool].size
	return math.floor(ui.hover[1] - (s - 1) / 2), math.floor(ui.hover[2] - (s - 1) / 2)
end

local drag, pan = nil, nil
local KEYS = {}
for _, k in Content.BUILDING_ORDER do
	local B = Content.BUILDINGS[k]
	if B.key then KEYS[B.key] = k end
end
local KEYCODES = { [Enum.KeyCode.One] = "1", [Enum.KeyCode.Two] = "2", [Enum.KeyCode.Three] = "3", [Enum.KeyCode.Four] = "4",
	[Enum.KeyCode.Five] = "5", [Enum.KeyCode.Six] = "6", [Enum.KeyCode.Seven] = "7", [Enum.KeyCode.Eight] = "8" }

UserInputService.InputBegan:Connect(function(input, processed)
	if processed then return end
	local t = input.UserInputType
	if t == Enum.UserInputType.Keyboard then
		local kc = input.KeyCode
		if KEYCODES[kc] and KEYS[KEYCODES[kc]] then
			local k = KEYS[KEYCODES[kc]]
			ui.selectTool(if ui.tool == k then nil else k)
		elseif kc == Enum.KeyCode.R then
			if ui.tool then ui.dir = (ui.dir + 1) % 4
			elseif ui.hover then send({ "rotate", math.floor(ui.hover[1]), math.floor(ui.hover[2]) }) end
		elseif kc == Enum.KeyCode.X and ui.hover then
			send({ "remove", math.floor(ui.hover[1]), math.floor(ui.hover[2]) })
		elseif kc == Enum.KeyCode.Escape or kc == Enum.KeyCode.Q then
			ui.selectTool(nil); ui.selected = nil; hud:toggleTechs(false)
		elseif kc == Enum.KeyCode.T then
			hud:toggleTechs()
		end
		return
	end
	local isTouch = t == Enum.UserInputType.Touch
	if t == Enum.UserInputType.MouseButton1 or isTouch then
		hoverFrom(Vector2.new(input.Position.X, input.Position.Y))
		if not ui.tool then
			if isTouch then pan = { input.Position, renderer.cam.x, renderer.cam.y, true } end
			local e = Sim.entAt(st, math.floor(ui.hover[1]), math.floor(ui.hover[2]))
			ui.selected = e and e.id or nil
			return
		end
		local tx, ty = ghostTile()
		local why = Sim.canBuild(st, ui.tool, tx, ty)
		if why and why ~= "occupied" then hud:say(why, true) end
		if not why then send({ "build", ui.tool, tx, ty, ui.dir }) end
		if ui.tool == "belt" then drag = { x = tx, y = ty } end
	elseif t == Enum.UserInputType.MouseButton2 then
		pan = { input.Position, renderer.cam.x, renderer.cam.y, true }
	elseif t == Enum.UserInputType.MouseButton3 then
		pan = { input.Position, renderer.cam.x, renderer.cam.y, false }
	end
end)

UserInputService.InputChanged:Connect(function(input)
	local t = input.UserInputType
	if t == Enum.UserInputType.MouseWheel then
		renderer.zoom = math.clamp(renderer.zoom + (if input.Position.Z > 0 then 1 else -1), 1, 3)
		renderer:fit()
		return
	end
	if t ~= Enum.UserInputType.MouseMovement and t ~= Enum.UserInputType.Touch then return end
	hoverFrom(Vector2.new(input.Position.X, input.Position.Y))
	if pan then
		local d = input.Position - pan[1]
		if math.abs(d.X) + math.abs(d.Y) > 4 then pan[4] = false end
		local abs = renderer.label.AbsoluteSize
		renderer.cam.x = pan[2] - d.X / abs.X * renderer.f.W
		renderer.cam.y = pan[3] - d.Y / abs.Y * renderer.f.H
	end
	if drag and ui.tool == "belt" then
		local tx, ty = math.floor(ui.hover[1]), math.floor(ui.hover[2])
		if tx == drag.x and ty == drag.y then return end
		local ddx, ddy = tx - drag.x, ty - drag.y
		local dir = if math.abs(ddx) >= math.abs(ddy) then (if ddx > 0 then 0 else 2) else (if ddy > 0 then 1 else 3)
		send({ "rotate", drag.x, drag.y, dir })
		ui.dir = dir
		local nx, ny = drag.x + Sim.DX[dir], drag.y + Sim.DY[dir]
		send({ "build", "belt", nx, ny, dir })
		drag = { x = nx, y = ny }
	end
end)

UserInputService.InputEnded:Connect(function(input)
	local t = input.UserInputType
	if t == Enum.UserInputType.MouseButton2 and pan and pan[4] and ui.hover then
		send({ "remove", math.floor(ui.hover[1]), math.floor(ui.hover[2]) })
	end
	if t == Enum.UserInputType.MouseButton1 or t == Enum.UserInputType.MouseButton2 or t == Enum.UserInputType.MouseButton3 or t == Enum.UserInputType.Touch then
		drag = nil; pan = nil
	end
end)

-- ---------- frame loop ----------
local simMs, frames, fps, fpsT = 0, 0, 0, os.clock()
RunService.RenderStepped:Connect(function(dt)
	-- keyboard panning
	local v = 300 * dt
	if UserInputService:IsKeyDown(Enum.KeyCode.W) then renderer.cam.y -= v end
	if UserInputService:IsKeyDown(Enum.KeyCode.S) then renderer.cam.y += v end
	if UserInputService:IsKeyDown(Enum.KeyCode.A) then renderer.cam.x -= v end
	if UserInputService:IsKeyDown(Enum.KeyCode.D) then renderer.cam.x += v end

	local t0 = os.clock()
	local target = lastClock + delay - 1
	local n = 0
	table.clear(st.events)
	while st.tick < target and n < 30 do
		local list = queue[st.tick]
		if list then
			for _, c in list do
				local r = Sim.applyCommand(st, c)
				if not r.ok and r.reason then hud:say(r.reason, true) end
			end
			queue[st.tick] = nil
		end
		Sim.step(st)
		n += 1
		local want = hashes[st.tick]
		if want then
			hashes[st.tick] = nil
			if Sim.stateHash(st) ~= want then
				desyncs += 1
				warn(`[FU] desync at tick {st.tick}; resyncing`)
				resync()
				renderer.st = st
				return
			end
		end
	end
	for _, ev in st.events do
		if ev.k == "research" then hud:say(Content.TECHS[ev.tech].name .. " level " .. ev.level) end
	end
	simMs = (os.clock() - t0) * 1000
	renderer:render(dt, ui)
	frames += 1
	if os.clock() - fpsT >= 1 then fps = frames; frames = 0; fpsT = os.clock() end
	hud:update(string.format("%d fps  sim %.2f ms (%d ticks)  compose %.2f  sprites %.2f  upload %.2f  tick %d  lag %d  desync %d",
		fps, simMs, n, renderer.ms.compose, renderer.ms.sprites, renderer.ms.upload, st.tick, lastClock - st.tick, desyncs))
end)
