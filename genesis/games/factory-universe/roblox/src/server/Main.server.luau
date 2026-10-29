-- Factory Universe server. Owns the authoritative sim and relays player
-- commands as data: each accepted command is stamped with an apply tick
-- DELAY ticks ahead and broadcast before the server reaches that tick, so
-- every client runs the identical deterministic sim locally (lockstep).
-- Bandwidth is commands + a 10 Hz clock, independent of factory size.
-- State hashes ride the clock every 300 ticks to detect desync.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local Players = game:GetService("Players")
local DataStoreService = game:GetService("DataStoreService")
local HttpService = game:GetService("HttpService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Sim = require(Shared.Sim)
local Content = require(Shared.Content)

local SEED = 1
local DELAY = 6 -- ticks between receipt and application (100 ms)
local CLOCK_EVERY = 6 -- ticks between clock messages (10 Hz)
local HASH_EVERY = 300
local MAX_CATCHUP = 8 -- ticks per Heartbeat before we drop time instead of spiralling
local SAVE_EVERY = 60 -- seconds

local net = Instance.new("RemoteEvent")
net.Name = "FUNet"
net.Parent = ReplicatedStorage
local join = Instance.new("RemoteFunction")
join.Name = "FUJoin"
join.Parent = ReplicatedStorage

-- ---------- persistence ----------
local store
pcall(function() store = DataStoreService:GetDataStore("FactoryUniverse_v1") end)

local function loadWorld()
	if store then
		local ok, data = pcall(function() return store:GetAsync("sector:" .. SEED) end)
		if ok and type(data) == "string" then
			local ok2, snap = pcall(function() return HttpService:JSONDecode(data) end)
			if ok2 and snap then
				local ok3, st = pcall(Sim.restore, Content, snap)
				if ok3 then return st end
				warn("[FU] save restore failed: " .. tostring(st))
			end
		end
	end
	return Sim.createWorld(Content, { seed = SEED })
end

local st = loadWorld()
local queue: { [number]: { any } } = {}

local function save()
	if not store then return end
	local json = HttpService:JSONEncode(Sim.snapshot(st))
	local ok, err = pcall(function() store:SetAsync("sector:" .. SEED, json) end)
	if not ok then warn("[FU] save failed: " .. tostring(err)) end
end

-- ---------- validation ----------
local KINDS = { build = true, remove = true, rotate = true, recipe = true, research = true }
local function isInt(v) return type(v) == "number" and v == math.floor(v) and v >= -1 and v < 4096 end
local function valid(cmd): boolean
	if type(cmd) ~= "table" or not KINDS[cmd[1]] then return false end
	local k = cmd[1]
	if k == "build" then return type(cmd[2]) == "string" and Content.BUILDINGS[cmd[2]] ~= nil and isInt(cmd[3]) and isInt(cmd[4]) and isInt(cmd[5]) and cmd[5] >= 0 and cmd[5] <= 3 end
	if k == "remove" then return isInt(cmd[2]) and isInt(cmd[3]) end
	if k == "rotate" then return isInt(cmd[2]) and isInt(cmd[3]) and (cmd[4] == nil or isInt(cmd[4])) end
	if k == "recipe" then return isInt(cmd[2]) and type(cmd[3]) == "string" and Content.RECIPES[cmd[3]] ~= nil end
	if k == "research" then return cmd[2] == nil or (type(cmd[2]) == "string" and Content.TECHS[cmd[2]] ~= nil) end
	return false
end

-- per-player token bucket: 40 commands/s burst, 20/s sustained (belt dragging is chatty)
local buckets: { [Player]: { n: number, t: number } } = {}
local function allow(p: Player): boolean
	local b = buckets[p]
	local now = os.clock()
	if not b then b = { n = 40, t = now }; buckets[p] = b end
	b.n = math.min(40, b.n + (now - b.t) * 20); b.t = now
	if b.n < 1 then return false end
	b.n -= 1
	return true
end
Players.PlayerRemoving:Connect(function(p) buckets[p] = nil end)

net.OnServerEvent:Connect(function(player, kind, cmd)
	if kind ~= "cmd" or not allow(player) or not valid(cmd) then return end
	local clean = { cmd[1], cmd[2], cmd[3], cmd[4], cmd[5] }
	local t = st.tick + DELAY
	queue[t] = queue[t] or {}
	table.insert(queue[t], clean)
	net:FireAllClients("cmd", t, clean)
end)

join.OnServerInvoke = function(_player)
	local pending = {}
	for t, list in queue do
		if t >= st.tick then for _, c in list do table.insert(pending, { t, c }) end end
	end
	table.sort(pending, function(a, b) return a[1] < b[1] end)
	return { snap = Sim.snapshot(st), pending = pending, delay = DELAY }
end

-- ---------- fixed-step loop ----------
local acc = 0
local stepMs = 0
RunService.Heartbeat:Connect(function(dt)
	acc += dt
	local n = 0
	local t0 = os.clock()
	while acc >= 1 / 60 and n < MAX_CATCHUP do
		local list = queue[st.tick]
		if list then
			for _, c in list do Sim.applyCommand(st, c) end
			queue[st.tick] = nil
		end
		Sim.step(st)
		table.clear(st.events)
		if st.tick % CLOCK_EVERY == 0 then
			net:FireAllClients("clock", st.tick, if st.tick % HASH_EVERY == 0 then Sim.stateHash(st) else nil)
		end
		acc -= 1 / 60
		n += 1
	end
	if n == MAX_CATCHUP then acc = 0 end -- server is behind: drop time rather than spiral
	stepMs = (os.clock() - t0) * 1000
	workspace:SetAttribute("FU_SimMs", stepMs)
end)

task.spawn(function()
	while true do
		task.wait(SAVE_EVERY)
		save()
	end
end)
game:BindToClose(save)
